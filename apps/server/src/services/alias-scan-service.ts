import type { AuctionSource, SourceErrorInfo } from '@car-porter/core';
import { toSourceErrorInfo } from '../scraping/errors.ts';
import type { AuctionSearchAdapter } from '../sources/auction-adapter.ts';
import { readFacetsFully, type VehicleAliasService } from './vehicle-alias-service.ts';

export type ScanState = 'idle' | 'running' | 'done' | 'cancelled';

export interface SourceScanProgress {
  source: AuctionSource;
  phase: 'queued' | 'makes' | 'models' | 'done' | 'failed' | 'cancelled';
  /** models phase: makes finished / to do */
  done: number;
  total: number;
  /** requests sent to the site so far */
  requests: number;
  /** makes phase: the year range being read; models phase: the make */
  current: string | null;
  /** makes whose model list could not be read */
  failed: { make: string; error: SourceErrorInfo }[];
  error?: SourceErrorInfo;
}

export interface ScanStatus {
  state: ScanState;
  /** null = every make */
  make: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  sources: SourceScanProgress[];
}

/** Stop a site after this many make failures in a row (it is most likely blocking us). */
const MAX_CONSECUTIVE_FAILURES = 3;

export class ScanRunningError extends Error {}

/**
 * Background job that reads every make (all years) and the models of every assigned make from
 * each site, refreshing the alias table so new site spellings show up for assignment. Sites run
 * in parallel; requests go through each site's queue, so searches wait their turn meanwhile.
 */
export function createAliasScanService(deps: { adapters: AuctionSearchAdapter[]; aliases: VehicleAliasService }) {
  let status: ScanStatus = { state: 'idle', make: null, startedAt: null, finishedAt: null, sources: [] };
  let cancelRequested = false;
  let running: Promise<void> | null = null;

  async function scanSource(adapter: AuctionSearchAdapter, progress: SourceScanProgress, make: string | null) {
    const { source } = adapter;
    const stop = () => cancelRequested;
    const years = deps.aliases.allYears();
    const readMakes = () =>
      readFacetsFully(adapter.facetLimit, years, (y) => adapter.makeFacets(y), {
        shouldStop: stop,
        onRequest: (y) => {
          progress.requests++;
          progress.current = y.yearFrom === y.yearTo ? String(y.yearFrom) : `${y.yearFrom}–${y.yearTo}`;
        },
      });
    try {
      let makes: string[];
      if (make) {
        makes = [make];
        progress.phase = 'makes';
        if ((await deps.aliases.storedExternalMakes(source, make)).length === 0) {
          await deps.aliases.applyMakeFacets(source, await readMakes());
        }
      } else {
        progress.phase = 'makes';
        const rows = await deps.aliases.applyMakeFacets(source, await readMakes());
        makes = [...new Set(rows.map((r) => r.canonical).filter((c): c is string => !!c))].sort();
      }

      progress.phase = 'models';
      progress.current = null;
      progress.total = makes.length;
      let failuresInRow = 0;
      for (const canonical of makes) {
        if (stop()) break;
        progress.current = canonical;
        const external = await deps.aliases.storedExternalMakes(source, canonical);
        if (external.length > 0) {
          try {
            const facets = await readFacetsFully(adapter.facetLimit, years, (y) => adapter.modelFacets(external, y), {
              shouldStop: stop,
              onRequest: () => progress.requests++,
            });
            await deps.aliases.applyModelFacets(source, canonical, facets);
            failuresInRow = 0;
          } catch (err) {
            progress.failed.push({ make: canonical, error: toSourceErrorInfo(err) });
            if (++failuresInRow >= MAX_CONSECUTIVE_FAILURES) throw err;
          }
        }
        progress.done++;
      }
      progress.current = null;
      progress.phase = stop() ? 'cancelled' : 'done';
    } catch (err) {
      progress.phase = 'failed';
      progress.current = null;
      progress.error = toSourceErrorInfo(err);
    }
  }

  function start(options: { make?: string | null } = {}): ScanStatus {
    if (status.state === 'running') throw new ScanRunningError('a scan is already running');
    cancelRequested = false;
    const make = options.make?.trim() || null;
    status = {
      state: 'running',
      make,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      sources: deps.adapters.map((a) => ({ source: a.source, phase: 'queued', done: 0, total: 0, requests: 0, current: null, failed: [] })),
    };
    const current = status;
    running = (async () => {
      try {
        const canonicalMake = make ? await deps.aliases.canonicalMakeName(make) : null;
        current.make = canonicalMake;
        await Promise.all(deps.adapters.map((a, i) => scanSource(a, current.sources[i]!, canonicalMake)));
      } catch (err) {
        for (const p of current.sources) if (p.phase === 'queued') Object.assign(p, { phase: 'failed', error: toSourceErrorInfo(err) });
      }
      current.state = cancelRequested ? 'cancelled' : 'done';
      current.finishedAt = new Date().toISOString();
    })();
    return snapshot();
  }

  function cancel(): ScanStatus {
    if (status.state === 'running') cancelRequested = true;
    return snapshot();
  }

  const snapshot = (): ScanStatus => structuredClone(status);

  return {
    start,
    cancel,
    status: snapshot,
    /** Resolves when the current scan (if any) has finished; for tests and shutdown. */
    idle: () => running ?? Promise.resolve(),
  };
}

export type AliasScanService = ReturnType<typeof createAliasScanService>;
