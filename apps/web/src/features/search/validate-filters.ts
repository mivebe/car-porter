import type { LotSearchParams } from '@/lib/api';

export const MIN_YEAR = 1950;
export const MAX_YEAR = () => new Date().getFullYear() + 1;

export type FilterErrors = Partial<Record<'make' | 'model' | 'yearFrom' | 'yearTo', string>>;

export interface FilterDraft {
  make: string;
  model: string;
  yearFrom: string;
  yearTo: string;
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
  if (Object.keys(errors).length) return { errors };
  return { params: { make: draft.make.trim(), model: draft.model.trim(), yearFrom: from, yearTo: to } };
}

