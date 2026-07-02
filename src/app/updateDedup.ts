import type { StringKeyValueStore } from '../storage/keyValueStore';

const UPDATE_TTL_SECONDS = 24 * 60 * 60;

function keyForUpdate(updateId: number): string {
  return `update:${updateId}`;
}

export async function markUpdateProcessed(
  store: StringKeyValueStore,
  updateId: number,
): Promise<boolean> {
  const key = keyForUpdate(updateId);

  if (store.markIfAbsent) {
    return store.markIfAbsent(key, '1', { expirationTtl: UPDATE_TTL_SECONDS });
  }

  const existing = await store.get(key);
  if (existing) return false;

  await store.put(key, '1', { expirationTtl: UPDATE_TTL_SECONDS });
  return true;
}
