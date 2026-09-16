import type { FastifyInstance } from 'fastify';
import {
  InvalidSettingsError,
  type SettingsRepository,
} from '../repositories/settings-repository.ts';

export async function settingsRoutes(app: FastifyInstance, opts: { settings: SettingsRepository }) {
  app.get('/api/settings', async () => opts.settings.get());

  app.patch('/api/settings', async (req, reply) => {
    try {
      return await opts.settings.update(req.body ?? {});
    } catch (err) {
      if (err instanceof InvalidSettingsError) {
        return reply.code(400).send({ error: 'invalid_settings', issues: err.issues });
      }
      throw err;
    }
  });
}
