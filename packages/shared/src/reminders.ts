// Deadline reminder timing (F-52), shared so the server that sends and the app that shows the
// countdown agree on when a reminder goes out.

/** A reminder missed while the server was off still goes out when it is at most this late. */
export const REMINDER_LATE_LIMIT_MS = 6 * 60 * 60 * 1000;

/** The server checks once a minute, on the minute, so a reminder goes out within this time. */
export const REMINDER_CHECK_MS = 60 * 1000;

/** Local time of a reminder, or null when the date does not exist (for example 31 Feb). */
export function reminderTime(start: string, remindAt: string): Date | null {
  const [y, m, d] = start.split('-').map(Number);
  const [hh, mm] = remindAt.split(':').map(Number);
  const t = new Date(y!, m! - 1, d!, hh!, mm!);
  return t.getFullYear() === y && t.getMonth() === m! - 1 && t.getDate() === d ? t : null;
}

export type ReminderStatus =
  | { kind: 'none' }
  /** Goes out in `ms`. */
  | { kind: 'upcoming'; ms: number }
  /** Its time has passed, recently enough to still be sent (if it was not sent already). */
  | { kind: 'due' }
  /** More than the late limit ago: the server will not send it. */
  | { kind: 'missed' };

export function reminderStatus(start: string | undefined, remindAt: string | null | undefined, now: Date): ReminderStatus {
  if (!start || !remindAt) return { kind: 'none' };
  const at = reminderTime(start, remindAt);
  if (!at) return { kind: 'none' };
  const ms = at.getTime() - now.getTime();
  if (ms > 0) return { kind: 'upcoming', ms };
  return -ms <= REMINDER_LATE_LIMIT_MS ? { kind: 'due' } : { kind: 'missed' };
}

/** "kurang dari 1 menit", "5 menit", "2 jam 5 menit", "3 hari 4 jam". Rounded up to the minute. */
export function formatCountdown(ms: number): string {
  if (ms < 60_000) return 'kurang dari 1 menit';
  const minutes = Math.ceil(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return hours ? `${days} hari ${hours} jam` : `${days} hari`;
  if (hours) return mins ? `${hours} jam ${mins} menit` : `${hours} jam`;
  return `${mins} menit`;
}
