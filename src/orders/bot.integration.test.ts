import { describe, it, expect, beforeEach } from 'vitest';
import { createBot } from '../app/createBot';
import { createPersistentOrderStore, getOrderStore, setOrderStore } from './orderStore';
import type { StringKeyValueStore } from '../storage/keyValueStore';

class MemoryStringStore implements StringKeyValueStore {
  values = new Map<string, string>();
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async put(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

type SentCall = { method: string; body: any };

function createFetchMock() {
  const sent: SentCall[] = [];
  let messageId = 100;
  return {
    sent,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = url.split('/').pop() ?? '';
      const bodyText = typeof init?.body === 'string' ? init.body : '{}';
      const body = JSON.parse(bodyText);
      sent.push({ method, body });

      if (method === 'sendMessage') {
        return new Response(JSON.stringify({
          ok: true,
          result: { message_id: messageId++, chat: { id: body.chat_id, type: 'private' }, date: 0, text: body.text },
        }), { status: 200 });
      }

      if (method === 'answerCallbackQuery' || method === 'editMessageReplyMarkup' || method === 'getMe') {
        return new Response(JSON.stringify({ ok: true, result: method === 'getMe'
          ? { id: 999, is_bot: true, first_name: 'Test', username: 'test_bot' }
          : true }), { status: 200 });
      }

      return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
    },
  };
}

let updateId = 1;
function messageUpdate(userId: number, text: string, messageId: number, replyToMessageId?: number) {
  const commandEntity = text.startsWith('/')
    ? { entities: [{ offset: 0, length: text.split(/\s+/)[0].length, type: 'bot_command' as const }] }
    : {};

  return {
    update_id: updateId++,
    message: {
      message_id: messageId,
      date: 0,
      chat: { id: userId, type: 'private' },
      from: { id: userId, is_bot: false, first_name: `U${userId}` },
      text,
      ...commandEntity,
      ...(replyToMessageId ? {
        reply_to_message: {
          message_id: replyToMessageId,
          date: 0,
          chat: { id: userId, type: 'private' },
          text: 'prev',
        },
      } : {}),
    },
  };
}

function callbackUpdate(userId: number, data: string, callbackId: string, messageId: number) {
  return {
    update_id: updateId++,
    callback_query: {
      id: callbackId,
      from: { id: userId, is_bot: false, first_name: `U${userId}` },
      chat_instance: 'ci',
      data,
      message: {
        message_id: messageId,
        date: 0,
        chat: { id: userId, type: 'private' },
        text: 'btn',
      },
    },
  };
}

function createTestBot(ownerId: string, fetchMock: ReturnType<typeof createFetchMock>) {
  const token = `123:test-${Math.random().toString(36).slice(2)}`;
  return createBot(token, {
    ownerTelegramId: ownerId,
    botInfo: {
      id: 999,
      is_bot: true,
      first_name: 'Test',
      username: 'test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
      can_manage_bots: false,
      supports_join_request_queries: false,
    },
    client: { fetch: fetchMock.fetch as any },
  });
}

async function submitBasicOrder(bot: ReturnType<typeof createBot>, clientId: number) {
  await bot.handleUpdate(callbackUpdate(clientId, 'order_start', 'cb1', 1) as any);
  await bot.handleUpdate(messageUpdate(clientId, 'Need a landing page for a dental clinic with an appointment form', 2) as any);
  await bot.handleUpdate(callbackUpdate(clientId, 'budget_under_500', 'cb2', 3) as any);
  await bot.handleUpdate(callbackUpdate(clientId, 'deadline_urgent', 'cb3', 4) as any);
  await bot.handleUpdate(messageUpdate(clientId, 'Node.js + PostgreSQL', 5) as any);
  await bot.handleUpdate(callbackUpdate(clientId, 'order_confirm', 'cb4', 6) as any);
}

function findOwnerOrderCode(fetchMock: ReturnType<typeof createFetchMock>, ownerId: string) {
  const ownerCard = fetchMock.sent.find(
    (call) =>
      call.method === 'sendMessage' &&
      String(call.body.chat_id) === ownerId &&
      String(call.body.text).includes('New request'),
  );
  expect(ownerCard).toBeTruthy();
  const orderCodeMatch = String(ownerCard?.body.text).match(/#A-\d{4}-[0-9A-F]{8}/);
  expect(orderCodeMatch).toBeTruthy();
  return orderCodeMatch![0];
}

describe('bot integration scenarios', () => {
  const ownerId = '2000';
  const clientId = 1000;
  let fetchMock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    updateId = 1;
    fetchMock = createFetchMock();
    setOrderStore(createPersistentOrderStore(new MemoryStringStore()));
  });

  it('completes the basic happy path', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    expect(fetchMock.sent.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ownerId)).toBe(true);
    expect(fetchMock.sent.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(clientId) && String(call.body.text).includes('request #A-'))).toBe(true);
  });

  it('resets conversation when /start is sent on a button step', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await bot.handleUpdate(callbackUpdate(clientId, 'order_start', 'cb1', 1) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'Need a landing page for a dental clinic with an appointment form', 2) as any);
    await bot.handleUpdate(messageUpdate(clientId, '/start', 3) as any);

    expect(fetchMock.sent.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(clientId) && String(call.body.text).includes('current flow has been reset'))).toBe(true);
  });

  it('accepts bare LaborX domain as a generic task link', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await bot.handleUpdate(callbackUpdate(clientId, 'order_start', 'cb1', 1) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'https://laborx.com', 2) as any);

    expect(fetchMock.sent.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(clientId) && String(call.body.text).includes('LaborX link detected'))).toBe(true);
  });

  it('rejects LaborX profile link as a task link', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await bot.handleUpdate(callbackUpdate(clientId, 'order_start', 'cb1', 1) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'https://laborx.com/freelancers/users/id451630', 2) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('This is a LaborX profile link'),
    )).toBe(true);
    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('LaborX link detected'),
    )).toBe(false);
  });

  it('rejects vague descriptions', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await bot.handleUpdate(callbackUpdate(clientId, 'order_start', 'cb1', 1) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'do something anything you want please quickly', 2) as any);

    expect(fetchMock.sent.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(clientId) && String(call.body.text).includes('description is too vague'))).toBe(true);
  });

  it('accepts a direct LaborX task link flow', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await bot.handleUpdate(callbackUpdate(clientId, 'order_start', 'cb1', 1) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'https://laborx.com/gigs/test-gig', 2) as any);
    await bot.handleUpdate(callbackUpdate(clientId, 'budget_500_2000', 'cb2', 3) as any);
    await bot.handleUpdate(callbackUpdate(clientId, 'deadline_1_2_weeks', 'cb3', 4) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'Django', 5) as any);
    await bot.handleUpdate(callbackUpdate(clientId, 'order_confirm', 'cb4', 6) as any);

    expect(fetchMock.sent.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === ownerId && String(call.body.text).includes('LaborX task'))).toBe(true);
  });

  it('handles owner reject with template', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    const orderCode = findOwnerOrderCode(fetchMock, ownerId);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_reject_${orderCode}`, 'owner-cb1', 99) as any);

    expect(fetchMock.sent.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(clientId) && String(call.body.text).includes('task description is not clear enough'))).toBe(true);
  });

  it('handles owner reject with custom reason', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    const orderCode = findOwnerOrderCode(fetchMock, ownerId);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_reject_custom_${orderCode}`, 'owner-cb2', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Need more project details', 1000) as any);

    expect(fetchMock.sent.some((call) => call.method === 'sendMessage' && String(call.body.chat_id) === String(clientId) && String(call.body.text).includes('Need more project details'))).toBe(true);
  });

  it('handles owner request_change flow through a new LaborX link', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    const orderCode = findOwnerOrderCode(fetchMock, ownerId);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_request_change_${orderCode}`, 'owner-cb3', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Add project phases and timeline for each phase', 1001) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('client requested changes'),
    )).toBe(true);

    await bot.handleUpdate(messageUpdate(clientId, 'https://laborx.com/projects/updated-brief', 7) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes(`The client sent a link for request ${orderCode}`),
    )).toBe(true);
  });

  it('clears pending owner action on /cancel', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    const orderCode = findOwnerOrderCode(fetchMock, ownerId);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${orderCode}`, 'owner-cb4', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), '/cancel', 1002) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'This message should no longer be sent to the client', 1003) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes(`Canceled pending input for request ${orderCode}`),
    )).toBe(true);
    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('This message should no longer be sent to the client'),
    )).toBe(false);
  });


  it('accepts LaborX vacancy link after brief', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    const orderCode = findOwnerOrderCode(fetchMock, ownerId);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${orderCode}`, 'owner-cb-v1', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Publish the task on LaborX', 1020) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'https://laborx.com/vacancies/senior-blockchain-engineer-for-rwahub-18621', 1021) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes(`The client sent a link for request ${orderCode}`),
    )).toBe(true);
  });

  it('allows client to cancel while waiting for a LaborX link after brief', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    const orderCode = findOwnerOrderCode(fetchMock, ownerId);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${orderCode}`, 'owner-cb-v2', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Publish the task on LaborX', 1022) as any);
    await bot.handleUpdate(messageUpdate(clientId, '/cancel', 1023) as any);
    await bot.handleUpdate(messageUpdate(clientId, '/start', 1024) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('Link waiting was canceled'),
    )).toBe(true);
    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('I am waiting for a LaborX task link'),
    )).toBe(false);
    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('Hello! I collect development requests and forward them to the contractor'),
    )).toBe(true);

    await expect(getOrderStore().getOrder(orderCode)).resolves.toMatchObject({
      status: 'new',
    });
  });

  it('accepts non-reply LaborX link after brief using active brief lookup', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    const orderCode = findOwnerOrderCode(fetchMock, ownerId);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${orderCode}`, 'owner-cb5', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Prepare the brief and publish it on LaborX', 1004) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'https://laborx.com/gigs/final-task-link', 7) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes(`The client sent a link for request ${orderCode}`),
    )).toBe(true);
  });


  it('does not overwrite pending owner input with another order action', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);
    await submitBasicOrder(bot, clientId);

    const ownerCards = fetchMock.sent.filter(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes('New request'),
    );
    const firstCode = String(ownerCards[0].body.text).match(/#A-\d{4}-[0-9A-F]{8}/)?.[0];
    const secondCode = String(ownerCards[1].body.text).match(/#A-\d{4}-[0-9A-F]{8}/)?.[0];
    expect(firstCode).toBeTruthy();
    expect(secondCode).toBeTruthy();

    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${firstCode}`, 'owner-cb-p1', 99) as any);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_reject_custom_${secondCode}`, 'owner-cb-p2', 99) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes(`Write the brief for request ${firstCode}`),
    )).toBe(true);

    await expect(getOrderStore().getPendingOwnerAction(ownerId)).resolves.toEqual({
      kind: 'awaiting_brief',
      order_code: firstCode,
    });

    await bot.handleUpdate(messageUpdate(Number(ownerId), 'This brief still belongs to the first request', 1010) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes(`Technical brief for request ${firstCode}`),
    )).toBe(true);
    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes(`Reason:`),
    )).toBe(false);
  });

  it('treats repeated accept callback as already accepted', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);

    const orderCode = findOwnerOrderCode(fetchMock, ownerId);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_accept_${orderCode}`, 'owner-cb6', 99) as any);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_accept_${orderCode}`, 'owner-cb7', 99) as any);

    const clientAcceptMessages = fetchMock.sent.filter(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('I am ready to proceed'),
    );
    expect(clientAcceptMessages).toHaveLength(1);
  });

  it('asks the client to reply to a specific brief when multiple active briefs exist', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);
    await submitBasicOrder(bot, clientId);

    const ownerCards = fetchMock.sent.filter(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes('New request'),
    );
    expect(ownerCards).toHaveLength(2);

    const firstCode = String(ownerCards[0].body.text).match(/#A-\d{4}-[0-9A-F]{8}/)?.[0];
    const secondCode = String(ownerCards[1].body.text).match(/#A-\d{4}-[0-9A-F]{8}/)?.[0];
    expect(firstCode).toBeTruthy();
    expect(secondCode).toBeTruthy();

    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${firstCode}`, 'owner-cb8', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Brief for the first request', 1005) as any);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${secondCode}`, 'owner-cb9', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Brief for the second request', 1006) as any);
    await bot.handleUpdate(messageUpdate(clientId, 'https://laborx.com/projects/latest-active-brief', 8) as any);

    expect(fetchMock.sent.some(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === String(clientId) &&
        String(call.body.text).includes('multiple active briefs'),
    )).toBe(true);

    const ownerLinkMessages = fetchMock.sent.filter(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes('The client sent a link for request'),
    );
    expect(ownerLinkMessages).toHaveLength(0);
  });

  it('matches a reply link to the correct brief when multiple active briefs exist', async () => {
    const bot = createTestBot(ownerId, fetchMock);
    await submitBasicOrder(bot, clientId);
    await submitBasicOrder(bot, clientId);

    const ownerCards = fetchMock.sent.filter(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes('New request'),
    );
    const firstCode = String(ownerCards[0].body.text).match(/#A-\d{4}-[0-9A-F]{8}/)?.[0];
    const secondCode = String(ownerCards[1].body.text).match(/#A-\d{4}-[0-9A-F]{8}/)?.[0];
    expect(firstCode).toBeTruthy();
    expect(secondCode).toBeTruthy();

    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${firstCode}`, 'owner-cb10', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Brief for the first request', 1007) as any);
    await bot.handleUpdate(callbackUpdate(Number(ownerId), `owner_brief_${secondCode}`, 'owner-cb11', 99) as any);
    await bot.handleUpdate(messageUpdate(Number(ownerId), 'Brief for the second request', 1008) as any);

    const firstOrder = await getOrderStore().getOrder(firstCode!);
    expect(firstOrder?.brief_message_id).toBeTruthy();

    await bot.handleUpdate(
      messageUpdate(clientId, 'https://laborx.com/projects/reply-specific-brief', 9, firstOrder!.brief_message_id) as any,
    );

    const ownerLinkMessages = fetchMock.sent.filter(
      (call) =>
        call.method === 'sendMessage' &&
        String(call.body.chat_id) === ownerId &&
        String(call.body.text).includes('The client sent a link for request'),
    );
    expect(ownerLinkMessages.some((call) => String(call.body.text).includes(firstCode!))).toBe(true);
    expect(ownerLinkMessages.some((call) => String(call.body.text).includes(secondCode!))).toBe(false);
  });
});
