import { matchMarketListing, type MarketCriterion, type MarketMatchToggles, type MatchResult } from './matching.ts';
import { MARKET_SOURCES, type MarketSource, type Settings } from './settings.ts';
import { summarizeIncluded, type PriceSummary } from './stats.ts';
import type { Lot, MarketListing } from './types.ts';

export interface MarketGroup {
  site: MarketSource;
  matches: { listing: MarketListing; match: MatchResult<MarketCriterion> }[];
  /** Listings of this site that the match criteria ruled out. */
  hidden: number;
  /** Over included matches with a price. */
  summary: PriceSummary | null;
}

export interface MarketSummary {
  groups: MarketGroup[];
  /** Over included matches of all enabled sites. */
  overall: PriceSummary | null;
}

/** Marketplaces used for a lot: its own choice, else the defaults from settings. */
export function effectiveMarketSources(
  lotSources: Partial<Record<MarketSource, boolean>> | null,
  defaults: Settings['market']['enabledSources'],
): MarketSource[] {
  return MARKET_SOURCES.filter((site) => lotSources?.[site] ?? defaults[site] ?? false);
}

/**
 * Groups a lot's BG market listings by enabled marketplace, keeps the matching ones (cheapest
 * first) and summarizes the included prices per group and overall.
 */
export function summarizeMarket(
  lot: Lot,
  listings: MarketListing[],
  options: { sites: MarketSource[]; toggles: MarketMatchToggles; mileageRangeKm: number; excludedIds: ReadonlySet<string> },
): MarketSummary {
  const price = (l: MarketListing) => l.priceEurCents;
  const groups = options.sites.map((site): MarketGroup => {
    const ofSite = listings.filter((l) => l.site === site);
    const matches = ofSite
      .map((listing) => ({ listing, match: matchMarketListing(lot, listing, options.toggles, options.mileageRangeKm) }))
      .filter(({ match }) => match.matches)
      .sort((a, b) => (a.listing.priceEurCents ?? Infinity) - (b.listing.priceEurCents ?? Infinity));
    return {
      site,
      matches,
      hidden: ofSite.length - matches.length,
      summary: summarizeIncluded(matches.map((m) => m.listing), price, options.excludedIds),
    };
  });
  return {
    groups,
    overall: summarizeIncluded(groups.flatMap((g) => g.matches.map((m) => m.listing)), price, options.excludedIds),
  };
}
