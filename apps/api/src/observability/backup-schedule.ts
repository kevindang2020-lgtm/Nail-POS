// backup-schedule.ts — G9 Backup & DR (Nov 5 2026): the platform's midnight (America/New_York) backup checkpoint — PURE.
// Platform code (the health aggregator / on-call backup freshness check) reads it, and so does the Backup Center; it lives
// here so the platform layer never imports a domain directory (architecture §101 back-edge).

export const BACKUP_TZ = 'America/New_York';
/** How long after midnight the provider job has to report the checkpoint before it counts as missed. */
export const CHECKPOINT_GRACE_MS = 2 * 3_600_000;
/** A point may sit this far from the scheduled midnight and still be "the midnight checkpoint" (job start jitter). */
export const CHECKPOINT_WINDOW_MS = 2 * 3_600_000;

// ── time zone / midnight checkpoint ───────────────────────────────────────────────────────────────────────────────────
export function tzParts(ms: number, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}
const offsetMs = (ms: number, tz: string) => { const p = tzParts(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
/** The UTC instant of 00:00 local on the given local calendar day (DST-safe: the offset is re-read at the result). */
export function zonedMidnightUtc(y: number, m: number, d: number, tz = BACKUP_TZ): number {
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) guess = Date.UTC(y, m - 1, d) - offsetMs(guess, tz);
  return guess;
}
export function localDate(ms: number, tz = BACKUP_TZ): string { const p = tzParts(ms, tz); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
/** The most recent scheduled midnight at or before `now`, and the next one. */
export function midnightSchedule(now: number, tz = BACKUP_TZ): { last: number; next: number } {
  const p = tzParts(now, tz);
  const today = zonedMidnightUtc(p.y, p.m, p.d, tz);
  const last = today <= now ? today : zonedMidnightUtc(p.y, p.m, p.d - 1, tz);
  const lp = tzParts(last + 36 * 3_600_000, tz);   // a day and a half later is always inside the next local day
  return { last, next: zonedMidnightUtc(lp.y, lp.m, lp.d, tz) };
}
/** §34 missed-midnight rule: the last scheduled midnight is past its grace and no platform point sits within its window. */
export function missedMidnightCheckpoint(now: number, platformPointTimes: readonly number[], tz = BACKUP_TZ): { missed: boolean; scheduledAt: number; dueBy: number } {
  const { last } = midnightSchedule(now, tz);
  // inside the grace period the job may still report: judge the PREVIOUS midnight instead
  const sched = now < last + CHECKPOINT_GRACE_MS ? midnightSchedule(last - 1, tz).last : last;
  const covered = platformPointTimes.some((t) => Math.abs(t - sched) <= CHECKPOINT_WINDOW_MS);
  return { missed: !covered, scheduledAt: sched, dueBy: sched + CHECKPOINT_GRACE_MS };
}
