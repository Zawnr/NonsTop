// Mapping between the editor document (a tree of blocks) and stored block rows.
// Each block is one synced record, so last-writer-wins applies per block (F-63).
// Pure functions, no editor or I/O imports, fully unit-tested.
import { blockTypes, sameValue, type Block, type BlockType } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { keyBetween } from './pages.ts';

/** The block shape the editor reads and writes (a subset of BlockNote's Block). */
export interface DocBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: DocBlock[];
}

/** One block as last written to or read from the store. */
export interface FlatBlock {
  id: string;
  parentId: string | null;
  sortKey: string;
  type: BlockType;
  props: Record<string, string | number | boolean>;
  content: unknown;
}

export type Snapshot = Map<string, FlatBlock>;

export interface BlockWrite {
  id: string;
  fields: Partial<Omit<Block, 'id'>>;
}

const knownType = (t: unknown): t is BlockType => typeof t === 'string' && (blockTypes as readonly string[]).includes(t);

/** Live blocks of a page from the store, with defaults for fields that have not arrived yet. */
export function liveBlocks(rows: Stored<Block>[]): FlatBlock[] {
  return rows
    .filter((r) => !r.deleted && knownType(r.type))
    .map((r) => ({
      id: r.id,
      parentId: r.parentId ?? null,
      sortKey: r.sortKey ?? 'a0',
      type: r.type!,
      props: r.props ?? {},
      content: r.content ?? [],
    }));
}

export function toSnapshot(blocks: FlatBlock[]): Snapshot {
  return new Map(blocks.map((b) => [b.id, b]));
}

const order = (a: FlatBlock, b: FlatBlock) => (a.sortKey !== b.sortKey ? (a.sortKey < b.sortKey ? -1 : 1) : a.id < b.id ? -1 : 1);

/**
 * Builds the editor tree. A block whose parent is missing goes to the top level, and parent cycles
 * (possible after concurrent moves) are broken at the smallest id, the same way on every device.
 */
export function buildDocument(blocks: FlatBlock[]): DocBlock[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const parent = new Map<string, string | null>();
  for (const b of blocks) parent.set(b.id, b.parentId && byId.has(b.parentId) ? b.parentId : null);
  for (const start of byId.keys()) {
    const path: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = start;
    while (cur !== null && !seen.has(cur)) {
      path.push(cur);
      seen.add(cur);
      cur = parent.get(cur) ?? null;
    }
    if (cur !== null) {
      const cycle = path.slice(path.indexOf(cur));
      parent.set(cycle.reduce((m, id) => (id < m ? id : m)), null);
    }
  }
  const children = new Map<string | null, FlatBlock[]>();
  for (const b of blocks) {
    const key = parent.get(b.id) ?? null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(b);
  }
  const build = (pid: string | null): DocBlock[] =>
    (children.get(pid) ?? []).sort(order).map((b) => ({
      id: b.id,
      type: b.type,
      props: { ...b.props },
      content: b.type === 'divider' ? undefined : b.content,
      children: build(b.id),
    }));
  return build(null);
}

function cleanProps(props: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * Compares the editor document with the snapshot of what is stored and returns the writes needed.
 * Sort keys are kept where the order still holds, so moving one block rewrites only that block.
 */
export function diffDocument(
  pageId: string,
  snapshot: Snapshot,
  doc: DocBlock[],
): { writes: BlockWrite[]; next: Snapshot } {
  const next: Snapshot = new Map();
  const writes: BlockWrite[] = [];

  const visit = (siblings: DocBlock[], parentId: string | null) => {
    const list = siblings.filter((b) => knownType(b.type));
    const keys = assignSortKeys(list.map((b) => snapshot.get(b.id)).map((old) => (old && old.parentId === parentId ? old.sortKey : null)));
    list.forEach((block, i) => {
      const old = snapshot.get(block.id);
      const sortKey = keys[i]!;

      const flat: FlatBlock = {
        id: block.id,
        parentId,
        sortKey,
        type: block.type as BlockType, // filtered by knownType above
        props: cleanProps(block.props),
        content: block.type === 'divider' ? [] : (block.content ?? []),
      };
      next.set(block.id, flat);

      const fields: BlockWrite['fields'] = {};
      if (!old) Object.assign(fields, { pageId, deleted: false });
      if (old?.parentId !== flat.parentId || !old) fields.parentId = flat.parentId;
      if (old?.sortKey !== flat.sortKey) fields.sortKey = flat.sortKey;
      if (old?.type !== flat.type) fields.type = flat.type;
      if (!old || !sameValue(old.props, flat.props)) fields.props = flat.props;
      if (!old || !sameValue(old.content, flat.content)) fields.content = flat.content;
      if (Object.keys(fields).length) writes.push({ id: block.id, fields });

      visit(block.children, block.id);
    });
  };
  visit(doc, null);

  for (const id of snapshot.keys()) {
    if (!next.has(id)) writes.push({ id, fields: { deleted: true } });
  }
  return { writes, next };
}

/**
 * New sort keys for a sibling list, given each block's old key (null = new here).
 * The longest run of old keys that is still in order is kept; only the other blocks get new keys.
 */
export function assignSortKeys(old: (string | null)[]): string[] {
  // Longest strictly increasing subsequence of the old keys (O(n log n) patience sorting).
  const tails: number[] = [];
  const prev = new Array<number>(old.length).fill(-1);
  old.forEach((key, i) => {
    if (key === null) return;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (old[tails[mid]!]! < key) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i !== -1; i = prev[i]!) keep.add(i);

  const out: string[] = [];
  let before: string | null = null;
  old.forEach((key, i) => {
    if (keep.has(i)) {
      out.push(key!);
      before = key;
      return;
    }
    let after: string | null = null;
    for (let j = i + 1; j < old.length; j++) {
      if (keep.has(j)) {
        after = old[j]!;
        break;
      }
    }
    const fresh = keyBetween(before, after);
    out.push(fresh);
    before = fresh;
  });
  return out;
}

/** Plain text of a block's inline content, for search and conflict previews. */
export function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item: unknown) => {
      if (!item || typeof item !== 'object') return '';
      const node = item as { type?: string; text?: unknown; content?: unknown };
      if (typeof node.text === 'string') return node.text;
      if (node.type === 'link') return contentText(node.content);
      return '';
    })
    .join('');
}
