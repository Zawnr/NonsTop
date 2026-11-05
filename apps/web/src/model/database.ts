// Pure database logic (F-10 to F-15, F-20, F-22): properties, views, rows, values and relations.
// No I/O, fully unit-tested. Rows are pages with a databaseId; their values are page fields
// named `prop.<propertyId>`.
import {
  dateValue,
  propField,
  type Database,
  type DateValue,
  type Page,
  type Property,
  type PropertyConfig,
  type PropertyType,
  type SelectOption,
  type View,
} from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { bySortKey, keyBetween, type PageIndex } from './pages.ts';

export const UNTITLED_DATABASE = 'Database tanpa judul';

export const TYPE_LABELS: Record<PropertyType, string> = {
  text: 'Teks',
  number: 'Angka',
  select: 'Select',
  multiSelect: 'Multi-select',
  status: 'Status',
  date: 'Tanggal',
  checkbox: 'Checkbox',
  url: 'URL',
  relation: 'Relation',
};

export const COLOR_LABELS: Record<SelectOption['color'], string> = {
  gray: 'Abu-abu',
  brown: 'Cokelat',
  orange: 'Oranye',
  yellow: 'Kuning',
  green: 'Hijau',
  blue: 'Biru',
  purple: 'Ungu',
  pink: 'Merah muda',
  red: 'Merah',
};

const by = <T extends { sortKey: string; id: string }>(a: T, b: T) =>
  a.sortKey !== b.sortKey ? (a.sortKey < b.sortKey ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function normalizeDatabase(rec: Stored<Database>): Database {
  return {
    id: rec.id,
    pageId: rec.pageId ?? '',
    inline: rec.inline ?? false,
    title: rec.title ?? '',
    deleted: rec.deleted ?? false,
    createdAt: rec.createdAt ?? 0,
  };
}

export function normalizeProperty(rec: Stored<Property>): Property {
  return {
    id: rec.id,
    databaseId: rec.databaseId ?? '',
    name: rec.name ?? '',
    type: rec.type ?? 'text',
    config: rec.config ?? {},
    sortKey: rec.sortKey ?? 'a0',
    hidden: rec.hidden ?? false,
    deleted: rec.deleted ?? false,
  };
}

export function normalizeView(rec: Stored<View>): View {
  return {
    id: rec.id,
    databaseId: rec.databaseId ?? '',
    name: rec.name ?? '',
    type: rec.type ?? 'table',
    sortKey: rec.sortKey ?? 'a0',
    deleted: rec.deleted ?? false,
  };
}

/** A row: a page plus its raw stored values. */
export type Row = Page & { values: Record<string, unknown> };

export interface DatabaseIndex {
  byId: Map<string, Database>;
  /** The full-page database of a page, if the page is one. */
  fullPageOf: (pageId: string) => Database | undefined;
  /** Live properties in display order, hidden ones included. */
  propertiesOf: (databaseId: string) => Property[];
  property: (id: string) => Property | undefined;
  viewsOf: (databaseId: string) => View[];
  /**
   * Rows in display order, without trashed ones. `inTrash` is for a database whose owner page is in
   * the trash: it then lists the rows that are not trashed themselves, so the contents stay visible.
   */
  rowsOf: (databaseId: string, inTrash?: boolean) => Row[];
  /** Any live row by id, trashed ones included (a trashed row page still shows its values). */
  row: (id: string) => Row | undefined;
  /** Rows whose forward relation property `propertyId` contains `rowId`. Built once per index. */
  linking: (propertyId: string, rowId: string) => Row[];
  /** A page is a row of a database that no longer exists (deleted inline database). */
  isOrphanRow: (pageId: string) => boolean;
}

/**
 * Indexes databases, properties, views and rows. `pageRecords` are the stored pages, so rows carry
 * their property values (which the normalized page index drops).
 */
export function indexDatabases(
  databases: Database[],
  properties: Property[],
  views: View[],
  pages: PageIndex,
  pageRecords: Stored<Page>[],
): DatabaseIndex {
  const byId = new Map(databases.filter((d) => !d.deleted && d.pageId && pages.byId.has(d.pageId)).map((d) => [d.id, d]));
  const fullPage = new Map<string, Database>();
  for (const d of byId.values()) {
    if (d.inline) continue;
    const prev = fullPage.get(d.pageId);
    // Two devices could turn the same page into a database offline: the oldest one wins everywhere.
    if (!prev || d.createdAt < prev.createdAt || (d.createdAt === prev.createdAt && d.id < prev.id)) fullPage.set(d.pageId, d);
  }

  const group = <T extends { databaseId: string; deleted: boolean; sortKey: string; id: string }>(list: T[]) => {
    const out = new Map<string, T[]>();
    for (const item of list) {
      if (item.deleted || !byId.has(item.databaseId)) continue;
      if (!out.has(item.databaseId)) out.set(item.databaseId, []);
      out.get(item.databaseId)!.push(item);
    }
    for (const l of out.values()) l.sort(by);
    return out;
  };
  const props = group(properties);
  const propById = new Map([...props.values()].flat().map((p) => [p.id, p]));
  const viewsBy = group(views);

  const records = new Map(pageRecords.map((r) => [r.id, r]));
  const rows = new Map<string, Row[]>();
  const ownLive = new Map<string, Row[]>();
  const rowById = new Map<string, Row>();
  const orphans = new Set<string>();
  const push = (map: Map<string, Row[]>, key: string, row: Row) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  };
  for (const p of pages.byId.values()) {
    if (!p.databaseId) continue;
    if (!byId.has(p.databaseId)) {
      orphans.add(p.id);
      continue;
    }
    const row: Row = { ...p, values: (records.get(p.id) ?? {}) as Record<string, unknown> };
    rowById.set(p.id, row);
    if (p.trashedAt === null) push(ownLive, p.databaseId, row);
    if (!pages.isTrashed(p.id)) push(rows, p.databaseId, row);
  }
  for (const l of [...rows.values(), ...ownLive.values()]) l.sort(bySortKey);

  // Reverse relation lookups, built on first use per forward property.
  const linkCache = new Map<string, Map<string, Row[]>>();
  const linking = (propertyId: string, rowId: string): Row[] => {
    let map = linkCache.get(propertyId);
    if (!map) {
      map = new Map();
      const prop = propById.get(propertyId);
      const field = propField(propertyId);
      for (const r of prop ? (rows.get(prop.databaseId) ?? []) : []) {
        for (const id of new Set(storedIds(r.values[field]))) push(map, id, r);
      }
      linkCache.set(propertyId, map);
    }
    return map.get(rowId) ?? [];
  };

  return {
    byId,
    fullPageOf: (pageId) => fullPage.get(pageId),
    propertiesOf: (id) => props.get(id) ?? [],
    property: (id) => propById.get(id),
    viewsOf: (id) => viewsBy.get(id) ?? [],
    rowsOf: (id, inTrash) => (inTrash ? ownLive : rows).get(id) ?? [],
    row: (id) => rowById.get(id),
    linking,
    isOrphanRow: (id) => orphans.has(id),
  };
}

