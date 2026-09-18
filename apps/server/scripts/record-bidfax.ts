/**
 * Records real bidfax pages as test fixtures (manual; hits the live site).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/record-bidfax.ts
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBrowserManager } from '../src/scraping/browser.ts';
import { createSourceQueue } from '../src/scraping/source-queue.ts';
import { createBidfaxFetcher } from '../src/sources/bidfax-client.ts';

const outDir = new URL('../test/fixtures/bidfax/', import.meta.url);
mkdirSync(outDir, { recursive: true });

/** Drop scripts/styles/svg and collapse whitespace so fixtures stay small. */
const shrink = (html: string) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<ins\b[\s\S]*?<\/ins>/gi, '')
    .replace(/>\s+</g, '> <')
    .replace(/[ \t]{2,}/g, ' ');

const browser = createBrowserManager({ profilesDir: mkdtempSync(path.join(tmpdir(), 'car-porter-bidfax-')) });
const fetchHtml = createBidfaxFetcher(browser, createSourceQueue({ delay: () => ({ minMs: 1500, maxMs: 3000 }) }));

const pages: [string, string][] = [
  ['home.html', 'https://en.bidfax.info/'],
  ['make-toyota.html', 'https://en.bidfax.info/toyota/'],
  ['toyota-camry-2019-p1.html', 'https://en.bidfax.info/toyota/camry/f/from-year=2019/to-year=2019/'],
  ['toyota-camry-2019-p2.html', 'https://en.bidfax.info/toyota/camry/f/from-year=2019/to-year=2019/page/2/'],
  ['toyota-camry-2019-p999.html', 'https://en.bidfax.info/toyota/camry/f/from-year=2019/to-year=2019/page/999/'],
];
try {
  for (const [file, url] of pages) {
    const html = shrink(await fetchHtml(url));
    writeFileSync(new URL(file, outDir), html);
    console.log(file, html.length);
  }
} finally {
  await browser.closeAll();
}
