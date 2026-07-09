import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { getDatabase } from '../../src/db/index.js';
import { verifyPassword } from '../../src/auth/local-auth.js';
import { generateLocalToken } from '../../src/auth/local-auth.js';
import { recordLoginAudit } from '../../src/services/login-audit.js';
import { withRetry } from '../../src/utils/retry.js';

export async function handleAuthLogin(ctx: CloudContext): Promise<Response> {
  if (ctx.method !== 'POST') {
    return jsonResponse({ success: false, error: '不支持的请求方法' }, 405);
  }

  const body = (ctx.body ?? {}) as { account?: string; password?: string; username?: string };
  const account = (body.account ?? body.username ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  if (!account || !password) {
    return jsonResponse({ success: false, error: '请输入账号和密码' }, 400);
  }

  try {
    const db = getDatabase();
    const user = await withRetry(() => db.users.findByUsername(account), { retries: 2, delayMs: 300 });

    if (!user || !user.passwordHash) {
      return jsonResponse({ success: false, error: '用户名或密码不正确' }, 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return jsonResponse({ success: false, error: '用户名或密码不正确' }, 401);
    }

    const token = generateLocalToken(user._id);
    void recordLoginAudit({
      userId: user._id,
      username: user.username,
      nickname: user.nickname,
      source: 'login',
    });

    return jsonResponse({
      success: true,
      token,
      user: {
        uid: user._id,
        name: user.nickname,
        role: user.role,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : '登录失败，请稍后重试';
    return jsonResponse({ success: false, error: message }, 500);
  }
}
