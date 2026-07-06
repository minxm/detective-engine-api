import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { getDatabase } from '../../src/db/index.js';

export async function handleRankList(_ctx: CloudContext): Promise<Response> {
  const db = getDatabase();
  const entries = await db.leaderboard.list(50);

  return jsonResponse({
    success: true,
    entries: entries.map((e, index) => ({
      rank: index + 1,
      userId: e.userId,
      displayName: e.displayName,
      avatarUrl: e.avatarUrl,
      avgScore: e.avgScore,
      casesCompleted: e.casesCompleted,
      perfectSolves: e.perfectSolves,
      totalScore: e.totalScore,
    })),
  });
}
