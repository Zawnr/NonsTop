// Daily backup and one-command restore (F-71).
// A backup is a folder: backups/<YYYY-MM-DD_HHmmss>/{nonstop.db, files/, manifest.json}
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { DB_FILE } from './db/client.ts';

export const FILES_DIR = 'files';
export const PID_FILE = 'server.pid';
const NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{6}$/;

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function listBackups(backupDir: string): string[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((n) => NAME_RE.test(n) && fs.existsSync(path.join(backupDir, n, DB_FILE)))
    .sort();
}

/** Uses SQLite's online backup API, so it is safe while the server is running. */
export async function createBackup(
  sqlite: Database.Database,
  dataDir: string,
  backupDir: string,
  now: Date = new Date(),
): Promise<string> {
  const name = stamp(now);
  const target = path.join(backupDir, name);
  const tmp = `${target}.partial`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  await sqlite.backup(path.join(tmp, DB_FILE));
  const files = path.join(dataDir, FILES_DIR);
  if (fs.existsSync(files)) fs.cpSync(files, path.join(tmp, FILES_DIR), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({ createdAt: now.toISOString() }, null, 2));
  // Rename last, so a crash never leaves a half-written backup that looks complete.
  fs.renameSync(tmp, target);
  return name;
}

/** Keeps the newest `keepDays` backups. Older ones are removed. */
export function pruneBackups(backupDir: string, keepDays: number): string[] {
  const all = listBackups(backupDir);
  const remove = all.slice(0, Math.max(0, all.length - keepDays));
  for (const n of remove) fs.rmSync(path.join(backupDir, n), { recursive: true, force: true });
  return remove;
}

export function isServerRunning(dataDir: string): boolean {
  const pidFile = path.join(dataDir, PID_FILE);
  if (!fs.existsSync(pidFile)) return false;
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class RestoreError extends Error {}

/**
 * Replaces the live data with a backup. Requires the server to be stopped.
 * The current data is moved to data/pre-restore-<stamp>/ first, so nothing is lost.
 * Returns the path where the previous data was kept.
 */
export function restoreBackup(name: string, dataDir: string, backupDir: string, now: Date = new Date()): string {
  if (!NAME_RE.test(name)) throw new RestoreError(`Invalid backup name: ${name}`);
  const source = path.join(backupDir, name);
  if (!fs.existsSync(path.join(source, DB_FILE))) throw new RestoreError(`Backup not found: ${name}`);
  if (isServerRunning(dataDir)) throw new RestoreError('Server is running. Stop it before restoring.');

  fs.mkdirSync(dataDir, { recursive: true });
  const keep = path.join(dataDir, `pre-restore-${stamp(now)}`);
  fs.mkdirSync(keep, { recursive: true });
  for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, FILES_DIR]) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(keep, f));
  }
  fs.copyFileSync(path.join(source, DB_FILE), path.join(dataDir, DB_FILE));
  const files = path.join(source, FILES_DIR);
  if (fs.existsSync(files)) fs.cpSync(files, path.join(dataDir, FILES_DIR), { recursive: true });
  return keep;
}

/**
 * Runs a backup once per day, at or after `hour` (local time).
 * Checks every 10 minutes, so a laptop that was asleep at that hour catches up on wake.
 */
export function scheduleDailyBackup(opts: {
  sqlite: Database.Database;
  dataDir: string;
  backupDir: string;
  hour: number;
  keepDays: number;
  now?: () => Date;
}): () => void {
  const now = opts.now ?? (() => new Date());
  let running = false;
  const tick = async () => {
    if (running) return;
    const d = now();
    const today = stamp(d).slice(0, 10);
    const doneToday = listBackups(opts.backupDir).some((n) => n.startsWith(today));
    if (doneToday || d.getHours() < opts.hour) return;
    running = true;
    try {
      const name = await createBackup(opts.sqlite, opts.dataDir, opts.backupDir, d);
      pruneBackups(opts.backupDir, opts.keepDays);
      console.log(`[backup] created ${name}`);
    } catch (err) {
      console.error('[backup] failed:', err);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 10 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
