import { AUCTION_SOURCES } from '@car-porter/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { VehicleAliasesRepository } from '../repositories/vehicle-aliases-repository.ts';
import { ScanRunningError, type AliasScanService } from '../services/alias-scan-service.ts';
import { ALIAS_STATUSES, type AliasStatus, type VehicleAliasService } from '../services/vehicle-alias-service.ts';

const kind = z.enum(['make', 'model']);
const listQuery = z.object({
  kind,
  source: z.enum(AUCTION_SOURCES).optional(),
  make: z.string().trim().optional(),
  status: z.enum(ALIAS_STATUSES as [AliasStatus, ...AliasStatus[]]).optional(),
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});
const aliasKey = z
  .object({
    source: z.enum(AUCTION_SOURCES),
    kind,
    externalName: z.string().min(1),
    make: z.string().trim().optional(),
  })
  .refine((k) => k.kind === 'make' || !!k.make, { message: 'make is required for models', path: ['make'] });
const assignmentBody = z.object({
  items: z.array(aliasKey).min(1).max(1000),
  /** [] = ignore, null = back to automatic */
  targets: z.array(z.string().trim().min(1)).max(50).nullable(),
});
const scanBody = z.object({ make: z.string().trim().min(1).nullish() });

export async function aliasRoutes(
  app: FastifyInstance,
  opts: { aliases: VehicleAliasService; repository: VehicleAliasesRepository; scan: AliasScanService },
) {
  app.get('/api/aliases', async (req, reply) => {
    const query = listQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    return opts.aliases.entries(query.data);
  });

  /** Makes that have site models recorded under them (for the models filter). */
  app.get('/api/aliases/makes', async () => {
    const rows = await opts.repository.list({ kind: 'model' });
    return { items: [...new Set(rows.map((r) => r.canonicalMake))].sort((a, b) => a.localeCompare(b)) };
  });

  app.get('/api/aliases/summary', async () => ({ unassigned: await opts.aliases.unassignedCounts() }));

  app.put('/api/aliases/assignment', async (req, reply) => {
    const body = assignmentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_assignment', issues: body.error.issues });
    const { items, targets } = body.data;
    if (targets && targets.length > 1 && items.some((i) => i.kind === 'make')) {
      return reply.code(400).send({ error: 'invalid_assignment', message: 'a make maps to one make' });
    }
    for (const item of items) await opts.aliases.assign(item, targets);
    return { updated: items.length };
  });

  app.get('/api/aliases/scan', async () => opts.scan.status());

  app.post('/api/aliases/scan', async (req, reply) => {
    const body = scanBody.safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_scan', issues: body.error.issues });
    try {
      return reply.code(202).send(opts.scan.start({ make: body.data.make }));
    } catch (err) {
      if (err instanceof ScanRunningError) return reply.code(409).send({ error: 'scan_running', status: opts.scan.status() });
      throw err;
    }
  });

  app.delete('/api/aliases/scan', async () => opts.scan.cancel());
}
