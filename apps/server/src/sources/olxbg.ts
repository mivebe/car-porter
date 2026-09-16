import type { MarketListing } from '@car-porter/core';
import type { CacheRepository } from '../repositories/cache-repository.ts';
import type { BrowserManager } from '../scraping/browser.ts';
import { assertNotChallenged, SourceError } from '../scraping/errors.ts';
import { createPageFetcher, type HtmlFetcher } from '../scraping/page-fetcher.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';
import {
  BGN_PER_EUR,
  cachedCatalog,
  cleanText,
  notFound,
  pickMake,
  pickModel,
  type CatalogEntry,
  type MarketAdapter,
} from './market-adapter.ts';

export const OLX_ORIGIN = 'https://www.olx.bg';
/** "Автомобили и Джипове"; a make page with this category id means OLX doesn't know the make. */
const CARS_CATEGORY_ID = 1117;
const PAGE_SIZE = 40;

const CARS_URL = `${OLX_ORIGIN}/avtomobili-karavani-lodki/avtomobili-dzhipove/`;

/** The cars category page; its state lists every make subcategory. */
export const olxCarsUrl = () => CARS_URL;
/** A make's category page, by OLX's own name for it ("mercedes", not "mercedes-benz"). */
export const olxMakeUrl = (makeValue: string) => `${CARS_URL}${makeValue}/`;

/** The site's own offers API (JSON), filtered by the make category, model and exact year. */
export function olxOffersUrl(categoryId: number, model: string, year: number, page = 1): string {
  return (
    `${OLX_ORIGIN}/api/v1/offers/?offset=${(page - 1) * PAGE_SIZE}&limit=${PAGE_SIZE}&category_id=${categoryId}` +
    `&filter_enum_model%5B0%5D=${encodeURIComponent(model)}` +
    `&filter_float_auto_make_year%3Afrom=${year}&filter_float_auto_make_year%3Ato=${year}`
  );
}

/** Human-readable results page for the same search. */
export const olxSearchPageUrl = (makeValue: string, model: string, year: number) =>
  `${olxMakeUrl(makeValue)}?search%5Bfilter_enum_model%5D%5B0%5D=${encodeURIComponent(model)}` +
  `&search%5Bfilter_float_auto_make_year%3Afrom%5D=${year}&search%5Bfilter_float_auto_make_year%3Ato%5D=${year}`;

/** Raw responses: the page state script is gone from the hydrated DOM, and the API is JSON. */
export function createOlxFetcher(browser: BrowserManager, queue: SourceQueue): HtmlFetcher {
  return createPageFetcher({ browser, queue, source: 'olxBg', raw: true });
}

interface OlxState {
  categories?: { list?: Record<string, { id: number; parentId: number; name: string; normalizedName: string }> };
  listing?: {
    listing?: { categoryId?: number };
    filters?: { data?: Record<string, { values?: { label: string; value: string }[]; options?: { categories?: number[] }[] }[]> };
  };
}

