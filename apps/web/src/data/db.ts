// Local database (IndexedDB via Dexie). The device holds a full copy of the data, so every page
// opens and edits offline (F-61). One table per synced entity, plus the outbox and metadata.
import Dexie, { type Table } from 'dexie';
import type { Conflict, FieldOp, Page } from '@nonstop/shared';

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
  conflict!: Table<Stored<Conflict>, string>;
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
  }

  /** The table for a synced entity, or undefined for entities this app version does not know. */
  entityTable(entity: string): Table<Stored<{ id: string }>, string> | undefined {
    if (entity === 'page') return this.page as unknown as Table<Stored<{ id: string }>, string>;
    if (entity === 'conflict') return this.conflict as unknown as Table<Stored<{ id: string }>, string>;
    return undefined;
  }
}