/** Sort key after the last item of a list. */
export const keyAfter = (items: { sortKey: string }[]) => keyBetween(items.at(-1)?.sortKey ?? null, null);

/** Default settings for a new property. Status starts with three options, one per group. */
export function defaultConfig(type: PropertyType, newId: () => string): PropertyConfig {
  if (type === 'status') {
    return {
      options: [
        { id: newId(), name: 'Belum mulai', color: 'gray', group: 'todo' },
        { id: newId(), name: 'Dikerjakan', color: 'blue', group: 'doing' },
        { id: newId(), name: 'Selesai', color: 'green', group: 'done' },
      ],
    };
  }
  if (type === 'select' || type === 'multiSelect') return { options: [] };
  return {};
}

/** Typed value of a cell. Values of the wrong shape (for example after a type change) read as empty. */
export type CellValue =
  | { type: 'text' | 'url'; value: string }
  | { type: 'number'; value: number | null }
  | { type: 'select' | 'status'; value: SelectOption | null }
  | { type: 'multiSelect'; value: SelectOption[] }
  | { type: 'date'; value: DateValue | null }
  | { type: 'checkbox'; value: boolean }
  | { type: 'relation'; value: Row[] };

const options = (p: Property) => p.config.options ?? [];

/** Ids stored in a multi-select or relation value. */
export function storedIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

export function cellValue(db: DatabaseIndex, prop: Property, row: Row): CellValue {
  const raw = row.values[propField(prop.id)];
  switch (prop.type) {
    case 'text':
    case 'url':
      return { type: prop.type, value: typeof raw === 'string' ? raw : '' };
    case 'number':
      return { type: 'number', value: typeof raw === 'number' && Number.isFinite(raw) ? raw : null };
    case 'select':
    case 'status':
      return { type: prop.type, value: options(prop).find((o) => o.id === raw) ?? null };
    case 'multiSelect': {
      const ids = new Set(storedIds(raw));
      return { type: 'multiSelect', value: options(prop).filter((o) => ids.has(o.id)) };
    }
    case 'date': {
      const parsed = dateValue.safeParse(raw);
      return { type: 'date', value: parsed.success ? parsed.data : null };
    }
    case 'checkbox':
      return { type: 'checkbox', value: raw === true };
    case 'relation':
      return { type: 'relation', value: relatedRows(db, prop, row) };
  }
}

