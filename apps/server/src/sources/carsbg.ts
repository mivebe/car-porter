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
  parsePriceEurCents,
  type CatalogEntry,
  type MarketAdapter,
} from './market-adapter.ts';

export const CARSBG_ORIGIN = 'https://www.cars.bg';

const LIST = `${CARSBG_ORIGIN}/carslist.php?subm=1&add_search=1&typeoffer=1`;

export const carsBgHomeUrl = () => `${CARSBG_ORIGIN}/`;
/** A make's result page lists that make's models as `models[]` checkboxes. */
export const carsBgBrandUrl = (brandId: string) => `${LIST}&brandId=${brandId}`;

export function carsBgSearchUrl(brandId: string, modelId: string, year: number, page = 1): string {
  return `${LIST}&brandId=${brandId}&models%5B%5D=${modelId}&yearFrom=${year}&yearTo=${year}${page > 1 ? `&page=${page}` : ''}`;
}

export function createCarsBgFetcher(browser: BrowserManager, queue: SourceQueue): HtmlFetcher {
  return createPageFetcher({ browser, queue, source: 'carsBg' });
}

function inputs(html: string, name: string): CatalogEntry[] {
  assertNotChallenged(html, 'carsBg');
  const $ = cheerio.load(html);
  const entries: CatalogEntry[] = [];
  $(`input[name="${name}"]`).each((_, el) => {
    const value = $(el).attr('value');
    const label = cleanText($(`label[for="${$(el).attr('id')}"]`).first().text()) ?? cleanText($(el).parent().text());
    if (value && value !== '0' && label && !entries.some((e) => e.value === value)) entries.push({ value, label });
  });
  return entries;
}

/** Make radio buttons of the home page search form (`brandId`). */
export const parseCarsBgBrands = (html: string) => inputs(html, 'brandId');
/** Model checkboxes (`models[]`) of a make's result page. */
export const parseCarsBgModels = (html: string) => inputs(html, 'models[]');

/**
 * Result cards (`.offer`): title, price ("13,995 EUR"), "2019, Хибрид, 189000 км." and
 * "seller, city". Cards have no transmission.
 */
export function parseCarsBgListing(
  html: string,
  context: { make: string; model: string },
): { listings: MarketListing[]; hasNextPage: boolean } {
  assertNotChallenged(html, 'carsBg');
  const $ = cheerio.load(html);
  const listings = new Map<string, MarketListing>();

  $('.offer').each((_, el) => {
    const card = $(el);
    const url = card.find('a[href*="/offer/"]').first().attr('href');
    const title = cleanText(card.attr('title')) ?? cleanText(card.find('.card__title').last().text());
    if (!url || !title || listings.has(url)) return;

    const facts = (cleanText(card.find('.card__secondary').first().text()) ?? '').split(',').map((s) => s.trim());
    const year = facts.find((f) => /^(19|20)\d{2}$/.test(f));
    const footer = cleanText(card.find('.card__footer').first().text());
    const background = card.find('.mdc-card__media').attr('style')?.match(/url\(["']?([^"')]+)["']?\)/)?.[1];

    listings.set(url, {
      id: url,
      site: 'carsBg',
      url,
      title,
      year: year ? Number(year) : null,
      make: context.make,
      model: context.model,
      trim: null,
      fuel: facts.find((f) => f && !/^\d/.test(f) && !/км/.test(f)) ?? null,
      transmission: null,
      mileageKm: parseKm(facts.find((f) => /км/.test(f))),
      priceEurCents: parsePriceEurCents(card.find('.price').first().text()),
      location: footer?.split(',').at(-1)?.trim() || null,
      imageUrl: background ?? null,
      importOffer: false,
    });
  });

  // the site loads more results on scroll; the <noscript> fallback links the next page
  const noscript = $('noscript').text() + $('noscript').html();
  const hasNextPage = /carslist\.php[^"']*[?&]page=\d+/.test(noscript);

  if (listings.size === 0 && $('.pageContainer, #listPage').length === 0) {
    throw new SourceError('parse_failed', 'carsBg: search markup not recognized');
  }
  return { listings: [...listings.values()], hasNextPage };
}

export function createCarsBgAdapter(fetchHtml: HtmlFetcher, cache: CacheRepository): MarketAdapter {
  return {
    site: 'carsBg',
    catalog: {
      makes: () => cachedCatalog(cache, 'makes', 'carsBg', async () => parseCarsBgBrands(await fetchHtml(carsBgHomeUrl()))),
      models: (brand) =>
        cachedCatalog(cache, `models:${brand.value}`, 'carsBg', async () => parseCarsBgModels(await fetchHtml(carsBgBrandUrl(brand.value)))),
    },
    async scan({ make: brand, model, year }, { maxPages }) {
      const listings: MarketListing[] = [];
      let page = 1;
      for (;;) {
        const result = parseCarsBgListing(await fetchHtml(carsBgSearchUrl(brand.value, model.value, year, page)), {
          make: brand.label,
          model: model.label,
        });
        listings.push(...result.listings);
        if (!result.hasNextPage || result.listings.length === 0 || page >= maxPages) {
          return {
            listings,
            pagesScanned: page,
            complete: !result.hasNextPage || result.listings.length === 0,
            searchUrl: carsBgSearchUrl(brand.value, model.value, year),
          };
        }
        page++;
      }
    },
  };
}
