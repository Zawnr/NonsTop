import { describe, expect, it } from 'vitest';
import { HlcClock } from '../src/hlc.ts';
import { mergeField, type FieldState } from '../src/merge.ts';

describe('mergeField (last writer wins)', () => {
  const laptop = new HlcClock('laptop', () => 1000);
  const phone = new HlcClock('phone', () => 2000);

  it('applies the first write of a field', () => {
    expect(mergeField(undefined, { value: 'a', hlc: laptop.now(), prevHlc: null })).toEqual({ apply: true, lost: null });
  });

  it('applies a sequential edit without a conflict', () => {
    const current: FieldState = { value: 'a', hlc: laptop.now() };
    const result = mergeField(current, { value: 'b', hlc: laptop.now(), prevHlc: current.hlc });
    expect(result).toEqual({ apply: true, lost: null });
  });

  it('ignores the same write twice', () => {
    const h = laptop.now();
    expect(mergeField({ value: 'a', hlc: h }, { value: 'a', hlc: h, prevHlc: null })).toEqual({ apply: false, lost: null });
  });

  it('newer concurrent edit wins and keeps the overwritten value', () => {
    const base = laptop.now();
    const current: FieldState = { value: 'laptop edit', hlc: laptop.now() }; // laptop edited offline
    const incoming = { value: 'phone edit', hlc: phone.now(), prevHlc: base }; // phone never saw the laptop edit
    const result = mergeField(current, incoming);
    expect(result.apply).toBe(true);
    expect(result.lost).toEqual({ value: 'laptop edit', hlc: current.hlc, deviceId: 'laptop' });
  });

  it('older concurrent edit loses but is kept', () => {
    const current: FieldState = { value: 'phone edit', hlc: phone.now() };
    const old = { value: 'laptop edit', hlc: laptop.now(), prevHlc: null };
    const result = mergeField(current, old);
    expect(result.apply).toBe(false);
    expect(result.lost).toMatchObject({ value: 'laptop edit', deviceId: 'laptop' });
  });

  it('reports no conflict when concurrent edits wrote the same value', () => {
    const current: FieldState = { value: 'same', hlc: phone.now() };
    expect(mergeField(current, { value: 'same', hlc: laptop.now(), prevHlc: null }).lost).toBeNull();
  });
});
