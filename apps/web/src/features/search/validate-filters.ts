import type { IaaiMarket, Transmission } from '@car-porter/core';
import type { LotSearchParams } from '@/lib/api';

export const MIN_YEAR = 1950;
export const MAX_YEAR = () => new Date().getFullYear() + 1;

export type FilterErrors = Partial<Record<'make' | 'model' | 'yearFrom' | 'yearTo' | 'engine', string>>;

export interface FilterDraft {
  make: string;
  model: string;
  yearFrom: string;
  yearTo: string;
  trim: string;
  /** never empty */
  iaaiMarkets: IaaiMarket[];
  /** '' = any */
  bodyStyle: string;
  transmission: Transmission | '';
  /** liters as typed, "6.2" or "6,2" */
  engine: string;
}

/** Returns i18n error keys per field, or parsed params when valid. */
export function validateFilters(draft: FilterDraft): { errors: FilterErrors } | { params: LotSearchParams } {
  const errors: FilterErrors = {};
  if (!draft.make.trim()) errors.make = 'search.errors.makeRequired';
  if (!draft.model.trim()) errors.model = 'search.errors.modelRequired';
  const from = Number(draft.yearFrom);
  const to = Number(draft.yearTo);
  const validYear = (y: number) => Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR();
  if (!draft.yearFrom || !validYear(from)) errors.yearFrom = 'search.errors.yearInvalid';
  if (!draft.yearTo || !validYear(to)) errors.yearTo = 'search.errors.yearInvalid';
  if (!errors.yearFrom && !errors.yearTo && from > to) errors.yearTo = 'search.errors.yearOrder';
  const engine = draft.engine.trim().replace(',', '.');
  if (engine && (!/^\d{1,2}(\.\d)?$/.test(engine) || Number(engine) <= 0)) errors.engine = 'search.errors.engineInvalid';
  if (Object.keys(errors).length) return { errors };
  const trim = draft.trim.trim();
  return {
    params: {
      make: draft.make.trim(),
      model: draft.model.trim(),
      yearFrom: from,
      yearTo: to,
      ...(trim ? { trim } : {}),
      iaaiMarkets: draft.iaaiMarkets,
      ...(draft.bodyStyle ? { bodyStyle: draft.bodyStyle } : {}),
      ...(draft.transmission ? { transmission: draft.transmission } : {}),
      ...(engine ? { engine: Number(engine).toFixed(1) } : {}),
    },
  };
}

