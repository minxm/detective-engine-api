import type { KvAdapter } from './interface.js';

type Entry = { value: string; expiresAt?: number };

export class MemoryKvAdapter implements KvAdapter {
  private store = new Map<string, Entry>();

  private cleanup(key: string, entry: Entry | undefined) {
    if (entry?.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry?.value ?? null;
  }

  async get(key: string): Promise<string | null> {
    return this.cleanup(key, this.store.get(key));
  }

  async put(key: string, value: string, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async increment(key: string, delta = 1): Promise<number> {
    const current = Number((await this.get(key)) ?? '0');
    const next = current + delta;
    await this.put(key, String(next));
    return next;
  }
}
