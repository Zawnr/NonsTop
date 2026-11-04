import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeField, parseHlc, type Change, type FieldOp, type PullResponse, type PushResponse } from '@nonstop/shared';
import { NonstopDb } from './db.ts';
import { LocalStore } from './store.ts';
import { coalesce, SyncEngine, UnauthorizedError, type SyncTransport } from './sync-engine.ts';

/** In-memory server with the same merge rule as the real one. */
class FakeServer {
  state = new Map<string, { value: unknown; hlc: string }>();
  log: Change[] = [];
  online = true;
  pushes = 0;
  epoch = 'e1';
  serverTime = 1000;
  /** Fields the server refuses, to test rejection handling. */
  refuse = new Set<string>();
  received: FieldOp[] = [];

  /** Simulates a restore from an empty backup. */
  restoreEmpty() {
    this.state.clear();
    this.log = [];
    this.epoch = 'e2';
  }

  transport(): SyncTransport {
    return {
      push: async (ops: FieldOp[]): Promise<PushResponse> => {
        if (!this.online) throw new TypeError('Failed to fetch');
        this.pushes++;
        const rejected: string[] = [];
        for (const op of ops) {
          this.received.push(op);
          if (this.refuse.has(op.field)) {
            rejected.push(op.opId);
            continue;
          }
          const key = `${op.entity}/${op.id}/${op.field}`;
          const r = mergeField(this.state.get(key), op);
          if (r.apply) {
            this.state.set(key, { value: op.value, hlc: op.hlc });
            this.log.push({ seq: this.log.length + 1, entity: op.entity, id: op.id, field: op.field, value: op.value, hlc: op.hlc });
          }
        }
        return { ok: true, lastSeq: this.log.length, rejected, serverTime: this.serverTime };
      },
      pull: async (since: number): Promise<PullResponse> => {
        if (!this.online) throw new TypeError('Failed to fetch');
        const changes = this.log.slice(since, since + 2); // tiny pages to exercise paging
        return {
          changes,
          lastSeq: since + changes.length,
          more: since + changes.length < this.log.length,
          epoch: this.epoch,
          serverTime: this.serverTime,
        };
      },
    };
  }
}

const dbs: NonstopDb[] = [];
let n = 0;
async function device(server: FakeServer, wall = { ms: 1000 }) {
  const db = new NonstopDb(`test-${++n}`);
  dbs.push(db);
  const store = await LocalStore.open(db, () => wall.ms);
  const engine = new SyncEngine(store, server.transport(), { isOffline: (e) => e instanceof TypeError });
  return { db, store, engine, wall };
}

afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});

describe('LocalStore', () => {
  it('applies writes locally at once and queues one op per field', async () => {
    const { db, store } = await device(new FakeServer());
    await store.write('page', 'p1', { title: 'Hello', parentId: null });
    expect(await db.page.get('p1')).toMatchObject({ title: 'Hello', parentId: null });
    const ops = (await db.outbox.toArray()).map((e) => e.op);
    expect(ops.map((o) => o.field)).toEqual(['title', 'parentId']);
    expect(ops[0]!.prevHlc).toBeNull();
    await store.write('page', 'p1', { title: 'Hello 2' });
    const last = (await db.outbox.toArray()).at(-1)!.op;
    expect(last.prevHlc).toBe(ops[0]!.hlc);
  });

  it('keeps the same device id and a monotonic clock across restarts', async () => {
    const { db, store } = await device(new FakeServer());
    await store.write('page', 'p1', { title: 'a' });
    const again = await LocalStore.open(db, () => 0); // wall clock went backwards
    expect(again.deviceId).toBe(store.deviceId);
    await again.write('page', 'p1', { title: 'b' });
    const [first, second] = (await db.outbox.toArray()).map((e) => e.op.hlc);
    expect(second! > first!).toBe(true);
  });

  it('gives every open tab its own clock id, so tabs never issue equal timestamps', async () => {
    const { db, store } = await device(new FakeServer());
    const secondTab = await LocalStore.open(db, () => 1000);
    await store.write('page', 'p1', { title: 'tab 1' });
    await secondTab.write('page', 'p1', { title: 'tab 2' });
    const [a, b] = (await db.outbox.toArray()).map((e) => parseHlc(e.op.hlc)!);
    expect(a!.deviceId).not.toBe(b!.deviceId);
    expect(a!.deviceId.startsWith(store.deviceId)).toBe(true);
  });

  it('uses an explicit prevHlc so an edit started before a remote change is flagged as concurrent', async () => {
    const { db, store } = await device(new FakeServer());
    const [first] = Object.values(await store.write('page', 'p1', { title: 'Rapat' }));
    await store.applyRemote([{ seq: 1, entity: 'page', id: 'p1', field: 'title', value: 'Rapat Senin', hlc: '0000000009000-0000-other' }], 1);
    await store.write('page', 'p1', { title: 'Rapat!' }, { prevHlc: { title: first! } });
    expect((await db.outbox.toArray()).at(-1)!.op.prevHlc).toBe(first);
  });

  it('ignores remote changes older than the local value and unknown entities', async () => {
    const { db, store } = await device(new FakeServer(), { ms: 5000 });
    await store.write('page', 'p1', { title: 'local, newer' });
    await store.applyRemote(
      [
        { seq: 1, entity: 'page', id: 'p1', field: 'title', value: 'remote, older', hlc: '0000000001000-0000-other' },
        { seq: 2, entity: 'block', id: 'b1', field: 'type', value: 'text', hlc: '0000000001000-0001-other' },
      ],
      2,
    );
    expect((await db.page.get('p1'))?.title).toBe('local, newer');
    expect(await store.cursor()).toBe(2);
  });
});

