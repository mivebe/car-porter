import { DEFAULT_IAAI_MARKETS, IAAI_MARKETS, lotInputsPatchSchema, TRANSMISSIONS } from '@car-porter/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LotInputsRepository } from '../repositories/lot-inputs-repository.ts';
import type { LotsRepository } from '../repositories/lots-repository.ts';
import type { RecentSearchesRepository } from '../repositories/recent-searches-repository.ts';
import type { TrackedLotsRepository } from '../repositories/tracked-lots-repository.ts';
import type { LotSearchService } from '../services/lot-search-service.ts';

const maxYear = () => new Date().getFullYear() + 2;

const searchQuery = z
  .object({
    make: z.string().trim().min(1),
    model: z.string().trim().min(1),
    /** both optional: a missing end is open */
    yearFrom: z.coerce.number().int().min(1900).optional(),
    yearTo: z.coerce.number().int().min(1900).optional(),
    trim: z.string().trim().max(40).optional(),
    /** comma-separated, e.g. "us,ca"; missing = US only */
    iaaiMarkets: z
      .string()
      .optional()
      .transform((v) => v?.split(',').filter(Boolean) ?? [])
      .pipe(z.array(z.enum(IAAI_MARKETS)))
      .transform((v) => (v.length ? IAAI_MARKETS.filter((m) => v.includes(m)) : DEFAULT_IAAI_MARKETS)),
    bodyStyle: z.string().trim().min(1).max(40).optional(),
    transmission: z.enum(TRANSMISSIONS as ['automatic', 'manual']).optional(),
    /** liters, e.g. "6.2" or "2" */
    engine: z
      .string()
      .trim()
      .regex(/^\d{1,2}(\.\d)?$/)
      .transform((v) => Number(v).toFixed(1))
      .optional(),
    page: z.coerce.number().int().min(1).max(100).default(1),
    refresh: z
      .enum(['0', '1', 'true', 'false'])
      .optional()
      .transform((v) => v === '1' || v === 'true'),
  })
  .refine((q) => q.yearFrom === undefined || q.yearTo === undefined || q.yearFrom <= q.yearTo, {
    message: 'yearFrom must be <= yearTo',
    path: ['yearFrom'],
  })
  .refine((q) => (q.yearTo ?? q.yearFrom ?? 0) <= maxYear(), { message: 'year is too far in the future', path: ['yearTo'] });

export async function lotsRoutes(
  app: FastifyInstance,
  opts: {
    search: LotSearchService;
    lots: LotsRepository;
    inputs: LotInputsRepository;
    tracked: TrackedLotsRepository;
    recent: RecentSearchesRepository;
  },
) {
  app.get('/api/lots/search', async (req, reply) => {
    const q = searchQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'invalid_query', issues: q.error.issues });
    const { page, refresh, ...filters } = q.data;
    if (page === 1) await opts.recent.record(filters);
    return opts.search.search(filters, page, refresh);
  });

  app.get<{ Params: { id: string } }>('/api/lots/:id', async (req, reply) => {
    const found = await opts.lots.get(req.params.id);
    if (!found) return reply.code(404).send({ error: 'not_found' });
    const tracked = await opts.tracked.get(req.params.id);
    return {
      lot: found.lot,
      fetchedAt: found.fetchedAt.toISOString(),
      trackedAt: tracked?.createdAt.toISOString() ?? null,
    };
  });

  app.get<{ Params: { id: string } }>('/api/lots/:id/inputs', async (req) => opts.inputs.get(req.params.id));

  app.patch<{ Params: { id: string } }>('/api/lots/:id/inputs', async (req, reply) => {
    const patch = lotInputsPatchSchema.safeParse(req.body ?? {});
    if (!patch.success) return reply.code(400).send({ error: 'invalid_inputs', issues: patch.error.issues });
    return opts.inputs.update(req.params.id, patch.data);
  });
}
