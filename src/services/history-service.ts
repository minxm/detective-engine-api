import { generateId, now } from '../utils/index.js';
import { withRetry } from '../utils/retry.js';
import { getDatabase } from '../db/index.js';
import type { HistoryRecord } from '../types/index.js';

export async function findCaseHistory(userId: string, caseId: string): Promise<HistoryRecord | null> {
  const db = getDatabase();
  return db.history.findByUserAndCase(userId, caseId);
}

/** 开始案件时写入/更新进行中记录 */
export async function recordCaseHistoryStart(params: {
  userId: string;
  caseId: string;
  caseTitle: string;
}): Promise<void> {
  const db = getDatabase();
  const existing = await findCaseHistory(params.userId, params.caseId);
  const timestamp = now();
  await db.history.upsert({
    _id: existing?._id ?? generateId(),
    userId: params.userId,
    caseId: params.caseId,
    caseTitle: params.caseTitle,
    score: existing?.score ?? null,
    rating: existing?.rating ?? '进行中',
    killerCorrect: existing?.killerCorrect ?? null,
    status: 'in_progress',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

/** 结案时更新历史记录 */
export async function recordCaseHistoryComplete(params: {
  userId: string;
  caseId: string;
  caseTitle: string;
  score: number;
  rating: string;
  killerCorrect: boolean | null;
}): Promise<void> {
  const db = getDatabase();
  const existing = await findCaseHistory(params.userId, params.caseId);
  const timestamp = now();
  await withRetry(
    () =>
      db.history.upsert({
        _id: existing?._id ?? generateId(),
        userId: params.userId,
        caseId: params.caseId,
        caseTitle: params.caseTitle,
        score: params.score,
        rating: params.rating,
        killerCorrect: params.killerCorrect,
        status: 'completed',
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }),
    { retries: 3, delayMs: 500 },
  );
}
