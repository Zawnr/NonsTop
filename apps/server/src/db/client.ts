// Opens the SQLite database and applies pending migrations.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export const DB_FILE = 'nonstop.db';
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  sqlite: Database.Database;
  db: Db;
  close: () => void;
}

/**
 * Pass ":memory:" for tests.
 * `mustExist`: fail instead of creating an empty DB, and skip migrations (used by the backup script,
 * so a mistyped DATA_DIR never produces an empty backup).
 */
export function openDatabase(dataDir: string | ':memory:', opts: { mustExist?: boolean } = {}): DbHandle {
  let file = ':memory:';
  if (dataDir !== ':memory:') {
    file = path.join(dataDir, DB_FILE);
    if (opts.mustExist) {
      if (!fs.existsSync(file)) throw new Error(`Database not found: ${file}`);
      const sqlite = new Database(file, { fileMustExist: true });
      return { sqlite, db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
    }
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { sqlite, db, close: () => sqlite.close() };
}
