import { getDatabase } from '../db/index.js';
import { isFallbackTemplateCase } from '../ai/fallback-case.js';
import type { Difficulty, InventoryRecord } from '../types/index.js';

/** 为当前用户挑选未领取过的库存案件；全部已领完则返回 null，由调用方走现场生成 */
export async function pickInventoryForUser(
  difficulty: Difficulty,
  userId: string | undefined,
): Promise<InventoryRecord | null> {
  const db = getDatabase();
  const claimedCaseIds = userId
    ? new Set(await db.claims.listClaimedCaseIdsByUser(userId))
    : new Set<string>();
  const excludeInventoryIds: string[] = [];

  while (true) {
    const item = await db.inventory.pickAvailable(difficulty, excludeInventoryIds);
    if (!item) return null;

    if (isFallbackTemplateCase(item.caseData)) {
      excludeInventoryIds.push(item._id);
      continue;
    }
    if (claimedCaseIds.has(item.caseId)) {
      excludeInventoryIds.push(item._id);
      continue;
    }
    return item;
  }
}
