import { MongoClient, type Collection, type Db } from 'mongodb';
import type { DatabaseAdapter } from './interface.js';
import type {
  AiLogRecord,
  CaseRecord,
  Difficulty,
  GenerationJob,
  HistoryRecord,
  InventoryRecord,
  LeaderboardRecord,
  SessionRecord,
  UserRecord,
} from '../types/index.js';

const COLLECTIONS = {
  users: 'users',
  cases: 'cases',
  sessions: 'sessions',
  history: 'history',
  leaderboard: 'leaderboard',
  inventory: 'inventory',
  jobs: 'jobs',
  aiLogs: 'ai_logs',
} as const;

export class MongoDbAdapter implements DatabaseAdapter {
  private client: MongoClient;
  private dbName: string;
  private db: Db | null = null;

  constructor(uri: string, dbName = 'detective') {
    this.client = new MongoClient(uri);
    this.dbName = dbName;
  }

  private async collection<T extends { _id: string }>(name: string): Promise<Collection<T>> {
    if (!this.db) {
      await this.client.connect();
      this.db = this.client.db(this.dbName);
    }
    return this.db.collection<T>(name);
  }

  users = {
    findById: async (id: string) => {
      const col = await this.collection<UserRecord>(COLLECTIONS.users);
      return col.findOne({ _id: id });
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
      const col = await this.collection<HistoryRecord>(COLLECTIONS.history);
      return col.find({ userId }).sort({ updatedAt: -1 }).limit(limit).toArray();
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
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      const result = await col.findOneAndUpdate(
        { difficulty: difficulty as Difficulty, status: 'available' },
        { $set: { status: 'claimed', claimedBy: userId } },
        { sort: { createdAt: 1 }, returnDocument: 'after' }
      );
      return result ?? null;
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
    list: async (limit = 100) => {
      const col = await this.collection<InventoryRecord>(COLLECTIONS.inventory);
      return col.find().sort({ createdAt: -1 }).limit(limit).toArray();
    },
  };

  jobs = {
    findById: async (id: string) => {
      const col = await this.collection<GenerationJob>(COLLECTIONS.jobs);
      return col.findOne({ _id: id });
    },
    upsert: async (job: GenerationJob) => {
      const col = await this.collection<GenerationJob>(COLLECTIONS.jobs);
      await col.updateOne({ _id: job._id }, { $set: job }, { upsert: true });
      return job;
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
  };
}
