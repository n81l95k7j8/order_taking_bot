import { Api, type ApiClientOptions } from 'grammy';
import { randomUUID } from 'node:crypto';
import type { CompleteOrderData } from './types';
import { getOrderStore } from './orderStore';
import { parseLaborXLink } from './laborx';
import { escapeMarkdown } from '../utils/markdown';

let _botToken = '';
let _ownerTelegramId = '';
let _clientOptions: ApiClientOptions | undefined;

export function setNotificationCredentials(token: string, ownerId: string, clientOptions?: ApiClientOptions): void {
  _botToken = token;
  _ownerTelegramId = ownerId;
  _clientOptions = clientOptions;
}

export function getNotificationCredentials(): { token: string; ownerId: string; clientOptions?: ApiClientOptions } {
  return { token: _botToken, ownerId: _ownerTelegramId, clientOptions: _clientOptions };
}

export interface ClientInfo {
  telegram_user_id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface FullOrderData extends CompleteOrderData {
  client: ClientInfo;
  created_at: string;
  order_code: string;
}

function formatOrderForOwner(order: FullOrderData, laborxLink: string | null): string {
  const clientName = escapeMarkdown(
    [order.client.first_name, order.client.last_name]
      .filter(Boolean)
      .join(' ') || 'Not provided',
  );

  const username = order.client.username
    ? `@${escapeMarkdown(order.client.username)}`
    : 'no username';

  let descriptionBlock: string;
  if (laborxLink) {
    descriptionBlock = `🔗 *LaborX task:*\n${escapeMarkdown(laborxLink)}`;
  } else {
    descriptionBlock = `📝 *Description:*\n${escapeMarkdown(order.description)}`;
  }

  return (
    `🆕 *New request ${escapeMarkdown(order.order_code)}*\n\n` +
    `👤 *Client:*\n` +
    `   ${clientName} (${username})\n` +
    `   ID: \`${order.client.telegram_user_id}\`\n` +
    `   [Open chat](tg://user?id=${order.client.telegram_user_id})\n\n` +
    `${descriptionBlock}\n\n` +
    `💰 *Budget:* ${escapeMarkdown(order.budget)}\n` +
    `📅 *Timeline:* ${escapeMarkdown(order.deadline)}\n` +
    `🛠 *Tech stack and contact:*\n${escapeMarkdown(order.techStack)}\n\n` +
    `🕒 *Created at:* ${escapeMarkdown(order.created_at)}`
  );
}

function buildOwnerKeyboard(order_code: string, hasLaborxLink: boolean) {
  if (hasLaborxLink) {
    return {
      inline_keyboard: [
        [{ text: '✅ Accept', callback_data: `owner_accept_${order_code}` }],
        [{ text: '✏️ Request changes', callback_data: `owner_request_change_${order_code}` }],
        [
          { text: '❌ Reject', callback_data: `owner_reject_${order_code}` },
          { text: '📝 Reject with reason', callback_data: `owner_reject_custom_${order_code}` },
        ],
      ],
    };
  }
  return {
    inline_keyboard: [
      [{ text: '✍️ Write brief', callback_data: `owner_brief_${order_code}` }],
      [
        { text: '❌ Reject', callback_data: `owner_reject_${order_code}` },
        { text: '📝 Reject with reason', callback_data: `owner_reject_custom_${order_code}` },
      ],
    ],
  };
}

export async function notifyOwner(
  botToken: string,
  ownerTelegramId: string,
  order: FullOrderData,
): Promise<boolean> {
  try {
    const store = getOrderStore();
    await store.saveOrder(order);

    const laborxLink = parseLaborXLink(order.description);
    if (laborxLink) {
      await store.updateOrder(order.order_code, { laborx_link: laborxLink.url });
    }

    const api = new Api(botToken, _clientOptions);
    const message = formatOrderForOwner(order, laborxLink?.url ?? null);

    await api.sendMessage(ownerTelegramId, message, {
      parse_mode: 'Markdown',
      reply_markup: buildOwnerKeyboard(order.order_code, !!laborxLink),
    });

    console.log(`Notification sent to owner for order ${order.order_code}`);
    return true;
  } catch (err) {
    console.error('Failed to send notification to owner:', err);
    return false;
  }
}

export function generateOrderCode(): string {
  const year = new Date().getFullYear();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `#A-${year}-${suffix}`;
}
