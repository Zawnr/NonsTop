import { describe, expect, it } from 'vitest';
import { propField, type Database, type Page, type Property, type View } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import {
  cellText,
  cellValue,
  dateRange,
  editableNumber,
  defaultConfig,
  indexDatabases,
  moveKey,
  parseNumber,
  relatedRows,
  relationWrites,
  safeUrl,
} from './database.ts';
import { indexPages, normalizePage, visibleChildren } from './pages.ts';

const page = (id: string, over: Partial<Page> & Record<string, unknown> = {}): Stored<Page> => ({
  id,
  _hlc: {},
  title: id,
  parentId: null,
  sortKey: 'a0',
  isFavorite: false,
  trashedAt: null,
  deleted: false,
  createdAt: 0,
  databaseId: null,
  isTemplate: false,
  ...over,
});
const db = (id: string, pageId: string, over: Partial<Database> = {}): Database => ({
  id,
  pageId,
  inline: false,
  title: '',
  deleted: false,
  createdAt: 0,
  defaultTemplateId: null,
  kind: null,
  ...over,
});
const prop = (id: string, databaseId: string, over: Partial<Property> = {}): Property => ({
  id,
  databaseId,
  name: id,
  type: 'text',
  config: {},
  sortKey: 'a0',
  hidden: false,
  deleted: false,
  ...over,
});
const view = (id: string, databaseId: string, over: Partial<View> = {}): View => ({
  id,
  databaseId,
  name: id,
  type: 'table',
  sortKey: 'a0',
  deleted: false,
  filters: [],
  sorts: [],
  groupBy: null,
  hiddenProps: null,
  ...over,
});

function build(records: Stored<Page>[], dbs: Database[], props: Property[] = [], views: View[] = []) {
  const pages = indexPages(records.map(normalizePage));
  return { pages, index: indexDatabases(dbs, props, views, pages, records) };
}

// Tasks (dbT in page T) relate to epics (dbE in page E). "epic" is the forward side on tasks.
const relationSetup = () => {
  const records = [
    page('T'),
    page('E'),
    page('t1', { parentId: 'T', databaseId: 'dbT', sortKey: 'a1', [propField('epic')]: ['e1'] }),
    page('t2', { parentId: 'T', databaseId: 'dbT', sortKey: 'a2', [propField('epic')]: ['e1', 'e2', 'gone'] }),
    page('e1', { parentId: 'E', databaseId: 'dbE', sortKey: 'a1' }),
    page('e2', { parentId: 'E', databaseId: 'dbE', sortKey: 'a2' }),
  ];
  const props = [
    prop('epic', 'dbT', { type: 'relation', config: { databaseId: 'dbE', pairId: 'tasks' } }),
    prop('tasks', 'dbE', { type: 'relation', config: { databaseId: 'dbT', pairId: 'epic', reverse: true } }),
  ];
  return build(records, [db('dbT', 'T'), db('dbE', 'E')], props);
};

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('indexDatabases', () => {
  it('lists rows in order and leaves out trashed and deleted ones', () => {
    const { index } = build(
      [
        page('D'),
        page('r2', { parentId: 'D', databaseId: 'db1', sortKey: 'a2' }),
        page('r1', { parentId: 'D', databaseId: 'db1', sortKey: 'a1' }),
        page('r3', { parentId: 'D', databaseId: 'db1', sortKey: 'a3', trashedAt: 5 }),
        page('r4', { parentId: 'D', databaseId: 'db1', sortKey: 'a4', deleted: true }),
      ],
      [db('db1', 'D')],
    );
    expect(ids(index.rowsOf('db1'))).toEqual(['r1', 'r2']);
  });

  it('hides rows of a trashed owner page', () => {
    const { index } = build([page('D', { trashedAt: 1 }), page('r1', { parentId: 'D', databaseId: 'db1' })], [db('db1', 'D')]);
    expect(index.rowsOf('db1')).toEqual([]);
  });

  it('keeps database rows out of the sidebar tree', () => {
    const { pages } = build([page('D'), page('sub', { parentId: 'D' }), page('r1', { parentId: 'D', databaseId: 'db1' })], [db('db1', 'D')]);
    expect(ids(visibleChildren(pages, 'D'))).toEqual(['sub']);
  });

  it('orders properties and views, and drops deleted ones and those of unknown databases', () => {
    const { index } = build(
      [page('D')],
      [db('db1', 'D')],
      [prop('b', 'db1', { sortKey: 'a2' }), prop('a', 'db1', { sortKey: 'a1' }), prop('x', 'db1', { deleted: true }), prop('y', 'dbX')],
      [view('v2', 'db1', { sortKey: 'a2' }), view('v1', 'db1', { sortKey: 'a1' })],
    );
    expect(ids(index.propertiesOf('db1'))).toEqual(['a', 'b']);
    expect(ids(index.viewsOf('db1'))).toEqual(['v1', 'v2']);
    expect(index.property('y')).toBeUndefined();
  });

  it('picks the oldest full-page database when two devices created one for the same page', () => {
    const { index } = build([page('D')], [db('db2', 'D', { createdAt: 2 }), db('db1', 'D', { createdAt: 1 }), db('in', 'D', { inline: true })]);
    expect(index.fullPageOf('D')?.id).toBe('db1');
  });

  it('marks rows of a missing database as orphans', () => {
    const { index } = build([page('D'), page('r1', { parentId: 'D', databaseId: 'gone' })], [db('db1', 'D')]);
    expect(index.isOrphanRow('r1')).toBe(true);
    expect(index.row('r1')).toBeUndefined();
  });

  it('drops databases whose owner page is deleted', () => {
    const { index } = build([page('D', { deleted: true })], [db('db1', 'D')]);
    expect(index.byId.size).toBe(0);
  });
});

