import type { AuctionRecord, Lot, SaleStatus } from './types.ts';
import { normalizeVin } from './vin.ts';

/** One auction appearance of a vehicle, merged across history sites. */
export interface HistoryEntry {
  /** `${auction}:${lotNumber}:${yyyy-mm-dd}` — the dedup key. */
  key: string;
  auction: string | null;
  lotNumber: string | null;
  saleDate: string | null;
  finalPriceUsdCents: number | null;
  saleStatus: SaleStatus | null;
  damage: string | null;
  odometerMiles: number | null;
  location: string | null;
  imageUrl: string | null;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  /** Every site that listed this appearance, in priority order (bidfax first). */
  sources: { site: string; url: string; recordId: string }[];
}

/** Sites listed first win when merged fields disagree. */
export const HISTORY_SITE_PRIORITY = ['bidfax', 'statvin'];

/** Final outcomes beat intermediate states when sites captured the sale at different moments. */
const STATUS_RANK: Record<SaleStatus, number> = { sold: 3, not_sold: 2, on_approval: 1, upcoming: 0 };

const MASK = /[*#_?]/;

/**
 * Whether a full VIN fits a listing's partially masked VIN ("4T1B11HK7KU******"): same length and
 * every unmasked character equal. An unmasked `mask` must equal the VIN.
 */
export function vinMatchesMask(mask: string, vin: string): boolean {
  const m = normalizeVin(mask);
  const v = normalizeVin(vin);
  return m.length === v.length && [...m].every((ch, i) => MASK.test(ch) || ch === v[i]);
}

export function historyKey(record: AuctionRecord): string {
  const day = record.saleDate?.slice(0, 10) ?? 'unknown';
  return `${record.auction ?? 'unknown'}:${record.lotNumber ?? record.id}:${day}`;
}

/**
 * Whether a stored record is an appearance of this lot's vehicle: same VIN, or — when found by
 * lot number, which auctions reuse — same auction and lot number with a VIN that doesn't
 * contradict the lot's (masked) VIN.
 */
export function isLotHistoryRecord(lot: Lot, vin: string | null, record: AuctionRecord): boolean {
  if (vin && record.vin) {
    if (normalizeVin(record.vin) === vin) return true;
  }
  if (record.lotNumber !== lot.lotNumber || record.auction !== lot.source) return false;
  if (!record.vin) return true;
  if (vin) return false;
  return lot.vin ? vinMatchesMask(lot.vin, record.vin) : true;
}

const sitePriority = (site: string) => {
  const i = HISTORY_SITE_PRIORITY.indexOf(site);
  return i < 0 ? HISTORY_SITE_PRIORITY.length : i;
};

/** Deduplicates records by (auction, lot, date) and merges their fields; newest first. */
export function mergeHistory(records: AuctionRecord[]): HistoryEntry[] {
  const groups = new Map<string, AuctionRecord[]>();
  for (const record of [...records].sort((a, b) => sitePriority(a.site) - sitePriority(b.site))) {
    const key = historyKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return [...groups.entries()]
    .map(([key, group]): HistoryEntry => {
      const first = <K extends keyof AuctionRecord>(field: K) =>
        group.map((r) => r[field]).find((v) => v != null) ?? null;
      const statuses = group.map((r) => r.saleStatus).filter((s): s is SaleStatus => s != null);
      return {
        key,
        auction: first('auction'),
        lotNumber: first('lotNumber'),
        saleDate: first('saleDate'),
        finalPriceUsdCents: first('finalPriceUsdCents'),
        saleStatus: statuses.sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a])[0] ?? null,
        damage: first('damage'),
        odometerMiles: first('odometerMiles'),
        location: first('location'),
        imageUrl: first('imageUrl'),
        vin: first('vin'),
        year: first('year'),
        make: first('make'),
        model: first('model'),
        trim: first('trim'),
        sources: group.map((r) => ({ site: r.site, url: r.url, recordId: r.id })),
      };
    })
    .sort((a, b) => (b.saleDate ?? '').localeCompare(a.saleDate ?? ''));
}
