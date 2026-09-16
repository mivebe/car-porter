import type { Lot, LotSearchFilters, LotSearchPage } from '@car-porter/core';
import * as cheerio from 'cheerio';
import type { Page } from 'patchright';
import type { BrowserManager } from '../scraping/browser.ts';
import { detectChallenge, SourceError } from '../scraping/errors.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';
import {
  AUCTION_PAGE_SIZE,
  dollarsToCents,
  emptyToNull,
  type AuctionSearchAdapter,
} from './auction-adapter.ts';

const ORIGIN = 'https://www.iaai.com';
const PROFILE = 'iaai';

/** Request body for IAAI's `POST /Search?c=<ts>` endpoint (returns an HTML results page). */
export function buildIaaiSearchBody(filters: LotSearchFilters, page: number, size = AUCTION_PAGE_SIZE) {
  return {
    Searches: [
      { Facets: null, FullSearch: `${filters.make} ${filters.model}`.trim(), LongRanges: null },
      {
        Facets: null,
        FullSearch: null,
        LongRanges: [{ From: filters.yearFrom, Name: 'Year', To: filters.yearTo }],
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

/** Sum of the Year facet counts embedded in the page = total results for the search. */
export function parseIaaiTotal(html: string): number | null {
  const m = html.match(/"Group":"Year","Facets":(\[[^\]]*\])/);
  if (!m) return null;
  try {
    return (JSON.parse(m[1]!) as { Count: number }[]).reduce((sum, f) => sum + f.Count, 0);
  } catch {
    return null;
  }
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
  return {
    source: 'iaai',
    search: (filters, page) =>
      queue.run('iaai', async () => {
        const body = buildIaaiSearchBody(filters, page);
        for (let attempt = 1; ; attempt++) {
          const sessionPage = await browser.sessionPage(PROFILE, bootstrap);
          const res = await sessionPage.evaluate(async (payload) => {
            const r = await fetch(`/Search?c=${Date.now()}`, {
              method: 'POST',
              headers: {
                accept: '*/*',
                'content-type': 'application/json; charset=UTF-8',
                'x-requested-with': 'XMLHttpRequest',
              },
              body: JSON.stringify(payload),
            });
            return { status: r.status, text: await r.text() };
          }, body);
          try {
            if (res.status === 403) throw new SourceError('blocked', 'iaai: 403 from search');
            return parseIaaiSearch(res.text, page);
          } catch (err) {
            if (attempt >= 2 || !(err instanceof SourceError) || err.code !== 'blocked') throw err;
            await browser.resetSession(PROFILE);
          }
        }
      }),
  };
}
