import { parseLaborXLink, formatLaborXLink } from './laborx';
import { escapeMarkdown } from '../utils/markdown';
import { getNotificationCredentials, notifyOwner, generateOrderCode } from './notifications';
import type { FullOrderData } from './notifications';
import { type Conversation, createConversation } from '@grammyjs/conversations';
import type { Context } from 'grammy';
import {
  type OrderData,
  BUDGET_OPTIONS,
  DEADLINE_OPTIONS,
  CALLBACK,
  isCompleteOrder,
} from './types';

type MyContext = Context;
type MyConversation = Conversation<MyContext>;

const VAGUE_DESCRIPTION_PATTERNS = [
  /\bdo\s+something\b/i,
  /\banything\s+you\s+want\b/i,
  /\bwhatever\s+you\s+want\b/i,
  /\bi\s+do\s+not\s+know\s+what\s+i\s+want\b/i,
  /\bi\s+don't\s+know\s+what\s+i\s+want\b/i,
  /\bno\s+idea\b/i,
];

class ConversationRestartError extends Error {
  constructor() {
    super('Conversation restart requested');
  }
}

class ConversationCancelError extends Error {
  constructor() {
    super('Conversation cancelled');
  }
}

function isVagueDescription(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return VAGUE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

async function handleConversationCommand(msg: Context): Promise<never | false> {
  const text = msg.msg?.text?.trim();
  if (text === '/cancel') {
    await msg.reply('👌 Current flow canceled. Send /start to begin again.');
    throw new ConversationCancelError();
  }

  if (text === '/start') {
    await msg.reply('👌 The current flow has been reset. Send /start again to begin from scratch.');
    throw new ConversationRestartError();
  }

  return false;
}

async function waitForText(conversation: MyConversation) {
  while (true) {
    const msg = await conversation.waitFor(':text');
    await handleConversationCommand(msg);
    return msg;
  }
}

async function waitForCallback(conversation: MyConversation, prefix?: string) {
  while (true) {
    const msg = await conversation.wait();

    if (msg.message?.text) {
      await handleConversationCommand(msg);
      await msg.reply('👇 Use the buttons for the current step.');
      continue;
    }

    if (!msg.callbackQuery?.data) {
      continue;
    }

    if (!prefix || msg.callbackQuery.data.startsWith(prefix)) return msg;

    await msg.answerCallbackQuery({ text: 'Use the buttons for the current step', show_alert: true });
  }
}

async function orderConversation(conversation: MyConversation, ctx: MyContext) {
  const userId = ctx.from?.id || 0;
  console.log(`[conversation] Started for user ${userId}`);
  const order: OrderData = {};

  try {
    await ctx.reply(
      '📝 *Step 1 of 4: Project description*\n\n' +
        'Describe your project in your own words:\n' +
        '• What should the app do?\n' +
        '• Who is it for?\n' +
        '• Are there any similar examples?\n\n' +
        'Please write at least 30 characters.',
      { parse_mode: 'Markdown' },
    );

    while (!order.description) {
      const descMsg = await waitForText(conversation);
      const descText = descMsg.msg.text.trim();
      console.log(`[conversation] Received text (${descText.length} chars): "${descText.substring(0, 80)}"`);
      const laborxLink = parseLaborXLink(descText);

      if (laborxLink) {
        if (laborxLink.type === 'profile') {
          await ctx.reply(
            '👤 This is a LaborX profile link, not a task link.\n\n' +
              'Send a LaborX job link or describe your project in text.',
          );
          continue;
        }

        order.description = `[LaborX ${laborxLink.type.toUpperCase()}] ${laborxLink.url}`;
        console.log(`[conversation] Detected LaborX link: ${laborxLink.url}`);
        await ctx.reply(
          '🔗 *LaborX link detected.*\n\n' +
            `${formatLaborXLink(laborxLink)}\n\n` +
            'Moving on to the details...',
          { parse_mode: 'Markdown' },
        );
      } else if (descText.length < 30) {
        await ctx.reply(
          '❌ The description is too short. Please try again with at least 30 characters.\n\n' +
            'You can also send a LaborX task link.',
        );
      } else if (isVagueDescription(descText)) {
        await ctx.reply(
          '❌ The description is too vague. Please explain what should be built, who it is for, and what result you expect.',
        );
      } else {
        order.description = descText;
      }
    }

    await ctx.reply(
      '💰 *Step 2 of 4: Budget*\n\nWhat budget are you planning for this project?',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: BUDGET_OPTIONS.map((opt) => [
            { text: opt.text, callback_data: `budget_${opt.value}` },
          ]),
        },
      },
    );

    while (!order.budget) {
      const budgetMsg = await waitForCallback(conversation, 'budget_');
      const budgetData = budgetMsg.callbackQuery?.data;
      if (!budgetData) continue;
      const budgetValue = budgetData.replace('budget_', '');
      order.budget = BUDGET_OPTIONS.find((o) => o.value === budgetValue)?.text || budgetValue;
      await budgetMsg.answerCallbackQuery();
    }

    await ctx.reply(
      '📅 *Step 3 of 4: Timeline*\n\nWhen do you need the project to be ready?',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: DEADLINE_OPTIONS.map((opt) => [
            { text: opt.text, callback_data: `deadline_${opt.value}` },
          ]),
        },
      },
    );

    while (!order.deadline) {
      const deadlineMsg = await waitForCallback(conversation, 'deadline_');
      const deadlineData = deadlineMsg.callbackQuery?.data;
      if (!deadlineData) continue;
      const deadlineValue = deadlineData.replace('deadline_', '');
      order.deadline = DEADLINE_OPTIONS.find((o) => o.value === deadlineValue)?.text || deadlineValue;
      await deadlineMsg.answerCallbackQuery();
    }

    await ctx.reply(
      '🛠 *Step 4 of 4: Tech stack and contact*\n\n' +
        'Do you have any preferred technologies?\n' +
        '(For example: "Node.js + PostgreSQL" or "No preference")\n\n',
      { parse_mode: 'Markdown' },
    );

    while (!order.techStack) {
      const techMsg = await waitForText(conversation);
      const techText = techMsg.msg.text.trim();
      if (techText.length < 5) {
        await ctx.reply('❌ Please write at least a couple of words about your preferred stack or contact details.');
        continue;
      }
      order.techStack = techText;
    }

    await showOrderSummary(conversation, ctx, order);
  } catch (err) {
    if (err instanceof ConversationCancelError || err instanceof ConversationRestartError) {
      return;
    }
    throw err;
  }
}

