import { describe, expect, it } from 'vitest';
import bg from './locales/bg.json';
import en from './locales/en.json';

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe('locales', () => {
  it('bg has exactly the same keys as en', () => {
    expect(keys(bg).sort()).toEqual(keys(en).sort());
  });

  it('has no empty translations', () => {
    for (const locale of [en, bg]) {
      for (const key of keys(locale)) {
        const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], locale);
        expect(value, key).not.toBe('');
      }
    }
  });
});
