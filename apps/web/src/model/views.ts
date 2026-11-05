// Pure view logic (F-21, F-23): which properties show, which rows pass the filters, their order, and
// how they group into board columns or table sections. No I/O, fully unit-tested.
import { TITLE_PROPERTY, type FilterOp, type Property, type PropertyType, type SelectOption, type View, type ViewFilter, type ViewSort } from '@nonstop/shared';
import { cellText, cellValue, formatDate, type CellValue, type DatabaseIndex, type Row } from './database.ts';
import { keyBetween, UNTITLED } from './pages.ts';

/** A filter or sort target: a property, or the title column. */
export type FieldKind = PropertyType | 'title';

/** Properties shown by a view, in order. Views from sprint 3 have no list and use each property's flag. */
export function visibleProperties(view: View | undefined, properties: Property[]): Property[] {
  if (!view || view.hiddenProps === null) return properties.filter((p) => !p.hidden);
  const hidden = new Set(view.hiddenProps);
  return properties.filter((p) => !hidden.has(p.id));
}

/** Properties hidden by a view, in order. */
export function hiddenProperties(view: View | undefined, properties: Property[]): Property[] {
  const shown = new Set(visibleProperties(view, properties).map((p) => p.id));
  return properties.filter((p) => !shown.has(p.id));
}

/** The view's new hidden list after hiding or showing one property. */
export function hiddenAfter(view: View, properties: Property[], propertyId: string, hide: boolean): string[] {
  const current = hiddenProperties(view, properties).map((p) => p.id);
  const without = current.filter((id) => id !== propertyId);
  return hide ? [...without, propertyId] : without;
}

export const OP_LABELS: Record<FilterOp, string> = {
  contains: 'berisi',
  notContains: 'tidak berisi',
  is: 'adalah',
  isNot: 'bukan',
  empty: 'kosong',
  notEmpty: 'tidak kosong',
  eq: '=',
  neq: '≠',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  before: 'sebelum',
  after: 'sesudah',
  checked: 'dicentang',
  unchecked: 'tidak dicentang',
};

/** Operators offered for a field, the first one being the default. */
export function opsFor(kind: FieldKind): FilterOp[] {
  switch (kind) {
    case 'title':
    case 'text':
    case 'url':
      return ['contains', 'notContains', 'empty', 'notEmpty'];
    case 'number':
      return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'empty', 'notEmpty'];
    case 'select':
    case 'status':
      return ['is', 'isNot', 'empty', 'notEmpty'];
    case 'multiSelect':
    case 'relation':
      return ['contains', 'notContains', 'empty', 'notEmpty'];
    case 'date':
      return ['is', 'before', 'after', 'empty', 'notEmpty'];
    case 'checkbox':
      return ['checked', 'unchecked'];
  }
}

/** Operators that compare against a value the user enters. */
export const needsValue = (op: FilterOp) => !['empty', 'notEmpty', 'checked', 'unchecked'].includes(op);

/** The property a filter or sort points at, `title` for the title column, undefined if deleted. */
export function fieldOf(propertyId: string, properties: Property[]): Property | 'title' | undefined {
  return propertyId === TITLE_PROPERTY ? 'title' : properties.find((p) => p.id === propertyId);
}

const lower = (s: string) => s.toLocaleLowerCase('id');

function isBlank(cell: CellValue): boolean {
  if (cell.type === 'checkbox') return !cell.value;
  if (Array.isArray(cell.value)) return cell.value.length === 0;
  return cell.value === null || cell.value === '';
}

/** Ids of a multi-select or relation cell. */
function idsOf(cell: CellValue): string[] {
  if (cell.type === 'multiSelect') return cell.value.map((o) => o.id);
  if (cell.type === 'relation') return cell.value.map((r) => r.id);
  return [];
}

/**
 * Whether a row passes one filter. A filter on a deleted property, or one still waiting for its
 * value, lets every row through, so a half-made filter never hides everything.
 */
