import type { AuctionSource, MarketSource } from '@car-porter/core';

/** An auction or a marketplace. */
export type Site = AuctionSource | MarketSource;

const COLORS: Record<Site, string> = {
  copart: 'bg-site-copart/15 text-site-copart',
  iaai: 'bg-site-iaai/15 text-site-iaai',
  mobileBg: 'bg-site-mobile-bg/15 text-site-mobile-bg',
  carsBg: 'bg-site-cars-bg/15 text-site-cars-bg',
  olxBg: 'bg-site-olx-bg/15 text-site-olx-bg',
  mobileDe: 'bg-site-mobile-de/15 text-site-mobile-de',
  autoscout24: 'bg-site-autoscout24/15 text-site-autoscout24',
};

/** Each site's tint (background and text), from the site colour tokens in index.css. */
export const siteColor = (site: Site) => COLORS[site];
