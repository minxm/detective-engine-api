import { getKv } from '../kv/index.js';
import type { GenerationJob, UserRole } from '../types/index.js';
import { buildPaginatedResult } from '../utils/pagination.js';
import { getDatabase } from '../db/index.js';

const JOB_PREFIX = 'job:';
const ONLINE_REGISTRY_KEY = 'online:registry';
const ONLINE_TTL = 120;

export type OnlineUserEntry = {
  userId: string;
  nickname?: string;
  role: UserRole;
  lastSeen: number;
};

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

async function readRegistry(): Promise<string[]> {
  const kv = getKv();
  const raw = await kv.get(ONLINE_REGISTRY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function writeRegistry(ids: string[]): Promise<void> {
  const kv = getKv();
  await kv.put(ONLINE_REGISTRY_KEY, JSON.stringify(ids), ONLINE_TTL * 3);
}

export async function heartbeatOnline(
  userId: string,
  meta?: { nickname?: string; role?: UserRole }
): Promise<void> {
  const kv = getKv();
  const entry: OnlineUserEntry = {
    userId,
    nickname: meta?.nickname,
    role: meta?.role ?? 'user',
    lastSeen: Date.now(),
  };
  await kv.put(`online:user:${userId}`, JSON.stringify(entry), ONLINE_TTL);

  const registry = await readRegistry();
  if (!registry.includes(userId)) {
    registry.push(userId);
    await writeRegistry(registry);
  }
}

export async function getOnlineUserEstimate(): Promise<number> {
  const { total } = await listOnlineUsers(1, 1);
  return total;
}

export async function listOnlineUsers(page: number, limit: number) {
  const registry = await readRegistry();
  const kv = getKv();
  const active: OnlineUserEntry[] = [];

  for (const userId of registry) {
    const raw = await kv.get(`online:user:${userId}`);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Partial<OnlineUserEntry> & { userId: string };
      active.push({
        userId: parsed.userId,
        nickname: parsed.nickname,
        role: parsed.role ?? 'user',
        lastSeen: parsed.lastSeen ?? 0,
      });
    } catch {
      /* skip malformed */
    }
  }

  const db = getDatabase();
  await Promise.all(
    active.map(async (entry) => {
      const record = await db.users.findById(entry.userId);
      if (record?.role) entry.role = record.role;
    })
  );

  active.sort((a, b) => b.lastSeen - a.lastSeen);
  const activeIds = new Set(active.map((u) => u.userId));
  if (activeIds.size !== registry.length) {
    await writeRegistry([...activeIds]);
  }

  const total = active.length;
  const skip = (page - 1) * limit;
  return buildPaginatedResult(active.slice(skip, skip + limit), total, page, limit);
}
