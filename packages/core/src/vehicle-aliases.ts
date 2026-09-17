import { normalizeMake, normalizeText } from './matching.ts';

/**
 * Conversion between our canonical catalog (NHTSA make/model names shown in the search form)
 * and the names each auction site actually files lots under. Sites are inconsistent: IAAI has
 * "MERCEDES-BENZ", "MERCEDES BENZ" and "MERCERDES"; Copart files a C 63 under model "C" while
 * IAAI uses "AMG C 63", "C 63 AMG" or "C-CLASS". A search for a canonical name therefore expands
 * to every external name that maps to it.
 */

/** How an external name was tied to a canonical one. */
export type AliasMatch = 'exact' | 'rule' | 'fuzzy' | 'manual';

export interface AliasMapping {
  external: string;
  /** null = no canonical counterpart found */
  canonical: string | null;
  match: AliasMatch | null;
}

const compact = (s: string) => normalizeText(s).replace(/\s/g, '');

/** Damerau-Levenshtein (optimal string alignment) distance, capped: returns max+1 once exceeded. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length]![b.length]!;
}

/** Typos tolerated: none for short names (too many real collisions), 1 edit from 5 chars, 2 from 10. */
const allowedEdits = (length: number) => (length >= 10 ? 2 : length >= 5 ? 1 : 0);

/** Abbreviations seen on auction sites that no generic rule can resolve ("MERC" is also a Mercury prefix). */
const MAKE_ABBREVIATIONS: Record<string, string> = {
  merc: 'mercedes',
  chev: 'chevrolet',
  volks: 'volkswagen',
};

/**
 * Maps each external make to at most one canonical make:
 * exact (normalized/alias-equal) > rule (external adds words, "RAM TRUCKS" → Ram; or a unique
 * abbreviation, "NISS" → Nissan) > fuzzy (typo, "MERCERDES" → Mercedes-Benz).
 */
export function mapMakes(canonicalMakes: string[], externalMakes: string[]): AliasMapping[] {
  const canon = canonicalMakes.map((name) => ({ name, key: normalizeMake(name), words: normalizeText(name) }));
  return externalMakes.map((external) => {
    const key = MAKE_ABBREVIATIONS[compact(external)] ?? normalizeMake(external);
    const exact = canon.find((c) => c.key === key);
    if (exact) return { external, canonical: exact.name, match: 'exact' };

    const words = normalizeText(external);
    const extended = canon
      .filter((c) => words.startsWith(`${c.words} `))
      .sort((a, b) => b.words.length - a.words.length)[0];
    if (extended) return { external, canonical: extended.name, match: 'rule' };

    if (key.length >= 4) {
      const prefixed = canon.filter((c) => c.key.startsWith(key));
      if (prefixed.length === 1) return { external, canonical: prefixed[0]!.name, match: 'rule' };
    }

    const typo = uniqueClosest(canon, (c) => c.key, key);
    if (typo) return { external, canonical: typo.name, match: 'fuzzy' };
    return { external, canonical: null, match: null };
  });
}

/**
 * Exact or added-words make lookup ("GREAT DANE TRAILERS" → Great Dane) for very large lists
 * (NHTSA's ~12k trailer/motorcycle makes), without the abbreviation and typo rules of `mapMakes`.
 */
export function mapMakesByName(canonicalMakes: string[], externalMakes: string[]): AliasMapping[] {
  const byKey = new Map<string, string>();
  for (const name of canonicalMakes) if (!byKey.has(normalizeMake(name))) byKey.set(normalizeMake(name), name);
  return externalMakes.map((external) => {
    const exact = byKey.get(normalizeMake(external));
    if (exact) return { external, canonical: exact, match: 'exact' };
    const words = normalizeText(external).split(' ');
    for (let n = words.length - 1; n >= 1; n--) {
      const found = byKey.get(normalizeMake(words.slice(0, n).join(' ')));
      if (found) return { external, canonical: found, match: 'rule' };
    }
    return { external, canonical: null, match: null };
  });
}

function uniqueClosest<T>(items: T[], keyOf: (item: T) => string, key: string): T | null {
  const budget = allowedEdits(key.length);
  if (budget === 0) return null;
  let best: T[] = [];
  let bestDistance = budget + 1;
  for (const item of items) {
    const d = editDistance(key, keyOf(item), budget);
    if (d < bestDistance) [best, bestDistance] = [[item], d];
    else if (d === bestDistance) best.push(item);
  }
  return best.length === 1 ? best[0]! : null;
}

