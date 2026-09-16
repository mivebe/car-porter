/**
 * Manual live check for the auction adapters (not part of the automated suite).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/live-search.ts toyota camry 2018 2020
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBrowserManager } from '../src/scraping/browser.ts';
import { createSourceQueue } from '../src/scraping/source-queue.ts';
import { createCopartAdapter } from '../src/sources/copart.ts';
import { createIaaiAdapter } from '../src/sources/iaai.ts';

const [make = 'toyota', model = 'camry', from = '2018', to = '2020'] = process.argv.slice(2);
const filters = { make, model, yearFrom: Number(from), yearTo: Number(to) };
const browser = createBrowserManager({
  profilesDir: process.env.PROFILES_DIR ?? mkdtempSync(path.join(tmpdir(), 'car-porter-live-')),
});
const queue = createSourceQueue({ delay: () => ({ minMs: 1500, maxMs: 3000 }) });

for (const adapter of [createCopartAdapter(browser, queue), createIaaiAdapter(browser, queue)]) {
  const started = Date.now();
  try {
    for (const page of [1, 2]) {
      const result = await adapter.search(filters, page);
      const years = [...new Set(result.lots.map((l) => l.year))].sort();
      console.log(
        `${adapter.source} p${page}: total=${result.total} lots=${result.lots.length} years=${years} ` +
          `models=${[...new Set(result.lots.map((l) => l.model))].join('|')} (${Date.now() - started}ms)`,
      );
      console.log('  sample:', JSON.stringify(result.lots[0]));
    }
  } catch (err) {
    console.log(`${adapter.source} FAILED:`, err);
  }
}
await browser.closeAll();
