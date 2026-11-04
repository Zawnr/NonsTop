// Restore: stop the server, then
//   pnpm restore            -> list backups
//   pnpm restore latest     -> restore the newest
//   pnpm restore <name>     -> restore a specific one
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig, repoRoot } from '../src/config.ts';
import { listBackups, restoreBackup, RestoreError } from '../src/backup.ts';

dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
const config = loadConfig();
const all = listBackups(config.backupDir);
const arg = process.argv[2];

if (!arg) {
  console.log(all.length ? `Backups:\n${all.map((n) => `  ${n}`).join('\n')}` : 'No backups yet.');
  console.log('\nUsage: pnpm restore latest | pnpm restore <name>');
  process.exit(0);
}

const name = arg === 'latest' ? all.at(-1) : arg;
if (!name) {
  console.error('No backups yet.');
  process.exit(1);
}
try {
  const kept = restoreBackup(name, config.dataDir, config.backupDir);
  console.log(`Restored ${name}. Previous data kept in ${kept}`);
} catch (err) {
  if (err instanceof RestoreError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
