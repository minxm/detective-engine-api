import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse, parseAuthUserId } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import type { CaseData } from '../../src/types/index.js';
import {
  buildInterrogationPrompt,
  createSuspectChatStream,
  serializeCaseSummary,
} from '../../src/ai/index.js';

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
  // 优先使用 interrogationScript 预设台词
  const suspectFull = caseData.suspects.find((s) => s.name === suspect.name);
  if (suspectFull?.interrogationScript?.length) {
    const kw = userMessage.toLowerCase();
    const matched = suspectFull.interrogationScript.find((q) =>
      kw.split(/\s+/).some((w) => w.length > 1 && q.question.includes(w))
    );
    if (matched) return matched.answer;
    // 随机返回一条
    const pick = suspectFull.interrogationScript[Math.floor(Math.random() * suspectFull.interrogationScript.length)];
    return pick?.answer ?? '';
  }
  return suspect.isGuilty
    ? '……我不知道你在说什么。'
    : '我会配合调查，但我真的什么都不知道。';
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

  const authUser = (await resolveAuthUser(ctx.headers)) ?? { userId: parseAuthUserId(ctx.headers) ?? undefined };
  const systemPrompt = buildInterrogationPrompt(
    body.suspect,
    body.evidence ?? [],
    serializeCaseSummary(body.caseData)
  );

  // 尝试建立 AI 流式连接；网络不可达时降级为预设台词
  let stream: Awaited<ReturnType<typeof createSuspectChatStream>> | null = null;
  let fallbackReply: string | null = null;

  try {
    stream = await createSuspectChatStream({
      systemPrompt,
      messages: body.messages,
      userId: authUser?.userId,
      caseId: body.caseData.id,
    });
  } catch (err) {
    console.warn('[Interrogate] AI 连接失败，使用预设台词:', (err as Error).message);
    const lastUserMsg = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    fallbackReply = makeFallbackReply(body.suspect, body.caseData, lastUserMsg);
  }

  const readable = new ReadableStream({
    async start(controller) {
      try {
        if (fallbackReply !== null || stream === null) {
          // 模拟流式逐字输出，体验更自然
          const text = fallbackReply ?? '……';
          for (const ch of text) {
            controller.enqueue(sseData({ type: 'delta', content: ch }));
          }
          controller.enqueue(sseData({ type: 'done', content: text }));
          return;
        }

        let content = '';
        for await (const delta of stream.iterate()) {
          content += delta;
          controller.enqueue(sseData({ type: 'delta', content: delta }));
        }
        controller.enqueue(sseData({ type: 'done', content: cleanReply(content) }));
      } catch (error) {
        controller.enqueue(sseData({ type: 'error', error: (error as Error).message }));
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
