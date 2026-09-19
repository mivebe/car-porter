import { normalizeFuel, normalizeTransmission, type MarketListing } from '@car-porter/core';
import * as cheerio from 'cheerio';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { BrowserManager } from '../scraping/browser.ts';
import { assertNotChallenged, SourceError } from '../scraping/errors.ts';
import { createPageFetcher, type HtmlFetcher } from '../scraping/page-fetcher.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';
import {
  absoluteUrl,
  cachedCatalog,
  cleanText,
  parseKm,
  parsePriceEurCents,
  yearRange,
  type CatalogEntry,
  type MarketAdapter,
  type YearRange,
} from './market-adapter.ts';

export const MOBILEBG_ORIGIN = 'https://www.mobile.bg';
const CARS = `${MOBILEBG_ORIGIN}/obiavi/avtomobili-dzhipove`;

export const mobileBgMakesUrl = () => CARS;
export const mobileBgMakeUrl = (make: string) => `${CARS}/${make}`;

/** Year-range search, e.g. `/obiavi/avtomobili-dzhipove/toyota/rav4/ot-2019/do-2019/p-2`. */
export function mobileBgSearchUrl(make: string, model: string, years: number | YearRange, page = 1): string {
  const { from, to } = yearRange(years);
  return `${CARS}/${make}/${model}/ot-${from}/do-${to}${page > 1 ? `/p-${page}` : ''}`;
}

export function createMobileBgFetcher(browser: BrowserManager, queue: SourceQueue): HtmlFetcher {
  return createPageFetcher({ browser, queue, source: 'mobileBg' });
}

/** Category links on any cars page: `/obiavi/avtomobili-dzhipove/{make}` (and `/{make}/{model}` on make pages). */
function categoryLinks(html: string, depth: 1 | 2, make?: string): CatalogEntry[] {
  assertNotChallenged(html, 'mobileBg');
  const $ = cheerio.load(html);
  const pattern =
    depth === 1
      ? /^(?:https:)?\/\/www\.mobile\.bg\/obiavi\/avtomobili-dzhipove\/([a-z0-9-]+)\/?$/
      : new RegExp(`^(?:https:)?//www\\.mobile\\.bg/obiavi/avtomobili-dzhipove/${make}/([a-z0-9-]+)/?$`);
  const seen = new Map<string, CatalogEntry>();
  $('a[href]').each((_, a) => {
    const value = $(a).attr('href')!.match(pattern)?.[1];
    if (!value || /^p-\d+$/.test(value) || seen.has(value)) return;
    // labels carry listing counts: "Toyota (7586)"
    const label = cleanText($(a).text().replace(/\(\d+\)\s*$/, ''));
    seen.set(value, { value, label: label ?? value.replace(/-/g, ' ') });
  });
  return [...seen.values()];
}

export const parseMobileBgMakes = (html: string) => categoryLinks(html, 1);
export const parseMobileBgModels = (html: string, make: string) => categoryLinks(html, 2, make);

/**
 * Search results: `.item` cards with title, price, a params row ("юли 2019 г.", "189 084 км",
 * colour, fuel, power, transmission, body) and the seller location. Cars still abroad say
 * "Намира се в САЩ" - import offers rather than BG market prices.
 */
export function parseMobileBgListing(
  html: string,
  context: { make: string; model: string },
): { listings: MarketListing[]; linkedPages: number[] } {
  assertNotChallenged(html, 'mobileBg');
  const $ = cheerio.load(html);
  const listings = new Map<string, MarketListing>();

  $('.item').each((_, el) => {
    const item = $(el);
    const link = item.find('a.title').first();
    const url = absoluteUrl(link.attr('href'), MOBILEBG_ORIGIN);
    const title = cleanText(link.text());
    // promo cards (e.g. dealer banners) link elsewhere than an ad page
    if (!url || !title || !/\/obiava-\d+/.test(url) || listings.has(url)) return;

    let year: number | null = null;
    let mileageKm: number | null = null;
    let fuel: string | null = null;
    let transmission: string | null = null;
    item.find('.params span').each((_, span) => {
      const text = cleanText($(span).text()) ?? '';
      const km = /км$/i.test(text) ? parseKm(text) : null;
      if (km != null) mileageKm = km;
      else if (/^\D*(19|20)\d{2}\s*г\.?$/.test(text)) year = Number(text.match(/(19|20)\d{2}/)![0]);
      else if (!fuel && normalizeFuel(text)) fuel = text;
      else if (!transmission && normalizeTransmission(text)) transmission = text;
    });
    const location = cleanText(item.find('.seller .location').first().text());

    listings.set(url, {
      id: url,
      site: 'mobileBg',
      url,
      title,
      year,
      make: context.make,
      model: context.model,
      trim: null,
      fuel,
      transmission,
      mileageKm,
      priceEurCents: parsePriceEurCents(item.find('.price > div').first().text()),
      location,
      imageUrl: absoluteUrl(item.find('img.pic').attr('src'), MOBILEBG_ORIGIN),
      importOffer: /^Намира се в/i.test(location ?? ''),
    });
  });

  const linkedPages = [
    ...new Set(
      $('.pagination a[href]')
        .map((_, a) => Number($(a).attr('href')!.match(/\/p-(\d+)\/?$/)?.[1]))
        .get()
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ].sort((a, b) => a - b);

  if (listings.size === 0 && $('.pagination, .ads2023').length === 0) {
    throw new SourceError('parse_failed', 'mobileBg: search markup not recognized');
  }
  return { listings: [...listings.values()], linkedPages };
}

export function createMobileBgAdapter(fetchHtml: HtmlFetcher, cache: CacheRepository): MarketAdapter {
  return {
    site: 'mobileBg',
    catalog: {
      makes: () => cachedCatalog(cache, 'makes', 'mobileBg', async () => parseMobileBgMakes(await fetchHtml(mobileBgMakesUrl()))),
      models: (make) =>
        cachedCatalog(cache, `models:${make.value}`, 'mobileBg', async () =>
          parseMobileBgModels(await fetchHtml(mobileBgMakeUrl(make.value)), make.value),
        ),
    },
    async scan({ make, model, years }, { maxPages }) {
      const listings: MarketListing[] = [];
      let page = 1;
      for (;;) {
        const result = parseMobileBgListing(await fetchHtml(mobileBgSearchUrl(make.value, model.value, years, page)), {
          make: make.value,
          model: model.value,
        });
        listings.push(...result.listings);
        const hasNext = result.linkedPages.includes(page + 1);
        if (!hasNext || page >= maxPages) {
          return { listings, pagesScanned: page, complete: !hasNext, searchUrl: mobileBgSearchUrl(make.value, model.value, years) };
        }
        page++;
      }
    },
  };
}
