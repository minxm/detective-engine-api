import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { requireAdminUser } from '../../src/auth/admin-guard.js';
import { getDatabase } from '../../src/db/index.js';
import { listOnlineUsers } from '../../src/services/job-cache.js';
import { parsePageQuery } from '../../src/utils/pagination.js';
import type { AiLogRecord, InventoryRecord, LoginAuditRecord } from '../../src/types/index.js';

function adminForbidden() {
  return jsonResponse({ success: false, error: '无权限' }, 403);
}

export async function handleAdminOnlineUsers(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) return adminForbidden();
  const { page, limit } = parsePageQuery(ctx.query);
  const result = await listOnlineUsers(page, limit);
  return jsonResponse({ success: true, ...result });
}

export async function handleAdminInventoryList(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) return adminForbidden();
  const { page, limit } = parsePageQuery(ctx.query);
  const db = getDatabase();
  const result = await db.inventory.listPaginated({
    page,
    limit,
    status: ctx.query.status as InventoryRecord['status'] | undefined,
    difficulty: ctx.query.difficulty,
  });
  // 并行查询每个库存项的领取用户数
  const items = await Promise.all(
    result.items.map(async (item) => ({
      _id: item._id,
      caseId: item.caseId,
      title: item.caseData.title,
      difficulty: item.difficulty,
      status: item.status,
      claimedBy: item.claimedBy,
      claimCount: await db.claims.countByCaseId(item.caseId),
      createdAt: item.createdAt,
    }))
  );
  return jsonResponse({ success: true, ...result, items });
}

/** 获取某预生成案件的领取用户分页列表 */
export async function handleAdminInventoryClaims(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) return adminForbidden();
  const caseId = ctx.query.caseId;
  if (!caseId) return jsonResponse({ success: false, error: '缺少 caseId' }, 400);
  const { page, limit } = parsePageQuery(ctx.query);
  const db = getDatabase();
  const result = await db.claims.listByCaseId(caseId, page, limit);
  return jsonResponse({ success: true, ...result });
}

export async function handleAdminAiLogs(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) return adminForbidden();
  const { page, limit } = parsePageQuery(ctx.query);
  const db = getDatabase();
  const result = await db.aiLogs.listPaginated({
    page,
    limit,
    type: ctx.query.type as AiLogRecord['type'] | undefined,
  });
  return jsonResponse({ success: true, ...result });
}

export async function handleAdminAiLogDelete(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) return adminForbidden();
  const logId = ctx.query.id;
  if (!logId) return jsonResponse({ success: false, error: '缺少 logId' }, 400);
  const db = getDatabase();
  const deleted = await db.aiLogs.deleteById(logId);
  if (!deleted) return jsonResponse({ success: false, error: '日志不存在' }, 404);
  return jsonResponse({ success: true });
}

export async function handleAdminAiLogsCleanup(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) return adminForbidden();
  const body = (ctx.body ?? {}) as { type?: AiLogRecord['type']; olderThanDays?: number };
  const db = getDatabase();
  const olderThanMs = body.olderThanDays ? body.olderThanDays * 86_400_000 : 30 * 86_400_000;
  const removed = await db.aiLogs.deleteMany({
    type: body.type,
    olderThanMs,
  });
  return jsonResponse({
    success: true,
    removed,
    message: `已清理 ${removed} 条 AI 日志`,
  });
}

export async function handleAdminLoginAudits(ctx: CloudContext): Promise<Response> {
  if (!(await requireAdminUser(ctx.headers))) return adminForbidden();
  const { page, limit } = parsePageQuery(ctx.query);
  const db = getDatabase();
  const result = await db.loginAudits.listPaginated({
    page,
    limit,
    source: ctx.query.source as LoginAuditRecord['source'] | undefined,
    auditOnly: true,
  });
  return jsonResponse({ success: true, ...result });
}
