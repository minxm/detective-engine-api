import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { getDatabase } from '../../src/db/index.js';

export async function handleUserStats(ctx: CloudContext): Promise<Response> {
  const user = await resolveAuthUser(ctx.headers);
  const userId = user?.userId ?? 'guest';
  const db = getDatabase();
  const history = await db.history.listByUser(userId, 200);
  const completed = history.filter((h) => h.status === 'completed');
  const scores = completed.map((h) => h.score ?? 0);
  const averageScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const perfectSolves = completed.filter((h) => (h.score ?? 0) >= 95).length;

  return jsonResponse({
    success: true,
    stats: {
      casesCompleted: completed.length,
      averageScore: Math.round(averageScore),
      perfectSolves,
      streak: 0,
      achievements: [],
    },
  });
}

export async function handleUserProfile(ctx: CloudContext): Promise<Response> {
  const { handleAuthProfile } = await import('./config.js');
  return handleAuthProfile(ctx);
}
