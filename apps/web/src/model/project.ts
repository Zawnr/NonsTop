// The built-in "Proyek" template (F-40): a page with a Ticket database and an Epic database that
// point at each other. It is a virtual copy source like the other built-in templates, so creating
// a project goes through the same copy plan and every id comes out new.
import type { Database, Page, Property, SelectOption, View } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import type { CopySource } from './copy.ts';

export const PROJECT_ROOT = 'builtin-project';
const TICKET_PAGE = 'builtin-project-ticket';
const EPIC_PAGE = 'builtin-project-epic';
const TICKET_DB = 'builtin-project-ticket-db';
const EPIC_DB = 'builtin-project-epic-db';
export const TICKET_STATUS = 'builtin-project-ticket-status';
const TICKET_POINTS = 'builtin-project-ticket-points';
const TICKET_EPIC = 'builtin-project-ticket-epic';
const EPIC_STATUS = 'builtin-project-epic-status';
const EPIC_TICKETS = 'builtin-project-epic-tickets';

/** Status options keep their ids in copies, so these ids are shared by every project. */
export const TICKET_OPTIONS: SelectOption[] = [
  { id: 'ticket-backlog', name: 'Backlog', color: 'gray', group: 'todo' },
  { id: 'ticket-todo', name: 'To do', color: 'yellow', group: 'todo' },
  { id: 'ticket-doing', name: 'Doing', color: 'blue', group: 'doing' },
  { id: 'ticket-done', name: 'Done', color: 'green', group: 'done' },
];
const EPIC_OPTIONS: SelectOption[] = [
  { id: 'epic-plan', name: 'Rencana', color: 'gray', group: 'todo' },
  { id: 'epic-doing', name: 'Jalan', color: 'blue', group: 'doing' },
  { id: 'epic-done', name: 'Selesai', color: 'green', group: 'done' },
];

const page = (id: string, title: string, parentId: string | null, sortKey: string): Stored<Page> => ({
  id,
  _hlc: {},
  title,
  parentId,
  sortKey,
  deleted: false,
  trashedAt: null,
  databaseId: null,
  isTemplate: false,
});

const database = (id: string, pageId: string, kind: Database['kind']): Database => ({
  id,
  pageId,
  inline: false,
  title: '',
  deleted: false,
  createdAt: 0,
  defaultTemplateId: null,
  kind,
});

const property = (id: string, databaseId: string, name: string, sortKey: string, rest: Pick<Property, 'type' | 'config'>): Property => ({
  id,
  databaseId,
  name,
  sortKey,
  hidden: false,
  deleted: false,
  ...rest,
});

const view = (id: string, databaseId: string, name: string, sortKey: string, rest: Partial<View> = {}): View => ({
  id,
  databaseId,
  name,
  sortKey,
  type: 'table',
  deleted: false,
  filters: [],
  sorts: [],
  groupBy: null,
  hiddenProps: [],
  ...rest,
});

export function projectSource(): { rootId: string; source: CopySource } {
  return {
    rootId: PROJECT_ROOT,
    source: {
      pages: [page(PROJECT_ROOT, 'Proyek', null, 'a0'), page(TICKET_PAGE, 'Ticket', PROJECT_ROOT, 'a0'), page(EPIC_PAGE, 'Epic', PROJECT_ROOT, 'a1')],
      blocks: [],
      databases: [database(TICKET_DB, TICKET_PAGE, 'ticket'), database(EPIC_DB, EPIC_PAGE, null)],
      properties: [
        property(TICKET_STATUS, TICKET_DB, 'Status', 'a0', { type: 'status', config: { options: TICKET_OPTIONS } }),
        property(TICKET_POINTS, TICKET_DB, 'Story point', 'a1', { type: 'number', config: {} }),
        property(TICKET_EPIC, TICKET_DB, 'Epic', 'a2', { type: 'relation', config: { databaseId: EPIC_DB, pairId: EPIC_TICKETS } }),
        property(EPIC_STATUS, EPIC_DB, 'Status', 'a0', { type: 'status', config: { options: EPIC_OPTIONS } }),
        property(EPIC_TICKETS, EPIC_DB, 'Ticket', 'a1', { type: 'relation', config: { databaseId: TICKET_DB, pairId: TICKET_EPIC, reverse: true } }),
      ],
      views: [
        view('builtin-project-v-backlog', TICKET_DB, 'Backlog', 'a0', { filters: [{ propertyId: TICKET_STATUS, op: 'isNot', value: 'ticket-done' }] }),
        view('builtin-project-v-board', TICKET_DB, 'Board', 'a1', { type: 'board', groupBy: TICKET_STATUS }),
        view('builtin-project-v-all', TICKET_DB, 'Semua', 'a2'),
        view('builtin-project-v-epic', EPIC_DB, 'Tabel', 'a0'),
      ],
    },
  };
}
