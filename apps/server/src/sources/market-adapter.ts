import { roundHalfUp, type MarketListing, type MarketSource } from '@car-porter/core';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import { cached } from '../scraping/cached.ts';
import { SourceError } from '../scraping/errors.ts';

/** Marketplace catalogs (makes, models, ids) rarely change. */
export const CATALOG_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The Bulgarian lev is pegged to the euro: 1 € = 1.95583 лв. */
export const BGN_PER_EUR = 1.95583;

/** A make or model as a marketplace lists it: its identifier in URLs/filters and its label. */
export interface CatalogEntry {
  value: string;
  label: string;
}

/** A search for one site make + model and an exact year. */
export interface MarketQuery {
  make: CatalogEntry;
  model: CatalogEntry;
  year: number;
}

export interface MarketScan {
  listings: MarketListing[];
  pagesScanned: number;
  /** Every result page was read (the page limit didn't cut the search short). */
  complete: boolean;
  /** First results page on the site, for opening the search directly. */
  searchUrl: string;
}

/** A site's own make and model lists, which the alias table maps to our names. */
export interface MarketCatalog {
  makes(): Promise<CatalogEntry[]>;
  models(make: CatalogEntry): Promise<CatalogEntry[]>;
}

export interface MarketAdapter {
  site: MarketSource;
  /** Without one (AutoScout24), the lot's own make and model are searched as given. */
  catalog?: MarketCatalog;
  /** Searches make + model + exact year; throws `not_found` when the site doesn't know them. */
  scan(query: MarketQuery, options: { maxPages: number }): Promise<MarketScan>;
}

/** Loads and caches a catalog, throwing the loader's error when there is nothing cached. */
export async function cachedCatalog<T>(cache: CacheRepository, key: string, site: MarketSource, load: () => Promise<T>) {
  const result = await cached(cache, { key: `market:catalog:${site}:${key}`, source: site, ttlMs: CATALOG_TTL_MS }, load);
  if (!result.ok) throw new SourceError(result.error.code, result.error.message);
  return result.data;
}

export function notFound(site: MarketSource, what: string): never {
  throw new SourceError('not_found', `${site}: ${what} not listed`);
}

/** "12 200 €" / "13,995 EUR" / "25 000 лв." → euro cents; null for "price on request". */
export function parsePriceEurCents(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/\s/g, '').match(/(\d[\d,.]*)(€|eur|лв|bgn)/i);
  if (!m) return null;
  // thousands separators are "," or "." followed by exactly three digits
  const amount = Number(m[1]!.replace(/[,.](?=\d{3}(?!\d))/g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const eur = /лв|bgn/i.test(m[2]!) ? amount / BGN_PER_EUR : amount;
  return roundHalfUp(eur * 100);
}

/** "189 084 км" / "189000 км." / "86 200 km" → 189084. */
export function parseKm(text: string | null | undefined): number | null {
  const m = text?.match(/(\d[\d\s,.]*)\s*(?:км|km)/i);
  if (!m) return null;
  const km = Number(m[1]!.replace(/[\s,.]/g, ''));
  return Number.isFinite(km) ? km : null;
}

export const cleanText = (text: string | null | undefined) => text?.replace(/\s+/g, ' ').trim() || null;

export const absoluteUrl = (href: string | null | undefined, origin: string) =>
  href ? new URL(href.startsWith('//') ? `https:${href}` : href, origin).toString() : null;
