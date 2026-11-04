import { describe, expect, it } from 'vitest';
import { HlcClock, mergeField, type Change, type FieldOp, type PullResponse, type PushResponse } from '@nonstop/shared';
import { get, login, makeApp, post } from './helpers.ts';

let opCounter = 0;

/**
 * Minimal device: local field values with HLCs, an outbox, and pull with the same LWW merge as the web client.
 * Lets the tests run real two-device scenarios against the HTTP API.
 */
class Device {
  clock: HlcClock;
  values = new Map<string, { value: unknown; hlc: string }>();
  outbox: FieldOp[] = [];
  since = 0;

  constructor(
    name: string,
    private wall: { ms: number },
  ) {
    this.clock = new HlcClock(name, () => this.wall.ms);
  }

  write(entity: string, id: string, field: string, value: unknown) {
    const key = `${entity}/${id}/${field}`;
    const hlc = this.clock.now();
    const prevHlc = this.values.get(key)?.hlc ?? null;
    this.values.set(key, { value, hlc });
    this.outbox.push({ opId: `op${++opCounter}`, entity, id, field, value, hlc, prevHlc });
  }

  get(entity: string, id: string, field: string) {
    return this.values.get(`${entity}/${id}/${field}`)?.value;
  }

  async sync(app: Parameters<typeof post>[0], cookie: string) {
    if (this.outbox.length) {
      const res = await post(app, '/api/sync/push', { ops: this.outbox }, cookie);
      expect(res.status).toBe(200);
      this.outbox = [];
    }
    let more = true;
    while (more) {
      const res = (await (await get(app, `/api/sync/pull?since=${this.since}`, cookie)).json()) as PullResponse;
      res.changes.forEach((c) => this.apply(c));
      this.since = res.lastSeq;
      more = res.more;
    }
  }

  private apply(c: Change) {
    const key = `${c.entity}/${c.id}/${c.field}`;
    this.clock.receive(c.hlc);
    if (mergeField(this.values.get(key), { value: c.value, hlc: c.hlc, prevHlc: null }).apply) {
      this.values.set(key, { value: c.value, hlc: c.hlc });
    }
  }

  conflicts() {
    const ids = new Set([...this.values.keys()].filter((k) => k.startsWith('conflict/')).map((k) => k.split('/')[1]!));
    return [...ids].map((id) => ({
      id,
      field: this.get('conflict', id, 'field'),
      value: this.get('conflict', id, 'value'),
      deviceId: this.get('conflict', id, 'deviceId'),
      resolved: this.get('conflict', id, 'resolved'),
    }));
  }
}

async function setup() {
  const { app, sync } = makeApp();
  const cookie = await login(app);
  const wall = { ms: 1_000_000 };
  return { app, sync, cookie, wall, laptop: new Device('laptop', wall), phone: new Device('phone', wall) };
}

