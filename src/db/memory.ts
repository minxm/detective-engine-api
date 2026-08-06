import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseAdapter, AiLogsListQuery, HistoryListQuery, InventoryListQuery, LoginAuditsListQuery } from './interface.js';
import { paginateArray } from '../utils/pagination.js';
import type {
  AiLogRecord,
  CaseRecord,
  ClaimRecord,
  GenerationJob,
  HistoryListItem,
  HistoryRecord,
  InventoryRecord,
  LeaderboardRecord,
  LoginAuditRecord,
  OnlinePresenceRecord,
  RefillJob,
  SessionRecord,
  UserRecord,
} from '../types/index.js';
import { toHistoryListItem } from '../services/history-list.js';

type Store = {
  users: UserRecord[];
  cases: CaseRecord[];
  sessions: SessionRecord[];
  history: HistoryRecord[];
  leaderboard: LeaderboardRecord[];
  inventory: InventoryRecord[];
  aiLogs: AiLogRecord[];
  claims: ClaimRecord[];
  loginAudits: LoginAuditRecord[];
  generationJobs: GenerationJob[];
  onlinePresence: OnlinePresenceRecord[];
  refillJobs: RefillJob[];
};

const DEFAULT_STORE: Store = {
  users: [],
  cases: [],
  sessions: [],
  history: [],
  leaderboard: [],
  inventory: [],
  aiLogs: [],
  claims: [],
  loginAudits: [],
  generationJobs: [],
  onlinePresence: [],
  refillJobs: [],
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryDatabase implements DatabaseAdapter {
  private store: Store = clone(DEFAULT_STORE);
  private filePath: string;
  private loaded = false;

  constructor(dataDir = './data') {
    this.filePath = path.join(dataDir, 'store.json');
  }

  private async ensureLoaded() {
    if (this.loaded) return;
    if (existsSync(this.filePath)) {
      const raw = await readFile(this.filePath, 'utf8');
      this.store = { ...clone(DEFAULT_STORE), ...JSON.parse(raw) };
    } else {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await this.persist();
    }
    this.loaded = true;
  }

  private async persist() {
    await writeFile(this.filePath, JSON.stringify(this.store, null, 2), 'utf8');
  }

  users = {
    findById: async (id: string) => {
      await this.ensureLoaded();
      return this.store.users.find((u) => u._id === id) ?? null;
    },
    findByUsername: async (username: string) => {
      await this.ensureLoaded();
      const lower = username.trim().toLowerCase();
      return this.store.users.find((u) => u.username?.toLowerCase() === lower) ?? null;
    },
    upsert: async (user: UserRecord) => {
      await this.ensureLoaded();
      const idx = this.store.users.findIndex((u) => u._id === user._id);
      if (idx >= 0) this.store.users[idx] = user;
      else this.store.users.push(user);
      await this.persist();
      return user;
    },
    list: async (limit = 100) => {
      await this.ensureLoaded();
      return this.store.users.slice(0, limit);
    },
    listPaginated: async (query: { page?: number; limit?: number } = {}) => {
      await this.ensureLoaded();
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      const rows = [...this.store.users].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return paginateArray(rows, page, limit);
    },
  };

  cases = {
    findById: async (id: string) => {
      await this.ensureLoaded();
      return this.store.cases.find((c) => c._id === id) ?? null;
    },
    create: async (record: CaseRecord) => {
      await this.ensureLoaded();
      this.store.cases.push(record);
      await this.persist();
      return record;
    },
    update: async (id: string, patch: Partial<CaseRecord>) => {
      await this.ensureLoaded();
      const idx = this.store.cases.findIndex((c) => c._id === id);
      if (idx < 0) return null;
      this.store.cases[idx] = { ...this.store.cases[idx], ...patch };
      await this.persist();
      return this.store.cases[idx];
    },
  };

  sessions = {
    findById: async (id: string) => {
      await this.ensureLoaded();
      return this.store.sessions.find((s) => s._id === id) ?? null;
    },
    findByUserAndCase: async (userId: string, caseId: string) => {
      await this.ensureLoaded();
      return this.store.sessions.find((s) => s.userId === userId && s.caseId === caseId) ?? null;
    },
    upsert: async (session: SessionRecord) => {
      await this.ensureLoaded();
      const idx = this.store.sessions.findIndex((s) => s._id === session._id);
      if (idx >= 0) this.store.sessions[idx] = session;
      else this.store.sessions.push(session);
      await this.persist();
      return session;
    },
  };

  history = {
    listByUser: async (userId: string, limit = 50) => {
      const result = await this.history.listPaginated(userId, { page: 1, limit });
      return result.items;
    },
    countByUser: async (userId: string, status?: 'in_progress' | 'completed') => {
      await this.ensureLoaded();
      return this.store.history.filter(
        (h) => h.userId === userId && (!status || h.status === status),
      ).length;
    },
    listPaginated: async (userId: string, query: HistoryListQuery) => {
      await this.ensureLoaded();
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(50, Math.max(1, query.limit ?? 10));
      const rows = this.store.history
        .filter((h) => h.userId === userId && (!query.status || h.status === query.status))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((row) => toHistoryListItem(row as unknown as Record<string, unknown>))
        .filter((r): r is HistoryListItem => r != null);
      return paginateArray(rows, page, limit);
    },
    findByUserAndCase: async (userId: string, caseId: string) => {
      await this.ensureLoaded();
      const row = this.store.history.find((h) => h.userId === userId && h.caseId === caseId);
      return row ? toHistoryListItem(row as unknown as Record<string, unknown>) : null;
    },
    upsert: async (record: HistoryRecord) => {
      await this.ensureLoaded();
      const idx = this.store.history.findIndex((h) => h._id === record._id);
      if (idx >= 0) this.store.history[idx] = record;
      else this.store.history.push(record);
      await this.persist();
      return record;
    },
  };

  leaderboard = {
    list: async (limit = 50) => {
      await this.ensureLoaded();
      return [...this.store.leaderboard]
        .sort((a, b) => b.avgScore - a.avgScore || b.casesCompleted - a.casesCompleted)
        .slice(0, limit);
    },
    upsert: async (record: LeaderboardRecord) => {
      await this.ensureLoaded();
      const idx = this.store.leaderboard.findIndex((l) => l.userId === record.userId);
      if (idx >= 0) this.store.leaderboard[idx] = record;
      else this.store.leaderboard.push(record);
      await this.persist();
      return record;
    },
    findByUser: async (userId: string) => {
      await this.ensureLoaded();
      return this.store.leaderboard.find((l) => l.userId === userId) ?? null;
    },
  };

  inventory = {
    claimAvailable: async (difficulty: string, userId?: string) => {
      const claimedBy = userId || undefined;
      await this.ensureLoaded();
      const idx = this.store.inventory.findIndex(
        (item) => item.difficulty === difficulty && item.status === 'available'
      );
      if (idx < 0) return null;
      const item = this.store.inventory[idx];
      item.status = 'claimed';
      item.claimedBy = claimedBy;
      await this.persist();
      return item;
    },
    pickAvailable: async (difficulty: string, excludeIds: string[] = []) => {
      await this.ensureLoaded();
      const excludeSet = new Set(excludeIds);
      return (
        this.store.inventory.find(
          (item) => item.difficulty === difficulty && item.status === 'available' && !excludeSet.has(item._id)
        ) ?? null
      );
    },
    add: async (record: InventoryRecord) => {
      await this.ensureLoaded();
      this.store.inventory.push(record);
      await this.persist();
      return record;
    },
    countByDifficulty: async () => {
      await this.ensureLoaded();
      const counts: Record<string, number> = {};
      for (const item of this.store.inventory) {
        if (item.status !== 'available') continue;
        counts[item.difficulty] = (counts[item.difficulty] ?? 0) + 1;
      }
      return counts;
    },
    countByCaseId: async (caseId: string) => {
      await this.ensureLoaded();
      return this.store.inventory.filter((i) => i.caseId === caseId).length;
    },
    list: async (limit = 100) => {
      await this.ensureLoaded();
      return [...this.store.inventory].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    },
    listPaginated: async (query: InventoryListQuery) => {
      await this.ensureLoaded();
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      let rows = [...this.store.inventory].sort((a, b) => b.createdAt - a.createdAt);
      if (query.status) rows = rows.filter((r) => r.status === query.status);
      if (query.difficulty) rows = rows.filter((r) => r.difficulty === query.difficulty);
      return paginateArray(rows, page, limit);
    },
  };

  claims = {
    add: async (record: ClaimRecord) => {
      await this.ensureLoaded();
      this.store.claims.push(record);
      await this.persist();
      return record;
    },
    countByCaseId: async (caseId: string) => {
      await this.ensureLoaded();
      return this.store.claims.filter((c) => c.caseId === caseId).length;
    },
    listByCaseId: async (caseId: string, page: number, limit: number) => {
      await this.ensureLoaded();
      const rows = [...this.store.claims]
        .filter((c) => c.caseId === caseId)
        .sort((a, b) => b.claimedAt - a.claimedAt);
      return paginateArray(rows, page, limit);
    },
    listClaimedCaseIdsByUser: async (userId: string) => {
      await this.ensureLoaded();
      return [...new Set(this.store.claims.filter((c) => c.userId === userId).map((c) => c.caseId))];
    },
    hasUserClaimedCase: async (userId: string, caseId: string) => {
      await this.ensureLoaded();
      return this.store.claims.some((c) => c.userId === userId && c.caseId === caseId);
    },
  };

  aiLogs = {
    add: async (log: AiLogRecord) => {
      await this.ensureLoaded();
      this.store.aiLogs.push(log);
      await this.persist();
      return log;
    },
    list: async (limit = 100) => {
      await this.ensureLoaded();
      return [...this.store.aiLogs].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    },
    listPaginated: async (query: AiLogsListQuery) => {
      await this.ensureLoaded();
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      let rows = [...this.store.aiLogs].sort((a, b) => b.createdAt - a.createdAt);
      if (query.type) rows = rows.filter((l) => l.type === query.type);
      return paginateArray(rows, page, limit);
    },
    stats: async () => {
      await this.ensureLoaded();
      return this.store.aiLogs.reduce(
        (acc, log) => ({
          totalCalls: acc.totalCalls + 1,
          totalTokens: acc.totalTokens + log.totalTokens,
        }),
        { totalCalls: 0, totalTokens: 0 }
      );
    },
    deleteById: async (id: string) => {
      await this.ensureLoaded();
      const before = this.store.aiLogs.length;
      this.store.aiLogs = this.store.aiLogs.filter((l) => l._id !== id);
      if (this.store.aiLogs.length === before) return false;
      await this.persist();
      return true;
    },
    deleteMany: async (filter: { type?: AiLogRecord['type']; olderThanMs?: number }) => {
      await this.ensureLoaded();
      const cutoff = filter.olderThanMs ? Date.now() - filter.olderThanMs : 0;
      const before = this.store.aiLogs.length;
      this.store.aiLogs = this.store.aiLogs.filter((log) => {
        if (filter.type && log.type !== filter.type) return true;
        if (cutoff && log.createdAt >= cutoff) return true;
        return false;
      });
      const removed = before - this.store.aiLogs.length;
      if (removed > 0) await this.persist();
      return removed;
    },
  };

  loginAudits = {
    add: async (record: LoginAuditRecord) => {
      await this.ensureLoaded();
      this.store.loginAudits.push(record);
      await this.persist();
      return record;
    },
    listPaginated: async (query: LoginAuditsListQuery) => {
      await this.ensureLoaded();
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      let rows = [...this.store.loginAudits].sort((a, b) => b.createdAt - a.createdAt);
      if (query.source) rows = rows.filter((r) => r.source === query.source);
      else if (query.auditOnly) rows = rows.filter((r) => r.source === 'login' || r.source === 'register');
      return paginateArray(rows, page, limit);
    },
    listSince: async (sinceMs: number) => {
      await this.ensureLoaded();
      return this.store.loginAudits
        .filter((r) => r.createdAt >= sinceMs)
        .sort((a, b) => b.createdAt - a.createdAt);
    },
    hasToday: async (userId: string, source: LoginAuditRecord['source'], sinceMs: number) => {
      await this.ensureLoaded();
      return this.store.loginAudits.some(
        (r) => r.userId === userId && r.source === source && r.createdAt >= sinceMs,
      );
    },
    deleteOlderThan: async (cutoffMs: number) => {
      await this.ensureLoaded();
      const before = this.store.loginAudits.length;
      this.store.loginAudits = this.store.loginAudits.filter((r) => r.createdAt >= cutoffMs);
      const removed = before - this.store.loginAudits.length;
      if (removed > 0) await this.persist();
      return removed;
    },
  };

  generationJobs = {
    findById: async (id: string) => {
      await this.ensureLoaded();
      return this.store.generationJobs.find((j) => j._id === id) ?? null;
    },
    upsert: async (job: GenerationJob) => {
      await this.ensureLoaded();
      const idx = this.store.generationJobs.findIndex((j) => j._id === job._id);
      if (idx >= 0) this.store.generationJobs[idx] = job;
      else this.store.generationJobs.push(job);
      await this.persist();
      return job;
    },
  };

  onlinePresence = {
    upsert: async (record: OnlinePresenceRecord) => {
      await this.ensureLoaded();
      const idx = this.store.onlinePresence.findIndex((r) => r._id === record._id);
      if (idx >= 0) this.store.onlinePresence[idx] = record;
      else this.store.onlinePresence.push(record);
      await this.persist();
      return record;
    },
    listActive: async (sinceMs: number, page: number, limit: number) => {
      await this.ensureLoaded();
      const rows = this.store.onlinePresence
        .filter((r) => r.lastSeen >= sinceMs)
        .sort((a, b) => b.lastSeen - a.lastSeen);
      return paginateArray(rows, page, limit);
    },
  };

  refillJobs = {
    findById: async (id: string) => {
      await this.ensureLoaded();
      return this.store.refillJobs.find((j) => j._id === id) ?? null;
    },
    upsert: async (job: RefillJob) => {
      await this.ensureLoaded();
      const idx = this.store.refillJobs.findIndex((j) => j._id === job._id);
      if (idx >= 0) this.store.refillJobs[idx] = job;
      else this.store.refillJobs.push(job);
      await this.persist();
      return job;
    },
  };
}
