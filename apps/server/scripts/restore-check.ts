// Restore drill: pnpm restore-check. Takes a backup of the live data into a scratch folder,
// restores it with the normal restore code and compares both copies. The live data and the real
// backups are not changed, and the drill does not count as the daily backup. Safe while the server runs.
import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig, repoRoot } from '../src/config.ts';
import { checkRestore } from '../src/restore-check.ts';

dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
const config = loadConfig();
try {
  const result = await checkRestore(config.dataDir);
  for (const t of result.tables) {
    const live = result.liveRows[t.table];
    console.log(`  ${t.same ? 'OK  ' : 'DIFF'} ${t.table}: ${t.backupRows} in backup, ${t.restoredRows} restored${live === undefined ? '' : ` (live now: ${live})`}`);
  }
  console.log(`  ${result.files.same ? 'OK  ' : 'DIFF'} files: ${result.files.backup} in backup, ${result.files.restored} restored`);
  console.log(result.ok ? 'Restore check passed: the backup restores every row and file.' : 'Restore check FAILED.');
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  console.error(`Restore check could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
