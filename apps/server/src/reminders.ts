// Deadline reminders (F-52). A date property value with `remindAt` fires a push to every device
// on its start date at that local time (the laptop's time zone). Checked every minute; each
// reminder is recorded in `reminders_sent` before it goes out, so it is sent at most once.
import { and, eq, inArray, like } from 'drizzle-orm';
import { dateValue, PROP_PREFIX } from '@nonstop/shared';
import type { Db } from './db/client.ts';
import { fieldState, remindersSent } from './db/schema.ts';
import type { PushPayload } from './push.ts';

/** A reminder missed while the laptop was off still goes out when it is at most this late. */
export const LATE_LIMIT_MS = 6 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export interface DueReminder {
  pageId: string;
  field: string;
  /** Local `YYYY-MM-DDTHH:MM`. */
  fireAt: string;
  payload: PushPayload;
}

type Sender = (payload: PushPayload) => Promise<unknown>;

/** Local time of a reminder, or null when the date does not exist (for example 31 Feb). */
export function fireTime(start: string, remindAt: string): Date | null {
  const [y, m, d] = start.split('-').map(Number);
  const [hh, mm] = remindAt.split(':').map(Number);
  const t = new Date(y!, m! - 1, d!, hh!, mm!);
  return t.getFullYear() === y && t.getMonth() === m! - 1 && t.getDate() === d ? t : null;
}

export class ReminderService {
  constructor(
    private db: Db,
    private send: Sender,
    private now: () => Date = () => new Date(),
  ) {}

  /** Fields of several entities at once: id → field → parsed value. */
  private fields(entity: string, ids: string[], names: string[]): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>();
    if (!ids.length) return out;
    const rows = this.db
      .select()
      .from(fieldState)
      .where(and(eq(fieldState.entity, entity), inArray(fieldState.entityId, ids), inArray(fieldState.field, names)))
      .all();
    for (const r of rows) {
      if (!out.has(r.entityId)) out.set(r.entityId, {});
      out.get(r.entityId)![r.field] = JSON.parse(r.value);
    }
    return out;
  }

  /** Reminders due now (within the late limit). Those already sent are skipped by `tick`. */
  due(): DueReminder[] {
    const now = this.now();
    const candidates = this.db
      .select()
      .from(fieldState)
      .where(and(eq(fieldState.entity, 'page'), like(fieldState.field, `${PROP_PREFIX}%`), like(fieldState.value, '%"remindAt":"%')))
      .all();

    const found: { pageId: string; field: string; propId: string; start: string; remindAt: string; at: Date }[] = [];
    for (const c of candidates) {
      const parsed = dateValue.safeParse(JSON.parse(c.value));
      if (!parsed.success || !parsed.data.remindAt) continue;
      const at = fireTime(parsed.data.start, parsed.data.remindAt);
      if (!at || at > now || now.getTime() - at.getTime() > LATE_LIMIT_MS) continue;
      found.push({ pageId: c.entityId, field: c.field, propId: c.field.slice(PROP_PREFIX.length), ...parsed.data, remindAt: parsed.data.remindAt, at });
    }
    if (!found.length) return [];

    const props = this.fields('property', [...new Set(found.map((f) => f.propId))], ['type', 'deleted', 'name']);
    const pages = this.pageChain(found.map((f) => f.pageId));
    const databases = this.fields(
      'database',
      [...new Set([...pages.values()].map((p) => p.databaseId).filter((d): d is string => typeof d === 'string'))],
      ['deleted'],
    );

    const live = (pageId: string): boolean => {
      const seen = new Set<string>();
      let id: string | null = pageId;
      while (id && !seen.has(id)) {
        seen.add(id);
        const p = pages.get(id);
        if (!p || p.deleted === true || p.trashedAt != null) return false;
        id = typeof p.parentId === 'string' ? p.parentId : null;
      }
      return true;
    };

    const out: DueReminder[] = [];
    for (const f of found) {
      const prop = props.get(f.propId);
      const page = pages.get(f.pageId);
      if (!prop || prop.type !== 'date' || prop.deleted === true || !page || page.isTemplate === true || !live(f.pageId)) continue;
      if (typeof page.databaseId === 'string' && databases.get(page.databaseId)?.deleted === true) continue;
      const fireAt = `${f.start}T${f.remindAt}`;
      const [y, m, d] = f.start.split('-').map(Number);
      const title = typeof page.title === 'string' && page.title.trim() ? page.title : 'Tanpa judul';
      const name = typeof prop.name === 'string' && prop.name ? prop.name : 'Tanggal';
      out.push({
        pageId: f.pageId,
        field: f.field,
        fireAt,
        payload: { title, body: `${name}: ${d} ${MONTHS[m! - 1]} ${y}, ${f.remindAt}`, url: `/p/${f.pageId}` },
      });
    }
    return out;
  }

  /** Pages and all their ancestors, for the trash and template checks. */
  private pageChain(ids: string[]): Map<string, Record<string, unknown>> {
    const names = ['title', 'parentId', 'trashedAt', 'deleted', 'isTemplate', 'databaseId'];
    const all = new Map<string, Record<string, unknown>>();
    let next = [...new Set(ids)];
    while (next.length) {
      const got = this.fields('page', next, names);
      for (const id of next) all.set(id, got.get(id) ?? { deleted: true });
      next = [...new Set([...got.values()].map((p) => p.parentId).filter((p): p is string => typeof p === 'string' && !all.has(p)))];
    }
    return all;
  }

  /** Sends what is due. Each reminder is recorded first, so an overlapping tick cannot send it twice. */
  async tick(): Promise<number> {
    let sent = 0;
    for (const r of this.due()) {
      const res = this.db
        .insert(remindersSent)
        .values({ entityId: r.pageId, field: r.field, fireAt: r.fireAt, sentAt: this.now().getTime() })
        .onConflictDoNothing()
        .run();
      if (res.changes === 0) continue;
      try {
        await this.send(r.payload);
        sent++;
      } catch (err) {
        console.error(`[reminders] send failed: ${(err as Error).message}`);
      }
    }
    return sent;
  }
}

/** Runs the reminder check every minute. Returns a function that stops it. */
export function scheduleReminders(service: ReminderService, intervalMs = 60_000): () => void {
  const run = () => void service.tick().catch((err) => console.error(`[reminders] ${(err as Error).message}`));
  run();
  const timer = setInterval(run, intervalMs);
  return () => clearInterval(timer);
}
