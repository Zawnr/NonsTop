// Local store: writes go to IndexedDB immediately and into the outbox for the next push.
import { compareHlc, HlcClock, type Change, type ClockState } from '@nonstop/shared';
import type { NonstopDb, Stored } from './db.ts';

const DEVICE_KEY = 'deviceId';
const CLOCK_KEY = 'clock';
const CURSOR_KEY = 'pullCursor';

function newDeviceId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

export class LocalStore {
  private listeners = new Set<() => void>();

  private constructor(
    readonly db: NonstopDb,
    private readonly clock: HlcClock,
  ) {}

  static async open(db: NonstopDb, wallClock: () => number = Date.now): Promise<LocalStore> {
    let deviceId = (await db.meta.get(DEVICE_KEY))?.value as string | undefined;
    if (!deviceId) {
      deviceId = newDeviceId();
      await db.meta.put({ key: DEVICE_KEY, value: deviceId });
    }
    const state = (await db.meta.get(CLOCK_KEY))?.value as ClockState | undefined;
    return new LocalStore(db, new HlcClock(deviceId, wallClock, state));
  }

  get deviceId(): string {
    return this.clock.deviceId;
  }

  /** Called after every local write. The sync engine uses it to push soon. */
  onWrite(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Writes several fields of one record. Each field becomes one operation in the outbox. */
  async write(entity: string, id: string, fields: Record<string, unknown>): Promise<void> {
    await this.writeMany([{ entity, id, fields }]);
  }

  /** Writes several records in one transaction (for example a page and all its descendants). */
  async writeMany(writes: { entity: string; id: string; fields: Record<string, unknown> }[]): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [db.page, db.conflict, db.outbox, db.meta], async () => {
      for (const { entity, id, fields } of writes) {
        const table = db.entityTable(entity);
        if (!table) throw new Error(`Unknown entity ${entity}`);
        const rec: Stored<{ id: string }> = (await table.get(id)) ?? { id, _hlc: {} };
        for (const [field, value] of Object.entries(fields)) {
          const hlc = this.clock.now();
          const prevHlc = rec._hlc[field] ?? null;
          (rec as Record<string, unknown>)[field] = value;
          rec._hlc[field] = hlc;
          await db.outbox.add({ op: { opId: crypto.randomUUID(), entity, id, field, value, hlc, prevHlc } });
        }
        await table.put(rec);
      }
      await db.meta.put({ key: CLOCK_KEY, value: this.clock.state() });
    });
    this.listeners.forEach((l) => l());
  }

  /** Merges pulled changes with last-writer-wins and advances the pull cursor in the same transaction. */
  async applyRemote(changes: Change[], cursor: number): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [db.page, db.conflict, db.meta], async () => {
      for (const c of changes) {
        this.clock.receive(c.hlc);
        const table = db.entityTable(c.entity);
        if (!table) continue; // entity from a newer app version
        const rec: Stored<{ id: string }> = (await table.get(c.id)) ?? { id: c.id, _hlc: {} };
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
}
