import type { AuctionRecord, Lot, MarketListing } from './types.ts';
import { modelTokens } from './vehicle-aliases.ts';

export const MILES_TO_KM = 1.609344;

export function milesToKm(miles: number): number {
  return Math.round(miles * MILES_TO_KM);
}

/** Lower-case, strip diacritics and punctuation, collapse whitespace. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const MAKE_ALIASES: Record<string, string> = {
  vw: 'volkswagen',
  chevy: 'chevrolet',
  'mercedes benz': 'mercedes',
  'mercedes-benz': 'mercedes',
  mb: 'mercedes',
  'land rover': 'landrover',
  'alfa romeo': 'alfaromeo',
  'мерцедес': 'mercedes',
  'фолксваген': 'volkswagen',
  'тойота': 'toyota',
  'бмв': 'bmw',
  'ауди': 'audi',
  'хонда': 'honda',
  'форд': 'ford',
};

export function normalizeMake(make: string): string {
  const n = normalizeText(make);
  return MAKE_ALIASES[n] ?? n.replace(/\s/g, '');
}

const compact = (s: string) => normalizeText(s).replace(/\s/g, '');

/**
 * Model names match when equal ignoring spaces/punctuation ("CR-V" = "CRV"), or when one is
 * the other followed by more words ("Camry" ~ "Camry Hybrid"); trim/fuel rules narrow further.
 */
export function modelMatches(a: string, b: string): boolean {
  if (compact(a) === compact(b)) return true;
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return na.startsWith(`${nb} `) || nb.startsWith(`${na} `);
}

export type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'plugin_hybrid' | 'electric' | 'lpg' | 'cng';

const FUEL_PATTERNS: [RegExp, Fuel][] = [
  [/plug[\s-]?in|phev|включващ/i, 'plugin_hybrid'],
  // AutoScout24.bg writes hybrids as "Ел/Бензин" (sometimes with a Latin E)
  [/hybrid|хибрид|[eе]л\s*\/\s*бензин|бензин\s*\/\s*[eе]л/i, 'hybrid'],
  [/electric|\bev\b|електр/i, 'electric'],
  [/diesel|дизел/i, 'diesel'],
  [/lpg|автогаз|газ\/бензин|пропан/i, 'lpg'],
  [/cng|метан/i, 'cng'],
  [/gas(oline)?|petrol|flex|бензин/i, 'petrol'],
];

export function normalizeFuel(fuel: string | null | undefined): Fuel | null {
  if (!fuel) return null;
  return FUEL_PATTERNS.find(([re]) => re.test(fuel))?.[1] ?? null;
}

export type Transmission = 'automatic' | 'manual';

export function normalizeTransmission(value: string | null | undefined): Transmission | null {
  if (!value) return null;
  if (/auto|автомат|cvt|dct|dsg|tiptronic/i.test(value)) return 'automatic';
  if (/manual|ръчн|mechan|механ|\bmt\b|stick/i.test(value)) return 'manual';
  return null;
}

/** Extracts engine displacement in liters from strings like "2.5L I4", "3.5 L", "1998 cc". */
export function engineLiters(engine: string | null | undefined): number | null {
  if (!engine) return null;
  // lookaheads instead of \b: JS word boundaries are ASCII-only, so "2.0л" would never match
  const liters = engine.match(/(\d{1,2}[.,]\d)\s*(?:l(?![\p{L}\p{N}])|л(?![\p{L}\p{N}])|liter|litre|\s|$)/iu);
  if (liters) return Number(liters[1]!.replace(',', '.'));
  const cc = engine.match(/(\d{3,4})\s*(?:cc|cm3|куб)/i);
  if (cc) return Math.round(Number(cc[1]) / 100) / 10;
  return null;
}

export type CriterionResult = 'match' | 'mismatch' | 'unknown';

export interface MatchResult<K extends string> {
  matches: boolean;
  criteria: Record<K, CriterionResult>;
  /** Criteria that couldn't be compared because one side lacks the data. */
  unknown: K[];
}

