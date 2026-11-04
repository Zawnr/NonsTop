// Single-user authentication: one password (scrypt hash in .env) and cookie sessions.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { sessions } from './db/schema.ts';

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 };

/** Format: scrypt$N$r$p$<salt base64>$<hash base64> */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');
const DAY_MS = 24 * 60 * 60 * 1000;

export class SessionStore {
  constructor(
    private db: Db,
    private sessionDays: number,
    private now: () => number = Date.now,
  ) {}

  /** Returns the raw token for the cookie. Only its hash is stored. */
  create(): string {
    const token = randomBytes(32).toString('base64url');
    const t = this.now();
    this.db.insert(sessions).values({ id: tokenId(token), createdAt: t, expiresAt: t + this.sessionDays * DAY_MS }).run();
    return token;
  }

  /**
   * Valid sessions slide forward, so a device in daily use stays logged in.
   * The expiry is extended at most once a day, so read-only requests do not write to SQLite.
   * `refreshed` tells the caller to re-send the cookie with a fresh max-age.
   */
  validate(token: string | undefined): { valid: boolean; refreshed: boolean } {
    const no = { valid: false, refreshed: false };
    if (!token) return no;
    const id = tokenId(token);
    const row = this.db.select().from(sessions).where(eq(sessions.id, id)).get();
    const t = this.now();
    if (!row) return no;
    if (row.expiresAt <= t) {
      this.db.delete(sessions).where(eq(sessions.id, id)).run();
      return no;
    }
    const full = t + this.sessionDays * DAY_MS;
    if (full - row.expiresAt < DAY_MS) return { valid: true, refreshed: false };
    this.db.update(sessions).set({ expiresAt: full }).where(eq(sessions.id, id)).run();
    return { valid: true, refreshed: true };
  }

  revoke(token: string | undefined): void {
    if (token) this.db.delete(sessions).where(eq(sessions.id, tokenId(token))).run();
  }

  pruneExpired(): void {
    this.db.delete(sessions).where(lt(sessions.expiresAt, this.now())).run();
  }
}

/**
 * Global brute-force guard. One user only, so a global counter is enough:
 * after `max` failures inside `windowMs`, logins are refused until the window ends.
 */
export class LoginLimiter {
  private failures: number[] = [];

  constructor(
    private max = 10,
    private windowMs = 15 * 60 * 1000,
    private now: () => number = Date.now,
  ) {}

  private recent(): number[] {
    const since = this.now() - this.windowMs;
    this.failures = this.failures.filter((t) => t > since);
    return this.failures;
  }

  blocked(): boolean {
    return this.recent().length >= this.max;
  }

  fail(): void {
    this.failures.push(this.now());
  }

  reset(): void {
    this.failures = [];
  }
}
