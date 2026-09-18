import { describe, expect, it } from 'vitest';
import { lotMatchesTrim, trimKeyword, trimWords } from './trim.ts';

// real model/trim pairs from the sites (2026-09-18)
const COPART_C = [
  { model: 'C', trim: '63 AMG-S' },
  { model: 'C', trim: '63 AMG S E PERFORMANCE' },
  { model: 'C', trim: '43 4MATIC AMG' },
  { model: 'C', trim: '300 4MATIC' },
];
const IAAI_C = [
  { model: 'AMG C 63', trim: 'S' },
  { model: 'C 63 AMG', trim: null },
  { model: 'C 300', trim: 'SPORT 4MATIC' },
];
const CAMARO = [
  { model: 'CAMARO', trim: 'ZL1' },
  { model: 'CAMARO', trim: 'RWD  ZL1' },
  { model: 'CAMARO', trim: '2SS' },
  { model: 'CAMARO', trim: '1LT' },
];

const kept = (lots: { model: string; trim: string | null }[], words: string[]) =>
  lots.filter((l) => lotMatchesTrim(l, words)).map((l) => `${l.model}/${l.trim}`);

describe('trimWords', () => {
  it('drops what the make and model already say', () => {
    expect(trimWords('C 63', 'Mercedes-Benz', 'C-Class')).toEqual(['63']);
    expect(trimWords('C63 AMG', 'Mercedes-Benz', 'C-Class')).toEqual(['63']);
    expect(trimWords('Mercedes C63 S', 'Mercedes-Benz', 'C-Class')).toEqual(['63', 's']);
    expect(trimWords('C63S', 'Mercedes-Benz', 'C-Class')).toEqual(['63', 's']);
    expect(trimWords('Camaro ZL1', 'Chevrolet', 'Camaro')).toEqual(['zl1']);
    expect(trimWords('2SS', 'Chevrolet', 'Camaro')).toEqual(['2ss']);
    expect(trimWords('  ', 'Chevrolet', 'Camaro')).toEqual([]);
  });
});

describe('lotMatchesTrim', () => {
  it('finds the trim in either the model or the trim field', () => {
    expect(kept(COPART_C, ['63'])).toEqual(['C/63 AMG-S', 'C/63 AMG S E PERFORMANCE']);
    expect(kept(IAAI_C, ['63'])).toEqual(['AMG C 63/S', 'C 63 AMG/null']);
    expect(kept([...COPART_C, ...IAAI_C], ['63', 's'])).toEqual(['C/63 AMG-S', 'C/63 AMG S E PERFORMANCE', 'AMG C 63/S']);
  });

  it('matches whole words or their letter/number parts', () => {
    expect(kept(CAMARO, ['zl1'])).toEqual(['CAMARO/ZL1', 'CAMARO/RWD  ZL1']);
    expect(kept(CAMARO, ['ss'])).toEqual(['CAMARO/2SS']);
    expect(kept(CAMARO, ['1lt'])).toEqual(['CAMARO/1LT']);
    expect(kept(CAMARO, [])).toHaveLength(4);
  });
});

describe('trimKeyword', () => {
  it('picks the most specific word for the site search', () => {
    expect(trimKeyword(['63', 's'])).toBe('63');
    expect(trimKeyword(['zl1'])).toBe('zl1');
    expect(trimKeyword(['sport', 'gt'])).toBe('sport');
    expect(trimKeyword([])).toBeNull();
  });
});
