import { describe, expect, it } from 'vitest';
import { parseMoneyInput } from './parse-money';

describe('parseMoneyInput', () => {
  it('parses plain, grouped and decimal amounts to cents', () => {
    expect(parseMoneyInput('5000')).toBe(500_000);
    expect(parseMoneyInput('5,000')).toBe(500_000);
    expect(parseMoneyInput('5 000')).toBe(500_000);
    expect(parseMoneyInput('$5000.5')).toBe(500_050);
    expect(parseMoneyInput('€ 1234.56')).toBe(123_456);
  });

  it('returns null for empty and undefined for invalid input', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('  ')).toBeNull();
    expect(parseMoneyInput('abc')).toBeUndefined();
    expect(parseMoneyInput('1.234')).toBeUndefined();
    expect(parseMoneyInput('-5')).toBeUndefined();
  });
});
