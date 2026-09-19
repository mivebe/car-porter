import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteEngineLiters, type AuctionSource } from '@car-porter/core';
import {
  AUCTION_PAGE_SIZE,
  type AuctionQuery,
  type AuctionSearchAdapter,
  type ExternalFacet,
  type OptionFacets,
} from './auction-adapter.ts';
import type { BidfaxSearcher, HtmlFetcher } from './bidfax-client.ts';
import { bidfaxListingUrl } from './bidfax.ts';
import { parseCopartFacets, parseCopartSearch, type CopartLogin } from './copart.ts';
import { parseIaaiFacets, parseIaaiSearch } from './iaai.ts';
import { statVinUrl } from './statvin.ts';
import { autoscout24SearchUrl } from './autoscout24.ts';
import { carsBgBrandUrl, carsBgHomeUrl, carsBgSearchUrl } from './carsbg.ts';
import type { MarketSource } from '@car-porter/core';
import { mobileBgMakesUrl, mobileBgMakeUrl, mobileBgSearchUrl } from './mobilebg.ts';
import { mobileDeMakesUrl, mobileDeMakeUrl, mobileDeSearchUrl } from './mobilede.ts';
import { olxCarsUrl, olxMakeUrl, olxOffersUrl } from './olxbg.ts';
import { makesUrl, modelsUrl, type JsonFetcher } from './nhtsa.ts';

export const FIXTURES_DIR = fileURLToPath(new URL('../../test/fixtures/', import.meta.url));

export const readFixture = (relative: string) => readFile(path.join(FIXTURES_DIR, relative), 'utf8');

/** A Cloudflare challenge page, as served to a blocked client. */
const CHALLENGE_PAGE = '<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div></body></html>';
/** A page whose markup no parser recognizes (e.g. after a site redesign). */
const UNRECOGNIZED_PAGE = '<html><body><main><h1>We have a new look!</h1></main></body></html>';

/**
 * Error paths for E2E, always through the real parsers:
 * - lot search Toyota Corolla: Copart blocked by a challenge, IAAI markup not recognized;
 * - bidfax 2018 Camry listing: bidfax's own 429 anti-bot page (blocked);
 * - mobile.bg 2018 Camry search: markup not recognized (cars.bg still answers).
 */
export const MOCK_ERROR_MODEL = 'corolla';
export const MOCK_ERROR_YEAR = 2018;

/**
 * Recorded bidfax pages: the Toyota make page and 2019 Camry listing pages 1–2. Other listings are
 * empty (the 2018 Camry listing is the rate-limit page); other make pages have no model links (→ not_found).
 */
