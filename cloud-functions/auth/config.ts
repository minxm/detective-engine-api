import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { ensureUserRecord } from '../../src/auth/roles.js';
import { resolveAuthUser, getAuthConfig } from '../../src/auth/cloudbase.js';
import { heartbeatOnline } from '../../src/services/job-cache.js';

export async function handleAuthConfig(_ctx: CloudContext): Promise<Response> {
  return jsonResponse({ success: true, auth: getAuthConfig() });
}

export async function handleAuthHeartbeat(ctx: CloudContext): Promise<Response> {
  const user = await resolveAuthUser(ctx.headers);
  if (!user?.userId) {
    return jsonResponse({ success: false, error: '未登录' }, 401);
  }
  await heartbeatOnline(user.userId);
  return jsonResponse({ success: true });
}

export async function handleAuthProfile(ctx: CloudContext): Promise<Response> {
  const user = await resolveAuthUser(ctx.headers);
  if (!user?.userId) return jsonResponse({ success: false, error: '未登录' }, 401);

  if (ctx.method === 'GET') {
    const record = await ensureUserRecord({
      userId: user.userId,
      nickname: user.nickname,
      avatar: user.avatar,
    });
    return jsonResponse({
      success: true,
      user: {
        nickname: record.nickname,
        avatar: record.avatar,
        role: record.role,
      },
    });
  }

  const body = (ctx.body ?? {}) as { nickname?: string; avatar?: string };
  const existing = await ensureUserRecord({
    userId: user.userId,
    nickname: user.nickname,
    avatar: user.avatar,
  });
  const { getDatabase } = await import('../../src/db/index.js');
  const saved = await getDatabase().users.upsert({
    ...existing,
    nickname: body.nickname ?? existing.nickname,
    avatar: body.avatar ?? existing.avatar,
    updatedAt: Date.now(),
  });

  return jsonResponse({
    success: true,
    user: {
      nickname: saved.nickname,
      avatar: saved.avatar,
      role: saved.role,
    },
  });
}

export { handleAuthProfile as handleUserProfileLegacy };
