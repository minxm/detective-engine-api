import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { requireAdminUser } from '../../src/auth/admin-guard.js';
import { getDatabase } from '../../src/db/index.js';
import { getOnlineUserEstimate } from '../../src/services/job-cache.js';
import { withRetry } from '../../src/utils/retry.js';

export async function handleAdminDashboard(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) {
    return jsonResponse({ success: false, error: '无权限' }, 403);
  }

  const db = getDatabase();
  const [inventoryCounts, aiStats, logs, onlineUsers] = await Promise.all([
    withRetry(() => db.inventory.countByDifficulty(), { retries: 2, delayMs: 400 }),
    withRetry(() => db.aiLogs.stats(), { retries: 2, delayMs: 400 }),
    withRetry(() => db.aiLogs.list(20), { retries: 2, delayMs: 400 }),
    getOnlineUserEstimate(),
  ]);

  const leaderboardSize = await withRetry(() => db.leaderboard.list(), { retries: 2, delayMs: 400 }).then(
    (list) => list.length,
  );

  return jsonResponse({
    success: true,
    dashboard: {
      onlineUsers: onlineUsers,
      inventoryCounts,
      aiStats,
      recentLogs: logs,
      leaderboardSize,
      kvAdapter: process.env.KV_ADAPTER ?? 'memory',
      blobAdapter: process.env.BLOB_ADAPTER ?? 'local',
      dbAdapter: process.env.DB_ADAPTER ?? 'memory',
    },
  });
}
