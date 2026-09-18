import type { AuctionRecord } from '@car-porter/core';
import * as cheerio from 'cheerio';
import { assertNotChallenged, SourceError } from '../scraping/errors.ts';
import { BIDFAX_ORIGIN, isForbiddenPage } from './bidfax-client.ts';

export interface BidfaxModelLink {
  slug: string;
  name: string;
}

export interface BidfaxListingPage {
  records: AuctionRecord[];
  /** Page numbers linked from the pagination (never guess pages: deep pages trip a 429 trap). */
  linkedPages: number[];
}

/** Photos stay on the main domain, also on en.bidfax.info pages. */
const IMAGE_ORIGIN = 'https://bidfax.info';

/** "Mercedes-Benz" → "mercedes-benz", "Land Rover" → "land-rover". */
export function bidfaxSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function bidfaxListingUrl(makeSlug: string, modelSlug: string, year: number, page = 1): string {
  const base = `${BIDFAX_ORIGIN}/${makeSlug}/${modelSlug}/f/from-year=${year}/to-year=${year}/`;
  return page > 1 ? `${base}page/${page}/` : base;
}

/** bidfax's own anti-scraping page ("429 Очень много запросов"). */
export function isRateLimitPage(html: string): boolean {
  return html.length < 20_000 && /<title>\s*429\b/i.test(html);
}

function assertUsable(html: string) {
  assertNotChallenged(html, 'bidfax');
  if (isRateLimitPage(html)) throw new SourceError('blocked', 'bidfax: 429 rate-limit page');
  if (isForbiddenPage(html)) throw new SourceError('blocked', 'bidfax: 403 Forbidden');
}

/** Model links on a make page, e.g. `<a href="/toyota/camry/">Camry</a>`. */
export function parseBidfaxModels(html: string, makeSlug: string): BidfaxModelLink[] {
  assertUsable(html);
  const $ = cheerio.load(html);
  const seen = new Map<string, BidfaxModelLink>();
  const pattern = new RegExp(`^(?:${BIDFAX_ORIGIN})?/${makeSlug}/([a-z0-9-]+)/$`);
  $('a[href]').each((_, a) => {
    const slug = $(a).attr('href')!.match(pattern)?.[1];
    const name = $(a).text().trim();
    if (slug && name && !seen.has(slug)) seen.set(slug, { slug, name });
  });
  if (seen.size === 0) throw new SourceError('not_found', `bidfax: no models found for "${makeSlug}"`);
  return [...seen.values()];
}

/** English labels, plus the Russian/Ukrainian ones of bidfax.info. */
const LABELS = {
  lot: /(Lot\s+number|Номер\s+лот[уа])\s*:/i,
  condition: /(Condition|Стан|Состояние)\s*:/i,
  damage: /(Damage|Пошкодження|Повреждение)\s*:/i,
  mileage: /(Mileage|Пробіг|Пробег)\s*:/i,
  saleDate: /(Date\s+of\s+sale|Дата\s+продаж[уи])\s*:/i,
};

/**
 * Card title: "Toyota Camry Se 2019 White 2.5L vin: 4T1B11HK0KU821110".
 * `prefix` is the "Make Model" part to strip to get the trim.
 */
export function parseBidfaxTitle(title: string, prefix: string | string[]) {
  // engine is "2.5L", "2.5L 4" (liters + cylinders) or whole liters ("4L")
  const m = title.match(
    /^(.*?)\s+((?:19|20)\d{2})\s+(.*?)\s*(?:(\d{1,2}(?:\.\d)?)\s*L(?:\s+(\d{1,2}))?)?\s*vin:\s*([A-Z0-9*]+)\s*$/i,
  );
  if (!m) return null;
  const [, head, year, color, liters, cylinders, vin] = m;
  const lowerHead = head!.toLowerCase();
  const matched = [prefix].flat().find((p) => lowerHead === p.toLowerCase() || lowerHead.startsWith(`${p.toLowerCase()} `));
  const trim = matched ? head!.slice(matched.length).trim() : null;
  return {
    year: Number(year),
    trim: trim || null,
    color: color || null,
    engine: liters ? `${Number(liters).toFixed(1)}L${cylinders ? ` ${cylinders}` : ''}` : null,
    vin: vin!.toUpperCase(),
  };
}

/**
 * bidfax cards have no fuel field, but hybrids/EVs/diesels say so in the title ("Camry Hybrid Le").
 * Only explicit keywords count, so a plain title stays unknown (never a false "petrol").
 */
export function fuelFromTitle(title: string): string | null {
  if (/plug[\s-]?in|phev/i.test(title)) return 'Plug-in Hybrid';
  if (/hybrid/i.test(title)) return 'Hybrid';
  if (/electric|\bEV\b/.test(title)) return 'Electric';
  if (/diesel|\bTDI\b/i.test(title)) return 'Diesel';
  return null;
}

