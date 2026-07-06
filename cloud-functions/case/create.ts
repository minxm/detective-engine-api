import type { CloudContext } from '../../src/router/index.js';
import { generateId, jsonResponse, now } from '../../src/utils/index.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { getDatabase } from '../../src/db/index.js';
import { generateCaseWithAI } from '../../src/ai/index.js';
import { enrichCaseWithBlobImages } from '../../src/services/image-service.js';
import { cacheJob, getCachedJob } from '../../src/services/job-cache.js';
import {
  caseDataToInventory,
  caseDataToRecord,
  caseRecordToCaseData,
} from '../../src/services/case-service.js';
import type { Difficulty, GenerationJob } from '../../src/types/index.js';

async function persistJob(job: GenerationJob) {
  const db = getDatabase();
  await db.jobs.upsert(job);
  await cacheJob(job);
}

export async function handleCaseCreate(ctx: CloudContext): Promise<Response> {
  const body = (ctx.body ?? {}) as { difficulty?: Difficulty; phase?: string };
  const difficulty = body.difficulty ?? 'medium';
  const authUser = await resolveAuthUser(ctx.headers);
  const userId = authUser?.userId;
  const db = getDatabase();

  if (body.phase === 'start') {
    const inventory = await db.inventory.claimAvailable(difficulty, userId);
    if (inventory) {
      return jsonResponse({
        success: true,
        source: 'inventory',
        caseId: inventory.caseId,
        caseData: inventory.caseData,
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

    void runGenerationJob(jobId, difficulty, userId);

    return jsonResponse({ success: true, source: 'generating', jobId });
  }

  let caseData = await generateCaseWithAI(difficulty, userId);
  caseData = await enrichCaseWithBlobImages(caseData);
  await db.cases.create(caseDataToRecord(caseData));
  await db.inventory.add(caseDataToInventory(caseData));

  return jsonResponse({ success: true, caseId: caseData.id, caseData });
}

async function runGenerationJob(jobId: string, difficulty: Difficulty, userId?: string) {
  const db = getDatabase();
  try {
    const existing = (await getCachedJob(jobId)) ?? (await db.jobs.findById(jobId));
    await persistJob({
      ...(existing ?? { _id: jobId, difficulty, userId, createdAt: now() }),
      status: 'generating',
      stage: 'generating',
      updatedAt: now(),
    });

    let caseData = await generateCaseWithAI(difficulty, userId);
    caseData = await enrichCaseWithBlobImages(caseData);
    await db.cases.create(caseDataToRecord(caseData));
    await db.inventory.add(caseDataToInventory(caseData));

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
  } catch (error) {
    const existing = (await getCachedJob(jobId)) ?? (await db.jobs.findById(jobId));
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

  const db = getDatabase();
  const job = (await getCachedJob(jobId)) ?? (await db.jobs.findById(jobId));
  if (!job) return jsonResponse({ success: false, error: '任务不存在' }, 404);

  if (job.status === 'ready' && job.caseId) {
    const record = await db.cases.findById(job.caseId);
    return jsonResponse({
      success: true,
      status: job.status,
      stage: job.stage,
      caseId: job.caseId,
      caseData: record ? caseRecordToCaseData(record) : null,
    });
  }

  return jsonResponse({
    success: true,
    status: job.status,
    stage: job.stage,
    error: job.error,
  });
}

export async function handleCaseGet(ctx: CloudContext): Promise<Response> {
  const caseId = ctx.query.id;
  if (!caseId) return jsonResponse({ success: false, error: '缺少案件 ID' }, 400);

  const db = getDatabase();
  const record = await db.cases.findById(caseId);
  if (!record) return jsonResponse({ success: false, error: '案件不存在' }, 404);

  return jsonResponse({ success: true, caseData: caseRecordToCaseData(record) });
}
