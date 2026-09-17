import { AUCTION_SOURCES } from '@car-porter/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { VehicleAliasesRepository } from '../repositories/vehicle-aliases-repository.ts';
import type { CatalogService } from '../sources/nhtsa.ts';

const modelsQuery = z.object({ make: z.string().trim().min(1) });
const aliasesQuery = z.object({
  source: z.enum(AUCTION_SOURCES).optional(),
  kind: z.enum(['make', 'model']).optional(),
  /** canonical make; '' lists unmatched makes */
  make: z.string().trim().optional(),
});

export async function catalogRoutes(
  app: FastifyInstance,
  opts: { catalog: CatalogService; aliases: VehicleAliasesRepository },
) {
  app.get('/api/catalog/makes', async (_req, reply) => {
    const result = await opts.catalog.makes();
    if (!result.ok) return reply.code(502).send({ error: result.error });
    return { items: result.data, fetchedAt: result.fetchedAt.toISOString(), stale: result.stale };
  });

  app.get('/api/catalog/models', async (req, reply) => {
    const query = modelsQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'make_required' });
    const result = await opts.catalog.models(query.data.make);
    if (!result.ok) return reply.code(502).send({ error: result.error });
    return { items: result.data, fetchedAt: result.fetchedAt.toISOString(), stale: result.stale };
  });

  /** The auction-name ↔ catalog conversion table, per site. */
  app.get('/api/catalog/aliases', async (req, reply) => {
    const query = aliasesQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    const { source, kind, make } = query.data;
    const items = await opts.aliases.list({ source, kind, canonicalMake: make });
    return { items: items.map((r) => ({ ...r, lastSeenAt: r.lastSeenAt.toISOString() })) };
  });
}
