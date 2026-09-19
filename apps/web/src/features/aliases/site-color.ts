import type { AliasSource } from '@car-porter/core';

const COLORS: Record<AliasSource, string> = {
  copart: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  iaai: 'bg-red-500/15 text-red-600 dark:text-red-400',
  mobileBg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  carsBg: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  olxBg: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  mobileDe: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
};

/** Each site's colour: Copart blue, IAAI red, and one per BG marketplace. */
export const siteColor = (source: AliasSource) => COLORS[source];
