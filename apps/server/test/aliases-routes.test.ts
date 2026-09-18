import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { ScanStatus } from '../src/services/alias-scan-service.ts';
import { readFacetsFully, type AliasEntry } from '../src/services/vehicle-alias-service.ts';

type App = Awaited<ReturnType<typeof buildApp>>;

const search = (app: App, make: string, model: string) =>
  app.inject({
    method: 'GET',
    url: `/api/lots/search?${new URLSearchParams({ make, model, yearFrom: '2017', yearTo: '2019' })}`,
  });
const entries = async (app: App, query: Record<string, string>) =>
  (await app.inject({ method: 'GET', url: `/api/aliases?${new URLSearchParams(query)}` })).json() as {
    items: AliasEntry[];
    total: number;
    counts: Record<string, number>;
  };
const assign = (app: App, items: object[], change: object) =>
  app.inject({ method: 'PUT', url: '/api/aliases/assignment', payload: { changes: items.map((i) => ({ ...i, ...change })) } });
const to = (...targets: string[]) => ({ action: 'assign', targets });
const modelNames = async (app: App, make: string) =>
  ((await app.inject({ method: 'GET', url: `/api/catalog/models?make=${make}` })).json().items as { name: string }[]).map(
    (m) => m.name,
  );
const iaaiMatched = (res: Awaited<ReturnType<typeof search>>) =>
  res.json().sources.find((s: { source: string }) => s.source === 'iaai').matched.models;

