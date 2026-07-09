import type { Db } from '@cloudbase/database';
import type { DatabaseAdapter, AiLogsListQuery, HistoryListQuery, InventoryListQuery, LoginAuditsListQuery } from './interface.js';
import { getCloudBaseDb } from './cloudbase-client.js';
import type {
  AiLogRecord,
  CaseRecord,
  ClaimRecord,
  Difficulty,
  GenerationJob,
  HistoryRecord,
  InventoryRecord,
  LeaderboardRecord,
  SessionRecord,
  UserRecord,
  LoginAuditRecord,
} from '../types/index.js';
import {
  HISTORY_LIST_FIELD_PROJECTION,
  buildPaginatedResult,
  paginateArray,
  toHistoryListItem,
  toHistoryListItems,
} from '../services/history-list.js';

const COLLECTIONS = {
  users: 'users',
  cases: 'cases',
  sessions: 'sessions',
  history: 'history',
  leaderboard: 'leaderboard',
  inventory: 'inventory',
  aiLogs: 'ai_logs',
  claims: 'claims',
  loginAudits: 'login_audits',
  generationJobs: 'generation_jobs',
} as const;

function asDoc<T extends { _id: string }>(data: T | T[] | undefined | null): T | null {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

function stripId<T extends { _id: string }>(record: T): Omit<T, '_id'> {
  const { _id: _unused, ...rest } = record;
  return rest;
}

function stripIdFromPatch<T extends { _id?: string }>(patch: T): Omit<T, '_id'> {
  const { _id: _unused, ...rest } = patch;
  return rest;
}

type TcbTransaction = {
  collection(name: string): ReturnType<Db['collection']>;
};

export class CloudBaseDbAdapter implements DatabaseAdapter {
  private db: Db;

  constructor() {
    this.db = getCloudBaseDb();
  }

  private collection(name: string) {
    return this.db.collection(name);
  }

  private async setRecord<T extends { _id: string }>(collectionName: string, record: T): Promise<T> {
    await this.collection(collectionName).doc(record._id).set(stripId(record));
    return record;
  }

  users = {
    findById: async (id: string) => {
      const res = await this.collection(COLLECTIONS.users).doc(id).get();
      return asDoc<UserRecord>(res.data);
    },
    findByUsername: async (username: string) => {
      const lower = username.trim().toLowerCase();
      const res = await this.collection(COLLECTIONS.users)
        .where({ username: lower })
        .limit(1)
        .get();
      return asDoc<UserRecord>(res.data);
    },
    upsert: async (user: UserRecord) => {
      return this.setRecord(COLLECTIONS.users, user);
    },
    list: async (limit = 100) => {
      const res = await this.collection(COLLECTIONS.users).limit(limit).get();
      return (res.data ?? []) as UserRecord[];
    },
  };

  cases = {
    findById: async (id: string) => {
      const res = await this.collection(COLLECTIONS.cases).doc(id).get();
      return asDoc<CaseRecord>(res.data);
    },
    create: async (record: CaseRecord) => this.setRecord(COLLECTIONS.cases, record),
    update: async (id: string, patch: Partial<CaseRecord>) => {
      const col = this.collection(COLLECTIONS.cases);
      await col.doc(id).update(stripIdFromPatch(patch));
      const res = await col.doc(id).get();
      return asDoc<CaseRecord>(res.data);
    },
  };

  sessions = {
    findById: async (id: string) => {
      const res = await this.collection(COLLECTIONS.sessions).doc(id).get();
      return asDoc<SessionRecord>(res.data);
    },
    findByUserAndCase: async (userId: string, caseId: string) => {
      const res = await this.collection(COLLECTIONS.sessions)
        .where({ userId, caseId })
        .limit(1)
        .get();
      return asDoc<SessionRecord>(res.data);
    },
    upsert: async (session: SessionRecord) => {
      return this.setRecord(COLLECTIONS.sessions, session);
    },
  };

  history = {
    listByUser: async (userId: string, limit = 50) => {
      const result = await this.history.listPaginated(userId, { page: 1, limit });
      return result.items;
    },
    countByUser: async (userId: string, status?: 'in_progress' | 'completed') => {
      const where: Record<string, unknown> = { userId };
      if (status) where.status = status;
      try {
        const res = await this.collection(COLLECTIONS.history).where(where).count();
        return Number((res as { total?: number }).total ?? 0);
      } catch {
        const res = await this.collection(COLLECTIONS.history)
          .field({ status: true })
          .where({ userId })
          .limit(1000)
          .get();
        const rows = (res.data ?? []) as Array<{ status?: string }>;
        return rows.filter((r) => !status || r.status === status).length;
      }
    },
    listPaginated: async (userId: string, query: HistoryListQuery) => {
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(50, Math.max(1, query.limit ?? 10));
      const skip = (page - 1) * limit;
      const where: Record<string, unknown> = { userId };
      if (query.status) where.status = query.status;

      const total = await this.history.countByUser(userId, query.status);
      const field = this.collection(COLLECTIONS.history).field(HISTORY_LIST_FIELD_PROJECTION);

      try {
        const res = await field
          .where(where)
          .orderBy('updatedAt', 'desc')
          .skip(skip)
          .limit(limit)
          .get();
        const items = toHistoryListItems(res.data ?? []);
        return buildPaginatedResult(items, total, page, limit);
      } catch {
        const res = await field.where(where).limit(1000).get();
        let rows = toHistoryListItems(res.data ?? []);
        rows.sort((a, b) => b.updatedAt - a.updatedAt);
        return paginateArray(rows, page, limit);
      }
    },
    findByUserAndCase: async (userId: string, caseId: string) => {
      const res = await this.collection(COLLECTIONS.history)
        .field(HISTORY_LIST_FIELD_PROJECTION)
        .where({ userId, caseId })
        .limit(1)
        .get();
      const doc = asDoc(res.data as { _id: string } | Array<{ _id: string }> | undefined);
      return doc ? toHistoryListItem(doc as Record<string, unknown>) : null;
    },
    upsert: async (record: HistoryRecord) => {
      return this.setRecord(COLLECTIONS.history, record);
    },
  };

  leaderboard = {
    list: async (limit = 50) => {
      const res = await this.collection(COLLECTIONS.leaderboard)
        .orderBy('avgScore', 'desc')
        .limit(limit)
        .get();
      const rows = (res.data ?? []) as LeaderboardRecord[];
      return rows.sort(
        (a, b) => b.avgScore - a.avgScore || b.casesCompleted - a.casesCompleted
      );
    },
    upsert: async (record: LeaderboardRecord) => {
      const col = this.collection(COLLECTIONS.leaderboard);
      const existing = await col.where({ userId: record.userId }).limit(1).get();
      const docId = existing.data?.[0]?._id ?? record._id;
      const payload = { ...record, _id: docId };
      await col.doc(docId).set(stripId(payload));
      return payload;
    },
    findByUser: async (userId: string) => {
      const res = await this.collection(COLLECTIONS.leaderboard)
        .where({ userId })
        .limit(1)
        .get();
      return asDoc<LeaderboardRecord>(res.data);
    },
  };

  inventory = {
    claimAvailable: async (difficulty: string, userId?: string) => {
      const claimedBy = userId || undefined;
      return this.db.runTransaction(async (transaction: TcbTransaction) => {
        const col = transaction.collection(COLLECTIONS.inventory);
        const res = await col
          .where({ difficulty: difficulty as Difficulty, status: 'available' })
          .orderBy('createdAt', 'asc')
          .limit(1)
          .get();
        const item = asDoc<InventoryRecord>(res.data);
        if (!item) return null;

        const claimed: InventoryRecord = {
          ...item,
          status: 'claimed',
          claimedBy,
        };
        await col.doc(item._id).update({ status: 'claimed', claimedBy });
        return claimed;
      });
    },
    pickAvailable: async (difficulty: string, excludeIds: string[] = []) => {
      const excludeSet = new Set(excludeIds);
      const col = this.collection(COLLECTIONS.inventory);
      try {
        const res = await col
          .where({ difficulty: difficulty as Difficulty, status: 'available' })
          .orderBy('createdAt', 'asc')
          .limit(Math.max(20, excludeIds.length + 1))
          .get();
        const rows = (res.data ?? []) as InventoryRecord[];
        return rows.find((item) => !excludeSet.has(item._id)) ?? null;
      } catch {
        const res = await col
          .where({ difficulty: difficulty as Difficulty, status: 'available' })
          .limit(1000)
          .get();
        const rows = ((res.data ?? []) as InventoryRecord[])
          .filter((item) => !excludeSet.has(item._id))
          .sort((a, b) => a.createdAt - b.createdAt);
        return rows[0] ?? null;
      }
    },
    add: async (record: InventoryRecord) => this.setRecord(COLLECTIONS.inventory, record),
    countByDifficulty: async () => {
      const cmd = this.db.command;
      try {
        const res = await this.collection(COLLECTIONS.inventory)
          .aggregate()
          .match({ status: 'available' })
          .group({
            _id: '$difficulty',
            count: cmd.aggregate.sum(1),
          })
          .end();
        const rows = (res.data ?? []) as Array<{ _id: string; count: number }>;
        return Object.fromEntries(rows.map((r) => [r._id, r.count]));
      } catch {
        const res = await this.collection(COLLECTIONS.inventory)
          .where({ status: 'available' })
          .limit(1000)
          .field({ difficulty: true })
          .get();
        const counts: Record<string, number> = {};
        for (const item of (res.data ?? []) as Pick<InventoryRecord, 'difficulty'>[]) {
          counts[item.difficulty] = (counts[item.difficulty] ?? 0) + 1;
        }
        return counts;
      }
    },
    countByCaseId: async (caseId: string) => {
      const res = await this.collection(COLLECTIONS.inventory)
        .where({ caseId })
        .limit(1000)
        .get();
      return ((res.data ?? []) as InventoryRecord[]).length;
    },
    list: async (limit = 100) => {
      const res = await this.collection(COLLECTIONS.inventory)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return (res.data ?? []) as InventoryRecord[];
    },
    listPaginated: async (query: InventoryListQuery) => {
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      const where: Record<string, unknown> = {};
      if (query.status) where.status = query.status;
      if (query.difficulty) where.difficulty = query.difficulty;
      const col = this.collection(COLLECTIONS.inventory);
      let rows: InventoryRecord[] = [];
      try {
        const res = Object.keys(where).length
          ? await col.where(where).orderBy('createdAt', 'desc').limit(1000).get()
          : await col.orderBy('createdAt', 'desc').limit(1000).get();
        rows = (res.data ?? []) as InventoryRecord[];
      } catch {
        const res = await col.limit(1000).get();
        rows = (res.data ?? []) as InventoryRecord[];
        rows = rows
          .filter((r) => (!query.status || r.status === query.status) && (!query.difficulty || r.difficulty === query.difficulty))
          .sort((a, b) => b.createdAt - a.createdAt);
      }
      return paginateArray(rows, page, limit);
    },
  };

  claims = {
    add: async (record: ClaimRecord) => this.setRecord(COLLECTIONS.claims, record),
    countByCaseId: async (caseId: string) => {
      const res = await this.collection(COLLECTIONS.claims)
        .where({ caseId })
        .limit(1000)
        .get();
      return ((res.data ?? []) as ClaimRecord[]).length;
    },
    listByCaseId: async (caseId: string, page: number, limit: number) => {
      const col = this.collection(COLLECTIONS.claims);
      let rows: ClaimRecord[] = [];
      try {
        const res = await col.where({ caseId }).orderBy('claimedAt', 'desc').limit(1000).get();
        rows = (res.data ?? []) as ClaimRecord[];
      } catch {
        const res = await col.where({ caseId }).limit(1000).get();
        rows = ((res.data ?? []) as ClaimRecord[]).sort((a, b) => b.claimedAt - a.claimedAt);
      }
      return paginateArray(rows, page, limit);
    },
    listClaimedCaseIdsByUser: async (userId: string) => {
      const res = await this.collection(COLLECTIONS.claims).where({ userId }).limit(1000).get();
      const rows = (res.data ?? []) as ClaimRecord[];
      return [...new Set(rows.map((r) => r.caseId))];
    },
    hasUserClaimedCase: async (userId: string, caseId: string) => {
      const res = await this.collection(COLLECTIONS.claims)
        .where({ userId, caseId })
        .limit(1)
        .get();
      const rows = res.data ?? [];
      return Array.isArray(rows) ? rows.length > 0 : Boolean(rows);
    },
  };

  aiLogs = {
    add: async (log: AiLogRecord) => {
      return this.setRecord(COLLECTIONS.aiLogs, log);
    },
    list: async (limit = 100) => {
      const res = await this.collection(COLLECTIONS.aiLogs)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return (res.data ?? []) as AiLogRecord[];
    },
    listPaginated: async (query: AiLogsListQuery) => {
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      const col = this.collection(COLLECTIONS.aiLogs);
      let rows: AiLogRecord[] = [];
      try {
        const res = query.type
          ? await col.where({ type: query.type }).orderBy('createdAt', 'desc').limit(1000).get()
          : await col.orderBy('createdAt', 'desc').limit(1000).get();
        rows = (res.data ?? []) as AiLogRecord[];
      } catch {
        const res = await col.limit(1000).get();
        rows = ((res.data ?? []) as AiLogRecord[])
          .filter((l) => !query.type || l.type === query.type)
          .sort((a, b) => b.createdAt - a.createdAt);
      }
      return paginateArray(rows, page, limit);
    },
    stats: async () => {
      const cmd = this.db.command;
      try {
        const res = await this.collection(COLLECTIONS.aiLogs)
          .aggregate()
          .group({
            _id: null,
            totalCalls: cmd.aggregate.sum(1),
            totalTokens: cmd.aggregate.sum('$totalTokens'),
          })
          .end();
        const row = (res.data ?? [])[0] as { totalCalls: number; totalTokens: number } | undefined;
        return row ?? { totalCalls: 0, totalTokens: 0 };
      } catch {
        const res = await this.collection(COLLECTIONS.aiLogs).limit(1000).get();
        return ((res.data ?? []) as AiLogRecord[]).reduce(
          (acc, log) => ({
            totalCalls: acc.totalCalls + 1,
            totalTokens: acc.totalTokens + log.totalTokens,
          }),
          { totalCalls: 0, totalTokens: 0 }
        );
      }
    },
    deleteById: async (id: string) => {
      try {
        await this.collection(COLLECTIONS.aiLogs).doc(id).remove();
        return true;
      } catch {
        return false;
      }
    },
    deleteMany: async (filter: { type?: AiLogRecord['type']; olderThanMs?: number }) => {
      const { items } = await this.aiLogs.listPaginated({ page: 1, limit: 1000, type: filter.type });
      const cutoff = filter.olderThanMs ? Date.now() - filter.olderThanMs : 0;
      let removed = 0;
      for (const log of items) {
        if (cutoff && log.createdAt >= cutoff) continue;
        if (await this.aiLogs.deleteById(log._id)) removed++;
      }
      return removed;
    },
  };

  loginAudits = {
    add: async (record: LoginAuditRecord) => this.setRecord(COLLECTIONS.loginAudits, record),
    listPaginated: async (query: LoginAuditsListQuery) => {
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      const col = this.collection(COLLECTIONS.loginAudits);
      let rows: LoginAuditRecord[] = [];
      try {
        const res = query.source
          ? await col.where({ source: query.source }).orderBy('createdAt', 'desc').limit(2000).get()
          : await col.orderBy('createdAt', 'desc').limit(2000).get();
        rows = (res.data ?? []) as LoginAuditRecord[];
      } catch {
        const res = await col.limit(2000).get();
        rows = (res.data ?? []) as LoginAuditRecord[];
      }
      if (query.source) rows = rows.filter((r) => r.source === query.source);
      else if (query.auditOnly) rows = rows.filter((r) => r.source === 'login' || r.source === 'register');
      rows.sort((a, b) => b.createdAt - a.createdAt);
      return paginateArray(rows, page, limit);
    },
    listSince: async (sinceMs: number) => {
      const col = this.collection(COLLECTIONS.loginAudits);
      let rows: LoginAuditRecord[] = [];
      try {
        const res = await col.where({ createdAt: this.db.command.gte(sinceMs) }).orderBy('createdAt', 'desc').limit(2000).get();
        rows = (res.data ?? []) as LoginAuditRecord[];
      } catch {
        const res = await col.limit(2000).get();
        rows = ((res.data ?? []) as LoginAuditRecord[])
          .filter((r) => r.createdAt >= sinceMs)
          .sort((a, b) => b.createdAt - a.createdAt);
      }
      return rows;
    },
    hasToday: async (userId: string, source: LoginAuditRecord['source'], sinceMs: number) => {
      const rows = await this.loginAudits.listSince(sinceMs);
      return rows.some((r) => r.userId === userId && r.source === source);
    },
    deleteOlderThan: async (cutoffMs: number) => {
      const rows = await this.loginAudits.listSince(0);
      let removed = 0;
      for (const row of rows) {
        if (row.createdAt >= cutoffMs) continue;
        try {
          await this.collection(COLLECTIONS.loginAudits).doc(row._id).remove();
          removed++;
        } catch {
          /* skip */
        }
      }
      return removed;
    },
  };

  generationJobs = {
    findById: async (id: string) => {
      const res = await this.collection(COLLECTIONS.generationJobs).doc(id).get();
      return asDoc<GenerationJob>(res.data);
    },
    upsert: async (job: GenerationJob) => this.setRecord(COLLECTIONS.generationJobs, job),
  };
}
