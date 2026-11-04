import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LoginLimiter, SessionStore } from '../src/auth.ts';
import { openDatabase } from '../src/db/client.ts';
import { PushService } from '../src/push.ts';
import { createApp } from '../src/app.ts';
import { SyncService } from '../src/sync.ts';
import { testConfig } from './helpers.ts';

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'nonstop-dist-'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>NonsTop</title>');
afterAll(() => fs.rmSync(dist, { recursive: true, force: true }));

const config = testConfig({ webDistDir: dist });
const { db } = openDatabase(':memory:');
const app = createApp({
  config,
  sessions: new SessionStore(db, 30),
  limiter: new LoginLimiter(),
  push: new PushService(db, config, async () => undefined),
  sync: new SyncService(db),
  serveWeb: true,
});

describe('web app serving', () => {
  it('serves the app shell for page URLs', async () => {
    const res = await app.request('http://localhost/some/page');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>NonsTop</title>');
  });

  it('returns 404 for a missing asset instead of HTML', async () => {
    const res = await app.request('http://localhost/assets/index-OLDHASH.js');
    expect(res.status).toBe(404);
  });

  it('requires login for unknown API paths', async () => {
    const res = await app.request('http://localhost/api/nope');
    expect(res.status).toBe(401);
  });
});
