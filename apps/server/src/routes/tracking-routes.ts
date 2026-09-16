import type { FastifyInstance } from 'fastify';
import { LotNotFoundError } from '../services/lot-not-found.ts';
import type { TrackingService } from '../services/tracking-service.ts';

type Params = { Params: { id: string } };

export async function trackingRoutes(app: FastifyInstance, opts: { tracking: TrackingService }) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof LotNotFoundError) return reply.code(404).send({ error: 'lot_not_found' });
    return reply.send(err);
  });

  app.get('/api/tracked', async () => opts.tracking.list());

  app.put<Params>('/api/tracked/:id', async (req) => opts.tracking.track(req.params.id));

  app.delete<Params>('/api/tracked/:id', async (req, reply) => {
    await opts.tracking.untrack(req.params.id);
    return reply.code(204).send();
  });
}
