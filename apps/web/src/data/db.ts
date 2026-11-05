// Local database (IndexedDB via Dexie). The device holds a full copy of the data, so every page
// opens and edits offline (F-61). One table per synced entity, plus the outbox and metadata.
import Dexie, { type Table } from 'dexie';
import type { Block, Conflict, Database, FieldOp, Page, Property, View } from '@nonstop/shared';

/** A synced record: its fields (possibly incomplete while syncing) and the HLC of each field. */
export type Stored<T extends { id: string }> = Partial<Omit<T, 'id'>> & { id: string; _hlc: Record<string, string> };

export interface OutboxEntry {
  seq?: number;
  op: FieldOp;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export class NonstopDb extends Dexie {
  page!: Table<Stored<Page>, string>;
  block!: Table<Stored<Block>, string>;
  conflict!: Table<Stored<Conflict>, string>;
  database!: Table<Stored<Database>, string>;
  property!: Table<Stored<Property>, string>;
  view!: Table<Stored<View>, string>;
  outbox!: Table<OutboxEntry, number>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'nonstop') {
    super(name);
    this.version(1).stores({
      page: 'id, parentId',
      conflict: 'id, pageId',
      outbox: '++seq',
      meta: 'key',
    });
    this.version(2).stores({ block: 'id, pageId' });
    // Sprint 3: databases. New entities reset the pull cursor (see LocalStore.open), so their
    // records are pulled in full after the update.
    this.version(3).stores({ database: 'id, pageId', property: 'id, databaseId', view: 'id, databaseId' });
  }

  /** Every synced entity table, for transactions that touch any of them. */
  get syncedTables() {
    return [this.page, this.block, this.conflict, this.database, this.property, this.view];
  }

  /** The table for a synced entity, or undefined for entities this app version does not know. */
  entityTable(entity: string): Table<Stored<{ id: string }>, string> | undefined {
    const tables: Record<string, Table> = {
      page: this.page,
      block: this.block,
      conflict: this.conflict,
      database: this.database,
      property: this.property,
      view: this.view,
    };
    return tables[entity] as Table<Stored<{ id: string }>, string> | undefined;
  }
}
