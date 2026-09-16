/**
 * Manual live check of the bidfax price estimate through the real app (hits live sites).
 * Usage: pnpm --filter @car-porter/server exec tsx scripts/live-estimate.ts toyota camry 2019
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { summarizeIncluded } from '@car-porter/core';
import { buildApp } from '../src/app.ts';

const [make = 'toyota', model = 'camry', year = '2019'] = process.argv.slice(2);
const dir = mkdtempSync(path.join(tmpdir(), 'car-porter-live-estimate-'));
const app = await buildApp({ dbFile: path.join(dir, 'db.sqlite'), profilesDir: path.join(dir, 'profiles') });

try {
  const search = await app.inject({
    method: 'GET',
    url: `/api/lots/search?make=${make}&model=${model}&yearFrom=${year}&yearTo=${year}`,
  });
  const { lots, sources } = search.json();
  console.log('search sources:', JSON.stringify(sources.map((s: { source: string; ok: boolean; total?: number }) => [s.source, s.ok, s.total])));
  const lot = lots.find((l: { trim: string | null }) => l.trim) ?? lots[0];
  if (!lot) throw new Error('no lots found');
  console.log('lot:', lot.id, lot.year, lot.make, lot.model, lot.trim, lot.engine);

  for (const label of ['first run', 'second run (cached)']) {
    const started = Date.now();
    const res = await app.inject({ method: 'POST', url: `/api/lots/${encodeURIComponent(lot.id)}/estimate`, payload: {} });
    const body = res.json();
    const records: { id: string; finalPriceUsdCents: number | null }[] = body.matches.map(
      (m: { record: { id: string; finalPriceUsdCents: number | null } }) => m.record,
    );
    const summary = summarizeIncluded(records, (r) => r.finalPriceUsdCents, new Set<string>(body.excludedIds));
    console.log(`${label}: ${Date.now() - started}ms status=${res.statusCode} error=${JSON.stringify(body.error)} scan=${JSON.stringify(body.scan)}`);
    console.log(`  matches=${body.matches.length} summary=${JSON.stringify(summary)} searchUrl=${body.searchUrl}`);
    for (const m of body.matches.slice(0, 3)) {
      const r = m.record;
      console.log(`  $${r.finalPriceUsdCents / 100} ${r.saleDate?.slice(0, 10)} ${r.trim} ${r.engine} ${r.saleStatus} ${r.damage} ${r.url}`);
    }
  }
} finally {
  await app.close();
}
