import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { registerCloudBaseUser } from '../../src/auth/register.js';
import { recordLoginAudit } from '../../src/services/login-audit.js';
import { withRetry } from '../../src/utils/retry.js';

export async function handleAuthRegister(ctx: CloudContext): Promise<Response> {
  if (ctx.method !== 'POST') {
    return jsonResponse({ success: false, error: '不支持的请求方法' }, 405);
  }

  const body = (ctx.body ?? {}) as { account?: string; password?: string; username?: string };
  const account = (body.account ?? body.username ?? '').trim();
  const password = body.password ?? '';

  if (!account || !password) {
    return jsonResponse({ success: false, error: '请输入账号和密码' }, 400);
  }

  try {
    const user = await withRetry(() => registerCloudBaseUser(account, password), { retries: 2, delayMs: 300 });
    void recordLoginAudit({
      userId: user.uid,
      username: account.trim().toLowerCase(),
      nickname: user.name,
      source: 'register',
    });
    return jsonResponse({ success: true, user });
  } catch (err) {
    const message = err instanceof Error ? err.message : '注册失败，请稍后重试';
    return jsonResponse({ success: false, error: message }, 400);
  }
}
