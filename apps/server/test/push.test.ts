import { describe, expect, it } from 'vitest';
import { login, makeApp, post } from './helpers.ts';

const sub = (n: number) => ({
  endpoint: `https://push.example/${n}`,
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
  deviceLabel: `device ${n}`,
});

describe('push', () => {
  it('stores subscriptions once per endpoint', async () => {
    const { app, push } = makeApp();
    const cookie = await login(app);
    expect((await post(app, '/api/push/subscribe', sub(1), cookie)).status).toBe(200);
    await post(app, '/api/push/subscribe', sub(1), cookie);
    await post(app, '/api/push/subscribe', sub(2), cookie);
    expect(push.count()).toBe(2);
  });

  it('rejects invalid subscriptions', async () => {
    const { app } = makeApp();
    const cookie = await login(app);
    expect((await post(app, '/api/push/subscribe', { endpoint: 'not-a-url' }, cookie)).status).toBe(400);
    const plainHttp = { ...sub(1), endpoint: 'http://127.0.0.1:22/' };
    expect((await post(app, '/api/push/subscribe', plainHttp, cookie)).status).toBe(400);
  });

  it('sends a test notification to every device and drops gone subscriptions', async () => {
    const payloads: string[] = [];
    const { app, push } = makeApp({
      sender: async (s, payload) => {
        if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
        payloads.push(payload);
      },
    });
    const cookie = await login(app);
    await post(app, '/api/push/subscribe', sub(1), cookie);
    await post(app, '/api/push/subscribe', sub(2), cookie);
    const res = await post(app, '/api/push/test', {}, cookie);
    expect(await res.json()).toEqual({ sent: 1, failed: 1 });
    expect(JSON.parse(payloads[0] ?? '{}')).toMatchObject({ title: 'NonsTop' });
    expect(push.count()).toBe(1);
  });
});
