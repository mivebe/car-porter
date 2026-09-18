import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '../src/db/client.ts';
import { createCacheRepository } from '../src/repositories/cache-repository.ts';
import { autoscout24SearchUrl, createAutoscout24Adapter, parseAutoscout24Listing } from '../src/sources/autoscout24.ts';
import { carsBgSearchUrl, createCarsBgAdapter, parseCarsBgBrands, parseCarsBgListing, parseCarsBgModels } from '../src/sources/carsbg.ts';
import { parseKm, parsePriceEurCents, type CatalogEntry } from '../src/sources/market-adapter.ts';
import {
  createMobileBgAdapter,
  mobileBgSearchUrl,
  parseMobileBgListing,
  parseMobileBgMakes,
  parseMobileBgModels,
} from '../src/sources/mobilebg.ts';
import { createMockMarketFetchers } from '../src/sources/mock-fetchers.ts';
import { createOlxAdapter, olxOffersUrl, parseOlxMakePage, parseOlxMakes, parseOlxOffers } from '../src/sources/olxbg.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('market helpers', () => {
  it('parses prices in euro and leva, and kilometres', () => {
    expect(parsePriceEurCents('12 200 €')).toBe(1_220_000);
    expect(parsePriceEurCents('13,995 EUR')).toBe(1_399_500);
    expect(parsePriceEurCents('5.11 €')).toBe(511);
    expect(parsePriceEurCents('19 558,30 лв.')).toBe(1_000_000);
    expect(parsePriceEurCents('Цена по договаряне')).toBeNull();
    expect(parseKm(' 189 084 км')).toBe(189_084);
    expect(parseKm('189000 км.')).toBe(189_000);
    expect(parseKm('86 200 km')).toBe(86_200);
  });
});

describe('mobile.bg (real recorded pages)', () => {
  it('parses the make and model catalogs', () => {
    const makes = parseMobileBgMakes(fixture('mobilebg/makes.html'));
    expect(makes.length).toBeGreaterThan(100);
    expect(makes).toContainEqual({ value: 'toyota', label: 'Toyota' });
    expect(makes).toContainEqual({ value: 'vw', label: 'VW' });
    const models = parseMobileBgModels(fixture('mobilebg/make-toyota.html'), 'toyota');
    expect(models).toContainEqual({ value: 'camry', label: 'Camry' });
    expect(models).toContainEqual({ value: 'rav4', label: 'Rav4' });
  });

  it('parses listings, including import offers still abroad', () => {
    const { listings, linkedPages } = parseMobileBgListing(fixture('mobilebg/toyota-camry-2019.html'), { make: 'toyota', model: 'camry' });
    expect(linkedPages).toEqual([]);
    // the 10th card is a promo banner, not an ad (the page reports 9 results)
    expect(listings).toHaveLength(9);
    expect(listings[0]).toEqual({
      id: 'https://www.mobile.bg/obiava-11782132034171798-toyota-camry-2-5hybrid-avtomat-navi-koja-kamera-euro',
      site: 'mobileBg',
      url: 'https://www.mobile.bg/obiava-11782132034171798-toyota-camry-2-5hybrid-avtomat-navi-koja-kamera-euro',
      title: 'Toyota Camry 2.5Hybrid AVTOMAT/NAVI/KOJA/KAMERA EURO',
      year: 2019,
      make: 'toyota',
      model: 'camry',
      trim: null,
      fuel: 'Хибриден',
      transmission: 'Автоматична',
      mileageKm: 302_000,
      priceEurCents: 1_220_000,
      location: 'обл. София, гр. София',
      imageUrl: 'https://mobistatic3.focus.bg/mobile/photosorg/798/1/11782132034171798_jF.webp',
      importOffer: false,
    });
    expect(listings[2]).toMatchObject({ title: 'Toyota Camry 2.5l Se', location: 'Намира се в САЩ', importOffer: true });
    expect(listings.every((l) => l.year === 2019 && l.priceEurCents! > 0)).toBe(true);
  });

  it('reads linked result pages', () => {
    const { listings, linkedPages } = parseMobileBgListing(fixture('mobilebg/toyota-rav4-2019-p1.html'), { make: 'toyota', model: 'rav4' });
    expect(listings).toHaveLength(20);
    expect(linkedPages).toEqual([2, 3, 4]);
  });

  it('flags unknown markup', () => {
    expect(() => parseMobileBgListing('<html><body>nothing</body></html>', { make: 'x', model: 'y' })).toThrow(
      expect.objectContaining({ code: 'parse_failed' }),
    );
  });
});

