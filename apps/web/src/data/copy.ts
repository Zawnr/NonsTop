// Duplicates and templates (F-30, F-31, F-32): reads the records a copy needs, plans it with the pure
// copy model, and writes everything in one transaction.
import { propField, type Page } from '@nonstop/shared';
import { planCopy, type CopySource, type CopyTarget } from '../model/copy.ts';
import { keyAfter, normalizeDatabase, normalizeProperty, normalizeView, type DatabaseIndex } from '../model/database.ts';
import { keyBetween, placeAtEnd, visibleChildren, type PageIndex } from '../model/pages.ts';
import { builtinSource, type BuiltinTemplate } from '../model/templates.ts';
import { newId } from './databases.ts';
import type { LocalStore } from './store.ts';

/**
 * Reads the records below `rootIds`: those pages and their blocks, plus databases, properties and
 * views (small tables, also needed for relations that point outside the copy). `extraPages` are
 * read without their blocks or children.
 */
async function readSource(store: LocalStore, pages: PageIndex, rootIds: string[], extraPages: string[] = []): Promise<CopySource> {
  const db = store.db;
  const ids = [...new Set(rootIds.flatMap((id) => [id, ...pages.descendants(id).map((p) => p.id)]))];
  const pageIds = [...new Set([...ids, ...extraPages])];
  return db.transaction('r', [db.page, db.block, db.database, db.property, db.view], async () => ({
    pages: (await db.page.bulkGet(pageIds)).filter((p) => p !== undefined),
    blocks: await db.block.where('pageId').anyOf(ids).toArray(),
    databases: (await db.database.toArray()).map(normalizeDatabase),
    properties: (await db.property.toArray()).map(normalizeProperty),
    views: (await db.view.toArray()).map(normalizeView),
  }));
}

/** Plans and writes a copy. `rootFields` go onto the new root page in the same transaction. */
async function run(store: LocalStore, rootId: string, target: CopyTarget, source: CopySource, withRows: boolean, rootFields: Record<string, unknown> = {}): Promise<string> {
  const plan = planCopy(rootId, target, source, { withRows, newId, now: Date.now() });
  const writes = plan.writes.map((w) => (w.entity === 'page' && w.id === plan.rootId ? { ...w, fields: { ...w.fields, ...rootFields } } : w));
  await store.writeMany(writes);
  return plan.rootId;
}

/** Sort key of the last top-level block of a page, so copied blocks go after it. */
async function lastBlockKey(store: LocalStore, pageId: string): Promise<string | null> {
  const blocks = await store.db.block.where('pageId').equals(pageId).toArray();
  const keys = blocks.filter((b) => !b.deleted && !b.parentId && b.sortKey).map((b) => b.sortKey!);
  return keys.sort().at(-1) ?? null;
}

/**
 * Duplicates a page right after itself, with everything below it (F-32). A row is duplicated in its
 * database. `withRows` = false copies databases without their rows. Returns the new page id.
 */
export async function duplicatePage(store: LocalStore, pages: PageIndex, databases: DatabaseIndex, pageId: string, withRows: boolean): Promise<string> {
  const page = pages.byId.get(pageId);
  if (!page) throw new Error('Page not found');
  const parentId = pages.parentOf(pageId);
  const siblings = page.databaseId ? databases.rowsOf(page.databaseId) : visibleChildren(pages, parentId);
  const i = siblings.findIndex((p) => p.id === pageId);
  const sortKey = keyBetween(page.sortKey, siblings[i + 1]?.sortKey ?? null);
  const title = page.title ? `${page.title} (salinan)` : '';
  const source = await readSource(store, pages, [pageId]);
  return run(store, pageId, { kind: 'new', parentId, sortKey, title, isTemplate: page.isTemplate }, source, withRows);
}

/** A template to apply: built-in, or a page marked as template (F-30). */
export type TemplateRef = { builtin: BuiltinTemplate } | { pageId: string };

async function templateSource(store: LocalStore, pages: PageIndex, ref: TemplateRef) {
  if ('builtin' in ref) return builtinSource(ref.builtin);
  return { rootId: ref.pageId, source: await readSource(store, pages, [ref.pageId]) };
}

/** Fills an existing (empty) page with a template's content. Its title stays. */
export async function applyTemplate(store: LocalStore, pages: PageIndex, pageId: string, ref: TemplateRef): Promise<void> {
  const { rootId, source } = await templateSource(store, pages, ref);
  await run(store, rootId, { kind: 'existing', pageId, lastBlockKey: await lastBlockKey(store, pageId) }, source, true);
}

