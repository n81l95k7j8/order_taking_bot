import { Bot, Context, type ApiClientOptions } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { conversations, type ConversationFlavor } from '@grammyjs/conversations';
import { webhookCallback } from 'grammy';
import { orderConversationMiddleware } from '../orders/conversation';
import { CALLBACK } from '../orders/types';
import { setNotificationCredentials } from '../orders/notifications';
import { parseLaborXLink, formatLaborXLink } from '../orders/laborx';
import { registerOwnerHandlers } from '../orders/ownerActions';
import type { StringKeyValueStore } from '../storage/keyValueStore';
import { createPersistentConversationStorage } from '../storage/conversationStorage';

type MyContext = Context & ConversationFlavor<Context>;

export interface BotOptions {
  ownerTelegramId?: string;
  conversationStoreFactory?: (storageKey: string) => StringKeyValueStore;
  client?: ApiClientOptions;
  botInfo?: UserFromGetMe;
}

const botCache = new Map<string, Bot<MyContext>>();

export function createBot(token: string, options: BotOptions = {}): Bot<MyContext> {
  const ownerTelegramId = options.ownerTelegramId?.trim();
  const storageMode = options.conversationStoreFactory ? 'persistent' : 'memory';
  const clientMode = options.client ? 'custom-client' : 'default-client';
  const botInfoMode = options.botInfo ? 'custom-bot-info' : 'no-bot-info';
  const cacheKey = `${token}:${ownerTelegramId ?? ''}:${storageMode}:${clientMode}:${botInfoMode}`;
  const cached = botCache.get(cacheKey);
  if (cached) return cached;

  const bot = new Bot<MyContext>(token, { client: options.client, botInfo: options.botInfo });

  if (ownerTelegramId) {
    setNotificationCredentials(token, ownerTelegramId, options.client);
    console.log('Notification credentials configured');
  } else {
    console.warn('OWNER_TELEGRAM_ID not set');
  }

  bot.use(
    options.conversationStoreFactory
      ? conversations({
          storage: createPersistentConversationStorage<MyContext>(options.conversationStoreFactory),
        })
      : conversations(),
  );
  bot.use(orderConversationMiddleware);

  if (ownerTelegramId) {
    registerOwnerHandlers(bot as unknown as Bot<Context>, ownerTelegramId);
  }

  bot.command('start', async (ctx) => {
    await ctx.reply(
      '👋 Hello! I collect development requests and forward them to the contractor.\n\n' +
        'Press the button below to get started.',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📝 Submit request', callback_data: CALLBACK.ORDER_START }],
            [{ text: '❓ FAQ', callback_data: CALLBACK.FAQ }],
          ],
        },
      },
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '❓ *Help*\n\n' +
        '📝 *What does this bot do?*\n' +
        'It collects project requests and forwards them to the contractor.\n\n' +
        '🔗 *Can I send a LaborX link?*\n' +
        'Yes. Send any LaborX task link to start a request from it.\n\n' +
        '📋 *How does the request flow work?*\n' +
        'Send a project description or a LaborX link, choose the budget and timeline, then confirm the request.\n\n' +
        '👌 *How do I cancel the current flow?*\n' +
        'Send /cancel to stop the current request and start again later.\n\n' +
        '⏱ *How quickly do you reply?*\n' +
        'Usually within 2 hours.',
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('cancel', async (ctx) => {
    await ctx.conversation.exit('orderConversation');
    await ctx.reply('👌 Current flow canceled. Send /start to begin again.');
  });

  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text;
    const laborxLink = parseLaborXLink(text);

    if (laborxLink) {
      const active = ctx.conversation.active();
      if (active.length > 0) {
        return next();
      }

      if (laborxLink.type === 'profile') {
        await ctx.reply(
          '👤 This is a LaborX profile link, not a task link.\n\n' +
            'Send a LaborX job link or describe your project in text.',
        );
        return;
      }

      console.log(`[bot] Auto-starting conversation for LaborX link from user ${ctx.from?.id}`);
      await ctx.reply(
        '🔗 *LaborX link detected.*\n\n' +
          `${formatLaborXLink(laborxLink)}\n\n` +
          'Starting the intake flow...',
        { parse_mode: 'Markdown' },
      );
      await ctx.conversation.enter('orderConversation');
      return;
    }

    return next();
  });

  bot.on('callback_query:data', async (ctx, next) => {
    const data = ctx.callbackQuery.data;

    const activeConversations = ctx.conversation.active();
    if (activeConversations.length > 0) {
      return next();
    }

    if (data === CALLBACK.ORDER_START) {
      await ctx.answerCallbackQuery();
      console.log(`[bot] Entering conversation for user ${ctx.from?.id}`);
      await ctx.conversation.enter('orderConversation');
      return;
    }

    if (data === CALLBACK.FAQ) {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        '❓ *Help*\n\n' +
          '📝 *What does this bot do?*\n' +
          'It collects project requests and forwards them to the contractor.\n\n' +
          '🔗 *Can I send a LaborX link?*\n' +
          'Yes. Send any LaborX task link to start a request from it.\n\n' +
          '📋 *How does the request flow work?*\n' +
          'Send a project description or a LaborX link, choose the budget and timeline, then confirm the request.\n\n' +
          '👌 *How do I cancel the current flow?*\n' +
          'Send /cancel to stop the current request and start again later.\n\n' +
          '⏱ *How quickly do you reply?*\n' +
          'Usually within 2 hours.',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  botCache.set(cacheKey, bot);
  return bot;
}

export function createHonoHandler(token: string, options: BotOptions = {}) {
  const bot = createBot(token, options);
  return webhookCallback(bot, 'hono');
}
