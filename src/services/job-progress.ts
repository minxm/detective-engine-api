import type { GenerationJob } from '../types/index.js';

const STAGE_PROGRESS: Record<string, number> = {
  pending: 8,
  generating: 38,
  images: 72,
  ready: 100,
  failed: 0,
};

export function getJobProgress(job: Pick<GenerationJob, 'status' | 'stage'>): number {
  if (job.status === 'ready') return 100;
  if (job.status === 'failed') return STAGE_PROGRESS.failed;
  return STAGE_PROGRESS[job.stage] ?? STAGE_PROGRESS.pending;
}
