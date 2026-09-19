import type { MarketListing } from '@car-porter/core';
import * as cheerio from 'cheerio';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { BrowserManager } from '../scraping/browser.ts';
import { assertNotChallenged, SourceError } from '../scraping/errors.ts';
import { createPageFetcher, type HtmlFetcher } from '../scraping/page-fetcher.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';
import {
  cachedCatalog,
  cleanText,
  parseKm,
  yearRange,
  type CatalogEntry,
  type MarketAdapter,
  type YearRange,
} from './market-adapter.ts';

export const MOBILEDE_ORIGIN = 'https://suchen.mobile.de';
const SEARCH = `${MOBILEDE_ORIGIN}/fahrzeuge/search.html?isSearchRequest=true&s=Car&vc=Car&lang=en`;
/** Organic results per page; sponsored slots come on top of these. */
const PAGE_SIZE = 20;
/** Series such as "C-Class (All)" are models with this value prefix, searched in their own slot. */
const GROUP_PREFIX = 'group-';

/** Any search page carries the make list. */
export const mobileDeMakesUrl = () => SEARCH;
/** A make's search page carries that make's models. */
export const mobileDeMakeUrl = (makeId: string) => `${SEARCH}&ms=${encodeURIComponent(`${makeId};;;`)}`;

/** `ms` is "make;model;series;": a model or a whole series ("C-Class (All)") of a make. */
export function mobileDeSearchUrl(makeId: string, modelId: string, years: number | YearRange, page = 1): string {
  const { from, to } = yearRange(years);
  const series = modelId.startsWith(GROUP_PREFIX) ? modelId.slice(GROUP_PREFIX.length) : '';
  const ms = `${makeId};${series ? '' : modelId};${series};`;
  return `${SEARCH}&ms=${encodeURIComponent(ms)}&fr=${encodeURIComponent(`${from}:${to}`)}${page > 1 ? `&pageNumber=${page}` : ''}`;
}

export const mobileDeListingUrl = (id: string) => `${MOBILEDE_ORIGIN}/fahrzeuge/details.html?id=${id}`;

export function createMobileDeFetcher(browser: BrowserManager, queue: SourceQueue): HtmlFetcher {
  return createPageFetcher({ browser, queue, source: 'mobileDe' });
}

/** The page's React Server Components payload: the strings pushed to `self.__next_f`, joined. */
export function rscPayload(html: string): string {
  assertNotChallenged(html, 'mobileDe');
  let payload = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) payload += JSON.parse(m[1]!) as string;
  return payload;
}

/**
 * The JSON value of the first `"key":` in the payload whose text starts with `marker`, which may
 * reach into the value to pick the right one (`"makes":[{"i"`), or null.
 */
