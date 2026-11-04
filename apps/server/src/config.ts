// Server configuration, read from environment variables (.env at the repo root).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  backupDir: string;
  webDistDir: string;
  passwordHash: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  /** "auto" sets Secure on the cookie only when the request arrived over HTTPS. */
  cookieSecure: 'auto' | 'always' | 'never';
  sessionDays: number;
  backupHour: number;
  backupKeepDays: number;
}

export class ConfigError extends Error {}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${name} must be a non-negative integer`);
  return n;
}

function resolvePath(value: string | undefined, fallback: string): string {
  return path.resolve(repoRoot, value && value !== '' ? value : fallback);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const missing = ['NONSTOP_PASSWORD_HASH', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter(
    (k) => !env[k],
  );
  if (missing.length > 0) {
    throw new ConfigError(`Missing ${missing.join(', ')}. Run "pnpm configure" first.`);
  }

  const cookieSecure = env.COOKIE_SECURE ?? 'auto';
  if (cookieSecure !== 'auto' && cookieSecure !== 'always' && cookieSecure !== 'never') {
    throw new ConfigError('COOKIE_SECURE must be auto, always or never');
  }

  const backupHour = int(env.BACKUP_HOUR, 3, 'BACKUP_HOUR');
  if (backupHour > 23) throw new ConfigError('BACKUP_HOUR must be 0-23');

  return {
    host: env.HOST || '127.0.0.1',
    port: int(env.PORT, 8787, 'PORT'),
    dataDir: resolvePath(env.DATA_DIR, 'data'),
    backupDir: resolvePath(env.BACKUP_DIR, 'backups'),
    webDistDir: resolvePath(env.WEB_DIST_DIR, 'apps/web/dist'),
    passwordHash: env.NONSTOP_PASSWORD_HASH as string,
    vapidPublicKey: env.VAPID_PUBLIC_KEY as string,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY as string,
    vapidSubject: env.VAPID_SUBJECT || 'mailto:nonstop@localhost',
    cookieSecure,
    sessionDays: int(env.SESSION_DAYS, 30, 'SESSION_DAYS'),
    backupHour,
    backupKeepDays: int(env.BACKUP_KEEP_DAYS, 14, 'BACKUP_KEEP_DAYS'),
  };
}
