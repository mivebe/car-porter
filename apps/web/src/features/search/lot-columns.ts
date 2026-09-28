export const LOT_COLUMNS = [
  'photo',
  'vehicle',
  'damage',
  'price',
  'saleDate',
  'sales',
  'avgSold',
  'market',
  'history',
  'odometer',
  'location',
  'costBg',
  'margin',
  'verdict',
] as const;
export type LotColumnId = (typeof LOT_COLUMNS)[number];

export interface LotColumn {
  id: LotColumnId;
  visible: boolean;
}

/** Always shown: the row has to say which lot it is. */
export const LOCKED_COLUMNS: ReadonlySet<LotColumnId> = new Set(['vehicle']);

/** Columns computed from stored estimate, history and market data. */
export const INSIGHT_COLUMNS: ReadonlySet<LotColumnId> = new Set([
  'history',
  'sales',
  'avgSold',
  'costBg',
  'market',
  'margin',
  'verdict',
]);

const DEFAULT_VISIBLE: ReadonlySet<LotColumnId> = new Set([
  'photo',
  'vehicle',
  'damage',
  'price',
  'saleDate',
  'sales',
  'avgSold',
  'market',
]);

const isColumnId = (id: string): id is LotColumnId => (LOT_COLUMNS as readonly string[]).includes(id);

/**
 * Full column list from the saved layout: saved columns in their order (unknown and repeated ids
 * dropped), then columns missing from it at their default visibility, locked columns always shown.
 */
export function resolveLotColumns(saved: readonly { id: string; visible: boolean }[]): LotColumn[] {
  const seen = new Set<LotColumnId>();
  const out: LotColumn[] = [];
  for (const { id, visible } of saved) {
    if (!isColumnId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, visible });
  }
  for (const id of LOT_COLUMNS) if (!seen.has(id)) out.push({ id, visible: DEFAULT_VISIBLE.has(id) });
  return out.map((c) => (LOCKED_COLUMNS.has(c.id) ? { ...c, visible: true } : c));
}

/** Moves the column at `from` to index `to`. */
export function moveColumn(columns: LotColumn[], from: number, to: number): LotColumn[] {
  if (from === to || to < 0 || to >= columns.length) return columns;
  const next = [...columns];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