describe('sync API', () => {
  it('requires a session', async () => {
    const { app } = makeApp();
    expect((await post(app, '/api/sync/push', { ops: [] })).status).toBe(401);
    expect((await get(app, '/api/sync/pull?since=0')).status).toBe(401);
  });

  it('rejects malformed requests', async () => {
    const { app, cookie } = await setup();
    expect((await post(app, '/api/sync/push', { ops: 'x' }, cookie)).status).toBe(400);
    expect((await get(app, '/api/sync/pull?since=-1', cookie)).status).toBe(400);
    expect((await get(app, '/api/sync/pull?since=abc', cookie)).status).toBe(400);
  });

  it('drops invalid ops but applies the rest of the batch', async () => {
    const { app, cookie, laptop } = await setup();
    laptop.write('page', 'p1', 'title', 'ok');
    laptop.write('page', 'p1', 'owner', 'evil');
    laptop.write('conflict', 'c1', 'value', 'forged');
    laptop.write('conflict', 'nope', 'resolved', true); // server-owned entity that does not exist
    const res = await post(app, '/api/sync/push', { ops: laptop.outbox }, cookie);
    const body = (await res.json()) as PushResponse;
    expect(body.rejected).toEqual([laptop.outbox[1]!.opId, laptop.outbox[2]!.opId, laptop.outbox[3]!.opId]);
    const pulled = (await (await get(app, '/api/sync/pull?since=0', cookie)).json()) as PullResponse;
    expect(pulled.changes.map((c) => c.value)).toEqual(['ok']);
  });

  it('rejects writes stamped more than a day ahead of server time', async () => {
    const { sync } = await setup();
    const farFuture = new HlcClock('broken', () => Date.now() + 2 * 24 * 60 * 60 * 1000).now();
    const ok = new HlcClock('fine').now();
    const result = sync.push([
      { opId: 'f1', entity: 'page', id: 'p1', field: 'title', value: 'x', hlc: farFuture, prevHlc: null },
      { opId: 'f2', entity: 'page', id: 'p2', field: 'title', value: 'y', hlc: ok, prevHlc: null },
    ]);
    expect(result.rejected.map((r) => r.opId)).toEqual(['f1']);
  });

  it('returns epoch and server time with every pull', async () => {
    const { sync } = await setup();
    const res = sync.pull(0);
    expect(res.epoch).toBe(sync.epoch);
    expect(res.serverTime).toBeGreaterThan(0);
  });

  it('is idempotent when a batch is resent', async () => {
    const { app, cookie, laptop } = await setup();
    laptop.write('page', 'p1', 'title', 'once');
    await post(app, '/api/sync/push', { ops: laptop.outbox }, cookie);
    await post(app, '/api/sync/push', { ops: laptop.outbox }, cookie);
    const pulled = (await (await get(app, '/api/sync/pull?since=0', cookie)).json()) as PullResponse;
    expect(pulled.changes).toHaveLength(1);
  });

  it('pages through large pulls', async () => {
    const { sync, laptop } = await setup();
    for (let i = 0; i < 25; i++) laptop.write('page', `p${i}`, 'title', `t${i}`);
    sync.push(laptop.outbox);
    const first = sync.pull(0, 10);
    expect(first.changes).toHaveLength(10);
    expect(first.more).toBe(true);
    const rest = sync.pull(first.lastSeq, 100);
    expect(rest.changes).toHaveLength(15);
    expect(rest.more).toBe(false);
    expect(sync.pull(rest.lastSeq).lastSeq).toBe(rest.lastSeq);
  });
});

