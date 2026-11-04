import type { Config } from '../src/config.ts';
import { hashPassword, LoginLimiter, SessionStore } from '../src/auth.ts';
import { openDatabase } from '../src/db/client.ts';
import { PushService, type PushSender } from '../src/push.ts';
import { createApp } from '../src/app.ts';
import { SyncService } from '../src/sync.ts';

export const PASSWORD = 'correct horse battery';
const passwordHash = hashPassword(PASSWORD);

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: ':memory:',
    backupDir: '/nonexistent',
    webDistDir: '/nonexistent',
    passwordHash,
    vapidPublicKey: 'test-public',
    vapidPrivateKey: 'test-private',
    vapidSubject: 'mailto:test@localhost',
    cookieSecure: 'auto',
    sessionDays: 30,
    backupHour: 3,
    backupKeepDays: 14,
    ...over,
  };
}

export function makeApp(opts: { sender?: PushSender; limiter?: LoginLimiter; now?: () => number } = {}) {
  const handle = openDatabase(':memory:');
  const config = testConfig();
  const push = new PushService(handle.db, config, opts.sender ?? (async () => undefined));
  const sync = new SyncService(handle.db, opts.now);
  const app = createApp({
    config,
    sessions: new SessionStore(handle.db, config.sessionDays, opts.now),
    limiter: opts.limiter ?? new LoginLimiter(),
    push,
    sync,
  });
  return { app, push, sync, handle };
}

const ORIGIN = 'http://localhost';

export function post(app: ReturnType<typeof makeApp>['app'], url: string, body: unknown, cookie?: string) {
  return app.request(`${ORIGIN}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

export function get(app: ReturnType<typeof makeApp>['app'], url: string, cookie?: string) {
  return app.request(`${ORIGIN}${url}`, { headers: cookie ? { cookie } : {} });
}

/** Logs in and returns the "name=value" cookie pair. */
export async function login(app: ReturnType<typeof makeApp>['app']): Promise<string> {
  const res = await post(app, '/api/auth/login', { password: PASSWORD });
  const set = res.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}
