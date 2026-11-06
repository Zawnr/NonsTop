import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { propField } from '@nonstop/shared';
import { indexDatabases, normalizeDatabase, normalizeProperty, normalizeView } from '../model/database.ts';
import { indexPages, normalizePage } from '../model/pages.ts';
import { ticketDatabases, ticketsFrom, ticketStatus } from '../model/tickets.ts';
import { NonstopDb } from './db.ts';
import { createPage, trashPage } from './pages.ts';
import { LocalStore } from './store.ts';
import { convertToTicket, createProject } from './tickets.ts';

let n = 0;
const open = async () => LocalStore.open(new NonstopDb(`tickets-test-${++n}`));

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

const checklist = (store: LocalStore, id: string, pageId: string, text: string) =>
  store.write('block', id, { pageId, parentId: null, sortKey: 'a0', type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text, styles: {} }], deleted: false });

describe('project template (F-40)', () => {
  it('creates Ticket and Epic databases that point at each other, with backlog and board views', async () => {
    const store = await open();
    const root = await createProject(store, (await snapshot(store)).pages, null);
    const { pages, databases } = await snapshot(store);
    expect(pages.byId.get(root)!.title).toBe('Proyek');
    const children = pages.childrenOf(root).map((p) => p.title);
    expect(children).toEqual(['Ticket', 'Epic']);

    const [ticket] = ticketDatabases(databases, pages);
    expect(ticket).toBeDefined();
    expect(pages.byId.get(ticket!.pageId)!.title).toBe('Ticket');
    const props = databases.propertiesOf(ticket!.id);
    expect(props.map((p) => [p.name, p.type])).toEqual([
      ['Status', 'status'],
      ['Story point', 'number'],
      ['Epic', 'relation'],
    ]);
    const epicDb = databases.byId.get(props[2]!.config.databaseId!)!;
    expect(epicDb.kind).toBeNull();
    const reverse = databases.property(props[2]!.config.pairId!)!;
    expect(reverse).toMatchObject({ name: 'Ticket', databaseId: epicDb.id, config: { reverse: true, databaseId: ticket!.id } });

    const views = databases.viewsOf(ticket!.id);
    expect(views.map((v) => [v.name, v.type])).toEqual([
      ['Backlog', 'table'],
      ['Board', 'board'],
      ['Semua', 'table'],
    ]);
    const status = ticketStatus(databases, ticket!.id)!;
    expect(views[0]!.filters).toEqual([{ propertyId: status.id, op: 'isNot', value: 'ticket-done' }]);
    expect(views[1]!.groupBy).toBe(status.id);
  });

  it('gives every project its own databases', async () => {
    const store = await open();
    await createProject(store, (await snapshot(store)).pages, null);
    await createProject(store, (await snapshot(store)).pages, null);
    const { pages, databases } = await snapshot(store);
    expect(new Set(ticketDatabases(databases, pages).map((d) => d.id)).size).toBe(2);
  });

  it('leaves trashed projects out of the ticket targets', async () => {
    const store = await open();
    const root = await createProject(store, (await snapshot(store)).pages, null);
    await trashPage(store, root);
    const { pages, databases } = await snapshot(store);
    expect(ticketDatabases(databases, pages)).toEqual([]);
  });
});

describe('convert to ticket (F-41)', () => {
  it('turns a checklist item into a backlog ticket and links the item to it', async () => {
    const store = await open();
    await createProject(store, (await snapshot(store)).pages, null);
    const idea = await createPage(store, (await snapshot(store)).pages, null);
    await checklist(store, 'item1', idea, '  Rapikan   sidebar ');
    let { pages, databases } = await snapshot(store);
    const target = ticketDatabases(databases, pages)[0]!;

    const ticket = await convertToTicket(store, pages, databases, target.id, { pageId: idea, blockId: 'item1' });
    ({ pages, databases } = await snapshot(store));
    const row = databases.rowsOf(target.id).find((r) => r.id === ticket)!;
    expect(row).toMatchObject({ title: 'Rapikan sidebar', sourceId: idea, sourceBlockId: 'item1' });
    expect(row.values[propField(ticketStatus(databases, target.id)!.id)]).toBe('ticket-backlog');
    expect(ticketsFrom(pages, idea).map((p) => p.id)).toEqual([ticket]);

    const block = await store.db.block.get('item1');
    expect(block!.content).toEqual([
      { type: 'text', text: '  Rapikan   sidebar ', styles: {} },
      { type: 'text', text: ' ', styles: {} },
      { type: 'link', href: `/p/${ticket}`, content: [{ type: 'text', text: '→ Rapikan sidebar', styles: {} }] },
    ]);
  });

  it('takes the title of an idea page and leaves the page unchanged', async () => {
    const store = await open();
    await createProject(store, (await snapshot(store)).pages, null);
    const idea = await createPage(store, (await snapshot(store)).pages, null);
    await store.write('page', idea, { title: 'Mode gelap' });
    let { pages, databases } = await snapshot(store);
    const target = ticketDatabases(databases, pages)[0]!;
    const ticket = await convertToTicket(store, pages, databases, target.id, { pageId: idea });
    ({ pages } = await snapshot(store));
    expect(pages.byId.get(ticket)).toMatchObject({ title: 'Mode gelap', sourceId: idea, sourceBlockId: null, databaseId: target.id });
    expect(pages.byId.get(idea)!.title).toBe('Mode gelap');
  });

  it('keeps the earlier ticket link out of the title when an item is converted again', async () => {
    const store = await open();
    await createProject(store, (await snapshot(store)).pages, null);
    const idea = await createPage(store, (await snapshot(store)).pages, null);
    await checklist(store, 'item1', idea, 'Uji restore');
    let { pages, databases } = await snapshot(store);
    const target = ticketDatabases(databases, pages)[0]!;
    await convertToTicket(store, pages, databases, target.id, { pageId: idea, blockId: 'item1' });
    ({ pages, databases } = await snapshot(store));
    const second = await convertToTicket(store, pages, databases, target.id, { pageId: idea, blockId: 'item1' });
    ({ pages } = await snapshot(store));
    expect(pages.byId.get(second)!.title).toBe('Uji restore');
    const links = ((await store.db.block.get('item1'))!.content as { type: string }[]).filter((c) => c.type === 'link');
    expect(links).toHaveLength(2);
  });
});
