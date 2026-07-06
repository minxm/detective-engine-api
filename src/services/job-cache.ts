import { getKv } from '../kv/index.js';
import type { GenerationJob } from '../types/index.js';

const JOB_PREFIX = 'job:';
const ONLINE_SET_KEY = 'online:users';
const ONLINE_TTL = 120;

export async function cacheJob(job: GenerationJob): Promise<void> {
  const kv = getKv();
  await kv.put(`${JOB_PREFIX}${job._id}`, JSON.stringify(job), 3600);
}

export async function getCachedJob(jobId: string): Promise<GenerationJob | null> {
  const kv = getKv();
  const raw = await kv.get(`${JOB_PREFIX}${jobId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GenerationJob;
  } catch {
    return null;
  }
}

export async function touchOnlineUser(userId: string): Promise<number> {
  const kv = getKv();
  await kv.put(`online:user:${userId}`, String(Date.now()), ONLINE_TTL);
  return kv.increment(ONLINE_SET_KEY, 0);
}

export async function getOnlineUserEstimate(): Promise<number> {
  const kv = getKv();
  const count = await kv.get(ONLINE_SET_KEY);
  return Number(count ?? 0);
}

export async function heartbeatOnline(userId: string): Promise<void> {
  const kv = getKv();
  const key = `online:user:${userId}`;
  const existed = await kv.get(key);
  await kv.put(key, String(Date.now()), ONLINE_TTL);
  if (!existed) await kv.increment('online:users', 1);
}
