// Local store: writes go to IndexedDB immediately and into the outbox for the next push.
import { compareHlc, entities, HlcClock, type Change, type ClockState, type EntityDef, type FieldOp } from '@nonstop/shared';
import type { NonstopDb, Stored } from './db.ts';

const DEVICE_KEY = 'deviceId';
const CLOCK_KEY = 'clock';
const CURSOR_KEY = 'pullCursor';
const EPOCH_KEY = 'serverEpoch';
const OFFSET_KEY = 'clockOffset';

const randomId = (length: number) => crypto.randomUUID().replace(/-/g, '').slice(0, length);

type AnyRecord = Stored<{ id: string }>;

export interface WriteOptions {
  /**
   * HLC of the value the user saw when the edit started, per field. Defaults to the stored HLC.
   * Lets the server notice that another device changed the field while the user was typing.
   */
  prevHlc?: Record<string, string | null>;
}

export class LocalStore {
  private listeners = new Set<() => void>();

  private constructor(
    readonly db: NonstopDb,
    readonly deviceId: string,
    private readonly clock: HlcClock,
    private offset: { ms: number },
    /** The device's own clock, without the server correction. */
    readonly localTime: () => number,
  ) {}

  static async open(db: NonstopDb, wallClock: () => number = Date.now): Promise<LocalStore> {
    let deviceId = (await db.meta.get(DEVICE_KEY))?.value as string | undefined;
    if (!deviceId) {
      deviceId = randomId(12);
      await db.meta.put({ key: DEVICE_KEY, value: deviceId });
    }
    const state = (await db.meta.get(CLOCK_KEY))?.value as ClockState | undefined;
    const offset = { ms: ((await db.meta.get(OFFSET_KEY))?.value as number | undefined) ?? 0 };
    // Each open tab gets its own clock id. Two tabs share one database, and without this they could
    // issue identical timestamps for different values, which the merge would treat as one write.
    const clock = new HlcClock(`${deviceId}-${randomId(4)}`, () => wallClock() + offset.ms, state);
    return new LocalStore(db, deviceId, clock, offset, wallClock);
  }

  /** Called after every local write. The sync engine uses it to push soon. */
  onWrite(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Writes several fields of one record. Each field becomes one operation. Returns the HLC per field. */
  async write(entity: string, id: string, fields: Record<string, unknown>, opts: WriteOptions = {}): Promise<Record<string, string>> {
    const [hlcs] = await this.writeMany([{ entity, id, fields, prevHlc: opts.prevHlc }]);
    return hlcs!;
  }

  /** Writes several records in one transaction (for example a page and all its descendants). */
  async writeMany(
    writes: { entity: string; id: string; fields: Record<string, unknown>; prevHlc?: Record<string, string | null> }[],
  ): Promise<Record<string, string>[]> {
    const db = this.db;
    const result: Record<string, string>[] = [];
    await db.transaction('rw', [...db.syncedTables, db.outbox, db.meta], async () => {
      for (const { entity, id, fields, prevHlc: seen } of writes) {
        const table = db.entityTable(entity);
        if (!table) throw new Error(`Unknown entity ${entity}`);
        const rec: AnyRecord = (await table.get(id)) ?? { id, _hlc: {} };
        const hlcs: Record<string, string> = {};
        for (const [field, value] of Object.entries(fields)) {
          const hlc = this.clock.now();
          const prevHlc = seen && field in seen ? (seen[field] ?? null) : (rec._hlc[field] ?? null);
          (rec as Record<string, unknown>)[field] = value;
          rec._hlc[field] = hlc;
          hlcs[field] = hlc;
          await db.outbox.add({ op: { opId: crypto.randomUUID(), entity, id, field, value, hlc, prevHlc } });
        }
        await table.put(rec);
        result.push(hlcs);
      }
      await db.meta.put({ key: CLOCK_KEY, value: this.clock.state() });
    });
    this.listeners.forEach((l) => l());
    return result;
  }

  /** Merges pulled changes with last-writer-wins and advances the pull cursor in the same transaction. */
  async applyRemote(changes: Change[], cursor: number): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [...db.syncedTables, db.meta], async () => {
      for (const c of changes) {
        this.clock.receive(c.hlc);
        const table = db.entityTable(c.entity);
        if (!table) continue; // entity from a newer app version
        const rec: AnyRecord = (await table.get(c.id)) ?? { id: c.id, _hlc: {} };
        if (compareHlc(c.hlc, rec._hlc[c.field]) <= 0) continue; // local value is newer or the same
        (rec as Record<string, unknown>)[c.field] = c.value;
        rec._hlc[c.field] = c.hlc;
        await table.put(rec);
      }
      await db.meta.put({ key: CLOCK_KEY, value: this.clock.state() });
      await db.meta.put({ key: CURSOR_KEY, value: cursor });
    });
  }

  async cursor(): Promise<number> {
    return ((await this.db.meta.get(CURSOR_KEY))?.value as number | undefined) ?? 0;
  }

  /**
   * The server refused these ops. Undo them locally where nothing newer was written since, and pull
   * everything again so the device ends up with the server's values instead of drifting apart.
   */
  async revertRejected(ops: FieldOp[]): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [...db.syncedTables, db.meta], async () => {
      for (const op of ops) {
        const table = db.entityTable(op.entity);
        const rec = await table?.get(op.id);
        if (!table || !rec || rec._hlc[op.field] !== op.hlc) continue;
        delete (rec as Record<string, unknown>)[op.field];
        delete rec._hlc[op.field];
        // A record the server never accepted any field of would linger as an empty page: remove it.
        if (Object.keys(rec._hlc).length === 0) await table.delete(rec.id);
        else await table.put(rec);
      }
      await db.meta.put({ key: CURSOR_KEY, value: 0 });
    });
  }

  /**
   * Compares the server's database epoch with the last one seen. A new epoch means the server was
   * restored from a backup and may miss recent changes: every value this device can write is queued
   * again (as a replay) and the next pull starts from the beginning. Returns true in that case.
   */
  async checkEpoch(epoch: string): Promise<boolean> {
    const db = this.db;
    return db.transaction('rw', [...db.syncedTables, db.outbox, db.meta], async () => {
      const known = (await db.meta.get(EPOCH_KEY))?.value as string | undefined;
      await db.meta.put({ key: EPOCH_KEY, value: epoch });
      if (known === undefined || known === epoch) return false;
      // Conflict records are created by the server, so they are not replayed.
      for (const entity of ['page', 'block'] as const) {
        const writable = (entities as Record<string, EntityDef>)[entity]!.clientFields;
        for (const rec of await db.entityTable(entity)!.toArray()) {
          for (const [field, hlc] of Object.entries(rec._hlc)) {
            if (!writable.includes(field)) continue;
            const value = (rec as Record<string, unknown>)[field];
            await db.outbox.add({
              op: { opId: crypto.randomUUID(), entity, id: rec.id, field, value, hlc, prevHlc: null, replay: true },
            });
          }
        }
      }
      await db.meta.put({ key: CURSOR_KEY, value: 0 });
      return true;
    });
  }

  /** Corrects the HLC wall clock with the server's time, so a wrong device clock cannot win every edit. */
  async setServerTime(serverTime: number, sentAt: number, receivedAt: number): Promise<void> {
    const offset = Math.round(serverTime - (sentAt + receivedAt) / 2);
    if (Math.abs(offset - this.offset.ms) < 1000) return; // ignore network jitter
    this.offset.ms = offset;
    await this.db.meta.put({ key: OFFSET_KEY, value: offset });
  }
}