describe('cars.bg (real recorded pages)', () => {
  it('parses brand ids and model ids', () => {
    expect(parseCarsBgBrands(fixture('carsbg/home.html'))).toContainEqual({ value: '80', label: 'Toyota' });
    const models = parseCarsBgModels(fixture('carsbg/brand-toyota.html'));
    expect(models).toContainEqual({ value: '1374', label: 'Camry' });
    expect(models).toContainEqual({ value: '1393', label: 'RAV 4' });
  });

  it('parses result cards (no transmission on cards)', () => {
    const { listings, hasNextPage } = parseCarsBgListing(fixture('carsbg/toyota-camry-2019.html'), { make: 'Toyota', model: 'Camry' });
    expect(hasNextPage).toBe(true);
    expect(listings.map((l) => l.title)).toEqual(['Toyota Camry Hybrid', 'Toyota Camry * SE * CARFAX *', 'Toyota Camry Hibrid']);
    expect(listings[1]).toEqual({
      id: 'https://www.cars.bg/offer/6a784f39cb981deef50eba94',
      site: 'carsBg',
      url: 'https://www.cars.bg/offer/6a784f39cb981deef50eba94',
      title: 'Toyota Camry * SE * CARFAX *',
      year: 2019,
      make: 'Toyota',
      model: 'Camry',
      trim: null,
      fuel: 'Бензин',
      transmission: null,
      mileageKm: 200_437,
      priceEurCents: 1_925_000,
      location: 'София',
      imageUrl: 'https://g1-bg.cars.bg/2026-08-09_2/6a784f027d7969623d06c2f2b.jpg',
      importOffer: false,
    });
  });
});

describe('AutoScout24 (real recorded pages)', () => {
  it('parses the listings JSON (EU reference prices)', () => {
    const { listings, numberOfPages, modelKnown } = parseAutoscout24Listing(fixture('autoscout24/toyota-camry-2019-p1.html'));
    expect(numberOfPages).toBe(2);
    expect(modelKnown).toBe(true);
    expect(listings).toHaveLength(20);
    expect(listings[0]).toMatchObject({
      site: 'autoscout24',
      title: 'Toyota Camry 2.5 220H Advance',
      year: 2019,
      make: 'Toyota',
      model: 'Camry',
      fuel: 'Eл/Бензин',
      transmission: 'автоматик',
      mileageKm: 86_200,
      priceEurCents: 2_199_000,
      location: 'ES, Alcobendas',
      importOffer: false,
    });
    expect(() => parseAutoscout24Listing('<html></html>')).toThrow(expect.objectContaining({ code: 'parse_failed' }));
  });
});

describe('OLX.bg (real recorded pages)', () => {
  it('parses the make subcategories with OLX\'s own URL names', () => {
    const makes = parseOlxMakes(fixture('olxbg/cars.html'));
    expect(makes).toContainEqual({ value: 'toyota', label: 'Toyota' });
    expect(makes).toContainEqual({ value: 'mercedes', label: 'Mercedes' });
  });

  it('parses the make category and its model filter values', () => {
    const { categoryId, models } = parseOlxMakePage(fixture('olxbg/make-toyota.html'));
    expect(categoryId).toBe(1181);
    expect(models).toContainEqual({ value: 'camry', label: 'Camry' });
    expect(models).toContainEqual({ value: 'rav-4', label: 'RAV 4' });
  });

  it('parses offers from the API', () => {
    expect(parseOlxOffers(fixture('olxbg/offers-1181-camry-2019.json'), { make: 'Toyota' })).toEqual({ listings: [], hasNextPage: false });
    const { listings } = parseOlxOffers(fixture('olxbg/offers-1181-rav-4-2020.json'), { make: 'Toyota' });
    expect(listings[1]).toEqual({
      id: 'https://www.olx.bg/d/ad/toyota-rav4-hybrid-2-5-awd-4h4-xle-ecvt-12-multimediya-kasko-obsluzhena-CID360-IDa2GJ5.html',
      site: 'olxBg',
      url: 'https://www.olx.bg/d/ad/toyota-rav4-hybrid-2-5-awd-4h4-xle-ecvt-12-multimediya-kasko-obsluzhena-CID360-IDa2GJ5.html',
      title: "Toyota RAV4 Hybrid 2.5 AWD (4х4) XLE eCVT 12' Мултимедия, Каско, Обслужена",
      year: 2020,
      make: 'Toyota',
      model: 'RAV 4',
      trim: null,
      fuel: 'Хибрид',
      transmission: 'Автоматична',
      mileageKm: 89_950,
      priceEurCents: 2_799_900,
      location: 'гр. Русе',
      imageUrl: 'https://frankfurt.apollo.olxcdn.com:443/v1/files/9f4mc6ejar513-BG/image;s=400x300',
      importOffer: false,
    });
    expect(() => parseOlxOffers('<html><title>Just a moment...</title></html>', { make: 'x' })).toThrow(
      expect.objectContaining({ code: 'blocked' }),
    );
  });
});