describe('two devices', () => {
  it('a page created on the laptop appears on the phone', async () => {
    const { app, cookie, laptop, phone } = await setup();
    laptop.write('page', 'p1', 'title', 'Ide proyek');
    laptop.write('page', 'p1', 'parentId', null);
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    expect(phone.get('page', 'p1', 'title')).toBe('Ide proyek');
  });

  it('sequential edits on two devices never create a conflict', async () => {
    const { app, cookie, laptop, phone, wall } = await setup();
    laptop.write('page', 'p1', 'title', 'v1');
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    wall.ms += 1000;
    phone.write('page', 'p1', 'title', 'v2');
    await phone.sync(app, cookie);
    await laptop.sync(app, cookie);
    expect(laptop.get('page', 'p1', 'title')).toBe('v2');
    expect(laptop.conflicts()).toEqual([]);
  });

  it('concurrent offline edits: last edit wins, the other version is kept as a conflict', async () => {
    const { app, cookie, laptop, phone, wall } = await setup();
    laptop.write('page', 'p1', 'title', 'awal');
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);

    // Both offline. Laptop edits first, phone edits later.
    wall.ms += 1000;
    laptop.write('page', 'p1', 'title', 'versi laptop');
    wall.ms += 1000;
    phone.write('page', 'p1', 'title', 'versi HP');

    // The phone syncs first, then the laptop with its older edit.
    await phone.sync(app, cookie);
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);

    expect(laptop.get('page', 'p1', 'title')).toBe('versi HP');
    expect(phone.get('page', 'p1', 'title')).toBe('versi HP');
    for (const device of [laptop, phone]) {
      expect(device.conflicts()).toEqual([
        expect.objectContaining({ field: 'title', value: 'versi laptop', deviceId: 'laptop', resolved: false }),
      ]);
    }
  });

  it('keeps the overwritten version when the newer edit arrives second', async () => {
    const { app, cookie, laptop, phone, wall } = await setup();
    laptop.write('page', 'p1', 'title', 'awal');
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    wall.ms += 1000;
    laptop.write('page', 'p1', 'title', 'versi laptop');
    wall.ms += 1000;
    phone.write('page', 'p1', 'title', 'versi HP');
    await laptop.sync(app, cookie); // older edit reaches the server first and is applied
    await phone.sync(app, cookie); // newer edit overwrites it: the laptop version must be kept
    await laptop.sync(app, cookie);
    expect(laptop.get('page', 'p1', 'title')).toBe('versi HP');
    expect(laptop.conflicts()).toEqual([expect.objectContaining({ value: 'versi laptop', deviceId: 'laptop' })]);
  });

  it('edits to different fields of the same page both survive', async () => {
    const { app, cookie, laptop, phone, wall } = await setup();
    laptop.write('page', 'p1', 'title', 'a');
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    wall.ms += 1000;
    laptop.write('page', 'p1', 'title', 'judul baru');
    phone.write('page', 'p1', 'isFavorite', true);
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    await laptop.sync(app, cookie);
    for (const d of [laptop, phone]) {
      expect(d.get('page', 'p1', 'title')).toBe('judul baru');
      expect(d.get('page', 'p1', 'isFavorite')).toBe(true);
      expect(d.conflicts()).toEqual([]);
    }
  });

  it('a device with a slow clock still wins with an edit made after seeing the latest value', async () => {
    const { app, cookie, laptop, phone, wall } = await setup();
    const fastPhone = new HlcClock('phone', () => wall.ms + 3_600_000); // phone clock one hour ahead
    phone.clock = fastPhone;
    phone.write('page', 'p1', 'title', 'from phone');
    await phone.sync(app, cookie);
    await laptop.sync(app, cookie);
    laptop.write('page', 'p1', 'title', 'from laptop, later');
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    expect(phone.get('page', 'p1', 'title')).toBe('from laptop, later');
    expect(phone.conflicts()).toEqual([]);
  });

  it('replayed values (after a server restore) never create conflicts', async () => {
    const { app, cookie, laptop, phone, wall, sync } = await setup();
    laptop.write('page', 'p1', 'title', 'a');
    await laptop.sync(app, cookie);
    wall.ms += 1000;
    phone.write('page', 'p1', 'title', 'b');
    const replay = { ...phone.outbox[0]!, opId: 'replay1', prevHlc: null, replay: true };
    sync.push([replay]);
    await laptop.sync(app, cookie);
    expect(laptop.get('page', 'p1', 'title')).toBe('b');
    expect(laptop.conflicts()).toEqual([]);
  });

  it('concurrent edits of one block keep the other version, marked on the block\'s page', async () => {
    const { app, cookie, laptop, phone, wall } = await setup();
    const content = (text: string) => [{ type: 'text', text, styles: {} }];
    laptop.write('block', 'b1', 'pageId', 'p1');
    laptop.write('block', 'b1', 'content', content('awal'));
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    wall.ms += 1000;
    laptop.write('block', 'b1', 'content', content('laptop'));
    wall.ms += 1000;
    phone.write('block', 'b1', 'content', content('HP'));
    await phone.sync(app, cookie);
    await laptop.sync(app, cookie);
    expect(laptop.get('block', 'b1', 'content')).toEqual(content('HP'));
    const [conflict] = laptop.conflicts();
    expect(conflict).toMatchObject({ field: 'content', value: content('laptop') });
    expect(laptop.get('conflict', conflict!.id, 'pageId')).toBe('p1');
  });

  it('a conflict can be resolved from either device', async () => {
    const { app, cookie, laptop, phone, wall } = await setup();
    laptop.write('page', 'p1', 'title', 'a');
    phone.write('page', 'p1', 'title', 'b'); // concurrent creation with different titles
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    await laptop.sync(app, cookie);
    const [conflict] = laptop.conflicts();
    expect(conflict).toBeDefined();
    wall.ms += 1000;
    laptop.write('conflict', conflict!.id, 'resolved', true);
    await laptop.sync(app, cookie);
    await phone.sync(app, cookie);
    expect(phone.conflicts()[0]?.resolved).toBe(true);
  });
});
