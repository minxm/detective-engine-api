import { MongoClient, type Collection, type Db } from 'mongodb';
import { isTransientNetworkError, sleep } from '../utils/retry.js';
import type { DatabaseAdapter, AiLogsListQuery, HistoryListQuery, InventoryListQuery, LoginAuditsListQuery } from './interface.js';
import { buildPaginatedResult } from '../utils/pagination.js';
import type {
  AiLogRecord,
  CaseRecord,
  ClaimRecord,
  Difficulty,
  HistoryListItem,
  HistoryRecord,
  InventoryRecord,
  LeaderboardRecord,
  SessionRecord,
  UserRecord,
  LoginAuditRecord,
  GenerationJob,
} from '../types/index.js';
import { toHistoryListItem } from '../services/history-list.js';

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

export class MongoDbAdapter implements DatabaseAdapter {
  private client: MongoClient;
  private dbName: string;
  private db: Db | null = null;
  private connectPromise: Promise<Db> | null = null;

  constructor(uri: string, dbName = 'detective') {
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
    });
    this.dbName = dbName;
  }

  private async ensureDb(): Promise<Db> {
    if (this.db) return this.db;
    if (!this.connectPromise) {
      this.connectPromise = this.connectWithRetry();
    }
    return this.connectPromise;
  }

  private async connectWithRetry(): Promise<Db> {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        return this.db;
      } catch (err) {
        if (attempt >= maxAttempts - 1 || !isTransientNetworkError(err)) throw err;
        await sleep(300 * (attempt + 1));
      }
    }
    throw new Error('MongoDB 连接失败');
  }

  private async collection<T extends { _id: string }>(name: string): Promise<Collection<T>> {
    const db = await this.ensureDb();
    return db.collection<T>(name);
  }

  users = {
    findById: async (id: string) => {
      const col = await this.collection<UserRecord>(COLLECTIONS.users);
      return col.findOne({ _id: id });
    },
    findByUsername: async (username: string) => {
      const col = await this.collection<UserRecord>(COLLECTIONS.users);
      return col.findOne({ username: username.trim().toLowerCase() });
    },
    upsert: async (user: UserRecord) => {
      const col = await this.collection<UserRecord>(COLLECTIONS.users);
      await col.updateOne({ _id: user._id }, { $set: user }, { upsert: true });
      return user;
    },
    list: async (limit = 100) => {
      const col = await this.collection<UserRecord>(COLLECTIONS.users);
      return col.find().limit(limit).toArray();
    },
  };

  cases = {
    findById: async (id: string) => {
      const col = await this.collection<CaseRecord>(COLLECTIONS.cases);
      return col.findOne({ _id: id });
    },
    create: async (record: CaseRecord) => {
      const col = await this.collection<CaseRecord>(COLLECTIONS.cases);
      await col.insertOne(record);
      return record;
    },
    update: async (id: string, patch: Partial<CaseRecord>) => {
      const col = await this.collection<CaseRecord>(COLLECTIONS.cases);
      await col.updateOne({ _id: id }, { $set: patch });
      return col.findOne({ _id: id });
    },
  };

  sessions = {
    findById: async (id: string) => {
      const col = await this.collection<SessionRecord>(COLLECTIONS.sessions);
      return col.findOne({ _id: id });
    },
    findByUserAndCase: async (userId: string, caseId: string) => {
      const col = await this.collection<SessionRecord>(COLLECTIONS.sessions);
      return col.findOne({ userId, caseId });
    },
    upsert: async (session: SessionRecord) => {
      const col = await this.collection<SessionRecord>(COLLECTIONS.sessions);
      await col.updateOne({ _id: session._id }, { $set: session }, { upsert: true });
      return session;
    },
  };

  history = {
    listByUser: async (userId: string, limit = 50) => {
      const result = await this.history.listPaginated(userId, { page: 1, limit });
      return result.items;
    },
    countByUser: async (userId: string, status?: 'in_progress' | 'completed') => {
      const col = await this.collection<HistoryRecord>(COLLECTIONS.history);
      const filter: Record<string, unknown> = { userId };
      if (status) filter.status = status;
      return col.countDocuments(filter);
    },
    listPaginated: async (userId: string, query: HistoryListQuery) => {
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(50, Math.max(1, query.limit ?? 10));
      const skip = (page - 1) * limit;
      const filter: Record<string, unknown> = { userId };
      if (query.status) filter.status = query.status;
      const projection = {
        _id: 1,
        userId: 1,
        caseId: 1,
        caseTitle: 1,
        score: 1,
        rating: 1,
        killerCorrect: 1,
        status: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      const col = await this.collection<HistoryRecord>(COLLECTIONS.history);
      const [total, rows] = await Promise.all([
        col.countDocuments(filter),
        col.find(filter, { projection }).sort({ updatedAt: -1 }).skip(skip).limit(limit).toArray(),
      ]);
      const items = rows
        .map((row) => toHistoryListItem(row as Record<string, unknown>))
        .filter((r): r is HistoryListItem => r != null);
      return buildPaginatedResult(items, total, page, limit);
    },
    findByUserAndCase: async (userId: string, caseId: string) => {
      const col = await this.collection<HistoryRecord>(COLLECTIONS.history);
      const projection = {
        _id: 1,
        userId: 1,
        caseId: 1,
        caseTitle: 1,
        score: 1,
        rating: 1,
        killerCorrect: 1,
        status: 1,
        createdAt: 1,
        updatedAt: 1,
      };
      const row = await col.findOne({ userId, caseId }, { projection });
      return row ? toHistoryListItem(row as Record<string, unknown>) : null;
    },
    upsert: async (record: HistoryRecord) => {
      const col = await this.collection<HistoryRecord>(COLLECTIONS.history);
      await col.updateOne({ _id: record._id }, { $set: record }, { upsert: true });
      return record;
    },
  };

  leaderboard = {
    list: async (limit = 50) => {
      const col = await this.collection<LeaderboardRecord>(COLLECTIONS.leaderboard);
      return col.find().sort({ avgScore: -1, casesCompleted: -1 }).limit(limit).toArray();
    },
    upsert: async (record: LeaderboardRecord) => {
      const col = await this.collection<LeaderboardRecord>(COLLECTIONS.leaderboard);
      await col.updateOne({ userId: record.userId }, { $set: record }, { upsert: true });
      return record;
    },
    findByUser: async (userId: string) => {
      const col = await this.collection<LeaderboardRecord>(COLLECTIONS.leaderboard);
      return col.findOne({ userId });
    },
  };

  inventory = {
    claimAvailable: async (difficulty: string, userId?: string) => {
      const claimedBy = userId || undefined;
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      const result = await col.findOneAndUpdate(
        { difficulty: difficulty as Difficulty, status: 'available' },
        { $set: { status: 'claimed', claimedBy } },
        { sort: { createdAt: 1 }, returnDocument: 'after' }
      );
      return result ?? null;
    },
    pickAvailable: async (difficulty: string, excludeIds: string[] = []) => {
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      const filter: Record<string, unknown> = { difficulty: difficulty as Difficulty, status: 'available' };
      if (excludeIds.length > 0) filter._id = { $nin: excludeIds };
      return col.findOne(filter, { sort: { createdAt: 1 } });
    },
    add: async (record: InventoryRecord) => {
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      await col.insertOne(record);
      return record;
    },
    countByDifficulty: async () => {
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      const rows = await col
        .aggregate<{ _id: string; count: number }>([
          { $match: { status: 'available' } },
          { $group: { _id: '$difficulty', count: { $sum: 1 } } },
        ])
        .toArray();
      return Object.fromEntries(rows.map((r) => [r._id, r.count]));
    },
    countByCaseId: async (caseId: string) => {
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      return col.countDocuments({ caseId });
    },
    list: async (limit = 100) => {
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      return col.find().sort({ createdAt: -1 }).limit(limit).toArray();
    },
    listPaginated: async (query: InventoryListQuery) => {
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      const filter: Record<string, unknown> = {};
      if (query.status) filter.status = query.status;
      if (query.difficulty) filter.difficulty = query.difficulty;
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(filter),
      ]);
      return buildPaginatedResult(items, total, page, limit);
    },
  };

  claims = {
    add: async (record: ClaimRecord) => {
      const col = await this.collection<ClaimRecord>(COLLECTIONS.claims);
      await col.insertOne(record);
      return record;
    },
    countByCaseId: async (caseId: string) => {
      const col = await this.collection<ClaimRecord>(COLLECTIONS.claims);
      return col.countDocuments({ caseId });
    },
    listByCaseId: async (caseId: string, page: number, limit: number) => {
      const col = await this.collection<ClaimRecord>(COLLECTIONS.claims);
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        col.find({ caseId }).sort({ claimedAt: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments({ caseId }),
      ]);
      return buildPaginatedResult(items, total, page, limit);
    },
    listClaimedCaseIdsByUser: async (userId: string) => {
      const col = await this.collection<ClaimRecord>(COLLECTIONS.claims);
      const rows = await col.find({ userId }).project({ caseId: 1 }).toArray();
      return [...new Set(rows.map((r) => r.caseId))];
    },
    hasUserClaimedCase: async (userId: string, caseId: string) => {
      const col = await this.collection<ClaimRecord>(COLLECTIONS.claims);
      const doc = await col.findOne({ userId, caseId }, { projection: { _id: 1 } });
      return Boolean(doc);
    },
  };

  aiLogs = {
    add: async (log: AiLogRecord) => {
      const col = await this.collection<AiLogRecord>(COLLECTIONS.aiLogs);
      await col.insertOne(log);
      return log;
    },
    list: async (limit = 100) => {
      const col = await this.collection<AiLogRecord>(COLLECTIONS.aiLogs);
      return col.find().sort({ createdAt: -1 }).limit(limit).toArray();
    },
    listPaginated: async (query: AiLogsListQuery) => {
      const col = await this.collection<AiLogRecord>(COLLECTIONS.aiLogs);
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      const filter: Record<string, unknown> = {};
      if (query.type) filter.type = query.type;
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(filter),
      ]);
      return buildPaginatedResult(items, total, page, limit);
    },
    stats: async () => {
      const col = await this.collection<AiLogRecord>(COLLECTIONS.aiLogs);
      const rows = await col
        .aggregate<{ totalCalls: number; totalTokens: number }>([
          {
            $group: {
              _id: null,
              totalCalls: { $sum: 1 },
              totalTokens: { $sum: '$totalTokens' },
            },
          },
        ])
        .toArray();
      return rows[0] ?? { totalCalls: 0, totalTokens: 0 };
    },
    deleteById: async (id: string) => {
      const col = await this.collection<AiLogRecord>(COLLECTIONS.aiLogs);
      const res = await col.deleteOne({ _id: id });
      return res.deletedCount > 0;
    },
    deleteMany: async (filter: { type?: AiLogRecord['type']; olderThanMs?: number }) => {
      const col = await this.collection<AiLogRecord>(COLLECTIONS.aiLogs);
      const mongoFilter: Record<string, unknown> = {};
      if (filter.type) mongoFilter.type = filter.type;
      if (filter.olderThanMs) mongoFilter.createdAt = { $lt: Date.now() - filter.olderThanMs };
      const res = await col.deleteMany(mongoFilter);
      return res.deletedCount;
    },
  };

  loginAudits = {
    add: async (record: LoginAuditRecord) => {
      const col = await this.collection<LoginAuditRecord>(COLLECTIONS.loginAudits);
      await col.insertOne(record);
      return record;
    },
    listPaginated: async (query: LoginAuditsListQuery) => {
      const col = await this.collection<LoginAuditRecord>(COLLECTIONS.loginAudits);
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 20));
      const filter: Record<string, unknown> = {};
      if (query.source) filter.source = query.source;
      else if (query.auditOnly) filter.source = { $in: ['login', 'register'] };
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(filter),
      ]);
      return buildPaginatedResult(items, total, page, limit);
    },
    listSince: async (sinceMs: number) => {
      const col = await this.collection<LoginAuditRecord>(COLLECTIONS.loginAudits);
      return col.find({ createdAt: { $gte: sinceMs } }).sort({ createdAt: -1 }).toArray();
    },
    hasToday: async (userId: string, source: LoginAuditRecord['source'], sinceMs: number) => {
      const col = await this.collection<LoginAuditRecord>(COLLECTIONS.loginAudits);
      const doc = await col.findOne({ userId, source, createdAt: { $gte: sinceMs } }, { projection: { _id: 1 } });
      return Boolean(doc);
    },
    deleteOlderThan: async (cutoffMs: number) => {
      const col = await this.collection<LoginAuditRecord>(COLLECTIONS.loginAudits);
      const res = await col.deleteMany({ createdAt: { $lt: cutoffMs } });
      return res.deletedCount;
    },
  };

  generationJobs = {
    findById: async (id: string) => {
      const col = await this.collection<GenerationJob>(COLLECTIONS.generationJobs);
      return col.findOne({ _id: id });
    },
    upsert: async (job: GenerationJob) => {
      const col = await this.collection<GenerationJob>(COLLECTIONS.generationJobs);
      await col.updateOne({ _id: job._id }, { $set: job }, { upsert: true });
      return job;
    },
  };
}
