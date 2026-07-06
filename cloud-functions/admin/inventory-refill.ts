import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse, verifyAdminSecret } from '../../src/utils/index.js';
import { isAdminRole } from '../../src/auth/roles.js';
import { resolveAuthUser } from '../../src/auth/cloudbase.js';
import { getDatabase } from '../../src/db/index.js';
import { generateCaseWithAI } from '../../src/ai/index.js';
import { enrichCaseWithBlobImages } from '../../src/services/image-service.js';
import { caseDataToInventory, caseDataToRecord } from '../../src/services/case-service.js';
import type { Difficulty } from '../../src/types/index.js';

export async function handleInventoryRefill(ctx: CloudContext): Promise<Response> {
  const authUser = await resolveAuthUser(ctx.headers);
  if (!isAdminRole(authUser?.role) && !verifyAdminSecret(ctx.headers)) {
    return jsonResponse({ success: false, error: '无权限' }, 403);
  }

  const body = (ctx.body ?? {}) as { difficulty?: Difficulty; count?: number };
  const difficulty = body.difficulty ?? 'medium';
  const count = Math.min(body.count ?? 1, 5);
  const db = getDatabase();
  const created: string[] = [];

  for (let i = 0; i < count; i++) {
    let caseData = await generateCaseWithAI(difficulty, authUser?.userId);
    caseData = await enrichCaseWithBlobImages(caseData);
    await db.cases.create(caseDataToRecord(caseData));
    await db.inventory.add(caseDataToInventory(caseData));
    created.push(caseData.id);
  }

  return jsonResponse({ success: true, created, inventoryCounts: await db.inventory.countByDifficulty() });
}
