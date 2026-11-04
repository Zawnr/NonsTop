// Starts a production NonsTop server on a throwaway data dir for Playwright.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import webpush from 'web-push';
import { hashPassword } from '../src/auth.ts';

export const E2E_PASSWORD = 'e2e-password-123';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nonstop-e2e-'));
const vapid = webpush.generateVAPIDKeys();
Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT: '8798',
  DATA_DIR: path.join(dir, 'data'),
  BACKUP_DIR: path.join(dir, 'backups'),
  NONSTOP_PASSWORD_HASH: hashPassword(E2E_PASSWORD),
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
});
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
await import('../src/index.ts');