function compare<T>(a: T | null | undefined, b: T | null | undefined, eq: (x: T, y: T) => boolean) {
  if (a == null || b == null || a === '' || b === '') return 'unknown' as const;
  return eq(a, b) ? ('match' as const) : ('mismatch' as const);
}

/**
 * Trim words are equal, or one is a numbered level of the other ("1SS", "2SS" and "3LT" are
 * levels of SS and LT, which titles often leave out). "LT1" is its own trim, not a level of LT.
 */
function trimWordMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const level = /^\d([a-z]{2,3})$/;
  return a.match(level)?.[1] === b || b.match(level)?.[1] === a;
}

/** Performance packages that set a car's price apart, so both trims have them or neither does. */
const PACKAGES = ['1le'];

export function trimMatches(a: string, b: string): boolean {
  if (compact(a) === compact(b)) return true;
  const ta = normalizeText(a).split(' ');
  const tb = normalizeText(b).split(' ');
  if (PACKAGES.some((p) => ta.includes(p) !== tb.includes(p))) return false;
  const within = (xs: string[], ys: string[]) => xs.every((x) => ys.some((y) => trimWordMatches(x, y)));
  // one trim's words are all contained in the other ("SE" ⊂ "SE AWD")
  return within(ta, tb) || within(tb, ta);
}

function finalize<K extends string>(criteria: Record<K, CriterionResult>, required: K[]): MatchResult<K> {
  const entries = Object.entries(criteria) as [K, CriterionResult][];
  const matches =
    entries.every(([, r]) => r !== 'mismatch') && required.every((k) => criteria[k] === 'match');
  return { matches, criteria, unknown: entries.filter(([, r]) => r === 'unknown').map(([k]) => k) };
}

export type AuctionCriterion = 'make' | 'model' | 'year' | 'trim' | 'engine' | 'fuel';

/**
 * Bidfax files some models under a catch-all ("AMG" holds every C 63, E 63 and GLE 43) and keeps
 * the real model in the trim ("C 63 S"), so a model also matches when every word of the lot's
 * model appears in the record's model name plus trim.
 */
export function auctionModelMatches(lotModel: string, record: { make: string | null; model: string; trim: string | null }) {
  if (compact(lotModel) === compact(record.model)) return true;
  const wanted = modelTokens(lotModel, record.make ?? '');
  const have = new Set(modelTokens(`${record.model} ${record.trim ?? ''}`, record.make ?? ''));
  return wanted.length > 0 && wanted.every((t) => have.has(t));
}

/**
 * The lot as bidfax files it. A Copart "C" with trim "63 AMG" is a C 63 AMG, which bidfax lists
 * under its "AMG" model rather than C-Class, so an AMG performance trim moves into the model.
 */
export function bidfaxLot(lot: Lot): Lot {
  if (!lot.trim) return lot;
  const trim = normalizeText(lot.trim);
  if (!/\bamg\b/.test(trim) || !/\b(35|43|45|53|55|63|65)\b/.test(trim)) return lot;
  return { ...lot, model: `${lot.model} ${lot.trim}`, trim: null };
}

/**
 * Bidfax price-estimate match: make + model + exact year are required, and the trim too when the
 * lot has one (a trimless record could be any trim); engine and fuel must not conflict (unknown on
 * either side is allowed and reported). `modelName` is the bidfax model the records were listed
 * under ("AMG"), when their stored model is only its slug ("amg-gt").
 */
export function matchAuctionRecord(lot: Lot, record: AuctionRecord, modelName?: string): MatchResult<AuctionCriterion> {
  const model = modelName ?? record.model;
  return finalize<AuctionCriterion>(
    {
      make: compare(lot.make, record.make, (a, b) => normalizeMake(a) === normalizeMake(b)),
      model: compare(lot.model, model, (a, b) => auctionModelMatches(a, { make: record.make, model: b, trim: record.trim })),
      year: compare(lot.year, record.year, (a, b) => a === b),
      trim: compare(lot.trim, record.trim, trimMatches),
      engine: compare(engineLiters(lot.engine), engineLiters(record.engine), (a, b) => Math.abs(a - b) < 0.05),
      fuel: compare(normalizeFuel(lot.fuel), normalizeFuel(record.fuel), (a, b) => a === b),
    },
    lot.trim ? ['make', 'model', 'year', 'trim'] : ['make', 'model', 'year'],
  );
}

