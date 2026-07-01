import { describe, it, expect } from 'vitest';
import { markUpdateProcessed } from './updateDedup';
import type { StringKeyValueStore } from '../storage/keyValueStore';

class MemoryStringStore implements StringKeyValueStore {
  values = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

describe('markUpdateProcessed', () => {
  it('accepts a new update id once', async () => {
    const store = new MemoryStringStore();
    await expect(markUpdateProcessed(store, 123)).resolves.toBe(true);
    await expect(markUpdateProcessed(store, 123)).resolves.toBe(false);
  });
});
