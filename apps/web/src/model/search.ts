// Full-text search over page titles and block text (F-51). Runs on the device, so it works offline.
import MiniSearch from 'minisearch';
import type { Block } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { contentText } from './blocks.ts';
import { UNTITLED, type PageIndex } from './pages.ts';

export interface SearchDoc {
  id: string;
  title: string;
  text: string;
}

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  /** Terms that matched, for highlighting. */
  terms: string[];
}

/** One document per live page: its title and the text of all its blocks. Trashed pages are left out. */
export function searchDocs(index: PageIndex, blocks: Stored<Block>[]): SearchDoc[] {
  const text = new Map<string, string[]>();
  for (const b of blocks) {
    if (b.deleted || !b.pageId) continue;
    const t = contentText(b.content);
    if (!t) continue;
    if (!text.has(b.pageId)) text.set(b.pageId, []);
    text.get(b.pageId)!.push(t);
  }
  return [...index.byId.values()]
    .filter((p) => !index.isTrashed(p.id))
    .map((p) => ({ id: p.id, title: p.title, text: (text.get(p.id) ?? []).join('\n') }));
}

/** Case and accent insensitive, so "kopi" finds "Kopi" and "cafe" finds "café". */
const normalize = (term: string) => term.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function buildSearchIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const ms = new MiniSearch<SearchDoc>({
    fields: ['title', 'text'],
    storeFields: ['title', 'text'],
    processTerm: normalize,
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
  });
  ms.addAll(docs);
  return ms;
}

export function search(ms: MiniSearch<SearchDoc>, query: string, limit = 20): SearchHit[] {
  if (!query.trim()) return [];
  return ms
    .search(query)
    .slice(0, limit)
    .map((r) => ({
      id: r.id as string,
      title: (r.title as string) || UNTITLED,
      snippet: snippet((r.text as string) ?? '', r.terms),
      terms: r.terms,
    }));
}

/** The line around the first matching term, shortened to about 120 characters. */
export function snippet(text: string, terms: string[]): string {
  if (!text) return '';
  const lower = normalize(text);
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const lineEnd = text.indexOf('\n', at);
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const pos = at - lineStart;
  if (line.length <= 120) return line;
  const from = Math.max(0, pos - 40);
  return `${from > 0 ? '…' : ''}${line.slice(from, from + 120)}${from + 120 < line.length ? '…' : ''}`;
}