describe('SyncEngine', () => {
  it('pushes local changes and reports synced', async () => {
    const server = new FakeServer();
    const { store, engine, db } = await device(server);
    await store.write('page', 'p1', { title: 'Hello' });
    await engine.sync();
    expect(engine.getStatus()).toMatchObject({ state: 'synced', pending: 0 });
    expect(await db.outbox.count()).toBe(0);
    expect(server.state.get('page/p1/title')?.value).toBe('Hello');
  });

  it('keeps changes while offline and sends them when the server is back', async () => {
    const server = new FakeServer();
    server.online = false;
    const { store, engine } = await device(server);
    await store.write('page', 'p1', { title: 'offline note' });
    await engine.sync();
    expect(engine.getStatus()).toMatchObject({ state: 'offline', pending: 1 });
    server.online = true;
    await engine.sync();
    expect(engine.getStatus()).toMatchObject({ state: 'synced', pending: 0 });
    expect(server.state.get('page/p1/title')?.value).toBe('offline note');
  });

  it('converges two devices with last-writer-wins per field', async () => {
    const server = new FakeServer();
    const wall = { ms: 1000 };
    const laptop = await device(server, wall);
    const phone = await device(server, wall);
    await laptop.store.write('page', 'p1', { title: 'awal', isFavorite: false });
    await laptop.engine.sync();
    await phone.engine.sync();
    expect((await phone.db.page.get('p1'))?.title).toBe('awal');

    wall.ms = 2000;
    await laptop.store.write('page', 'p1', { title: 'laptop' });
    wall.ms = 3000;
    await phone.store.write('page', 'p1', { title: 'HP' });
    await phone.store.write('page', 'p1', { isFavorite: true });
    await phone.engine.sync();
    await laptop.engine.sync();
    await phone.engine.sync();
    for (const d of [laptop, phone]) {
      expect(await d.db.page.get('p1')).toMatchObject({ title: 'HP', isFavorite: true });
    }
  });

  it('reports unauthorized and keeps the outbox', async () => {
    const server = new FakeServer();
    const { store, db } = await device(server);
    let signedOut = false;
    const engine = new SyncEngine(
      store,
      { push: () => Promise.reject(new UnauthorizedError()), pull: () => Promise.reject(new UnauthorizedError()) },
      { onUnauthorized: () => (signedOut = true) },
    );
    await store.write('page', 'p1', { title: 'x' });
    await engine.sync();
    expect(signedOut).toBe(true);
    expect(engine.getStatus().state).toBe('error');
    expect(await db.outbox.count()).toBe(1);
  });

  it('folds queued edits of one field into a single op with the first prevHlc', () => {
    const op = (opId: string, value: string, hlc: string, prevHlc: string | null): FieldOp => ({
      opId,
      entity: 'page',
      id: 'p1',
      field: 'title',
      value,
      hlc,
      prevHlc,
    });
    const groups = coalesce([
      op('1', 'Ren', '0000000001000-0000-a', '0000000000500-0000-a'),
      { ...op('2', 'x', '0000000001001-0000-a', null), field: 'isFavorite' },
      op('3', 'Rencana', '0000000001002-0000-a', '0000000001000-0000-a'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.op).toMatchObject({ opId: '3', value: 'Rencana', prevHlc: '0000000000500-0000-a' });
    expect(groups[0]!.sources.map((o) => o.opId)).toEqual(['1', '3']);
  });

  it('undoes rejected ops locally and restores the server value', async () => {
    const server = new FakeServer();
    const wall = { ms: 1000 };
    const laptop = await device(server, wall);
    const phone = await device(server, wall);
    await laptop.store.write('page', 'p1', { title: 'server value' });
    await laptop.engine.sync();
    await phone.engine.sync();
    server.refuse.add('title');
    wall.ms = 2000;
    await phone.store.write('page', 'p1', { title: 'refused' });
    await phone.engine.sync();
    expect((await phone.db.page.get('p1'))?.title).toBe('server value');
    expect(phone.engine.getStatus().state).toBe('synced');
  });

  it('removes a new page locally when the server rejects all of its fields', async () => {
    const server = new FakeServer();
    server.refuse = new Set(['title', 'parentId']);
    const { store, engine, db } = await device(server);
    await store.write('page', 'p-new', { title: 'refused', parentId: null });
    await engine.sync();
    expect(await db.page.get('p-new')).toBeUndefined();
  });

  it('sends everything back after the server was restored from a backup', async () => {
    const server = new FakeServer();
    const { store, engine } = await device(server);
    await store.write('page', 'p1', { title: 'made after the backup', parentId: null });
    await engine.sync();
    server.restoreEmpty();
    await engine.sync();
    expect(server.state.get('page/p1/title')?.value).toBe('made after the backup');
    expect(server.received.filter((o) => o.replay).map((o) => o.field).sort()).toEqual(['parentId', 'title']);
  });

  it('corrects its clock with the server time', async () => {
    const server = new FakeServer();
    server.serverTime = 1_000_000;
    const { store, engine, db } = await device(server, { ms: 1000 }); // device clock far behind
    await engine.sync();
    await store.write('page', 'p1', { title: 'x' });
    const hlc = (await db.outbox.toArray())[0]!.op.hlc;
    expect(parseHlc(hlc)!.ms).toBeGreaterThan(900_000);
  });

  it('runs once more when sync is requested during a run', async () => {
    const server = new FakeServer();
    const { store, engine } = await device(server);
    await store.write('page', 'p1', { title: 'a' });
    const first = engine.sync();
    await store.write('page', 'p1', { title: 'b' });
    void engine.sync();
    await first;
    expect(server.state.get('page/p1/title')?.value).toBe('b');
  });
});
