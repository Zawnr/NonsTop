import { describe, expect, it } from 'vitest';
import { formatCountdown, reminderStatus, reminderTime } from '../src/reminders.ts';

describe('reminder timing (F-52)', () => {
  it('reads the time as local time and rejects dates that do not exist', () => {
    expect(reminderTime('2026-11-06', '09:30')).toEqual(new Date(2026, 10, 6, 9, 30));
    expect(reminderTime('2026-02-31', '09:30')).toBeNull();
  });

  it('tells upcoming, due and missed reminders apart', () => {
    const now = new Date(2026, 10, 6, 9, 0);
    expect(reminderStatus('2026-11-06', null, now)).toEqual({ kind: 'none' });
    expect(reminderStatus('2026-11-06', '09:05', now)).toEqual({ kind: 'upcoming', ms: 5 * 60_000 });
    expect(reminderStatus('2026-11-06', '09:00', now)).toEqual({ kind: 'due' });
    expect(reminderStatus('2026-11-06', '03:00', now)).toEqual({ kind: 'due' });
    expect(reminderStatus('2026-11-06', '02:59', now)).toEqual({ kind: 'missed' });
  });

  it('formats the countdown in words, rounded up to the minute', () => {
    expect(formatCountdown(20_000)).toBe('kurang dari 1 menit');
    expect(formatCountdown(61_000)).toBe('2 menit');
    expect(formatCountdown(5 * 60_000)).toBe('5 menit');
    expect(formatCountdown(125 * 60_000)).toBe('2 jam 5 menit');
    expect(formatCountdown(3 * 3600_000)).toBe('3 jam');
    expect(formatCountdown((3 * 24 + 4) * 3600_000)).toBe('3 hari 4 jam');
    expect(formatCountdown(2 * 24 * 3600_000)).toBe('2 hari');
  });
});
