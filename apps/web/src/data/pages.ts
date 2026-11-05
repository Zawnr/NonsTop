// Page actions. Every change is a field write through the local store, so it works offline.
import type { Page } from '@nonstop/shared';
import { placeAtEnd, type PageIndex, type Placement } from '../model/pages.ts';
import type { LocalStore } from './store.ts';

export async function createPage(store: LocalStore, index: PageIndex, parentId: string | null): Promise<string> {
  const id = crypto.randomUUID();
  const place = placeAtEnd(index, id, parentId)!;
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
  await store.write('page', id, page);
  return id;
}

/**
 * Renames a page. `baseHlc` is the HLC of the title the user started from (undefined = the stored one).
 * Resolves to the HLC of this write.
 */
export async function renamePage(store: LocalStore, id: string, title: string, baseHlc?: string | null): Promise<string> {
  const opts = baseHlc === undefined ? {} : { prevHlc: { title: baseHlc } };
  return (await store.write('page', id, { title }, opts)).title!;
}

export const movePage = (store: LocalStore, id: string, place: Placement) =>
  store.write('page', id, { parentId: place.parentId, sortKey: place.sortKey });

export const setFavorite = (store: LocalStore, id: string, isFavorite: boolean) => store.write('page', id, { isFavorite });

/** Moves a page to the trash. Its sub-pages go with it, because trash is inherited. */
export const trashPage = (store: LocalStore, id: string) => store.write('page', id, { trashedAt: Date.now() });

/** Restores a page. If its parent is still in the trash, it is restored to the top level. */
export async function restorePage(store: LocalStore, index: PageIndex, id: string): Promise<void> {
  const parentId = index.parentOf(id);
  if (parentId !== null && index.isTrashed(parentId)) {
    const place = placeAtEnd(index, id, null)!;
    await store.write('page', id, { trashedAt: null, parentId: null, sortKey: place.sortKey });
  } else {
    await store.write('page', id, { trashedAt: null });
  }
}

/** Permanently deletes a page and everything below it. Allowed only from the trash (F-09). */
export async function deletePermanently(store: LocalStore, index: PageIndex, id: string): Promise<void> {
  if (!index.isTrashed(id)) throw new Error('Only pages in the trash can be deleted permanently.');
  const ids = [id, ...index.descendants(id).map((p) => p.id)];
  const blocks = await store.db.block.where('pageId').anyOf(ids).primaryKeys();
  // Databases owned by these pages go too. Their rows are below the owner page, so they are in ids.
  const databases = await store.db.database.where('pageId').anyOf(ids).primaryKeys();
  await store.writeMany([
    ...ids.map((pid) => ({ entity: 'page', id: pid, fields: { deleted: true } })),
    ...blocks.map((bid) => ({ entity: 'block', id: bid, fields: { deleted: true } })),
    ...databases.map((did) => ({ entity: 'database', id: did, fields: { deleted: true } })),
  ]);
}

export const resolveConflict = (store: LocalStore, conflictId: string) =>
  store.write('conflict', conflictId, { resolved: true });
