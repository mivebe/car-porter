import type { AuctionRecord } from '@car-porter/core';
import * as cheerio from 'cheerio';
import type { BrowserManager } from '../scraping/browser.ts';
import { assertNotChallenged, SourceError } from '../scraping/errors.ts';
import { createPageFetcher, type HtmlFetcher } from '../scraping/page-fetcher.ts';
import type { SourceQueue } from '../scraping/source-queue.ts';
import { emptyToNull } from './auction-adapter.ts';

export const STATVIN_ORIGIN = 'https://stat.vin';

/** VIN page; redirects to the canonical slug URL, or to a VIN decoder page when no lot is known. */
export function statVinUrl(vin: string): string {
  return `${STATVIN_ORIGIN}/cars/${encodeURIComponent(vin.trim().toUpperCase())}`;
}

/** Loads stat.vin pages behind Cloudflare's non-interactive check. Lookups work by VIN only. */
export function createStatVinFetcher(browser: BrowserManager, queue: SourceQueue): HtmlFetcher {
  return createPageFetcher({ browser, queue, source: 'statvin' });
}

interface VehicleJsonLd {
  '@type'?: string;
  manufacturer?: string;
  model?: string;
  vehicleIdentificationNumber?: string;
  modelDate?: string;
  /** A URL, or a list of photo URLs (the current lot's, first is the main photo). */
  image?: string | string[];
  url?: string;
  vehicleEngine?: { name?: string; fuelType?: string };
}

/** "$5 400.00" / "$19,116" → cents; $0 (not sold yet) → null. */
export function parseStatVinMoney(text: string): number | null {
  const m = text.replace(/[\s,]/g, '').match(/\$(\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
  return cents > 0 ? cents : null;
}

function saleStatus(text: string): AuctionRecord['saleStatus'] {
  const t = text.toLowerCase();
  if (/not\s*sold/.test(t)) return 'not_sold';
  if (/approval/.test(t)) return 'on_approval';
  if (/sold/.test(t)) return 'sold';
  if (/active|upcoming|future/.test(t)) return 'upcoming';
  return null;
}

/** "Rear End" / "78,003 mi / Actual" etc. from the lot's `car-box-option` / `car-box-value` rows. */
function lotFacts($: cheerio.CheerioAPI) {
  const facts = new Map<string, string>();
  $('.car-box-option').each((_, el) => {
    const label = $(el).text().replace(/\s+/g, ' ').trim().replace(/:$/, '').toLowerCase();
    const value = $(el).next('.car-box-value').text().replace(/\s+/g, ' ').trim();
    if (label && value && !facts.has(label)) facts.set(label, value);
  });
  return facts;
}

/**
 * Sales history of a VIN: one record per row of the "Sales History" table (auction, date, lot,
 * final bid, status). Vehicle data comes from the page's JSON-LD; damage, odometer, location and
 * photo describe the page's current lot, so they are only attached to rows of that lot number.
 * Returns [] for the "not found" / VIN decoder pages.
 */
export function parseStatVinHistory(html: string): AuctionRecord[] {
  assertNotChallenged(html, 'statvin');
  const $ = cheerio.load(html);

  const vehicle = $('script[type="application/ld+json"]')
    .map((_, el) => {
      try {
        // the Vehicle block contains raw tabs/newlines inside strings, which JSON.parse rejects
        // eslint-disable-next-line no-control-regex
        const json = $(el).text().replace(/[\u0000-\u001f]+/g, ' ');
        return [JSON.parse(json) as VehicleJsonLd | VehicleJsonLd[]].flat();
      } catch {
        return [];
      }
    })
    .get()
    .find((item: VehicleJsonLd) => item?.['@type'] === 'Vehicle') as VehicleJsonLd | undefined;

  const table = $('table')
    .filter((_, t) => /lot\s*#/i.test($(t).find('thead').text()))
    .first();
  // unknown VINs end on a decoder / "car not found" page without vehicle data
  if (!vehicle) return [];
  if (table.length === 0) throw new SourceError('parse_failed', 'statvin: sales history table not found');

  const vin = vehicle.vehicleIdentificationNumber?.toUpperCase() ?? null;
  const headers = table
    .find('thead th')
    .map((_, th) => $(th).text().trim().toLowerCase())
    .get();
  const col = (name: string) => headers.findIndex((h) => h.startsWith(name));

  const facts = lotFacts($);
  const currentLot = facts.get('lot number') ?? null;
  const odometer = facts.get('odometer, mi')?.match(/[\d,]+/)?.[0]?.replace(/,/g, '');
  const pageUrl = vehicle.url ?? (vin ? statVinUrl(vin) : STATVIN_ORIGIN);
  const year = Number(vehicle.modelDate);
  const image = [vehicle.image].flat().find((url) => typeof url === 'string');

  const records: AuctionRecord[] = [];
  table.find('tbody tr').each((_, tr) => {
    const cells = $(tr).find('td');
    const cell = (name: string) => {
      const i = col(name);
      return i < 0 ? '' : cells.eq(i).text().replace(/\s+/g, ' ').trim();
    };
    const date = cell('date').match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const lotNumber = cell('lot').match(/\d+/)?.[0] ?? null;
    const auction = emptyToNull(cell('auction'))?.toLowerCase() ?? null;
    if (!date || !lotNumber) return;

    const isCurrentLot = lotNumber === currentLot;
    records.push({
      id: `statvin:${vin ?? 'unknown'}:${auction ?? 'unknown'}:${lotNumber}:${date}`,
      site: 'statvin',
      url: pageUrl,
      auction,
      lotNumber,
      vin,
      year: Number.isInteger(year) && year > 1900 ? year : null,
      make: emptyToNull(vehicle.manufacturer),
      model: emptyToNull(vehicle.model),
      trim: null,
      engine: emptyToNull(vehicle.vehicleEngine?.name),
      fuel: emptyToNull(vehicle.vehicleEngine?.fuelType),
      saleDate: `${date}T00:00:00.000Z`,
      finalPriceUsdCents: parseStatVinMoney(cell('final bid')),
      odometerMiles: isCurrentLot && odometer ? Number(odometer) : null,
      damage: isCurrentLot ? (facts.get('damage') ?? null) : null,
      saleStatus: saleStatus(cell('status')),
      location: isCurrentLot ? (facts.get('location') ?? null) : null,
      imageUrl: isCurrentLot ? emptyToNull(image) : null,
    });
  });
  return records;
}
