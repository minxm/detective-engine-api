import type { CloudContext } from '../../src/router/index.js';
import { jsonResponse } from '../../src/utils/index.js';
import { getDatabase } from '../../src/db/index.js';
import type { Difficulty } from '../../src/types/index.js';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];

export async function handleCaseInventoryHint(ctx: CloudContext): Promise<Response> {
  const db = getDatabase();
  const counts = await db.inventory.countByDifficulty();
  const total = DIFFICULTIES.reduce((sum, d) => sum + (counts[d] ?? 0), 0);

  const difficulty = ctx.query.difficulty;
  if (difficulty && DIFFICULTIES.includes(difficulty as Difficulty)) {
    return jsonResponse({
      success: true,
      difficulty,
      available: counts[difficulty] ?? 0,
      counts,
      total,
    });
  }

  return jsonResponse({ success: true, counts, total });
}
