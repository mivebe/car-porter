import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { VehicleAliasesRepository } from '../repositories/vehicle-aliases-repository.ts';
import type { CatalogItem, CatalogService } from '../sources/nhtsa.ts';

const modelsQuery = z.object({ make: z.string().trim().min(1) });

/** Adds names the user created while assigning aliases (e.g. model "C 63 AMG") to a catalog list. */
function withUserNames(items: CatalogItem[], names: string[]): CatalogItem[] {
  const known = new Set(items.map((i) => i.name.toLowerCase()));
  const extra = names.filter((n) => !known.has(n.toLowerCase())).map((name, i) => ({ id: -(i + 1), name }));
  if (extra.length === 0) return items;
  return [...items, ...extra].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export async function catalogRoutes(
  app: FastifyInstance,
  opts: { catalog: CatalogService; aliases: VehicleAliasesRepository },
) {
  app.get('/api/catalog/makes', async (_req, reply) => {
    const result = await opts.catalog.makes();
    if (!result.ok) return reply.code(502).send({ error: result.error });
    const items = withUserNames(result.data, await opts.aliases.manualTargets('make'));
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
