// Telegram legacy Markdown escaping for user-provided text.
// See: https://core.telegram.org/bots/api#markdown-style
export function escapeMarkdown(value: string): string {
  return value.replace(/([_*`\[])/g, '\\$1');
}
