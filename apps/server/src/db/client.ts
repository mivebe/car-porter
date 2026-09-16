import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator';
import * as schema from './schema.ts';

export type Db = SqliteRemoteDatabase<typeof schema>;

export interface Database {
  db: Db;
  sqlite: DatabaseSync;
  close: () => void;
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens SQLite via Node's built-in `node:sqlite` (no native addon build) and exposes it to
 * Drizzle through the sqlite-proxy driver. Pass ':memory:' for tests.
 */
export async function openDatabase(file: string): Promise<Database> {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });

  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const db = drizzle(
    async (query, params, method) => {
      const stmt = sqlite.prepare(query);
      const args = params as SQLInputValue[];
      if (method === 'run') {
        stmt.run(...args);
        return { rows: [] };
      }
      stmt.setReturnArrays(true);
      if (method === 'get') {
        // Drizzle's proxy driver expects `rows: undefined` (not []) when no row matches.
        return { rows: stmt.get(...args) as unknown as unknown[] };
      }
      return { rows: stmt.all(...args) as unknown[] };
    },
    { schema },
  );

  await migrate(
    db,
    async (queries) => {
      sqlite.exec('BEGIN');
      try {
        for (const q of queries) sqlite.exec(q);
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    { migrationsFolder: MIGRATIONS_DIR },
  );

  return { db, sqlite, close: () => sqlite.close() };
}
