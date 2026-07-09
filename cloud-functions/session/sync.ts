import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { syncCaseSession } from '../../src/services/session-service.js';
import type { SessionRecord } from '../../src/types/index.js';

export async function handleSessionSync(ctx: CloudContext): Promise<Response> {
  const user = await resolveAuthUser(ctx.headers);
  if (!user?.userId) {
    return jsonResponse({ success: false, error: '未登录' }, 401);
  }

  const body = (ctx.body ?? {}) as {
    caseId?: string;
    progress?: SessionRecord['progress'];
    messages?: SessionRecord['messages'];
  };

  if (!body.caseId) {
    return jsonResponse({ success: false, error: '缺少 caseId' }, 400);
  }

  try {
    await syncCaseSession({
      userId: user.userId,
      caseId: body.caseId,
      progress: body.progress,
      messages: body.messages,
    });
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[session/sync] failed:', error);
    return jsonResponse({ success: false, error: (error as Error).message || '会话同步失败' }, 500);
  }
}
