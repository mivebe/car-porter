import type { AliasMatch, AuctionSource } from '@car-porter/core';
import { and, asc, eq, inArray, isNull, ne, or, type SQL } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { vehicleAliases } from '../db/schema.ts';

export type AliasKind = 'make' | 'model';

export interface VehicleAlias {
  source: AuctionSource;
  kind: AliasKind;
  externalName: string;
  /** '' = unmatched make */
  canonicalMake: string;
  /** '' for make rows and unmatched models */
  canonical: string;
  match: AliasMatch | null;
  lotCount: number | null;
  lastSeenAt: Date;
}

export type VehicleAliasInput = Omit<VehicleAlias, 'lastSeenAt'>;

export function createVehicleAliasesRepository(db: Db) {
  /**
   * Stores freshly computed mappings for the given external names: their previous computed rows
   * are replaced, manual overrides are left untouched. Model rows are scoped by `canonicalMake`.
   */
  async function replaceComputed(
    scope: { source: AuctionSource; kind: AliasKind; canonicalMake?: string },
    rows: VehicleAliasInput[],
  ) {
    const names = [...new Set(rows.map((r) => r.externalName))];
    const now = new Date();
    const computed = rows.filter((r) => r.match !== 'manual');
    for (let i = 0; i < names.length; i += 200) {
      const where: (SQL | undefined)[] = [
        eq(vehicleAliases.source, scope.source),
        eq(vehicleAliases.kind, scope.kind),
        inArray(vehicleAliases.externalName, names.slice(i, i + 200)),
        or(ne(vehicleAliases.match, 'manual'), isNull(vehicleAliases.match)),
      ];
      if (scope.kind === 'model') where.push(eq(vehicleAliases.canonicalMake, scope.canonicalMake ?? ''));
      await db.delete(vehicleAliases).where(and(...where));
    }
    for (let i = 0; i < computed.length; i += 200) {
      await db
        .insert(vehicleAliases)
        .values(computed.slice(i, i + 200).map((r) => ({ ...r, lastSeenAt: now })))
        .onConflictDoNothing();
    }
  }

  async function list(filter: { source?: AuctionSource; kind?: AliasKind; canonicalMake?: string } = {}): Promise<VehicleAlias[]> {
    const where = [
      filter.source && eq(vehicleAliases.source, filter.source),
      filter.kind && eq(vehicleAliases.kind, filter.kind),
      filter.canonicalMake !== undefined && eq(vehicleAliases.canonicalMake, filter.canonicalMake),
    ].filter((w): w is SQL => !!w);
    const rows = await db
      .select()
      .from(vehicleAliases)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(vehicleAliases.kind), asc(vehicleAliases.source), asc(vehicleAliases.canonical), asc(vehicleAliases.externalName));
    return rows as VehicleAlias[];
  }

  return { replaceComputed, list };
}

export type VehicleAliasesRepository = ReturnType<typeof createVehicleAliasesRepository>;
