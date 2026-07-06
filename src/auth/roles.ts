import { getDatabase } from '../db/index.js';
import type { UserRecord, UserRole } from '../types/index.js';
import { now } from '../utils/index.js';

export type { UserRole };

export function isAdminRole(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export async function isAdminUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await getDatabase().users.findById(userId);
  return isAdminRole(user?.role);
}

export async function ensureUserRecord(params: {
  userId: string;
  nickname?: string;
  avatar?: string;
}): Promise<UserRecord> {
  const db = getDatabase();
  const existing = await db.users.findById(params.userId);
  const record: UserRecord = {
    _id: params.userId,
    nickname: params.nickname ?? existing?.nickname ?? `侦探${params.userId.slice(-4)}`,
    avatar: params.avatar ?? existing?.avatar,
    role: existing?.role ?? 'user',
    score: existing?.score ?? 0,
    casesCompleted: existing?.casesCompleted,
    averageScore: existing?.averageScore,
    perfectSolves: existing?.perfectSolves,
    streak: existing?.streak,
    createdAt: existing?.createdAt ?? now(),
    updatedAt: now(),
  };
  await db.users.upsert(record);
  return record;
}
