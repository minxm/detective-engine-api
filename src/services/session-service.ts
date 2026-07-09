import { generateId, now } from '../utils/index.js';
import { withRetry } from '../utils/retry.js';
import { getDatabase } from '../db/index.js';
import type { SessionRecord } from '../types/index.js';

export type SessionProgressPatch = NonNullable<SessionRecord['progress']>;

export async function startCaseSession(userId: string, caseId: string): Promise<void> {
  const ts = now();
  await upsertCaseSession(userId, caseId, {
    progress: {
      discoveredEvidence: [],
      interrogatedSuspects: [],
      notes: '',
      startTime: ts,
      flowStep: 'open',
    },
    messages: [],
  });
}

export async function syncCaseSession(params: {
  userId: string;
  caseId: string;
  progress?: Partial<SessionProgressPatch>;
  messages?: SessionRecord['messages'];
}): Promise<void> {
  await upsertCaseSession(params.userId, params.caseId, {
    progress: params.progress,
    messages: params.messages,
  });
}

export async function appendInterrogationMessages(params: {
  userId: string;
  caseId: string;
  suspectId: string;
  turns: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: number }>;
}): Promise<void> {
  const db = getDatabase();
  const existing = await withRetry(
    () => db.sessions.findByUserAndCase(params.userId, params.caseId),
    { retries: 2, delayMs: 400 },
  );
  const ts = now();
  const appended = params.turns
    .filter((t) => t.content.trim())
    .map((t) => ({
      suspectId: params.suspectId,
      role: t.role,
      content: t.content,
      timestamp: t.timestamp ?? ts,
    }));
  const messages = [...(existing?.messages ?? []), ...appended];
  const interrogatedSuspects = [
    ...new Set([...(existing?.progress?.interrogatedSuspects ?? []), params.suspectId]),
  ];
  await upsertCaseSession(params.userId, params.caseId, {
    messages,
    progress: {
      ...existing?.progress,
      interrogatedSuspects,
      flowStep: existing?.progress?.flowStep ?? 'interrogate',
    },
  });
}

export async function completeCaseSession(params: {
  userId: string;
  caseId: string;
  score: number;
  progress?: Partial<SessionProgressPatch>;
}): Promise<void> {
  const ts = now();
  await upsertCaseSession(params.userId, params.caseId, {
    progress: {
      ...params.progress,
      score: params.score,
      endTime: ts,
      flowStep: 'closed',
    },
  });
}

async function upsertCaseSession(
  userId: string,
  caseId: string,
  patch: {
    progress?: Partial<SessionProgressPatch>;
    messages?: SessionRecord['messages'];
  },
): Promise<void> {
  const db = getDatabase();
  const existing = await withRetry(
    () => db.sessions.findByUserAndCase(userId, caseId),
    { retries: 2, delayMs: 400 },
  );
  const ts = now();
  const baseProgress: SessionProgressPatch = {
    discoveredEvidence: [],
    interrogatedSuspects: [],
    notes: '',
    startTime: existing?.progress?.startTime ?? ts,
    flowStep: 'open',
    ...existing?.progress,
    ...patch.progress,
  };

  await withRetry(
    () =>
      db.sessions.upsert({
        _id: existing?._id ?? generateId(),
        userId,
        caseId,
        messages: patch.messages ?? existing?.messages ?? [],
        progress: baseProgress,
        createdAt: existing?.createdAt ?? ts,
        updatedAt: ts,
      }),
    { retries: 3, delayMs: 500 },
  );
}