export function matchesFilter(db: DatabaseIndex, properties: Property[], row: Row, filter: ViewFilter): boolean {
  const field = fieldOf(filter.propertyId, properties);
  if (!field) return true;
  const { op, value } = filter;
  if (needsValue(op) && (value === null || value === '')) return true;

  if (field === 'title') {
    const t = lower(row.title);
    if (op === 'empty') return t === '';
    if (op === 'notEmpty') return t !== '';
    const has = t.includes(lower(String(value)));
    return op === 'notContains' ? !has : has;
  }

  const cell = cellValue(db, field, row);
  if (op === 'empty') return isBlank(cell);
  if (op === 'notEmpty') return !isBlank(cell);
  switch (cell.type) {
    case 'text':
    case 'url': {
      const has = lower(cell.value).includes(lower(String(value)));
      return op === 'notContains' ? !has : has;
    }
    case 'number': {
      const n = cell.value;
      const v = Number(value);
      if (n === null || !Number.isFinite(v)) return op === 'neq';
      return { eq: n === v, neq: n !== v, gt: n > v, lt: n < v, gte: n >= v, lte: n <= v }[op as 'eq'] ?? true;
    }
    case 'select':
    case 'status': {
      const is = cell.value?.id === value;
      return op === 'isNot' ? !is : is;
    }
    case 'multiSelect':
    case 'relation': {
      const has = idsOf(cell).includes(String(value));
      return op === 'notContains' ? !has : has;
    }
    case 'date': {
      if (!cell.value) return false;
      const v = String(value);
      const end = cell.value.end ?? cell.value.start;
      if (op === 'before') return cell.value.start < v;
      if (op === 'after') return end > v;
      return cell.value.start <= v && v <= end; // "is": the day falls inside the range
    }
    case 'checkbox':
      return op === 'unchecked' ? !cell.value : cell.value;
  }
}

/** A sortable key for a cell: null for empty values, which always go last. */
function sortValue(db: DatabaseIndex, field: Property | 'title', row: Row): string | number | null {
  if (field === 'title') return row.title ? lower(row.title) : null;
  const cell = cellValue(db, field, row);
  const order = (o: SelectOption) => (field.config.options ?? []).findIndex((x) => x.id === o.id);
  switch (cell.type) {
    case 'number':
      return cell.value;
    case 'select':
    case 'status':
      return cell.value ? order(cell.value) : null;
    case 'multiSelect':
      return cell.value.length ? Math.min(...cell.value.map(order)) : null;
    case 'date':
      return cell.value?.start ?? null;
    case 'checkbox':
      return cell.value ? 1 : 0;
    default: {
      const t = cellText(cell);
      return t ? lower(t) : null;
    }
  }
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'id', { numeric: true });
}

/** Rows that pass every filter (F-23), ordered by the view's sorts, then by their manual order. */
export function viewRows(db: DatabaseIndex, view: View | undefined, properties: Property[], rows: Row[]): Row[] {
  if (!view) return rows;
  const shown = rows.filter((r) => view.filters.every((f) => matchesFilter(db, properties, r, f)));
  const sorts = view.sorts
    .map((s) => ({ s, field: fieldOf(s.propertyId, properties) }))
    .filter((x): x is { s: ViewSort; field: Property | 'title' } => x.field !== undefined);
  if (!sorts.length) return shown;
  const keys = new Map(shown.map((r) => [r.id, sorts.map(({ field }) => sortValue(db, field, r))]));
  const position = new Map(shown.map((r, i) => [r.id, i]));
  return [...shown].sort((a, b) => {
    const ka = keys.get(a.id)!;
    const kb = keys.get(b.id)!;
    for (let i = 0; i < sorts.length; i++) {
      const empty = ka[i] === null || kb[i] === null;
      const c = compareValues(ka[i]!, kb[i]!);
      // Empty values stay last in both directions.
      if (c !== 0) return empty || sorts[i]!.s.dir === 'asc' ? c : -c;
    }
    return position.get(a.id)! - position.get(b.id)!;
  });
}

/** Properties a table or list can group by. Boards group by select or status only. */
export const groupable = (p: Property, board: boolean) => p.type === 'select' || p.type === 'status' || (!board && p.type === 'checkbox');

