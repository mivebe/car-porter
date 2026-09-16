import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CatalogService } from '../sources/nhtsa.ts';

const modelsQuery = z.object({ make: z.string().trim().min(1) });

export async function catalogRoutes(app: FastifyInstance, opts: { catalog: CatalogService }) {
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
}
