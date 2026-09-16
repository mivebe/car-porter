import type { FastifyInstance } from 'fastify';
import { SourceError } from '../scraping/errors.ts';
import type { FxService } from '../sources/ecb.ts';

export async function fxRoutes(app: FastifyInstance, opts: { fx: FxService }) {
  app.get<{ Querystring: { refresh?: string } }>('/api/fx', async (req, reply) => {
    try {
      return await opts.fx.get(req.query.refresh === '1');
    } catch (err) {
      if (err instanceof SourceError) {
        return reply.code(502).send({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }
  });
}