export const mockBidfaxFetcher: HtmlFetcher = async (url) => {
  const routes: Record<string, string> = {
    'https://en.bidfax.info/toyota/': 'bidfax/make-toyota.html',
    [bidfaxListingUrl('toyota', 'camry', 2019, 1)]: 'bidfax/toyota-camry-2019-p1.html',
    [bidfaxListingUrl('toyota', 'camry', 2019, 2)]: 'bidfax/toyota-camry-2019-p2.html',
    [bidfaxListingUrl('toyota', 'camry', MOCK_ERROR_YEAR, 1)]: 'bidfax/rate-limit-429.html',
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

/**
 * Recorded marketplace pages for Toyota Camry 2019 (and RAV 4 on mobile.bg / cars.bg / OLX / mobile.de). Other
 * searches of a known make/model return empty result pages.
 */
export function createMockMarketFetchers(): Record<MarketSource, HtmlFetcher> {
  const route =
    (routes: Record<string, string>, fallback: string, pages: Record<string, string> = {}) =>
    async (url: string) =>
      routes[url] ? readFixture(routes[url]) : (pages[url] ?? fallback);
  return {
    mobileBg: route(
      {
        [mobileBgMakesUrl()]: 'mobilebg/makes.html',
        [mobileBgMakeUrl('toyota')]: 'mobilebg/make-toyota.html',
        [mobileBgSearchUrl('toyota', 'camry', 2019)]: 'mobilebg/toyota-camry-2019.html',
        [mobileBgSearchUrl('toyota', 'rav4', 2019)]: 'mobilebg/toyota-rav4-2019-p1.html',
      },
      '<html><body><div class="ads2023"></div></body></html>',
      { [mobileBgSearchUrl('toyota', 'camry', MOCK_ERROR_YEAR)]: UNRECOGNIZED_PAGE },
    ),
    carsBg: route(
      {
        [carsBgHomeUrl()]: 'carsbg/home.html',
        [carsBgBrandUrl('80')]: 'carsbg/brand-toyota.html',
        [carsBgSearchUrl('80', '1374', 2019)]: 'carsbg/toyota-camry-2019.html',
        [carsBgSearchUrl('80', '1393', 2019)]: 'carsbg/toyota-rav4-2019-p1.html',
      },
      '<html><body><div id="listPage"></div></body></html>',
    ),
    autoscout24: route(
      {
        [autoscout24SearchUrl('toyota', 'camry', 2019)]: 'autoscout24/toyota-camry-2019-p1.html',
        [autoscout24SearchUrl('toyota', 'camry', 2019, 2)]: 'autoscout24/toyota-camry-2019-p2.html',
      },
      '<html><body><script id="__NEXT_DATA__">{"props":{"pageProps":{"numberOfResults":0,"numberOfPages":0,"listings":[],"pageQuery":{"mmmv":"70|2046||"}}}}</script></body></html>',
    ),
    olxBg: route(
      {
        [olxCarsUrl()]: 'olxbg/cars.html',
        [olxMakeUrl('toyota')]: 'olxbg/make-toyota.html',
        [olxOffersUrl(1181, 'camry', 2019)]: 'olxbg/offers-1181-camry-2019.json',
        [olxOffersUrl(1181, 'rav-4', 2020)]: 'olxbg/offers-1181-rav-4-2020.json',
      },
      '{"data":[],"links":{}}',
    ),
    mobileDe: route(
      {
        [mobileDeMakesUrl()]: 'mobilede/makes.html',
        [mobileDeMakeUrl('24100')]: 'mobilede/make-toyota.html',
        [mobileDeMakeUrl('17200')]: 'mobilede/make-mercedes-benz.html',
        [mobileDeSearchUrl('24100', '6', 2019)]: 'mobilede/toyota-camry-2019.html',
        [mobileDeSearchUrl('24100', '28', { from: 2016, to: 2022 })]: 'mobilede/toyota-rav4-2016-2022-p1.html',
        [mobileDeSearchUrl('24100', '28', { from: 2016, to: 2022 }, 2)]: 'mobilede/toyota-rav4-2016-2022-p2.html',
      },
      '<html><body><script>self.__next_f.push([1,"{\\"searchResults\\":{\\"numResultsTotal\\":0,\\"listings\\":[]}}"])</script></body></html>',
    ),
  };
}

/** Recorded ECB daily reference rates (2026-09-15: 1 EUR = 1.1539 USD). */
export const mockEcbFetcher = () => readFixture('ecb/eurofxref-daily.xml');

/** Serves recorded NHTSA responses (MOCK_SOURCES=1 and tests). Unknown makes get no models. */
export const mockNhtsaFetcher: JsonFetcher = async (url) => {
  const routes: Record<string, string> = {
    [makesUrl('car')]: 'nhtsa/makes-car.json',
    [makesUrl('multipurpose passenger vehicle (mpv)')]: 'nhtsa/makes-mpv.json',
    [makesUrl('truck')]: 'nhtsa/makes-truck.json',
    [makesUrl('motorcycle')]: 'nhtsa/makes-motorcycle.json',
    ...Object.fromEntries(
      ['toyota', 'mercedes-benz'].flatMap((make) =>
        (
          [
            ['car', 'car'],
            ['multipurpose passenger vehicle (mpv)', 'mpv'],
            ['truck', 'truck'],
          ] as const
        ).map(([type, short]) => [modelsUrl(make, type), `nhtsa/models-${make}-${short}.json`]),
      ),
    ),
  };
  const file = routes[url];
  return file ? JSON.parse(await readFixture(file)) : { Count: 0, Results: [] };
};

/** Site spellings served as facets, including variants the alias table has to fold together. */
const MOCK_MAKES: ExternalFacet[] = [
  { name: 'TOYOTA', count: 3000 },
  { name: 'TOYO', count: 2 },
  { name: 'MERCEDES-BENZ', count: 700 },
  { name: 'MERCEDES BENZ', count: 6 },
  { name: 'GREAT DANE TRAILERS', count: 16 },
  { name: 'HARLEY-DAVIDSON', count: 300 },
];
const MOCK_MODELS: Record<string, ExternalFacet[]> = {
  TOYOTA: [
    { name: 'CAMRY', count: 1600 },
    { name: 'CAMARY', count: 3 },
    { name: 'COROLLA', count: 900 },
    { name: 'RAV4', count: 700 },
  ],
  'MERCEDES-BENZ': [
    { name: 'C', count: 200 },
    { name: 'AMG C 63', count: 7 },
    { name: 'CLA', count: 40 },
  ],
};

const isErrorSearch = (q: AuctionQuery) => q.makes.includes('TOYOTA') && q.models.includes(MOCK_ERROR_MODEL.toUpperCase());

const isRecordedSearch = (q: AuctionQuery) =>
  q.makes.includes('TOYOTA') && q.models.includes('CAMRY') && q.yearFrom <= 2020 && q.yearTo >= 2018;

/**
 * Fixture-backed auction adapters: Toyota Camry searches overlapping 2018–2020 return the
 * recorded pages (filtered to the requested years); Toyota Corolla fails (see MOCK_ERROR_MODEL);
 * everything else returns no results. Facets come from MOCK_MAKES / MOCK_MODELS, body and engine
 * facets from the recorded Camry page (engines also narrow its lots; body styles are not on lots).
 */
export function createMockAuctionAdapters(): AuctionSearchAdapter[] {
  const make = (
    source: AuctionSource,
    pages: Record<number, () => Promise<ReturnType<typeof parseCopartSearch>>>,
    options: () => Promise<OptionFacets>,
  ): AuctionSearchAdapter => ({
    source,
    makeFacets: async () => MOCK_MAKES,
    modelFacets: async (makes) => makes.flatMap((m) => MOCK_MODELS[m] ?? []),
    optionFacets: async (query) =>
      isRecordedSearch({ ...query }) || (query.makes.length === 0 && query.models.length === 0)
        ? options()
        : { body: [], engine: [] },
    async search(filters, page) {
      if (isErrorSearch(filters)) {
        return source === 'copart' ? parseCopartSearch(CHALLENGE_PAGE, page) : parseIaaiSearch(UNRECOGNIZED_PAGE, page);
      }
      const load = pages[page];
      if (!isRecordedSearch(filters) || !load) {
        return { lots: [], total: 0, page, pageSize: AUCTION_PAGE_SIZE };
      }
      const result = await load();
      const engines = filters.engines?.map(siteEngineLiters);
      return {
        ...result,
        lots: result.lots.filter(
          (l) =>
            l.year >= filters.yearFrom &&
            l.year <= filters.yearTo &&
            (!engines || engines.includes(l.engine ? siteEngineLiters(l.engine) : null)),
        ),
      };
    },
  });

  return [
    make(
      'copart',
      { 1: async () => parseCopartSearch(await readFixture('copart/search-toyota-camry-2018-2020.json'), 1) },
      async () => {
        const text = await readFixture('copart/search-toyota-camry-2018-2020.json');
        return { body: parseCopartFacets(text, 'BODY'), engine: parseCopartFacets(text, 'ENGN') };
      },
    ),
    make(
      'iaai',
      {
        1: async () => parseIaaiSearch(await readFixture('iaai/search-toyota-camry-2018-2020-p1.html'), 1),
        2: async () => parseIaaiSearch(await readFixture('iaai/search-toyota-camry-2018-2020-p2.html'), 2),
      },
      async () => {
        const html = await readFixture('iaai/search-toyota-camry-2018-2020-p1.html');
        return { body: parseIaaiFacets(html, 'BodyStyleName'), engine: parseIaaiFacets(html, 'DisplLiters') };
      },
    ),
  ];
}

/** Pretends to open the Copart login window (never launches a browser). */
export function createMockCopartLogin(): CopartLogin {
  let windowOpen = false;
  return {
    status: () => ({ windowOpen }),
    open: async () => ({ windowOpen: (windowOpen = true) }),
  };
}
