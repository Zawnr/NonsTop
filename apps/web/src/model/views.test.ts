import { describe, expect, it } from 'vitest';
import { propField, TITLE_PROPERTY, type ViewFilter } from '@nonstop/shared';
import { build, db, ids, page, prop, view } from './test-fixtures.ts';
import { cardKey, filterLabel, groupRows, hiddenAfter, matchesFilter, prefillValues, viewRows, visibleProperties } from './views.ts';

const status = prop('st', 'db1', {
  name: 'Status',
  type: 'status',
  config: {
    options: [
      { id: 'todo', name: 'Belum', color: 'gray', group: 'todo' },
      { id: 'doing', name: 'Jalan', color: 'blue', group: 'doing' },
      { id: 'done', name: 'Selesai', color: 'green', group: 'done' },
    ],
  },
});
const num = prop('n', 'db1', { name: 'Poin', type: 'number', sortKey: 'a1' });
const date = prop('d', 'db1', { name: 'Tenggat', type: 'date', sortKey: 'a2' });
const tags = prop('tg', 'db1', { name: 'Tag', type: 'multiSelect', sortKey: 'a3', config: { options: [{ id: 'x', name: 'X', color: 'red' }] } });
const done = prop('c', 'db1', { name: 'Cek', type: 'checkbox', sortKey: 'a4' });
const note = prop('t', 'db1', { name: 'Catatan', sortKey: 'a5' });
const props = [status, num, date, tags, done, note];

const setup = () =>
  build(
    [
      page('D'),
      page('r1', { title: 'Beli tiket', parentId: 'D', databaseId: 'db1', sortKey: 'a1', [propField('st')]: 'doing', [propField('n')]: 3, [propField('d')]: { start: '2026-11-10', end: '2026-11-12' }, [propField('tg')]: ['x'], [propField('c')]: true }),
      page('r2', { title: 'Cari hotel', parentId: 'D', databaseId: 'db1', sortKey: 'a2', [propField('st')]: 'done', [propField('n')]: 1, [propField('t')]: 'Dekat stasiun' }),
      page('r3', { title: '', parentId: 'D', databaseId: 'db1', sortKey: 'a3', [propField('n')]: 8, [propField('d')]: { start: '2026-11-01', end: null } }),
      page('tpl', { title: 'Template', parentId: 'D', databaseId: 'db1', sortKey: 'a4', isTemplate: true }),
    ],
    [db('db1', 'D')],
    props,
  );

const f = (propertyId: string, op: ViewFilter['op'], value: ViewFilter['value'] = null): ViewFilter => ({ propertyId, op, value });

describe('row templates', () => {
  it('are not rows of any view but are listed per database', () => {
    const { index } = setup();
    expect(ids(index.rowsOf('db1'))).toEqual(['r1', 'r2', 'r3']);
    expect(ids(index.templatesOf('db1'))).toEqual(['tpl']);
  });
});

describe('visibleProperties', () => {
  it('uses the property flags for sprint 3 views and the view list otherwise', () => {
    const hiddenFlag = [prop('a', 'db1', { hidden: true }), prop('b', 'db1')];
    expect(ids(visibleProperties(view('v', 'db1'), hiddenFlag))).toEqual(['b']);
    expect(ids(visibleProperties(view('v', 'db1', { hiddenProps: [] }), hiddenFlag))).toEqual(['a', 'b']);
    expect(ids(visibleProperties(view('v', 'db1', { hiddenProps: ['b'] }), hiddenFlag))).toEqual(['a']);
  });

  it('copies the old flags into the view list on the first change', () => {
    const list = [prop('a', 'db1', { hidden: true }), prop('b', 'db1')];
    expect(hiddenAfter(view('v', 'db1'), list, 'b', true)).toEqual(['a', 'b']);
    expect(hiddenAfter(view('v', 'db1'), list, 'a', false)).toEqual([]);
  });
});

