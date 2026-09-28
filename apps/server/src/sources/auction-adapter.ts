import type { AuctionSource, DamageType, IaaiMarket, LotCondition, LotSearchPage, Transmission } from '@car-porter/core';

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
  /** One word for the site's keyword search, e.g. a trim ("ZL1"). */
  keyword?: string | null;
  /** IAAI only; empty or missing = all marketplaces. */
  iaaiMarkets?: IaaiMarket[];
  /** Site body names, any of them. */
  bodyStyles?: string[];
  transmission?: Transmission;
  /** Site engine values, any of them. */
  engines?: string[];
  /** Primary damage, any of these groups. */
  damage?: DamageType[];
  /** At least this condition. */
  condition?: LotCondition;
  /** true = with keys, false = without. */
  keys?: boolean;
}

/** The site's own body and engine values for a make/model search, to filter by exactly. */
export interface OptionFacets {
  body: ExternalFacet[];
  engine: ExternalFacet[];
}

export interface AuctionSearchAdapter {
  source: AuctionSource;
  /** Most values the site returns per facet; a full list needs narrower year ranges once reached. */
  facetLimit?: number;
  /** Make names the site files lots under within the years. */
  makeFacets(years: YearRange): Promise<ExternalFacet[]>;
  /** Model names under any of the given site makes within the years. */
  modelFacets(makes: string[], years: YearRange): Promise<ExternalFacet[]>;
  /** Body and engine values within the makes/models/years (all cars when both are empty). */
  optionFacets(query: Pick<AuctionQuery, 'makes' | 'models'> & YearRange): Promise<OptionFacets>;
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
