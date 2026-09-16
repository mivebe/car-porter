import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '@car-porter/core';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../src/db/client.ts';
import { createCacheRepository } from '../src/repositories/cache-repository.ts';
import {
  createSettingsRepository,
  InvalidSettingsError,
} from '../src/repositories/settings-repository.ts';

const open: Database[] = [];
async function memoryDb() {
  const d = await openDatabase(':memory:');
  open.push(d);
  return d;
}

afterEach(() => {
  while (open.length) open.pop()!.close();
});

describe('database', () => {
  it('applies migrations and creates all tables', async () => {
    const { sqlite } = await memoryDb();
    const tables = (
      sqlite.prepare("select name from sqlite_master where type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'settings',
        'lots',
        'lot_inputs',
        'tracked_lots',
        'auction_records',
        'market_listings',
        'market_price_snapshots',
        'selections',
        'scrape_cache',
      ]),
    );
  });

  it('persists to a file and re-opens without re-running migrations', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'car-porter-db-'));
    const file = path.join(dir, 'nested', 'test.sqlite');
    try {
      const first = await openDatabase(file);
      await createSettingsRepository(first.db).update({ verdict: { worthThresholdEur: 4200 } });
      first.close();

      const second = await openDatabase(file);
      expect((await createSettingsRepository(second.db).get()).verdict.worthThresholdEur).toBe(4200);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('settings repository', () => {
  it('returns defaults when nothing is stored', async () => {
    const { db } = await memoryDb();
    expect(await createSettingsRepository(db).get()).toEqual(DEFAULT_SETTINGS);
  });

  it('updates nested values and keeps the rest', async () => {
    const { db } = await memoryDb();
    const repo = createSettingsRepository(db);
    await repo.update({ cost: { rotterdamSofiaEur: 1200 } });
    await repo.update({ fx: { usdToEurOverride: 0.9 } });
    const s = await repo.get();
    expect(s.cost.rotterdamSofiaEur).toBe(1200);
    expect(s.cost.shippingUsaRotterdamUsd).toBe(2500);
    expect(s.fx.usdToEurOverride).toBe(0.9);
  });

  it('rejects invalid updates and leaves stored data unchanged', async () => {
    const { db } = await memoryDb();
    const repo = createSettingsRepository(db);
    await expect(repo.update({ verdict: { worthThresholdEur: -5 } })).rejects.toBeInstanceOf(
      InvalidSettingsError,
    );
    expect(await repo.get()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('cache repository', () => {
  it('stores payloads and reports freshness by TTL', async () => {
    const { db } = await memoryDb();
    let clock = new Date('2026-09-16T10:00:00Z');
    const cache = createCacheRepository(db, () => clock);

    await cache.set('k', 'bidfax', { a: 1 }, 60_000);
    let entry = await cache.get<{ a: number }>('k');
    expect(entry?.payload).toEqual({ a: 1 });
    expect(entry?.fresh).toBe(true);
    expect(entry?.fetchedAt.toISOString()).toBe('2026-09-16T10:00:00.000Z');

    clock = new Date('2026-09-16T10:01:01Z');
    entry = await cache.get('k');
    expect(entry?.fresh).toBe(false);
  });

  it('treats null TTL as never expiring and overwrites on set', async () => {
    const { db } = await memoryDb();
    let clock = new Date('2026-01-01T00:00:00Z');
    const cache = createCacheRepository(db, () => clock);
    await cache.set('k', 's', 1, null);
    await cache.set('k', 's', 2, null);
    clock = new Date('2030-01-01T00:00:00Z');
    expect(await cache.get('k')).toMatchObject({ payload: 2, fresh: true, expiresAt: null });
  });

  it('returns null for missing keys and removes entries', async () => {
    const { db } = await memoryDb();
    const cache = createCacheRepository(db);
    expect(await cache.get('missing')).toBeNull();
    await cache.set('k', 's', 'x', 1000);
    await cache.remove('k');
    expect(await cache.get('k')).toBeNull();
  });
});
