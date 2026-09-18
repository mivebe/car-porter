import { describe, expect, it } from 'vitest';
import { LOT_COLUMNS, moveColumn, resolveLotColumns } from './lot-columns';

describe('resolveLotColumns', () => {
  it('uses the default layout when nothing is saved', () => {
    const columns = resolveLotColumns([]);
    expect(columns.map((c) => c.id)).toEqual([...LOT_COLUMNS]);
    expect(columns.filter((c) => c.visible).map((c) => c.id)).toEqual([
      'photo',
      'vehicle',
      'odometer',
      'damage',
      'location',
      'saleDate',
      'price',
    ]);
  });

  it('keeps the saved order, drops unknown and repeated ids, and appends missing columns', () => {
    const columns = resolveLotColumns([
      { id: 'costBg', visible: true },
      { id: 'gone', visible: true },
      { id: 'price', visible: false },
      { id: 'costBg', visible: false },
    ]);
    expect(columns.slice(0, 3)).toEqual([
      { id: 'costBg', visible: true },
      { id: 'price', visible: false },
      { id: 'photo', visible: true },
    ]);
    expect(columns).toHaveLength(LOT_COLUMNS.length);
  });

  it('always shows the vehicle column', () => {
    expect(resolveLotColumns([{ id: 'vehicle', visible: false }])[0]).toEqual({
      id: 'vehicle',
      visible: true,
    });
  });
});

describe('moveColumn', () => {
  const columns = resolveLotColumns([]).slice(0, 3);

  it('moves a column to a new index', () => {
    expect(moveColumn(columns, 0, 2).map((c) => c.id)).toEqual(['vehicle', 'odometer', 'photo']);
    expect(moveColumn(columns, 2, 0).map((c) => c.id)).toEqual(['odometer', 'photo', 'vehicle']);
  });

  it('ignores moves out of range', () => {
    expect(moveColumn(columns, 0, -1)).toBe(columns);
    expect(moveColumn(columns, 2, 3)).toBe(columns);
  });
});