/**
 * Rows linked through a relation property. The forward side stores the ids. The reverse side is
 * computed: rows of the other database whose forward value contains this row (F-15).
 */
export function relatedRows(db: DatabaseIndex, prop: Property, row: Row): Row[] {
  const target = prop.config.databaseId;
  if (!target) return [];
  if (prop.config.reverse) {
    const pair = prop.config.pairId ? db.property(prop.config.pairId) : undefined;
    if (!pair || pair.databaseId !== target) return [];
    return db.linking(pair.id, row.id);
  }
  const visible = new Set(db.rowsOf(target).map((r) => r.id));
  return storedIds(row.values[propField(prop.id)])
    .filter((id) => visible.has(id))
    .map((id) => db.row(id)!);
}

export interface ValueWrite {
  rowId: string;
  field: string;
  value: unknown;
}

/**
 * Writes that link or unlink `otherId` from `row` through a relation property. On the reverse side
 * the value lives on the other row, so that row's forward value is changed instead.
 */
export function relationWrites(db: DatabaseIndex, prop: Property, row: Row, otherId: string, linked: boolean): ValueWrite[] {
  const toggle = (ids: string[], id: string) => (linked ? (ids.includes(id) ? ids : [...ids, id]) : ids.filter((x) => x !== id));
  if (prop.config.reverse) {
    const pair = prop.config.pairId ? db.property(prop.config.pairId) : undefined;
    const other = db.row(otherId);
    if (!pair || !other) return [];
    const field = propField(pair.id);
    const before = storedIds(other.values[field]);
    const after = toggle(before, row.id);
    return after.length === before.length ? [] : [{ rowId: other.id, field, value: after }];
  }
  const field = propField(prop.id);
  const before = storedIds(row.values[field]);
  const after = toggle(before, otherId);
  return after.length === before.length ? [] : [{ rowId: row.id, field, value: after }];
}

/** Plain text of a cell, for the list view and tooltips. */
export function cellText(cell: CellValue): string {
  switch (cell.type) {
    case 'text':
    case 'url':
      return cell.value;
    case 'number':
      return cell.value === null ? '' : formatNumber(cell.value);
    case 'select':
    case 'status':
      return cell.value?.name ?? '';
    case 'multiSelect':
      return cell.value.map((o) => o.name).join(', ');
    case 'date':
      return cell.value ? formatDateRange(cell.value) : '';
    case 'checkbox':
      return cell.value ? '✓' : '';
    case 'relation':
      return cell.value.map((r) => r.title || 'Tanpa judul').join(', ');
  }
}

export const isEmpty = (cell: CellValue) =>
  cell.type === 'checkbox' ? !cell.value : Array.isArray(cell.value) ? cell.value.length === 0 : cell.value === null || cell.value === '';

export const formatNumber = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 10 });

/** A number as the user edits it: no thousands separators, decimal comma ("1234,5"). */
export const editableNumber = (n: number) => String(n).replace('.', ',');

/**
 * Parses a number typed by the user. Accepts "1.5", "1,5", "1.000,5" (Indonesian), "1,000.5", and
 * dots as thousands separators when there is more than one ("1.234.567"). Null = empty or invalid.
 */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  let norm = t;
  if (t.includes(',') && t.includes('.')) {
    norm = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (t.includes(',')) {
    norm = (t.match(/,/g)?.length ?? 0) > 1 ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if ((t.match(/\./g)?.length ?? 0) > 1) {
    norm = t.replace(/\./g, '');
  }
  if (!/^-?\d*\.?\d+$/.test(norm) && !/^-?\d+\.$/.test(norm)) return null;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

export const formatDateRange = (v: DateValue) => (v.end ? `${formatDate(v.start)} → ${formatDate(v.end)}` : formatDate(v.start));

/** Normalizes a date range: the end may not be before the start. */
export function dateRange(start: string, end: string | null): DateValue {
  if (end && end < start) return { start: end, end: start };
  return { start, end };
}

/** Accepts only http(s) and mailto links, so a stored value cannot run script when clicked. */
export function safeUrl(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Title shown for a database: its page title when full-page, its own title when inline. */
export function databaseTitle(db: Database, pages: PageIndex): string {
  return (db.inline ? db.title : pages.byId.get(db.pageId)?.title) || UNTITLED_DATABASE;
}

/** Order for a property moved one step left (-1) or right (+1). Null at the edge. */
export function moveKey(list: { id: string; sortKey: string }[], id: string, step: -1 | 1): string | null {
  const i = list.findIndex((p) => p.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return null;
  const rest = list.filter((p) => p.id !== id);
  // Insert at position j of the list without the moved item.
  const before = rest[j - 1]?.sortKey ?? null;
  const after = rest[j]?.sortKey ?? null;
  return keyBetween(before, after);
}
