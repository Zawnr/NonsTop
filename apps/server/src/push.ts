// Web Push (VAPID). Used by the test notification now and by deadline reminders in sprint 5.
import webpush from 'web-push';
import { eq } from 'drizzle-orm';
import type { PushSubscriptionRequest, PushTestResult } from '@nonstop/shared';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { pushSubscriptions } from './db/schema.ts';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Abstracted so tests can replace the network call. */
export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<unknown>;

export class PushService {
  private send: PushSender;

  constructor(
    private db: Db,
    config: Pick<Config, 'vapidPublicKey' | 'vapidPrivateKey' | 'vapidSubject'>,
    sender?: PushSender,
    private now: () => number = Date.now,
  ) {
    const vapid = {
      subject: config.vapidSubject,
      publicKey: config.vapidPublicKey,
      privateKey: config.vapidPrivateKey,
    };
    this.send = sender ?? ((sub, payload) => webpush.sendNotification(sub, payload, { vapidDetails: vapid, TTL: 3600 }));
  }

  subscribe(req: PushSubscriptionRequest): void {
    const values = {
      endpoint: req.endpoint,
      p256dh: req.keys.p256dh,
      auth: req.keys.auth,
      deviceLabel: req.deviceLabel ?? null,
      createdAt: this.now(),
    };
    this.db
      .insert(pushSubscriptions)
      .values(values)
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
      .run();
  }

  count(): number {
    return this.db.select().from(pushSubscriptions).all().length;
  }

  /** Sends to every device. Subscriptions the push service reports as gone (404/410) are removed. */
  async sendToAll(payload: PushPayload): Promise<PushTestResult> {
    const subs = this.db.select().from(pushSubscriptions).all();
    const body = JSON.stringify(payload);
    let sent = 0;
    let failed = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
          sent++;
        } catch (err) {
          failed++;
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id)).run();
          } else {
            console.error(`[push] send failed (${status ?? 'network'})`);
          }
        }
      }),
    );
    return { sent, failed };
  }
}
