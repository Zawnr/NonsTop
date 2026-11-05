import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { propField } from '@nonstop/shared';
import { indexDatabases, normalizeDatabase, normalizeProperty, normalizeView } from '../model/database.ts';
import { indexPages, normalizePage, pageTemplates, visibleChildren } from '../model/pages.ts';
import { BUILTIN_TEMPLATES } from '../model/templates.ts';
import { addRowFrom, addRowTemplate, applyTemplate, createFromTemplate, duplicateInlineDatabase, duplicatePage, setDefaultTemplate, setTemplate } from './copy.ts';
import { addProperty, createDatabasePage, createInlineDatabase } from './databases.ts';
import { NonstopDb } from './db.ts';
import { createPage } from './pages.ts';
import { LocalStore } from './store.ts';

let n = 0;
const open = async () => LocalStore.open(new NonstopDb(`copy-test-${++n}`));

async function snapshot(store: LocalStore) {
  const db = store.db;
  const records = await db.page.toArray();
  const pages = indexPages(records.map(normalizePage));
  const databases = indexDatabases(
    (await db.database.toArray()).map(normalizeDatabase),
    (await db.property.toArray()).map(normalizeProperty),
    (await db.view.toArray()).map(normalizeView),
    pages,
    records,
  );
  return { pages, databases };
}

const blocksOf = async (store: LocalStore, pageId: string) =>
  (await store.db.block.where('pageId').equals(pageId).toArray()).filter((b) => !b.deleted).sort((a, b) => (a.sortKey! < b.sortKey! ? -1 : 1));

describe('templates and duplicates', () => {
  it('applies a built-in template to an empty page', async () => {
    const store = await open();
    const id = await createPage(store, (await snapshot(store)).pages, null);
    await applyTemplate(store, (await snapshot(store)).pages, id, { builtin: BUILTIN_TEMPLATES[1]! });
    const blocks = await blocksOf(store, id);
    expect(blocks[0]).toMatchObject({ type: 'heading', content: [{ text: 'Rute' }] });
    expect(blocks.filter((b) => b.type === 'checkListItem').length).toBeGreaterThan(3);
    expect((await snapshot(store)).pages.byId.get(id)!.title).toBe('');
  });

  it('marks a page as template, lists it apart from the tree, and creates pages from it', async () => {
    const store = await open();
    const tpl = await createPage(store, (await snapshot(store)).pages, null);
    await store.write('page', tpl, { title: 'Rapat mingguan' });
    await store.write('block', 'b1', { pageId: tpl, parentId: null, sortKey: 'a0', type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Agenda', styles: {} }], deleted: false });
    await setTemplate(store, tpl, true);
    let { pages } = await snapshot(store);
    expect(pageTemplates(pages).map((p) => p.id)).toEqual([tpl]);
    expect(visibleChildren(pages, null)).toEqual([]);

    const made = await createFromTemplate(store, pages, null, { pageId: tpl });
    ({ pages } = await snapshot(store));
    expect(pages.byId.get(made)).toMatchObject({ title: 'Rapat mingguan', isTemplate: false });
    expect(visibleChildren(pages, null).map((p) => p.id)).toEqual([made]);
    expect((await blocksOf(store, made))[0]!.content).toEqual([{ type: 'text', text: 'Agenda', styles: {} }]);
  });

  it('duplicates a database page with or without its rows, right after the original', async () => {
    const store = await open();
    const pageId = await createDatabasePage(store, (await snapshot(store)).pages, null);
    await store.write('page', pageId, { title: 'Tugas' });
    let { pages, databases } = await snapshot(store);
    const dbId = databases.fullPageOf(pageId)!.id;
    const prop = databases.propertiesOf(dbId)[0]!;
    await addRowFrom(store, pages, databases, dbId, null, { [prop.id]: 'catatan' }, 'Baris 1');
    const other = await createPage(store, (await snapshot(store)).pages, null);

    ({ pages, databases } = await snapshot(store));
    const full = await duplicatePage(store, pages, databases, pageId, true);
    ({ pages, databases } = await snapshot(store));
    const empty = await duplicatePage(store, pages, databases, pageId, false);
    ({ pages, databases } = await snapshot(store));

    expect(visibleChildren(pages, null).map((p) => p.id)).toEqual([pageId, empty, full, other]);
    expect(pages.byId.get(full)!.title).toBe('Tugas (salinan)');
    const copyDb = databases.fullPageOf(full)!;
    const [row] = databases.rowsOf(copyDb.id);
    const copyProp = databases.propertiesOf(copyDb.id)[0]!;
    expect(row).toMatchObject({ title: 'Baris 1' });
    expect(row!.values[propField(copyProp.id)]).toBe('catatan');
    expect(databases.rowsOf(databases.fullPageOf(empty)!.id)).toEqual([]);
    expect(databases.viewsOf(databases.fullPageOf(empty)!.id)).toHaveLength(1);
  });

  it('adds rows from the default row template, with view values on top', async () => {
    const store = await open();
    const pageId = await createDatabasePage(store, (await snapshot(store)).pages, null);
    let s = await snapshot(store);
    const dbId = s.databases.fullPageOf(pageId)!.id;
    const status = await addProperty(store, s.databases, dbId, 'status', 'Status');
    s = await snapshot(store);
    const tpl = await addRowTemplate(store, s.databases, dbId);
    const [todo, doing] = s.databases.property(status)!.config.options!;
    await store.write('page', tpl, { title: 'Bug: ', [propField(status)]: todo!.id });
    await store.write('block', 'tb', { pageId: tpl, parentId: null, sortKey: 'a0', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Langkah reproduksi', styles: {} }], deleted: false });
    await setDefaultTemplate(store, dbId, tpl);
    s = await snapshot(store);
    expect(s.databases.byId.get(dbId)!.defaultTemplateId).toBe(tpl);
    expect(s.databases.rowsOf(dbId)).toEqual([]);

    const row = await addRowFrom(store, s.pages, s.databases, dbId, tpl, { [status]: doing!.id });
    s = await snapshot(store);
    expect(s.databases.rowsOf(dbId).map((r) => r.id)).toEqual([row]);
    expect(s.databases.row(row)).toMatchObject({ title: 'Bug: ', isTemplate: false });
    expect(s.databases.row(row)!.values[propField(status)]).toBe(doing!.id);
    expect((await blocksOf(store, row))[0]!.content).toEqual([{ type: 'text', text: 'Langkah reproduksi', styles: {} }]);
  });

  it('duplicates an inline database into the same page without touching the page', async () => {
    const store = await open();
    const host = await createPage(store, (await snapshot(store)).pages, null);
    await createInlineDatabase(store, 'idb', host);
    await store.write('database', 'idb', { title: 'Barang' });
    await store.write('block', 'hb', { pageId: host, parentId: null, sortKey: 'a0', type: 'database', props: { databaseId: 'idb' }, content: [], deleted: false });
    let s = await snapshot(store);
    await addRowFrom(store, s.pages, s.databases, 'idb', null, {}, 'Jaket');
    s = await snapshot(store);
    const copy = await duplicateInlineDatabase(store, s.pages, s.databases, 'idb', true);
    s = await snapshot(store);
    expect(s.databases.byId.get(copy)).toMatchObject({ pageId: host, inline: true, title: 'Barang (salinan)' });
    expect(s.databases.rowsOf(copy).map((r) => r.title)).toEqual(['Jaket']);
    expect(s.databases.rowsOf('idb').map((r) => r.title)).toEqual(['Jaket']);
    expect(await blocksOf(store, host)).toHaveLength(1); // the editor adds the block itself
  });
});