export interface RowGroup {
  /** Option id, 'true'/'false' for a checkbox, or null for rows without a value. */
  key: string | null;
  label: string;
  option?: SelectOption;
  rows: Row[];
}

/**
 * Splits rows into groups by a select, status or checkbox property, in option order. The group of
 * rows without a value comes first, and only when it has rows or `keepEmpty` is set (board columns).
 */
export function groupRows(db: DatabaseIndex, prop: Property, rows: Row[], keepEmpty = false): RowGroup[] {
  if (prop.type === 'checkbox') {
    const on = rows.filter((r) => cellValue(db, prop, r).value === true);
    const off = rows.filter((r) => cellValue(db, prop, r).value !== true);
    return [
      { key: 'true', label: 'Dicentang', rows: on },
      { key: 'false', label: 'Tidak dicentang', rows: off },
    ];
  }
  const groups: RowGroup[] = (prop.config.options ?? []).map((o) => ({ key: o.id, label: o.name || 'Tanpa nama', option: o, rows: [] }));
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const none: RowGroup = { key: null, label: `Tanpa ${prop.name || 'nilai'}`, rows: [] };
  for (const r of rows) {
    const cell = cellValue(db, prop, r);
    const id = cell.type === 'select' || cell.type === 'status' ? cell.value?.id : undefined;
    (id ? byKey.get(id)! : none).rows.push(r);
  }
  return none.rows.length || keepEmpty ? [none, ...groups] : groups;
}

/** The stored value that puts a row into a group. */
export function groupValue(prop: Property, key: string | null): unknown {
  if (prop.type === 'checkbox') return key === 'true';
  return key;
}

/**
 * Values for a row added in a view, so it does not vanish from the view at once: each simple filter
 * that names one value is satisfied. Returns property id to stored value.
 */
export function prefillValues(view: View | undefined, properties: Property[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of view?.filters ?? []) {
    const field = fieldOf(f.propertyId, properties);
    if (!field || field === 'title') continue;
    const v = f.value;
    if (f.op === 'checked' || f.op === 'unchecked') out[field.id] = f.op === 'checked';
    else if (v === null || v === '') continue;
    else if (f.op === 'is' && (field.type === 'select' || field.type === 'status')) out[field.id] = v;
    else if (f.op === 'contains' && (field.type === 'multiSelect' || (field.type === 'relation' && !field.config.reverse))) out[field.id] = [String(v)];
    else if (f.op === 'eq' && field.type === 'number') out[field.id] = Number(v);
    else if (f.op === 'is' && field.type === 'date') out[field.id] = { start: String(v), end: null };
  }
  return out;
}

/** Short text of a filter for its chip, for example "Status adalah Selesai". */
export function filterLabel(db: DatabaseIndex, properties: Property[], filter: ViewFilter): string {
  const field = fieldOf(filter.propertyId, properties);
  const name = field === 'title' ? 'Judul' : (field?.name ?? 'Properti terhapus');
  if (!needsValue(filter.op)) return `${name} ${OP_LABELS[filter.op]}`;
  let value = filter.value === null ? '…' : String(filter.value);
  if (field && field !== 'title') {
    const option = field.config.options?.find((o) => o.id === filter.value);
    if (option) value = option.name;
    if (field.type === 'relation') value = db.row(String(filter.value))?.title || UNTITLED;
    if (field.type === 'date' && typeof filter.value === 'string') value = formatDate(filter.value);
  }
  return `${name} ${OP_LABELS[filter.op]} ${value}`;
}

/**
 * Sort key for a card dropped into a board column before `beforeId` (null = at the end). Neighbours
 * are the column's cards in display order without the moving card. Rows share one order across
 * columns, so a key between the two neighbours keeps both columns in order.
 */
export function cardKey(column: Row[], movingId: string, beforeId: string | null): string {
  const rest = column.filter((r) => r.id !== movingId);
  const i = beforeId === null ? rest.length : rest.findIndex((r) => r.id === beforeId);
  const at = i < 0 ? rest.length : i;
  return keyBetween(rest[at - 1]?.sortKey ?? null, rest[at]?.sortKey ?? null);
}
