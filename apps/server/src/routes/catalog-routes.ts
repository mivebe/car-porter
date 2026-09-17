import { normalizeMake } from '@car-porter/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { VehicleAliasesRepository } from '../repositories/vehicle-aliases-repository.ts';
import type { VehicleAliasService } from '../services/vehicle-alias-service.ts';
import type { CatalogItem, CatalogService } from '../sources/nhtsa.ts';

const modelsQuery = z.object({ make: z.string().trim().min(1) });

/** Adds names the user created while assigning aliases (e.g. model "C 63 AMG") to a catalog list. */
function withUserNames(items: CatalogItem[], names: string[]): CatalogItem[] {
  const known = new Set(items.map((i) => i.name.toLowerCase()));
  const extra = names.filter((n) => !known.has(n.toLowerCase())).map((name, i) => ({ id: -(i + 1), name }));
  if (extra.length === 0) return items;
  return [...items, ...extra].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/**
 * NHTSA lists 406 car/MPV/truck makes, most of them replica builders, fire-engine makers and the
 * like. Once a site has been read, only the makes its lots are filed under are offered; before
 * that (and for a make nobody scanned yet) the full catalog stands. Typing a make the list doesn't
 * have still searches for it.
 */
async function withLotsOnly(items: CatalogItem[], aliasService: VehicleAliasService): Promise<CatalogItem[]> {
  const searched = new Set(
    (await aliasService.canonicalItems({ kind: 'make' })).filter((i) => i.siteNames > 0).map((i) => normalizeMake(i.name)),
  );
  if (searched.size === 0) return items;
  return items.filter((i) => searched.has(normalizeMake(i.name)));
}

export async function catalogRoutes(
  app: FastifyInstance,
  opts: { catalog: CatalogService; aliases: VehicleAliasesRepository; aliasService: VehicleAliasService },
) {
  app.get('/api/catalog/makes', async (_req, reply) => {
    const result = await opts.catalog.makes();
    if (!result.ok) return reply.code(502).send({ error: result.error });
    const items = withUserNames(await withLotsOnly(result.data, opts.aliasService), await opts.aliases.manualTargets('make'));
    return { items, fetchedAt: result.fetchedAt.toISOString(), stale: result.stale };
  });

  app.get('/api/catalog/models', async (req, reply) => {
    const query = modelsQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'make_required' });
    const result = await opts.catalog.models(query.data.make);
    const userNames = await opts.aliases.manualTargets('model', query.data.make);
    // a user-made make has no NHTSA models; its assigned names are the whole list
    if (!result.ok) {
      if (userNames.length > 0) return { items: withUserNames([], userNames), fetchedAt: new Date().toISOString(), stale: false };
      return reply.code(502).send({ error: result.error });
    }
    return { items: withUserNames(result.data, userNames), fetchedAt: result.fetchedAt.toISOString(), stale: result.stale };
  });
}
