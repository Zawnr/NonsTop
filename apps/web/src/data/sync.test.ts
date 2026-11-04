import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { mergeField, type Change, type FieldOp, type PullResponse, type PushResponse } from '@nonstop/shared';
import { NonstopDb } from './db.ts';
import { LocalStore } from './store.ts';
import { SyncEngine, UnauthorizedError, type SyncTransport } from './sync-engine.ts';

/** In-memory server with the same merge rule as the real one. */
class FakeServer {
  state = new Map<string, { value: unknown; hlc: string }>();
  log: Change[] = [];
  online = true;
  pushes = 0;

  transport(): SyncTransport {
    return {
      push: async (ops: FieldOp[]): Promise<PushResponse> => {
        if (!this.online) throw new TypeError('Failed to fetch');
        this.pushes++;
        for (const op of ops) {
          const key = `${op.entity}/${op.id}/${op.field}`;
          const r = mergeField(this.state.get(key), op);
          if (r.apply) {
            this.state.set(key, { value: op.value, hlc: op.hlc });
            this.log.push({ seq: this.log.length + 1, entity: op.entity, id: op.id, field: op.field, value: op.value, hlc: op.hlc });
          }
        }
        return { ok: true, lastSeq: this.log.length, rejected: [] };
      },
      pull: async (since: number): Promise<PullResponse> => {
        if (!this.online) throw new TypeError('Failed to fetch');
        const changes = this.log.slice(since, since + 2); // tiny pages to exercise paging
        return { changes, lastSeq: since + changes.length, more: since + changes.length < this.log.length };
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
