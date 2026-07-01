import { describe, expect, it } from 'vitest';
import { uniformStorage, type ConversationData } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import {
  CONVERSATION_STATE_KEY,
  CONVERSATION_TTL_SECONDS,
  createPersistentConversationStorage,
} from './conversationStorage';
import type { StringKeyValueStore } from './keyValueStore';

class MemoryStringStore implements StringKeyValueStore {
  values = new Map<string, string>();
  ttls = new Map<string, number | undefined>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.values.set(key, value);
    this.ttls.set(key, options?.expirationTtl);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
    this.ttls.delete(key);
  }
}

describe('createPersistentConversationStorage', () => {
  it('persists conversation data by chat id with TTL', async () => {
    const stores = new Map<string, MemoryStringStore>();
    const storage = uniformStorage(
      createPersistentConversationStorage<Context>((key) => {
        const existing = stores.get(key);
        if (existing) return existing;
        const store = new MemoryStringStore();
        stores.set(key, store);
        return store;
      }),
    );
    const chatStorage = storage({ chatId: 42 } as Context);
    const state: ConversationData = { orderConversation: [] };

    await chatStorage.write(state);

    const store = stores.get('42');
    expect(store).toBeDefined();
    expect(store?.values.has(CONVERSATION_STATE_KEY)).toBe(true);
    expect(store?.ttls.get(CONVERSATION_STATE_KEY)).toBe(CONVERSATION_TTL_SECONDS);
    await expect(chatStorage.read()).resolves.toEqual(state);

    await chatStorage.delete();
    await expect(chatStorage.read()).resolves.toBeUndefined();
  });

  it('drops invalid JSON state instead of crashing a chat forever', async () => {
    const store = new MemoryStringStore();
    const storage = uniformStorage(createPersistentConversationStorage<Context>(() => store));
    const chatStorage = storage({ chatId: 42 } as Context);
    store.values.set(CONVERSATION_STATE_KEY, '{not-json');

    await expect(chatStorage.read()).resolves.toBeUndefined();
    expect(store.values.has(CONVERSATION_STATE_KEY)).toBe(false);
  });
});
