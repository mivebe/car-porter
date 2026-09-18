import type { FastifyInstance } from 'fastify';
import type { RecentSearchesRepository } from '../repositories/recent-searches-repository.ts';

export async function recentSearchesRoutes(app: FastifyInstance, opts: { recent: RecentSearchesRepository }) {
  app.get('/api/searches/recent', async () => ({
    items: (await opts.recent.list()).map((s) => ({ ...s, searchedAt: s.searchedAt.toISOString() })),
  }));

  app.delete<{ Params: { key: string } }>('/api/searches/recent/:key', async (req, reply) => {
    await opts.recent.remove(req.params.key);
    return reply.code(204).send();
  });

  app.delete('/api/searches/recent', async (_req, reply) => {
    await opts.recent.clear();
    return reply.code(204).send();
  });
}
