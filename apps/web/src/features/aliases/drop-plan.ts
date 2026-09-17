import type { AliasChange, AliasEntry } from '@/lib/api';

/** Where a site name card sits: assigned to the selected make/model, or in the right-hand list. */
export type AliasColumn = 'assigned' | 'pool';

/** Stable id of a site name card (a model's make is part of its identity). */
export const cardId = (e: AliasEntry) => `${e.source}|${e.make}|${e.externalName}`;

export type DropTarget = { type: 'canonical'; name: string } | { type: 'assigned' } | { type: 'pool' };

export type DropOutcome =
  | { kind: 'assign'; name: string }
  | { kind: 'move'; name: string }
  | { kind: 'add'; name: string }
  | { kind: 'unassign' }
  /** dropped on the middle column while nothing is selected on the left: the cards go back */
  | { kind: 'needs-selection' }
  | { kind: 'none' };

export interface DropPlan {
  outcome: DropOutcome;
  changes: AliasChange[];
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const unique = (names: string[]) => names.filter((n, i) => names.findIndex((m) => same(m, n)) === i);

const targetsOf = (e: AliasEntry) => (e.manual ? e.manual.targets : e.auto.targets);
const keyOf = (e: AliasEntry) => ({
  source: e.source,
  kind: e.kind,
  externalName: e.externalName,
  ...(e.kind === 'model' ? { make: e.make } : {}),
});

/**
 * Turns a drop into alias changes.
 * - pool → a make/model on the left, or → the middle column (the selected one): assign to it
 * - middle → another make/model on the left: move there (models: `add` keeps the current one too)
 * - middle → pool: unassign from the selected make/model (a model keeps its other assignments)
 */
export function planDrop(input: {
  entries: AliasEntry[];
  from: AliasColumn;
  to: DropTarget;
  /** the make/model selected on the left */
  active: string | null;
  /** add instead of move (models only) */
  add?: boolean;
}): DropPlan {
  const { entries, from, to, active, add = false } = input;
  const none: DropPlan = { outcome: { kind: 'none' }, changes: [] };
  if (entries.length === 0) return none;

  const assignTo = (name: string, outcome: DropOutcome): DropPlan => ({
    outcome,
    changes: entries.map((e) => {
      const keep = e.kind === 'model' && add ? targetsOf(e) : [];
      return { ...keyOf(e), action: 'assign', targets: unique([...keep, name]) };
    }),
  });

  if (to.type === 'pool') {
    if (from === 'pool' || !active) return none;
    return {
      outcome: { kind: 'unassign' },
      changes: entries.map((e) => {
        const rest = e.kind === 'model' ? targetsOf(e).filter((t) => !same(t, active)) : [];
        return rest.length ? { ...keyOf(e), action: 'assign', targets: rest } : { ...keyOf(e), action: 'unassign' };
      }),
    };
  }

  if (to.type === 'assigned') {
    if (from === 'assigned') return none;
    if (!active) return { outcome: { kind: 'needs-selection' }, changes: [] };
    return assignTo(active, { kind: add ? 'add' : 'assign', name: active });
  }

  // onto a make/model on the left
  if (from === 'pool') return assignTo(to.name, { kind: add ? 'add' : 'assign', name: to.name });
  if (active && same(active, to.name)) return none;
  if (add && entries.every((e) => e.kind === 'model')) return assignTo(to.name, { kind: 'add', name: to.name });
  return {
    outcome: { kind: 'move', name: to.name },
    changes: entries.map((e) => {
      const rest = e.kind === 'model' && active ? targetsOf(e).filter((t) => !same(t, active)) : [];
      return { ...keyOf(e), action: 'assign', targets: unique([...rest, to.name]) };
    }),
  };
}
