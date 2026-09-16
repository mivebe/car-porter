import { toCents } from './money.ts';

export type VerdictStatus = 'worth' | 'borderline' | 'not_worth' | 'insufficient';
export type VerdictMissing = 'bid' | 'marketAverage';

export interface Verdict {
  status: VerdictStatus;
  marginEurCents: number | null;
  missing: VerdictMissing[];
}

/**
 * margin = BG market average − total import cost − repair estimate
 * ≥ threshold → worth; 0..threshold → borderline; < 0 → not worth.
 */
export function computeVerdict(input: {
  totalEurCents: number | null;
  marketAverageEurCents: number | null;
  repairEurCents: number;
  worthThresholdEur: number;
}): Verdict {
  const missing: VerdictMissing[] = [];
  if (input.totalEurCents == null) missing.push('bid');
  if (input.marketAverageEurCents == null) missing.push('marketAverage');
  if (input.totalEurCents == null || input.marketAverageEurCents == null) {
    return { status: 'insufficient', marginEurCents: null, missing };
  }

  const margin = input.marketAverageEurCents - input.totalEurCents - input.repairEurCents;
  const status: VerdictStatus =
    margin >= toCents(input.worthThresholdEur) ? 'worth' : margin >= 0 ? 'borderline' : 'not_worth';
  return { status, marginEurCents: margin, missing };
}
