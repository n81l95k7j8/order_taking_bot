import type {
  ConversationData,
  ConversationStorage,
  VersionedState,
} from '@grammyjs/conversations';
import type { Context } from 'grammy';
import type { StringKeyValueStore } from './keyValueStore';

export const CONVERSATION_STATE_KEY = 'state';
export const CONVERSATION_STORAGE_VERSION = 2;
export const CONVERSATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createPersistentConversationStorage<C extends Context>(
  storeForKey: (storageKey: string) => StringKeyValueStore,
): ConversationStorage<C, ConversationData> {
  return {
    type: 'key',
    version: CONVERSATION_STORAGE_VERSION,
    getStorageKey: (ctx) => ctx.chatId?.toString(),
    adapter: {
      async read(key) {
        const store = storeForKey(key);
        const raw = await store.get(CONVERSATION_STATE_KEY);
        if (!raw) return undefined;

        try {
          return JSON.parse(raw) as VersionedState<ConversationData>;
        } catch (err) {
          console.warn(`[conversationStorage] Dropping invalid conversation state for ${key}`, err);
          await store.delete(CONVERSATION_STATE_KEY);
          return undefined;
        }
      },
      async write(key, state) {
        await storeForKey(key).put(CONVERSATION_STATE_KEY, JSON.stringify(state), {
          expirationTtl: CONVERSATION_TTL_SECONDS,
        });
      },
      async delete(key) {
        await storeForKey(key).delete(CONVERSATION_STATE_KEY);
      },
    },
  };
}
