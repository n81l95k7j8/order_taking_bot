import type { Bot, Context } from 'grammy';
import { getOrderStore } from './orderStore';
import { parseLaborXLink } from './laborx';

const REJECT_TEMPLATE =
  '❌ The task description is not clear enough. If you want to continue, please start again with /start.';

const ACCEPT_LABORX_INITIAL_TEXT =
  '✅ I am ready to take on your task. I have already responded on LaborX. Please select me as the contractor to begin.';

const ACCEPT_LABORX_AFTER_BRIEF_TEXT =
  '✅ I am ready to proceed. I received the LaborX link. Please select me as the contractor or confirm the order on LaborX.';

const ACCEPT_DEFAULT_TEXT = '✅ I am ready to proceed.';

function acceptTextForOrder(order: { status: string; laborx_link?: string }): string {
  if (order.laborx_link) {
    return order.status === 'link_received'
      ? ACCEPT_LABORX_AFTER_BRIEF_TEXT
      : ACCEPT_LABORX_INITIAL_TEXT;
  }
  return ACCEPT_DEFAULT_TEXT;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'accepted': return 'This request has already been accepted';
    case 'rejected': return 'This request has already been rejected';
    case 'awaiting_brief': return 'This request is waiting for a brief';
    case 'brief_sent': return 'The brief has already been sent to the client';
    case 'link_received': return 'The client link has already been received';
    default: return `Request status: ${status}`;
  }
}

function pendingOwnerActionLabel(kind: 'awaiting_brief' | 'awaiting_change_request' | 'awaiting_reject_reason'): string {
  switch (kind) {
    case 'awaiting_brief': return 'brief input';
    case 'awaiting_change_request': return 'change request input';
    case 'awaiting_reject_reason': return 'reject reason input';
  }
}

async function guardPendingOwnerAction(
  store: ReturnType<typeof getOrderStore>,
  ownerId: string,
  ctx: Context,
  nextAction: string,
  orderCode: string,
): Promise<boolean> {
  const pending = await store.getPendingOwnerAction(ownerId);
  if (!pending) return false;

  const sameAction = pending.order_code === orderCode && (
    (nextAction === 'brief input' && pending.kind === 'awaiting_brief') ||
    (nextAction === 'change request input' && pending.kind === 'awaiting_change_request') ||
    (nextAction === 'reject reason input' && pending.kind === 'awaiting_reject_reason')
  );

  await ctx.answerCallbackQuery({
    text: sameAction
      ? `Already waiting for ${nextAction} on request ${orderCode}`
      : `Finish ${pendingOwnerActionLabel(pending.kind)} for request ${pending.order_code} first, or send /cancel`,
    show_alert: !sameAction,
  });
  return true;
}

export type OwnerAction = 'brief' | 'request_change' | 'reject' | 'reject_custom' | 'accept';

export function parseOwnerCallback(data: string):
  | { action: OwnerAction; order_code: string }
  | null {
  const prefixes: Array<{ prefix: string; action: OwnerAction }> = [
    { prefix: 'owner_brief_', action: 'brief' },
    { prefix: 'owner_request_change_', action: 'request_change' },
    { prefix: 'owner_reject_custom_', action: 'reject_custom' },
    { prefix: 'owner_reject_', action: 'reject' },
    { prefix: 'owner_accept_', action: 'accept' },
  ];
  for (const { prefix, action } of prefixes) {
    if (data.startsWith(prefix)) {
      return { action, order_code: data.slice(prefix.length) };
    }
  }
  return null;
}

