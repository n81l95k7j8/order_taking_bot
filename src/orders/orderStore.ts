// Request storage and pending owner-action storage.
// Development uses in-memory storage. Cloudflare Workers inject durable storage.

import type { FullOrderData } from './notifications';
import type { StringKeyValueStore } from '../storage/keyValueStore';

export type OrderStatus =
  | 'new'
  | 'awaiting_brief'
  | 'brief_sent'
  | 'link_received'
  | 'accepted'
  | 'rejected';

export interface OrderRecord extends FullOrderData {
  status: OrderStatus;
  brief_message_id?: number; // Client brief message id for reply tracking.
  laborx_link?: string;
  reject_reason?: string;
  updated_at: string;
}

export type PendingOwnerAction =
  | { kind: 'awaiting_brief'; order_code: string }
  | { kind: 'awaiting_change_request'; order_code: string }
  | { kind: 'awaiting_reject_reason'; order_code: string };

export interface OrderStore {
  saveOrder(order: FullOrderData): Promise<void>;
  getOrder(order_code: string): Promise<OrderRecord | null>;
  updateOrder(order_code: string, patch: Partial<OrderRecord>): Promise<OrderRecord | null>;
  findByBriefMessage(client_telegram_id: number, message_id: number): Promise<OrderRecord | null>;
  // Active client requests in brief_sent state while waiting for a LaborX link.
  findActiveBriefsByClient(client_telegram_id: number): Promise<OrderRecord[]>;
  // Return one active request when exactly one exists for backward compatibility.
  findActiveBriefByClient(client_telegram_id: number): Promise<OrderRecord | null>;

  setPendingOwnerAction(owner_id: string, action: PendingOwnerAction): Promise<void>;
  getPendingOwnerAction(owner_id: string): Promise<PendingOwnerAction | null>;
  clearPendingOwnerAction(owner_id: string): Promise<void>;
}

class InMemoryOrderStore implements OrderStore {
  private orders = new Map<string, OrderRecord>();
  private pendingByOwner = new Map<string, PendingOwnerAction>();

  async saveOrder(order: FullOrderData): Promise<void> {
    this.orders.set(order.order_code, {
      ...order,
      status: 'new',
      updated_at: new Date().toISOString(),
    });
  }

  async getOrder(order_code: string): Promise<OrderRecord | null> {
    return this.orders.get(order_code) ?? null;
  }

  async updateOrder(order_code: string, patch: Partial<OrderRecord>): Promise<OrderRecord | null> {
    const current = this.orders.get(order_code);
    if (!current) return null;
    const next: OrderRecord = { ...current, ...patch, updated_at: new Date().toISOString() };
    this.orders.set(order_code, next);
    return next;
  }

  async findByBriefMessage(client_telegram_id: number, message_id: number): Promise<OrderRecord | null> {
    for (const o of this.orders.values()) {
      if (o.client.telegram_user_id === client_telegram_id && o.brief_message_id === message_id) {
        return o;
      }
    }
    return null;
  }

  async findActiveBriefsByClient(client_telegram_id: number): Promise<OrderRecord[]> {
    return Array.from(this.orders.values())
      .filter((o) => o.client.telegram_user_id === client_telegram_id && o.status === 'brief_sent')
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  }

  async findActiveBriefByClient(client_telegram_id: number): Promise<OrderRecord | null> {
    const active = await this.findActiveBriefsByClient(client_telegram_id);
    return active.length === 1 ? active[0] : null;
  }

  async setPendingOwnerAction(owner_id: string, action: PendingOwnerAction): Promise<void> {
    this.pendingByOwner.set(owner_id, action);
  }

  async getPendingOwnerAction(owner_id: string): Promise<PendingOwnerAction | null> {
    return this.pendingByOwner.get(owner_id) ?? null;
  }

  async clearPendingOwnerAction(owner_id: string): Promise<void> {
    this.pendingByOwner.delete(owner_id);
  }
}

const KEY = {
  order: (code: string) => `order:${code}`,
  briefIndex: (clientId: number, messageId: number) => `brief:${clientId}:${messageId}`,
  activeBrief: (clientId: number) => `active_brief:${clientId}`,
  pending: (ownerId: string) => `pending:${ownerId}`,
};

// TTL: pending owner actions live for one day, requests live for 90 days.
const TTL_PENDING_SECONDS = 24 * 60 * 60;
const TTL_ORDER_SECONDS = 90 * 24 * 60 * 60;