export function isWithinMonths(isoDate: string | null, now: Date, months: number): boolean {
  if (!isoDate) return false;
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return false;
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return date >= cutoff && date <= now;
}

/**
 * Selects bidfax matches for a lot: matching records with a price, sold within the window,
 * newest first, capped at `maxMatches`.
 */
export function selectAuctionMatches(
  lot: Lot,
  records: AuctionRecord[],
  options: { now: Date; maxMonths: number; maxMatches: number; modelName?: string },
): { record: AuctionRecord; match: MatchResult<AuctionCriterion> }[] {
  return records
    .filter((r) => r.finalPriceUsdCents != null && isWithinMonths(r.saleDate, options.now, options.maxMonths))
    .map((record) => ({ record, match: matchAuctionRecord(lot, record, options.modelName) }))
    .filter(({ match }) => match.matches)
    .sort((a, b) => (b.record.saleDate ?? '').localeCompare(a.record.saleDate ?? ''))
    .slice(0, options.maxMatches);
}

export interface MarketMatchToggles {
  mileage: boolean;
  transmission: boolean;
  fuel: boolean;
  /** Years either side of the lot's year that still match (0 = exact year). */
  yearSpan: number;
}

export type MarketCriterion = 'make' | 'model' | 'year' | 'trim' | 'location' | 'mileage' | 'transmission' | 'fuel';

/**
 * Trim against a listing: a structured trim must not conflict. Marketplaces mostly only have a
 * free-text title, so there the lot's trim appearing as a word counts as a match and anything else
 * stays unknown (titles are too inconsistent to rule a listing out).
 */
function marketTrim(lotTrim: string | null, listing: MarketListing): CriterionResult {
  if (listing.trim) return compare(lotTrim, listing.trim, trimMatches);
  if (!lotTrim) return 'unknown';
  const words = new Set(normalizeText(listing.title).split(' '));
  return normalizeText(lotTrim)
    .split(' ')
    .every((w) => words.has(w))
    ? 'match'
    : 'unknown';
}

/**
 * BG market match: make + model + year (± the year span) required, trim must not conflict, import offers
 * (cars still abroad) never match; mileage (± range, lot miles → km), transmission and fuel are
 * only compared when toggled on.
 */
export function matchMarketListing(
  lot: Lot,
  listing: MarketListing,
  toggles: MarketMatchToggles,
  mileageRangeKm: number,
): MatchResult<MarketCriterion> {
  const lotKm = lot.odometerMiles == null ? null : milesToKm(lot.odometerMiles);
  const skip = 'match' as const;
  return finalize<MarketCriterion>(
    {
      make: compare(lot.make, listing.make, (a, b) => normalizeMake(a) === normalizeMake(b)),
      model: compare(lot.model, listing.model, modelMatches),
      year: compare(lot.year, listing.year, (a, b) => Math.abs(a - b) <= toggles.yearSpan),
      trim: marketTrim(lot.trim, listing),
      location: listing.importOffer ? 'mismatch' : 'match',
      mileage: toggles.mileage
        ? compare(lotKm, listing.mileageKm, (a, b) => Math.abs(a - b) <= mileageRangeKm)
        : skip,
      transmission: toggles.transmission
        ? compare(normalizeTransmission(lot.transmission), normalizeTransmission(listing.transmission), (a, b) => a === b)
        : skip,
      fuel: toggles.fuel
        ? compare(normalizeFuel(lot.fuel), normalizeFuel(listing.fuel), (a, b) => a === b)
        : skip,
    },
    ['make', 'model', 'year'],
  );
}
