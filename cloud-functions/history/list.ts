import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { resolveAuthUserId } from '../../src/auth/cloudbase.js';
import { getDatabase } from '../../src/db/index.js';
import {
  parseHistoryListQuery,
  toHistoryListResponse,
  toPaginatedHistoryResponse,
  type HistoryStats,
} from '../../src/services/history-list.js';

async function getHistoryStats(userId: string): Promise<HistoryStats> {
  const db = getDatabase();
  const [total, active, completed] = await Promise.all([
    db.history.countByUser(userId),
    db.history.countByUser(userId, 'in_progress'),
    db.history.countByUser(userId, 'completed'),
  ]);
  return { total, active, completed };
}

export async function handleHistoryList(ctx: CloudContext): Promise<Response> {
  const userId = await resolveAuthUserId(ctx.headers);
  if (!userId) {
    return jsonResponse({ success: false, error: '未登录' }, 401);
  }

  const { page, limit, status } = parseHistoryListQuery(ctx.query);
  const db = getDatabase();
  const [result, stats] = await Promise.all([
    db.history.listPaginated(userId, { page, limit, status }),
    getHistoryStats(userId),
  ]);

  return jsonResponse({
    success: true,
    ...toPaginatedHistoryResponse(result, stats),
  });
}

export async function handleHistoryStats(ctx: CloudContext): Promise<Response> {
  const userId = await resolveAuthUserId(ctx.headers);
  if (!userId) {
    return jsonResponse({ success: false, error: '未登录' }, 401);
  }
  const stats = await getHistoryStats(userId);
  return jsonResponse({ success: true, stats });
}

export async function handleHistoryItem(ctx: CloudContext): Promise<Response> {
  const userId = await resolveAuthUserId(ctx.headers);
  if (!userId) {
    return jsonResponse({ success: false, error: '未登录' }, 401);
  }
  const caseId = ctx.query.caseId?.trim();
  if (!caseId) {
    return jsonResponse({ success: false, error: '缺少 caseId' }, 400);
  }
  const db = getDatabase();
  const entry = await db.history.findByUserAndCase(userId, caseId);
  return jsonResponse({
    success: true,
    entry: entry ? toHistoryListResponse(entry) : null,
  });
}
