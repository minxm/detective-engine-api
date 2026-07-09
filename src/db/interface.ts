import type {
  CaseRecord,
  ClaimRecord,
  HistoryListItem,
  HistoryRecord,
  InventoryRecord,
  LeaderboardRecord,
  SessionRecord,
  UserRecord,
  AiLogRecord,
  LoginAuditRecord,
  GenerationJob,
  OnlinePresenceRecord,
  RefillJob,
} from '../types/index.js';
import type { PaginatedResult } from '../utils/pagination.js';

export type InventoryListQuery = {
  page?: number;
  limit?: number;
  status?: 'available' | 'claimed';
  difficulty?: string;
};

export type AiLogsListQuery = {
  page?: number;
  limit?: number;
  type?: AiLogRecord['type'];
};

export type HistoryListQuery = {
  page?: number;
  limit?: number;
  status?: 'in_progress' | 'completed';
};

export type LoginAuditsListQuery = {
  page?: number;
  limit?: number;
  source?: LoginAuditRecord['source'];
  /** 为 true 时仅返回 login/register（兼容历史 online 记录） */
  auditOnly?: boolean;
};

export interface DatabaseAdapter {
  users: {
    findById(id: string): Promise<UserRecord | null>;
    findByUsername(username: string): Promise<UserRecord | null>;
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
    listByUser(userId: string, limit?: number): Promise<HistoryListItem[]>;
    listPaginated(userId: string, query: HistoryListQuery): Promise<PaginatedResult<HistoryListItem>>;
    countByUser(userId: string, status?: HistoryListItem['status']): Promise<number>;
    findByUserAndCase(userId: string, caseId: string): Promise<HistoryListItem | null>;
    upsert(record: HistoryRecord): Promise<HistoryRecord>;
  };
  leaderboard: {
    list(limit?: number): Promise<LeaderboardRecord[]>;
    upsert(record: LeaderboardRecord): Promise<LeaderboardRecord>;
    findByUser(userId: string): Promise<LeaderboardRecord | null>;
  };
  inventory: {
    /** 兼容旧逻辑：领取后将 status 标记为 claimed（管理员手动退库用） */
    claimAvailable(difficulty: string, userId?: string): Promise<InventoryRecord | null>;
    /** 多用户共享：找到一个可用案件但不改变其状态，excludeIds 用于跳过已遍历项 */
    pickAvailable(difficulty: string, excludeIds?: string[]): Promise<InventoryRecord | null>;
    add(record: InventoryRecord): Promise<InventoryRecord>;
    countByDifficulty(): Promise<Record<string, number>>;
    countByCaseId(caseId: string): Promise<number>;
    list(limit?: number): Promise<InventoryRecord[]>;
    listPaginated(query: InventoryListQuery): Promise<PaginatedResult<InventoryRecord>>;
  };
  claims: {
    add(record: ClaimRecord): Promise<ClaimRecord>;
    countByCaseId(caseId: string): Promise<number>;
    listByCaseId(caseId: string, page: number, limit: number): Promise<PaginatedResult<ClaimRecord>>;
    listClaimedCaseIdsByUser(userId: string): Promise<string[]>;
    hasUserClaimedCase(userId: string, caseId: string): Promise<boolean>;
  };
  aiLogs: {
    add(log: AiLogRecord): Promise<AiLogRecord>;
    list(limit?: number): Promise<AiLogRecord[]>;
    listPaginated(query: AiLogsListQuery): Promise<PaginatedResult<AiLogRecord>>;
    stats(): Promise<{ totalCalls: number; totalTokens: number }>;
    deleteById(id: string): Promise<boolean>;
    deleteMany(filter: { type?: AiLogRecord['type']; olderThanMs?: number }): Promise<number>;
  };
  loginAudits: {
    add(record: LoginAuditRecord): Promise<LoginAuditRecord>;
    listPaginated(query: LoginAuditsListQuery): Promise<PaginatedResult<LoginAuditRecord>>;
    listSince(sinceMs: number): Promise<LoginAuditRecord[]>;
    hasToday(userId: string, source: LoginAuditRecord['source'], sinceMs: number): Promise<boolean>;
    deleteOlderThan(cutoffMs: number): Promise<number>;
  };
  generationJobs: {
    findById(id: string): Promise<GenerationJob | null>;
    upsert(job: GenerationJob): Promise<GenerationJob>;
  };
  onlinePresence: {
    upsert(record: OnlinePresenceRecord): Promise<OnlinePresenceRecord>;
    listActive(sinceMs: number, page: number, limit: number): Promise<PaginatedResult<OnlinePresenceRecord>>;
  };
  refillJobs: {
    findById(id: string): Promise<RefillJob | null>;
    upsert(job: RefillJob): Promise<RefillJob>;
  };
}

export type { DatabaseAdapter as Db };
