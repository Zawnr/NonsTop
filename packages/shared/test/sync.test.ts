import { describe, expect, it } from 'vitest';
import { checkClientOp, isConflictField, type FieldOp } from '../src/sync.ts';

const op = (over: Partial<FieldOp>): FieldOp => ({
  opId: 'op1',
  entity: 'page',
  id: 'p1',
  field: 'title',
  value: 'Hello',
  hlc: '0000000001000-0000-dev',
  prevHlc: null,
  ...over,
});

describe('checkClientOp', () => {
  it('accepts valid page fields', () => {
    expect(checkClientOp(op({}))).toEqual({ ok: true });
    expect(checkClientOp(op({ field: 'parentId', value: null }))).toEqual({ ok: true });
    expect(checkClientOp(op({ field: 'sortKey', value: 'a0' }))).toEqual({ ok: true });
  });

  it('rejects unknown entities and fields', () => {
    expect(checkClientOp(op({ entity: 'user' })).ok).toBe(false);
    expect(checkClientOp(op({ field: 'owner' })).ok).toBe(false);
  });

  it('rejects values that do not fit the schema', () => {
    expect(checkClientOp(op({ value: 42 })).ok).toBe(false);
    expect(checkClientOp(op({ value: 'x'.repeat(501) })).ok).toBe(false);
    expect(checkClientOp(op({ field: 'sortKey', value: 'a 0' })).ok).toBe(false);
    expect(checkClientOp(op({ value: undefined })).ok).toBe(false);
  });

  it('lets clients only resolve conflicts, never forge them', () => {
    expect(checkClientOp(op({ entity: 'conflict', field: 'resolved', value: true })).ok).toBe(true);
    expect(checkClientOp(op({ entity: 'conflict', field: 'value', value: 'x' })).ok).toBe(false);
  });

  it('tracks conflicts on page titles only', () => {
    expect(isConflictField('page', 'title')).toBe(true);
    expect(isConflictField('page', 'sortKey')).toBe(false);
  });
});
