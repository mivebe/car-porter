import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { SourceError } from '../src/scraping/errors.ts';
import { mockNhtsaFetcher } from '../src/sources/mock-fetchers.ts';
import { displayName, parseMakes, parseModels } from '../src/sources/nhtsa.ts';

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/nhtsa/${name}`, import.meta.url), 'utf8'));

describe('nhtsa parsers (real recorded responses)', () => {
  it('merges makes across vehicle types, dedupes and sorts', () => {
    const makes = parseMakes([
      fixture('makes-car.json'),
      fixture('makes-mpv.json'),
      fixture('makes-truck.json'),
    ]);
    const names = makes.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['Toyota', 'Mercedes-Benz', 'BMW', 'Alfa Romeo', 'Tesla']));
    expect(new Set(makes.map((m) => m.id)).size).toBe(makes.length);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    expect(names.filter((n) => n === 'Toyota')).toHaveLength(1);
  });

  it('merges models across vehicle types and dedupes', () => {
    const models = parseModels([
      fixture('models-toyota-car.json'),
      fixture('models-toyota-mpv.json'),
      fixture('models-toyota-truck.json'),
    ]).map((m) => m.name);
    // car, MPV and truck models of the same make end up in one list
    expect(models).toEqual(expect.arrayContaining(['Camry', 'RAV4', 'Tacoma']));
    expect(new Set(models.map((m) => m.toLowerCase())).size).toBe(models.length);
  });

  it('throws parse_failed on unexpected payloads', () => {
    expect(() => parseModels([{ nope: true }])).toThrow(SourceError);
    expect(() => parseMakes([{ Results: 'x' }])).toThrow(/unexpected makes/);
  });

  it('formats display names', () => {
    expect(displayName('MERCEDES-BENZ')).toBe('Mercedes-Benz');
    expect(displayName('ALFA ROMEO')).toBe('Alfa Romeo');
    expect(displayName('BMW')).toBe('BMW');
    expect(displayName('McLaren')).toBe('McLaren');
  });
});

describe('/api/catalog', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  afterEach(async () => app?.close());

  it('serves makes and caches them (single upstream fetch per vehicle type)', async () => {
    const fetcher = vi.fn(mockNhtsaFetcher);
    app = await buildApp({ overrides: { nhtsaFetcher: fetcher } });

    const first = await app.inject({ method: 'GET', url: '/api/catalog/makes' });
    expect(first.statusCode).toBe(200);
    expect(first.json().items.length).toBeGreaterThan(100);
    expect(first.json().items).toContainEqual({ id: 448, name: 'Toyota' });

    await app.inject({ method: 'GET', url: '/api/catalog/makes' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('narrows makes to the ones the sites file lots under, once a site has been read', async () => {
    app = await buildApp({ mockSources: true });
    const all = (await app.inject({ method: 'GET', url: '/api/catalog/makes' })).json().items as { name: string }[];
    expect(all.length).toBeGreaterThan(100);

    await app.inject({
      method: 'GET',
      url: `/api/lots/search?${new URLSearchParams({ make: 'Toyota', model: 'Camry', yearFrom: '2018', yearTo: '2020' })}`,
    });

    const names = ((await app.inject({ method: 'GET', url: '/api/catalog/makes' })).json().items as { name: string }[]).map(
      (m) => m.name,
    );
    // the mock sites file lots under Toyota and Mercedes-Benz only
    expect(names).toEqual(expect.arrayContaining(['Toyota', 'Mercedes-Benz']));
    expect(names).not.toContain('Ferrari');
  });

  it('serves models for a make (case-insensitive cache key)', async () => {
    const fetcher = vi.fn(mockNhtsaFetcher);
    app = await buildApp({ overrides: { nhtsaFetcher: fetcher } });
    const res = await app.inject({ method: 'GET', url: '/api/catalog/models?make=Toyota' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((m: { name: string }) => m.name)).toContain('Camry');
    await app.inject({ method: 'GET', url: '/api/catalog/models?make=TOYOTA' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('validates the make parameter', async () => {
    app = await buildApp({ overrides: { nhtsaFetcher: mockNhtsaFetcher } });
    expect((await app.inject({ method: 'GET', url: '/api/catalog/models' })).statusCode).toBe(400);
  });

  it('returns 502 with a typed error when the upstream fails', async () => {
    app = await buildApp({
      overrides: {
        nhtsaFetcher: async () => {
          throw new SourceError('network', 'down');
        },
      },
    });
    const res = await app.inject({ method: 'GET', url: '/api/catalog/makes' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: { code: 'network', message: 'down' } });
  });
});
