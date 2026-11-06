import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client.ts';
import { fieldState, remindersSent } from '../src/db/schema.ts';
import { checkRestore } from '../src/restore-check.ts';

let root: string;
let dataDir: string;
let backupDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nonstop-restore-check-test-'));
  dataDir = path.join(root, 'data');
  backupDir = path.join(root, 'backups');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('restore check', () => {
  it('restores every row and file of the live data into a scratch folder, leaving the live data alone', async () => {
    const h = openDatabase(dataDir);
    for (let i = 0; i < 50; i++) {
      h.db.insert(fieldState).values({ entity: 'page', entityId: `p${i}`, field: 'title', value: JSON.stringify(`Halaman ${i}`), hlc: '0000000001000-0000-dev' }).run();
    }
    h.db.insert(remindersSent).values({ entityId: 'p1', field: 'prop.due', fireAt: '2026-11-06T09:00', sentAt: 1 }).run();
    h.close();
    fs.mkdirSync(path.join(dataDir, 'files', 'img'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'files', 'img', 'a.png'), 'png-bytes');
    const liveBefore = fs.readdirSync(dataDir).sort();

    const result = await checkRestore(dataDir);
    expect(result.ok).toBe(true);
    expect(result.tables.find((t) => t.table === 'field_state')).toEqual({ table: 'field_state', backupRows: 50, restoredRows: 50, same: true });
    expect(result.tables.find((t) => t.table === 'reminders_sent')!.restoredRows).toBe(1);
    // Every content table is checked, found from the schema; the epoch table is not.
    expect(result.tables.map((t) => t.table)).toEqual(['changes', 'field_state', 'push_subscriptions', 'reminders_sent', 'sessions']);
    expect(result.liveRows.field_state).toBe(50);
    expect(result.files).toEqual({ backup: 1, restored: 1, same: true });
    // No backup in the real backup folder, and no change in the live data folder.
    expect(fs.existsSync(backupDir)).toBe(false);
    expect(fs.readdirSync(dataDir).sort()).toEqual(liveBefore);
  });

  it('refuses to run on a data folder without a database', async () => {
    await expect(checkRestore(dataDir)).rejects.toThrow(/Database not found/);
  });
});
