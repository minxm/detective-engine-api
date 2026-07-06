import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse, verifyAdminSecret } from '../../src/utils/index.js';
import { isAdminRole } from '../../src/auth/roles.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { getDatabase } from '../../src/db/index.js';
import { getOnlineUserEstimate } from '../../src/services/job-cache.js';

export async function handleAdminDashboard(ctx: CloudContext): Promise<Response> {
  const authUser = await resolveAuthUser(ctx.headers);
  if (!isAdminRole(authUser?.role) && !verifyAdminSecret(ctx.headers)) {
    return jsonResponse({ success: false, error: '无权限' }, 403);
  }

  const db = getDatabase();
  const [inventoryCounts, aiStats, logs, users, onlineUsers] = await Promise.all([
    db.inventory.countByDifficulty(),
    db.aiLogs.stats(),
    db.aiLogs.list(20),
    db.users.list(100),
    getOnlineUserEstimate(),
  ]);

  return jsonResponse({
    success: true,
    dashboard: {
      onlineUsers: onlineUsers || users.length,
      inventoryCounts,
      aiStats,
      recentLogs: logs,
      leaderboardSize: (await db.leaderboard.list()).length,
      kvAdapter: process.env.KV_ADAPTER ?? 'memory',
      blobAdapter: process.env.BLOB_ADAPTER ?? 'local',
      dbAdapter: process.env.DB_ADAPTER ?? 'memory',
    },
  });
}
