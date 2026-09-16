/**
 * Records real vehicle-history pages (bidfax VIN/lot search, stat.vin) as test fixtures
 * (manual; hits the live sites).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/record-history.ts
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBrowserManager } from '../src/scraping/browser.ts';
import { createSourceQueue } from '../src/scraping/source-queue.ts';
import { createBidfaxSearcher } from '../src/sources/bidfax-client.ts';
import { createStatVinFetcher, statVinUrl } from '../src/sources/statvin.ts';

/** Drop scripts (except JSON-LD), styles, svg and Livewire state blobs so fixtures stay small. */
const shrink = (html: string) =>
  html
    .replace(/<script\b(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<ins\b[\s\S]*?<\/ins>/gi, '')
    .replace(/\swire:snapshot="[^"]*"/g, '')
    .replace(/>\s+</g, '> <')
    .replace(/[ \t]{2,}/g, ' ');

const root = new URL('../test/fixtures/', import.meta.url);
const browser = createBrowserManager({ profilesDir: mkdtempSync(path.join(tmpdir(), 'car-porter-history-')) });
const queue = createSourceQueue({ delay: () => ({ minMs: 1500, maxMs: 3000 }) });
const searchBidfax = createBidfaxSearcher(browser, queue);
const fetchStatVin = createStatVinFetcher(browser, queue);

const pages: [string, () => Promise<string>][] = [
  ['bidfax/search-vin-4t1b11hk0ku821110.html', () => searchBidfax('4T1B11HK0KU821110')],
  ['bidfax/search-lot-46026832.html', () => searchBidfax('46026832')],
  ['bidfax/search-none.html', () => searchBidfax('1HGCM82633A004352')],
  ['statvin/vin-4t1b11hk0ku821110.html', () => fetchStatVin(statVinUrl('4T1B11HK0KU821110'))],
  ['statvin/vin-not-found.html', () => fetchStatVin(statVinUrl('1HGCM82633A004352'))],
];
try {
  for (const [file, load] of pages) {
    const html = shrink(await load());
    const target = new URL(file, root);
    mkdirSync(new URL('.', target), { recursive: true });
    writeFileSync(target, html);
    console.log(file, html.length);
  }
} finally {
  await browser.closeAll();
}
