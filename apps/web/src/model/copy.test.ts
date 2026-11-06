import { describe, expect, it } from 'vitest';
import { propField, type Block } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { planCopy, type CopySource, type CopyWrite } from './copy.ts';
import { db, page, prop, view } from './test-fixtures.ts';

const block = (id: string, pageId: string, over: Partial<Stored<Block>> = {}): Stored<Block> => ({
  id,
  _hlc: {},
  pageId,
  parentId: null,
  sortKey: 'a0',
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text: id, styles: {} }],
  deleted: false,
  ...over,
});

// Page P holds an inline database "tasks" (rows r1, r2, row template tpl) that relates to an outside
// database "epics" (in page E), plus a sub-page S. The tasks database relates to itself too.
const source = (): CopySource => ({
  pages: [
    page('P', { title: 'Trip' }),
    page('S', { title: 'Sub', parentId: 'P' }),
    page('Strash', { title: 'Gone', parentId: 'P', trashedAt: 1 }),
    page('r1', { parentId: 'P', databaseId: 'tasks', sortKey: 'a1', [propField('epic')]: ['e1'], [propField('dep')]: ['r2'], [propField('st')]: 'o1' }),
    page('r2', { parentId: 'P', databaseId: 'tasks', sortKey: 'a2' }),
    page('rsub', { parentId: 'r1' }),
    page('tpl', { parentId: 'P', databaseId: 'tasks', isTemplate: true, [propField('st')]: 'o1' }),
    page('E'),
    page('e1', { parentId: 'E', databaseId: 'epics' }),
  ],
  blocks: [
    block('b1', 'P', { sortKey: 'a1' }),
    block('b1c', 'P', { parentId: 'b1' }),
    block('bdb', 'P', { sortKey: 'a2', type: 'database', props: { databaseId: 'tasks' }, content: undefined }),
    block('bother', 'P', { sortKey: 'a3', type: 'database', props: { databaseId: 'epics' } }),
    block('bs', 'S'),
    block('bt', 'tpl'),
  ],
  databases: [db('tasks', 'P', { inline: true, title: 'Tugas', defaultTemplateId: 'tpl' }), db('epics', 'E')],
  properties: [
    prop('st', 'tasks', { type: 'select', config: { options: [{ id: 'o1', name: 'A', color: 'red' }] } }),
    prop('epic', 'tasks', { type: 'relation', config: { databaseId: 'epics', pairId: 'tasksOfEpic' } }),
    prop('tasksOfEpic', 'epics', { name: 'Tugas', type: 'relation', sortKey: 'a5', config: { databaseId: 'tasks', pairId: 'epic', reverse: true } }),
    prop('dep', 'tasks', { type: 'relation', config: { databaseId: 'tasks', pairId: 'depOf' } }),
    prop('depOf', 'tasks', { type: 'relation', config: { databaseId: 'tasks', pairId: 'dep', reverse: true } }),
    prop('fromEpic', 'tasks', { type: 'relation', config: { databaseId: 'epics', pairId: 'x', reverse: true } }),
  ],
  views: [view('v1', 'tasks', { filters: [{ propertyId: 'st', op: 'is', value: 'o1' }], sorts: [{ propertyId: 'title', dir: 'asc' }], groupBy: 'st', hiddenProps: ['dep'] })],
});

let n = 0;
const opts = (withRows: boolean) => ({ withRows, newId: () => `n${++n}`, now: 99 });
const of = (writes: CopyWrite[], entity: CopyWrite['entity']) => writes.filter((w) => w.entity === entity);
const byTitle = (writes: CopyWrite[], title: string) => of(writes, 'page').find((w) => w.fields.title === title)!;

