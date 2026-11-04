import { describe, expect, it } from 'vitest';
import { buildDocument, contentText, differs, diffDocument, liveBlocks, toSnapshot, type DocBlock, type FlatBlock } from './blocks.ts';

const text = (t: string) => [{ type: 'text', text: t, styles: {} }];
const flat = (id: string, over: Partial<FlatBlock> = {}): FlatBlock => ({
  id,
  parentId: null,
  sortKey: 'a0',
  type: 'paragraph',
  props: {},
  content: text(id),
  ...over,
});
const doc = (id: string, children: DocBlock[] = [], over: Partial<DocBlock> = {}): DocBlock => ({
  id,
  type: 'paragraph',
  props: {},
  content: text(id),
  children,
  ...over,
});
const ids = (blocks: DocBlock[]): unknown[] => blocks.map((b) => (b.children.length ? [b.id, ids(b.children)] : b.id));

describe('buildDocument', () => {
  it('nests and orders blocks', () => {
    const tree = buildDocument([flat('b', { sortKey: 'a1' }), flat('a', { sortKey: 'a0' }), flat('a1', { parentId: 'a' })]);
    expect(ids(tree)).toEqual([['a', ['a1']], 'b']);
  });

  it('moves orphans to the top level and breaks cycles', () => {
    const tree = buildDocument([flat('x', { parentId: 'gone' }), flat('p', { parentId: 'q' }), flat('q', { parentId: 'p' })]);
    expect(ids(tree)).toEqual([['p', ['q']], 'x']);
  });

  it('skips deleted rows and unknown types from newer app versions', () => {
    const rows = liveBlocks([
      { id: 'a', _hlc: {}, type: 'paragraph', content: text('a') },
      { id: 'b', _hlc: {}, type: 'paragraph', deleted: true },
      { id: 'c', _hlc: {}, type: 'image' as never },
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });
});

describe('diffDocument', () => {
  it('writes every field of a new block', () => {
    const { writes } = diffDocument('p1', new Map(), [doc('a')]);
    expect(writes).toEqual([
      {
        id: 'a',
        fields: expect.objectContaining({ pageId: 'p1', deleted: false, parentId: null, type: 'paragraph', content: text('a') }),
      },
    ]);
  });

  it('writes nothing when the document matches the snapshot', () => {
    const start = diffDocument('p1', new Map(), [doc('a'), doc('b', [doc('c')])]);
    expect(diffDocument('p1', start.next, [doc('a'), doc('b', [doc('c')])]).writes).toEqual([]);
  });

  it('writes only the content of an edited block', () => {
    const { next } = diffDocument('p1', new Map(), [doc('a'), doc('b')]);
    const { writes } = diffDocument('p1', next, [doc('a'), doc('b', [], { content: text('changed') })]);
    expect(writes).toEqual([{ id: 'b', fields: { content: text('changed') } }]);
  });

  it('moving one block rewrites only that block, and the order holds', () => {
    const { next } = diffDocument('p1', new Map(), [doc('a'), doc('b'), doc('c'), doc('d')]);
    const moved = diffDocument('p1', next, [doc('a'), doc('d'), doc('b'), doc('c')]);
    expect(moved.writes.map((w) => w.id)).toEqual(['d']);
    expect(ids(buildDocument([...moved.next.values()]))).toEqual(['a', 'd', 'b', 'c']);
  });

  it('indenting sets the parent', () => {
    const { next } = diffDocument('p1', new Map(), [doc('a'), doc('b')]);
    const { writes, next: after } = diffDocument('p1', next, [doc('a', [doc('b')])]);
    expect(writes).toEqual([{ id: 'b', fields: expect.objectContaining({ parentId: 'a' }) }]);
    expect(ids(buildDocument([...after.values()]))).toEqual([['a', ['b']]]);
  });

  it('marks removed blocks as deleted', () => {
    const { next } = diffDocument('p1', new Map(), [doc('a'), doc('b')]);
    expect(diffDocument('p1', next, [doc('a')]).writes).toEqual([{ id: 'b', fields: { deleted: true } }]);
  });

  it('round-trips through the store format', () => {
    const tree = [doc('a', [doc('a1')], { type: 'toggleListItem' }), doc('h', [], { type: 'heading', props: { level: 2 } }), doc('d', [], { type: 'divider', content: undefined })];
    const { next } = diffDocument('p1', new Map(), tree);
    expect(buildDocument([...next.values()])).toEqual(tree);
  });
});

describe('differs and contentText', () => {
  it('detects remote changes against the snapshot', () => {
    const blocks = [flat('a'), flat('b', { sortKey: 'a1' })];
    const snap = toSnapshot(blocks);
    expect(differs(snap, blocks)).toBe(false);
    expect(differs(snap, [blocks[0]!, { ...blocks[1]!, content: text('remote') }])).toBe(true);
    expect(differs(snap, [blocks[0]!])).toBe(true);
  });

  it('extracts plain text from inline content and links', () => {
    expect(contentText([{ type: 'text', text: 'Rapat ' }, { type: 'link', href: 'x', content: [{ type: 'text', text: 'Senin' }] }])).toBe('Rapat Senin');
    expect(contentText(undefined)).toBe('');
  });
});
