import type { IaaiMarket, Lot, LotSearchPage } from '@car-porter/core';
import * as cheerio from 'cheerio';
import type { Page } from 'patchright';
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

const ORIGIN = 'https://www.iaai.com';
const PROFILE = 'iaai';

const facetSearch = (group: string, values: string[]) => ({
  Facets: values.map((Value) => ({ Group: group, Value })),
  FullSearch: null,
  LongRanges: null,
});

/**
 * The inventory types worth importing. Without them the make facet holds ~1100 names — boat,
 * trailer and RV builders — instead of ~150 (verified live 2026-09-17). Fleet and rental vehicles
 * are cars filed under their own type, so they stay in.
 */
const CAR_INVENTORY_TYPES = [
  'Automobiles',
  'SUVs',
  'Vans',
  'Pick-up Trucks',
  'Light Trucks',
  'Fleet Vehicles',
  'Rental Vehicles',
];

/** Values of IAAI's "Market" facet (verified live 2026-09-18). */
export const IAAI_MARKET_NAMES: Record<IaaiMarket, string> = {
  us: 'IAA United States',
  ca: 'IAA Canada',
  rb: 'Ritchie Bros.',
};

/**
 * Request body for IAAI's `POST /Search?c=<ts>` endpoint (returns an HTML results page).
 * Facets inside one `Searches` entry are OR'ed, separate entries are AND'ed.
 */
export function buildIaaiSearchBody(
  query: Partial<Pick<AuctionQuery, 'makes' | 'models' | 'keyword' | 'iaaiMarkets'>> & YearRange,
  page: number,
  size = AUCTION_PAGE_SIZE,
) {
  const keyword = query.keyword?.trim();
  return {
    Searches: [
      facetSearch('InventoryTypes', CAR_INVENTORY_TYPES),
      ...(query.makes?.length ? [facetSearch('Make', query.makes)] : []),
      ...(query.models?.length ? [facetSearch('Model', query.models)] : []),
      ...(query.iaaiMarkets?.length ? [facetSearch('Market', query.iaaiMarkets.map((m) => IAAI_MARKET_NAMES[m]))] : []),
      ...(keyword ? [{ Facets: null, FullSearch: keyword, LongRanges: null }] : []),
      {
        Facets: null,
        FullSearch: null,
        LongRanges: [{ From: query.yearFrom, Name: 'Year', To: query.yearTo }],
      },
    ],
    ZipCode: '',
    miles: 0,
    PageSize: size,
    CurrentPage: page,
    Sort: [{ IsGeoSort: false, SortField: 'AuctionDateTime', IsDescending: false }],
    ShowRecommendations: false,
    SaleStatusFilters: [{ SaleStatus: 1, IsSelected: true }],
    BidStatusFilters: [{ BidStatus: 6, IsSelected: true }],
  };
}

const US_TZ_OFFSETS: Record<string, number> = {
  EDT: -4, EST: -5, CDT: -5, CST: -6, MDT: -6, MST: -7, PDT: -7, PST: -8,
  AKDT: -8, AKST: -9, HDT: -9, HST: -10, AST: -4,
};

/**
 * IAAI rows carry the sale date without year in the visible text ("Wed Sep 16, 8:30am CDT") and
 * with year but a meaningless offset in the watch-button onclick ("9/16/2026 8:30:00 AM +00:00").
 * Combine: calendar date + time from onclick, timezone from the visible abbreviation.
 */
export function parseIaaiSaleDate(onclickDate: string | null, displayText: string | null): string | null {
  const m = onclickDate?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const [, month, day, year, h, min, sec, ampm] = m;
  let hour = Number(h) % 12;
  if (ampm!.toUpperCase() === 'PM') hour += 12;
  const tz = displayText?.match(/\b([A-Z]{3,4})\s*$/)?.[1];
  const offset = tz ? (US_TZ_OFFSETS[tz] ?? 0) : 0;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), hour - offset, Number(min), Number(sec));
  return new Date(utc).toISOString();
}

export function parseMoney(text: string | null | undefined): number | null {
  const m = text?.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  return m ? dollarsToCents(Number(m[1]!.replace(/,/g, ''))) : null;
}

/** A facet group embedded in the page, e.g. `"Group":"Make","Facets":[{"Count":437,"Value":"MERCEDES-BENZ"}]`. */
function facetGroup(html: string, group: string): { Count: number; Value: string }[] | null {
  const m = html.match(new RegExp(`"Group":"${group}","Facets":(\\[[^\\]]*\\])`));
  if (!m) return null;
  try {
    return JSON.parse(m[1]!) as { Count: number; Value: string }[];
  } catch {
    return null;
  }
}

/** Sum of the Year facet counts embedded in the page = total results for the search. */
export function parseIaaiTotal(html: string): number | null {
  return facetGroup(html, 'Year')?.reduce((sum, f) => sum + f.Count, 0) ?? null;
}

/** Make or Model values in IAAI's own spelling for the current search. */
export function parseIaaiFacets(html: string, group: 'Make' | 'Model'): ExternalFacet[] {
  const challenge = detectChallenge(html);
  if (challenge) throw new SourceError('blocked', `iaai: blocked by ${challenge}`);
  const facets = facetGroup(html, group);
  if (facets) return facets.map((f) => ({ name: f.Value, count: f.Count })).filter((f) => f.name);
  // an empty search has no facet groups at all
  if (facetGroup(html, 'Year') || /table-body/.test(html)) return [];
  throw new SourceError('parse_failed', `iaai: no ${group} facets found`);
}

function splitQuotedArgs(call: string): string[] {
  return [...call.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]!);
}

