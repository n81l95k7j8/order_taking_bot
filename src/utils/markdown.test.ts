import { describe, expect, it } from 'vitest';
import { escapeMarkdown } from './markdown';

describe('escapeMarkdown', () => {
  it('escapes Telegram legacy Markdown control characters', () => {
    expect(escapeMarkdown('a_b*c`d[e')).toBe('a\\_b\\*c\\`d\\[e');
  });

  it('leaves regular text unchanged', () => {
    expect(escapeMarkdown('Node.js + PostgreSQL, budget $500')).toBe('Node.js + PostgreSQL, budget $500');
  });
});
