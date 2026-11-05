// Pure page-tree logic: hierarchy, trash, favorites and ordering. No I/O, fully unit-tested.
import { generateKeyBetween } from 'fractional-indexing';
import type { Page } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';

export const UNTITLED = 'Tanpa judul';

/** Fills fields that have not arrived yet with safe defaults. */
export function normalizePage(rec: Stored<Page>): Page {
  return {
    id: rec.id,
    title: rec.title ?? '',
    parentId: rec.parentId ?? null,
    sortKey: rec.sortKey ?? 'a0',
    isFavorite: rec.isFavorite ?? false,
    trashedAt: rec.trashedAt ?? null,
    deleted: rec.deleted ?? false,
    createdAt: rec.createdAt ?? 0,
    databaseId: rec.databaseId ?? null,
  };
}

export function bySortKey(a: Page, b: Page): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface PageIndex {
  byId: Map<string, Page>;
  /** Parent after repairs: null when the stored parent is missing, deleted, or part of a cycle. */
  parentOf: (id: string) => string | null;
  /** Children in display order, including trashed ones. */
  childrenOf: (id: string | null) => Page[];
  /** Trashed itself or below a trashed page. */
  isTrashed: (id: string) => boolean;
  ancestors: (id: string) => Page[];
  /** All pages below this one, at any depth. */
  descendants: (id: string) => Page[];
}

export function indexPages(records: Page[]): PageIndex {
  const byId = new Map(records.filter((p) => !p.deleted).map((p) => [p.id, p]));

  // Two devices can move pages into each other offline (A under B, B under A). Break every cycle
  // by treating its page with the smallest id as a top-level page, the same choice on every device.
  const parent = new Map<string, string | null>();
  for (const p of byId.values()) parent.set(p.id, p.parentId && byId.has(p.parentId) ? p.parentId : null);
  for (const start of byId.keys()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = start;
    while (cur !== null && !onPath.has(cur)) {
      path.push(cur);
      onPath.add(cur);
      cur = parent.get(cur) ?? null;
    }
    if (cur !== null) {
      const cycle = path.slice(path.indexOf(cur));
      const breaker = cycle.reduce((min, id) => (id < min ? id : min));
      parent.set(breaker, null);
    }
  }

  const children = new Map<string | null, Page[]>();
  for (const p of byId.values()) {
    const key = parent.get(p.id) ?? null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(p);
  }
  for (const list of children.values()) list.sort(bySortKey);

  const trashed = new Map<string, boolean>();
  const isTrashed = (id: string): boolean => {
    const known = trashed.get(id);
    if (known !== undefined) return known;
    const p = byId.get(id);
    const pid = parent.get(id) ?? null;
    const value = !p || p.trashedAt !== null || (pid !== null && isTrashed(pid));
    trashed.set(id, value);
    return value;
  };

  const ancestors = (id: string): Page[] => {
    const out: Page[] = [];
    let cur = parent.get(id) ?? null;
    while (cur !== null) {
      out.unshift(byId.get(cur)!);
      cur = parent.get(cur) ?? null;
    }
    return out;
  };

  const descendants = (id: string): Page[] => {
    const out: Page[] = [];
    const stack = [...(children.get(id) ?? [])];
    while (stack.length) {
      const p = stack.pop()!;
      out.push(p);
      stack.push(...(children.get(p.id) ?? []));
    }
    return out;
  };

  return {
    byId,
    parentOf: (id) => parent.get(id) ?? null,
    childrenOf: (id) => children.get(id) ?? [],
    isTrashed,
    ancestors,
    descendants,
  };
}

/** Pages visible in the sidebar tree under a parent (null = top level). Database rows are left out. */
export function visibleChildren(index: PageIndex, parentId: string | null): Page[] {
  return index.childrenOf(parentId).filter((p) => p.trashedAt === null && p.databaseId === null);
}

export function favorites(index: PageIndex): Page[] {
  return [...index.byId.values()]
    .filter((p) => p.isFavorite && !index.isTrashed(p.id))
    .sort((a, b) => (a.title || UNTITLED).localeCompare(b.title || UNTITLED, 'id'));
}

/** Pages shown in the trash: trashed themselves, with no trashed ancestor (those show inside their parent). */
export function trashRoots(index: PageIndex): Page[] {
  return [...index.byId.values()]
    .filter((p) => p.trashedAt !== null && !index.ancestors(p.id).some((a) => a.trashedAt !== null))
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
}

/** A sort key between two neighbours. Tolerates equal or invalid keys from other devices. */
export function keyBetween(before: string | null, after: string | null): string {
  try {
    if (before !== null && after !== null && before >= after) return generateKeyBetween(before, null);
    return generateKeyBetween(before, after);
  } catch {
    try {
      return generateKeyBetween(before, null);
    } catch {
      return generateKeyBetween(null, null);
    }
  }
}

export type DropPosition = 'before' | 'after' | 'inside';

export interface Placement {
  parentId: string | null;
  sortKey: string;
}

/** Where a page lands when dropped relative to a target. Null if the move would put it inside itself. */
export function placeRelative(index: PageIndex, movingId: string, targetId: string, position: DropPosition): Placement | null {
  if (movingId === targetId) return null;
  if (index.ancestors(targetId).some((a) => a.id === movingId)) return null;
  if (position === 'inside') return placeAtEnd(index, movingId, targetId);
  const parentId = index.parentOf(targetId);
  const siblings = visibleChildren(index, parentId).filter((p) => p.id !== movingId);
  const i = siblings.findIndex((p) => p.id === targetId);
  const before = position === 'before' ? siblings[i - 1] : siblings[i];
  const after = position === 'before' ? siblings[i] : siblings[i + 1];
  return { parentId, sortKey: keyBetween(before?.sortKey ?? null, after?.sortKey ?? null) };
}

/** Last position under a parent. Null if the parent is the page itself or one of its descendants. */
export function placeAtEnd(index: PageIndex, movingId: string, parentId: string | null): Placement | null {
  if (parentId !== null && (parentId === movingId || index.ancestors(parentId).some((a) => a.id === movingId))) return null;
  const siblings = visibleChildren(index, parentId).filter((p) => p.id !== movingId);
  return { parentId, sortKey: keyBetween(siblings.at(-1)?.sortKey ?? null, null) };
}
