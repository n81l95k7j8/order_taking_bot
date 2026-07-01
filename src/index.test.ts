import { describe, it, expect, beforeEach, vi } from 'vitest';

const { createHonoHandlerMock } = vi.hoisted(() => ({
  createHonoHandlerMock: vi.fn(),
}));

vi.mock('./app/createBot', () => ({
  createHonoHandler: createHonoHandlerMock,
}));

import app from './index';

describe('webhook update deduplication', () => {
  beforeEach(() => {
    createHonoHandlerMock.mockReset();
    createHonoHandlerMock.mockReturnValue(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('ignores a duplicate Telegram update_id', async () => {
    const env = {
      ENVIRONMENT: 'test',
      TELEGRAM_BOT_TOKEN: '123:test',
      TELEGRAM_WEBHOOK_SECRET: 'secret',
      OWNER_TELEGRAM_ID: '2000',
      BOT_STATE: undefined,
    };
    const update = { update_id: 777, message: { message_id: 1 } };

    const first = await app.request('/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'secret',
      },
      body: JSON.stringify(update),
    }, env as any);

    expect(first.status).toBe(200);
    expect(createHonoHandlerMock).toHaveBeenCalledTimes(1);

    const second = await app.request('/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': 'secret',
      },
      body: JSON.stringify(update),
    }, env as any);

    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(createHonoHandlerMock).toHaveBeenCalledTimes(1);
  });
});
