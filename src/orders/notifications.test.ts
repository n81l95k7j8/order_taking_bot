import { describe, it, expect } from 'vitest';
import { generateOrderCode } from './notifications';

describe('generateOrderCode', () => {
  it('matches the expected format #A-YYYY-XXXXXXXX', () => {
    const code = generateOrderCode();
    expect(code).toMatch(/^#A-\d{4}-[0-9A-F]{8}$/);
  });

  it('contains the current year', () => {
    const code = generateOrderCode();
    const year = new Date().getFullYear();
    expect(code).toContain(`-${year}-`);
  });

  it('generates unique codes across calls', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) codes.add(generateOrderCode());
    // Allow one collision in 1000 (probability ≈ 1e-6 with 8 hex chars)
    expect(codes.size).toBeGreaterThanOrEqual(999);
  });
});
