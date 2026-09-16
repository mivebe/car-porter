import { lotInputsPatchSchema } from '@car-porter/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LotInputsRepository } from '../repositories/lot-inputs-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import type { LotSearchService } from '../services/lot-search-service.ts';

const maxYear = () => new Date().getFullYear() + 2;

const searchQuery = z
  .object({
    make: z.string().trim().min(1),
    model: z.string().trim().min(1),
    yearFrom: z.coerce.number().int().min(1900),
    yearTo: z.coerce.number().int().min(1900),
    page: z.coerce.number().int().min(1).max(100).default(1),
    refresh: z
      .enum(['0', '1', 'true', 'false'])
      .optional()
      .transform((v) => v === '1' || v === 'true'),
  })
  .refine((q) => q.yearFrom <= q.yearTo, { message: 'yearFrom must be <= yearTo', path: ['yearFrom'] })
  .refine((q) => q.yearTo <= maxYear(), { message: 'yearTo is too far in the future', path: ['yearTo'] });

export async function lotsRoutes(
  app: FastifyInstance,
  opts: { search: LotSearchService; lots: LotsRepository; inputs: LotInputsRepository },
) {
  app.get('/api/lots/search', async (req, reply) => {
    const q = searchQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query', issues: q.error.issues });
    const { make, model, yearFrom, yearTo, page, refresh } = q.data;
    return opts.search.search({ make, model, yearFrom, yearTo }, page, refresh);
  });

  app.get<{ Params: { id: string } }>('/api/lots/:id', async (req, reply) => {
    const found = await opts.lots.get(req.params.id);
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return { lot: found.lot, fetchedAt: found.fetchedAt.toISOString() };
  });

  app.get<{ Params: { id: string } }>('/api/lots/:id/inputs', async (req) => opts.inputs.get(req.params.id));

  app.patch<{ Params: { id: string } }>('/api/lots/:id/inputs', async (req, reply) => {
    const patch = lotInputsPatchSchema.safeParse(req.body ?? {});
    if (!patch.success) return reply.code(400).send({ error: 'invalid_inputs', issues: patch.error.issues });
    return opts.inputs.update(req.params.id, patch.data);
  });
}
