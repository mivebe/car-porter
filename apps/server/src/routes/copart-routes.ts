import type { FastifyInstance } from 'fastify';
import { toSourceErrorInfo } from '../scraping/errors.ts';
import type { CopartLogin } from '../sources/copart.ts';

export async function copartRoutes(app: FastifyInstance, opts: { login: CopartLogin }) {
  app.get('/api/copart/login', async () => opts.login.status());

  app.post('/api/copart/login', async (_req, reply) => {
    try {
      return await opts.login.open();
    } catch (err) {
      return reply.code(502).send({ error: toSourceErrorInfo(err) });
    }
  });
}
