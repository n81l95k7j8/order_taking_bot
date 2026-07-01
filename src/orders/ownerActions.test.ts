import { describe, it, expect } from 'vitest';
import { parseOwnerCallback } from './ownerActions';

describe('parseOwnerCallback', () => {
  it('parses brief callback', () => {
    expect(parseOwnerCallback('owner_brief_#A-2026-AB12CD34')).toEqual({
      action: 'brief',
      order_code: '#A-2026-AB12CD34',
    });
  });

  it('parses accept callback', () => {
    expect(parseOwnerCallback('owner_accept_#A-2026-XYZ')).toEqual({
      action: 'accept',
      order_code: '#A-2026-XYZ',
    });
  });

  it('parses request_change callback', () => {
    expect(parseOwnerCallback('owner_request_change_#A-2026-X')).toEqual({
      action: 'request_change',
      order_code: '#A-2026-X',
    });
  });

  it('parses reject callback', () => {
    expect(parseOwnerCallback('owner_reject_#A-2026-X')).toEqual({
      action: 'reject',
      order_code: '#A-2026-X',
    });
  });

  it('parses reject_custom callback before plain reject (longer prefix wins)', () => {
    // crucial: owner_reject_custom_ must NOT be parsed as owner_reject_ with
    // order_code starting from "custom_..."
    expect(parseOwnerCallback('owner_reject_custom_#A-2026-X')).toEqual({
      action: 'reject_custom',
      order_code: '#A-2026-X',
    });
  });

  it('returns null for unknown prefix', () => {
    expect(parseOwnerCallback('foo_bar_123')).toBeNull();
    expect(parseOwnerCallback('order_start')).toBeNull();
    expect(parseOwnerCallback('')).toBeNull();
  });

  it('handles order codes with underscores in suffix', () => {
    // unlikely with current UUID-based codes, but the parser shouldn't split on _
    const r = parseOwnerCallback('owner_brief_some_code_with_underscores');
    expect(r?.action).toBe('brief');
    expect(r?.order_code).toBe('some_code_with_underscores');
  });
});
