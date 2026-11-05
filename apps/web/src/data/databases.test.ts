import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { propField } from '@nonstop/shared';
import { indexDatabases, normalizeDatabase, normalizeProperty, normalizeView } from '../model/database.ts';
import { indexPages, normalizePage } from '../model/pages.ts';
import { addProperty, addRow, createDatabasePage, createInlineDatabase, syncInlineDatabases } from './databases.ts';
import { NonstopDb } from './db.ts';
import { deletePermanently, trashPage } from './pages.ts';
import { LocalStore } from './store.ts';

let n = 0;
const open = async () => LocalStore.open(new NonstopDb(`databases-test-${++n}`));

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

describe('database actions', () => {
  it('creates a full-page database with a table view and one property', async () => {
    const store = await open();
    const pageId = await createDatabasePage(store, (await snapshot(store)).pages, null);
    const { databases } = await snapshot(store);
    const db = databases.fullPageOf(pageId)!;
    expect(databases.viewsOf(db.id).map((v) => v.type)).toEqual(['table']);
    expect(databases.propertiesOf(db.id).map((p) => p.name)).toEqual(['Catatan']);
  });

  it('a relation creates its reverse property in the target database', async () => {
    const store = await open();
    const a = await createDatabasePage(store, (await snapshot(store)).pages, null);
    const b = await createDatabasePage(store, (await snapshot(store)).pages, null);
    let { databases } = await snapshot(store);
    const dbA = databases.fullPageOf(a)!.id;
    const dbB = databases.fullPageOf(b)!.id;
    const id = await addProperty(store, databases, dbA, 'relation', 'Epic', { databaseId: dbB, reverseName: 'Ticket' });
    ({ databases } = await snapshot(store));
    const reverse = databases.propertiesOf(dbB).find((p) => p.type === 'relation')!;
    expect(reverse).toMatchObject({ name: 'Ticket', config: { databaseId: dbA, pairId: id, reverse: true } });
  });

  it('keeps a trashed row and its values readable, and lists rows of a trashed database in the trash view', async () => {
    const store = await open();
    const pageId = await createDatabasePage(store, (await snapshot(store)).pages, null);
    let { databases } = await snapshot(store);
    const dbId = databases.fullPageOf(pageId)!.id;
    const prop = databases.propertiesOf(dbId)[0]!;
    const rowId = await addRow(store, databases, dbId, 'Baris');
    await store.write('page', rowId, { [propField(prop.id)]: 'nilai' });
    await trashPage(store, pageId);
    ({ databases } = await snapshot(store));
    expect(databases.rowsOf(dbId)).toEqual([]);
    expect(databases.rowsOf(dbId, true).map((r) => r.id)).toEqual([rowId]);
    expect(databases.row(rowId)?.values[propField(prop.id)]).toBe('nilai');
  });

  it('permanent delete removes the database with its properties, views and relation pairs elsewhere', async () => {
    const store = await open();
    const a = await createDatabasePage(store, (await snapshot(store)).pages, null);
    const b = await createDatabasePage(store, (await snapshot(store)).pages, null);
    let { databases } = await snapshot(store);
    const dbA = databases.fullPageOf(a)!.id;
    const dbB = databases.fullPageOf(b)!.id;
    await addProperty(store, databases, dbA, 'relation', 'Ke B', { databaseId: dbB, reverseName: 'Dari A' });
    await trashPage(store, a);
    await deletePermanently(store, (await snapshot(store)).pages, a);
    ({ databases } = await snapshot(store));
    expect(databases.byId.has(dbA)).toBe(false);
    expect(databases.propertiesOf(dbB).map((p) => p.name)).toEqual(['Catatan']);
    expect((await store.db.view.where('databaseId').equals(dbA).toArray()).every((v) => v.deleted)).toBe(true);
  });

  it('removing an inline database block deletes the database and its rows leave the index; undo restores it', async () => {
    const store = await open();
    const host = 'host-page';
    await store.write('page', host, { title: 'Host', parentId: null, sortKey: 'a0', deleted: false, trashedAt: null, databaseId: null });
    await createInlineDatabase(store, 'db1', host);
    const rowId = await addRow(store, (await snapshot(store)).databases, 'db1', 'Jaket');

    await syncInlineDatabases(store, host, new Set(['db1']), new Set());
    let { databases } = await snapshot(store);
    expect(databases.byId.has('db1')).toBe(false);
    expect(databases.isOrphanRow(rowId)).toBe(true);

    await syncInlineDatabases(store, host, new Set(), new Set(['db1']));
    ({ databases } = await snapshot(store));
    expect(databases.rowsOf('db1').map((r) => r.id)).toEqual([rowId]);
  });

  it('a block pasted into another page never deletes the database of its owner page', async () => {
    const store = await open();
    await createInlineDatabase(store, 'db1', 'owner');
    await syncInlineDatabases(store, 'other-page', new Set(['db1']), new Set());
    expect((await store.db.database.get('db1'))?.deleted).toBe(false);
  });
});