class PersistentOrderStore implements OrderStore {
  constructor(private store: StringKeyValueStore) {}

  async saveOrder(order: FullOrderData): Promise<void> {
    const record: OrderRecord = {
      ...order,
      status: 'new',
      updated_at: new Date().toISOString(),
    };
    await this.store.put(KEY.order(order.order_code), JSON.stringify(record), {
      expirationTtl: TTL_ORDER_SECONDS,
    });
  }

  async getOrder(order_code: string): Promise<OrderRecord | null> {
    const raw = await this.store.get(KEY.order(order_code));
    return raw ? (JSON.parse(raw) as OrderRecord) : null;
  }

  async updateOrder(order_code: string, patch: Partial<OrderRecord>): Promise<OrderRecord | null> {
    const current = await this.getOrder(order_code);
    if (!current) return null;
    const prevBrief = current.brief_message_id;
    const prevStatus = current.status;
    const next: OrderRecord = { ...current, ...patch, updated_at: new Date().toISOString() };
    await this.store.put(KEY.order(order_code), JSON.stringify(next), {
      expirationTtl: TTL_ORDER_SECONDS,
    });
    // Secondary index: brief_message_id to order_code.
    if (next.brief_message_id && next.brief_message_id !== prevBrief) {
      await this.store.put(
        KEY.briefIndex(next.client.telegram_user_id, next.brief_message_id),
        order_code,
        { expirationTtl: TTL_ORDER_SECONDS },
      );
    }
    // Index active brief_sent requests by client.
    const becameBrief = prevStatus !== 'brief_sent' && next.status === 'brief_sent';
    const leftBrief = prevStatus === 'brief_sent' && next.status !== 'brief_sent';
    if (becameBrief || leftBrief) {
      const activeKey = KEY.activeBrief(next.client.telegram_user_id);
      const rawCodes = await this.store.get(activeKey);
      const codes = rawCodes ? (JSON.parse(rawCodes) as string[]) : [];
      const nextCodes = becameBrief
        ? Array.from(new Set([...codes, order_code]))
        : codes.filter((code) => code !== order_code);

      if (nextCodes.length === 0) {
        await this.store.delete(activeKey);
      } else {
        await this.store.put(activeKey, JSON.stringify(nextCodes), {
          expirationTtl: TTL_ORDER_SECONDS,
        });
      }
    }
    return next;
  }

  async findByBriefMessage(client_telegram_id: number, message_id: number): Promise<OrderRecord | null> {
    const code = await this.store.get(KEY.briefIndex(client_telegram_id, message_id));
    if (!code) return null;
    return this.getOrder(code);
  }

  async findActiveBriefsByClient(client_telegram_id: number): Promise<OrderRecord[]> {
    const rawCodes = await this.store.get(KEY.activeBrief(client_telegram_id));
    if (!rawCodes) return [];

    const codes = JSON.parse(rawCodes) as string[];
    const orders = await Promise.all(codes.map((code) => this.getOrder(code)));
    return orders
      .filter((order): order is OrderRecord => !!order && order.status === 'brief_sent')
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  }

  async findActiveBriefByClient(client_telegram_id: number): Promise<OrderRecord | null> {
    const active = await this.findActiveBriefsByClient(client_telegram_id);
    return active.length === 1 ? active[0] : null;
  }

  async setPendingOwnerAction(owner_id: string, action: PendingOwnerAction): Promise<void> {
    await this.store.put(KEY.pending(owner_id), JSON.stringify(action), {
      expirationTtl: TTL_PENDING_SECONDS,
    });
  }

  async getPendingOwnerAction(owner_id: string): Promise<PendingOwnerAction | null> {
    const raw = await this.store.get(KEY.pending(owner_id));
    return raw ? (JSON.parse(raw) as PendingOwnerAction) : null;
  }

  async clearPendingOwnerAction(owner_id: string): Promise<void> {
    await this.store.delete(KEY.pending(owner_id));
  }
}

let _store: OrderStore | null = null;

export function getOrderStore(): OrderStore {
  if (!_store) _store = new InMemoryOrderStore();
  return _store;
}

// Injected by the Workers webhook handler so each request uses durable storage.
// Development polling keeps the default in-memory implementation.
export function setOrderStore(store: OrderStore): void {
  _store = store;
}

export function createPersistentOrderStore(store: StringKeyValueStore): OrderStore {
  return new PersistentOrderStore(store);
}
