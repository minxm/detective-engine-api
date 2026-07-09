import { getDatabase } from '../db/index.js';
import type { GenerationJob, UserRole } from '../types/index.js';

const ONLINE_TTL_MS = 120_000;

export type OnlineUserEntry = {
  userId: string;
  nickname?: string;
  role: UserRole;
  lastSeen: number;
};

export async function cacheJob(job: GenerationJob): Promise<void> {
  await getDatabase().generationJobs.upsert(job);
}

export async function getCachedJob(jobId: string): Promise<GenerationJob | null> {
  return getDatabase().generationJobs.findById(jobId);
}

export async function heartbeatOnline(
  userId: string,
  meta?: { nickname?: string; role?: UserRole },
): Promise<void> {
  await getDatabase().onlinePresence.upsert({
    _id: userId,
    userId,
    nickname: meta?.nickname,
    role: meta?.role ?? 'user',
    lastSeen: Date.now(),
  });
}

export async function getOnlineUserEstimate(): Promise<number> {
  const { total } = await listOnlineUsers(1, 1);
  return total;
}

export async function listOnlineUsers(page: number, limit: number) {
  const sinceMs = Date.now() - ONLINE_TTL_MS;
  const result = await getDatabase().onlinePresence.listActive(sinceMs, page, limit);
  const db = getDatabase();

  const items: OnlineUserEntry[] = await Promise.all(
    result.items.map(async (entry) => {
      const record = await db.users.findById(entry.userId);
      return {
        userId: entry.userId,
        nickname: entry.nickname ?? record?.nickname,
        role: record?.role ?? entry.role,
        lastSeen: entry.lastSeen,
      };
    }),
  );

  return {
    ...result,
    items,
  };
}
