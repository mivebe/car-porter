import { normalizeText } from './matching.ts';
import { modelTokens } from './vehicle-aliases.ts';

/** Words that say nothing about the trim once the model is chosen. */
const FILLER = new Set(['amg', 'class', 'series', 'trim']);

/**
 * The words of a trim search, minus what the make and model already say:
 * "C63 AMG" under Mercedes-Benz C-Class → ["63"], "Camaro ZL1" → ["zl1"].
 */
export function trimWords(trim: string, make: string, model: string): string[] {
  const known = new Set([...modelTokens(model, make), ...normalizeText(make).split(' ')]);
  const words: string[] = [];
  for (const word of glueSplitTrims(normalizeText(trim).split(' '))) {
    if (!word || FILLER.has(word) || known.has(word)) continue;
    // "c63" under C-Class: the model letter is glued to the trim number
    const glued = word.match(/^(\p{L}+)(\d.*)$/u);
    const rest = glued && known.has(glued[1]!) ? splitParts(glued[2]!) : [word];
    for (const w of rest) if (!words.includes(w)) words.push(w);
  }
  return words;
}

/**
 * "ZL 1" and "ZL-1" are typed for "ZL1": a short letter word followed by a number is one trim,
 * otherwise the bare "1" becomes the site keyword and finds nothing useful.
 */
function glueSplitTrims(words: string[]): string[] {
  const out: string[] = [];
  for (const word of words) {
    const prev = out[out.length - 1];
    if (prev && /^\p{L}{1,3}$/u.test(prev) && /^\d+$/.test(word)) out[out.length - 1] = prev + word;
    else out.push(word);
  }
  return out;
}

/** "2SS" → ["2", "ss"], "C63" → ["c", "63"]. */
const splitParts = (word: string) => word.split(/(?<=\p{L})(?=\d)|(?<=\d)(?=\p{L})/u);

/** "2SS" also counts as "2" and "SS", "C63" as "C" and "63". */
function lotWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const word of normalizeText(text).split(' ')) {
    if (!word) continue;
    words.add(word);
    for (const part of splitParts(word)) words.add(part);
  }
  return words;
}

/**
 * Every trim word appears in the lot's model or trim (auction sites file trims in either), whole
 * or as its letter/number parts: "63S" is found in "63 AMG-S".
 */
export function lotMatchesTrim(lot: { model: string; trim: string | null }, words: string[]): boolean {
  if (words.length === 0) return true;
  const have = lotWords(`${lot.model} ${lot.trim ?? ''}`);
  return words.every((w) => have.has(w) || splitParts(w).every((p) => have.has(p)));
}

/**
 * The single word to hand the auction site's keyword search. Sites disagree on multi-word
 * queries (Copart ORs them, IAAI ANDs them) and on glued forms ("C63" finds nothing on IAAI),
 * so the most specific word narrows the search and `lotMatchesTrim` checks the rest.
 * Verified live 2026-09-18: "63" finds every C 63 on both sites, "ZL1" every Camaro ZL1.
 */
export function trimKeyword(words: string[]): string | null {
  if (words.length === 0) return null;
  const score = (w: string) => (/\d/.test(w) ? 100 : 0) + w.length;
  return [...words].sort((a, b) => score(b) - score(a))[0]!;
}
