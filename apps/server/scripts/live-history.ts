/**
 * Manual live check of the vehicle history through the real app (hits live sites).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/live-history.ts toyota camry 2019 [VIN]
 * Picks a lot with a full VIN when there is one; a VIN argument is pasted as the VIN override.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkVin, type Lot } from '@car-porter/core';
import { buildApp } from '../src/app.ts';

const [make = 'toyota', model = 'camry', year = '2019', vin] = process.argv.slice(2);
const dir = mkdtempSync(path.join(tmpdir(), 'car-porter-live-history-'));
const app = await buildApp({ dbFile: path.join(dir, 'db.sqlite'), profilesDir: path.join(dir, 'profiles') });

try {
  const search = await app.inject({
    method: 'GET',
    url: `/api/lots/search?make=${make}&model=${model}&yearFrom=${year}&yearTo=${year}`,
  });
  const { lots } = search.json() as { lots: Lot[] };
  const lot = lots.find((l) => l.vin && checkVin(l.vin).valid) ?? lots[0];
  if (!lot) throw new Error('no lots found');
  console.log('lot:', lot.id, lot.year, lot.make, lot.model, lot.vin);
  const url = `/api/lots/${encodeURIComponent(lot.id)}`;
  if (vin) await app.inject({ method: 'PATCH', url: `${url}/inputs`, payload: { vinOverride: vin } });

  for (const label of ['first run', 'second run (cached)']) {
    const started = Date.now();
    const res = await app.inject({ method: 'POST', url: `${url}/history`, payload: {} });
    const body = res.json();
    console.log(`${label}: ${Date.now() - started}ms status=${res.statusCode} vin=${body.vin} (${body.vinSource})`);
    for (const c of body.checks) console.log(`  check ${c.site}/${c.query}=${c.value} found=${c.found} cached=${c.fromCache} error=${JSON.stringify(c.error)}`);
    for (const e of body.entries) {
      const sources = e.sources.map((s: { site: string }) => s.site).join('+');
      console.log(`  ${e.saleDate?.slice(0, 10)} ${e.auction} #${e.lotNumber} $${e.finalPriceUsdCents / 100} ${e.saleStatus} ${e.damage} ${e.odometerMiles}mi [${sources}]`);
    }
  }
} finally {
  await app.close();
}
