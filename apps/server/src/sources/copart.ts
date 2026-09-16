import type { Lot, LotSearchFilters, LotSearchPage } from '@car-porter/core';
import type { Page } from 'patchright';
import { z } from 'zod';
import type { BrowserManager } from '../scraping/browser.ts';
import { detectChallenge, SourceError } from '../scraping/errors.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';
import {
  AUCTION_PAGE_SIZE,
  dollarsToCents,
  emptyToNull,
  type AuctionSearchAdapter,
} from './auction-adapter.ts';

const ORIGIN = 'https://www.copart.com';
const PROFILE = 'copart';

const quote = (value: string) => `"${value.trim().toUpperCase().replace(/"/g, '')}"`;

/** Request body for Copart's internal `POST /public/lots/search-results` API. */
export function buildCopartSearchBody(filters: LotSearchFilters, page: number, size = AUCTION_PAGE_SIZE) {
  return {
    query: ['*'],
    filter: {
      MAKE: [`lot_make_desc:${quote(filters.make)}`],
      MODL: [`lot_model_desc:${quote(filters.model)}`],
      YEAR: [`lot_year:[${filters.yearFrom} TO ${filters.yearTo}]`],
    },
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

/** Parses the JSON text returned by the search API. */
export function parseCopartSearch(text: string, page: number): LotSearchPage {
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
  const { totalElements, content } = parsed.data.data.results;
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
  return page.evaluate(async (payload) => {
    const xsrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/)?.[1];
    const res = await fetch('/public/lots/search-results', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        ...(xsrf ? { 'x-xsrf-token': decodeURIComponent(xsrf) } : {}),
      },
      body: JSON.stringify(payload),
    });
    return { status: res.status, text: await res.text() };
  }, body);
}

export function createCopartAdapter(browser: BrowserManager, queue: SourceQueue): AuctionSearchAdapter {
  return {
    source: 'copart',
    search: (filters, page) =>
      queue.run('copart', async () => {
        const body = buildCopartSearchBody(filters, page);
        for (let attempt = 1; ; attempt++) {
          const sessionPage = await browser.sessionPage(PROFILE, bootstrap);
          const res = await postFromPage(sessionPage, body);
          try {
            if (res.status === 403) throw new SourceError('blocked', 'copart: 403 from search API');
            return parseCopartSearch(res.text, page);
          } catch (err) {
            // tokens can expire; re-bootstrap once
            if (attempt >= 2 || !(err instanceof SourceError) || err.code !== 'blocked') throw err;
            await browser.resetSession(PROFILE);
          }
        }
      }),
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
