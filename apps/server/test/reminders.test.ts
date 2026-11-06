import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/client.ts';
import { fieldState } from '../src/db/schema.ts';
import type { PushPayload } from '../src/push.ts';
import { fireTime, ReminderService } from '../src/reminders.ts';

const HLC = '0000000001000-0000-dev';

function setup(now: Date) {
  const { db } = openDatabase(':memory:');
  const sent: PushPayload[] = [];
  let clock = now;
  const service = new ReminderService(db, async (p) => void sent.push(p), () => clock);
  const put = (entity: string, entityId: string, fields: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(fields)) {
      db.insert(fieldState)
        .values({ entity, entityId, field, value: JSON.stringify(value), hlc: HLC })
        .onConflictDoUpdate({ target: [fieldState.entity, fieldState.entityId, fieldState.field], set: { value: JSON.stringify(value) } })
        .run();
    }
  };
  // A project page, a database page below it, and the date property of that database.
  put('page', 'proj', { title: 'Proyek', parentId: null, trashedAt: null, deleted: false });
  put('page', 'dbpage', { title: 'Ticket', parentId: 'proj', trashedAt: null, deleted: false });
  put('database', 'db1', { pageId: 'dbpage', deleted: false });
  put('property', 'due', { databaseId: 'db1', name: 'Deadline', type: 'date', deleted: false });
  const row = (id: string, value: unknown, extra: Record<string, unknown> = {}) =>
    put('page', id, { title: `Ticket ${id}`, parentId: 'dbpage', databaseId: 'db1', trashedAt: null, deleted: false, isTemplate: false, 'prop.due': value, ...extra });
  return { service, sent, put, row, setClock: (d: Date) => (clock = d) };
}

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 6, h, m, s);

describe('deadline reminders (F-52)', () => {
  it('reads the reminder time as local time and rejects dates that do not exist', () => {
    expect(fireTime('2026-11-06', '09:30')).toEqual(new Date(2026, 10, 6, 9, 30));
    expect(fireTime('2026-02-31', '09:30')).toBeNull();
  });

  it('sends a due reminder once, with the row title and the property name, and opens the row', async () => {
    const { service, sent, row } = setup(at(9, 0, 30));
    row('r1', { start: '2026-11-06', end: null, remindAt: '09:00' });
    expect(await service.tick()).toBe(1);
    expect(await service.tick()).toBe(0);
    expect(sent).toEqual([{ title: 'Ticket r1', body: 'Deadline: 6 Nov 2026, 09:00', url: '/p/r1' }]);
  });

  it('waits for the time, skips dates without a reminder, and drops reminders more than 6 hours late', async () => {
    const { service, sent, row, setClock } = setup(at(8, 59));
    row('soon', { start: '2026-11-06', end: null, remindAt: '09:00' });
    row('none', { start: '2026-11-06', end: null });
    row('old', { start: '2026-11-06', end: null, remindAt: '02:58' }); // 6 h 1 min late
    row('late', { start: '2026-11-06', end: null, remindAt: '03:30' }); // laptop was off, 5.5 h late
    expect(await service.tick()).toBe(1);
    setClock(at(9, 0));
    await service.tick();
    expect(sent.map((p) => p.url).sort()).toEqual(['/p/late', '/p/soon']);
  });

  it('sends again when the time changes', async () => {
    const { service, sent, row, setClock } = setup(at(9, 0));
    row('r1', { start: '2026-11-06', end: null, remindAt: '09:00' });
    await service.tick();
    row('r1', { start: '2026-11-06', end: null, remindAt: '10:00' });
    setClock(at(10, 1));
    await service.tick();
    expect(sent).toHaveLength(2);
  });

  it('skips trashed, deleted and template rows, rows below a trashed page, and deleted properties or databases', async () => {
    const { service, sent, row, put } = setup(at(9, 0));
    const v = { start: '2026-11-06', end: null, remindAt: '09:00' };
    row('trashed', v, { trashedAt: 1 });
    row('deleted', v, { deleted: true });
    row('template', v, { isTemplate: true });
    expect(await service.tick()).toBe(0);

    row('ok', v);
    put('page', 'proj', { trashedAt: 1 });
    expect(await service.tick()).toBe(0);
    put('page', 'proj', { trashedAt: null });
    put('database', 'db1', { deleted: true });
    expect(await service.tick()).toBe(0);
    put('database', 'db1', { deleted: false });
    put('property', 'due', { deleted: true });
    expect(await service.tick()).toBe(0);
    put('property', 'due', { deleted: false });
    expect(await service.tick()).toBe(1);
    expect(sent.map((p) => p.url)).toEqual(['/p/ok']);
  });

  it('records a reminder even when the push fails, so it is not retried every minute', async () => {
    const { db } = openDatabase(':memory:');
    let calls = 0;
    const service = new ReminderService(
      db,
      async () => {
        calls++;
        throw new Error('offline');
      },
      () => at(9, 0),
    );
    const put = (entity: string, id: string, field: string, value: unknown) =>
      db.insert(fieldState).values({ entity, entityId: id, field, value: JSON.stringify(value), hlc: HLC }).run();
    put('property', 'due', 'type', 'date');
    put('page', 'r1', 'title', 'X');
    put('page', 'r1', 'prop.due', { start: '2026-11-06', end: null, remindAt: '09:00' });
    expect(await service.tick()).toBe(0);
    await service.tick();
    expect(calls).toBe(1);
  });
});

describe('reminder schedule', () => {
  it('checks at start, then a second after each minute turns', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 10, 6, 9, 0, 40));
      let ticks = 0;
      const { scheduleReminders } = await import('../src/reminders.ts');
      const stop = scheduleReminders({ tick: async () => void ticks++ } as never);
      expect(ticks).toBe(1);
      await vi.advanceTimersByTimeAsync(20_000); // 09:01:00
      expect(ticks).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000); // 09:01:01
      expect(ticks).toBe(2);
      await vi.advanceTimersByTimeAsync(60_000); // 09:02:01
      expect(ticks).toBe(3);
      stop();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(ticks).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
