// Sync contracts: which entities and fields exist, and the push/pull wire format.
// The server accepts only fields listed here, each validated by its schema.
import { z } from 'zod';
import { isHlc } from './hlc.ts';

export const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const hlc = z.string().refine(isHlc, 'invalid hlc');
/** Fractional-index key (base62), see the `fractional-indexing` package. */
export const sortKey = z.string().regex(/^[0-9A-Za-z]{1,128}$/);

const timestamp = z.number().int().nonnegative();
/** Any JSON value of bounded size. Used for copies of other fields' values (conflicts). */
const jsonValue = z.unknown().refine((v) => {
  try {
    const s = JSON.stringify(v);
    return s !== undefined && s.length <= 100_000;
  } catch {
    return false;
  }
}, 'invalid json value');

export interface EntityDef {
  fields: Record<string, z.ZodType>;
  /** Fields where a concurrent edit creates a visible "other version" marker. */
  conflictFields: readonly string[];
  /** Fields a client may write. Others are written only by the server. */
  clientFields: readonly string[];
}

const pageFields = {
  title: z.string().max(500),
  parentId: id.nullable(),
  sortKey,
  isFavorite: z.boolean(),
  /** Set when moved to trash. Children of a trashed page count as trashed too. */
  trashedAt: timestamp.nullable(),
  /** Permanent delete. Kept as a tombstone so a late edit cannot bring the page back. */
  deleted: z.boolean(),
  createdAt: timestamp,
};

const conflictFields = {
  /** The entity and field the lost version belongs to. */
  entity: z.string().max(32),
  entityId: id,
  field: z.string().max(64),
  /** The page to show the marker on. */
  pageId: id,
  value: jsonValue,
  hlc,
  deviceId: z.string().max(64),
  createdAt: timestamp,
  resolved: z.boolean(),
};

export const entities = {
  page: {
    fields: pageFields,
    conflictFields: ['title'],
    clientFields: Object.keys(pageFields),
  },
  conflict: {
    fields: conflictFields,
    conflictFields: [],
    clientFields: ['resolved'],
  },
} satisfies Record<string, EntityDef>;

export type EntityName = keyof typeof entities;
export const entityNames = Object.keys(entities) as EntityName[];

export interface Page {
  id: string;
  title: string;
  parentId: string | null;
  sortKey: string;
  isFavorite: boolean;
  trashedAt: number | null;
  deleted: boolean;
  createdAt: number;
}

export interface Conflict {
  id: string;
  entity: string;
  entityId: string;
  field: string;
  pageId: string;
  value: unknown;
  hlc: string;
  deviceId: string;
  createdAt: number;
  resolved: boolean;
}

export const fieldOp = z.object({
  /** Unique per operation. Makes push idempotent when a response is lost and the batch is resent. */
  opId: id,
  entity: z.string().max(32),
  id,
  field: z.string().max(64),
  value: z.unknown(),
  hlc,
  prevHlc: hlc.nullable(),
});
export type FieldOp = z.infer<typeof fieldOp>;

export const MAX_PUSH_OPS = 500;

export const pushRequest = z.object({
  ops: z.array(fieldOp).max(MAX_PUSH_OPS),
});
export type PushRequest = z.infer<typeof pushRequest>;

export interface PushResponse {
  ok: true;
  lastSeq: number;
}

export interface Change {
  seq: number;
  entity: string;
  id: string;
  field: string;
  value: unknown;
  hlc: string;
}

export interface PullResponse {
  changes: Change[];
  lastSeq: number;
  /** More changes are waiting. Pull again with `since = lastSeq`. */
  more: boolean;
}

export type OpCheck = { ok: true } | { ok: false; reason: string };

/** Checks that a client may write this field and that the value fits its schema. */
export function checkClientOp(op: FieldOp): OpCheck {
  const def = (entities as Record<string, EntityDef>)[op.entity];
  if (!def) return { ok: false, reason: `unknown entity ${op.entity}` };
  const schema = def.fields[op.field];
  if (!schema || !def.clientFields.includes(op.field)) {
    return { ok: false, reason: `field ${op.entity}.${op.field} is not writable` };
  }
  if (op.value === undefined || !schema.safeParse(op.value).success) {
    return { ok: false, reason: `invalid value for ${op.entity}.${op.field}` };
  }
  return { ok: true };
}

export function isConflictField(entity: string, field: string): boolean {
  return ((entities as Record<string, EntityDef>)[entity]?.conflictFields ?? []).includes(field);
}
