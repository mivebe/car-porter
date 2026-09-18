import cors from '@fastify/cors';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { openDatabase, type Database } from './db/client.ts';
import { createAuctionRecordsRepository } from './repositories/auction-records-repository.ts';
import { createCacheRepository } from './repositories/cache-repository.ts';
import { createLotInputsRepository } from './repositories/lot-inputs-repository.ts';
import { createLotsRepository } from './repositories/lots-repository.ts';
import { createMarketListingsRepository } from './repositories/market-listings-repository.ts';
import { createRecentSearchesRepository } from './repositories/recent-searches-repository.ts';
import { createSelectionsRepository } from './repositories/selections-repository.ts';
import { createSettingsRepository } from './repositories/settings-repository.ts';
import { createTrackedLotsRepository } from './repositories/tracked-lots-repository.ts';
import { createVehicleAliasesRepository } from './repositories/vehicle-aliases-repository.ts';
import { aliasRoutes } from './routes/alias-routes.ts';
import { catalogRoutes } from './routes/catalog-routes.ts';
import { copartRoutes } from './routes/copart-routes.ts';
import { estimateRoutes } from './routes/estimate-routes.ts';
import { historyRoutes } from './routes/history-routes.ts';
import { insightsRoutes } from './routes/insights-routes.ts';
import { fxRoutes } from './routes/fx-routes.ts';
import { lotsRoutes } from './routes/lots-routes.ts';
import { marketRoutes } from './routes/market-routes.ts';
import { recentSearchesRoutes } from './routes/recent-searches-routes.ts';
import { settingsRoutes } from './routes/settings-routes.ts';
import { trackingRoutes } from './routes/tracking-routes.ts';
import { createBrowserManager } from './scraping/browser.ts';
import { createSourceQueue } from './scraping/source-queue.ts';
import { createAliasScanService } from './services/alias-scan-service.ts';
import { createEstimateService } from './services/estimate-service.ts';
import { createHistoryService } from './services/history-service.ts';
import { createLotInsightsService } from './services/lot-insights-service.ts';
import { createLotSearchService } from './services/lot-search-service.ts';
import { createMarketService } from './services/market-service.ts';
import { createTrackingService } from './services/tracking-service.ts';
import { createVehicleAliasService } from './services/vehicle-alias-service.ts';
import type { AuctionSearchAdapter } from './sources/auction-adapter.ts';
import { createAutoscout24Adapter, createAutoscout24Fetcher } from './sources/autoscout24.ts';
import { createBidfaxFetcher, createBidfaxSearcher, type BidfaxSearcher, type HtmlFetcher } from './sources/bidfax-client.ts';
import { createCarsBgAdapter, createCarsBgFetcher } from './sources/carsbg.ts';
import { createCopartAdapter, createCopartLogin, type CopartLogin } from './sources/copart.ts';
import { createFxService, httpTextFetcher, type TextFetcher } from './sources/ecb.ts';
import { createIaaiAdapter } from './sources/iaai.ts';
import type { MarketAdapter } from './sources/market-adapter.ts';
import {
  createMockAuctionAdapters,
  createMockCopartLogin,
  mockBidfaxFetcher,
  mockBidfaxSearcher,
  createMockMarketFetchers,
  mockEcbFetcher,
  mockNhtsaFetcher,
  mockStatVinFetcher,
} from './sources/mock-fetchers.ts';
import { createMobileBgAdapter, createMobileBgFetcher } from './sources/mobilebg.ts';
import { createCatalogService, httpJsonFetcher, type JsonFetcher } from './sources/nhtsa.ts';
import { createOlxAdapter, createOlxFetcher } from './sources/olxbg.ts';
import { createStatVinFetcher } from './sources/statvin.ts';

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
    bidfaxSearcher?: BidfaxSearcher;
    statVinFetcher?: HtmlFetcher;
    marketAdapters?: MarketAdapter[];
    auctionAdapters?: AuctionSearchAdapter[];
    copartLogin?: CopartLogin;
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
    marketListings: createMarketListingsRepository(database.db),
    tracked: createTrackedLotsRepository(database.db),
    vehicleAliases: createVehicleAliasesRepository(database.db),
    recentSearches: createRecentSearchesRepository(database.db),
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
  const catalog = createCatalogService(
    repos.cache,
    overrides.nhtsaFetcher ?? (mockSources ? mockNhtsaFetcher : httpJsonFetcher),
  );
  const aliases = createVehicleAliasService({ catalog, cache: repos.cache, aliases: repos.vehicleAliases });
  await app.register(catalogRoutes, { catalog, aliases: repos.vehicleAliases, aliasService: aliases });
  const aliasScan = createAliasScanService({ adapters: auctionAdapters, aliases });
  app.addHook('preClose', async () => {
    aliasScan.cancel();
    await aliasScan.idle();
  });
  await app.register(aliasRoutes, { aliases, scan: aliasScan });
  const fx = createFxService({
    cache: repos.cache,
    settings: repos.settings,
    fetchText: overrides.ecbFetcher ?? (mockSources ? mockEcbFetcher : httpTextFetcher),
  });
  await app.register(fxRoutes, { fx });
  await app.register(copartRoutes, {
    login: overrides.copartLogin ?? (mockSources ? createMockCopartLogin() : createCopartLogin(browser, queue)),
  });
  await app.register(lotsRoutes, {
    search: createLotSearchService({
      adapters: auctionAdapters,
      aliases,
      cache: repos.cache,
      lots: repos.lots,
    }),
    lots: repos.lots,
    inputs: repos.lotInputs,
    tracked: repos.tracked,
    recent: repos.recentSearches,
  });
  await app.register(recentSearchesRoutes, { recent: repos.recentSearches });

  const estimate = createEstimateService({
    fetchHtml:
      overrides.bidfaxFetcher ?? (mockSources ? mockBidfaxFetcher : createBidfaxFetcher(browser, queue)),
    cache: repos.cache,
    lots: repos.lots,
    records: repos.auctionRecords,
    selections: repos.selections,
    settings: repos.settings,
  });
  await app.register(estimateRoutes, { estimate });

  const history = createHistoryService({
    searchBidfax:
      overrides.bidfaxSearcher ?? (mockSources ? mockBidfaxSearcher : createBidfaxSearcher(browser, queue)),
    fetchStatVin:
      overrides.statVinFetcher ?? (mockSources ? mockStatVinFetcher : createStatVinFetcher(browser, queue)),
    cache: repos.cache,
    lots: repos.lots,
    inputs: repos.lotInputs,
    records: repos.auctionRecords,
  });
  await app.register(historyRoutes, { history });

  const marketFetchers = mockSources
    ? createMockMarketFetchers()
    : {
        mobileBg: createMobileBgFetcher(browser, queue),
        carsBg: createCarsBgFetcher(browser, queue),
        autoscout24: createAutoscout24Fetcher(browser, queue),
        olxBg: createOlxFetcher(browser, queue),
      };
  const market = createMarketService({
    adapters: overrides.marketAdapters ?? [
      createMobileBgAdapter(marketFetchers.mobileBg, repos.cache),
      createCarsBgAdapter(marketFetchers.carsBg, repos.cache),
      createAutoscout24Adapter(marketFetchers.autoscout24),
      createOlxAdapter(marketFetchers.olxBg, repos.cache),
    ],
    aliases,
    cache: repos.cache,
    lots: repos.lots,
    inputs: repos.lotInputs,
    listings: repos.marketListings,
    selections: repos.selections,
    settings: repos.settings,
  });
  await app.register(marketRoutes, { market });

  const insights = createLotInsightsService({
    lots: repos.lots,
    inputs: repos.lotInputs,
    settings: repos.settings,
    estimate,
    market,
    history,
    fx,
  });
  await app.register(insightsRoutes, { insights });
  await app.register(trackingRoutes, {
    tracking: createTrackingService({ tracked: repos.tracked, lots: repos.lots, insights }),
  });

  return app;
}
