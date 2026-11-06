// Tickets (F-40, F-41): which databases take tickets, the status a new ticket starts in, and the
// links between a ticket and the idea page or checklist item it came from. Pure.
import type { Database, Page, Property } from '@nonstop/shared';
import type { DatabaseIndex } from './database.ts';
import { UNTITLED, type PageIndex } from './pages.ts';

/** Databases marked as ticket databases, outside the trash and outside page templates. */
export function ticketDatabases(dbs: DatabaseIndex, pages: PageIndex): Database[] {
  const inTemplate = (pageId: string) => [pages.byId.get(pageId), ...pages.ancestors(pageId)].some((p) => p?.isTemplate);
  return [...dbs.byId.values()].filter((d) => d.kind === 'ticket' && pages.byId.has(d.pageId) && !pages.isTrashed(d.pageId) && !inTemplate(d.pageId));
}

/** The status property of a ticket database: the first status property. */
export function ticketStatus(dbs: DatabaseIndex, databaseId: string): Property | undefined {
  return dbs.propertiesOf(databaseId).find((p) => p.type === 'status');
}

/** The option a new ticket starts in: "Backlog" when it exists, else the first to-do option. */
export function startOption(status: Property): string | null {
  const options = status.config.options ?? [];
  const pick = options.find((o) => o.name.trim().toLowerCase() === 'backlog') ?? options.find((o) => o.group === 'todo') ?? options[0];
  return pick?.id ?? null;
}

/** Live tickets made from this page (or from one checklist item on it), oldest first. */
export function ticketsFrom(pages: PageIndex, sourceId: string, blockId?: string | null): Page[] {
  return [...pages.byId.values()]
    .filter((p) => p.sourceId === sourceId && (blockId === undefined || p.sourceBlockId === blockId) && p.databaseId !== null && !pages.isTrashed(p.id))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

/** The title a ticket gets from a checklist item: its text, trimmed and shortened. */
export function ticketTitle(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

type Inline = { type: string; [key: string]: unknown };

/** Label of the link a ticket leaves on its checklist item. */
export const ticketLinkLabel = (title: string) => `→ ${title || UNTITLED}`;

/**
 * A checklist item's content with a link to the ticket at the end. Content that already links to
 * this ticket is returned unchanged. Each new ticket from the same item adds its own link.
 */
export function withTicketLink(content: unknown, ticketId: string, title: string): Inline[] {
  const list = Array.isArray(content) ? (content as Inline[]) : [];
  const href = `/p/${ticketId}`;
  if (list.some((c) => c.type === 'link' && c.href === href)) return list;
  const label = ticketLinkLabel(title);
  return [...list, { type: 'text', text: ' ', styles: {} }, { type: 'link', href, content: [{ type: 'text', text: label, styles: {} }] }];
}
