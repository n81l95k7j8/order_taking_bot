// Cloudflare Worker environment bindings.
export interface Env {
  ENVIRONMENT: 'development' | 'production';
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OWNER_TELEGRAM_ID?: string;
  // Durable Object namespace for requests, pending owner actions,
  // and multi-step conversation state.
  BOT_STATE?: DurableObjectNamespace;
}
