import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { indexPages, normalizePage, visibleChildren } from '../model/pages.ts';
import { parseRoute } from '../router.ts';
import { NonstopDb } from './db.ts';
import { createPage, createQuickNote, INBOX_ID, trashPage } from './pages.ts';
import { LocalStore } from './store.ts';

let n = 0;
const open = async () => LocalStore.open(new NonstopDb(`quick-test-${++n}`));
const pagesOf = async (store: LocalStore) => indexPages((await store.db.page.toArray()).map(normalizePage));

describe('quick note (F-50)', () => {
  it('routes the PWA shortcut path', () => {
    expect(parseRoute('/quick')).toEqual({ name: 'quick' });
  });

  it('creates the Inbox on first use and puts untitled notes in it, in order', async () => {
    const store = await open();
    await createPage(store, await pagesOf(store), null);
    const first = await createQuickNote(store, await pagesOf(store));
    const second = await createQuickNote(store, await pagesOf(store));
    const pages = await pagesOf(store);
    expect(pages.byId.get(INBOX_ID)).toMatchObject({ title: 'Inbox', parentId: null, isFavorite: true });
    expect(visibleChildren(pages, null).at(-1)!.id).toBe(INBOX_ID);
    expect(visibleChildren(pages, INBOX_ID).map((p) => p.id)).toEqual([first, second]);
    expect(pages.byId.get(first)!.title).toBe('');
  });

  it('takes a trashed Inbox out of the trash', async () => {
    const store = await open();
    await createQuickNote(store, await pagesOf(store));
    await trashPage(store, INBOX_ID);
    const note = await createQuickNote(store, await pagesOf(store));
    const pages = await pagesOf(store);
    expect(pages.isTrashed(INBOX_ID)).toBe(false);
    expect(pages.isTrashed(note)).toBe(false);
  });
});
