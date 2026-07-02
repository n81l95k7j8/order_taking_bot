import { describe, it, expect, vi } from 'vitest';
import { markUpdateProcessed } from './updateDedup';
import type { StringKeyValueStore } from '../storage/keyValueStore';

class MemoryStringStore implements StringKeyValueStore {
  values = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

describe('markUpdateProcessed', () => {
  it('accepts a new update id once with the fallback store API', async () => {
    const store = new MemoryStringStore();
    await expect(markUpdateProcessed(store, 123)).resolves.toBe(true);
    await expect(markUpdateProcessed(store, 123)).resolves.toBe(false);
  });

  it('uses markIfAbsent when the store supports an atomic check-and-set', async () => {
    const markIfAbsent = vi.fn<NonNullable<StringKeyValueStore['markIfAbsent']>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const store: StringKeyValueStore = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      markIfAbsent,
    };

    await expect(markUpdateProcessed(store, 777)).resolves.toBe(true);
    await expect(markUpdateProcessed(store, 777)).resolves.toBe(false);
    expect(markIfAbsent).toHaveBeenNthCalledWith(1, 'update:777', '1', { expirationTtl: 24 * 60 * 60 });
    expect(store.get).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });
});
