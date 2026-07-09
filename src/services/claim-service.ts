import { generateId, now } from '../utils/index.js';
import { getDatabase } from '../db/index.js';
import type { ClaimRecord, InventoryRecord } from '../types/index.js';

type ClaimUser = { userId: string; nickname?: string } | null;

/** 记录用户领取库存案件（含从库存分配与实时生成入库后自动领取） */
export async function recordCaseClaim(
  authUser: ClaimUser,
  inventory: Pick<InventoryRecord, '_id' | 'caseId'>,
): Promise<void> {
  const userId = authUser?.userId;
  if (!userId) return;

  const db = getDatabase();
  if (await db.claims.hasUserClaimedCase(userId, inventory.caseId)) {
    console.warn('[Case] 用户已领取过该案件，跳过重复 claim:', userId, inventory.caseId);
    return;
  }

  const claim: ClaimRecord = {
    _id: generateId(),
    inventoryId: inventory._id,
    caseId: inventory.caseId,
    userId,
    nickname: authUser.nickname ?? '匿名',
    claimedAt: now(),
  };
  try {
    await db.claims.add(claim);
  } catch (err) {
    console.warn('[Case] 记录领取失败，不影响案件分配:', (err as Error).message);
  }
}
