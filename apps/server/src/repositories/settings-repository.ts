import {
  DEFAULT_SETTINGS,
  mergeSettings,
  resolveSettings,
  settingsSchema,
  type Settings,
  type SettingsPatch,
} from '@car-porter/core';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { settings } from '../db/schema.ts';

const ROW_ID = 1;

export class InvalidSettingsError extends Error {
  constructor(readonly issues: unknown) {
    super('Invalid settings');
  }
}

export function createSettingsRepository(db: Db) {
  /** Last loaded/saved value, for synchronous readers such as the scrape queue delay. */
  let current: Settings = DEFAULT_SETTINGS;

  async function get(): Promise<Settings> {
    const row = await db.query.settings.findFirst({ where: eq(settings.id, ROW_ID) });
    current = resolveSettings(row?.data);
    return current;
  }

  /** Updates run one at a time so concurrent patches (e.g. theme then language) don't overwrite each other. */
  let queue: Promise<unknown> = Promise.resolve();

  function update(patch: SettingsPatch): Promise<Settings> {
    const run = queue.then(async () => {
      const next = mergeSettings(await get(), patch);
      const parsed = settingsSchema.safeParse(next);
      if (!parsed.success) throw new InvalidSettingsError(parsed.error.issues);

      await db
        .insert(settings)
        .values({ id: ROW_ID, data: parsed.data, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: settings.id,
          set: { data: parsed.data, updatedAt: new Date() },
        });
      current = parsed.data;
      return current;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  return { get, update, cached: () => current };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
