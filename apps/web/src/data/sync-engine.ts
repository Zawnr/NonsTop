// Sync engine: pushes the outbox, then pulls everything new. Runs on start, after local writes,
// when the connection returns, and on a timer while the app is visible (F-62).
import type { FieldOp, PullResponse, PushResponse } from '@nonstop/shared';
import type { LocalStore } from './store.ts';

export interface SyncTransport {
  push(ops: FieldOp[]): Promise<PushResponse>;
  pull(since: number): Promise<PullResponse>;
}

export type SyncState = 'synced' | 'pending' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Local changes not yet accepted by the server. */
  pending: number;
  lastSyncedAt: number | null;
}

export class UnauthorizedError extends Error {}

const PUSH_BATCH = 200;

export interface SyncEngineOptions {
  /** True when the error means "no connection" rather than "server refused". */
  isOffline?: (err: unknown) => boolean;
  onUnauthorized?: () => void;
  debounceMs?: number;
  intervalMs?: number;
}

export class SyncEngine {
  private status: SyncStatus = { state: 'pending', pending: 0, lastSyncedAt: null };
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private readonly store: LocalStore,
    private readonly transport: SyncTransport,
    private readonly opts: SyncEngineOptions = {},
  ) {}

  /** Starts automatic syncing. Returns a function that stops it. */
  start(): () => void {
    const debounce = this.opts.debounceMs ?? 400;
    this.cleanup.push(
      this.store.onWrite(() => {
        void this.refreshPending();
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.sync(), debounce);
      }),
    );
    const onOnline = () => void this.sync();
    const onVisible = () => document.visibilityState === 'visible' && void this.sync();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void this.sync();
    }, this.opts.intervalMs ?? 15_000);
    this.cleanup.push(
      () => window.removeEventListener('online', onOnline),
      () => document.removeEventListener('visibilitychange', onVisible),
      () => clearInterval(interval),
      () => this.timer && clearTimeout(this.timer),
    );
    void this.sync();
    return () => this.cleanup.splice(0).forEach((fn) => fn());
  }

  getStatus = (): SyncStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Runs one full push and pull. Calls during a run schedule exactly one more run afterwards. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runOnce();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async runOnce(): Promise<void> {
    try {
      await this.pushAll();
      await this.pullAll();
      const pending = await this.store.db.outbox.count();
      this.set({ state: pending ? 'pending' : 'synced', pending, lastSyncedAt: Date.now() });
    } catch (err) {
      const pending = await this.store.db.outbox.count();
      if (err instanceof UnauthorizedError) {
        this.set({ ...this.status, state: 'error', pending });
        this.opts.onUnauthorized?.();
      } else if (this.opts.isOffline?.(err) ?? false) {
        this.set({ ...this.status, state: 'offline', pending });
      } else {
        console.error('[sync]', err);
        this.set({ ...this.status, state: 'error', pending });
      }
    }
  }

  private async pushAll() {
    const outbox = this.store.db.outbox;
    for (;;) {
      const batch = await outbox.orderBy('seq').limit(PUSH_BATCH).toArray();
      if (!batch.length) return;
      const groups = coalesce(batch.map((e) => e.op));
      const sentAt = this.store.localTime();
      const res = await this.transport.push(groups.map((g) => g.op));
      await this.store.setServerTime(res.serverTime, sentAt, this.store.localTime());
      // Only the entries that were sent are removed. Writes made during the request stay queued.
      await outbox.bulkDelete(batch.map((e) => e.seq!));
      if (res.rejected.length) {
        console.warn('[sync] server rejected ops', res.rejected);
        const rejected = new Set(res.rejected);
        await this.store.revertRejected(groups.filter((g) => rejected.has(g.op.opId)).flatMap((g) => g.sources));
      }
    }
  }

  private async pullAll() {
    let since = await this.store.cursor();
    for (;;) {
      const sentAt = this.store.localTime();
      const res = await this.transport.pull(since);
      await this.store.setServerTime(res.serverTime, sentAt, this.store.localTime());
      if (await this.store.checkEpoch(res.epoch)) {
        // The server was restored from a backup: send everything back, then pull from the start.
        await this.pushAll();
        since = 0;
        continue;
      }
      await this.store.applyRemote(res.changes, res.lastSeq);
      since = res.lastSeq;
      if (!res.more) return;
    }
  }

  private async refreshPending() {
    const pending = await this.store.db.outbox.count();
    this.set({ ...this.status, pending, state: this.status.state === 'synced' ? 'pending' : this.status.state });
  }

  private set(next: SyncStatus) {
    this.status = next;
    this.listeners.forEach((l) => l());
  }
}

interface OpGroup {
  op: FieldOp;
  sources: FieldOp[];
}

/**
 * Folds queued writes to the same field into one: the last value, with the prevHlc of the first.
 * Text typed offline then reaches the server as one edit, so a lost race never shows half-typed
 * intermediate titles as "other versions".
 */
export function coalesce(ops: FieldOp[]): OpGroup[] {
  const groups = new Map<string, OpGroup>();
  for (const op of ops) {
    const key = `${op.entity}/${op.id}/${op.field}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { op, sources: [op] });
      continue;
    }
    group.sources.push(op);
    const replay = group.sources.every((o) => o.replay) ? true : undefined;
    group.op = { ...op, prevHlc: group.sources[0]!.prevHlc, replay };
  }
  return [...groups.values()];
}
