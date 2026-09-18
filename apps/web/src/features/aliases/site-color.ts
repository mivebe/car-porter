import type { AuctionSource } from '@car-porter/core';

/** Each auction site's colour: Copart blue, IAAI red. */
export const siteColor = (source: AuctionSource) =>
  source === 'copart' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' : 'bg-red-500/15 text-red-600 dark:text-red-400';
