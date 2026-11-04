// Manual backup: pnpm backup. Safe while the server runs.
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig, repoRoot } from '../src/config.ts';
import { openDatabase } from '../src/db/client.ts';
import { createBackup, pruneBackups } from '../src/backup.ts';

dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
const config = loadConfig();
const { sqlite, close } = openDatabase(config.dataDir);
const name = await createBackup(sqlite, config.dataDir, config.backupDir);
const removed = pruneBackups(config.backupDir, config.backupKeepDays);
close();
console.log(`Backup created: ${path.join(config.backupDir, name)}`);
if (removed.length) console.log(`Removed old backups: ${removed.join(', ')}`);