export function embeddedJson<T>(payload: string, marker: string): T | null {
  const at = payload.indexOf(marker);
  if (at < 0) return null;
  const start = payload.indexOf(':', at) + 1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < payload.length; i++) {
    const c = payload[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) {
      try {
        return JSON.parse(payload.slice(start, i + 1)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Make ids and names (`"makes":[{"i":24100,"n":"Toyota"}]`). */
export function parseMobileDeMakes(html: string): CatalogEntry[] {
  const makes = embeddedJson<{ i: number; n: string }[]>(rscPayload(html), '"makes":[{"i"');
  if (!makes?.length) throw new SourceError('parse_failed', 'mobileDe: make list not found');
  return makes.filter((m) => m.n !== 'Other').map((m) => ({ value: String(m.i), label: m.n }));
}

type ModelOption = { value: string; label: string; isGroup?: boolean };

/** A make's models and series (`"modelsCache":{"17200":[...]}`); a series is labelled "C-Class", not "C-Class (All)". */
export function parseMobileDeModels(html: string, makeId: string): CatalogEntry[] {
  const cache = embeddedJson<Record<string, (ModelOption | { optgroupLabel: string; items: ModelOption[] })[]>>(
    rscPayload(html),
    '"modelsCache":',
  );
  const options = cache?.[makeId];
  if (!options) throw new SourceError('parse_failed', 'mobileDe: model list not found');
  return options
    .flatMap((o) => ('items' in o ? o.items : [o]))
    .filter((o) => o.value)
    .map((o) => ({ value: o.value, label: o.isGroup ? o.label.replace(/\s*\(All\)$/i, '') : o.label }));
}

interface MobileDeResult {
  id: number | string;
  type: string;
  attr?: { cn?: string; loc?: string; fr?: string; ft?: string; ml?: string; tr?: string };
  price?: { grs?: { amount?: number } };
  make?: { localized?: string };
  model?: { localized?: string };
}

/**
 * Search results from the `searchResults` JSON (year, km, fuel, gearbox, gross € price) plus
 * titles and photos from the result cards. Sponsored top slots ("topOfPage", "topInCategory")
 * aren't bound to the search filters, so they are skipped.
 */
export function parseMobileDeListing(html: string): { listings: MarketListing[]; total: number } {
  const results = embeddedJson<{ numResultsTotal: number; listings: MobileDeResult[] }>(
    rscPayload(html),
    '"searchResults":{"numResultsTotal"',
  );
  if (!results || !Array.isArray(results.listings)) throw new SourceError('parse_failed', 'mobileDe: search results not found');

  const $ = cheerio.load(html);
  const cards = new Map<string, { title: string | null; imageUrl: string | null }>();
  $('a[href*="details.html"]').each((_, a) => {
    const id = $(a).attr('href')!.match(/[?&]id=(\d+)/)?.[1];
    if (!id || cards.has(id)) return;
    const title = $(a)
      .find('h2 span[title]')
      .map((_, s) => $(s).attr('title'))
      .get()
      .join(' ');
    // a thumbnail rather than the 1600 px photo
    const imageUrl = $(a).find('img').first().attr('src')?.replace(/rule=mo-\d+/, 'rule=mo-360') ?? null;
    cards.set(id, { title: cleanText(title), imageUrl });
  });

  const listings = results.listings
    .filter((l) => !l.type.startsWith('top'))
    .map((l): MarketListing => {
      const id = String(l.id);
      const url = mobileDeListingUrl(id);
      const make = cleanText(l.make?.localized);
      const model = cleanText(l.model?.localized);
      const year = l.attr?.fr?.match(/(19|20)\d{2}/)?.[0];
      const price = l.price?.grs?.amount;
      return {
        id: url,
        site: 'mobileDe',
        url,
        title: cards.get(id)?.title ?? [make, model].filter(Boolean).join(' '),
        year: year ? Number(year) : null,
        make,
        model,
        trim: null,
        fuel: cleanText(l.attr?.ft),
        transmission: cleanText(l.attr?.tr),
        mileageKm: parseKm(l.attr?.ml),
        priceEurCents: typeof price === 'number' && price > 0 ? Math.round(price * 100) : null,
        location: [l.attr?.cn, cleanText(l.attr?.loc)].filter(Boolean).join(', ') || null,
        imageUrl: cards.get(id)?.imageUrl ?? null,
        importOffer: false,
      };
    });
  return { listings, total: results.numResultsTotal };
}

export function createMobileDeAdapter(fetchHtml: HtmlFetcher, cache: CacheRepository): MarketAdapter {
  return {
    site: 'mobileDe',
    catalog: {
      makes: () => cachedCatalog(cache, 'makes', 'mobileDe', async () => parseMobileDeMakes(await fetchHtml(mobileDeMakesUrl()))),
      models: (make) =>
        cachedCatalog(cache, `models:${make.value}`, 'mobileDe', async () =>
          parseMobileDeModels(await fetchHtml(mobileDeMakeUrl(make.value)), make.value),
        ),
    },
    async scan({ make, model, years }, { maxPages }) {
      const listings: MarketListing[] = [];
      let page = 1;
      for (;;) {
        const result = parseMobileDeListing(await fetchHtml(mobileDeSearchUrl(make.value, model.value, years, page)));
        listings.push(...result.listings);
        const pages = Math.ceil(result.total / PAGE_SIZE);
        if (page >= pages || page >= maxPages) {
          return { listings, pagesScanned: page, complete: page >= pages, searchUrl: mobileDeSearchUrl(make.value, model.value, years) };
        }
        page++;
      }
    },
  };
}
