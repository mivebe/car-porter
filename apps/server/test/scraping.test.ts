import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '../src/db/client.ts';
import { createCacheRepository } from '../src/repositories/cache-repository.ts';
import { createBrowserManager } from '../src/scraping/browser.ts';
import { cached } from '../src/scraping/cached.ts';
import { detectChallenge, SourceError, toSourceErrorInfo } from '../src/scraping/errors.ts';
import { createSourceQueue } from '../src/scraping/source-queue.ts';

describe('source queue', () => {
  function fakeClock() {
    let t = 0;
    const sleeps: number[] = [];
    return {
      now: () => t,
      advance: (ms: number) => (t += ms),
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
      sleeps,
    };
  }

  it('runs tasks of the same source serially with a randomized delay between them', async () => {
    const clock = fakeClock();
    const queue = createSourceQueue({
      delay: () => ({ minMs: 1000, maxMs: 3000 }),
      now: clock.now,
      sleep: clock.sleep,
      random: () => 0.5,
    });
    const order: string[] = [];
    const task = (name: string, ms: number) => async () => {
      order.push(`start ${name}`);
      clock.advance(ms);
      order.push(`end ${name}`);
      return name;
    };

    const results = await Promise.all([
      queue.run('bidfax', task('a', 100)),
      queue.run('bidfax', task('b', 100)),
      queue.run('bidfax', task('c', 100)),
    ]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    // no delay before the first task, 2000ms (min + 0.5 * range) before each following one
    expect(clock.sleeps).toEqual([2000, 2000]);
  });

  it('skips the delay when enough time has already passed', async () => {
    const clock = fakeClock();
    const queue = createSourceQueue({
      delay: () => ({ minMs: 1000, maxMs: 1000 }),
      now: clock.now,
      sleep: clock.sleep,
    });
    await queue.run('s', async () => undefined);
    clock.advance(400);
    await queue.run('s', async () => undefined);
    clock.advance(5000);
    await queue.run('s', async () => undefined);
    expect(clock.sleeps).toEqual([600]);
  });

  it('continues after a failing task and propagates its error', async () => {
    const clock = fakeClock();
    const queue = createSourceQueue({ delay: () => ({ minMs: 0, maxMs: 0 }), ...clock });
    const failing = queue.run('s', async () => {
      throw new Error('boom');
    });
    const ok = queue.run('s', async () => 'ok');
    await expect(failing).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('ok');
  });

  it('does not serialize different sources', async () => {
    const queue = createSourceQueue({ delay: () => ({ minMs: 0, maxMs: 0 }) });
    let releaseA!: () => void;
    const a = queue.run('a', () => new Promise<string>((r) => (releaseA = () => r('a'))));
    const b = await queue.run('b', async () => 'b');
    expect(b).toBe('b');
    releaseA();
    await expect(a).resolves.toBe('a');
  });
});

describe('errors', () => {
  it('detects bot-protection challenge pages', () => {
    expect(detectChallenge('<html><title>Just a moment...</title></html>')).toBe('cloudflare');
    expect(detectChallenge('<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>')).toBe(
      'cloudflare',
    );
    expect(detectChallenge('<iframe src="/_Incapsula_Resource?SWUDNSAI=31"></iframe>')).toBe('incapsula');
    expect(detectChallenge('<html><title>2019 Toyota Camry</title></html>')).toBeNull();
  });

  it('ignores protection scripts embedded in real, content-rich pages', () => {
    const realPage = `<html><script src="/_Incapsula_Resource?x"></script>${'<div>lot</div>'.repeat(2000)}</html>`;
    expect(detectChallenge(realPage)).toBeNull();
    const iaai = readFileSync(new URL('./fixtures/iaai/search-toyota-camry-2018-2020-p1.html', import.meta.url), 'utf8');
    expect(detectChallenge(iaai)).toBeNull();
  });

  it('maps thrown values to source error info', () => {
    expect(toSourceErrorInfo(new SourceError('login_required', 'log in'))).toEqual({
      code: 'login_required',
      message: 'log in',
    });
    const timeout = new Error('Timeout 30000ms exceeded');
    timeout.name = 'TimeoutError';
    expect(toSourceErrorInfo(timeout).code).toBe('timeout');
    expect(toSourceErrorInfo(new Error('net::ERR_NAME_NOT_RESOLVED')).code).toBe('network');
    expect(toSourceErrorInfo(new Error('weird')).code).toBe('unknown');
    expect(toSourceErrorInfo('str')).toEqual({ code: 'unknown', message: 'str' });
  });
});

describe('cached', () => {
  let database: Database | undefined;
  afterEach(() => database?.close());

  async function setup() {
    database = await openDatabase(':memory:');
    let clock = new Date('2026-09-16T10:00:00Z');
    const cache = createCacheRepository(database.db, () => clock);
    return { cache, setClock: (d: string) => (clock = new Date(d)) };
  }

  it('loads once and serves from cache while fresh', async () => {
    const { cache } = await setup();
    const loader = vi.fn(async () => ({ n: 1 }));
    const opts = { key: 'k', source: 'bidfax', ttlMs: 60_000 };

    const first = await cached(cache, opts, loader);
    const second = await cached(cache, opts, loader);

    expect(first).toMatchObject({ ok: true, data: { n: 1 }, fromCache: false, stale: false });
    expect(second).toMatchObject({ ok: true, data: { n: 1 }, fromCache: true, stale: false });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('reloads when expired or forced', async () => {
    const { cache, setClock } = await setup();
    let n = 0;
    const loader = async () => ++n;
    const opts = { key: 'k', source: 's', ttlMs: 60_000 };

    await cached(cache, opts, loader);
    expect(await cached(cache, { ...opts, force: true }, loader)).toMatchObject({ data: 2, fromCache: false });
    setClock('2026-09-16T11:00:00Z');
    expect(await cached(cache, opts, loader)).toMatchObject({ data: 3, fromCache: false });
  });

  it('returns stale data with the error when a reload fails', async () => {
    const { cache, setClock } = await setup();
    const opts = { key: 'k', source: 's', ttlMs: 1000 };
    await cached(cache, opts, async () => 'old');
    setClock('2026-09-16T12:00:00Z');

    const result = await cached(cache, opts, async () => {
      throw new SourceError('blocked', 'nope');
    });
    expect(result).toMatchObject({
      ok: true,
      data: 'old',
      stale: true,
      error: { code: 'blocked', message: 'nope' },
    });
  });

  it('returns an error result when loading fails without a cache entry', async () => {
    const { cache } = await setup();
    const result = await cached(cache, { key: 'k', source: 's', ttlMs: 1000 }, async () => {
      throw new SourceError('parse_failed', 'bad html');
    });
    expect(result).toEqual({ ok: false, error: { code: 'parse_failed', message: 'bad html' } });
  });
});

describe('browser manager', () => {
  it('launches a persistent headless context, reuses it and closes cleanly', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'car-porter-profiles-'));
    const browser = createBrowserManager({ profilesDir: dir });
    try {
      const title = await browser.withPage('test', async (page) => {
        await page.setContent('<html><head><title>hello</title></head><body>ok</body></html>');
        return page.title();
      });
      expect(title).toBe('hello');
      const ctx1 = await browser.getContext('test');
      const ctx2 = await browser.getContext('test');
      expect(ctx1).toBe(ctx2);
      expect(ctx1.pages().filter((p) => !p.isClosed()).length).toBeLessThanOrEqual(1);
    } finally {
      await browser.closeAll();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }, 60_000);
});
