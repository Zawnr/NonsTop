// Ticket actions (F-40, F-41): create a project, and turn an idea page or a checklist item into a
// ticket. The ticket, its status and the link on the checklist item are written in one transaction.
import { propField } from '@nonstop/shared';
import { contentText } from '../model/blocks.ts';
import { keyAfter, type DatabaseIndex } from '../model/database.ts';
import { newPage, type PageIndex } from '../model/pages.ts';
import { BUILTIN_TEMPLATES } from '../model/templates.ts';
import { startOption, ticketStatus, ticketTitle, withTicketLink } from '../model/tickets.ts';
import { createFromTemplate } from './copy.ts';
import { newId } from './databases.ts';
import type { LocalStore } from './store.ts';

const PROJECT = BUILTIN_TEMPLATES.find((t) => t.id === 'builtin-project')!;

/** Creates a "Proyek" page with Ticket and Epic databases at the end of `parentId`. Returns its id. */
export const createProject = (store: LocalStore, pages: PageIndex, parentId: string | null) =>
  createFromTemplate(store, pages, parentId, { builtin: PROJECT });

/** What a ticket is made from: a page, or a checklist item (block) on that page. */
export interface TicketSource {
  pageId: string;
  blockId?: string;
}

/** Text of a checklist item without the ticket links added to it earlier. Other links stay. */
function itemText(content: unknown): string {
  const list: unknown[] = Array.isArray(content) ? content : [];
  const isTicketLink = (c: unknown) => {
    const node = c as { type?: string; href?: unknown; content?: unknown };
    return node?.type === 'link' && typeof node.href === 'string' && node.href.startsWith('/p/') && contentText(node.content).startsWith('→ ');
  };
  return contentText(list.filter((c) => !isTicketLink(c)));
}

/** Creates a ticket in `databaseId` from the source and links them. Returns the ticket id. */
export async function convertToTicket(
  store: LocalStore,
  pages: PageIndex,
  databases: DatabaseIndex,
  databaseId: string,
  source: TicketSource,
): Promise<string> {
  const db = databases.byId.get(databaseId);
  if (!db) throw new Error('Database not found');
  const block = source.blockId ? await store.db.block.get(source.blockId) : undefined;
  if (source.blockId && (!block || block.deleted)) throw new Error('Block not found');
  const title = ticketTitle(block ? itemText(block.content) : (pages.byId.get(source.pageId)?.title ?? ''));

  const id = newId();
  const page = newPage({
    title,
    parentId: db.pageId,
    sortKey: keyAfter(databases.rowsOf(databaseId)),
    databaseId,
    sourceId: source.pageId,
    sourceBlockId: source.blockId ?? null,
  });
  const status = ticketStatus(databases, databaseId);
  const start = status ? startOption(status) : null;
  const fields: Record<string, unknown> = { ...page };
  if (status && start) fields[propField(status.id)] = start;

  await store.writeMany([
    { entity: 'page', id, fields },
    ...(block ? [{ entity: 'block' as const, id: block.id, fields: { content: withTicketLink(block.content, id, title) } }] : []),
  ]);
  return id;
}