/** Creates a page from a template at the end of `parentId`. Returns the new page id. */
export async function createFromTemplate(store: LocalStore, pages: PageIndex, parentId: string | null, ref: TemplateRef): Promise<string> {
  const { rootId, source } = await templateSource(store, pages, ref);
  const title = 'builtin' in ref ? '' : (pages.byId.get(ref.pageId)?.title ?? '');
  const sortKey = placeAtEnd(pages, '', parentId)!.sortKey;
  return run(store, rootId, { kind: 'new', parentId, sortKey, title, isTemplate: false }, source, true);
}

export const setTemplate = (store: LocalStore, pageId: string, isTemplate: boolean) => store.write('page', pageId, { isTemplate });

/**
 * Adds a row (F-31): a copy of a row template when given, else an empty row. `values` (property id
 * to value) go on top, for the filters of the view or the board column it was added in.
 */
export async function addRowFrom(
  store: LocalStore,
  pages: PageIndex,
  databases: DatabaseIndex,
  databaseId: string,
  templateId: string | null,
  values: Record<string, unknown> = {},
  title = '',
): Promise<string> {
  const db = databases.byId.get(databaseId);
  if (!db) throw new Error('Database not found');
  const sortKey = keyAfter(databases.rowsOf(databaseId));
  const fields = Object.fromEntries(Object.entries(values).map(([prop, v]) => [propField(prop), v]));
  const template = templateId ? databases.templatesOf(databaseId).find((t) => t.id === templateId) : undefined;
  if (template) {
    const source = await readSource(store, pages, [template.id]);
    return run(store, template.id, { kind: 'new', parentId: db.pageId, sortKey, title: title || template.title, isTemplate: false }, source, true, fields);
  }
  const id = newId();
  const page: Omit<Page, 'id'> = {
    title,
    parentId: db.pageId,
    sortKey,
    isFavorite: false,
    trashedAt: null,
    deleted: false,
    createdAt: Date.now(),
    databaseId,
    isTemplate: false,
  };
  await store.write('page', id, { ...page, ...fields });
  return id;
}

/** A new, empty row template. Returns its page id. */
export async function addRowTemplate(store: LocalStore, databases: DatabaseIndex, databaseId: string): Promise<string> {
  const db = databases.byId.get(databaseId);
  if (!db) throw new Error('Database not found');
  const id = newId();
  const page: Omit<Page, 'id'> = {
    title: '',
    parentId: db.pageId,
    sortKey: keyAfter(databases.templatesOf(databaseId)),
    isFavorite: false,
    trashedAt: null,
    deleted: false,
    createdAt: Date.now(),
    databaseId,
    isTemplate: true,
  };
  await store.write('page', id, page);
  return id;
}

export const setDefaultTemplate = (store: LocalStore, databaseId: string, templateId: string | null) =>
  store.write('database', databaseId, { defaultTemplateId: templateId });

/**
 * Copies one inline database into the same page (F-32): properties, views, row templates and,
 * when asked, rows. The editor then inserts a block for it. Returns the new database id.
 */
export async function duplicateInlineDatabase(store: LocalStore, pages: PageIndex, databases: DatabaseIndex, databaseId: string, withRows: boolean): Promise<string> {
  const db = databases.byId.get(databaseId);
  if (!db) throw new Error('Database not found');
  const rows = [...databases.rowsOf(databaseId), ...databases.templatesOf(databaseId)].map((r) => r.id);
  const full = await readSource(store, pages, rows, [db.pageId]);
  const keep = new Set(rows.flatMap((id) => [id, ...pages.descendants(id).map((p) => p.id)]));
  // Only this database and its rows: the owner page's own blocks and other children stay out.
  const source: CopySource = {
    ...full,
    pages: full.pages.filter((p) => p.id === db.pageId || keep.has(p.id)),
    blocks: full.blocks.filter((b) => b.pageId !== db.pageId),
    databases: full.databases.filter((d) => d.id === databaseId),
  };
  const plan = planCopy(db.pageId, { kind: 'existing', pageId: db.pageId, lastBlockKey: null }, source, { withRows, newId, now: Date.now() });
  const copy = plan.writes.find((w) => w.entity === 'database')!;
  copy.fields.title = db.title ? `${db.title} (salinan)` : '';
  await store.writeMany(plan.writes);
  return copy.id;
}