describe('market adapters', () => {
  let database: Database;
  const fetchers = createMockMarketFetchers();
  beforeEach(async () => {
    database = await openDatabase(':memory:');
  });
  afterEach(() => database.close());

  const entry = (value: string, label = value): CatalogEntry => ({ value, label });

  it('mobile.bg: lists makes and models, reads linked pages up to the limit', async () => {
    const fetch = vi.fn(fetchers.mobileBg);
    const adapter = createMobileBgAdapter(fetch, createCacheRepository(database.db));
    expect(await adapter.catalog!.makes()).toContainEqual({ value: 'toyota', label: 'Toyota' });
    expect(await adapter.catalog!.models(entry('toyota'))).toContainEqual({ value: 'rav4', label: 'Rav4' });
    const scan = await adapter.scan({ make: entry('toyota'), model: entry('rav4'), year: 2019 }, { maxPages: 1 });
    expect(fetch.mock.calls.map((c) => c[0]).slice(2)).toEqual([mobileBgSearchUrl('toyota', 'rav4', 2019)]);
    expect(scan).toMatchObject({ pagesScanned: 1, complete: false, searchUrl: mobileBgSearchUrl('toyota', 'rav4', 2019) });
    expect(scan.listings).toHaveLength(20);

    // page 2 (not recorded: empty) is linked from page 1
    fetch.mockClear();
    const all = await adapter.scan({ make: entry('toyota'), model: entry('rav4'), year: 2019 }, { maxPages: 5 });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([mobileBgSearchUrl('toyota', 'rav4', 2019), mobileBgSearchUrl('toyota', 'rav4', 2019, 2)]);
    expect(all).toMatchObject({ pagesScanned: 2, complete: true });

    // catalogs are cached
    fetch.mockClear();
    await adapter.catalog!.makes();
    await adapter.catalog!.models(entry('toyota'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cars.bg: stops at an empty page even though a next page is always linked', async () => {
    const fetch = vi.fn(fetchers.carsBg);
    const adapter = createCarsBgAdapter(fetch, createCacheRepository(database.db));
    const toyota = (await adapter.catalog!.makes()).find((m) => m.label === 'Toyota')!;
    const camry = (await adapter.catalog!.models(toyota)).find((m) => m.label === 'Camry')!;
    const scan = await adapter.scan({ make: toyota, model: camry, year: 2019 }, { maxPages: 5 });
    expect(fetch.mock.calls.map((c) => c[0]).slice(2)).toEqual([carsBgSearchUrl('80', '1374', 2019), carsBgSearchUrl('80', '1374', 2019, 2)]);
    expect(scan).toMatchObject({ pagesScanned: 2, complete: true });
    expect(scan.listings).toHaveLength(3);
  });

  it('AutoScout24: searches the names as given, reads every page', async () => {
    const fetch = vi.fn(fetchers.autoscout24);
    const adapter = createAutoscout24Adapter(fetch);
    expect(adapter.catalog).toBeUndefined();
    const scan = await adapter.scan({ make: entry('TOYOTA'), model: entry('CAMRY'), year: 2019 }, { maxPages: 5 });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([autoscout24SearchUrl('toyota', 'camry', 2019), autoscout24SearchUrl('toyota', 'camry', 2019, 2)]);
    expect(scan).toMatchObject({ pagesScanned: 2, complete: true });
    expect(scan.listings).toHaveLength(26);
  });

  it('OLX: lists the models of a make from its category page, searches by category id', async () => {
    const fetch = vi.fn(fetchers.olxBg);
    const adapter = createOlxAdapter(fetch, createCacheRepository(database.db));
    const toyota = (await adapter.catalog!.makes()).find((m) => m.label === 'Toyota')!;
    const rav4 = (await adapter.catalog!.models(toyota)).find((m) => m.value === 'rav-4')!;
    const scan = await adapter.scan({ make: toyota, model: rav4, year: 2020 }, { maxPages: 5 });
    expect(fetch.mock.calls.at(-1)![0]).toBe(olxOffersUrl(1181, 'rav-4', 2020));
    expect(scan.listings).toHaveLength(2);
  });
});
