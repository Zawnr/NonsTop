// Copying a page with everything below it (F-30, F-31, F-32): sub-pages, blocks, databases with
// their properties, views, row templates and, when asked, rows. Every id is mapped to a new one, so
// the copy is independent of the original. Pure: takes stored records, returns the writes.
import { PROP_PREFIX, propField, type Block, type Database, type Page, type Property, type View } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { keyBetween } from './pages.ts';

export interface CopyWrite {
  entity: 'page' | 'block' | 'database' | 'property' | 'view';
  id: string;
  fields: Record<string, unknown>;
}

export interface CopySource {
  /** Every stored page (the tree below the root is found from them). */
  pages: Stored<Page>[];
  /** Blocks of the copied pages (others are ignored). */
  blocks: Stored<Block>[];
  databases: Database[];
  properties: Property[];
  views: View[];
}

export type CopyTarget =
  /** A new page at this place (duplicate). */
  | { kind: 'new'; parentId: string | null; sortKey: string; title: string; isTemplate: boolean }
  /** Into an existing page: its title stays, the source's content goes after its own (apply a template). */
  | { kind: 'existing'; pageId: string; lastBlockKey: string | null };

export interface CopyOptions {
  /** Copy the rows of databases. Row templates are structure and always come along. */
  withRows: boolean;
  newId: () => string;
  now: number;
}

export interface CopyPlan {
  /** Id of the page that received the copy. */
  rootId: string;
  writes: CopyWrite[];
}

const live = (p: Stored<Page>) => !p.deleted && p.trashedAt == null;

