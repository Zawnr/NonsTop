// Last-writer-wins merge for one field, shared by the server and the client.
import { compareHlc, parseHlc, type Hlc } from './hlc.ts';

export interface FieldState {
  value: unknown;
  hlc: Hlc;
}

export interface MergeInput {
  value: unknown;
  hlc: Hlc;
  /** HLC of the value the writing device saw when it made the edit. `null` = it saw no value. */
  prevHlc: Hlc | null;
}

export interface LostVersion {
  value: unknown;
  hlc: Hlc;
  deviceId: string;
}

export interface MergeResult {
  /** The incoming write is newer and replaces the current value. */
  apply: boolean;
  /**
   * Set when two devices edited the field without seeing each other's edit and the values differ.
   * This is the value that did not win. It is kept so no edit is lost silently (F-63).
   */
  lost: LostVersion | null;
}

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

export function sameValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function version(value: unknown, hlc: Hlc): LostVersion {
  return { value, hlc, deviceId: parseHlc(hlc)?.deviceId ?? 'unknown' };
}

export function mergeField(current: FieldState | undefined, incoming: MergeInput): MergeResult {
  const cmp = compareHlc(incoming.hlc, current?.hlc);
  if (cmp === 0) return { apply: false, lost: null }; // the same write again
  // The writer saw the current value, so this is a normal sequential edit, never a conflict.
  const concurrent = current !== undefined && incoming.prevHlc !== current.hlc;
  if (cmp > 0) {
    const lost = concurrent && !sameValue(current.value, incoming.value) ? version(current.value, current.hlc) : null;
    return { apply: true, lost };
  }
  // Older than the current value. If the writer had seen the current value it could not be older,
  // so this is always a concurrent edit.
  const lost = !sameValue(current!.value, incoming.value) ? version(incoming.value, incoming.hlc) : null;
  return { apply: false, lost };
}