describe('matchesFilter', () => {
  const pass = (filter: ViewFilter) => {
    const { index } = setup();
    return ids(index.rowsOf('db1').filter((r) => matchesFilter(index, props, r, filter)));
  };

  it('filters the title and text', () => {
    expect(pass(f(TITLE_PROPERTY, 'contains', 'TIKET'))).toEqual(['r1']);
    expect(pass(f(TITLE_PROPERTY, 'empty'))).toEqual(['r3']);
    expect(pass(f('t', 'notContains', 'stasiun'))).toEqual(['r1', 'r3']);
  });

  it('filters numbers, options, multi-select and checkboxes', () => {
    expect(pass(f('n', 'gt', 2))).toEqual(['r1', 'r3']);
    expect(pass(f('n', 'lte', '3'))).toEqual(['r1', 'r2']);
    expect(pass(f('st', 'is', 'done'))).toEqual(['r2']);
    expect(pass(f('st', 'isNot', 'done'))).toEqual(['r1', 'r3']);
    expect(pass(f('st', 'empty'))).toEqual(['r3']);
    expect(pass(f('tg', 'contains', 'x'))).toEqual(['r1']);
    expect(pass(f('c', 'checked'))).toEqual(['r1']);
    expect(pass(f('c', 'unchecked'))).toEqual(['r2', 'r3']);
  });

  it('filters dates, counting a range as every day inside it', () => {
    expect(pass(f('d', 'is', '2026-11-11'))).toEqual(['r1']);
    expect(pass(f('d', 'before', '2026-11-05'))).toEqual(['r3']);
    expect(pass(f('d', 'after', '2026-11-11'))).toEqual(['r1']);
    expect(pass(f('d', 'notEmpty'))).toEqual(['r1', 'r3']);
  });

  it('ignores filters without a value yet and filters on deleted properties', () => {
    expect(pass(f('st', 'is', null))).toEqual(['r1', 'r2', 'r3']);
    expect(pass(f('gone', 'empty'))).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('viewRows', () => {
  it('applies every filter, then the sorts, with empty values last in both directions', () => {
    const { index } = setup();
    const rows = index.rowsOf('db1');
    expect(ids(viewRows(index, view('v', 'db1', { filters: [f('n', 'gte', 1), f('st', 'isNot', 'done')] }), props, rows))).toEqual(['r1', 'r3']);
    expect(ids(viewRows(index, view('v', 'db1', { sorts: [{ propertyId: 'n', dir: 'desc' }] }), props, rows))).toEqual(['r3', 'r1', 'r2']);
    expect(ids(viewRows(index, view('v', 'db1', { sorts: [{ propertyId: 'st', dir: 'asc' }] }), props, rows))).toEqual(['r1', 'r2', 'r3']);
    expect(ids(viewRows(index, view('v', 'db1', { sorts: [{ propertyId: 'st', dir: 'desc' }] }), props, rows))).toEqual(['r2', 'r1', 'r3']);
    expect(ids(viewRows(index, view('v', 'db1', { sorts: [{ propertyId: TITLE_PROPERTY, dir: 'asc' }] }), props, rows))).toEqual(['r1', 'r2', 'r3']);
  });

  it('keeps the manual order when sorts tie or point at a deleted property', () => {
    const { index } = setup();
    const rows = index.rowsOf('db1');
    expect(ids(viewRows(index, view('v', 'db1', { sorts: [{ propertyId: 'gone', dir: 'asc' }] }), props, rows))).toEqual(['r1', 'r2', 'r3']);
    expect(ids(viewRows(index, view('v', 'db1', { sorts: [{ propertyId: 'tg', dir: 'asc' }] }), props, rows))).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('groupRows', () => {
  it('groups by option in option order, with the empty group first only when used', () => {
    const { index } = setup();
    const groups = groupRows(index, status, index.rowsOf('db1'));
    expect(groups.map((g) => [g.key, ids(g.rows)])).toEqual([
      [null, ['r3']],
      ['todo', []],
      ['doing', ['r1']],
      ['done', ['r2']],
    ]);
    expect(groups[0]!.label).toBe('Tanpa Status');
    const noEmpty = groupRows(index, status, index.rowsOf('db1').slice(0, 2));
    expect(noEmpty.map((g) => g.key)).toEqual(['todo', 'doing', 'done']);
    expect(groupRows(index, status, [], true).map((g) => g.key)).toEqual([null, 'todo', 'doing', 'done']);
  });

  it('groups by checkbox', () => {
    const { index } = setup();
    expect(groupRows(index, done, index.rowsOf('db1')).map((g) => ids(g.rows))).toEqual([['r1'], ['r2', 'r3']]);
  });
});

describe('prefillValues', () => {
  it('turns single-value filters into values for a new row', () => {
    const v = view('v', 'db1', {
      filters: [f('st', 'is', 'doing'), f('tg', 'contains', 'x'), f('c', 'checked'), f('n', 'eq', 5), f('d', 'is', '2026-11-20'), f('t', 'contains', 'a'), f('n', 'gt', 1)],
    });
    expect(prefillValues(v, props)).toEqual({ st: 'doing', tg: ['x'], c: true, n: 5, d: { start: '2026-11-20', end: null } });
  });
});

describe('filterLabel', () => {
  it('names the property, operator and value', () => {
    const { index } = setup();
    expect(filterLabel(index, props, f('st', 'is', 'done'))).toBe('Status adalah Selesai');
    expect(filterLabel(index, props, f(TITLE_PROPERTY, 'empty'))).toBe('Judul kosong');
    expect(filterLabel(index, props, f('d', 'before', '2026-11-05'))).toBe('Tenggat sebelum 5 Nov 2026');
  });
});

describe('cardKey', () => {
  it('places a card between its new neighbours, or at the end', () => {
    const { index } = setup();
    const column = index.rowsOf('db1'); // a1, a2, a3
    const k = cardKey(column, 'r3', 'r2');
    expect(k > 'a1' && k < 'a2').toBe(true);
    expect(cardKey(column, 'r1', null) > 'a3').toBe(true);
    expect(cardKey(column, 'x', 'r1') < 'a1').toBe(true);
  });
});
