import type { Lot, LotSearchPage } from '@car-porter/core';
import type { Page } from 'patchright';
import { z } from 'zod';
import type { BrowserManager } from '../scraping/browser.ts';
import { detectChallenge, SITE_REQUEST_TIMEOUT_MS, SourceError } from '../scraping/errors.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';
import {
  AUCTION_PAGE_SIZE,
  dollarsToCents,
  emptyToNull,
  type AuctionQuery,
  type AuctionSearchAdapter,
  type ExternalFacet,
  type YearRange,
} from './auction-adapter.ts';

const ORIGIN = 'https://www.copart.com';
const PROFILE = 'copart';

const quote = (value: string) => `"${value.trim().toUpperCase().replace(/"/g, '')}"`;

/**
 * Cars, SUVs, pickups and vans. Copart's other types (motorcycles, boats, trailers, heavy trucks,
 * ATVs, industrial equipment) bring in makes and models we never import, e.g. forklift models
 * under Toyota. Verified live 2026-09-17: this keeps 4Runner, Tacoma and Sienna.
 */
const AUTOMOBILES = 'vehicle_type_code:VEHTYPE_V';

/**
 * Filter map for the search API. Values under one key are OR'ed, keys are AND'ed. Facets are
 * computed "multi-select" style: a key's own facet ignores that key's filter.
 */
export function copartFilter(query: Partial<Pick<AuctionQuery, 'makes' | 'models'>> & YearRange) {
  return {
    VEHT: [AUTOMOBILES],
    ...(query.makes?.length ? { MAKE: query.makes.map((m) => `lot_make_desc:${quote(m)}`) } : {}),
    ...(query.models?.length
      ? { MODL: query.models.map((m) => `lot_model_desc:${quote(m)}`) }
      : {}),
    YEAR: [`lot_year:[${query.yearFrom} TO ${query.yearTo}]`],
  };
}

/** Request body for Copart's internal `POST /public/lots/search-results` API. */
export function buildCopartSearchBody(query: AuctionQuery, page: number, size = AUCTION_PAGE_SIZE) {
  return {
    query: ['*'],
    filter: copartFilter(query),
    sort: ['auction_date_utc asc'],
    page: page - 1,
    size,
    start: (page - 1) * size,
    watchListOnly: false,
    freeFormSearch: false,
    hideImages: false,
    defaultSort: false,
    specificRowProvided: false,
    displayName: '',
    searchName: '',
    backUrl: '',
    includeTagByField: {},
    rawParams: {},
  };
}

const copartLot = z.looseObject({
  ln: z.number(),
  mkn: z.string().nullish(),
  lm: z.string().nullish(),
  mmod: z.string().nullish(),
  ltd: z.string().nullish(),
  lcy: z.number(),
  fv: z.string().nullish(),
  egn: z.string().nullish(),
  ft: z.string().nullish(),
  tmtp: z.string().nullish(),
  drv: z.string().nullish(),
  orr: z.number().nullish(),
  dd: z.string().nullish(),
  sdd: z.string().nullish(),
  td: z.string().nullish(),
  tgd: z.string().nullish(),
  yn: z.string().nullish(),
  ad: z.number().nullish(),
  hb: z.number().nullish(),
  bnp: z.number().nullish(),
  la: z.number().nullish(),
  tims: z.string().nullish(),
  ldu: z.string().nullish(),
  dynamicLotDetails: z.looseObject({ currentBid: z.number().nullish() }).nullish(),
});

const copartSearchResponse = z.looseObject({
  returnCode: z.number(),
  data: z.looseObject({
    results: z.looseObject({
      totalElements: z.number(),
      content: z.array(z.unknown()),
    }),
  }),
});

export function copartImageUrls(thumbnail: string | null | undefined): string[] {
  if (!thumbnail) return [];
  return [thumbnail.replace(/_thb\.jpg$/i, '_hrs.jpg'), thumbnail];
}

export function parseCopartLot(raw: unknown): Lot | null {
  const parsed = copartLot.safeParse(raw);
  if (!parsed.success) return null;
  const l = parsed.data;
  const lotNumber = String(l.ln);
  const currentBid = l.dynamicLotDetails?.currentBid ?? l.hb;
  return {
    id: `copart:${lotNumber}`,
    source: 'copart',
    lotNumber,
    url: `${ORIGIN}/lot/${lotNumber}${l.ldu ? `/${l.ldu}` : ''}`,
    vin: emptyToNull(l.fv),
    year: l.lcy,
    make: emptyToNull(l.mkn) ?? '',
    model: emptyToNull(l.lm) ?? emptyToNull(l.mmod) ?? '',
    trim: emptyToNull(l.ltd),
    engine: emptyToNull(l.egn),
    fuel: emptyToNull(l.ft),
    transmission: emptyToNull(l.tmtp),
    drive: emptyToNull(l.drv),
    odometerMiles: l.orr != null && l.orr > 0 ? Math.round(l.orr) : null,
    primaryDamage: emptyToNull(l.dd),
    secondaryDamage: emptyToNull(l.sdd),
    titleType: emptyToNull(l.tgd) ?? emptyToNull(l.td),
    location: emptyToNull(l.yn),
    saleDate: l.ad && l.ad > 0 ? new Date(l.ad).toISOString() : null,
    currentBidUsdCents: dollarsToCents(currentBid),
    buyNowUsdCents: dollarsToCents(l.bnp),
    acvUsdCents: dollarsToCents(l.la),
    imageUrls: copartImageUrls(l.tims),
  };
}

