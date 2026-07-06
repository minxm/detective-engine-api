import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { getDatabase } from '../../src/db/index.js';

export async function handleHistoryList(ctx: CloudContext): Promise<Response> {
  const authUser = await resolveAuthUser(ctx.headers);
  const userId = authUser?.userId ?? 'guest';
  const db = getDatabase();
  const entries = await db.history.listByUser(userId);

  return jsonResponse({
    success: true,
    entries: entries.map((e) => ({
      id: e._id,
      caseId: e.caseId,
      caseTitle: e.caseTitle,
      score: e.score,
      rating: e.rating,
      killerCorrect: e.killerCorrect,
      createdAt: new Date(e.createdAt).toISOString(),
      status: e.status,
    })),
  });
}
