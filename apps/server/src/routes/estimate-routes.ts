import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LotNotFoundError, type EstimateService } from '../services/estimate-service.ts';

const runBody = z.object({ refresh: z.boolean().optional() }).default({});
const selectionBody = z.object({ recordId: z.string().min(1), included: z.boolean() });

type Params = { Params: { id: string } };

export async function estimateRoutes(app: FastifyInstance, opts: { estimate: EstimateService }) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof LotNotFoundError) return reply.code(404).send({ error: 'lot_not_found' });
    return reply.send(err);
  });

  app.get<Params>('/api/lots/:id/estimate', async (req) => opts.estimate.get(req.params.id));

  app.post<Params>('/api/lots/:id/estimate', async (req, reply) => {
    const body = runBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    return opts.estimate.run(req.params.id, body.data.refresh ?? false);
  });

  app.put<Params>('/api/lots/:id/estimate/selection', async (req, reply) => {
    const body = selectionBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    return { excludedIds: await opts.estimate.setIncluded(req.params.id, body.data.recordId, body.data.included) };
  });
}
