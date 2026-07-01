// Local development script using long polling.
// Production uses a Cloudflare Workers webhook instead.
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createBot } from './app/createBot';

// Read .dev.vars in KEY=value format.
function loadDevVars(): void {
  const devVarsPath = resolve(process.cwd(), '.dev.vars');

  if (!existsSync(devVarsPath)) {
    console.warn('⚠️  .dev.vars was not found, using system environment variables only');
    return;
  }

  const content = readFileSync(devVarsPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments.
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip quotes when present.
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Set process.env only when the key is not already defined.
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }

  console.log('✅ .dev.vars loaded\n');
}

// Load variables before use.
loadDevVars();

const token = process.env.TELEGRAM_BOT_TOKEN;
const ownerTelegramId = process.env.OWNER_TELEGRAM_ID;

if (!token) {
  console.error('❌ TELEGRAM_BOT_TOKEN was not found');
  console.error('   Check that .dev.vars exists and contains:');
  console.error('   TELEGRAM_BOT_TOKEN=1234567890:ABCDefGHIjkl...');
  process.exit(1);
}

console.log('🤖 Starting bot in polling mode (development only)...');
console.log('   Press Ctrl+C to stop\n');

const bot = createBot(token, { ownerTelegramId });

// Graceful shutdown
process.once('SIGINT', () => {
  console.log('\n🛑 Stopping bot...');
  bot.stop();
});
process.once('SIGTERM', () => bot.stop());

bot.start({ drop_pending_updates: true });
console.log('✅ Bot is running and listening for messages!\n');