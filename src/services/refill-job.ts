import { getKv } from '../kv/index.js';
import { generateId, now } from '../utils/index.js';
import { getDatabase } from '../db/index.js';
import { generateAndPersistCase } from './case-generation.js';
import type { Difficulty, RefillJob, RefillJobStage } from '../types/index.js';

const REFILL_PREFIX = 'refill:';

const CASE_STAGE_RATIO: Record<RefillJobStage, number> = {
  pending: 0,
  generating: 0.3,
  images: 0.65,
  persisting: 0.9,
  ready: 1,
  failed: 0,
};

export function getRefillJobProgress(job: Pick<RefillJob, 'status' | 'stage' | 'total' | 'created' | 'current'>): number {
  if (job.status === 'ready') return 100;
  if (job.total <= 0) return 0;
  const done = job.created.length;
  const activeRatio = job.status === 'running' ? (CASE_STAGE_RATIO[job.stage] ?? 0) : 0;
  const currentSlot = job.status === 'running' ? job.current + activeRatio : done;
  return Math.min(100, Math.round((currentSlot / job.total) * 100));
}

export function getRefillStageLabel(stage: RefillJobStage, current: number, total: number): string {
  const prefix = total > 1 ? `第 ${current + 1}/${total} 条 · ` : '';
  switch (stage) {
    case 'generating':
      return `${prefix}AI 生成案件文案…`;
    case 'images':
      return `${prefix}生成场景与角色配图…`;
    case 'persisting':
      return `${prefix}校验完成，写入库存…`;
    case 'ready':
      return '预生成完成';
    case 'failed':
      return '预生成失败';
    default:
      return `${prefix}准备生成…`;
  }
}

async function cacheRefillJob(job: RefillJob): Promise<void> {
  const kv = getKv();
  await kv.put(`${REFILL_PREFIX}${job._id}`, JSON.stringify(job), 3600);
}

export async function getCachedRefillJob(jobId: string): Promise<RefillJob | null> {
  const kv = getKv();
  const raw = await kv.get(`${REFILL_PREFIX}${jobId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RefillJob;
  } catch {
    return null;
  }
}

async function patchRefillJob(jobId: string, patch: Partial<RefillJob>): Promise<RefillJob | null> {
  const existing = await getCachedRefillJob(jobId);
  if (!existing) return null;
  const next: RefillJob = { ...existing, ...patch, updatedAt: now() };
  await cacheRefillJob(next);
  return next;
}

export async function startRefillJob(difficulty: Difficulty, count: number): Promise<RefillJob> {
  const job: RefillJob = {
    _id: generateId(),
    status: 'pending',
    stage: 'pending',
    difficulty,
    total: count,
    current: 0,
    created: [],
    errors: [],
    createdAt: now(),
    updatedAt: now(),
  };
  await cacheRefillJob(job);
  void runRefillJob(job._id, difficulty, count);
  return job;
}

async function runRefillJob(jobId: string, difficulty: Difficulty, count: number) {
  const db = getDatabase();

  for (let i = 0; i < count; i++) {
    await patchRefillJob(jobId, {
      status: 'running',
      stage: 'generating',
      current: i,
    });

    try {
      const caseData = await generateAndPersistCase(
        difficulty,
        undefined,
        async (stage) => {
          await patchRefillJob(jobId, { stage, current: i });
        }
      );

      const job = await getCachedRefillJob(jobId);
      if (!job) return;
      await patchRefillJob(jobId, {
        created: [...job.created, caseData.caseData.id],
      });
    } catch (err) {
      const message = (err as Error).message || '生成失败';
      console.error('[Admin] 预生成案件失败:', message);
      const job = await getCachedRefillJob(jobId);
      if (!job) return;
      await patchRefillJob(jobId, {
        errors: [...job.errors, message],
      });
    }
  }

  const job = await getCachedRefillJob(jobId);
  if (!job) return;

  let inventoryCounts: Record<string, number> | undefined;
  try {
    inventoryCounts = await db.inventory.countByDifficulty();
  } catch (err) {
    console.warn('[Admin] 库存统计读取失败，不影响已入库案件:', (err as Error).message);
  }
  const allFailed = job.created.length === 0;
  const message = allFailed
    ? job.errors[0] ?? '预生成失败，案件未入库。请检查 AI / 生图配置后重试。'
    : job.errors.length > 0
      ? `成功 ${job.created.length} 条，失败 ${job.errors.length} 条（失败案件未入库）`
      : `已成功预生成 ${job.created.length} 条案件`;

  await patchRefillJob(jobId, {
    status: allFailed ? 'failed' : 'ready',
    stage: allFailed ? 'failed' : 'ready',
    error: allFailed ? message : undefined,
    message,
    inventoryCounts,
  });
}
