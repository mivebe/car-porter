/**
 * Records real marketplace pages as test fixtures (manual; hits the live sites).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/record-market.ts [file filter, e.g. olxbg/cars]
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { createBrowserManager } from '../src/scraping/browser.ts';
import { createSourceQueue } from '../src/scraping/source-queue.ts';
import { autoscout24SearchUrl, createAutoscout24Fetcher } from '../src/sources/autoscout24.ts';
import { carsBgBrandUrl, carsBgHomeUrl, carsBgSearchUrl, createCarsBgFetcher } from '../src/sources/carsbg.ts';
import { createMobileBgFetcher, mobileBgMakesUrl, mobileBgMakeUrl, mobileBgSearchUrl } from '../src/sources/mobilebg.ts';
import {
  createMobileDeFetcher,
  embeddedJson,
  mobileDeMakesUrl,
  mobileDeMakeUrl,
  mobileDeSearchUrl,
  rscPayload,
} from '../src/sources/mobilede.ts';
import { createOlxFetcher, olxCarsUrl, olxMakeUrl, olxOffersUrl } from '../src/sources/olxbg.ts';

/** Drop scripts, styles, svg and ads so fixtures stay small (keeps JSON data scripts). */
const shrink = (html: string) =>
  html
    .replace(/<script\b(?![^>]*(?:application\/(?:ld\+)?json|__NEXT_DATA__))[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<ins\b[\s\S]*?<\/ins>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/>\s+</g, '> <')
    .replace(/[ \t]{2,}/g, ' ')
    // mobile.bg echoes the visitor's public IP in its forms; replace it with a documentation address
    .replace(/value="\d{1,3}(?:\.\d{1,3}){3}"/g, 'value="203.0.113.10"');

/** AutoScout24: only the `__NEXT_DATA__` script is parsed. */
const nextDataOnly = (html: string) => {
  const script = html.match(/<script id="__NEXT_DATA__"[\s\S]*?<\/script>/)?.[0] ?? '';
  return `<!DOCTYPE html><html><head><title>AutoScout24</title></head><body>${script}</body></html>`;
};

/** OLX cars page: keep only the make subcategories from the page state. */
const olxMakesOnly = (html: string) => {
  const raw = html.match(/window\.__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*")/)![1]!;
  const state = JSON.parse(JSON.parse(raw) as string);
  const list = Object.fromEntries(
    Object.entries(state.categories.list as Record<string, { parentId: number }>).filter(([, c]) => c.parentId === 1117),
  );
  const reduced = { categories: { list } };
  return `<!DOCTYPE html><html><head><title>OLX.bg</title></head><body><script>window.__PRERENDERED_STATE__= ${JSON.stringify(JSON.stringify(reduced))};</script></body></html>`;
};

/** OLX make page: keep the category id and that make's model filter from the page state. */
const olxStateOnly = (html: string) => {
  const raw = html.match(/window\.__PRERENDERED_STATE__\s*=\s*("(?:[^"\\]|\\.)*")/)![1]!;
  const state = JSON.parse(JSON.parse(raw) as string);
  const categoryId = state.listing.listing.categoryId as number;
  const models = (state.listing.filters.data.filter_enum_model as { options?: { categories?: number[] }[] }[]).filter((d) =>
    d.options?.some((o) => o.categories?.includes(categoryId)),
  );
  const reduced = { listing: { listing: { categoryId }, filters: { data: { filter_enum_model: models } } } };
  return `<!DOCTYPE html><html><head><title>OLX.bg</title></head><body><script>window.__PRERENDERED_STATE__= ${JSON.stringify(JSON.stringify(reduced))};</script></body></html>`;
};

/**
 * mobile.de pages are ~1.3 MB of React payload: keep the make list, model lists and search
 * results (without dealer contacts) and each result card's link, photo and title.
 */
const mobileDeDataOnly = (html: string) => {
  const payload = rscPayload(html);
  const parts: string[] = [];
  for (const marker of ['"makes":[{"i"', '"modelsCache":', '"searchResults":{"numResultsTotal"']) {
    const value = embeddedJson<unknown>(payload, marker);
    if (value == null) continue;
    const data =
      marker.startsWith('"searchResults"') && typeof value === 'object'
        ? {
            ...value,
            listings: (value as { listings: Record<string, unknown>[] }).listings.map(({ contact: _c, sellerId: _s, ...l }) => l),
          }
        : value;
    parts.push(`{${marker.slice(0, marker.indexOf(':') + 1)}${JSON.stringify(data)}}\n`);
  }
  const $ = cheerio.load(html);
  const out = cheerio.load('<!DOCTYPE html><html><head><title>mobile.de</title></head><body></body></html>');
  $('a[href*="details.html"]').each((_, a) => {
    const card = out('<a><img><h2></h2></a>').attr('href', $(a).attr('href')!);
    card.find('img').attr('src', $(a).find('img').first().attr('src') ?? '');
    $(a)
      .find('h2 span[title]')
      .each((_, s) => {
        card.find('h2').append(out('<span>').attr('title', $(s).attr('title')!).text($(s).text()));
      });
    out('body').append(card, '\n');
  });
  for (const p of parts) out('body').append(`<script>self.__next_f.push([1,${JSON.stringify(p)}])</script>\n`);
  return out.html();
};

const root = new URL('../test/fixtures/', import.meta.url);
const browser = createBrowserManager({ profilesDir: mkdtempSync(path.join(tmpdir(), 'car-porter-market-')) });
const queue = createSourceQueue({ delay: () => ({ minMs: 1500, maxMs: 3000 }) });
const mobile = createMobileBgFetcher(browser, queue);
const cars = createCarsBgFetcher(browser, queue);
const as24 = createAutoscout24Fetcher(browser, queue);
const olx = createOlxFetcher(browser, queue);
const mde = createMobileDeFetcher(browser, queue);

const pages: [string, () => Promise<string>][] = [
  ['mobilebg/makes.html', async () => shrink(await mobile(mobileBgMakesUrl()))],
  ['mobilebg/make-toyota.html', async () => shrink(await mobile(mobileBgMakeUrl('toyota')))],
  ['mobilebg/toyota-camry-2019.html', async () => shrink(await mobile(mobileBgSearchUrl('toyota', 'camry', 2019)))],
  ['mobilebg/toyota-rav4-2019-p1.html', async () => shrink(await mobile(mobileBgSearchUrl('toyota', 'rav4', 2019)))],
  ['carsbg/home.html', async () => shrink(await cars(carsBgHomeUrl()))],
  ['carsbg/brand-toyota.html', async () => shrink(await cars(carsBgBrandUrl('80')))],
  ['carsbg/toyota-camry-2019.html', async () => shrink(await cars(carsBgSearchUrl('80', '1374', 2019)))],
  ['carsbg/toyota-rav4-2019-p1.html', async () => shrink(await cars(carsBgSearchUrl('80', '1393', 2019)))],
  ['autoscout24/toyota-camry-2019-p1.html', async () => nextDataOnly(await as24(autoscout24SearchUrl('toyota', 'camry', 2019)))],
  ['autoscout24/toyota-camry-2019-p2.html', async () => nextDataOnly(await as24(autoscout24SearchUrl('toyota', 'camry', 2019, 2)))],
  ['olxbg/cars.html', async () => olxMakesOnly(await olx(olxCarsUrl()))],
  ['olxbg/make-toyota.html', async () => olxStateOnly(await olx(olxMakeUrl('toyota')))],
  ['olxbg/offers-1181-camry-2019.json', () => olx(olxOffersUrl(1181, 'camry', 2019))],
  ['olxbg/offers-1181-rav-4-2020.json', () => olx(olxOffersUrl(1181, 'rav-4', 2020))],
  ['mobilede/makes.html', async () => mobileDeDataOnly(await mde(mobileDeMakesUrl()))],
  ['mobilede/make-toyota.html', async () => mobileDeDataOnly(await mde(mobileDeMakeUrl('24100')))],
  ['mobilede/make-mercedes-benz.html', async () => mobileDeDataOnly(await mde(mobileDeMakeUrl('17200')))],
  ['mobilede/toyota-camry-2019.html', async () => mobileDeDataOnly(await mde(mobileDeSearchUrl('24100', '6', 2019)))],
  ['mobilede/toyota-rav4-2016-2022-p1.html', async () => mobileDeDataOnly(await mde(mobileDeSearchUrl('24100', '28', { from: 2016, to: 2022 })))],
  ['mobilede/toyota-rav4-2016-2022-p2.html', async () => mobileDeDataOnly(await mde(mobileDeSearchUrl('24100', '28', { from: 2016, to: 2022 }, 2)))],
];
const only = process.argv[2];
try {
  for (const [file, load] of pages.filter(([file]) => !only || file.includes(only))) {
    const content = await load();
    const target = new URL(file, root);
    mkdirSync(new URL('.', target), { recursive: true });
    writeFileSync(target, content);
    console.log(file, content.length);
  }
} finally {
  await browser.closeAll();
}
