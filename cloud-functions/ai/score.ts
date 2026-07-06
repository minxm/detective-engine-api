import type { CloudContext } from '../../src/router/index.js';
import { generateId, getScoreRating, jsonResponse, now } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { evaluateDeduction } from '../../src/ai/index.js';
import { getDatabase } from '../../src/db/index.js';
import { updateLeaderboard } from '../../src/services/case-service.js';
import type { CaseData } from '../../src/types/index.js';

export async function handleScore(ctx: CloudContext): Promise<Response> {
  const body = (ctx.body ?? {}) as {
    caseData?: CaseData;
    userDeduction?: string;
    displayName?: string;
  };

  if (!body.caseData || !body.userDeduction?.trim()) {
    return jsonResponse({ success: false, error: '缺少评分参数' }, 400);
  }

  const authUser = await resolveAuthUser(ctx.headers);
  const userId = authUser?.userId ?? 'guest';
  const evaluation = await evaluateDeduction(body.caseData, body.userDeduction, userId);
  evaluation.rating = evaluation.rating || getScoreRating(evaluation.score);

  const db = getDatabase();
  await db.history.upsert({
    _id: generateId(),
    userId,
    caseId: body.caseData.id,
    caseTitle: body.caseData.title,
    score: evaluation.score,
    rating: evaluation.rating,
    killerCorrect: evaluation.killerCorrect ?? null,
    status: 'completed',
    createdAt: now(),
    updatedAt: now(),
  });

  if (userId !== 'guest') {
    await updateLeaderboard(
      userId,
      body.displayName ?? authUser?.nickname ?? `侦探${userId.slice(-4)}`,
      evaluation.score
    );
  }

  return jsonResponse({ success: true, evaluation });
}