/** Plans a copy of `rootId` and everything below it. */
export function planCopy(rootId: string, target: CopyTarget, src: CopySource, opts: CopyOptions): CopyPlan {
  const { newId } = opts;
  const pageById = new Map(src.pages.map((p) => [p.id, p]));
  const children = new Map<string, Stored<Page>[]>();
  for (const p of src.pages) {
    if (!live(p) || !p.parentId) continue;
    if (!children.has(p.parentId)) children.set(p.parentId, []);
    children.get(p.parentId)!.push(p);
  }

  // Pages to copy: the root and its live descendants. Rows are left out (with what is below them)
  // when only the structure is wanted; row templates stay.
  const copied: Stored<Page>[] = [];
  const seen = new Set<string>();
  const walk = (p: Stored<Page>) => {
    if (seen.has(p.id)) return; // a parent cycle from concurrent moves
    seen.add(p.id);
    copied.push(p);
    for (const c of children.get(p.id) ?? []) {
      if (!opts.withRows && c.databaseId && !c.isTemplate) continue;
      walk(c);
    }
  };
  const root = pageById.get(rootId);
  if (!root) throw new Error('Page not found');
  walk(root);

  const pageMap = new Map(copied.map((p) => [p.id, p.id === rootId && target.kind === 'existing' ? target.pageId : newId()]));
  const copiedIds = new Set(copied.map((p) => p.id));
  const dbs = src.databases.filter((d) => !d.deleted && copiedIds.has(d.pageId));
  const dbMap = new Map(dbs.map((d) => [d.id, newId()]));
  const props = src.properties.filter((p) => !p.deleted && dbMap.has(p.databaseId));
  // A reverse relation to a database outside the copy has no values of its own (they live on the
  // other side), so it is left out. Every other property is copied.
  const kept = props.filter((p) => !(p.type === 'relation' && p.config.reverse && !dbMap.has(p.config.databaseId ?? '')));
  const propMap = new Map(kept.map((p) => [p.id, newId()]));
  const writes: CopyWrite[] = [];

  const mapId = (map: Map<string, string>, id: string) => map.get(id) ?? id;

  for (const d of dbs) {
    writes.push({
      entity: 'database',
      id: dbMap.get(d.id)!,
      fields: {
        pageId: pageMap.get(d.pageId)!,
        inline: d.inline,
        title: d.title,
        deleted: false,
        createdAt: opts.now,
        defaultTemplateId: d.defaultTemplateId && pageMap.has(d.defaultTemplateId) ? pageMap.get(d.defaultTemplateId)! : null,
        kind: d.kind ?? null,
      },
    });
  }

  // Sort keys for reverse properties added to databases outside the copy, after their last property.
  const lastKey = new Map<string, string | null>();
  const keyIn = (databaseId: string) => {
    if (!lastKey.has(databaseId)) {
      const list = src.properties.filter((p) => !p.deleted && p.databaseId === databaseId).map((p) => p.sortKey).sort();
      lastKey.set(databaseId, list.at(-1) ?? null);
    }
    const key = keyBetween(lastKey.get(databaseId)!, null);
    lastKey.set(databaseId, key);
    return key;
  };

  for (const p of kept) {
    const id = propMap.get(p.id)!;
    let config = p.config;
    if (p.type === 'relation' && p.config.databaseId) {
      if (dbMap.has(p.config.databaseId)) {
        config = { ...p.config, databaseId: dbMap.get(p.config.databaseId)!, pairId: p.config.pairId ? mapId(propMap, p.config.pairId) : undefined };
      } else {
        // A relation to a database outside the copy: the copy gets its own reverse property there.
        const pairId = newId();
        config = { databaseId: p.config.databaseId, pairId };
        const pair = p.config.pairId ? src.properties.find((x) => x.id === p.config.pairId) : undefined;
        writes.push({
          entity: 'property',
          id: pairId,
          fields: {
            databaseId: p.config.databaseId,
            name: `${pair?.name || 'Relation'} (salinan)`,
            type: 'relation',
            config: { databaseId: dbMap.get(p.databaseId)!, pairId: id, reverse: true },
            sortKey: keyIn(p.config.databaseId),
            hidden: pair?.hidden ?? false,
            deleted: false,
          },
        });
      }
    }
    writes.push({
      entity: 'property',
      id,
      fields: { databaseId: dbMap.get(p.databaseId)!, name: p.name, type: p.type, config, sortKey: p.sortKey, hidden: p.hidden, deleted: false },
    });
  }

  for (const v of src.views.filter((x) => !x.deleted && dbMap.has(x.databaseId))) {
    writes.push({
      entity: 'view',
      id: newId(),
      fields: {
        databaseId: dbMap.get(v.databaseId)!,
        name: v.name,
        type: v.type,
        sortKey: v.sortKey,
        deleted: false,
        filters: v.filters.map((f) => ({ ...f, propertyId: mapId(propMap, f.propertyId), value: typeof f.value === 'string' ? mapId(pageMap, f.value) : f.value })),
        sorts: v.sorts.map((s) => ({ ...s, propertyId: mapId(propMap, s.propertyId) })),
        groupBy: v.groupBy ? mapId(propMap, v.groupBy) : null,
        hiddenProps: v.hiddenProps ? v.hiddenProps.map((id) => mapId(propMap, id)) : null,
      },
    });
  }

  const relationProps = new Set(kept.filter((p) => p.type === 'relation').map((p) => p.id));
  for (const p of copied) {
    const id = pageMap.get(p.id)!;
    if (p.id === rootId && target.kind === 'existing') continue; // the target keeps its own fields
    const isRoot = p.id === rootId && target.kind === 'new';
    const fields: Record<string, unknown> = {
      title: isRoot ? target.title : (p.title ?? ''),
      parentId: isRoot ? target.parentId : p.parentId ? mapId(pageMap, p.parentId) : null,
      sortKey: isRoot ? target.sortKey : (p.sortKey ?? 'a0'),
      isFavorite: false,
      trashedAt: null,
      deleted: false,
      createdAt: opts.now,
      // A row whose database is not part of the copy (a duplicated row, a row from a template)
      // stays in that database.
      databaseId: p.databaseId ? (dbMap.get(p.databaseId) ?? p.databaseId) : null,
      isTemplate: isRoot ? target.isTemplate : (p.isTemplate ?? false),
    };
    // Property values follow their properties. Relation values pointing at copied rows follow them.
    // A row staying in its database keeps its property ids.
    const ownDb = !!p.databaseId && !dbMap.has(p.databaseId);
    for (const [field, value] of Object.entries(p)) {
      if (!field.startsWith(PROP_PREFIX)) continue;
      const propId = field.slice(PROP_PREFIX.length);
      if (ownDb) {
        fields[field] = value;
        continue;
      }
      if (!propMap.has(propId)) continue;
      fields[propField(propMap.get(propId)!)] =
        relationProps.has(propId) && Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? mapId(pageMap, v) : v)) : value;
    }
    writes.push({ entity: 'page', id, fields });
  }

  // Blocks. Into an existing page, the root's top-level blocks go after the page's own.
  const blocks = src.blocks.filter((b) => !b.deleted && b.pageId && copiedIds.has(b.pageId));
  const blockMap = new Map(blocks.map((b) => [b.id, newId()]));
  const rootTop = blocks.filter((b) => b.pageId === rootId && !(b.parentId && blockMap.has(b.parentId))).sort((a, b) => ((a.sortKey ?? '') < (b.sortKey ?? '') ? -1 : 1));
  const rekey = new Map<string, string>();
  if (target.kind === 'existing') {
    let prev = target.lastBlockKey;
    for (const b of rootTop) rekey.set(b.id, (prev = keyBetween(prev, null)));
  }
  for (const b of blocks) {
    const props = { ...(b.props ?? {}) };
    if (b.type === 'database') {
      const dbId = typeof props.databaseId === 'string' ? dbMap.get(props.databaseId) : undefined;
      if (!dbId) continue; // a database that belongs to another page or no longer exists
      props.databaseId = dbId;
    }
    writes.push({
      entity: 'block',
      id: blockMap.get(b.id)!,
      fields: {
        pageId: pageMap.get(b.pageId!)!,
        parentId: b.parentId && blockMap.has(b.parentId) ? blockMap.get(b.parentId)! : null,
        sortKey: rekey.get(b.id) ?? b.sortKey ?? 'a0',
        type: b.type ?? 'paragraph',
        props,
        content: b.content ?? [],
        deleted: false,
      },
    });
  }

  return { rootId: pageMap.get(rootId)!, writes };
}
