import type { Lot } from '@car-porter/core';
import { titleCase } from '@/lib/format';

export function lotTitle(lot: Lot) {
  return [lot.year, titleCase(lot.make), titleCase(lot.model), lot.trim].filter(Boolean).join(' ');
}
