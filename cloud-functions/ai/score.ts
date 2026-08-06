import type { CloudContext } from '../../src/router/index.js';
import { generateId, getScoreRating, jsonResponse, now } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { evaluateDeduction } from '../../src/ai/index.js';
import { caseRecordToCaseData, updateLeaderboard } from '../../src/services/case-service.js';
import { recordCaseHistoryComplete, findCaseHistory } from '../../src/services/history-service.js';
import { completeCaseSession } from '../../src/services/session-service.js';
import { getDatabase } from '../../src/db/index.js';
import { isTransientNetworkError, withRetry } from '../../src/utils/retry.js';
import type { CaseData, ScoreJob } from '../../src/types/index.js';

type ScoreProgress = {
  discoveredEvidence?: string[];
  interrogatedSuspects?: string[];
  notes?: string;
  startTime?: number;
  flowStep?: string;
};

/** 结案评分只需真相/评分标准等字段，去掉图片 URL 减轻请求体 */
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

async function persistScoreJob(job: ScoreJob) {
  await getDatabase().scoreJobs.upsert(job);
}

async function patchScoreJob(jobId: string, patch: Partial<ScoreJob>) {
  const existing = await getDatabase().scoreJobs.findById(jobId);
  if (!existing) return;
  await persistScoreJob({ ...existing, ...patch, updatedAt: now() });
}

async function finalizeScoreSideEffects(params: {
  userId?: string;
  caseData: CaseData;
  evaluation: import('../../src/types/index.js').CaseEvaluation;
  displayName?: string;
  nickname?: string;
  progress?: ScoreProgress;
}) {
  const { userId, caseData, evaluation, displayName, nickname, progress } = params;
  if (!userId) return;

  const alreadyCompleted = (await findCaseHistory(userId, caseData.id))?.status === 'completed';

  await withRetry(
    () =>
      recordCaseHistoryComplete({
        userId,
        caseId: caseData.id,
        caseTitle: caseData.title,
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
          displayName ?? nickname ?? `侦探${userId.slice(-4)}`,
          evaluation.score,
        ),
      { retries: 3, delayMs: 500 },
    );
  }

  await withRetry(
    () =>
      completeCaseSession({
        userId,
        caseId: caseData.id,
        score: evaluation.score,
        progress: {
          discoveredEvidence: progress?.discoveredEvidence ?? [],
          interrogatedSuspects: progress?.interrogatedSuspects ?? [],
          notes: progress?.notes ?? '',
          startTime: progress?.startTime ?? Date.now(),
          flowStep: 'closed',
        },
      }),
    { retries: 3, delayMs: 500 },
  );
}

async function runScoreJob(params: {
  jobId: string;
  caseData: CaseData;
  userDeduction: string;
  userId?: string;
  displayName?: string;
  nickname?: string;
  progress?: ScoreProgress;
}) {
  const { jobId, caseData, userDeduction, userId, displayName, nickname, progress } = params;
  try {
    await patchScoreJob(jobId, { status: 'running' });
    const evaluation = await evaluateDeduction(caseData, userDeduction, userId);
    evaluation.rating = evaluation.rating || getScoreRating(evaluation.score);
    await finalizeScoreSideEffects({
      userId,
      caseData,
      evaluation,
      displayName,
      nickname,
      progress,
    });
    await patchScoreJob(jobId, { status: 'ready', evaluation, error: undefined });
  } catch (error) {
    const message = (error as Error).message || '评分失败，请稍后重试';
    console.error('[score] job failed:', jobId, message);
    await patchScoreJob(jobId, { status: 'failed', error: message });
  }
}

/** POST /api/score — 立即返回 jobId，后台用配置模型评分（避免网关超时） */
export async function handleScore(ctx: CloudContext): Promise<Response> {
  const body = (ctx.body ?? {}) as {
    caseId?: string;
    caseData?: CaseData;
    userDeduction?: string;
    displayName?: string;
    progress?: ScoreProgress;
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

    const jobId = generateId();
    const createdAt = now();
    await persistScoreJob({
      _id: jobId,
      status: 'pending',
      userId,
      caseId: caseData.id,
      createdAt,
      updatedAt: createdAt,
    });

    void runScoreJob({
      jobId,
      caseData,
      userDeduction: body.userDeduction,
      userId,
      displayName: body.displayName,
      nickname: authUser?.nickname,
      progress: body.progress,
    });

    return jsonResponse({ success: true, status: 'pending', jobId });
  } catch (error) {
    const message = (error as Error).message || '评分失败，请稍后重试';
    console.error('[score] failed:', message);
    const status = isTransientNetworkError(error) ? 503 : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
}

/** GET /api/score/status?jobId= */
export async function handleScoreStatus(ctx: CloudContext): Promise<Response> {
  const jobId = ctx.query.jobId?.trim();
  if (!jobId) {
    return jsonResponse({ success: false, error: '缺少 jobId' }, 400);
  }

  try {
    const job = await getDatabase().scoreJobs.findById(jobId);
    if (!job) {
      return jsonResponse({ success: false, error: '评分任务不存在' }, 404);
    }

    return jsonResponse({
      success: true,
      status: job.status,
      jobId: job._id,
      caseId: job.caseId,
      evaluation: job.evaluation ?? null,
      error: job.error,
    });
  } catch (error) {
    const message = (error as Error).message || '查询评分状态失败';
    console.error('[score/status] failed:', message);
    const status = isTransientNetworkError(error) ? 503 : 500;
    return jsonResponse({ success: false, error: message }, status);
  }
}
