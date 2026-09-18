/**
 * Manual live check for the auction adapters and the alias table (not part of the automated suite).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/live-search.ts mercedes-benz c-class 2017 2017 ["c 63"] [us,ca]
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/client.ts';
import type { IaaiMarket } from '@car-porter/core';
import { createCacheRepository } from '../src/repositories/cache-repository.ts';
import { createLotsRepository } from '../src/repositories/lots-repository.ts';
import { createVehicleAliasesRepository } from '../src/repositories/vehicle-aliases-repository.ts';
import { createBrowserManager } from '../src/scraping/browser.ts';
import { createSourceQueue } from '../src/scraping/source-queue.ts';
import { createLotSearchService } from '../src/services/lot-search-service.ts';
import { createVehicleAliasService } from '../src/services/vehicle-alias-service.ts';
import { createCopartAdapter } from '../src/sources/copart.ts';
import { createIaaiAdapter } from '../src/sources/iaai.ts';
import { createCatalogService, httpJsonFetcher } from '../src/sources/nhtsa.ts';

const [make = 'toyota', model = 'camry', from = '2018', to = '2020', trim = '', markets = ''] = process.argv.slice(2);
const filters = {
  make,
  model,
  yearFrom: Number(from),
  yearTo: Number(to),
  trim,
  iaaiMarkets: markets.split(',').filter(Boolean) as IaaiMarket[],
};
const browser = createBrowserManager({
  profilesDir: process.env.PROFILES_DIR ?? mkdtempSync(path.join(tmpdir(), 'car-porter-live-')),
});
const queue = createSourceQueue({ delay: () => ({ minMs: 1500, maxMs: 3000 }) });
const { db, close } = await openDatabase(':memory:');
const cache = createCacheRepository(db);
const aliasRepo = createVehicleAliasesRepository(db);
const aliases = createVehicleAliasService({ catalog: createCatalogService(cache, httpJsonFetcher), cache, aliases: aliasRepo });

const search = createLotSearchService({
  adapters: [createCopartAdapter(browser, queue), createIaaiAdapter(browser, queue)],
  aliases,
  cache,
  lots: createLotsRepository(db),
});
const started = Date.now();
const { lots, sources } = await search.search(filters, 1);
for (const s of sources) {
  if (!s.ok) {
    console.log(`${s.source} FAILED: ${s.error.code} ${s.error.message}`);
    continue;
  }
  const own = lots.filter((l) => l.source === s.source);
  console.log(`${s.source} matched: makes=${JSON.stringify(s.matched.makes)} models=${JSON.stringify(s.matched.models)}`);
  console.log(
    `${s.source} p1: total=${s.total} lots=${own.length} years=${[...new Set(own.map((l) => l.year))].sort()} ` +
      `models=${[...new Set(own.map((l) => `${l.model}/${l.trim ?? ''}`))].join('|')}`,
  );
}
console.log(`(${Date.now() - started}ms)`);
const unmatched = (await aliasRepo.list({ kind: 'model' })).filter((r) => !r.canonical);
console.log(`unmatched ${make} models:`, unmatched.map((r) => `${r.source}:${r.externalName}(${r.lotCount})`).join(', '));
await browser.closeAll();
close();