/** "15.09.2026" → ISO date at UTC midnight. */
export function parseBidfaxDate(text: string): string | null {
  const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** "/toyota/camry/39201230-toyota-camry-se-2019-....html" → make/model slugs and the record id. */
export function parseBidfaxRecordUrl(url: string) {
  const m = url.match(/\/([a-z0-9-]+)\/([a-z0-9-]+)\/(\d+)-[^/]+\.html$/);
  return m ? { makeSlug: m[1]!, modelSlug: m[2]!, externalId: m[3]! } : null;
}

/**
 * Trim from a record URL, for cards whose title yields none:
 * ".../mercedes-benz-c-300-4matic-2017-white-..." → "C 300 4matic". A slug that only repeats the
 * model ("mercedes-benz-c-class-2017-...") has no trim.
 */
export function trimFromRecordUrl(url: string): string | null {
  const parsed = parseBidfaxRecordUrl(url);
  const name = url.match(/\/\d+-([a-z0-9-]+)\.html$/)?.[1];
  if (!parsed || !name?.startsWith(`${parsed.makeSlug}-`)) return null;
  const words = name.slice(parsed.makeSlug.length + 1).match(/^(.+?)-(?:19|20)\d{2}-/)?.[1];
  if (!words || words === parsed.modelSlug) return null;
  const trim = words.startsWith(`${parsed.modelSlug}-`) ? words.slice(parsed.modelSlug.length + 1) : words;
  return trim
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Title prefixes a slug can appear as: "land-rover" → "land rover" / "land-rover". The make alone
 * comes last, for cards whose title doesn't start with the model ("G 63 Amg" under "AMG").
 */
const slugPrefixes = (makeSlug: string, modelSlug: string) => [
  `${makeSlug} ${modelSlug}`,
  `${makeSlug.replace(/-/g, ' ')} ${modelSlug.replace(/-/g, ' ')}`,
  makeSlug,
  makeSlug.replace(/-/g, ' '),
];

/**
 * Sale cards (`.thumbnail.offer`), shared by listing and search pages. Make/model are the slugs
 * from the card link; `prefixes` are the "Make Model" title prefixes stripped to get the trim.
 */
function parseCards($: cheerio.CheerioAPI, prefixes?: string[]): AuctionRecord[] {
  const records: AuctionRecord[] = [];

  $('.thumbnail.offer').each((_, el) => {
    const card = $(el);
    const link = card.find('.caption a[href$=".html"]').first();
    const url = link.attr('href');
    const title = card.find('h2').first().text().replace(/\s+/g, ' ').trim();
    const parsedUrl = url ? parseBidfaxRecordUrl(url) : null;
    if (!url || !title || !parsedUrl) return; // ad placeholders

    const parsedTitle = parseBidfaxTitle(title, [...(prefixes ?? []), ...slugPrefixes(parsedUrl.makeSlug, parsedUrl.modelSlug)]);
    const fields = new Map<keyof typeof LABELS, string>();
    card.find('p').each((_, p) => {
      const text = $(p).text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      for (const [key, re] of Object.entries(LABELS) as [keyof typeof LABELS, RegExp][]) {
        if (re.test(text)) fields.set(key, text.replace(re, '').trim());
      }
    });

    const priceText = card.find('.prices').first().text().replace(/[^\d]/g, '');
    const statusIcon = card.find('img[src*="dleimages"]').attr('src') ?? '';
    const mileage = fields.get('mileage')?.match(/(\d[\d\s]*)/)?.[1]?.replace(/\s/g, '');
    const image = card.find('img.xfieldimage').attr('src');

    records.push({
      id: `bidfax:${parsedUrl.externalId}`,
      site: 'bidfax',
      url,
      auction: card.find('span.copart').length ? 'copart' : card.find('span.iaai').length ? 'iaai' : null,
      lotNumber: fields.get('lot')?.match(/\d+/)?.[0] ?? null,
      vin: parsedTitle?.vin ?? null,
      year: parsedTitle?.year ?? null,
      make: parsedUrl.makeSlug,
      model: parsedUrl.modelSlug,
      trim: parsedTitle?.trim ?? trimFromRecordUrl(url),
      engine: parsedTitle?.engine ?? null,
      fuel: fuelFromTitle(title.replace(/vin:.*$/i, '')),
      saleDate: fields.get('saleDate') ? parseBidfaxDate(fields.get('saleDate')!) : null,
      finalPriceUsdCents: priceText ? Number(priceText) * 100 : null,
      odometerMiles: mileage ? Number(mileage) : null,
      damage: fields.get('damage') || null,
      saleStatus: /not_?sold/i.test(statusIcon)
        ? 'not_sold'
        : /sold/i.test(statusIcon)
          ? 'sold'
          : /onapproval/i.test(statusIcon)
            ? 'on_approval'
            : null,
      location: card.find('.short-storyup .blackfont').first().text().trim() || null,
      imageUrl: image ? new URL(image, IMAGE_ORIGIN).toString() : null,
    });
  });

  return records;
}

export function parseBidfaxListing(
  html: string,
  context: { makeSlug: string; modelSlug: string; makeName: string; modelName: string },
): BidfaxListingPage {
  assertUsable(html);
  const $ = cheerio.load(html);
  const records = parseCards($, [`${context.makeName} ${context.modelName}`]);

  const linkedPages = [
    ...new Set(
      $('a[href*="/page/"]')
        .map((_, a) => Number($(a).attr('href')!.match(/\/page\/(\d+)\/?$/)?.[1]))
        .get()
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ].sort((a, b) => a - b);

  if (records.length === 0 && $('#dle-content').length === 0) {
    throw new SourceError('parse_failed', 'bidfax: listing markup not recognized');
  }
  return { records, linkedPages };
}

/**
 * Site search results for a VIN or lot number. A lot number can match vehicles from both auctions
 * (numbers are reused), so callers filter the records.
 */
export function parseBidfaxSearch(html: string): AuctionRecord[] {
  assertUsable(html);
  const $ = cheerio.load(html);
  const records = parseCards($);
  if (records.length === 0 && $('#dle-content').length === 0) {
    throw new SourceError('parse_failed', 'bidfax: search markup not recognized');
  }
  return records;
}
