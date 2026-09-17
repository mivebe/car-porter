import { describe, expect, it } from 'vitest';
import type { AliasEntry } from '@/lib/api';
import { planDrop } from './drop-plan';

const entry = (over: Partial<AliasEntry> & Pick<AliasEntry, 'externalName'>): AliasEntry => ({
  source: 'iaai',
  kind: 'model',
  make: 'Mercedes-Benz',
  lotCount: 7,
  lastSeenAt: '2026-09-17T00:00:00Z',
  auto: { targets: [], match: null, nonCarMake: null },
  manual: null,
  status: 'unassigned',
  ...over,
});
const key = { source: 'iaai', kind: 'model', externalName: 'AMG C 63', make: 'Mercedes-Benz' };
const unassigned = entry({ externalName: 'AMG C 63' });
const assigned = entry({
  externalName: 'AMG C 63',
  auto: { targets: ['C-Class'], match: 'rule', nonCarMake: null },
  manual: { state: 'assigned', targets: ['C-Class', 'C 63 AMG'] },
  status: 'manual',
});

describe('planDrop', () => {
  it('assigns from the pool to a make/model on the left or to the selected one', () => {
    expect(planDrop({ entries: [unassigned], from: 'pool', to: { type: 'canonical', name: 'C-Class' }, active: null })).toEqual({
      outcome: { kind: 'assign', name: 'C-Class' },
      changes: [{ ...key, action: 'assign', targets: ['C-Class'] }],
    });
    expect(planDrop({ entries: [unassigned], from: 'pool', to: { type: 'assigned' }, active: 'E-Class' }).changes).toEqual([
      { ...key, action: 'assign', targets: ['E-Class'] },
    ]);
  });

  it('sends cards back when dropped in the middle with nothing selected', () => {
    expect(planDrop({ entries: [unassigned], from: 'pool', to: { type: 'assigned' }, active: null })).toEqual({
      outcome: { kind: 'needs-selection' },
      changes: [],
    });
  });

  it('moves an assigned model to another model, keeping its other assignments', () => {
    const plan = planDrop({ entries: [assigned], from: 'assigned', to: { type: 'canonical', name: 'E-Class' }, active: 'C-Class' });
    expect(plan).toEqual({
      outcome: { kind: 'move', name: 'E-Class' },
      changes: [{ ...key, action: 'assign', targets: ['C 63 AMG', 'E-Class'] }],
    });
    // with add, the selected one stays too
    expect(
      planDrop({ entries: [assigned], from: 'assigned', to: { type: 'canonical', name: 'e-class' }, active: 'C-Class', add: true })
        .changes,
    ).toEqual([{ ...key, action: 'assign', targets: ['C-Class', 'C 63 AMG', 'e-class'] }]);
  });

  it('moves a make to another make', () => {
    const make = entry({ kind: 'make', make: '', externalName: 'SCION', manual: { state: 'assigned', targets: ['Toyota'] }, status: 'manual' });
    expect(planDrop({ entries: [make], from: 'assigned', to: { type: 'canonical', name: 'Scion' }, active: 'Toyota', add: true }).changes).toEqual([
      { source: 'iaai', kind: 'make', externalName: 'SCION', action: 'assign', targets: ['Scion'] },
    ]);
  });

  it('unassigns into the pool: a make fully, a model only from the selected model', () => {
    const make = entry({ kind: 'make', make: '', externalName: 'MERC', auto: { targets: ['Mercedes-Benz'], match: 'exact', nonCarMake: null }, status: 'auto' });
    expect(planDrop({ entries: [make, assigned], from: 'assigned', to: { type: 'pool' }, active: 'C-Class' })).toEqual({
      outcome: { kind: 'unassign' },
      changes: [
        { source: 'iaai', kind: 'make', externalName: 'MERC', action: 'unassign' },
        { ...key, action: 'assign', targets: ['C 63 AMG'] },
      ],
    });
    const only = entry({ externalName: 'AMG C 63', auto: { targets: ['C-Class'], match: 'rule', nonCarMake: null }, status: 'auto' });
    expect(planDrop({ entries: [only], from: 'assigned', to: { type: 'pool' }, active: 'C-Class' }).changes).toEqual([
      { ...key, action: 'unassign' },
    ]);
  });

  it('ignores drops that change nothing', () => {
    for (const plan of [
      planDrop({ entries: [unassigned], from: 'pool', to: { type: 'pool' }, active: 'C-Class' }),
      planDrop({ entries: [assigned], from: 'assigned', to: { type: 'assigned' }, active: 'C-Class' }),
      planDrop({ entries: [assigned], from: 'assigned', to: { type: 'canonical', name: 'c-class' }, active: 'C-Class' }),
      planDrop({ entries: [], from: 'pool', to: { type: 'canonical', name: 'C-Class' }, active: null }),
    ]) {
      expect(plan).toEqual({ outcome: { kind: 'none' }, changes: [] });
    }
  });
});
