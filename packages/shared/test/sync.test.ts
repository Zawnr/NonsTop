import { describe, expect, it } from 'vitest';
import { checkClientOp, isClientField, isConflictField, propField, type FieldOp } from '../src/sync.ts';

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

  it('validates block fields', () => {
    const block = (field: string, value: unknown) => checkClientOp(op({ entity: 'block', field, value })).ok;
    expect(block('type', 'heading')).toBe(true);
    expect(block('type', 'image')).toBe(false);
    expect(block('props', { level: 2, isToggleable: false })).toBe(true);
    expect(block('props', { nested: { a: 1 } })).toBe(false);
    expect(block('content', [{ type: 'text', text: 'hi', styles: {} }])).toBe(true);
    expect(block('content', 'x'.repeat(100_001))).toBe(false);
  });

  it('tracks conflicts on titles, block content and property values only', () => {
    expect(isConflictField('page', 'title')).toBe(true);
    expect(isConflictField('block', 'content')).toBe(true);
    expect(isConflictField('page', propField('prop1'))).toBe(true);
    expect(isConflictField('database', 'title')).toBe(true);
    expect(isConflictField('page', 'sortKey')).toBe(false);
    expect(isConflictField('block', 'sortKey')).toBe(false);
    expect(isConflictField('property', 'name')).toBe(false);
    expect(isConflictField('page', 'prop.')).toBe(false);
  });
});

describe('database entities', () => {
  const check = (entity: string, field: string, value: unknown) => checkClientOp(op({ entity, field, value })).ok;

  it('accepts property values of every shape on rows', () => {
    const f = propField('prop1');
    for (const value of [null, 'teks', 3.5, true, ['a', 'b'], { start: '2026-11-05', end: null }, { start: '2026-11-05', end: '2026-11-07' }]) {
      expect(check('page', f, value)).toBe(true);
    }
  });

  it('rejects malformed property values and field names', () => {
    const f = propField('prop1');
    expect(check('page', f, { start: '5 Nov', end: null })).toBe(false);
    expect(check('page', f, Number.NaN)).toBe(false);
    expect(check('page', f, [1, 2])).toBe(false);
    expect(check('page', f, { a: 1 })).toBe(false);
    expect(check('page', 'prop.bad id', 'x')).toBe(false);
    expect(check('page', 'prop.', 'x')).toBe(false);
    expect(check('block', propField('prop1'), 'x')).toBe(false);
  });

  it('knows dynamic fields as client fields', () => {
    expect(isClientField('page', propField('p1'))).toBe(true);
    expect(isClientField('page', 'title')).toBe(true);
    expect(isClientField('conflict', 'value')).toBe(false);
    expect(isClientField('nope', 'title')).toBe(false);
  });

  it('validates database, property and view fields', () => {
    expect(check('page', 'databaseId', 'db1')).toBe(true);
    expect(check('page', 'databaseId', null)).toBe(true);
    expect(check('database', 'pageId', 'p1')).toBe(true);
    expect(check('database', 'inline', true)).toBe(true);
    expect(check('property', 'type', 'multiSelect')).toBe(true);
    expect(check('property', 'type', 'formula')).toBe(false);
    expect(check('property', 'config', { options: [{ id: 'o1', name: 'Selesai', color: 'green', group: 'done' }] })).toBe(true);
    expect(check('property', 'config', { options: [{ id: 'o1', name: 'X', color: 'teal' }] })).toBe(false);
    expect(check('property', 'config', { databaseId: 'db2', pairId: 'p2', reverse: true })).toBe(true);
    expect(check('view', 'type', 'list')).toBe(true);
    expect(check('view', 'type', 'board')).toBe(false);
    expect(check('block', 'type', 'database')).toBe(true);
  });
});
