import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isBidfaxPhotoUrl, type PhotoFetcher } from '../sources/bidfax-client.ts';

const query = z.object({ url: z.string().refine(isBidfaxPhotoUrl) });

/** Serves bidfax photos through the scraping session, since the browser can't load them directly. */
export async function photoRoutes(app: FastifyInstance, opts: { fetchPhoto: PhotoFetcher }) {
  app.get('/api/photo', async (req, reply) => {
    const parsed = query.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_url' });
    try {
      const photo = await opts.fetchPhoto(parsed.data.url);
      if (!photo) return reply.code(404).send({ error: 'not_found' });
      return reply
        .header('content-type', photo.contentType)
        .header('cache-control', 'public, max-age=2592000, immutable')
        .send(photo.body);
    } catch (err) {
      req.log.warn({ err, url: parsed.data.url }, 'photo fetch failed');
      return reply.code(502).send({ error: 'photo_unavailable' });
    }
  });
}
