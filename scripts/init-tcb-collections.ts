/**
 * 在 TCB 内置文档库中创建项目所需的 11 个集合，并删除已废弃集合。
 * 用法：DB_ADAPTER=cloudbase tsx scripts/init-tcb-collections.ts
 */
import 'dotenv/config';
import { deleteCloudBaseCollection, getCloudBaseDb } from '../src/db/cloudbase-client.js';

const OBSOLETE_COLLECTIONS = ['jobs', 'activity_daily'] as const;

const COLLECTIONS = [
  'users',
  'cases',
  'sessions',
  'history',
  'leaderboard',
  'inventory',
  'ai_logs',
  'claims',
  'login_audits',
  'generation_jobs',
  'online_presence',
] as const;

async function main() {
  const db = getCloudBaseDb();

  for (const name of OBSOLETE_COLLECTIONS) {
    try {
      const { missing } = await deleteCloudBaseCollection(name);
      if (missing) {
        console.log(`[skip] obsolete collection not found: ${name}`);
      } else {
        console.log(`[ok] deleted obsolete collection: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[fail] delete obsolete ${name}: ${message}`);
    }
  }

  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name);
      console.log(`[ok] created collection: ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('exist') || message.includes('已存在') || message.includes('ResourceInUse')) {
        console.log(`[skip] collection already exists: ${name}`);
      } else {
        console.error(`[fail] ${name}: ${message}`);
      }
    }
  }

  console.log('Done. Set collection permissions to "仅管理端可读写" in TCB console.');
}

main().catch((error) => {
  console.error('[init-tcb-collections]', error instanceof Error ? error.message : error);
  process.exit(1);
});
