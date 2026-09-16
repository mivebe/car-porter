import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LotNotFoundError } from '../services/lot-not-found.ts';
import type { MarketService } from '../services/market-service.ts';

const runBody = z.object({ refresh: z.boolean().optional() }).default({});
const selectionBody = z.object({ listingId: z.string().min(1), included: z.boolean() });

type Params = { Params: { id: string } };

export async function marketRoutes(app: FastifyInstance, opts: { market: MarketService }) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof LotNotFoundError) return reply.code(404).send({ error: 'lot_not_found' });
    return reply.send(err);
  });

  app.get<Params>('/api/lots/:id/market', async (req) => opts.market.get(req.params.id));

  app.post<Params>('/api/lots/:id/market', async (req, reply) => {
    const body = runBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    return opts.market.run(req.params.id, body.data.refresh ?? false);
  });

  app.put<Params>('/api/lots/:id/market/selection', async (req, reply) => {
    const body = selectionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    return { excludedIds: await opts.market.setIncluded(req.params.id, body.data.listingId, body.data.included) };
  });
}
