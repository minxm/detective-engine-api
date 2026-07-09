import { getDatabase } from '../db/index.js';
import { generateCaseWithAI } from '../ai/index.js';
import { enrichCaseWithBlobImages } from './image-service.js';
import { caseDataToInventory, caseDataToRecord } from './case-service.js';
import { withRetry } from '../utils/retry.js';
import type { CaseData, Difficulty, InventoryRecord } from '../types/index.js';
export type CaseGenerationStage = 'generating' | 'images' | 'persisting';

export type PersistedCase = {
  caseData: CaseData;
  inventory: InventoryRecord;
};

/** 仅生成案件（文案 + 生图），不入库；任一步失败则抛错 */
export async function generateCaseOnly(
  difficulty: Difficulty,
  userId?: string,
  onStage?: (stage: CaseGenerationStage) => void | Promise<void>
): Promise<CaseData> {
  onStage?.('generating');
  const caseData = await generateCaseWithAI(difficulty, userId);
  onStage?.('images');
  const enriched = await enrichCaseWithBlobImages(caseData);
  return enriched;
}

/** 将已完整生成的案件写入 cases 与 inventory */
export async function persistGeneratedCase(enriched: CaseData): Promise<PersistedCase> {
  const db = getDatabase();
  const inventory = caseDataToInventory(enriched);
  await withRetry(() => db.cases.create(caseDataToRecord(enriched)), { retries: 2, delayMs: 400 });
  await withRetry(() => db.inventory.add(inventory), { retries: 2, delayMs: 400 });
  return { caseData: enriched, inventory };
}
/** 完整生成案件（文案 + 全部生图），全部成功后才入库 */
export async function generateAndPersistCase(
  difficulty: Difficulty,
  userId?: string,
  onStage?: (stage: CaseGenerationStage) => void | Promise<void>
): Promise<PersistedCase> {
  const enriched = await generateCaseOnly(difficulty, userId, onStage);
  onStage?.('persisting');
  return persistGeneratedCase(enriched);
}
