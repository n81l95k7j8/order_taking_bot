import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPersistentOrderStore,
  getOrderStore,
  setOrderStore,
  type OrderStore,
} from './orderStore';
import type { FullOrderData } from './notifications';
import type { StringKeyValueStore } from '../storage/keyValueStore';

function makeOrder(code: string, clientId = 111): FullOrderData {
  return {
    description: 'lorem',
    budget: 'Under $500',
    deadline: 'Urgent',
    techStack: 'Node.js',
    client: { telegram_user_id: clientId, first_name: 'A' },
    created_at: '2026-06-29T00:00:00.000Z',
    order_code: code,
  };
}

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

describe('InMemoryOrderStore', () => {
  let store: OrderStore;

  beforeEach(() => {
    // Singleton in-memory store; each test uses unique codes/ids to stay
    // isolated, no reset needed.
    store = getOrderStore();
  });

  it('saves and retrieves an order with status=new', async () => {
    const code = '#TEST-SAVE-' + Math.random().toString(36).slice(2);
    await store.saveOrder(makeOrder(code));
    const got = await store.getOrder(code);
    expect(got).not.toBeNull();
    expect(got!.status).toBe('new');
    expect(got!.order_code).toBe(code);
  });

  it('returns null for unknown code', async () => {
    expect(await store.getOrder('#NOPE-' + Math.random())).toBeNull();
  });

  it('updateOrder merges patch and bumps updated_at', async () => {
    const code = '#TEST-UPD-' + Math.random().toString(36).slice(2);
    await store.saveOrder(makeOrder(code));
    const updated = await store.updateOrder(code, { status: 'awaiting_brief' });
    expect(updated?.status).toBe('awaiting_brief');
    expect(updated?.order_code).toBe(code);
  });

  it('updateOrder returns null for unknown order', async () => {
    expect(await store.updateOrder('#NO-SUCH', { status: 'accepted' })).toBeNull();
  });

  it('findByBriefMessage matches saved brief_message_id', async () => {
    const code = '#TEST-BRIEF-' + Math.random().toString(36).slice(2);
    const clientId = 200_000 + Math.floor(Math.random() * 100_000);
    await store.saveOrder(makeOrder(code, clientId));
    await store.updateOrder(code, { brief_message_id: 9999, status: 'brief_sent' });

    const found = await store.findByBriefMessage(clientId, 9999);
    expect(found?.order_code).toBe(code);

    expect(await store.findByBriefMessage(clientId, 1234)).toBeNull();
    expect(await store.findByBriefMessage(999_999, 9999)).toBeNull();
  });

  it('findActiveBriefByClient returns the only brief_sent order', async () => {
    const clientId = 300_000 + Math.floor(Math.random() * 100_000);
    const code = '#TEST-ACT-ONLY-' + Math.random().toString(36).slice(2);

    await store.saveOrder(makeOrder(code, clientId));
    await store.updateOrder(code, { status: 'brief_sent' });

    const active = await store.findActiveBriefByClient(clientId);
    expect(active?.order_code).toBe(code);
  });

  it('findActiveBriefByClient returns null when multiple active briefs exist', async () => {
    const clientId = 310_000 + Math.floor(Math.random() * 100_000);
    const codeOld = '#TEST-ACT-OLD-' + Math.random().toString(36).slice(2);
    const codeNew = '#TEST-ACT-NEW-' + Math.random().toString(36).slice(2);

    await store.saveOrder(makeOrder(codeOld, clientId));
    await store.updateOrder(codeOld, { status: 'brief_sent' });
    await store.saveOrder(makeOrder(codeNew, clientId));
    await store.updateOrder(codeNew, { status: 'brief_sent' });

    expect(await store.findActiveBriefByClient(clientId)).toBeNull();
    await expect(store.findActiveBriefsByClient(clientId)).resolves.toHaveLength(2);
  });

  it('findActiveBriefByClient ignores non-brief_sent orders', async () => {
    const clientId = 400_000 + Math.floor(Math.random() * 100_000);
    const code = '#TEST-ACC-' + Math.random().toString(36).slice(2);
    await store.saveOrder(makeOrder(code, clientId));
    await store.updateOrder(code, { status: 'accepted' });
    expect(await store.findActiveBriefByClient(clientId)).toBeNull();
  });

  it('pending owner action lifecycle: set → get → clear', async () => {
    const ownerId = 'owner-' + Math.random().toString(36).slice(2);
    expect(await store.getPendingOwnerAction(ownerId)).toBeNull();

    await store.setPendingOwnerAction(ownerId, { kind: 'awaiting_brief', order_code: '#X' });
    const p = await store.getPendingOwnerAction(ownerId);
    expect(p).toEqual({ kind: 'awaiting_brief', order_code: '#X' });

    await store.clearPendingOwnerAction(ownerId);
    expect(await store.getPendingOwnerAction(ownerId)).toBeNull();
  });
});

