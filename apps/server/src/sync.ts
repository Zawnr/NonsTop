// Server side of sync: applies pushed field writes with last-writer-wins and serves the change log.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, max } from 'drizzle-orm';
import {
  checkClientOp,
  HlcClock,
  isClientCreatable,
  isConflictField,
  mergeField,
  parseHlc,
  type Change,
  type FieldOp,
  type LostVersion,
  type PullResponse,
} from '@nonstop/shared';
import type { Db } from './db/client.ts';
import { changes, fieldState, serverMeta } from './db/schema.ts';

export const PULL_LIMIT = 1000;
/** Writes stamped further ahead than this are refused: the device clock is badly wrong. */
export const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60 * 1000;
const EPOCH_KEY = 'epoch';

/** Gives the database a new epoch. Called after a restore so devices know to resync fully. */
export function resetEpoch(db: Db): string {
  const epoch = randomUUID();
  db.insert(serverMeta).values({ key: EPOCH_KEY, value: epoch }).onConflictDoUpdate({ target: serverMeta.key, set: { value: epoch } }).run();
  return epoch;
}

function loadEpoch(db: Db): string {
  return db.select().from(serverMeta).where(eq(serverMeta.key, EPOCH_KEY)).get()?.value ?? resetEpoch(db);
}

export interface PushResult {
  lastSeq: number;
  /** Ops refused by validation. The client drops them, so one bad op never blocks the queue. */
  rejected: { opId: string; reason: string }[];
}

export class SyncService {
  private readonly clock: HlcClock;
  readonly epoch: string;

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {
    this.clock = new HlcClock('server', now);
    this.epoch = loadEpoch(db);
  }

  push(ops: FieldOp[]): PushResult {
    const rejected: PushResult['rejected'] = [];
    // One synchronous transaction: a batch is applied completely or not at all.
    this.db.transaction((tx) => {
      for (const op of ops) {
        const check = checkClientOp(op);
        if (!check.ok) {
          rejected.push({ opId: op.opId, reason: check.reason });
          continue;
        }
        if ((parseHlc(op.hlc)?.ms ?? 0) > this.now() + MAX_CLOCK_AHEAD_MS) {
          rejected.push({ opId: op.opId, reason: 'hlc too far in the future (device clock wrong)' });
          continue;
        }
        if (tx.select({ seq: changes.seq }).from(changes).where(eq(changes.opId, op.opId)).get()) continue; // resent
        if (!isClientCreatable(op.entity) && !this.exists(tx, op.entity, op.id)) {
          rejected.push({ opId: op.opId, reason: `${op.entity} ${op.id} does not exist` });
          continue;
        }
        this.clock.receive(op.hlc);
        const current = this.field(tx, op.entity, op.id, op.field);
        const result = mergeField(current, op);
        this.record(tx, { ...op, applied: result.apply });
        if (result.lost && !op.replay && isConflictField(op.entity, op.field)) this.addConflict(tx, op, result.lost);
      }
    });
    return { lastSeq: this.lastSeq(), rejected };
  }

  pull(since: number, limit = PULL_LIMIT): PullResponse {
    const rows = this.db
      .select()
      .from(changes)
      .where(and(eq(changes.applied, true), gt(changes.seq, since)))
      .orderBy(asc(changes.seq))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    const out: Change[] = page.map((r) => ({
      seq: r.seq,
      entity: r.entity,
      id: r.entityId,
      field: r.field,
      value: JSON.parse(r.value) as unknown,
      hlc: r.hlc,
    }));
    return {
      changes: out,
      lastSeq: page.at(-1)?.seq ?? since,
      more: rows.length > limit,
      epoch: this.epoch,
      serverTime: this.now(),
    };
  }

  lastSeq(): number {
    return this.db.select({ seq: max(changes.seq) }).from(changes).get()?.seq ?? 0;
  }

  private field(tx: Tx, entity: string, id: string, field: string) {
    const row = tx
      .select({ value: fieldState.value, hlc: fieldState.hlc })
      .from(fieldState)
      .where(and(eq(fieldState.entity, entity), eq(fieldState.entityId, id), eq(fieldState.field, field)))
      .get();
    return row ? { value: JSON.parse(row.value) as unknown, hlc: row.hlc } : undefined;
  }

  private exists(tx: Tx, entity: string, id: string): boolean {
    return !!tx
      .select({ hlc: fieldState.hlc })
      .from(fieldState)
      .where(and(eq(fieldState.entity, entity), eq(fieldState.entityId, id)))
      .get();
  }

  private record(
    tx: Tx,
    w: { opId: string; entity: string; id: string; field: string; value: unknown; hlc: string; applied: boolean },
  ) {
    const value = JSON.stringify(w.value);
    tx.insert(changes)
      .values({
        opId: w.opId,
        entity: w.entity,
        entityId: w.id,
        field: w.field,
        value,
        hlc: w.hlc,
        deviceId: parseHlc(w.hlc)?.deviceId ?? 'unknown',
        applied: w.applied,
        receivedAt: this.now(),
      })
      .run();
    if (!w.applied) return;
    tx.insert(fieldState)
      .values({ entity: w.entity, entityId: w.id, field: w.field, value, hlc: w.hlc })
      .onConflictDoUpdate({ target: [fieldState.entity, fieldState.entityId, fieldState.field], set: { value, hlc: w.hlc } })
      .run();
  }

  /** Stores the losing version as a conflict record. Clients sync it like any entity and show a marker. */
  private addConflict(tx: Tx, op: FieldOp, lost: LostVersion) {
    const id = randomUUID();
    const fields: Record<string, unknown> = {
      entity: op.entity,
      entityId: op.id,
      field: op.field,
      // The page the marker shows on: the page itself, or the page a block belongs to.
      pageId: op.entity === 'page' ? op.id : String(this.field(tx, op.entity, op.id, 'pageId')?.value ?? op.id),
      value: lost.value,
      hlc: lost.hlc,
      deviceId: lost.deviceId,
      createdAt: this.now(),
      resolved: false,
    };
    for (const [field, value] of Object.entries(fields)) {
      this.record(tx, { opId: randomUUID(), entity: 'conflict', id, field, value, hlc: this.clock.now(), applied: true });
    }
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
