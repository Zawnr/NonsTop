// HTTP routes. Built as a factory so tests can create an app with an in-memory DB.
import fs from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  loginRequest,
  pushSubscriptionRequest,
  type HealthInfo,
  type PushPublicKey,
  type SessionInfo,
} from '@nonstop/shared';
import type { Config } from './config.ts';
import { verifyPassword, type LoginLimiter, type SessionStore } from './auth.ts';
import type { PushService } from './push.ts';

export const SESSION_COOKIE = 'nonstop_session';
export const VERSION = '0.1.0';

export interface AppDeps {
  config: Config;
  sessions: SessionStore;
  limiter: LoginLimiter;
  push: PushService;
  /** Serve the built web app (production). Off in tests and in dev (Vite serves it). */
  serveWeb?: boolean;
}

function isHttps(c: Context): boolean {
  return c.req.header('x-forwarded-proto') === 'https' || new URL(c.req.url).protocol === 'https:';
}

export function createApp(deps: AppDeps): Hono {
  const { config, sessions, limiter, push } = deps;
  const app = new Hono();

  app.use('*', secureHeaders());
  app.use('/api/*', bodyLimit({ maxSize: 1024 * 1024 }));
  // Rejects cross-site form/fetch POSTs by checking the Origin header.
  app.use('/api/*', csrf());

  app.get('/api/health', (c) => c.json<HealthInfo>({ ok: true, version: VERSION }));

  app.post('/api/auth/login', async (c) => {
    if (limiter.blocked()) return c.json({ error: 'too_many_attempts' }, 429);
    const parsed = loginRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    if (!verifyPassword(parsed.data.password, config.passwordHash)) {
      limiter.fail();
      return c.json({ error: 'wrong_password' }, 401);
    }
    limiter.reset();
    const secure = config.cookieSecure === 'always' || (config.cookieSecure === 'auto' && isHttps(c));
    setCookie(c, SESSION_COOKIE, sessions.create(), {
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
      maxAge: config.sessionDays * 24 * 60 * 60,
    });
    return c.json<SessionInfo>({ authenticated: true });
  });

  app.post('/api/auth/logout', (c) => {
    sessions.revoke(getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json<SessionInfo>({ authenticated: false });
  });

  app.get('/api/auth/session', (c) =>
    c.json<SessionInfo>({ authenticated: sessions.validate(getCookie(c, SESSION_COOKIE)) }),
  );

  // Everything below needs a valid session.
  app.use('/api/*', async (c, next) => {
    if (!sessions.validate(getCookie(c, SESSION_COOKIE))) return c.json({ error: 'unauthorized' }, 401);
    await next();
  });

  app.get('/api/push/public-key', (c) => c.json<PushPublicKey>({ publicKey: config.vapidPublicKey }));

  app.post('/api/push/subscribe', async (c) => {
    const parsed = pushSubscriptionRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_request' }, 400);
    push.subscribe(parsed.data);
    return c.json({ ok: true });
  });

  app.post('/api/push/test', async (c) => {
    const result = await push.sendToAll({
      title: 'NonsTop',
      body: 'Notifikasi tes berhasil. Pengingat deadline akan muncul seperti ini.',
      url: '/',
    });
    return c.json(result);
  });

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  if (deps.serveWeb) {
    const root = path.relative(process.cwd(), config.webDistDir);
    const index = path.join(config.webDistDir, 'index.html');
    app.use('*', serveStatic({ root }));
    // SPA fallback: unknown paths load the app, which handles its own routes.
    app.get('*', (c) =>
      fs.existsSync(index) ? c.html(fs.readFileSync(index, 'utf8')) : c.text('Web app not built. Run "pnpm build".', 503),
    );
  }

  return app;
}