describe('planCopy', () => {
  it('duplicates a page with sub-pages, blocks, databases, rows and templates, all with new ids', () => {
    const { rootId, writes } = planCopy('P', { kind: 'new', parentId: null, sortKey: 'b0', title: 'Trip (salinan)', isTemplate: false }, source(), opts(true));
    const pages = of(writes, 'page');
    expect(pages).toHaveLength(6); // P, S, r1, r2, rsub, tpl (not the trashed sub-page)
    const all = writes.map((w) => w.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.some((id) => ['P', 'S', 'r1', 'tasks', 'st', 'v1', 'b1'].includes(id))).toBe(false);

    const root = pages.find((w) => w.id === rootId)!;
    expect(root.fields).toMatchObject({ title: 'Trip (salinan)', parentId: null, sortKey: 'b0', isTemplate: false, createdAt: 99 });
    expect(byTitle(writes, 'Sub').fields.parentId).toBe(rootId);

    const [newDb] = of(writes, 'database');
    expect(newDb!.fields).toMatchObject({ pageId: rootId, inline: true, title: 'Tugas' });
    const tpl = pages.find((w) => w.fields.isTemplate === true)!;
    expect(newDb!.fields.defaultTemplateId).toBe(tpl.id);

    // Blocks: nesting and the inline database follow; a database owned by another page is dropped.
    const blocks = of(writes, 'block');
    expect(blocks).toHaveLength(5);
    const b1 = blocks.find((b) => (b.fields.content as { text: string }[])[0]?.text === 'b1')!;
    expect(blocks.find((b) => (b.fields.content as { text: string }[])[0]?.text === 'b1c')!.fields.parentId).toBe(b1.id);
    expect(blocks.find((b) => b.fields.type === 'database')!.fields.props).toEqual({ databaseId: newDb!.id });
  });

  it('remaps properties, values, relations and view settings', () => {
    const { writes } = planCopy('P', { kind: 'new', parentId: null, sortKey: 'b0', title: 'T', isTemplate: false }, source(), opts(true));
    const props = of(writes, 'property');
    const named = (name: string, dbId?: string) => props.filter((p) => p.fields.name === name && (!dbId || p.fields.databaseId === dbId));
    const [newDb] = of(writes, 'database');
    const st = named('st')[0]!;
    const epic = named('epic')[0]!;
    const dep = named('dep')[0]!;
    const depOf = named('depOf')[0]!;
    // The reverse side of an outside relation is not copied.
    expect(named('fromEpic')).toHaveLength(0);
    // Self relation: both sides point at the copy.
    expect(dep.fields.config).toEqual({ databaseId: newDb!.id, pairId: depOf.id });
    expect(depOf.fields.config).toEqual({ databaseId: newDb!.id, pairId: dep.id, reverse: true });
    // Outside relation: same target, with a new reverse property there.
    const reverse = named('Tugas (salinan)', 'epics')[0]!;
    expect(epic.fields.config).toEqual({ databaseId: 'epics', pairId: reverse.id });
    expect(reverse.fields.config).toEqual({ databaseId: newDb!.id, pairId: epic.id, reverse: true });
    expect((reverse.fields.sortKey as string) > 'a5').toBe(true);

    const rows = of(writes, 'page').filter((p) => p.fields.databaseId === newDb!.id && !p.fields.isTemplate);
    const r1 = rows.find((r) => r.fields[propField(epic.id)])!;
    const r2 = rows.find((r) => r !== r1)!;
    expect(r1.fields[propField(epic.id)]).toEqual(['e1']);
    expect(r1.fields[propField(dep.id)]).toEqual([r2.id]);
    expect(r1.fields[propField(st.id)]).toBe('o1');
    expect(Object.keys(r1.fields).some((k) => k.includes('epic') || k === propField('st'))).toBe(false);

    const [v] = of(writes, 'view');
    expect(v!.fields).toMatchObject({
      databaseId: newDb!.id,
      filters: [{ propertyId: st.id, op: 'is', value: 'o1' }],
      sorts: [{ propertyId: 'title', dir: 'asc' }],
      groupBy: st.id,
      hiddenProps: [dep.id],
    });
  });

  it('copies only the structure and row templates when rows are not wanted', () => {
    const { writes } = planCopy('P', { kind: 'new', parentId: 'X', sortKey: 'b0', title: 'T', isTemplate: true }, source(), opts(false));
    const titles = of(writes, 'page').map((p) => p.fields.title);
    expect(titles).toEqual(['T', 'Sub', 'tpl']);
    expect(of(writes, 'page')[0]!.fields).toMatchObject({ parentId: 'X', isTemplate: true });
    expect(of(writes, 'block').filter((b) => b.fields.pageId === of(writes, 'page')[2]!.id)).toHaveLength(1);
  });

  it('duplicates a row inside its own database with its values', () => {
    const { rootId, writes } = planCopy('r1', { kind: 'new', parentId: 'P', sortKey: 'a15', title: 'r1 (salinan)', isTemplate: false }, source(), opts(true));
    const row = of(writes, 'page').find((w) => w.id === rootId)!;
    expect(row.fields).toMatchObject({ databaseId: 'tasks', [propField('st')]: 'o1', [propField('epic')]: ['e1'] });
    expect(of(writes, 'page')).toHaveLength(2); // the row and its sub-page
    expect(of(writes, 'database')).toHaveLength(0);
  });

  it('copies into an existing page after its own blocks and keeps its fields', () => {
    const { rootId, writes } = planCopy('P', { kind: 'existing', pageId: 'target', lastBlockKey: 'a5' }, source(), opts(false));
    expect(rootId).toBe('target');
    expect(of(writes, 'page').some((p) => p.id === 'target')).toBe(false);
    expect(byTitle(writes, 'Sub').fields.parentId).toBe('target');
    const top = of(writes, 'block').filter((b) => b.fields.pageId === 'target' && b.fields.parentId === null);
    expect(top.every((b) => (b.fields.sortKey as string) > 'a5')).toBe(true);
    const keys = top.map((b) => b.fields.sortKey as string);
    expect([...keys].sort()).toEqual(keys);
    expect(of(writes, 'database')[0]!.fields.pageId).toBe('target');
  });
});
