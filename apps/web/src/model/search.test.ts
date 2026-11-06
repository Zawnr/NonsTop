import { describe, expect, it } from 'vitest';
import type { Block, Page } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { indexPages } from './pages.ts';
import { buildSearchIndex, matchRanges, search, searchDocs, snippet } from './search.ts';

const page = (id: string, title: string, over: Partial<Page> = {}): Page => ({
  id,
  title,
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
const block = (id: string, pageId: string, text: string, over: Partial<Stored<Block>> = {}): Stored<Block> => ({
  id,
  _hlc: {},
  pageId,
  type: 'paragraph',
  content: [{ type: 'text', text, styles: {} }],
  ...over,
});

const index = indexPages([page('p1', 'Rapat Senin'), page('p2', 'Belanja'), page('p3', 'Lama', { trashedAt: 1 })]);
const ms = buildSearchIndex(
  searchDocs(index, [
    block('b1', 'p2', 'Beli kopi dan gula'),
    block('b2', 'p2', 'Café di dekat kantor'),
    block('b3', 'p1', 'kopi', { deleted: true }),
    block('b4', 'p3', 'kopi rahasia'),
  ]),
);

describe('search', () => {
  it('finds pages by title and by block text', () => {
    expect(search(ms, 'rapat').map((h) => h.id)).toEqual(['p1']);
    expect(search(ms, 'kopi').map((h) => h.id)).toEqual(['p2']);
  });

  it('ignores case, accents and small typos, and matches prefixes', () => {
    expect(search(ms, 'CAFE').map((h) => h.id)).toEqual(['p2']);
    expect(search(ms, 'blanja').map((h) => h.id)).toEqual(['p2']);
    expect(search(ms, 'sen').map((h) => h.id)).toEqual(['p1']);
  });

  it('leaves out deleted blocks and trashed pages', () => {
    expect(search(ms, 'rahasia')).toEqual([]);
  });

  it('requires all words', () => {
    expect(search(ms, 'kopi gula').map((h) => h.id)).toEqual(['p2']);
    expect(search(ms, 'kopi rapat')).toEqual([]);
  });

  it('shows the matching line as snippet', () => {
    expect(search(ms, 'kantor')[0]?.snippet).toBe('Café di dekat kantor');
    const long = `${'a '.repeat(100)}target ${'b '.repeat(100)}`;
    const s = snippet(long, ['target']);
    expect(s.length).toBeLessThanOrEqual(122);
    expect(s).toContain('target');
  });
});

describe('matchRanges', () => {
  it('maps matches in normalized text back to the original, including accents and decomposed text', () => {
    expect(matchRanges('Café enak', ['cafe'])).toEqual([[0, 4]]);
    const decomposed = 'Cafe\u0301 di kantor'; // "é" stored as e + combining accent
    const [[start, end]] = matchRanges(decomposed, ['kantor']) as [[number, number]];
    expect(decomposed.slice(start, end)).toBe('kantor');
    expect(matchRanges('İstanbul ist', ['ist']).length).toBe(2);
  });

  it('merges overlapping matches', () => {
    expect(matchRanges('kopikopi', ['kopi', 'ikop'])).toEqual([[0, 8]]);
  });
});
