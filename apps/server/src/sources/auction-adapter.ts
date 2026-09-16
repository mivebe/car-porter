import type { AuctionSource, LotSearchFilters, LotSearchPage } from '@car-porter/core';

export const AUCTION_PAGE_SIZE = 100;

export interface AuctionSearchAdapter {
  source: AuctionSource;
  /** `page` is 1-based. */
  search(filters: LotSearchFilters, page: number): Promise<LotSearchPage>;
}

export function dollarsToCents(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
}
