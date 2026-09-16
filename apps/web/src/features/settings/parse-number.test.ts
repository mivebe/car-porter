import { describe, expect, it } from 'vitest';
import { parseNumberInput } from './parse-number';

describe('parseNumberInput', () => {
  it('parses plain, grouped and decimal numbers', () => {
    expect(parseNumberInput('2500')).toBe(2500);
    expect(parseNumberInput(' 30 000 ')).toBe(30_000);
    expect(parseNumberInput('30 000')).toBe(30_000);
    expect(parseNumberInput('30,000')).toBe(30_000);
    expect(parseNumberInput('1,500.5')).toBe(1500.5);
    expect(parseNumberInput('0.92')).toBe(0.92);
    expect(parseNumberInput('0,92')).toBe(0.92);
    expect(parseNumberInput('13,5')).toBe(13.5);
  });

  it('returns null when empty and NaN for anything else', () => {
    expect(parseNumberInput('  ')).toBeNull();
    expect(parseNumberInput('abc')).toBeNaN();
    expect(parseNumberInput('-5')).toBeNaN();
    expect(parseNumberInput('1.2.3')).toBeNaN();
  });
});
