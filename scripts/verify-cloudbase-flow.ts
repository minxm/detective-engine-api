import 'dotenv/config';
import { resetDatabaseForTests } from '../src/db/index.js';
import { ensureUserRecord } from '../src/auth/roles.js';
import { resolveAuthUser, getAuthConfig } from '../src/auth/cloudbase.js';

const API_BASE = process.env.VERIFY_API_BASE ?? 'http://localhost:8787';
const TEST_USER_ID = `test_verify_${Date.now()}`;

async function verifyDatabase() {
  resetDatabaseForTests();
  const record = await ensureUserRecord({
    userId: TEST_USER_ID,
    nickname: '验证用户',
  });

  const { getDatabase } = await import('../src/db/index.js');
  const saved = await getDatabase().users.findById(TEST_USER_ID);
  if (!saved || saved.nickname !== record.nickname) {
    throw new Error('TCB users 集合读写失败');
  }
  console.log('[ok] TCB 文档库 users 读写正常');
}

async function verifyAuthResolution() {
  const user = await resolveAuthUser({
    authorization: `Bearer ${TEST_USER_ID}`,
  });
  if (!user?.userId) {
    throw new Error('resolveAuthUser 未返回用户');
  }
  console.log('[ok] 登录用户解析正常:', user.userId, user.role);
}

async function verifyHttpFlow() {
  const configRes = await fetch(`${API_BASE}/api/auth/config`);
  if (!configRes.ok) throw new Error(`/api/auth/config HTTP ${configRes.status}`);
  const config = (await configRes.json()) as { success?: boolean; auth?: { enabled?: boolean; envId?: string } };
  if (!config.success || !config.auth?.enabled) {
    throw new Error('auth/config 未启用 CloudBase');
  }
  console.log('[ok] /api/auth/config envId=', config.auth.envId);

  const profileRes = await fetch(`${API_BASE}/api/user/profile`, {
    headers: { Authorization: `Bearer ${TEST_USER_ID}` },
  });
  if (!profileRes.ok) throw new Error(`/api/user/profile HTTP ${profileRes.status}`);
  const profile = (await profileRes.json()) as {
    success?: boolean;
    user?: { nickname?: string; role?: string };
  };
  if (!profile.success || !profile.user?.nickname) {
    throw new Error('auth/profile 未返回用户资料');
  }
  console.log('[ok] /api/user/profile 用户已写入 TCB:', profile.user.nickname, profile.user.role);

  const statsRes = await fetch(`${API_BASE}/api/user/stats`, {
    headers: { Authorization: `Bearer ${TEST_USER_ID}` },
  });
  if (!statsRes.ok) throw new Error(`/api/user/stats HTTP ${statsRes.status}`);
  const stats = (await statsRes.json()) as { success?: boolean };
  if (!stats.success) throw new Error('user/stats 失败');
  console.log('[ok] /api/user/stats 正常');
}

async function main() {
  console.log('DB_ADAPTER=', process.env.DB_ADAPTER);
  console.log('auth.enabled=', getAuthConfig().enabled);

  await verifyDatabase();
  await verifyAuthResolution();
  await verifyHttpFlow();

  console.log('\n全部验证通过。可在 TCB 控制台 users 集合查看文档:', TEST_USER_ID);
}

main().catch((error) => {
  console.error('[verify-cloudbase-flow]', error instanceof Error ? error.message : error);
  process.exit(1);
});