describe('cellValue', () => {
  const setup = () => {
    const status = prop('s', 'db1', { type: 'status', config: defaultConfig('status', (() => { let n = 0; return () => `o${++n}`; })()) });
    const multi = prop('m', 'db1', { type: 'multiSelect', config: { options: [{ id: 'x', name: 'X', color: 'red' }, { id: 'y', name: 'Y', color: 'blue' }] } });
    const records = [
      page('D'),
      page('r', {
        parentId: 'D',
        databaseId: 'db1',
        [propField('s')]: 'o3',
        [propField('m')]: ['y', 'deleted-option'],
        [propField('n')]: 'not a number',
        [propField('d')]: { start: '2026-11-05', end: '2026-11-07' },
        [propField('c')]: true,
      }),
    ];
    const props = [status, multi, prop('n', 'db1', { type: 'number' }), prop('d', 'db1', { type: 'date' }), prop('c', 'db1', { type: 'checkbox' }), prop('t', 'db1')];
    const { index } = build(records, [db('db1', 'D')], props);
    return { index, row: index.row('r')!, p: (id: string) => index.property(id)! };
  };

  it('reads each type and resolves option ids', () => {
    const { index, row, p } = setup();
    expect(cellValue(index, p('s'), row)).toMatchObject({ value: { name: 'Selesai', group: 'done' } });
    expect(cellText(cellValue(index, p('m'), row))).toBe('Y');
    expect(cellText(cellValue(index, p('d'), row))).toBe('5 Nov 2026 → 7 Nov 2026');
    expect(cellValue(index, p('c'), row).value).toBe(true);
    expect(cellValue(index, p('t'), row).value).toBe('');
  });

  it('reads values of the wrong shape as empty', () => {
    const { index, row, p } = setup();
    expect(cellValue(index, p('n'), row).value).toBeNull();
  });
});

describe('relations (F-15)', () => {
  it('reads the forward side from stored ids, skipping missing rows', () => {
    const { index } = relationSetup();
    expect(ids(relatedRows(index, index.property('epic')!, index.row('t2')!))).toEqual(['e1', 'e2']);
  });

  it('computes the reverse side from the forward values', () => {
    const { index } = relationSetup();
    const tasks = index.property('tasks')!;
    expect(ids(relatedRows(index, tasks, index.row('e1')!))).toEqual(['t1', 't2']);
    expect(ids(relatedRows(index, tasks, index.row('e2')!))).toEqual(['t2']);
  });

  it('writes forward edits to the row itself', () => {
    const { index } = relationSetup();
    expect(relationWrites(index, index.property('epic')!, index.row('t1')!, 'e2', true)).toEqual([
      { rowId: 't1', field: propField('epic'), value: ['e1', 'e2'] },
    ]);
    expect(relationWrites(index, index.property('epic')!, index.row('t1')!, 'e1', true)).toEqual([]);
  });

  it('writes reverse edits to the other row', () => {
    const { index } = relationSetup();
    const tasks = index.property('tasks')!;
    expect(relationWrites(index, tasks, index.row('e2')!, 't1', true)).toEqual([{ rowId: 't1', field: propField('epic'), value: ['e1', 'e2'] }]);
    expect(relationWrites(index, tasks, index.row('e1')!, 't2', false)).toEqual([{ rowId: 't2', field: propField('epic'), value: ['e2', 'gone'] }]);
  });

  it('shows a trashed related row on neither side', () => {
    const { index } = relationSetup();
    const records = [page('T'), page('E'), page('t1', { parentId: 'T', databaseId: 'dbT', [propField('epic')]: ['e1'] }), page('e1', { parentId: 'E', databaseId: 'dbE', trashedAt: 1 })];
    const again = build(records, [db('dbT', 'T'), db('dbE', 'E')], [index.property('epic')!, index.property('tasks')!]);
    expect(relatedRows(again.index, again.index.property('epic')!, again.index.row('t1')!)).toEqual([]);
  });
});

describe('helpers', () => {
  it('parses numbers in both notations', () => {
    expect(parseNumber('12')).toBe(12);
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('1.5')).toBe(1.5);
    expect(parseNumber('1.000,25')).toBe(1000.25);
    expect(parseNumber('1,000.25')).toBe(1000.25);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('1.234.567')).toBe(1234567);
    expect(parseNumber(editableNumber(1234.5))).toBe(1234.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  it('allows only safe link schemes', () => {
    expect(safeUrl('example.com')).toBe('https://example.com/');
    expect(safeUrl('http://a.b/c')).toBe('http://a.b/c');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('')).toBeNull();
  });

  it('swaps a date range that ends before it starts', () => {
    expect(dateRange('2026-11-07', '2026-11-05')).toEqual({ start: '2026-11-05', end: '2026-11-07' });
    expect(dateRange('2026-11-05', null)).toEqual({ start: '2026-11-05', end: null });
  });

  it('computes a key one step left or right', () => {
    const list = [
      { id: 'a', sortKey: 'a1' },
      { id: 'b', sortKey: 'a2' },
      { id: 'c', sortKey: 'a3' },
    ];
    const order = (id: string, key: string) =>
      list
        .map((p) => (p.id === id ? { ...p, sortKey: key } : p))
        .sort((x, y) => (x.sortKey < y.sortKey ? -1 : 1))
        .map((p) => p.id);
    expect(order('b', moveKey(list, 'b', 1)!)).toEqual(['a', 'c', 'b']);
    expect(order('b', moveKey(list, 'b', -1)!)).toEqual(['b', 'a', 'c']);
    expect(moveKey(list, 'a', -1)).toBeNull();
    expect(moveKey(list, 'c', 1)).toBeNull();
  });
});
