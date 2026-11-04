import { describe, expect, it } from 'vitest';
import { hashPassword, LoginLimiter, SessionStore, verifyPassword } from '../src/auth.ts';
import { openDatabase } from '../src/db/client.ts';
import { get, login, makeApp, PASSWORD, post } from './helpers.ts';

describe('password hashing', () => {
  it('verifies the right password and rejects others', () => {
    const h = hashPassword('secret-pass');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('secret-pass', h)).toBe(true);
    expect(verifyPassword('secret-pasS', h)).toBe(false);
    expect(verifyPassword('secret-pass', 'garbage')).toBe(false);
  });

  it('uses a random salt', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
  });
});

describe('sessions', () => {
  it('expires after the configured days, slides on use at most once a day', () => {
    const H = 3600_000;
    let t = 0;
    const { db } = openDatabase(':memory:');
    const store = new SessionStore(db, 3, () => t); // expires at 72h
    const token = store.create();
    t = 12 * H;
    expect(store.validate(token)).toEqual({ valid: true, refreshed: false }); // less than a day gained
    t = 30 * H;
    expect(store.validate(token)).toEqual({ valid: true, refreshed: true }); // now expires at 102h
    t = 101 * H;
    expect(store.validate(token).valid).toBe(true);
    t = 300 * H;
    expect(store.validate(token).valid).toBe(false);
    expect(store.validate(token).valid).toBe(false);
  });

  it('stores only a hash of the token', () => {
    const { db, sqlite } = openDatabase(':memory:');
    const token = new SessionStore(db, 30).create();
    const row = sqlite.prepare('select id from sessions').get() as { id: string };
    expect(row.id).not.toBe(token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('auth routes', () => {
  it('logs in with the right password and sets an httpOnly cookie', async () => {
    const { app } = makeApp();
    const res = await post(app, '/api/auth/login', { password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('nonstop_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure'); // plain http request, COOKIE_SECURE=auto
  });

  it('marks the cookie Secure behind an HTTPS proxy', async () => {
    const { app } = makeApp();
    const res = await app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  it('rejects a wrong password and a malformed body', async () => {
    const { app } = makeApp();
    expect((await post(app, '/api/auth/login', { password: 'nope' })).status).toBe(401);
    expect((await post(app, '/api/auth/login', { pw: 1 })).status).toBe(400);
  });

  it('counts concurrent failures before letting more through', async () => {
    const { app } = makeApp({ limiter: new LoginLimiter(3) });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post(app, '/api/auth/login', { password: 'bad' })),
    );
    expect(results.filter((r) => r.status === 401)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(7);
  });

  it('blocks logins after too many failures, even with the right password', async () => {
    const { app } = makeApp({ limiter: new LoginLimiter(3) });
    for (let i = 0; i < 3; i++) await post(app, '/api/auth/login', { password: 'bad' });
    expect((await post(app, '/api/auth/login', { password: PASSWORD })).status).toBe(429);
  });

  it('reports session state, and logout revokes it', async () => {
    const { app } = makeApp();
    expect(await (await get(app, '/api/auth/session')).json()).toEqual({ authenticated: false });
    const cookie = await login(app);
    expect(await (await get(app, '/api/auth/session', cookie)).json()).toEqual({ authenticated: true });
    await post(app, '/api/auth/logout', {}, cookie);
    expect(await (await get(app, '/api/auth/session', cookie)).json()).toEqual({ authenticated: false });
  });

  it('re-sends the cookie when the session slides forward', async () => {
    let t = 0;
    const { app } = makeApp({ now: () => t });
    const cookie = await login(app);
    t = 2 * 24 * 3600_000;
    const res = await get(app, '/api/auth/session', cookie);
    expect(await res.json()).toEqual({ authenticated: true });
    expect(res.headers.get('set-cookie')).toContain('Max-Age=2592000');
    const again = await get(app, '/api/auth/session', cookie);
    expect(again.headers.get('set-cookie')).toBeNull();
  });

  it('protects private routes', async () => {
    const { app } = makeApp();
    expect((await get(app, '/api/push/public-key')).status).toBe(401);
    const cookie = await login(app);
    expect((await get(app, '/api/push/public-key', cookie)).status).toBe(200);
  });

  it('rejects cross-site POSTs (CSRF)', async () => {
    const { app } = makeApp();
    const res = await app.request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
      body: 'password=x',
    });
    expect(res.status).toBe(403);
  });

  it('health is public', async () => {
    const { app } = makeApp();
    expect(await (await get(app, '/api/health')).json()).toMatchObject({ ok: true });
  });
});
