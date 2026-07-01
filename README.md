# Order Bot

[![CI](https://github.com/n81l95k7j8/order_taking_bot/actions/workflows/ci.yml/badge.svg)](https://github.com/n81l95k7j8/order_taking_bot/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-58%20passing-brightgreen?logo=vitest&logoColor=white)](#tests)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![grammY](https://img.shields.io/badge/grammY-1.x-3FAEE8?logo=telegram&logoColor=white)](https://grammy.dev/)
[![Hono](https://img.shields.io/badge/Hono-4.x-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Node.js](https://img.shields.io/badge/Node.js-19+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Telegram bot that accepts freelance development requests and coordinates the technical specification between the client and the contractor.

- **Telegram bot:** https://t.me/nikolas_ai_order_bot
- **GitHub repository:** https://github.com/n81l95k7j8/order_taking_bot

Supports two client entry scenarios:

- **Free-form description** — the client describes the project in their own words; the contractor drafts a tech spec and sends it back, the client publishes it on [LaborX](https://laborx.com/) and replies with the link.
- **Existing LaborX task** — the client pastes any `https://laborx.com/...` link right away; the contractor can accept, reject, or request changes without composing a new spec.

The bot also deduplicates repeated Telegram updates by `update_id`, so webhook retries do not create duplicate actions.

Runs on Cloudflare Workers (webhook) in production or locally via long-polling for development.

## Contents

- [Architecture](#architecture)
  - [Order states](#order-states)
- [Stack](#stack)
- [Project layout](#project-layout)
- [Environment variables](#environment-variables)
- [Local run (long polling)](#local-run-long-polling)
- [Deploy to Cloudflare Workers](#deploy-to-cloudflare-workers)
- [Workflow](#workflow)
  - [Scenario 1 — regular request](#scenario-1--regular-request)
  - [Scenario 2 — client sent a laborx link](#scenario-2--client-sent-a-laborx-link)
- [OrderStore](#orderstore)
- [Tests](#tests)
- [Useful commands](#useful-commands)
- [Security notes](#security-notes)
- [Author](#author)
- [License](#license)

---

## Architecture

```
┌────────────┐         ┌──────────────────────────┐         ┌────────────┐
│   Client   │ ◀────▶  │   Telegram Bot API       │ ◀────▶  │   Owner    │
└────────────┘         └──────────────────────────┘         └────────────┘
                              ▲          ▲
                              │          │
                         webhook    long-polling
                              │          │
                       ┌──────┴──────────┴──────┐
                       │       grammY Bot       │
                       │  + @grammyjs/conv. 2.x │
                       └────────────┬───────────┘
                                    │
                  ┌─────────────────┼───────────────────┐
                  │                 │                   │
          orderConversation    ownerActions         OrderStore
          (client intake)      (owner callbacks,    (InMemory / Durable Object)
                                spec input,
                                client replies,
                                accept)

Webhook dedupe happens before bot dispatch so duplicate Telegram deliveries are ignored.
```

### Order states

```
new ─┬─▶ awaiting_brief ─▶ brief_sent ─▶ link_received ─▶ accepted
     │                          ▲
     ├─▶ (laborx link in body)  │
     │       │                  │
     │       ├─▶ accepted ──────┘  (Accept — skip the brief step)
     │       ├─▶ brief_sent       (Request changes — wait for a new link)
     │       └─▶ rejected
     │
     └─▶ rejected
```

---

## Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript 5 |
| Bot framework | [grammY 1.x](https://grammy.dev/) + [@grammyjs/conversations 2.x](https://grammy.dev/plugins/conversations) |
| HTTP layer | [Hono](https://hono.dev/) |
| Runtime (prod) | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Storage (prod) | Cloudflare Durable Objects |
| Runtime (dev) | Node.js 19+ via [tsx](https://github.com/privatenumber/tsx) |
| Storage (dev) | In-memory `Map` |

---

## Project layout

```
src/
├── index.ts                  # Hono app and webhook endpoint for Workers
├── dev-polling.ts            # Local long-polling entry point
├── app/
│   └── createBot.ts          # grammY bot assembly and middleware wiring
├── orders/
│   ├── conversation.ts       # 4-step client intake dialog
│   ├── ownerActions.ts       # Owner buttons, spec flow, client reply handling
│   ├── notifications.ts      # Owner notification with inline keyboard
│   ├── orderStore.ts         # OrderStore interface + in-memory / durable storage
│   ├── updateDedup.ts        # Webhook update_id deduplication helper
│   ├── laborx.ts             # parseLaborXLink / containsLaborXLink
│   └── types.ts              # OrderData, BUDGET_OPTIONS, DEADLINE_OPTIONS, CALLBACK
├── storage/
│   ├── conversationStorage.ts # Durable conversation state adapter
│   └── keyValueStore.ts      # Durable Object-backed key-value store
├── utils/
│   └── markdown.ts           # Telegram Markdown escaping
└── types/
    └── env.ts                # Environment / bindings types
wrangler.toml                 # Cloudflare Worker config
tsconfig.json
package.json
```

---

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `TELEGRAM_BOT_TOKEN` | secret | Token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_WEBHOOK_SECRET` | secret (prod) | Validates `x-telegram-bot-api-secret-token` header |
| `OWNER_TELEGRAM_ID` | secret | Contractor's Telegram user id (numeric string) |
| `ENVIRONMENT` | var | `development` or `production` |
| `BOT_STATE` | Durable Object binding | Durable storage for orders, owner pending actions, and conversation state |

In dev the variables are read from `.dev.vars` (`KEY=value` format). In prod use `wrangler secret put <NAME>` for secrets. The `BOT_STATE` Durable Object binding and migration are configured in `wrangler.toml`.

---

## Local run (long polling)

```bash
# 1. Install deps
npm install

# 2. .dev.vars
cat > .dev.vars <<'EOF'
TELEGRAM_BOT_TOKEN=1234567890:ABCDefGHIjkl...
OWNER_TELEGRAM_ID=123456789
EOF

# 3. Start polling
npm run dev:bot
```

The bot connects to Telegram via `getUpdates` and starts with `drop_pending_updates: true` so that callback queries from previous sessions don't fire on the new run.

The in-memory `OrderStore` is cleared on restart. Any pending interaction that depends on previous in-memory state, such as an old owner notification button, will no longer resolve. Production uses a Durable Object-backed store.

When the owner already has a pending input open (`/brief`, `request_change`, or `reject_custom`), additional owner actions are rejected until the active input is completed or canceled.

While the client is waiting to send a LaborX link after a brief, `/cancel` clears that waiting state and `/start` begins a fresh intake.

---

## Deploy to Cloudflare Workers

```bash
# 1. Secrets
# BOT_STATE Durable Object binding and migration are already declared in wrangler.toml
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
wrangler secret put OWNER_TELEGRAM_ID

# 2. Deploy
wrangler deploy

# 3. Register the Telegram webhook
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<worker>.workers.dev/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

> **Note.** `BOT_STATE` is required in production. Without the Durable Object binding, the Worker returns a 500 for webhook requests instead of running with unsafe in-memory state.

---

## Workflow

### Scenario 1 — regular request

```
client → /start → "Submit request"
       → description (free text)
       → budget (buttons)
       → deadline (buttons)
       → tech stack + contact
       → confirmation
                          │
                          ▼
owner ◀── 🆕 notification + buttons [✍️ Write to client] [❌ Reject] [📝 With reason]

owner → ✍️ Write to client
      → composes the spec
client ◀── 📋 spec + "publish it on laborx.com and reply with the link"

client → link (reply to the spec or a plain message)
owner ◀── 📎 link + button [✅ Take it]

owner → ✅ Take it
client ◀── ✅ Take it
```

### Scenario 2 — client sent a laborx link

```
client → /start → https://laborx.com/...
       → budget / deadline / tech stack → confirmation
                          │
                          ▼
owner ◀── 🆕 notification + buttons [✅ Accept] [✏️ Request changes]
                                    [❌ Reject] [📝 With reason]

— Accept: client ◀── ✅ Take it
— Request changes: owner enters the diff → client receives it with a request
  to update the spec on laborx and send the new link → continues like Scenario 1
— When multiple active briefs exist for the same client, the LaborX link must be sent as a reply to the relevant brief message. A plain link is accepted only when exactly one active brief exists.
— While waiting for a LaborX link after a brief, `/cancel` clears the waiting state and `/start` begins a new intake.
— Reject / with reason: the client receives the template message or a custom rejection message
```

---

## OrderStore

Interface in [`src/orders/orderStore.ts`](src/orders/orderStore.ts):

```ts
interface OrderStore {
  saveOrder(order): Promise<void>
  getOrder(code): Promise<OrderRecord | null>
  updateOrder(code, patch): Promise<OrderRecord | null>
  findByBriefMessage(clientId, messageId): Promise<OrderRecord | null>
  findActiveBriefsByClient(clientId): Promise<OrderRecord[]>
  findActiveBriefByClient(clientId): Promise<OrderRecord | null>

  setPendingOwnerAction(ownerId, action): Promise<void>
  getPendingOwnerAction(ownerId): Promise<PendingOwnerAction | null>
  clearPendingOwnerAction(ownerId): Promise<void>
}
```

Implementations:

- **`InMemoryOrderStore`** — backed by a `Map`, default in local polling mode.
- **`PersistentOrderStore`** — backed by a `StringKeyValueStore`; production passes a Durable Object-backed implementation. TTL: 90 days for orders, 24 hours for pending actions. Uses secondary indexes for fast lookup: `brief:<clientId>:<messageId>` and `active_brief:<clientId>` (stores all active brief message ids for that client).

Production storage setup inside the webhook handler:

```ts
const conversationStoreFactory = c.env.BOT_STATE
  ? createDurableObjectStoreFactory(c.env.BOT_STATE, 'conversation')
  : undefined;

setOrderStore(
  createPersistentOrderStore(
    createDurableObjectStoreFactory(c.env.BOT_STATE, 'orders')('global'),
  ),
);
```

---

## Tests

[Vitest](https://vitest.dev/) suite covering the critical pure functions, in-memory store, and persistent storage adapter:

| File | What it covers |
|------|----------------|
| `src/orders/laborx.test.ts` | `parseLaborXLink` / `containsLaborXLink` — gigs, projects, bare domain, trailing slash, `www.`, http, surrounding text, lookalike domains |
| `src/orders/ownerActions.test.ts` | `parseOwnerCallback` — all callback prefixes; verifies `owner_reject_custom_` is parsed before `owner_reject_` (longest-prefix match) |
| `src/orders/notifications.test.ts` | `generateOrderCode` — format, current year, uniqueness over 1000 calls |
| `src/orders/orderStore.test.ts` | `InMemoryOrderStore` and `PersistentOrderStore` — save / get / update, lookup indexes, active brief index, pending owner action lifecycle |
| `src/app/updateDedup.test.ts` | webhook `update_id` dedupe helper |
| `src/index.test.ts` | webhook route dedupe for repeated Telegram deliveries |
| `src/storage/conversationStorage.test.ts` | Durable conversation storage adapter — per-chat persistence, TTL, invalid JSON cleanup |
| `src/utils/markdown.test.ts` | Telegram Markdown escaping for user-provided text |

```bash
npm test          # one-shot run
npm run test:watch  # watch mode
```

---

## Useful commands

```bash
npm run dev:bot       # local polling mode
npm run dev           # local wrangler dev (Workers emulator)
npm run type-check    # tsc --noEmit
npm run deploy        # wrangler deploy
npm run tail          # wrangler tail — live Workers logs
```

---

## Security notes

- The webhook endpoint validates the `x-telegram-bot-api-secret-token` header against `TELEGRAM_WEBHOOK_SECRET` and returns 403 on mismatch.
- Webhook updates are deduplicated by `update_id`, so Telegram retries do not replay the same action.
- All owner-only callbacks and handlers filter the sender by `OWNER_TELEGRAM_ID`. The id is validated on handler registration (digits only, no whitespace).
- Markdown is intentionally disabled in outgoing messages composed from user input (spec, rejection reason, change request) — Telegram won't fail on special characters.

---

## Author

Nikolas Rhys · [LaborX](https://laborx.com/freelancers/users/id451630)

## License

[MIT](LICENSE)