/** Words that carry no model identity: "C-Class" = "C", "3 Series" = "3", "AMG C 63" = "C 63". */
const FILLER = new Set(['class', 'series', 'amg']);

/** "C300 4MATIC" → ["c", "300", "4", "matic"]; a leading make name is dropped ("MAZDA3" → ["3"]). */
export function modelTokens(model: string, make = ''): string[] {
  const makeWords = new Set([...normalizeText(make).split(' '), normalizeMake(make)].filter(Boolean));
  const tokens = normalizeText(model.replace(/\([^)]*\)/g, ' '))
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .split(' ')
    .filter((t) => t && !FILLER.has(t));
  let start = 0;
  while (start < tokens.length - 1 && makeWords.has(tokens[start]!)) start++;
  return tokens.slice(start);
}

interface CanonicalModel {
  name: string;
  key: string;
  tokens: string[];
  /** "3 Series" → "3": also claims three-digit BMW-style names (330I, 328D, M340I) */
  seriesDigit: string | null;
}

/**
 * Maps external models to canonical models of the same make. An external name can map to more
 * than one canonical model: its most specific name match ("GLE COUPE" → GLE-Class) plus family
 * rules ("330I" → 330i and 3 Series). Unmatched externals are returned with canonical null.
 */
export function mapModels(make: string, canonicalModels: string[], externalModels: string[]): AliasMapping[] {
  const canon: CanonicalModel[] = canonicalModels
    .map((name) => {
      const tokens = modelTokens(name, make);
      const seriesDigit = /\bseries\b/i.test(name) && tokens.length === 1 && /^\d$/.test(tokens[0]!) ? tokens[0]! : null;
      return { name, key: tokens.join(''), tokens, seriesDigit };
    })
    .filter((c) => c.key);

  const rows: AliasMapping[] = [];
  for (const external of externalModels) {
    const tokens = modelTokens(external, make);
    const prefixes = tokens.map((_, i) => tokens.slice(0, i + 1).join(''));
    const found = new Map<string, AliasMatch>();

    // most specific canonical name that the external starts with, token-aligned ("CLA 250" is not "C")
    const named = longest(canon.filter((c) => prefixes.includes(c.key)));
    const match: AliasMatch = named.length > 0 && tokens.join('') === named[0]!.key ? 'exact' : 'rule';
    for (const c of named) found.set(c.name, match);

    if (named.length === 0) {
      const typos = longest(
        canon.filter((c) => {
          const budget = allowedEdits(c.key.length);
          return budget > 0 && prefixes.some((p) => editDistance(p, c.key, budget) <= budget);
        }),
      );
      for (const c of typos) found.set(c.name, 'fuzzy');
    }

    if (found.size === 0) {
      // suffix letter missing on the site: Copart "530" → 530i, 530e
      const key = tokens.join('');
      for (const c of canon) {
        const extra = c.tokens.slice(tokens.length);
        if (extra.length === 1 && /^\p{L}{1,2}$/u.test(extra[0]!) && c.tokens.slice(0, tokens.length).join('') === key) {
          found.set(c.name, 'rule');
        }
      }
    }
    if (found.size === 0 && tokens.length > 1) {
      // extra leading word: "GR SUPRA" → Supra, "NEW BEETLE" → Beetle
      const rest = tokens.slice(1);
      const restPrefixes = rest.map((_, i) => rest.slice(0, i + 1).join(''));
      for (const c of longest(canon.filter((c) => restPrefixes.includes(c.key)))) found.set(c.name, 'rule');
    }

    const numbered = tokens[0] === 'm' ? tokens[1] : tokens[0];
    for (const c of canon) {
      if (c.seriesDigit && numbered && new RegExp(`^${c.seriesDigit}\\d\\d$`).test(numbered) && !found.has(c.name)) {
        found.set(c.name, 'rule');
      }
    }

    if (found.size === 0) rows.push({ external, canonical: null, match: null });
    for (const [canonical, m] of found) rows.push({ external, canonical, match: m });
  }
  return rows;
}

function longest(items: CanonicalModel[]): CanonicalModel[] {
  const max = Math.max(0, ...items.map((c) => c.key.length));
  return items.filter((c) => c.key.length === max);
}

/** External names (in site spelling) that a canonical name expands to. */
export function externalNamesFor(mappings: AliasMapping[], canonical: string): string[] {
  const key = normalizeText(canonical);
  return [...new Set(mappings.filter((m) => m.canonical && normalizeText(m.canonical) === key).map((m) => m.external))];
}
