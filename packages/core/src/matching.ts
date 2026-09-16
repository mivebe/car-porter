import type { AuctionRecord, Lot, MarketListing } from './types.ts';

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
  [/hybrid|хибрид/i, 'hybrid'],
  [/electric|\bev\b|електр/i, 'electric'],
  [/diesel|дизел/i, 'diesel'],
  [/lpg|газ\/бензин|пропан/i, 'lpg'],
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
  const liters = engine.match(/(\d{1,2}[.,]\d)\s*(?:l\b|л\b|liter|litre|\s|$)/i);
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

export function trimMatches(a: string, b: string): boolean {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (compact(a) === compact(b)) return true;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  // one trim's words are all contained in the other ("SE" ⊂ "SE AWD")
  return [...ta].every((t) => tb.has(t)) || [...tb].every((t) => ta.has(t));
}

function finalize<K extends string>(criteria: Record<K, CriterionResult>, required: K[]): MatchResult<K> {
  const entries = Object.entries(criteria) as [K, CriterionResult][];
  const matches =
    entries.every(([, r]) => r !== 'mismatch') && required.every((k) => criteria[k] === 'match');
  return { matches, criteria, unknown: entries.filter(([, r]) => r === 'unknown').map(([k]) => k) };
}

export type AuctionCriterion = 'make' | 'model' | 'year' | 'trim' | 'engine' | 'fuel';

/**
 * Bidfax price-estimate match: make + model + exact year are required; trim, engine and fuel
 * must not conflict (unknown on either side is allowed and reported).
 */
export function matchAuctionRecord(lot: Lot, record: AuctionRecord): MatchResult<AuctionCriterion> {
  return finalize<AuctionCriterion>(
    {
      make: compare(lot.make, record.make, (a, b) => normalizeMake(a) === normalizeMake(b)),
      model: compare(lot.model, record.model, modelMatches),
      year: compare(lot.year, record.year, (a, b) => a === b),
      trim: compare(lot.trim, record.trim, trimMatches),
      engine: compare(engineLiters(lot.engine), engineLiters(record.engine), (a, b) => Math.abs(a - b) < 0.05),
      fuel: compare(normalizeFuel(lot.fuel), normalizeFuel(record.fuel), (a, b) => a === b),
    },
    ['make', 'model', 'year'],
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
  options: { now: Date; maxMonths: number; maxMatches: number },
): { record: AuctionRecord; match: MatchResult<AuctionCriterion> }[] {
  return records
    .filter((r) => r.finalPriceUsdCents != null && isWithinMonths(r.saleDate, options.now, options.maxMonths))
    .map((record) => ({ record, match: matchAuctionRecord(lot, record) }))
    .filter(({ match }) => match.matches)
    .sort((a, b) => (b.record.saleDate ?? '').localeCompare(a.record.saleDate ?? ''))
    .slice(0, options.maxMatches);
}

export interface MarketMatchToggles {
  mileage: boolean;
  transmission: boolean;
  fuel: boolean;
}

export type MarketCriterion = 'make' | 'model' | 'year' | 'trim' | 'mileage' | 'transmission' | 'fuel';

/**
 * BG market match: make + model + exact year required, trim must not conflict; mileage
 * (± range, lot miles → km), transmission and fuel are only compared when toggled on.
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
      year: compare(lot.year, listing.year, (a, b) => a === b),
      trim: compare(lot.trim, listing.trim, trimMatches),
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
