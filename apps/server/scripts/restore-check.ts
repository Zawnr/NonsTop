// Restore drill: pnpm restore-check. Backs up the live data, restores the backup into a scratch
// folder and compares both copies. The live data is not changed. Safe while the server runs.
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig, repoRoot } from '../src/config.ts';
import { checkRestore } from '../src/restore-check.ts';

dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
const config = loadConfig();
const result = await checkRestore(config.dataDir, config.backupDir);
console.log(`Backup: ${path.join(config.backupDir, result.backup)}`);
for (const t of result.tables) console.log(`  ${t.same ? 'OK  ' : 'DIFF'} ${t.table}: ${t.liveRows} live, ${t.restoredRows} restored`);
console.log(`  ${result.files.same ? 'OK  ' : 'DIFF'} files: ${result.files.live} live, ${result.files.restored} restored`);
console.log(result.ok ? 'Restore check passed: the backup restores every row and file.' : 'Restore check FAILED.');
process.exit(result.ok ? 0 : 1);
