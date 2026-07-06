import type { KvAdapter } from './interface.js';
import { MemoryKvAdapter } from './memory.js';
import { EdgeOneKvAdapter } from './edgeone.js';

let kvInstance: KvAdapter | null = null;

export function getKv(): KvAdapter {
  if (kvInstance) return kvInstance;

  const adapter = process.env.KV_ADAPTER ?? 'memory';
  if (
    adapter === 'edgeone' &&
    process.env.EO_SECRET_ID &&
    process.env.EO_SECRET_KEY &&
    process.env.EO_ZONE_ID &&
    process.env.KV_NAMESPACE
  ) {
    kvInstance = new EdgeOneKvAdapter({
      secretId: process.env.EO_SECRET_ID,
      secretKey: process.env.EO_SECRET_KEY,
      zoneId: process.env.EO_ZONE_ID,
      namespace: process.env.KV_NAMESPACE,
    });
  } else {
    kvInstance = new MemoryKvAdapter();
  }

  return kvInstance;
}

export function resetKvForTests() {
  kvInstance = null;
}

export type { KvAdapter };
