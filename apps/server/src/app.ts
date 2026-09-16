import cors from '@fastify/cors';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { openDatabase, type Database } from './db/client.ts';
import { createAuctionRecordsRepository } from './repositories/auction-records-repository.ts';
import { createCacheRepository } from './repositories/cache-repository.ts';
import { createLotInputsRepository } from './repositories/lot-inputs-repository.ts';
import { createLotsRepository } from './repositories/lots-repository.ts';
import { createSelectionsRepository } from './repositories/selections-repository.ts';
import { createSettingsRepository } from './repositories/settings-repository.ts';
import { catalogRoutes } from './routes/catalog-routes.ts';
import { estimateRoutes } from './routes/estimate-routes.ts';
import { fxRoutes } from './routes/fx-routes.ts';
import { lotsRoutes } from './routes/lots-routes.ts';
import { settingsRoutes } from './routes/settings-routes.ts';
import { createBrowserManager } from './scraping/browser.ts';
import { createSourceQueue } from './scraping/source-queue.ts';
import { createEstimateService } from './services/estimate-service.ts';
import { createLotSearchService } from './services/lot-search-service.ts';
import type { AuctionSearchAdapter } from './sources/auction-adapter.ts';
import { createBidfaxFetcher, type HtmlFetcher } from './sources/bidfax-client.ts';
import { createCopartAdapter } from './sources/copart.ts';
import { createFxService, httpTextFetcher, type TextFetcher } from './sources/ecb.ts';
import { createIaaiAdapter } from './sources/iaai.ts';
import {
  createMockAuctionAdapters,
  mockBidfaxFetcher,
  mockEcbFetcher,
  mockNhtsaFetcher,
} from './sources/mock-fetchers.ts';
import { createCatalogService, httpJsonFetcher, type JsonFetcher } from './sources/nhtsa.ts';

export interface AppOptions {
  fastify?: FastifyServerOptions;
  /** SQLite file path; ':memory:' for tests. */
  dbFile?: string;
  /** Persistent browser profiles (cookies/logins) for live scraping. */
  profilesDir?: string;
  /** Serve fixture-backed mock sources instead of scraping real sites (E2E). */
  mockSources?: boolean;
  /** Test seams for individual sources. */
  overrides?: {
    nhtsaFetcher?: JsonFetcher;
    ecbFetcher?: TextFetcher;
    bidfaxFetcher?: HtmlFetcher;
    auctionAdapters?: AuctionSearchAdapter[];
  };
}

export async function buildApp({
  fastify = {},
  dbFile = ':memory:',
  profilesDir = 'data/browser-profiles',
  mockSources = false,
  overrides = {},
}: AppOptions = {}) {
  const app = Fastify(fastify);
  const database: Database = await openDatabase(dbFile);

  const repos = {
    settings: createSettingsRepository(database.db),
    cache: createCacheRepository(database.db),
    lots: createLotsRepository(database.db),
    lotInputs: createLotInputsRepository(database.db),
    auctionRecords: createAuctionRecordsRepository(database.db),
    selections: createSelectionsRepository(database.db),
  };
  await repos.settings.get();

  const browser = createBrowserManager({ profilesDir });
  const queue = createSourceQueue({
    delay: () => {
      const { minDelayMs, maxDelayMs } = repos.settings.cached().scraping;
      return { minMs: minDelayMs, maxMs: maxDelayMs };
    },
  });
  app.addHook('onClose', async () => {
    await browser.closeAll();
    database.close();
  });

  const auctionAdapters =
    overrides.auctionAdapters ??
    (mockSources
      ? createMockAuctionAdapters()
      : [createCopartAdapter(browser, queue), createIaaiAdapter(browser, queue)]);

  await app.register(cors, {
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  app.get('/api/health', async () => ({ status: 'ok', sources: mockSources ? 'mock' : 'live' }));
  await app.register(settingsRoutes, { settings: repos.settings });
  await app.register(catalogRoutes, {
    catalog: createCatalogService(
      repos.cache,
      overrides.nhtsaFetcher ?? (mockSources ? mockNhtsaFetcher : httpJsonFetcher),
    ),
  });
  await app.register(fxRoutes, {
    fx: createFxService({
      cache: repos.cache,
      settings: repos.settings,
      fetchText: overrides.ecbFetcher ?? (mockSources ? mockEcbFetcher : httpTextFetcher),
    }),
  });
  await app.register(lotsRoutes, {
    search: createLotSearchService({ adapters: auctionAdapters, cache: repos.cache, lots: repos.lots }),
    lots: repos.lots,
    inputs: repos.lotInputs,
  });

  await app.register(estimateRoutes, {
    estimate: createEstimateService({
      fetchHtml:
        overrides.bidfaxFetcher ?? (mockSources ? mockBidfaxFetcher : createBidfaxFetcher(browser, queue)),
      cache: repos.cache,
      lots: repos.lots,
      records: repos.auctionRecords,
      selections: repos.selections,
      settings: repos.settings,
    }),
  });

  return app;
}
