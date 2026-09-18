import { AUCTION_SOURCES } from '@car-porter/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ScanRunningError, type AliasScanService } from '../services/alias-scan-service.ts';
import { ALIAS_STATUSES, type AliasStatus, type VehicleAliasService } from '../services/vehicle-alias-service.ts';

const kind = z.enum(['make', 'model', 'body']);
const listQuery = z.object({
  kind,
  source: z.enum(AUCTION_SOURCES).optional(),
  make: z.string().trim().optional(),
  status: z.enum(ALIAS_STATUSES as [AliasStatus, ...AliasStatus[]]).optional(),
  target: z.string().trim().min(1).optional(),
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
  .refine((k) => k.kind !== 'model' || !!k.make, { message: 'make is required for models', path: ['make'] });
const change = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), targets: z.array(z.string().trim().min(1)).max(50) }),
  z.object({ action: z.literal('ignore') }),
  z.object({ action: z.literal('unassign') }),
  z.object({ action: z.literal('reset') }),
]);
const assignmentBody = z.object({
  changes: z
    .array(z.intersection(aliasKey, change))
    .min(1)
    .max(1000)
    .refine((cs) => cs.every((c) => c.kind === 'model' || c.action !== 'assign' || c.targets.length <= 1), {
      message: 'a make or body style maps to one target',
    }),
});
const canonicalQuery = z.object({
  kind,
  make: z.string().trim().optional(),
  source: z.enum(AUCTION_SOURCES).optional(),
});
const scanBody = z.object({ make: z.string().trim().min(1).nullish() });

export async function aliasRoutes(
  app: FastifyInstance,
  opts: { aliases: VehicleAliasService; scan: AliasScanService },
) {
  app.get('/api/aliases', async (req, reply) => {
    const query = listQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    return opts.aliases.entries(query.data);
  });

  /** Makes that have site models recorded under them, with unassigned counts (for the models filter). */
  app.get('/api/aliases/makes', async (req) => {
    const source = z.enum(AUCTION_SOURCES).optional().safeParse((req.query as { source?: string }).source);
    return { items: await opts.aliases.modelMakes(source.success ? source.data : undefined) };
  });

  /** Our makes, or the models of a make, with how many site names are searched as each. */
  app.get('/api/aliases/canonical', async (req, reply) => {
    const query = canonicalQuery.safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: 'invalid_query', issues: query.error.issues });
    return { items: await opts.aliases.canonicalItems(query.data) };
  });

  app.get('/api/aliases/summary', async () => ({ unassigned: await opts.aliases.unassignedCounts() }));

  app.put('/api/aliases/assignment', async (req, reply) => {
    const body = assignmentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_assignment', issues: body.error.issues });
    await opts.aliases.assign(body.data.changes);
    return { updated: body.data.changes.length };
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