describe('/api/aliases', () => {
  let app: App | undefined;
  afterEach(async () => app?.close());

  it('lists unassigned site makes, and ignoring one removes it from that list', async () => {
    app = await buildApp({ mockSources: true });
    await search(app, 'Toyota', 'Camry');

    const unassigned = await entries(app, { kind: 'make', status: 'unassigned' });
    expect(unassigned.items.map((e) => [e.source, e.externalName])).toEqual([
      ['copart', 'GREAT DANE TRAILERS'],
      ['iaai', 'GREAT DANE TRAILERS'],
    ]);
    expect((await app.inject({ method: 'GET', url: '/api/aliases/summary' })).json()).toEqual({
      unassigned: { make: 2, model: 0, body: 0 },
    });

    const res = await assign(app, [{ source: 'copart', kind: 'make', externalName: 'GREAT DANE TRAILERS' }], { action: 'ignore' });
    expect(res.statusCode).toBe(200);
    const after = await entries(app, { kind: 'make', source: 'copart', q: 'dane' });
    expect(after.items).toEqual([expect.objectContaining({ status: 'ignored', manual: { state: 'ignored', targets: [] }, lotCount: 16 })]);
    expect(after.counts).toMatchObject({ unassigned: 0, ignored: 1 });
  });

  it('recognises motorcycle/trailer/bus makes as not a car instead of unassigned', async () => {
    app = await buildApp({ mockSources: true });
    await search(app, 'Toyota', 'Camry');
    const harley = await entries(app, { kind: 'make', source: 'iaai', status: 'non_car' });
    expect(harley.items).toEqual([
      expect.objectContaining({
        externalName: 'HARLEY-DAVIDSON',
        status: 'non_car',
        auto: { targets: [], match: 'non_car', nonCarMake: 'Harley-Davidson' },
      }),
    ]);
    // Honda is also a motorcycle make, but a car make first
    expect((await entries(app, { kind: 'make', source: 'iaai', q: 'toyota' })).items[0]).toMatchObject({ status: 'auto' });

    // still assignable, and not scanned for models
    await assign(app, [{ source: 'iaai', kind: 'make', externalName: 'HARLEY-DAVIDSON' }], to('Harley-Davidson'));
    expect((await entries(app, { kind: 'make', source: 'iaai', q: 'harley' })).items[0]).toMatchObject({
      status: 'manual',
      auto: { nonCarMake: 'Harley-Davidson' },
    });
  });

  it('reassigns a site model to several models, including a new one, and resets it', async () => {
    app = await buildApp({ mockSources: true });
    await search(app, 'Mercedes-Benz', 'C-Class');
    const key = { source: 'iaai', kind: 'model', externalName: 'AMG C 63', make: 'Mercedes-Benz' };
    const find = { kind: 'model', source: 'iaai', make: 'Mercedes-Benz', q: 'amg c 63' };

    expect((await assign(app, [key], to('C-Class', 'C 63 AMG'))).statusCode).toBe(200);
    expect((await entries(app, find)).items).toEqual([
      expect.objectContaining({
        status: 'manual',
        manual: { state: 'assigned', targets: expect.arrayContaining(['C 63 AMG', 'C-Class']) },
        auto: { targets: ['C-Class'], match: 'rule', nonCarMake: null },
      }),
    ]);

    // the new model is offered in the search form and finds the site names assigned to it
    expect(await modelNames(app, 'Mercedes-Benz')).toContain('C 63 AMG');
    expect(iaaiMatched(await search(app, 'Mercedes-Benz', 'C 63 AMG'))).toEqual(['AMG C 63']);
    expect(iaaiMatched(await search(app, 'Mercedes-Benz', 'C-Class'))).toEqual(['C', 'AMG C 63']);

    await assign(app, [key], { action: 'reset' });
    expect((await entries(app, find)).items).toEqual([expect.objectContaining({ status: 'auto', manual: null })]);
    expect(await modelNames(app, 'Mercedes-Benz')).not.toContain('C 63 AMG');
  });

  it('maps a site make to a make of your own and rejects invalid assignments', async () => {
    app = await buildApp({ mockSources: true });
    await search(app, 'Toyota', 'Camry');
    await assign(app, [{ source: 'iaai', kind: 'make', externalName: 'GREAT DANE TRAILERS' }], to('Great Dane'));
    const makes = (await app.inject({ method: 'GET', url: '/api/catalog/makes' })).json().items as { name: string }[];
    expect(makes.map((m) => m.name)).toContain('Great Dane');

    expect((await assign(app, [{ source: 'iaai', kind: 'make', externalName: 'X' }], to('A', 'B'))).statusCode).toBe(400);
    expect((await assign(app, [{ source: 'iaai', kind: 'model', externalName: 'X' }], to('A'))).statusCode).toBe(400);
    expect((await assign(app, [{ source: 'iaai', kind: 'make', externalName: 'X' }], { action: 'nope' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/aliases?kind=nope' })).statusCode).toBe(400);
  });

  it('scans every make, its models and the body styles in the background', async () => {
    app = await buildApp({ mockSources: true });
    const started = await app.inject({ method: 'POST', url: '/api/aliases/scan', payload: {} });
    expect(started.statusCode).toBe(202);
    expect((await app.inject({ method: 'POST', url: '/api/aliases/scan', payload: {} })).statusCode).toBe(409);

    let status: ScanStatus;
    do {
      await new Promise((r) => setTimeout(r, 20));
      status = (await app.inject({ method: 'GET', url: '/api/aliases/scan' })).json();
    } while (status.state === 'running');

    expect(status.state).toBe('done');
    expect(status.sources).toEqual([
      expect.objectContaining({ source: 'copart', phase: 'done', done: 2, total: 2, requests: 4, failed: [] }),
      expect.objectContaining({ source: 'iaai', phase: 'done', done: 2, total: 2, requests: 4, failed: [] }),
    ]);
    const bodies = await entries(app, { kind: 'body', source: 'iaai' });
    expect(bodies.items.map((e) => [e.externalName, e.auto.targets, e.status])).toEqual([
      ['Sedan', ['Sedan'], 'auto'],
      ['Sedan 4 Door', ['Sedan'], 'auto'],
      ['Sedan 4 Dr.', ['Sedan'], 'auto'],
    ]);
    const toyota = await entries(app, { kind: 'model', source: 'copart', make: 'Toyota' });
    expect(toyota.items.map((e) => e.externalName)).toEqual(['CAMRY', 'COROLLA', 'RAV4', 'CAMARY']);
    expect((await app.inject({ method: 'GET', url: '/api/aliases/makes' })).json().items).toEqual([
      { name: 'Mercedes-Benz', unassigned: 0 },
      { name: 'Toyota', unassigned: 0 },
    ]);
  });

  it('unassigns an automatically assigned name so it waits for assignment again', async () => {
    app = await buildApp({ mockSources: true });
    await search(app, 'Mercedes-Benz', 'C-Class');
    const assigned = await entries(app, { kind: 'model', make: 'Mercedes-Benz', source: 'copart', target: 'C-Class' });
    expect(assigned.items.map((e) => e.externalName)).toEqual(['C', 'AMG C 63']);

    await assign(app, [{ source: 'copart', kind: 'model', externalName: 'C', make: 'Mercedes-Benz' }], { action: 'unassign' });
    const after = await entries(app, { kind: 'model', make: 'Mercedes-Benz', source: 'copart', status: 'unassigned' });
    expect(after.items).toEqual([
      expect.objectContaining({ externalName: 'C', manual: { state: 'unassigned', targets: [] }, auto: expect.objectContaining({ targets: ['C-Class'] }) }),
    ]);
    expect((await entries(app, { kind: 'model', make: 'Mercedes-Benz', source: 'copart', target: 'C-Class' })).items.map((e) => e.externalName)).toEqual([
      'AMG C 63',
    ]);
    // searches no longer use it
    const res = await search(app, 'Mercedes-Benz', 'C-Class');
    expect(res.json().sources.find((x: { source: string }) => x.source === 'copart').matched.models).toEqual(['AMG C 63']);
    // assigning with no targets also unassigns
    await assign(app, [{ source: 'copart', kind: 'model', externalName: 'CLA', make: 'Mercedes-Benz' }], to());
    expect((await entries(app, { kind: 'model', make: 'Mercedes-Benz', source: 'copart', q: 'cla' })).items[0]).toMatchObject({ status: 'unassigned' });
    expect((await app.inject({ method: 'GET', url: '/api/aliases/makes?source=copart' })).json().items).toEqual([
      { name: 'Mercedes-Benz', unassigned: 2 },
    ]);
  });

  it('lists our makes and models with the site names searched as each', async () => {
    app = await buildApp({ mockSources: true });
    await search(app, 'Mercedes-Benz', 'C-Class');
    await assign(app, [{ source: 'iaai', kind: 'model', externalName: 'AMG C 63', make: 'Mercedes-Benz' }], to('C 63 AMG'));

    const models = (await app.inject({ method: 'GET', url: '/api/aliases/canonical?kind=model&make=mercedes-benz' })).json()
      .items as { name: string; siteNames: number; bySource: Record<string, number>; lots: number }[];
    // C-Class: "C" on both sites, plus Copart's "AMG C 63" (IAAI's was assigned to C 63 AMG above)
    expect(models.find((m) => m.name === 'C-Class')).toEqual({
      name: 'C-Class',
      siteNames: 3,
      bySource: { copart: 2, iaai: 1 },
      lots: 407,
    });
    expect(models.find((m) => m.name === 'C 63 AMG')).toEqual({
      name: 'C 63 AMG',
      siteNames: 1,
      bySource: { copart: 0, iaai: 1 },
      lots: 7,
    });
    expect(models.find((m) => m.name === 'G-Class')).toEqual({
      name: 'G-Class',
      siteNames: 0,
      bySource: { copart: 0, iaai: 0 },
      lots: 0,
    });

    const iaaiOnly = (await app.inject({ method: 'GET', url: '/api/aliases/canonical?kind=model&make=Mercedes-Benz&source=iaai' })).json()
      .items as { name: string; siteNames: number }[];
    expect(iaaiOnly.find((m) => m.name === 'C-Class')?.siteNames).toBe(1);

    const makes = (await app.inject({ method: 'GET', url: '/api/aliases/canonical?kind=make' })).json().items as { name: string; siteNames: number }[];
    expect(makes.find((m) => m.name === 'Mercedes-Benz')).toMatchObject({ siteNames: 4 });
    expect((await app.inject({ method: 'GET', url: '/api/aliases/canonical?kind=model' })).json().items).toEqual([]);
  });
});

describe('readFacetsFully', () => {
  it('splits the year range while a truncated facet hits the limit, merging counts', async () => {
    const calls: string[] = [];
    const facets = await readFacetsFully(2, { yearFrom: 1971, yearTo: 2003 }, async ({ yearFrom, yearTo }) => {
      if (yearTo < 2000) return [];
      if (yearTo > yearFrom) return [{ name: 'A', count: 9 }, { name: 'B', count: 9 }];
      return yearFrom === 2002 ? [{ name: 'A', count: 1 }, { name: 'C', count: 1 }] : [{ name: 'A', count: 1 }];
    }, { onRequest: ({ yearFrom, yearTo }) => calls.push(`${yearFrom}-${yearTo}`) });
    // halves while long, then straight to single years
    expect(calls).toEqual([
      '1971-2003', '1971-1987', '1988-2003',
      ...Array.from({ length: 16 }, (_, i) => `${1988 + i}-${1988 + i}`),
    ]);
    expect(facets).toEqual([
      { name: 'A', count: 4 },
      { name: 'C', count: 1 },
    ]);
  });

  it('stops splitting once cancelled', async () => {
    let requests = 0;
    let stop = false;
    await readFacetsFully(1, { yearFrom: 2000, yearTo: 2010 }, async () => {
      if (++requests === 3) stop = true;
      return [{ name: 'A', count: 1 }];
    }, { shouldStop: () => stop });
    expect(requests).toBe(3);
  });
});
