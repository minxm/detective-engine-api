import type { DatabaseAdapter } from './interface.js';
import { MemoryDatabase } from './memory.js';
import { MongoDbAdapter } from './mongodb.js';

let dbInstance: DatabaseAdapter | null = null;

export function getDatabase(): DatabaseAdapter {
  if (dbInstance) return dbInstance;

  const adapter = process.env.DB_ADAPTER ?? 'memory';
  switch (adapter) {
    case 'mongodb': {
      const uri = process.env.MONGODB_URI;
      if (!uri) throw new Error('DB_ADAPTER=mongodb 但未配置 MONGODB_URI');
      dbInstance = new MongoDbAdapter(uri, process.env.MONGODB_DB ?? 'detective');
      break;
    }
    case 'memory':
    default:
      dbInstance = new MemoryDatabase(process.env.DB_DATA_DIR ?? './data');
      break;
  }

  return dbInstance;
}

export function resetDatabaseForTests() {
  dbInstance = null;
}

export type { DatabaseAdapter };
