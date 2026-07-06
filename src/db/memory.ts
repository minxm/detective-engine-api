import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseAdapter } from './interface.js';
import type {
  AiLogRecord,
  CaseRecord,
  GenerationJob,
  HistoryRecord,
  InventoryRecord,
  LeaderboardRecord,
  SessionRecord,
  UserRecord,
} from '../types/index.js';

type Store = {
  users: UserRecord[];
  cases: CaseRecord[];
  sessions: SessionRecord[];
  history: HistoryRecord[];
  leaderboard: LeaderboardRecord[];
  inventory: InventoryRecord[];
  jobs: GenerationJob[];
  aiLogs: AiLogRecord[];
};

const DEFAULT_STORE: Store = {
  users: [],
  cases: [],
  sessions: [],
  history: [],
  leaderboard: [],
  inventory: [],
  jobs: [],
  aiLogs: [],
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
      await this.ensureLoaded();
      return this.store.history
        .filter((h) => h.userId === userId)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit);
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
      await this.ensureLoaded();
      const idx = this.store.inventory.findIndex(
        (item) => item.difficulty === difficulty && item.status === 'available'
      );
      if (idx < 0) return null;
      const item = this.store.inventory[idx];
      item.status = 'claimed';
      item.claimedBy = userId;
      await this.persist();
      return item;
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
    list: async (limit = 100) => {
      await this.ensureLoaded();
      return this.store.inventory.slice(-limit);
    },
  };

  jobs = {
    findById: async (id: string) => {
      await this.ensureLoaded();
      return this.store.jobs.find((j) => j._id === id) ?? null;
    },
    upsert: async (job: GenerationJob) => {
      await this.ensureLoaded();
      const idx = this.store.jobs.findIndex((j) => j._id === job._id);
      if (idx >= 0) this.store.jobs[idx] = job;
      else this.store.jobs.push(job);
      await this.persist();
      return job;
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
  };
}
