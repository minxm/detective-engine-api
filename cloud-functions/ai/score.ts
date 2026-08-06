import type { CloudContext } from '../../src/router/index.js';
import { getScoreRating, jsonResponse } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { evaluateDeduction } from '../../src/ai/index.js';
import { caseRecordToCaseData, updateLeaderboard } from '../../src/services/case-service.js';
import { recordCaseHistoryComplete, findCaseHistory } from '../../src/services/history-service.js';
import { completeCaseSession } from '../../src/services/session-service.js';
import { getDatabase } from '../../src/db/index.js';
import { isTransientNetworkError, withRetry } from '../../src/utils/retry.js';
import type { CaseData } from '../../src/types/index.js';

/** 结案评分只需真相/评分标准等字段，去掉图片 URL 减轻网关超时风险 */
function slimCaseDataForScore(caseData: CaseData): CaseData {
  return {
    ...caseData,
    sceneImageUrl: undefined,
    victim: caseData.victim
      ? { ...caseData.victim, imageUrl: undefined }
      : caseData.victim,
    suspects: (caseData.suspects ?? []).map((s) => ({ ...s, imageUrl: undefined })),
    evidence: (caseData.evidence ?? []).map((e) => ({ ...e, imageUrl: undefined })),
  };
}

export async function handleScore(ctx: CloudContext): Promise<Response> {
  const body = (ctx.body ?? {}) as {
    caseId?: string;
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

  if (!body.userDeduction?.trim()) {
    return jsonResponse({ success: false, error: '缺少推理内容，请先填写结案推理' }, 400);
  }

  try {
    const authUser = await withRetry(() => resolveAuthUser(ctx.headers), { retries: 2, delayMs: 400 });
    const userId = authUser?.userId;

    let caseData = body.caseData ? slimCaseDataForScore(body.caseData) : null;
    const caseId = body.caseId?.trim() || caseData?.id;
    if (!caseData && caseId) {
      const record = await getDatabase().cases.findById(caseId);
      if (!record) {
        return jsonResponse({ success: false, error: '案件不存在' }, 404);
      }
      caseData = slimCaseDataForScore(caseRecordToCaseData(record));
    }
    if (!caseData) {
      return jsonResponse({ success: false, error: '缺少案件数据，请刷新后重试' }, 400);
    }

    // 评分 AI 本身已有重试；外层不再套重试，避免网关超时（移动端尤甚）
    const evaluation = await evaluateDeduction(caseData, body.userDeduction, userId);
    evaluation.rating = evaluation.rating || getScoreRating(evaluation.score);

    if (userId) {
      const alreadyCompleted = (await findCaseHistory(userId, caseData.id))?.status === 'completed';

      await withRetry(
        () =>
          recordCaseHistoryComplete({
            userId,
            caseId: caseData!.id,
            caseTitle: caseData!.title,
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
            caseId: caseData!.id,
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
