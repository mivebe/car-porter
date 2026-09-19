import type { MarketListing } from '@car-porter/core';
import * as cheerio from 'cheerio';
import type { BrowserManager } from '../scraping/browser.ts';
import { assertNotChallenged, SourceError } from '../scraping/errors.ts';
import { createPageFetcher, type HtmlFetcher } from '../scraping/page-fetcher.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';
import { bidfaxSlug } from './bidfax.ts';
import { absoluteUrl, cleanText, notFound, parseKm, yearRange, type MarketAdapter, type YearRange } from './market-adapter.ts';

export const AUTOSCOUT24_ORIGIN = 'https://www.autoscout24.bg';

/**
 * First-registration year range. AutoScout24 has no listings located in Bulgaria (`cy=BG` is
 * always empty, verified 2026-09-16), so this uses the site's default EU countries: an EU
 * reference price, not a BG market price.
 */
export function autoscout24SearchUrl(make: string, model: string, years: number | YearRange, page = 1): string {
  const { from, to } = yearRange(years);
  return `${AUTOSCOUT24_ORIGIN}/lst/${bidfaxSlug(make)}/${bidfaxSlug(model)}?fregfrom=${from}&fregto=${to}&sort=standard&desc=0&atype=C${page > 1 ? `&page=${page}` : ''}`;
}

export function createAutoscout24Fetcher(browser: BrowserManager, queue: SourceQueue): HtmlFetcher {
  return createPageFetcher({ browser, queue, source: 'autoscout24' });
}

interface NextListing {
  url: string;
  images?: string[];
  price?: { priceRaw?: number };
  vehicle?: {
    make?: string;
    model?: string;
    modelVersionInput?: string | null;
    transmission?: string | null;
    fuel?: string | null;
    mileageInKm?: string | null;
  };
  location?: { countryCode?: string; city?: string };
  tracking?: { firstRegistration?: string };
}

interface NextPageProps {
  numberOfResults: number;
  numberOfPages: number;
  listings: NextListing[];
  pageQuery?: { mmmv?: string };
}

/** Listings from the page's `__NEXT_DATA__` JSON. `mmmv` ("70|2046||") holds make|model ids. */
export function parseAutoscout24Listing(html: string): { listings: MarketListing[]; numberOfPages: number; modelKnown: boolean } {
  assertNotChallenged(html, 'autoscout24');
  const json = cheerio.load(html)('script#__NEXT_DATA__').text();
  let props: NextPageProps;
  try {
    props = (JSON.parse(json) as { props: { pageProps: NextPageProps } }).props.pageProps;
    if (!Array.isArray(props.listings)) throw new Error('no listings');
  } catch {
    throw new SourceError('parse_failed', 'autoscout24: __NEXT_DATA__ listings not found');
  }

  const listings = props.listings.flatMap((l): MarketListing[] => {
    const url = absoluteUrl(l.url, AUTOSCOUT24_ORIGIN);
    if (!url) return [];
    const make = cleanText(l.vehicle?.make);
    const model = cleanText(l.vehicle?.model);
    const year = l.tracking?.firstRegistration?.match(/(19|20)\d{2}/)?.[0];
    const price = l.price?.priceRaw;
    return [
      {
        id: url,
        site: 'autoscout24',
        url,
        title: [make, model, cleanText(l.vehicle?.modelVersionInput)].filter(Boolean).join(' '),
        year: year ? Number(year) : null,
        make,
        model,
        trim: null,
        fuel: cleanText(l.vehicle?.fuel),
        transmission: cleanText(l.vehicle?.transmission),
        mileageKm: parseKm(l.vehicle?.mileageInKm),
        priceEurCents: typeof price === 'number' && price > 0 ? Math.round(price * 100) : null,
        location: [l.location?.countryCode, cleanText(l.location?.city)].filter(Boolean).join(', ') || null,
        imageUrl: l.images?.[0] ?? null,
        importOffer: false,
      },
    ];
  });

  const [, modelId] = props.pageQuery?.mmmv?.split('|') ?? [];
  return { listings, numberOfPages: props.numberOfPages ?? 0, modelKnown: !!modelId };
}

export function createAutoscout24Adapter(fetchHtml: HtmlFetcher): MarketAdapter {
  return {
    site: 'autoscout24',
    async scan(query, { maxPages }) {
      const make = query.make.label;
      const model = query.model.label;
      const listings: MarketListing[] = [];
      let page = 1;
      for (;;) {
        const result = parseAutoscout24Listing(await fetchHtml(autoscout24SearchUrl(make, model, query.years, page)));
        // an unknown make/model slug falls back to a broader search instead of an error
        if (!result.modelKnown) notFound('autoscout24', `model "${make} ${model}"`);
        listings.push(...result.listings);
        if (page >= result.numberOfPages || page >= maxPages) {
          return {
            listings,
            pagesScanned: page,
            complete: page >= result.numberOfPages,
            searchUrl: autoscout24SearchUrl(make, model, query.years),
          };
        }
        page++;
      }
    },
  };
}
