import type { HistoryListItem } from '../types/index.js';
import { buildPaginatedResult, paginateArray, type PaginatedResult } from '../utils/pagination.js';

/** 列表接口仅投影这些字段，避免拉取文档中的冗余大字段 */
export const HISTORY_LIST_FIELD_PROJECTION = {
  _id: true,
  userId: true,
  caseId: true,
  caseTitle: true,
  score: true,
  rating: true,
  killerCorrect: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function toHistoryListItem(row: Record<string, unknown>): HistoryListItem | null {
  const id = row._id;
  const caseId = row.caseId;
  if (id == null || caseId == null) return null;

  const status = row.status === 'completed' ? 'completed' : 'in_progress';

  return {
    _id: String(id),
    userId: String(row.userId ?? ''),
    caseId: String(caseId),
    caseTitle: String(row.caseTitle ?? '未命名案件'),
    score: typeof row.score === 'number' ? row.score : null,
    rating: String(row.rating ?? ''),
    killerCorrect: typeof row.killerCorrect === 'boolean' ? row.killerCorrect : null,
    status,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? row.createdAt ?? 0),
  };
}

export function toHistoryListItems(rows: unknown[]): HistoryListItem[] {
  return rows
    .map((row) => toHistoryListItem(row as Record<string, unknown>))
    .filter((item): item is HistoryListItem => item != null);
}

export function toHistoryListResponse(entry: HistoryListItem) {
  return {
    id: entry._id,
    caseId: entry.caseId,
    caseTitle: entry.caseTitle,
    score: entry.score,
    rating: entry.rating,
    killerCorrect: entry.killerCorrect,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
    status: entry.status,
  };
}

export type HistoryListQuery = {
  page?: number;
  limit?: number;
  status?: 'in_progress' | 'completed';
};

export function parseHistoryListQuery(query: Record<string, string>): {
  page: number;
  limit: number;
  skip: number;
  status?: HistoryListQuery['status'];
} {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
  const skip = (page - 1) * limit;
  const raw = query.status ?? query.filter;
  const status =
    raw === 'completed' ? 'completed' :
    raw === 'active' || raw === 'in_progress' ? 'in_progress' :
    undefined;
  return { page, limit, skip, status };
}

export type HistoryStats = {
  total: number;
  active: number;
  completed: number;
};

export function toPaginatedHistoryResponse(
  result: PaginatedResult<HistoryListItem>,
  stats: HistoryStats,
) {
  return {
    entries: result.items.map(toHistoryListResponse),
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
    stats,
  };
}

export { buildPaginatedResult, paginateArray };