async function showOrderSummary(
  conversation: MyConversation,
  ctx: MyContext,
  order: OrderData,
) {
  const summary =
    '📋 *Your request:*\n\n' +
    `*Description:*\n${escapeMarkdown(order.description ?? '')}\n\n` +
    `*Budget:* ${escapeMarkdown(order.budget ?? '')}\n` +
    `*Timeline:* ${escapeMarkdown(order.deadline ?? '')}\n` +
    `*Tech stack and contact:*\n${escapeMarkdown(order.techStack ?? '')}\n\n` +
    'Is everything correct?';

  await ctx.reply(summary, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Submit', callback_data: CALLBACK.ORDER_CONFIRM },
          { text: '❌ Cancel', callback_data: CALLBACK.ORDER_CANCEL },
        ],
        [{ text: '🔄 Start over', callback_data: CALLBACK.ORDER_EDIT }],
      ],
    },
  });

  const confirmMsg = await waitForCallback(conversation);

  await confirmMsg.answerCallbackQuery();
  const action = confirmMsg.callbackQuery?.data;
  if (!action) return;

  if (action === CALLBACK.ORDER_CONFIRM) {
    if (!isCompleteOrder(order)) {
      await ctx.reply('⚠️ The request is incomplete. Let\'s start over.');
      return orderConversation(conversation, ctx);
    }

    const { token, ownerId } = getNotificationCredentials();
    const orderCode = await conversation.external(() => generateOrderCode());
    const createdAt = await conversation.external(() => new Date().toISOString());

    const fullOrder: FullOrderData = {
      description: order.description,
      budget: order.budget,
      deadline: order.deadline,
      techStack: order.techStack,
      client: {
        telegram_user_id: ctx.from?.id || 0,
        username: ctx.from?.username,
        first_name: ctx.from?.first_name,
        last_name: ctx.from?.last_name,
      },
      created_at: createdAt,
      order_code: orderCode,
    };

    let notified = false;
    if (token && ownerId) {
      notified = await notifyOwner(token, ownerId, fullOrder);
    }

    await ctx.reply(
      `🎉 Your request ${orderCode} has been sent.\n\n` +
        'I will get back to you within 2 hours.',
      { parse_mode: 'Markdown' },
    );

    console.log(`NEW ORDER ${orderCode}:`, JSON.stringify(fullOrder, null, 2));
    if (!notified) {
      console.warn('Owner notification was not sent (check credentials)');
    }
  } else if (action === CALLBACK.ORDER_CANCEL) {
    await ctx.reply('👌 The request has been canceled. Send a new message if you want to start again.');
  } else if (action === CALLBACK.ORDER_EDIT) {
    await ctx.reply('🔄 Starting over...');
    return orderConversation(conversation, ctx);
  }
}

export const orderConversationMiddleware = createConversation(orderConversation);
