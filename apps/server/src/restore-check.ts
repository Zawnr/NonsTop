// Restore drill (Done when, MVP 1): back up the live data, restore that backup into a scratch
// folder with the normal restore code, and compare the two copies table by table and file by file.
// The live data is never touched, so the drill is safe while the server runs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { openDatabase } from './db/client.ts';
import { createBackup, FILES_DIR, restoreBackup } from './backup.ts';

/** Content tables. `server_meta` is left out: a restore gives it a new sync epoch on purpose. */
export const CHECKED_TABLES = ['field_state', 'changes', 'sessions', 'push_subscriptions', 'reminders_sent'] as const;

export interface TableCheck {
  table: string;
  liveRows: number;
  restoredRows: number;
  same: boolean;
}

export interface RestoreCheck {
  backup: string;
  tables: TableCheck[];
  files: { live: number; restored: number; same: boolean };
  ok: boolean;
}

interface Fingerprint {
  rows: number;
  hash: string;
}

/** Row count and a hash of every row, in a fixed order (all columns, sorted). */
function fingerprint(sqlite: Database.Database, table: string): Fingerprint {
  const cols = (sqlite.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => `"${c.name}"`);
  const rows = sqlite.prepare(`select ${cols.join(', ')} from ${table} order by ${cols.join(', ')}`).raw().all();
  const hash = crypto.createHash('sha256');
  for (const r of rows) hash.update(JSON.stringify(r)).update('\n');
  return { rows: rows.length, hash: hash.digest('hex') };
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

export async function checkRestore(dataDir: string, backupDir: string, now: Date = new Date()): Promise<RestoreCheck> {
  const live = openDatabase(dataDir, { mustExist: true });
  let name: string;
  let before: Map<string, Fingerprint>;
  try {
    // The server may write while the backup runs. Take the fingerprint on both sides of it and
    // retry when they differ, so the comparison is against the state the backup holds.
    const snap = () => new Map(CHECKED_TABLES.map((t) => [t, fingerprint(live.sqlite, t)]));
    for (let attempt = 0; ; attempt++) {
      before = snap();
      name = await createBackup(live.sqlite, dataDir, backupDir, new Date(now.getTime() + attempt * 1000));
      const after = snap();
      if (CHECKED_TABLES.every((t) => after.get(t)!.hash === before.get(t)!.hash) || attempt >= 4) break;
    }
  } finally {
    live.close();
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nonstop-restore-check-'));
  try {
    const target = path.join(scratch, 'data');
    restoreBackup(name, target, backupDir, now);
    const restored = openDatabase(target);
    let tables: TableCheck[];
    try {
      tables = CHECKED_TABLES.map((t) => {
        const r = fingerprint(restored.sqlite, t);
        const l = before.get(t)!;
        return { table: t, liveRows: l.rows, restoredRows: r.rows, same: l.hash === r.hash };
      });
    } finally {
      restored.close();
    }
    const liveFiles = fileList(path.join(dataDir, FILES_DIR));
    const restoredFiles = fileList(path.join(target, FILES_DIR));
    const files = { live: liveFiles.size, restored: restoredFiles.size, same: sameMap(liveFiles, restoredFiles) };
    return { backup: name, tables, files, ok: tables.every((t) => t.same) && files.same };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
