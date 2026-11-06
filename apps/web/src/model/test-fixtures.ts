// Record builders for unit tests of the page and database models.
import type { Database, Page, Property, View } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { indexDatabases } from './database.ts';
import { indexPages, normalizePage } from './pages.ts';

export const page = (id: string, over: Partial<Page> & Record<string, unknown> = {}): Stored<Page> => ({
  id,
  _hlc: {},
  title: id,
  parentId: null,
  sortKey: 'a0',
  isFavorite: false,
  trashedAt: null,
  deleted: false,
  createdAt: 0,
  databaseId: null,
  isTemplate: false,
  ...over,
});

export const db = (id: string, pageId: string, over: Partial<Database> = {}): Database => ({
  id,
  pageId,
  inline: false,
  title: '',
  deleted: false,
  createdAt: 0,
  defaultTemplateId: null,
  ...over,
});

export const prop = (id: string, databaseId: string, over: Partial<Property> = {}): Property => ({
  id,
  databaseId,
  name: id,
  type: 'text',
  config: {},
  sortKey: 'a0',
  hidden: false,
  deleted: false,
  ...over,
});

export const view = (id: string, databaseId: string, over: Partial<View> = {}): View => ({
  id,
  databaseId,
  name: id,
  type: 'table',
  sortKey: 'a0',
  deleted: false,
  filters: [],
  sorts: [],
  groupBy: null,
  hiddenProps: null,
  ...over,
});

export function build(records: Stored<Page>[], dbs: Database[], props: Property[] = [], views: View[] = []) {
  const pages = indexPages(records.map(normalizePage));
  return { pages, index: indexDatabases(dbs, props, views, pages, records) };
}

export const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
