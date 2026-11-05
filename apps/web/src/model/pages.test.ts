import { describe, expect, it } from 'vitest';
import type { Page } from '@nonstop/shared';
import { favorites, indexPages, keyBetween, placeAtEnd, placeRelative, trashRoots, visibleChildren } from './pages.ts';

const page = (id: string, over: Partial<Page> = {}): Page => ({
  id,
  title: id.toUpperCase(),
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

const ids = (pages: Page[]) => pages.map((p) => p.id);

describe('indexPages', () => {
  it('nests pages without a depth limit and orders siblings by sort key', () => {
    const idx = indexPages([
      page('a', { sortKey: 'a1' }),
      page('b', { sortKey: 'a0' }),
      page('c', { parentId: 'a' }),
      page('d', { parentId: 'c' }),
      page('e', { parentId: 'd' }),
    ]);
    expect(ids(idx.childrenOf(null))).toEqual(['b', 'a']);
    expect(ids(idx.ancestors('e'))).toEqual(['a', 'c', 'd']);
    expect(ids(idx.descendants('a')).sort()).toEqual(['c', 'd', 'e']);
  });

  it('breaks ties on equal sort keys by id, the same on every device', () => {
    const idx = indexPages([page('y'), page('x')]);
    expect(ids(idx.childrenOf(null))).toEqual(['x', 'y']);
  });

  it('shows a page whose parent is missing or deleted at the top level', () => {
    const idx = indexPages([page('gone', { deleted: true }), page('a', { parentId: 'gone' }), page('b', { parentId: 'never-synced' })]);
    expect(ids(idx.childrenOf(null))).toEqual(['a', 'b']);
    expect(idx.byId.has('gone')).toBe(false);
  });

  it('breaks cycles from concurrent moves deterministically', () => {
    const idx = indexPages([page('a', { parentId: 'b' }), page('b', { parentId: 'a' }), page('c', { parentId: 'c' })]);
    expect(ids(idx.childrenOf(null))).toEqual(['a', 'c']);
    expect(ids(idx.childrenOf('a'))).toEqual(['b']);
  });

  it('inherits trash from ancestors', () => {
    const idx = indexPages([page('a', { trashedAt: 5 }), page('b', { parentId: 'a' }), page('c')]);
    expect(idx.isTrashed('b')).toBe(true);
    expect(idx.isTrashed('c')).toBe(false);
    expect(ids(visibleChildren(idx, null))).toEqual(['c']);
  });
});

describe('favorites and trash', () => {
  it('lists favorites that are not in the trash, by title', () => {
    const idx = indexPages([
      page('z', { title: 'Zeta', isFavorite: true }),
      page('a', { title: 'Alpha', isFavorite: true }),
      page('t', { isFavorite: true, trashedAt: 1 }),
    ]);
    expect(ids(favorites(idx))).toEqual(['a', 'z']);
  });

  it('lists only the top trashed page of a trashed subtree, newest first', () => {
    const idx = indexPages([
      page('a', { trashedAt: 1 }),
      page('b', { parentId: 'a', trashedAt: 2 }),
      page('c', { trashedAt: 3 }),
    ]);
    expect(ids(trashRoots(idx))).toEqual(['c', 'a']);
  });
});

describe('placement', () => {
  const idx = indexPages([
    page('a', { sortKey: 'a0' }),
    page('b', { sortKey: 'a1' }),
    page('c', { sortKey: 'a2' }),
    page('a1', { parentId: 'a', sortKey: 'a0' }),
  ]);

  it('places before and after a target', () => {
    const before = placeRelative(idx, 'c', 'b', 'before')!;
    expect(before.parentId).toBeNull();
    expect(before.sortKey > 'a0' && before.sortKey < 'a1').toBe(true);
    const after = placeRelative(idx, 'a', 'b', 'after')!;
    expect(after.sortKey > 'a1' && after.sortKey < 'a2').toBe(true);
  });

  it('places inside a target at the end', () => {
    const inside = placeRelative(idx, 'c', 'a', 'inside')!;
    expect(inside.parentId).toBe('a');
    expect(inside.sortKey > 'a0').toBe(true);
  });

  it('refuses to move a page into itself or its own descendants', () => {
    expect(placeRelative(idx, 'a', 'a', 'inside')).toBeNull();
    expect(placeRelative(idx, 'a', 'a1', 'after')).toBeNull();
    expect(placeAtEnd(idx, 'a', 'a1')).toBeNull();
    expect(placeAtEnd(idx, 'a1', null)?.parentId).toBeNull();
  });

  it('copes with equal or invalid keys from other devices', () => {
    expect(keyBetween('a0', 'a0') > 'a0').toBe(true);
    expect(typeof keyBetween('!!', null)).toBe('string');
  });
});
