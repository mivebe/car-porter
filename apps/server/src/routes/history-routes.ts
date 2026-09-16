import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HistoryService } from '../services/history-service.ts';
import { LotNotFoundError } from '../services/lot-not-found.ts';

const runBody = z.object({ refresh: z.boolean().optional() }).default({});

type Params = { Params: { id: string } };

export async function historyRoutes(app: FastifyInstance, opts: { history: HistoryService }) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof LotNotFoundError) return reply.code(404).send({ error: 'lot_not_found' });
    return reply.send(err);
  });

  app.get<Params>('/api/lots/:id/history', async (req) => opts.history.get(req.params.id));

  app.post<Params>('/api/lots/:id/history', async (req, reply) => {
    const body = runBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_body' });
    return opts.history.run(req.params.id, body.data.refresh ?? false);
  });
}
