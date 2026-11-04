// Server side of sync: applies pushed field writes with last-writer-wins and serves the change log.
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, max } from 'drizzle-orm';
import {
  checkClientOp,
  entities,
  HlcClock,
  isConflictField,
  mergeField,
  parseHlc,
  type Change,
  type EntityDef,
  type FieldOp,
  type LostVersion,
  type PullResponse,
} from '@nonstop/shared';
import type { Db } from './db/client.ts';
import { changes, fieldState } from './db/schema.ts';

export const PULL_LIMIT = 1000;

export interface PushResult {
  lastSeq: number;
  /** Ops refused by validation. The client drops them, so one bad op never blocks the queue. */
  rejected: { opId: string; reason: string }[];
}

/** Entities that clients may only modify, never create (all their fields are not client-writable). */
function serverOwned(entity: string): boolean {
  const def = (entities as Record<string, EntityDef>)[entity];
  return def !== undefined && def.clientFields.length < Object.keys(def.fields).length;
}

export class SyncService {
  private readonly clock: HlcClock;

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {
    this.clock = new HlcClock('server', now);
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
        if (tx.select({ seq: changes.seq }).from(changes).where(eq(changes.opId, op.opId)).get()) continue; // resent
        if (serverOwned(op.entity) && !this.exists(tx, op.entity, op.id)) {
          rejected.push({ opId: op.opId, reason: `${op.entity} ${op.id} does not exist` });
          continue;
        }
        this.clock.receive(op.hlc);
        const current = this.field(tx, op.entity, op.id, op.field);
        const result = mergeField(current, op);
        this.record(tx, { ...op, applied: result.apply });
        if (result.lost && isConflictField(op.entity, op.field)) this.addConflict(tx, op, result.lost);
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
    return { changes: out, lastSeq: page.at(-1)?.seq ?? since, more: rows.length > limit };
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

  private record(tx: Tx, w: { opId: string; entity: string; id: string; field: string; value: unknown; hlc: string; applied: boolean }) {
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
      pageId: op.id, // pages only for now; blocks and property values will point to their page
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
