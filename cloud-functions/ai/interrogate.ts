import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse, parseAuthUserId } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { withRetry, isTransientNetworkError } from '../../src/utils/retry.js';
import type { CaseData } from '../../src/types/index.js';
import {
  buildInterrogationPrompt,
  createSuspectChatStream,
  serializeCaseSummary,
} from '../../src/ai/index.js';
import { appendInterrogationMessages } from '../../src/services/session-service.js';

function sseData(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function cleanReply(content: string): string {
  return content.replace(/[\s\S]*?<\/think>/g, '').trim() || '我不想回答这个问题。';
}

function makeFallbackReply(
  suspect: { name: string; isGuilty?: boolean },
  caseData: CaseData,
  userMessage: string,
): string {
  const suspectFull = caseData.suspects.find((s) => s.name === suspect.name);
  if (suspectFull?.interrogationScript?.length) {
    const kw = userMessage.toLowerCase();
    const matched = suspectFull.interrogationScript.find((q) => {
      const question = q.question ?? '';
      return kw.split(/\s+/).some((w) => w.length > 1 && question.includes(w));
    });
    if (matched) return matched.answer;
    const pick = suspectFull.interrogationScript[Math.floor(Math.random() * suspectFull.interrogationScript.length)];
    return pick?.answer ?? '';
  }
  return suspect.isGuilty
    ? '……我不知道你在说什么。'
    : '我会配合调查，但我真的什么都不知道。';
}

async function streamText(controller: ReadableStreamDefaultController, text: string) {
  for (const ch of text) {
    controller.enqueue(sseData({ type: 'delta', content: ch }));
  }
  controller.enqueue(sseData({ type: 'done', content: text }));
}

async function resolveInterrogateUser(headers: Record<string, string | undefined>) {
  try {
    return await withRetry(() => resolveAuthUser(headers), { retries: 3, delayMs: 500 });
  } catch (err) {
    console.warn('[Interrogate] 认证解析失败，降级为无用户上下文:', (err as Error).message);
    const userId = parseAuthUserId(headers);
    return userId ? { userId, role: 'user' as const } : null;
  }
}

async function createInterrogateStream(params: {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  userId?: string;
  caseId?: string;
}) {
  try {
    return await withRetry(() => createSuspectChatStream(params), { retries: 3, delayMs: 600 });
  } catch (err) {
    console.warn('[Interrogate] AI 连接失败:', (err as Error).message);
    return null;
  }
}

export async function handleInterrogate(ctx: CloudContext): Promise<Response> {
  const body = (ctx.body ?? {}) as {
    suspect?: { id: string; name: string; isGuilty?: boolean };
    messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
    evidence?: string[];
    caseData?: CaseData;
  };

  if (!body.suspect || !body.messages || !body.caseData) {
    return jsonResponse({ success: false, error: '缺少审问参数' }, 400);
  }

  let fallbackReply = '……';
  try {
    const authUser = await resolveInterrogateUser(ctx.headers);
    const userId = authUser?.userId;
    const systemPrompt = buildInterrogationPrompt(
      body.suspect,
      body.evidence ?? [],
      serializeCaseSummary(body.caseData),
    );
    const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    fallbackReply = makeFallbackReply(body.suspect, body.caseData, lastUserMsg) || '……';

    const readable = new ReadableStream({
      async start(controller) {
        let finalReply = '';
        try {
          const stream = await createInterrogateStream({
            systemPrompt,
            messages: body.messages!,
            userId,
            caseId: body.caseData!.id,
          });

          if (!stream) {
            finalReply = fallbackReply;
            await streamText(controller, finalReply);
          } else {
            try {
              let content = '';
              for await (const delta of stream.iterate()) {
                content += delta;
                controller.enqueue(sseData({ type: 'delta', content: delta }));
              }
              finalReply = cleanReply(content) || fallbackReply;
              controller.enqueue(sseData({ type: 'done', content: finalReply }));
            } catch (streamErr) {
              console.warn('[Interrogate] 流式输出中断，使用预设台词:', (streamErr as Error).message);
              finalReply = fallbackReply;
              await streamText(controller, finalReply);
            }
          }

          if (userId && finalReply) {
            const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
            const ts = Date.now();
            void withRetry(
              () =>
                appendInterrogationMessages({
                  userId,
                  caseId: body.caseData!.id,
                  suspectId: body.suspect!.id,
                  turns: [
                    ...(lastUser ? [{ role: 'user' as const, content: lastUser.content, timestamp: ts - 1 }] : []),
                    { role: 'assistant', content: finalReply, timestamp: ts },
                  ],
                }),
              { retries: 3, delayMs: 500 },
            ).catch((err) => console.warn('[Interrogate] 会话写入失败:', (err as Error).message));
          }
        } catch (error) {
          const message = (error as Error).message || '审问失败';
          if (isTransientNetworkError(error) || fallbackReply) {
            console.warn('[Interrogate] 降级为预设台词:', message);
            finalReply = fallbackReply;
            try {
              await streamText(controller, finalReply);
            } catch {
              controller.enqueue(sseData({ type: 'error', error: '审问失败，请稍后重试' }));
            }
          } else {
            controller.enqueue(sseData({ type: 'error', error: message }));
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[Interrogate] 处理失败，返回预设回复:', (error as Error).message);
    const readable = new ReadableStream({
      async start(controller) {
        try {
          await streamText(controller, fallbackReply);
        } finally {
          controller.close();
        }
      },
    });
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
