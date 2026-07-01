// src/index.ts
import { Hono } from 'hono';
import type { Env } from './types/env';
import { createHonoHandler } from './app/createBot';
import { createPersistentOrderStore, setOrderStore } from './orders/orderStore';
import {
  BotStateDurableObject,
  createDurableObjectStoreFactory,
  type StringKeyValueStore,
} from './storage/keyValueStore';
import { markUpdateProcessed } from './app/updateDedup';

export { BotStateDurableObject };

const app = new Hono<{ Bindings: Env }>();

const inMemoryUpdateValues = new Map<string, string>();
const inMemoryUpdateStore: StringKeyValueStore = {
  async get(key) {
    return inMemoryUpdateValues.get(key) ?? null;
  },
  async put(key, value) {
    inMemoryUpdateValues.set(key, value);
  },
  async delete(key) {
    inMemoryUpdateValues.delete(key);
  },
};

// Health check
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    name: 'AI Order Bot',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
    config: {
      telegram_bot_configured: !!c.env.TELEGRAM_BOT_TOKEN,
      webhook_secret_configured: !!c.env.TELEGRAM_WEBHOOK_SECRET,
      owner_id_configured: !!c.env.OWNER_TELEGRAM_ID,
      durable_state_configured: !!c.env.BOT_STATE,
    },
  });
});

// Telegram webhook endpoint
app.post('/webhook', async (c) => {
  // Validate token.
  if (!c.env.TELEGRAM_BOT_TOKEN) {
    return c.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, 500);
  }

  // Validate webhook secret.
  if (c.env.TELEGRAM_WEBHOOK_SECRET) {
    const secretHeader = c.req.header('x-telegram-bot-api-secret-token');
    if (secretHeader !== c.env.TELEGRAM_WEBHOOK_SECRET) {
      console.warn('Invalid webhook secret received');
      return c.json({ error: 'Invalid secret' }, 403);
    }
  }

  try {
    if (!c.env.BOT_STATE && c.env.ENVIRONMENT === 'production') {
      console.error('BOT_STATE Durable Object binding is required in production');
      return c.json({ error: 'BOT_STATE binding not configured' }, 500);
    }

    const conversationStoreFactory = c.env.BOT_STATE
      ? createDurableObjectStoreFactory(c.env.BOT_STATE, 'conversation')
      : undefined;

    if (c.env.BOT_STATE) {
      setOrderStore(
        createPersistentOrderStore(
          createDurableObjectStoreFactory(c.env.BOT_STATE, 'orders')('global'),
        ),
      );
    }

    const rawUpdate = await c.req.raw.clone().json().catch(() => null);
    if (!rawUpdate || typeof rawUpdate !== 'object') {
      return c.json({ error: 'Invalid Telegram update payload' }, 400);
    }

    if (typeof (rawUpdate as { update_id?: unknown }).update_id === 'number') {
      const updateStore = c.env.BOT_STATE
        ? createDurableObjectStoreFactory(c.env.BOT_STATE, 'updates')('global')
        : inMemoryUpdateStore;
      const shouldProcess = await markUpdateProcessed(
        updateStore,
        (rawUpdate as { update_id: number }).update_id,
      );
      if (!shouldProcess) {
        return c.json({ ok: true, duplicate: true });
      }
    }

    const handler = createHonoHandler(c.env.TELEGRAM_BOT_TOKEN, {
      ownerTelegramId: c.env.OWNER_TELEGRAM_ID,
      conversationStoreFactory,
    });
    return await handler(c);
  } catch (err) {
    console.error('Webhook handler error:', err);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// 404
app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

// Global error handler.
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
