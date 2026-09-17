/**
 * Manual live check for the auction adapters and the alias table (not part of the automated suite).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/live-search.ts mercedes-benz c-class 2017 2017
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/client.ts';
import { createCacheRepository } from '../src/repositories/cache-repository.ts';
import { createVehicleAliasesRepository } from '../src/repositories/vehicle-aliases-repository.ts';
import { createBrowserManager } from '../src/scraping/browser.ts';
import { createSourceQueue } from '../src/scraping/source-queue.ts';
import { createVehicleAliasService } from '../src/services/vehicle-alias-service.ts';
import { createCopartAdapter } from '../src/sources/copart.ts';
import { createIaaiAdapter } from '../src/sources/iaai.ts';
import { createCatalogService, httpJsonFetcher } from '../src/sources/nhtsa.ts';

const [make = 'toyota', model = 'camry', from = '2018', to = '2020'] = process.argv.slice(2);
const filters = { make, model, yearFrom: Number(from), yearTo: Number(to) };
const browser = createBrowserManager({
  profilesDir: process.env.PROFILES_DIR ?? mkdtempSync(path.join(tmpdir(), 'car-porter-live-')),
});
const queue = createSourceQueue({ delay: () => ({ minMs: 1500, maxMs: 3000 }) });
const { db, close } = await openDatabase(':memory:');
const cache = createCacheRepository(db);
const aliasRepo = createVehicleAliasesRepository(db);
const aliases = createVehicleAliasService({ catalog: createCatalogService(cache, httpJsonFetcher), cache, aliases: aliasRepo });

for (const adapter of [createCopartAdapter(browser, queue), createIaaiAdapter(browser, queue)]) {
  const started = Date.now();
  try {
    const matched = await aliases.resolve(adapter, filters);
    console.log(`${adapter.source} matched: makes=${JSON.stringify(matched.makes)} models=${JSON.stringify(matched.models)}`);
    if (matched.makes.length === 0 || matched.models.length === 0) continue;
    const result = await adapter.search({ ...matched, yearFrom: filters.yearFrom, yearTo: filters.yearTo }, 1);
    const years = [...new Set(result.lots.map((l) => l.year))].sort();
    console.log(
      `${adapter.source} p1: total=${result.total} lots=${result.lots.length} years=${years} ` +
        `models=${[...new Set(result.lots.map((l) => `${l.model}/${l.trim ?? ''}`))].join('|')} (${Date.now() - started}ms)`,
    );
  } catch (err) {
    console.log(`${adapter.source} FAILED:`, err);
  }
}
const unmatched = (await aliasRepo.list({ kind: 'model' })).filter((r) => !r.canonical);
console.log(`unmatched ${make} models:`, unmatched.map((r) => `${r.source}:${r.externalName}(${r.lotCount})`).join(', '));
await browser.closeAll();
close();
