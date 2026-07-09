import type { CloudContext } from '../../src/router/index.js';
import { getScoreRating, jsonResponse } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { evaluateDeduction } from '../../src/ai/index.js';
import { updateLeaderboard } from '../../src/services/case-service.js';
import { recordCaseHistoryComplete, findCaseHistory } from '../../src/services/history-service.js';
import { completeCaseSession } from '../../src/services/session-service.js';
import { isTransientNetworkError, withRetry } from '../../src/utils/retry.js';
import type { CaseData } from '../../src/types/index.js';

export async function handleScore(ctx: CloudContext): Promise<Response> {
  const body = (ctx.body ?? {}) as {
    caseData?: CaseData;
    userDeduction?: string;
    displayName?: string;
    progress?: {
      discoveredEvidence?: string[];
      interrogatedSuspects?: string[];
      notes?: string;
      startTime?: number;
      flowStep?: string;
    };
  };

  if (!body.caseData || !body.userDeduction?.trim()) {
    return jsonResponse({ success: false, error: '缺少评分参数' }, 400);
  }

  try {
    const authUser = await withRetry(() => resolveAuthUser(ctx.headers), { retries: 2, delayMs: 400 });
    const userId = authUser?.userId;

    const evaluation = await withRetry(
      () =>
        evaluateDeduction(
          body.caseData!,
          body.userDeduction!,
          userId,
        ),
      { retries: 3, delayMs: 600 },
    );
    evaluation.rating = evaluation.rating || getScoreRating(evaluation.score);

    if (userId) {
      const alreadyCompleted = (await findCaseHistory(userId, body.caseData!.id))?.status === 'completed';

      await withRetry(
        () =>
          recordCaseHistoryComplete({
            userId,
            caseId: body.caseData!.id,
            caseTitle: body.caseData!.title,
            score: evaluation.score,
            rating: evaluation.rating,
            killerCorrect: evaluation.killerCorrect ?? null,
          }),
        { retries: 3, delayMs: 500 },
      );

      if (!alreadyCompleted) {
        await withRetry(
          () =>
            updateLeaderboard(
              userId,
              body.displayName ?? authUser?.nickname ?? `侦探${userId.slice(-4)}`,
              evaluation.score,
            ),
          { retries: 3, delayMs: 500 },
        );
      }

      await withRetry(
        () =>
          completeCaseSession({
            userId,
            caseId: body.caseData!.id,
            score: evaluation.score,
            progress: {
              discoveredEvidence: body.progress?.discoveredEvidence ?? [],
              interrogatedSuspects: body.progress?.interrogatedSuspects ?? [],
              notes: body.progress?.notes ?? '',
              startTime: body.progress?.startTime ?? Date.now(),
              flowStep: 'closed',
            },
          }),
        { retries: 3, delayMs: 500 },
      );
    }

    return jsonResponse({ success: true, evaluation });
  } catch (error) {
    const message = (error as Error).message || '评分失败，请稍后重试';
    console.error('[score] failed:', message);
    const status = isTransientNetworkError(error) ? 503 : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
}