function pageState(html: string): OlxState {
  assertNotChallenged(html, 'olxBg');
  const m = html.match(/window\.__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*")/);
  try {
    return JSON.parse(JSON.parse(m![1]!) as string) as OlxState;
  } catch {
    throw new SourceError('parse_failed', 'olxBg: page state not found');
  }
}

/** Make subcategories of "Автомобили и Джипове" from the page state (value = URL name). */
export function parseOlxMakes(html: string): CatalogEntry[] {
  const list = Object.values(pageState(html).categories?.list ?? {});
  const makes = list.filter((c) => c.parentId === CARS_CATEGORY_ID).map((c) => ({ value: c.normalizedName, label: c.name }));
  if (makes.length === 0) throw new SourceError('parse_failed', 'olxBg: make categories not found');
  return makes;
}

/** Make category id and its model filter values from the make page's `__PRERENDERED_STATE__`. */
export function parseOlxMakePage(html: string): { categoryId: number; models: CatalogEntry[] } {
  const state = pageState(html);
  const categoryId = state.listing?.listing?.categoryId;
  if (!categoryId) throw new SourceError('parse_failed', 'olxBg: category id not found');
  if (categoryId === CARS_CATEGORY_ID) return { categoryId, models: [] };

  const definitions = state.listing?.filters?.data?.filter_enum_model ?? [];
  const forMake = definitions.find((d) => d.options?.some((o) => o.categories?.includes(categoryId)));
  const models = (forMake?.values ?? []).map((v) => ({ value: v.value, label: v.label }));
  return { categoryId, models };
}

type OlxParamValue = { key?: string; label?: string; value?: number; currency?: string };

interface OlxOffer {
  url: string;
  title: string;
  params: { key: string; value: OlxParamValue }[];
  location?: { city?: { name?: string } };
  photos?: { link?: string }[];
}

/** Offers API page: listings plus whether a next page exists. */
export function parseOlxOffers(json: string, context: { make: string }): { listings: MarketListing[]; hasNextPage: boolean } {
  let body: { data: OlxOffer[]; links?: { next?: unknown } };
  try {
    body = JSON.parse(json) as typeof body;
    if (!Array.isArray(body.data)) throw new Error('no data');
  } catch {
    assertNotChallenged(json, 'olxBg');
    throw new SourceError('parse_failed', 'olxBg: offers response not recognized');
  }

  const listings = body.data.map((offer): MarketListing => {
    const param = (key: string) => offer.params.find((p) => p.key === key)?.value;
    const price = param('price');
    const amount = typeof price?.value === 'number' && price.value > 0 ? price.value : null;
    const year = Number(param('auto_make_year')?.key);
    const km = Number(param('auto_mileage')?.key);
    return {
      id: offer.url,
      site: 'olxBg',
      url: offer.url,
      title: cleanText(offer.title) ?? '',
      year: Number.isInteger(year) && year > 1900 ? year : null,
      make: context.make,
      model: cleanText(param('model')?.label),
      trim: null,
      fuel: cleanText(param('auto_engine_type')?.label),
      transmission: cleanText(param('auto_transmission_type')?.label),
      mileageKm: Number.isFinite(km) && km > 0 ? km : null,
      priceEurCents:
        amount == null ? null : Math.round((price?.currency === 'BGN' ? amount / BGN_PER_EUR : amount) * 100),
      location: cleanText(offer.location?.city?.name),
      imageUrl: offer.photos?.[0]?.link?.replace('{width}', '400').replace('{height}', '300') ?? null,
      importOffer: false,
    };
  });
  return { listings, hasNextPage: !!body.links?.next };
}

export function createOlxAdapter(fetchRaw: HtmlFetcher, cache: CacheRepository): MarketAdapter {
  return {
    site: 'olxBg',
    async scan(query, { maxPages }) {
      const makes = await cachedCatalog(cache, 'makes', 'olxBg', async () => parseOlxMakes(await fetchRaw(olxCarsUrl())));
      const makeEntry = pickMake(makes, query.make) ?? notFound('olxBg', `make "${query.make}"`);
      const make = await cachedCatalog(cache, `make:${makeEntry.value}`, 'olxBg', async () =>
        parseOlxMakePage(await fetchRaw(olxMakeUrl(makeEntry.value))),
      );
      if (make.models.length === 0) notFound('olxBg', `models of "${query.make}"`);
      const model = pickModel(make.models, query.model) ?? notFound('olxBg', `model "${query.model}"`);

      const listings: MarketListing[] = [];
      let page = 1;
      for (;;) {
        const result = parseOlxOffers(await fetchRaw(olxOffersUrl(make.categoryId, model.value, query.year, page)), {
          make: makeEntry.label,
        });
        listings.push(...result.listings);
        if (!result.hasNextPage || page >= maxPages) {
          return {
            listings,
            pagesScanned: page,
            complete: !result.hasNextPage,
            searchUrl: olxSearchPageUrl(makeEntry.value, model.value, query.year),
          };
        }
        page++;
      }
    },
  };
}