function parseResponse(text: string) {
  const challenge = detectChallenge(text);
  if (challenge) throw new SourceError('blocked', `copart: blocked by ${challenge}`);

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SourceError('parse_failed', 'copart: search response is not JSON');
  }
  const parsed = copartSearchResponse.safeParse(json);
  if (!parsed.success || parsed.data.returnCode !== 1) {
    throw new SourceError('parse_failed', 'copart: unexpected search response');
  }
  return parsed.data.data.results;
}

const facetFields = z.array(
  z.looseObject({
    quickPickCode: z.string(),
    facetCounts: z.array(z.looseObject({ count: z.number(), query: z.string() })),
  }),
);

export const COPART_FACET_LIMIT = 100;

/**
 * Facet values of one filter key ("MAKE", "MODL") in the site's exact spelling, taken from the
 * facet query (`lot_make_desc:"MERCEDES-BENZ"`) rather than the prettified display name.
 * Copart only returns the highest-count values of a facet (100–125 seen), so callers narrow by years.
 */
export function parseCopartFacets(text: string, code: 'MAKE' | 'MODL'): ExternalFacet[] {
  const fields = facetFields.safeParse(parseResponse(text).facetFields);
  if (!fields.success) throw new SourceError('parse_failed', 'copart: unexpected facet fields');
  return (fields.data.find((f) => f.quickPickCode === code)?.facetCounts ?? [])
    .map((c) => ({ name: c.query.match(/^[a-z_]+:"(.*)"$/)?.[1] ?? '', count: c.count }))
    .filter((f) => f.name);
}

/** Parses the JSON text returned by the search API. */
export function parseCopartSearch(text: string, page: number): LotSearchPage {
  const { totalElements, content } = parseResponse(text);
  return {
    lots: content.map(parseCopartLot).filter((l): l is Lot => l !== null),
    total: totalElements,
    page,
    pageSize: AUCTION_PAGE_SIZE,
  };
}

async function bootstrap(page: Page) {
  await page.goto(`${ORIGIN}/lotSearchResults?free=true&query=`, { waitUntil: 'domcontentloaded' });
  // the SPA fires its own search once bot-protection has cleared; that's our "ready" signal
  await page
    .waitForResponse((r) => r.url().includes('/public/lots/search-results'), { timeout: 45_000 })
    .catch(() => {
      throw new SourceError('blocked', 'copart: search page did not load (bot protection?)');
    });
}

async function postFromPage(page: Page, body: unknown) {
  const res = await page.evaluate(
    async ({ payload, timeoutMs }) => {
      const xsrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1];
      try {
        const r = await fetch('/public/lots/search-results', {
          method: 'POST',
          headers: {
            accept: 'application/json, text/plain, */*',
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest',
            ...(xsrf ? { 'x-xsrf-token': decodeURIComponent(xsrf) } : {}),
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return { status: r.status, text: await r.text(), timedOut: false };
      } catch (err) {
        if ((err as Error).name === 'TimeoutError') return { status: 0, text: '', timedOut: true };
        throw err;
      }
    },
    { payload: body, timeoutMs: SITE_REQUEST_TIMEOUT_MS },
  );
  if (res.timedOut) throw new SourceError('timeout', `copart: no answer within ${SITE_REQUEST_TIMEOUT_MS / 1000}s`);
  return res;
}

export function createCopartAdapter(
  browser: BrowserManager,
  queue: SourceQueue,
): AuctionSearchAdapter {
  const post = <T>(body: unknown, parse: (text: string) => T) =>
    queue.run('copart', async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const sessionPage = await browser.sessionPage(PROFILE, bootstrap);
          const res = await postFromPage(sessionPage, body);
          if (res.status === 403) throw new SourceError('blocked', 'copart: 403 from search API');
          return parse(res.text);
        } catch (err) {
          // tokens can expire and hung requests usually mean a stale session; re-bootstrap once
          if (attempt >= 2 || !(err instanceof SourceError) || (err.code !== 'blocked' && err.code !== 'timeout')) throw err;
          await browser.resetSession(PROFILE);
        }
      }
    });
  const facetBody = (filter: ReturnType<typeof copartFilter>) => ({
    ...buildCopartSearchBody({ makes: [], models: [], yearFrom: 0, yearTo: 0 }, 1, 1),
    filter,
  });

  return {
    source: 'copart',
    facetLimit: COPART_FACET_LIMIT,
    makeFacets: (years) =>
      post(facetBody(copartFilter(years)), (text) => parseCopartFacets(text, 'MAKE')),
    modelFacets: (makes, years) =>
      post(facetBody(copartFilter({ makes, ...years })), (text) => parseCopartFacets(text, 'MODL')),
    search: (query, page) =>
      post(buildCopartSearchBody(query, page), (text) => parseCopartSearch(text, page)),
  };
}

export const COPART_LOGIN_URL = `${ORIGIN}/login/`;

export interface CopartLogin {
  status: () => { windowOpen: boolean };
  /** Opens copart.com's login page in a visible window on the Copart profile (login is optional). */
  open: () => Promise<{ windowOpen: boolean }>;
}

export function createCopartLogin(browser: BrowserManager, queue: SourceQueue): CopartLogin {
  let windowOpen = false;
  return {
    status: () => ({ windowOpen }),
    open: () =>
      // queued so it never closes the profile under a running search
      queue.run('copart', async () => {
        if (!windowOpen) {
          const { closed } = await browser.openWindow(PROFILE, COPART_LOGIN_URL);
          windowOpen = true;
          void closed.then(() => (windowOpen = false));
        }
        return { windowOpen };
      }),
  };
}
