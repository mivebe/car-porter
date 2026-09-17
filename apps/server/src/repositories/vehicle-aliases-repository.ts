import type { AuctionSource } from '@car-porter/core';
import { and, asc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { vehicleAliases } from '../db/schema.ts';

export type AliasKind = 'make' | 'model';
export type AliasOrigin = 'auto' | 'manual';
export type AutoMatch = 'exact' | 'rule' | 'fuzzy';

export interface VehicleAlias {
  source: AuctionSource;
  kind: AliasKind;
  externalName: string;
  /** make rows: the make it maps to ('' = none); model rows: the make it was listed under */
  canonicalMake: string;
  /** model rows: the model it maps to ('' = none); '' for make rows */
  canonical: string;
  origin: AliasOrigin;
  match: AutoMatch | null;
  lotCount: number | null;
  lastSeenAt: Date;
}

export type AutoAliasInput = Pick<VehicleAlias, 'externalName' | 'canonicalMake' | 'canonical' | 'match' | 'lotCount'>;

/** Identifies one site name: models are scoped by the make they were listed under. */
export interface AliasKey {
  source: AuctionSource;
  kind: AliasKind;
  externalName: string;
  /** required for models */
  make?: string;
}

const CHUNK = 200;

export function createVehicleAliasesRepository(db: Db) {
  const keyWhere = (key: AliasKey, origin: AliasOrigin) =>
    and(
      eq(vehicleAliases.source, key.source),
      eq(vehicleAliases.kind, key.kind),
      eq(vehicleAliases.externalName, key.externalName),
      eq(vehicleAliases.origin, origin),
      key.kind === 'model' ? eq(vehicleAliases.canonicalMake, key.make ?? '') : undefined,
    );

  /** Replaces the auto rows of the given site names with freshly computed ones. */
  async function replaceAuto(scope: { source: AuctionSource; kind: AliasKind; make?: string }, rows: AutoAliasInput[]) {
    const names = [...new Set(rows.map((r) => r.externalName))];
    const now = new Date();
    for (let i = 0; i < names.length; i += CHUNK) {
      await db.delete(vehicleAliases).where(
        and(
          eq(vehicleAliases.source, scope.source),
          eq(vehicleAliases.kind, scope.kind),
          eq(vehicleAliases.origin, 'auto'),
          inArray(vehicleAliases.externalName, names.slice(i, i + CHUNK)),
          scope.kind === 'model' ? eq(vehicleAliases.canonicalMake, scope.make ?? '') : undefined,
        ),
      );
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(vehicleAliases)
        .values(rows.slice(i, i + CHUNK).map((r) => ({ ...r, source: scope.source, kind: scope.kind, origin: 'auto' as const, lastSeenAt: now })))
        .onConflictDoNothing();
    }
  }

  /** The user's assignment of a site name; `targets` empty = ignored. Replaces an earlier one. */
  async function setManual(key: AliasKey, targets: string[]) {
    const now = new Date();
    const auto = await db.select().from(vehicleAliases).where(keyWhere(key, 'auto'));
    const lotCount = auto.reduce<number | null>((max, r) => (r.lotCount == null ? max : Math.max(max ?? 0, r.lotCount)), null);
    const values = (targets.length ? [...new Set(targets)] : ['']).map((target) => ({
      source: key.source,
      kind: key.kind,
      externalName: key.externalName,
      canonicalMake: key.kind === 'make' ? target : (key.make ?? ''),
      canonical: key.kind === 'make' ? '' : target,
      origin: 'manual' as const,
      match: null,
      lotCount,
      lastSeenAt: auto[0]?.lastSeenAt ?? now,
    }));
    await db.delete(vehicleAliases).where(keyWhere(key, 'manual'));
    await db.insert(vehicleAliases).values(values);
  }

  async function clearManual(key: AliasKey) {
    await db.delete(vehicleAliases).where(keyWhere(key, 'manual'));
  }

  async function list(
    filter: { source?: AuctionSource; kind?: AliasKind; canonicalMake?: string; origin?: AliasOrigin } = {},
  ): Promise<VehicleAlias[]> {
    const where = [
      filter.source && eq(vehicleAliases.source, filter.source),
      filter.kind && eq(vehicleAliases.kind, filter.kind),
      filter.canonicalMake !== undefined && eq(vehicleAliases.canonicalMake, filter.canonicalMake),
      filter.origin && eq(vehicleAliases.origin, filter.origin),
    ].filter((w): w is SQL => !!w);
    const rows = await db
      .select()
      .from(vehicleAliases)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(vehicleAliases.kind), asc(vehicleAliases.externalName), asc(vehicleAliases.source));
    return rows as VehicleAlias[];
  }

  /** Makes / models the user assigned to that are not necessarily in the NHTSA catalog. */
  async function manualTargets(kind: AliasKind, make?: string): Promise<string[]> {
    const column = kind === 'make' ? vehicleAliases.canonicalMake : vehicleAliases.canonical;
    const rows = await db
      .selectDistinct({ name: column })
      .from(vehicleAliases)
      .where(
        and(
          eq(vehicleAliases.kind, kind),
          eq(vehicleAliases.origin, 'manual'),
          ne(column, ''),
          kind === 'model' ? eq(vehicleAliases.canonicalMake, make ?? '') : undefined,
        ),
      );
    return rows.map((r) => r.name);
  }

  return { replaceAuto, setManual, clearManual, list, manualTargets };
}

export type VehicleAliasesRepository = ReturnType<typeof createVehicleAliasesRepository>;
