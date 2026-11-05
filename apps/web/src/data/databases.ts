// Database actions (F-10, F-13, F-15). Every change is a field write through the local store.
import { propField, type Database, type Page, type Property, type PropertyConfig, type PropertyType, type SelectOption, type ViewType } from '@nonstop/shared';
import { defaultConfig, keyAfter, relationWrites, type DatabaseIndex, type Row } from '../model/database.ts';
import { placeAtEnd, type PageIndex } from '../model/pages.ts';
import type { LocalStore } from './store.ts';

export const newId = () => crypto.randomUUID();

type Write = Parameters<LocalStore['writeMany']>[0][number];

const VIEW_NAMES: Record<ViewType, string> = { table: 'Tabel', list: 'List' };

/** A new database with a "Tabel" view and one text property, so the table has a second column. */
function databaseWrites(id: string, pageId: string, inline: boolean): Write[] {
  const db: Omit<Database, 'id'> = { pageId, inline, title: '', deleted: false, createdAt: Date.now() };
  return [
    { entity: 'database', id, fields: db },
    { entity: 'view', id: newId(), fields: { databaseId: id, name: VIEW_NAMES.table, type: 'table', sortKey: 'a0', deleted: false } },
    {
      entity: 'property',
      id: newId(),
      fields: { databaseId: id, name: 'Catatan', type: 'text', config: {}, sortKey: 'a0', hidden: false, deleted: false },
    },
  ];
}

/** Creates a full-page database as a new page under `parentId` (F-10). Returns the page id. */
export async function createDatabasePage(store: LocalStore, pages: PageIndex, parentId: string | null): Promise<string> {
  const pageId = newId();
  const place = placeAtEnd(pages, pageId, parentId)!;
  const page: Omit<Page, 'id'> = {
    title: '',
    parentId: place.parentId,
    sortKey: place.sortKey,
    isFavorite: false,
    trashedAt: null,
    deleted: false,
    createdAt: Date.now(),
    databaseId: null,
  };
  await store.writeMany([{ entity: 'page', id: pageId, fields: page }, ...databaseWrites(newId(), pageId, false)]);
  return pageId;
}

/** Creates an inline database owned by a page. The editor block that shows it holds `id`. */
export const createInlineDatabase = (store: LocalStore, id: string, pageId: string) => store.writeMany(databaseWrites(id, pageId, true));

export const renameDatabase = (store: LocalStore, id: string, title: string) => store.write('database', id, { title });

/** Adds a row as a page below the database's owner page, so trash and delete follow the owner. */
export async function addRow(store: LocalStore, index: DatabaseIndex, databaseId: string, title = ''): Promise<string> {
  const db = index.byId.get(databaseId);
  if (!db) throw new Error('Database not found');
  const id = newId();
  const page: Omit<Page, 'id'> = {
    title,
    parentId: db.pageId,
    sortKey: keyAfter(index.rowsOf(databaseId)),
    isFavorite: false,
    trashedAt: null,
    deleted: false,
    createdAt: Date.now(),
    databaseId,
  };
  await store.write('page', id, page);
  return id;
}

export const setValue = (store: LocalStore, rowId: string, propertyId: string, value: unknown) =>
  store.write('page', rowId, { [propField(propertyId)]: value });

/** Links or unlinks a row through a relation property, on whichever side holds the value. */
export async function setRelation(store: LocalStore, index: DatabaseIndex, prop: Property, row: Row, otherId: string, linked: boolean) {
  const writes = relationWrites(index, prop, row, otherId, linked);
  if (writes.length) await store.writeMany(writes.map((w) => ({ entity: 'page', id: w.rowId, fields: { [w.field]: w.value } })));
}

/**
 * Adds a property at the end. A relation also gets its reverse property in the target database,
 * so the link shows on both sides (F-15). Returns the new property id.
 */
export async function addProperty(
  store: LocalStore,
  index: DatabaseIndex,
  databaseId: string,
  type: PropertyType,
  name: string,
  target?: { databaseId: string; reverseName: string },
): Promise<string> {
  const id = newId();
  const base = { databaseId, name, type, sortKey: keyAfter(index.propertiesOf(databaseId)), hidden: false, deleted: false };
  if (type !== 'relation') {
    await store.write('property', id, { ...base, config: defaultConfig(type, newId) });
    return id;
  }
  if (!target) throw new Error('A relation needs a target database');
  const pairId = newId();
  // For a relation to the same database, the reverse goes after the new property.
  const reverseKey = target.databaseId === databaseId ? keyAfter([base]) : keyAfter(index.propertiesOf(target.databaseId));
  await store.writeMany([
    { entity: 'property', id, fields: { ...base, config: { databaseId: target.databaseId, pairId } } },
    {
      entity: 'property',
      id: pairId,
      fields: {
        databaseId: target.databaseId,
        name: target.reverseName,
        type,
        sortKey: reverseKey,
        hidden: false,
        deleted: false,
        config: { databaseId, pairId: id, reverse: true },
      },
    },
  ]);
  return id;
}

export const renameProperty = (store: LocalStore, id: string, name: string) => store.write('property', id, { name });
export const setPropertyHidden = (store: LocalStore, id: string, hidden: boolean) => store.write('property', id, { hidden });
export const movePropertyTo = (store: LocalStore, id: string, sortKey: string) => store.write('property', id, { sortKey });

/** Deletes a property. A relation takes its pair along, since one side alone has no meaning. */
export async function deleteProperty(store: LocalStore, prop: Property) {
  const ids = [prop.id, ...(prop.type === 'relation' && prop.config.pairId ? [prop.config.pairId] : [])];
  await store.writeMany(ids.map((id) => ({ entity: 'property', id, fields: { deleted: true } })));
}

/** Replaces the options of a select, multi-select or status property (F-13). */
export const setOptions = (store: LocalStore, prop: Property, options: SelectOption[]) =>
  store.write('property', prop.id, { config: { ...prop.config, options } satisfies PropertyConfig });

export async function addView(store: LocalStore, index: DatabaseIndex, databaseId: string, type: ViewType): Promise<string> {
  const id = newId();
  await store.write('view', id, { databaseId, name: VIEW_NAMES[type], type, sortKey: keyAfter(index.viewsOf(databaseId)), deleted: false });
  return id;
}

export const renameView = (store: LocalStore, id: string, name: string) => store.write('view', id, { name });
export const deleteView = (store: LocalStore, id: string) => store.write('view', id, { deleted: true });
