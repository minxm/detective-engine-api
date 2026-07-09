import { getDatabase } from './index.js';
import { withRetry } from '../utils/retry.js';

/** 服务启动时预热数据库连接，避免首请求 TLS 握手失败 */
export async function warmupDatabase(): Promise<void> {
  try {
    const db = getDatabase();
    await withRetry(
      async () => {
        await db.users.list(1);
      },
      { retries: 3, delayMs: 400 },
    );
    console.log('[detective-engine-api] database warmup ok');
  } catch (err) {
    console.warn('[detective-engine-api] database warmup failed:', (err as Error).message);
  }
}
