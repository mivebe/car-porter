import type { AuctionSource, LotSearchPage } from '@car-porter/core';

export const AUCTION_PAGE_SIZE = 100;

/** A filter value as the auction site spells it, with its lot count. */
export interface ExternalFacet {
  name: string;
  count: number;
}

export interface YearRange {
  yearFrom: number;
  yearTo: number;
}

/** A search in the site's own vocabulary: any of `makes` AND any of `models` within the years. */
export interface AuctionQuery extends YearRange {
  makes: string[];
  models: string[];
}

export interface AuctionSearchAdapter {
  source: AuctionSource;
  /** Make names the site files lots under within the years. */
  makeFacets(years: YearRange): Promise<ExternalFacet[]>;
  /** Model names under any of the given site makes within the years. */
  modelFacets(makes: string[], years: YearRange): Promise<ExternalFacet[]>;
  /** `page` is 1-based. */
  search(query: AuctionQuery, page: number): Promise<LotSearchPage>;
}

export function dollarsToCents(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
}
