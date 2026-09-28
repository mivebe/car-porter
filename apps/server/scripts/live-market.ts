/**
 * Manual live check of the BG market comparison through the real app (hits live sites).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/live-market.ts toyota rav4 2019
 * Enables every marketplace for the first lot found.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS, summarizeMarket, type Lot } from '@car-porter/core';
import { buildApp } from '../src/app.ts';

const [make = 'toyota', model = 'rav4', year = '2019'] = process.argv.slice(2);
const dir = mkdtempSync(path.join(tmpdir(), 'car-porter-live-market-'));
const app = await buildApp({ dbFile: path.join(dir, 'db.sqlite'), profilesDir: path.join(dir, 'profiles') });

try {
  const search = await app.inject({
    method: 'GET',
    url: `/api/lots/search?make=${make}&model=${model}&yearFrom=${year}&yearTo=${year}`,
  });
  const lot = (search.json() as { lots: Lot[] }).lots[0];
  if (!lot) throw new Error('no lots found');
  console.log('lot:', lot.id, lot.year, lot.make, lot.model, lot.trim, lot.fuel, lot.odometerMiles, 'mi');
  const url = `/api/lots/${encodeURIComponent(lot.id)}`;
  const sources = { mobileBg: true, carsBg: true, autoscout24: true, olxBg: true, mobileDe: true };
  await app.inject({ method: 'PATCH', url: `${url}/inputs`, payload: { marketSources: sources } });

  for (const label of ['first run', 'second run (cached)']) {
    const started = Date.now();
    const res = await app.inject({ method: 'POST', url: `${url}/market`, payload: {} });
    const body = res.json();
    console.log(`${label}: ${Date.now() - started}ms status=${res.statusCode}`);
    for (const s of body.sites) {
      console.log(`  ${s.site}: found=${s.found} pages=${s.pagesScanned} complete=${s.complete} cached=${s.fromCache} error=${JSON.stringify(s.error)} ${s.searchUrl}`);
    }
    const summary = summarizeMarket(lot, body.listings, {
      sites: ['mobileBg', 'carsBg', 'autoscout24', 'olxBg', 'mobileDe'],
      toggles: { trim: true, mileage: false, transmission: false, yearSpan: 0 },
      mileageRangeKm: DEFAULT_SETTINGS.market.mileageRangeKm,
      excludedIds: new Set(),
    });
    for (const g of summary.groups) {
      const sample = g.matches.slice(0, 2).map((m) => `${m.listing.priceEurCents! / 100}€ ${m.listing.year} ${m.listing.mileageKm}km ${m.listing.fuel}`);
      console.log(`  ${g.site}: matches=${g.matches.length} hidden=${g.hidden} avg=${(g.summary?.average ?? 0) / 100}€ e.g. ${sample.join(' | ')}`);
    }
    console.log(`  overall: ${JSON.stringify(summary.overall)}`);
  }
} finally {
  await app.close();
}