export function parseIaaiSearch(html: string, page: number): LotSearchPage {
  const challenge = detectChallenge(html);
  if (challenge) throw new SourceError('blocked', `iaai: blocked by ${challenge}`);

  const $ = cheerio.load(html);
  const rows = $('.table-body .table-row.table-row-border');
  const total = parseIaaiTotal(html);
  if (rows.length === 0 && total === null) {
    throw new SourceError('parse_failed', 'iaai: no result rows or totals found');
  }

  const lots: Lot[] = [];
  rows.each((_, el) => {
    const row = $(el);
    const fields = new Map<string, string>();
    row.find('[title]').each((_, f) => {
      const title = $(f).attr('title') ?? '';
      const idx = title.indexOf(':');
      if (idx > 0) {
        const label = title.slice(0, idx).trim();
        if (!fields.has(label)) fields.set(label, $(f).text().replace(/\s+/g, ' ').trim());
      }
    });

    // ImageModalClicked('stock', 'id~US', 'vin', 'branch', 'year', 'make', 'model', 'trim', 'false')
    const imageArgs = splitQuotedArgs(row.find('[onclick*="ImageModalClicked"]').attr('onclick') ?? '');
    const watchArgs = splitQuotedArgs(row.find('[onclick*="AddDelWatch"]').attr('onclick') ?? '');
    const detailHref = row.find('a[href^="/VehicleDetail/"]').first().attr('href');
    if (!detailHref || imageArgs.length < 8) return;

    const [stock, , vin, , year, make, model, trim] = imageArgs;
    const actionTexts = row
      .find('.data-list__value--action')
      .map((_, a) => $(a).text().replace(/\s+/g, ' ').trim())
      .get();
    const saleText = actionTexts.find((t) => /\b[A-Z][a-z]{2} \d{1,2}, .*\b[A-Z]{3,4}$/.test(t)) ?? null;
    const buyNowText = actionTexts.find((t) => /buy now/i.test(t));
    const odometer = fields.get('Odometer')?.match(/([\d,]+)\s*mi/i)?.[1];

    lots.push({
      id: `iaai:${stock}`,
      source: 'iaai',
      lotNumber: stock!,
      url: `${ORIGIN}${detailHref}`,
      vin: emptyToNull(vin ?? row.find('[id^="VIN-"]').text()),
      year: Number(year),
      make: make ?? '',
      model: model ?? '',
      trim: emptyToNull(trim),
      engine: emptyToNull(fields.get('Engine')),
      fuel: emptyToNull(fields.get('Fuel Type')),
      transmission: emptyToNull(fields.get('Transmission')),
      drive: emptyToNull(fields.get('Driveline Type')),
      odometerMiles: odometer ? Number(odometer.replace(/,/g, '')) : null,
      primaryDamage: emptyToNull(fields.get('Primary Damage')),
      secondaryDamage: emptyToNull(fields.get('Secondary Damage')),
      titleType: emptyToNull(fields.get('Title/Sale Doc')),
      location: emptyToNull(fields.get('Branch')),
      saleDate: parseIaaiSaleDate(watchArgs[2] ?? null, saleText),
      currentBidUsdCents: null,
      buyNowUsdCents: parseMoney(buyNowText),
      acvUsdCents: parseMoney(fields.get('ACV')),
      imageUrls: [row.find('img').first().attr('data-src') ?? row.find('img').first().attr('src')]
        .filter((u): u is string => !!u && !u.includes('noimage'))
        .map((u) => u.replace(/&amp;/g, '&')),
    });
  });

  return { lots, total: total ?? lots.length, page, pageSize: AUCTION_PAGE_SIZE };
}

async function bootstrap(page: Page) {
  await page.goto(`${ORIGIN}/Search?Keyword=`, { waitUntil: 'domcontentloaded' });
  const html = await page.content();
  const challenge = detectChallenge(html);
  if (challenge) throw new SourceError('blocked', `iaai: blocked by ${challenge}`);
}

export function createIaaiAdapter(browser: BrowserManager, queue: SourceQueue): AuctionSearchAdapter {
  const post = <T>(body: unknown, parse: (html: string) => T) =>
    queue.run('iaai', async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const sessionPage = await browser.sessionPage(PROFILE, bootstrap);
          const res = await sessionPage.evaluate(
            async ({ payload, timeoutMs }) => {
              try {
                const r = await fetch(`/Search?c=${Date.now()}`, {
                  method: 'POST',
                  headers: {
                    accept: '*/*',
                    'content-type': 'application/json; charset=UTF-8',
                    'x-requested-with': 'XMLHttpRequest',
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
          if (res.timedOut) throw new SourceError('timeout', `iaai: no answer within ${SITE_REQUEST_TIMEOUT_MS / 1000}s`);
          if (res.status === 403) throw new SourceError('blocked', 'iaai: 403 from search');
          return parse(res.text);
        } catch (err) {
          if (attempt >= 2 || !(err instanceof SourceError) || (err.code !== 'blocked' && err.code !== 'timeout')) throw err;
          await browser.resetSession(PROFILE);
        }
      }
    });

  return {
    source: 'iaai',
    makeFacets: (years) => post(buildIaaiSearchBody(years, 1, 1), (html) => parseIaaiFacets(html, 'Make')),
    modelFacets: (makes, years) =>
      post(buildIaaiSearchBody({ makes, ...years }, 1, 1), (html) => parseIaaiFacets(html, 'Model')),
    search: (query, page) => post(buildIaaiSearchBody(query, page), (html) => parseIaaiSearch(html, page)),
  };
}
