import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelMatches, normalizeMake, type AuctionSource, type LotSearchFilters } from '@car-porter/core';
import { AUCTION_PAGE_SIZE, type AuctionSearchAdapter } from './auction-adapter.ts';
import type { BidfaxSearcher, HtmlFetcher } from './bidfax-client.ts';
import { bidfaxListingUrl } from './bidfax.ts';
import { parseCopartSearch } from './copart.ts';
import { parseIaaiSearch } from './iaai.ts';
import { statVinUrl } from './statvin.ts';
import { makesUrl, modelsUrl, type JsonFetcher } from './nhtsa.ts';

export const FIXTURES_DIR = fileURLToPath(new URL('../../test/fixtures/', import.meta.url));

export const readFixture = (relative: string) => readFile(path.join(FIXTURES_DIR, relative), 'utf8');

/**
 * Recorded bidfax pages: the Toyota make page and 2019 Camry listing pages 1–2. Other listings are
 * empty; other make pages have no model links (→ not_found).
 */
export const mockBidfaxFetcher: HtmlFetcher = async (url) => {
  const routes: Record<string, string> = {
    'https://bidfax.info/toyota/': 'bidfax/make-toyota.html',
    [bidfaxListingUrl('toyota', 'camry', 2019, 1)]: 'bidfax/toyota-camry-2019-p1.html',
    [bidfaxListingUrl('toyota', 'camry', 2019, 2)]: 'bidfax/toyota-camry-2019-p2.html',
  };
  const file = routes[url];
  if (file) return readFixture(file);
  return url.includes('/f/from-year=') ? '<html><body><div id="dle-content"></div></body></html>' : '<html></html>';
};

/** Recorded vehicle history: VIN 4T1B11HK0KU821110 (IAAI lot 46026832) is known, other searches are empty. */
export const MOCK_HISTORY_VIN = '4T1B11HK0KU821110';

export const mockBidfaxSearcher: BidfaxSearcher = async (query) => {
  const routes: Record<string, string> = {
    [MOCK_HISTORY_VIN]: 'bidfax/search-vin-4t1b11hk0ku821110.html',
    '46026832': 'bidfax/search-lot-46026832.html',
  };
  return readFixture(routes[query.trim().toUpperCase()] ?? 'bidfax/search-none.html');
};

export const mockStatVinFetcher: HtmlFetcher = async (url) =>
  readFixture(url === statVinUrl(MOCK_HISTORY_VIN) ? 'statvin/vin-4t1b11hk0ku821110.html' : 'statvin/vin-not-found.html');

/** Recorded ECB daily reference rates (2026-09-15: 1 EUR = 1.1539 USD). */
export const mockEcbFetcher = () => readFixture('ecb/eurofxref-daily.xml');

/** Serves recorded NHTSA responses (MOCK_SOURCES=1 and tests). Unknown makes get no models. */
export const mockNhtsaFetcher: JsonFetcher = async (url) => {
  const routes: Record<string, string> = {
    [makesUrl('car')]: 'nhtsa/makes-car.json',
    [makesUrl('multipurpose passenger vehicle (mpv)')]: 'nhtsa/makes-mpv.json',
    [makesUrl('truck')]: 'nhtsa/makes-truck.json',
    [modelsUrl('toyota')]: 'nhtsa/models-toyota.json',
    [modelsUrl('mercedes-benz')]: 'nhtsa/models-mercedes-benz.json',
  };
  const file = routes[url];
  return file ? JSON.parse(await readFixture(file)) : { Count: 0, Results: [] };
};

const isRecordedSearch = (f: LotSearchFilters) =>
  normalizeMake(f.make) === 'toyota' && modelMatches(f.model, 'camry') && f.yearFrom <= 2020 && f.yearTo >= 2018;

/**
 * Fixture-backed auction adapters: Toyota Camry searches overlapping 2018–2020 return the
 * recorded pages (filtered to the requested years); everything else returns no results.
 */
export function createMockAuctionAdapters(): AuctionSearchAdapter[] {
  const make = (source: AuctionSource, pages: Record<number, () => Promise<ReturnType<typeof parseCopartSearch>>>) => ({
    source,
    async search(filters: LotSearchFilters, page: number) {
      const load = pages[page];
      if (!isRecordedSearch(filters) || !load) {
        return { lots: [], total: 0, page, pageSize: AUCTION_PAGE_SIZE };
      }
      const result = await load();
      return {
        ...result,
        lots: result.lots.filter((l) => l.year >= filters.yearFrom && l.year <= filters.yearTo),
      };
    },
  });

  return [
    make('copart', {
      1: async () => parseCopartSearch(await readFixture('copart/search-toyota-camry-2018-2020.json'), 1),
    }),
    make('iaai', {
      1: async () => parseIaaiSearch(await readFixture('iaai/search-toyota-camry-2018-2020-p1.html'), 1),
      2: async () => parseIaaiSearch(await readFixture('iaai/search-toyota-camry-2018-2020-p2.html'), 2),
    }),
  ];
}
