import { roundHalfUp } from './money.ts';

export interface PriceSummary {
  count: number;
  /** Mean in cents, rounded. */
  average: number;
  /** Median in cents, rounded (mean of the two middle values for even counts). */
  median: number;
  min: number;
  max: number;
}

/** Summarizes values (cents); returns null when there is nothing to summarize. */
export function summarizePrices(values: number[]): PriceSummary | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid]! : roundHalfUp((sorted[mid - 1]! + sorted[mid]!) / 2);

  return {
    count: sorted.length,
    average: roundHalfUp(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    median,
    min: sorted[0]!,
    max: sorted.at(-1)!,
  };
}

/**
 * Summarizes the prices of included items. Items are included by default; `excludedIds`
 * holds the ids the user unchecked. Items without a price are ignored.
 */
export function summarizeIncluded<T extends { id: string }>(
  items: T[],
  price: (item: T) => number | null,
  excludedIds: ReadonlySet<string>,
): PriceSummary | null {
  return summarizePrices(
    items
      .filter((item) => !excludedIds.has(item.id))
      .map(price)
      .filter((p): p is number => p != null),
  );
}
