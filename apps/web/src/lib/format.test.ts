import { describe, expect, it } from 'vitest';
import { formatMoney, formatNumber, formatRelative, sentenceCase, titleCase } from './format';

describe('format', () => {
  it('formats money in USD/EUR for both languages', () => {
    expect(formatMoney(980_000, 'EUR', 'en')).toBe('€9,800');
    expect(formatMoney(123_456, 'USD', 'en', { decimals: true })).toBe('$1,234.56');
    expect(formatMoney(980_000, 'EUR', 'bg').replace(/\s/g, ' ')).toBe('9800 €');
    expect(formatMoney(null, 'USD', 'en')).toBe('-');
  });

  it('formats numbers', () => {
    expect(formatNumber(148715, 'en')).toBe('148,715');
    expect(formatNumber(undefined, 'en')).toBe('-');
  });

  it('formats relative times', () => {
    const now = new Date('2026-09-16T12:00:00Z');
    expect(formatRelative('2026-09-16T11:55:00Z', 'en', now)).toBe('5 minutes ago');
    expect(formatRelative('2026-09-16T11:59:40Z', 'en', now)).toBe('now');
    expect(formatRelative('2026-09-15T12:00:00Z', 'en', now)).toBe('yesterday');
    expect(formatRelative('2026-09-16T09:00:00Z', 'bg', now)).toBe('преди 3 часа');
  });

  it('sentence-cases all-caps descriptive values only', () => {
    expect(sentenceCase('REAR END')).toBe('Rear end');
    expect(sentenceCase('GAS')).toBe('Gas');
    expect(sentenceCase('Front & Rear')).toBe('Front & Rear');
    expect(sentenceCase(null)).toBe('');
  });

  it('title-cases auction names but keeps trims/acronyms', () => {
    expect(titleCase('TOYOTA CAMRY')).toBe('Toyota Camry');
    expect(titleCase('XSE V6')).toBe('XSE V6');
    expect(titleCase('MERCEDES-BENZ')).toBe('Mercedes-benz');
    expect(titleCase(null)).toBe('');
  });
});