describe('PersistentOrderStore', () => {
  it('persists orders, lookup indexes, active brief index, and pending owner actions', async () => {
    const backend = new MemoryStringStore();
    const store = createPersistentOrderStore(backend);
    const code = '#TEST-PERSIST-' + Math.random().toString(36).slice(2);
    const clientId = 500_000 + Math.floor(Math.random() * 100_000);

    await store.saveOrder(makeOrder(code, clientId));
    await store.updateOrder(code, { brief_message_id: 12345, status: 'brief_sent' });

    await expect(store.getOrder(code)).resolves.toMatchObject({
      order_code: code,
      status: 'brief_sent',
      brief_message_id: 12345,
    });
    await expect(store.findByBriefMessage(clientId, 12345)).resolves.toMatchObject({
      order_code: code,
    });
    await expect(store.findActiveBriefByClient(clientId)).resolves.toMatchObject({
      order_code: code,
    });
    await expect(store.findActiveBriefsByClient(clientId)).resolves.toHaveLength(1);

    await store.updateOrder(code, { status: 'accepted' });
    await expect(store.findActiveBriefByClient(clientId)).resolves.toBeNull();
    await expect(store.findActiveBriefsByClient(clientId)).resolves.toEqual([]);

    await store.setPendingOwnerAction('937933861', { kind: 'awaiting_brief', order_code: code });
    await expect(store.getPendingOwnerAction('937933861')).resolves.toEqual({
      kind: 'awaiting_brief',
      order_code: code,
    });
    expect(backend.ttls.get(`order:${code}`)).toBe(90 * 24 * 60 * 60);
    expect(backend.ttls.get('pending:937933861')).toBe(24 * 60 * 60);

    await store.clearPendingOwnerAction('937933861');
    await expect(store.getPendingOwnerAction('937933861')).resolves.toBeNull();
    expect(backend.ttls.get('pending:937933861')).toBeUndefined();
  });
  it('removes stale brief lookups after the order leaves brief_sent', async () => {
    const backend = new MemoryStringStore();
    const store = createPersistentOrderStore(backend);
    const code = '#TEST-BRIEF-STALE-' + Math.random().toString(36).slice(2);
    const clientId = 510_000 + Math.floor(Math.random() * 100_000);

    await store.saveOrder(makeOrder(code, clientId));
    await store.updateOrder(code, { brief_message_id: 12345, status: 'brief_sent' });
    await expect(store.findByBriefMessage(clientId, 12345)).resolves.toMatchObject({
      order_code: code,
    });

    await store.updateOrder(code, { status: 'accepted' });
    await expect(store.findByBriefMessage(clientId, 12345)).resolves.toBeNull();
  });

  it('replaces the brief lookup when a new brief message id is stored', async () => {
    const backend = new MemoryStringStore();
    const store = createPersistentOrderStore(backend);
    const code = '#TEST-BRIEF-ROTATE-' + Math.random().toString(36).slice(2);
    const clientId = 520_000 + Math.floor(Math.random() * 100_000);

    await store.saveOrder(makeOrder(code, clientId));
    await store.updateOrder(code, { brief_message_id: 11111, status: 'brief_sent' });
    await store.updateOrder(code, { brief_message_id: 22222, status: 'brief_sent' });

    await expect(store.findByBriefMessage(clientId, 11111)).resolves.toBeNull();
    await expect(store.findByBriefMessage(clientId, 22222)).resolves.toMatchObject({
      order_code: code,
    });
  });
});

describe('setOrderStore', () => {
  it('replaces the singleton', async () => {
    const before = getOrderStore();
    setOrderStore(before); // no-op replacement should still work
    expect(getOrderStore()).toBe(before);
  });
});
