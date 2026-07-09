import type { CloudContext } from '../../src/router/index.js';
import { generateId, jsonResponse, now } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { requireAuthUserId } from '../../src/auth/user-guard.js';
import { getDatabase } from '../../src/db/index.js';
import { generateAndPersistCase } from '../../src/services/case-generation.js';
import { cacheJob, getCachedJob } from '../../src/services/job-cache.js';
import { getJobProgress } from '../../src/services/job-progress.js';
import { caseRecordToCaseData } from '../../src/services/case-service.js';
import { recordCaseClaim } from '../../src/services/claim-service.js';
import { pickInventoryForUser } from '../../src/services/inventory-pick.js';
import type { Difficulty, GenerationJob } from '../../src/types/index.js';
import { recordCaseHistoryStart } from '../../src/services/history-service.js';
import { startCaseSession } from '../../src/services/session-service.js';

async function persistJob(job: GenerationJob) {
  await cacheJob(job);
}

export async function handleCaseCreate(ctx: CloudContext): Promise<Response> {
  const body = (ctx.body ?? {}) as { difficulty?: Difficulty; phase?: string };
  const difficulty = body.difficulty ?? 'medium';
  const authUser = await resolveAuthUser(ctx.headers);
  const userId = requireAuthUserId(authUser?.userId);
  const db = getDatabase();

  if (body.phase === 'start') {
    // 跳过该用户已领取过的库存案件；全部领完则走现场 AI 生成
    const inventory = await pickInventoryForUser(difficulty, authUser?.userId);
    if (inventory) {
      await recordCaseClaim(authUser, inventory);
      if (userId) {
        void recordCaseHistoryStart({
          userId,
          caseId: inventory.caseId,
          caseTitle: inventory.caseData.title,
        }).catch((err) => {
          console.warn('[Case] 历史记录写入失败，不影响开案:', (err as Error).message);
        });
        void startCaseSession(userId, inventory.caseId).catch((err) => {
          console.warn('[Case] 会话写入失败，不影响开案:', (err as Error).message);
        });
      }

      const record = await db.cases.findById(inventory.caseId);
      const caseData = record ? caseRecordToCaseData(record) : inventory.caseData;

      return jsonResponse({
        success: true,
        source: 'inventory',
        caseId: inventory.caseId,
        caseData,
      });
    }

    const jobId = generateId();
    await persistJob({
      _id: jobId,
      status: 'pending',
      stage: 'pending',
      difficulty,
      userId,
      createdAt: now(),
      updatedAt: now(),
    });

    void runGenerationJob(jobId, difficulty, authUser);

    return jsonResponse({ success: true, source: 'generating', jobId });
  }

  const { caseData, inventory } = await generateAndPersistCase(difficulty, userId);
  await recordCaseClaim(authUser, inventory);
  if (userId) {
    await recordCaseHistoryStart({ userId, caseId: caseData.id, caseTitle: caseData.title });
    void startCaseSession(userId, caseData.id).catch((err) => {
      console.warn('[Case] 会话写入失败:', (err as Error).message);
    });
  }

  return jsonResponse({ success: true, caseId: caseData.id, caseData });
}

async function runGenerationJob(
  jobId: string,
  difficulty: Difficulty,
  authUser: { userId: string; nickname?: string } | null,
) {
  const userId = requireAuthUserId(authUser?.userId);
  try {
    const existing = await getCachedJob(jobId);

    const { caseData, inventory } = await generateAndPersistCase(difficulty, userId, async (stage) => {
      const jobStage = stage === 'persisting' ? 'images' : stage;
      await persistJob({
        ...(await getCachedJob(jobId)) ?? existing ?? { _id: jobId, difficulty, userId, createdAt: now() },
        status: 'generating',
        stage: jobStage,
        updatedAt: now(),
      });
    });

    await recordCaseClaim(authUser, inventory);

    await persistJob({
      _id: jobId,
      status: 'ready',
      stage: 'ready',
      difficulty,
      userId,
      caseId: caseData.id,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    });

    if (userId) {
      await recordCaseHistoryStart({ userId, caseId: caseData.id, caseTitle: caseData.title });
      void startCaseSession(userId, caseData.id).catch((err) => {
        console.warn('[Case] 会话写入失败:', (err as Error).message);
      });
    }
  } catch (error) {
    const existing = await getCachedJob(jobId);
    await persistJob({
      _id: jobId,
      status: 'failed',
      stage: 'failed',
      difficulty,
      userId,
      error: (error as Error).message,
      createdAt: existing?.createdAt ?? now(),
      updatedAt: now(),
    });
  }
}

export async function handleCaseStatus(ctx: CloudContext): Promise<Response> {
  const jobId = ctx.query.jobId;
  if (!jobId) return jsonResponse({ success: false, error: '缺少 jobId' }, 400);

  try {
    const authUser = await resolveAuthUser(ctx.headers);
    const userId = requireAuthUserId(authUser?.userId);
    const db = getDatabase();
    const job = await getCachedJob(jobId);
    if (!job) return jsonResponse({ success: false, error: '任务不存在' }, 404);

    const progress = getJobProgress(job);
    const payload: Record<string, unknown> = {
      success: true,
      status: job.status,
      stage: job.stage,
      progress,
      error: job.error,
    };

    if (job.status === 'ready' && job.caseId) {
      payload.caseId = job.caseId;
      try {
        const record = await db.cases.findById(job.caseId);
        payload.caseData = record ? caseRecordToCaseData(record) : null;
        if (userId && record) {
          void recordCaseHistoryStart({
            userId,
            caseId: job.caseId,
            caseTitle: record.title,
          }).catch((err) => {
            console.warn('[Case] 历史记录写入失败:', (err as Error).message);
          });
          void startCaseSession(userId, job.caseId).catch((err) => {
            console.warn('[Case] 会话写入失败:', (err as Error).message);
          });
        }
      } catch (parseErr) {
        console.error('[case/status] caseRecordToCaseData failed:', parseErr);
        payload.caseData = null;
        payload.caseParseError = (parseErr as Error).message;
      }
    }

    return jsonResponse(payload);
  } catch (error) {
    console.error('[case/status] failed:', error);
    return jsonResponse(
      { success: false, error: (error as Error).message || '查询生成状态失败' },
      500,
    );
  }
}

export async function handleCaseGet(ctx: CloudContext): Promise<Response> {
  const caseId = ctx.query.id;
  if (!caseId) return jsonResponse({ success: false, error: '缺少案件 ID' }, 400);

  const db = getDatabase();
  const record = await db.cases.findById(caseId);
  if (!record) return jsonResponse({ success: false, error: '案件不存在' }, 404);

  return jsonResponse({ success: true, caseData: caseRecordToCaseData(record) });
}
