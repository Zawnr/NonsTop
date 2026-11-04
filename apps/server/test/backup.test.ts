import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client.ts';
import {
  createBackup,
  listBackups,
  PID_FILE,
  pruneBackups,
  restoreBackup,
  RestoreError,
} from '../src/backup.ts';

let root: string;
let dataDir: string;
let backupDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nonstop-backup-'));
  dataDir = path.join(root, 'data');
  backupDir = path.join(root, 'backups');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function countSessions(dir: string): number {
  const h = openDatabase(dir);
  const n = (h.sqlite.prepare('select count(*) n from sessions').get() as { n: number }).n;
  h.close();
  return n;
}

describe('backup and restore', () => {
  it('round-trips the database and files', async () => {
    const h = openDatabase(dataDir);
    h.sqlite.prepare("insert into sessions values ('a', 1, 2)").run();
    fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'files', 'note.txt'), 'hello');

    const name = await createBackup(h.sqlite, dataDir, backupDir, new Date(2026, 10, 4, 3, 0, 0));
    expect(name).toBe('2026-11-04_030000');
    expect(listBackups(backupDir)).toEqual([name]);

    // Damage the live data after the backup.
    h.sqlite.prepare('delete from sessions').run();
    h.close();
    fs.rmSync(path.join(dataDir, 'files'), { recursive: true });
    expect(countSessions(dataDir)).toBe(0);

    const kept = restoreBackup(name, dataDir, backupDir);
    expect(countSessions(dataDir)).toBe(1);
    expect(fs.readFileSync(path.join(dataDir, 'files', 'note.txt'), 'utf8')).toBe('hello');
    // The damaged state is kept, not deleted.
    expect(fs.existsSync(path.join(kept, 'nonstop.db'))).toBe(true);
  });

  it('refuses to restore while the server is running', async () => {
    const h = openDatabase(dataDir);
    const name = await createBackup(h.sqlite, dataDir, backupDir);
    h.close();
    fs.writeFileSync(path.join(dataDir, PID_FILE), String(process.pid)); // this process is alive
    expect(() => restoreBackup(name, dataDir, backupDir)).toThrow(RestoreError);
  });

  it('rejects unknown or malformed backup names', () => {
    expect(() => restoreBackup('../etc', dataDir, backupDir)).toThrow(RestoreError);
    expect(() => restoreBackup('2026-01-01_000000', dataDir, backupDir)).toThrow(RestoreError);
  });

  it('keeps only the newest N backups', async () => {
    const h = openDatabase(dataDir);
    for (let d = 1; d <= 5; d++) await createBackup(h.sqlite, dataDir, backupDir, new Date(2026, 10, d, 3));
    h.close();
    expect(pruneBackups(backupDir, 3)).toEqual(['2026-11-01_030000', '2026-11-02_030000']);
    expect(listBackups(backupDir)).toHaveLength(3);
  });
});