export function registerOwnerHandlers(bot: Bot<Context>, rawOwnerId: string): void {
  const ownerId = rawOwnerId.trim();
  if (!/^\d+$/.test(ownerId)) {
    throw new Error(
      `[ownerActions] OWNER_TELEGRAM_ID must be a numeric Telegram user id, got: "${rawOwnerId}"`,
    );
  }

  bot.on('callback_query:data', async (ctx, next) => {
    if (String(ctx.from?.id) !== ownerId) return next();
    const parsed = parseOwnerCallback(ctx.callbackQuery.data);
    if (!parsed) return next();

    const store = getOrderStore();
    const order = await store.getOrder(parsed.order_code);
    if (!order) {
      await ctx.answerCallbackQuery({ text: 'Request not found', show_alert: true });
      return;
    }

    if (parsed.action === 'brief') {
      if (await guardPendingOwnerAction(store, ownerId, ctx, 'brief input', parsed.order_code)) {
        return;
      }
      await store.setPendingOwnerAction(ownerId, {
        kind: 'awaiting_brief',
        order_code: parsed.order_code,
      });
      await store.updateOrder(parsed.order_code, { status: 'awaiting_brief' });
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `✍️ Write the brief for request ${parsed.order_code}. I will send it to the client in the next message.\n\n` +
          'You can send multiple paragraphs. Send /cancel to stop.',
      );
      return;
    }

    if (parsed.action === 'reject') {
      if (order.status === 'rejected' || order.status === 'accepted') {
        await ctx.answerCallbackQuery({ text: statusLabel(order.status), show_alert: true });
        return;
      }
      await sendToClient(bot, order.client.telegram_user_id, REJECT_TEMPLATE);
      await store.updateOrder(parsed.order_code, { status: 'rejected', reject_reason: '(template)' });
      await ctx.answerCallbackQuery({ text: 'Rejected' });
      await removeKeyboard(ctx);
      await ctx.reply(`❌ Request ${parsed.order_code} was rejected with the template message.`);
      return;
    }

    if (parsed.action === 'request_change') {
      if (await guardPendingOwnerAction(store, ownerId, ctx, 'change request input', parsed.order_code)) {
        return;
      }
      await store.setPendingOwnerAction(ownerId, {
        kind: 'awaiting_change_request',
        order_code: parsed.order_code,
      });
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `✏️ Describe what should be changed in the brief for request ${parsed.order_code}.\n\n` +
          'I will ask the client to update the LaborX task. Send /cancel to stop.',
      );
      return;
    }

    if (parsed.action === 'reject_custom') {
      if (await guardPendingOwnerAction(store, ownerId, ctx, 'reject reason input', parsed.order_code)) {
        return;
      }
      await store.setPendingOwnerAction(ownerId, {
        kind: 'awaiting_reject_reason',
        order_code: parsed.order_code,
      });
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `📝 Write the rejection reason for request ${parsed.order_code}.\n\n` +
          'Send /cancel to stop.',
      );
      return;
    }

    if (parsed.action === 'accept') {
      if (order.status === 'accepted' || order.status === 'rejected') {
        await ctx.answerCallbackQuery({ text: statusLabel(order.status), show_alert: true });
        return;
      }
      await sendToClient(bot, order.client.telegram_user_id, acceptTextForOrder(order));
      await store.updateOrder(parsed.order_code, { status: 'accepted' });
      await ctx.answerCallbackQuery({ text: 'Accepted' });
      await removeKeyboard(ctx);
      await ctx.reply(`✅ Request ${parsed.order_code} was accepted and the client was notified.`);
      return;
    }
  });

  bot.command('cancel', async (ctx, next) => {
    if (String(ctx.from?.id) !== ownerId) return next();
    const store = getOrderStore();
    const pending = await store.getPendingOwnerAction(ownerId);
    if (pending) {
      await store.clearPendingOwnerAction(ownerId);
      await ctx.reply(`👌 Canceled pending input for request ${pending.order_code}.`);
      return;
    }
    return next();
  });

  bot.on('message:text', async (ctx, next) => {
    if (String(ctx.from?.id) !== ownerId) return next();
    if (ctx.message.text.startsWith('/')) return next();
    const store = getOrderStore();
    const pending = await store.getPendingOwnerAction(ownerId);
    if (!pending) return next();

    const order = await store.getOrder(pending.order_code);
    if (!order) {
      await store.clearPendingOwnerAction(ownerId);
      await ctx.reply('⚠️ The request disappeared from storage. State was cleared.');
      return;
    }

    if (pending.kind === 'awaiting_brief') {
      const brief = ctx.message.text;
      const fullText =
        `📋 Technical brief for request ${order.order_code}:\n\n` +
        brief +
        '\n\n' +
        'If this looks good, publish it on https://laborx.com/ and reply to this message with the link.';

      const sent = await ctx.api.sendMessage(order.client.telegram_user_id, fullText);
      await store.updateOrder(pending.order_code, {
        status: 'brief_sent',
        brief_message_id: sent.message_id,
      });
      await store.clearPendingOwnerAction(ownerId);
      await ctx.reply(`✅ The brief was sent to the client for request ${order.order_code}.`);
      return;
    }

    if (pending.kind === 'awaiting_change_request') {
      const changes = ctx.message.text;
      const fullText =
        `✏️ The client requested changes for request ${order.order_code}:\n\n` +
        changes +
        '\n\n' +
        'Please update the task on https://laborx.com/ and reply to this message with the new link.';

      const sent = await ctx.api.sendMessage(order.client.telegram_user_id, fullText);
      await store.updateOrder(pending.order_code, {
        status: 'brief_sent',
        brief_message_id: sent.message_id,
      });
      await store.clearPendingOwnerAction(ownerId);
      await ctx.reply(`✅ The change request was sent to the client for request ${order.order_code}.`);
      return;
    }

    if (pending.kind === 'awaiting_reject_reason') {
      const reason = ctx.message.text;
      await sendToClient(
        bot,
        order.client.telegram_user_id,
        `❌ Your request was rejected.\n\nReason: ${reason}`,
      );
      await store.updateOrder(pending.order_code, { status: 'rejected', reject_reason: reason });
      await store.clearPendingOwnerAction(ownerId);
      await ctx.reply(`❌ Request ${order.order_code} was rejected with a custom reason.`);
      return;
    }
  });

  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const store = getOrderStore();

    let order = null;
    const reply = ctx.message.reply_to_message;
    if (reply) {
      order = await store.findByBriefMessage(ctx.from.id, reply.message_id);
    }

    if (!order) {
      const activeOrders = await store.findActiveBriefsByClient(ctx.from.id);
      if (activeOrders.length > 1) {
        await ctx.reply(
          '⚠️ You currently have multiple active briefs. Reply to the specific brief message so I can attach the link to the correct request.',
        );
        return;
      }
      order = activeOrders[0] ?? null;
    }
    if (!order) return next();

    const messageText = ctx.message.text.trim();

    if (messageText === '/cancel') {
      await store.updateOrder(order.order_code, { status: 'new' });
      await ctx.reply('👌 Link waiting was canceled. Send /start to begin again.');
      return;
    }

    if (messageText === '/start' || messageText.startsWith('/')) {
      return next();
    }

    const link = parseLaborXLink(ctx.message.text);
    if (!link || link.type === 'profile') {
      await ctx.reply(
        '⚠️ I am waiting for a LaborX task link from https://laborx.com/. Send it in a single message, optionally as a reply to the brief.',
      );
      return;
    }

    await store.updateOrder(order.order_code, {
      status: 'link_received',
      laborx_link: link.url,
    });

    await ctx.api.sendMessage(
      ownerId,
      `📎 The client sent a link for request ${order.order_code}:\n${link.url}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Accept', callback_data: `owner_accept_${order.order_code}` }],
          ],
        },
      },
    );

    await ctx.reply('✅ The link was received and forwarded to the contractor.');
  });
}

async function sendToClient(
  bot: Bot<Context>,
  clientId: number,
  text: string,
  opts: Parameters<Bot<Context>['api']['sendMessage']>[2] = {},
): Promise<void> {
  await bot.api.sendMessage(clientId, text, opts);
}

async function removeKeyboard(ctx: Context): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch {
    // Ignore stale or missing messages.
  }
}
