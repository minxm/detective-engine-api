import type {
  CaseRecord,
  GenerationJob,
  HistoryRecord,
  InventoryRecord,
  LeaderboardRecord,
  SessionRecord,
  UserRecord,
  AiLogRecord,
} from '../types/index.js';

export interface DatabaseAdapter {
  users: {
    findById(id: string): Promise<UserRecord | null>;
    upsert(user: UserRecord): Promise<UserRecord>;
    list(limit?: number): Promise<UserRecord[]>;
  };
  cases: {
    findById(id: string): Promise<CaseRecord | null>;
    create(record: CaseRecord): Promise<CaseRecord>;
    update(id: string, patch: Partial<CaseRecord>): Promise<CaseRecord | null>;
  };
  sessions: {
    findById(id: string): Promise<SessionRecord | null>;
    findByUserAndCase(userId: string, caseId: string): Promise<SessionRecord | null>;
    upsert(session: SessionRecord): Promise<SessionRecord>;
  };
  history: {
    listByUser(userId: string, limit?: number): Promise<HistoryRecord[]>;
    upsert(record: HistoryRecord): Promise<HistoryRecord>;
  };
  leaderboard: {
    list(limit?: number): Promise<LeaderboardRecord[]>;
    upsert(record: LeaderboardRecord): Promise<LeaderboardRecord>;
    findByUser(userId: string): Promise<LeaderboardRecord | null>;
  };
  inventory: {
    claimAvailable(difficulty: string, userId?: string): Promise<InventoryRecord | null>;
    add(record: InventoryRecord): Promise<InventoryRecord>;
    countByDifficulty(): Promise<Record<string, number>>;
    list(limit?: number): Promise<InventoryRecord[]>;
  };
  jobs: {
    findById(id: string): Promise<GenerationJob | null>;
    upsert(job: GenerationJob): Promise<GenerationJob>;
  };
  aiLogs: {
    add(log: AiLogRecord): Promise<AiLogRecord>;
    list(limit?: number): Promise<AiLogRecord[]>;
    stats(): Promise<{ totalCalls: number; totalTokens: number }>;
  };
}

export type { DatabaseAdapter as Db };
