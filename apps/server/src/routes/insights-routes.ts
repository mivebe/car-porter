import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LotInsightsService } from '../services/lot-insights-service.ts';

const body = z.object({ lotIds: z.array(z.string().min(1)).max(500) });

export async function insightsRoutes(app: FastifyInstance, opts: { insights: LotInsightsService }) {
  /** Stored estimate, history, cost and verdict for a page of lots (no scraping). */
  app.post('/api/lots/insights', async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { rows, usdToEur } = await opts.insights.forLots([...new Set(parsed.data.lotIds)]);
    return { items: rows.map((r) => r.insights), usdToEur };
  });
}
