import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { requireAdminUser } from '../../src/auth/admin-guard.js';
import {
  getCachedRefillJob,
  getRefillJobProgress,
  getRefillStageLabel,
  startRefillJob,
} from '../../src/services/refill-job.js';
import type { Difficulty } from '../../src/types/index.js';

export async function handleInventoryRefill(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) {
    return jsonResponse({ success: false, error: '无权限' }, 403);
  }

  const body = (ctx.body ?? {}) as { difficulty?: Difficulty; count?: number };
  const difficulty = body.difficulty ?? 'medium';
  const count = Math.min(Math.max(body.count ?? 1, 1), 3);

  const job = await startRefillJob(difficulty, count);

  return jsonResponse({
    success: true,
    refillJobId: job._id,
    status: job.status,
    stage: job.stage,
    progress: getRefillJobProgress(job),
    stageLabel: getRefillStageLabel(job.stage, job.current, job.total),
    total: job.total,
  });
}

export async function handleInventoryRefillStatus(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) {
    return jsonResponse({ success: false, error: '无权限' }, 403);
  }

  const jobId = ctx.query.jobId;
  if (!jobId) return jsonResponse({ success: false, error: '缺少 jobId' }, 400);

  const job = await getCachedRefillJob(jobId);
  if (!job) return jsonResponse({ success: false, error: '任务不存在或已过期' }, 404);

  const progress = getRefillJobProgress(job);
  const stageLabel = getRefillStageLabel(job.stage, job.current, job.total);

  return jsonResponse({
    success: job.status !== 'failed' || job.created.length > 0,
    status: job.status,
    stage: job.stage,
    progress,
    stageLabel,
    current: job.current,
    total: job.total,
    created: job.created,
    errors: job.errors.length ? job.errors : undefined,
    error: job.error,
    message: job.message,
    inventoryCounts: job.inventoryCounts,
  });
}
