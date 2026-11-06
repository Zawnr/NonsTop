// Restore drill (Done when, MVP 1): take a backup of the live data into a scratch folder, restore it
// with the normal restore code into another scratch folder, and compare the restored copy with the
// backup table by table and file by file. The backup is a consistent snapshot, so writes from the
// running server cannot make the comparison flaky. The live data and the real backup folder are
// never touched, so the drill is safe while the server runs and does not count as a daily backup.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DB_FILE, openDatabase } from './db/client.ts';
import { createBackup, FILES_DIR, restoreBackup } from './backup.ts';

/** Left out: a restore gives `server_meta` a new sync epoch on purpose; the rest is bookkeeping. */
const SKIPPED = new Set(['server_meta', '__drizzle_migrations']);

export interface TableCheck {
  table: string;
  backupRows: number;
  restoredRows: number;
  same: boolean;
}

export interface RestoreCheck {
  tables: TableCheck[];
  files: { backup: number; restored: number; same: boolean };
  /** Row counts of the live data right after the backup, for the report. */
  liveRows: Record<string, number>;
  ok: boolean;
}

/** Content tables of a database: every table except SQLite's own and the skipped ones. */
function contentTables(db: Database.Database): string[] {
  return (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => !SKIPPED.has(n));
}

/** Row count and a hash of every row in rowid order, streamed so large tables stay out of memory. */
function fingerprint(db: Database.Database, table: string): { rows: number; hash: string } {
  const hash = crypto.createHash('sha256');
  let rows = 0;
  for (const r of db.prepare(`select * from "${table}" order by rowid`).raw().iterate()) {
    hash.update(JSON.stringify(r)).update('\n');
    rows++;
  }
  return { rows, hash: hash.digest('hex') };
}

/** Relative path and SHA-256 of every file below `dir`. */
function fileList(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out.set(path.relative(dir, full), crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
  }
  return out;
}

const sameMap = (a: Map<string, string>, b: Map<string, string>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

export async function checkRestore(dataDir: string, now: Date = new Date()): Promise<RestoreCheck> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nonstop-restore-check-'));
  try {
    const backupDir = path.join(scratch, 'backups');
    const live = openDatabase(dataDir, { mustExist: true });
    let name: string;
    const liveRows: Record<string, number> = {};
    try {
      name = await createBackup(live.sqlite, dataDir, backupDir, now);
      for (const t of contentTables(live.sqlite)) liveRows[t] = (live.sqlite.prepare(`select count(*) n from "${t}"`).get() as { n: number }).n;
    } finally {
      live.close();
    }

    const target = path.join(scratch, 'data');
    restoreBackup(name, target, backupDir, now);
    const backup = new Database(path.join(backupDir, name, DB_FILE), { readonly: true, fileMustExist: true });
    const restored = openDatabase(target);
    let tables: TableCheck[];
    try {
      const restoredTables = new Set(contentTables(restored.sqlite));
      tables = contentTables(backup).map((t) => {
        const b = fingerprint(backup, t);
        const r = restoredTables.has(t) ? fingerprint(restored.sqlite, t) : { rows: 0, hash: 'missing' };
        return { table: t, backupRows: b.rows, restoredRows: r.rows, same: b.hash === r.hash };
      });
    } finally {
      backup.close();
      restored.close();
    }
    const backupFiles = fileList(path.join(backupDir, name, FILES_DIR));
    const restoredFiles = fileList(path.join(target, FILES_DIR));
    const files = { backup: backupFiles.size, restored: restoredFiles.size, same: sameMap(backupFiles, restoredFiles) };
    return { tables, files, liveRows, ok: tables.length > 0 && tables.every((t) => t.same) && files.same };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
