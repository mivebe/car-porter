import type { AuctionSource, Lot } from '@car-porter/core';

export const LOT_SORTS = ['saleDate', 'price', 'yearDesc', 'odometer'] as const;
export type LotSort = (typeof LOT_SORTS)[number];
export type SourceFilter = 'all' | AuctionSource;

/** Price shown for a lot: current bid, else Buy Now. */
export const lotPrice = (lot: Lot) => lot.currentBidUsdCents ?? lot.buyNowUsdCents;

/** Ascending compare with nulls last. */
function nullsLast(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : null);

export function sortAndFilterLots(lots: Lot[], sort: LotSort, source: SourceFilter): Lot[] {
  const filtered = source === 'all' ? lots : lots.filter((l) => l.source === source);
  const compare: Record<LotSort, (a: Lot, b: Lot) => number> = {
    saleDate: (a, b) => nullsLast(time(a.saleDate), time(b.saleDate)),
    price: (a, b) => nullsLast(lotPrice(a), lotPrice(b)),
    yearDesc: (a, b) => b.year - a.year,
    odometer: (a, b) => nullsLast(a.odometerMiles, b.odometerMiles),
  };
  // stable sort keeps source order for ties
  return filtered.map((lot, i) => ({ lot, i })).sort((x, y) => compare[sort](x.lot, y.lot) || x.i - y.i).map((x) => x.lot);
}

/** Dedupes lots across pages (same lot can shift pages between requests). */
export function uniqueLots(pages: Lot[][]): Lot[] {
  const seen = new Set<string>();
  const out: Lot[] = [];
  for (const lot of pages.flat()) {
    if (!seen.has(lot.id)) {
      seen.add(lot.id);
      out.push(lot);
    }
  }
  return out;
}
