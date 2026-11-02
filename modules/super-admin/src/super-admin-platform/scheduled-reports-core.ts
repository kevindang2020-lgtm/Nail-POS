// scheduled-reports-core.ts — pure scheduling math for report definitions. No I/O → unit-tested. nextRunAt advances a
// definition by its cadence; isDue decides whether an enabled definition should run now.
export const CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];
export const REPORT_KEYS = ['users'] as const;     // currently supported report generators

export function isCadence(v: string): v is Cadence { return (CADENCES as readonly string[]).includes(v); }
export function isSupportedReport(key: string): boolean { return (REPORT_KEYS as readonly string[]).includes(key); }

/** Next run instant for a cadence, measured from `from`. Monthly steps the calendar month (handles year rollover). */
export function nextRunAt(cadence: Cadence, from: Date): Date {
  const d = new Date(from.getTime());
  if (cadence === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export function isDue(report: { enabled: boolean; nextRunAt: Date | string | null }, now: Date = new Date()): boolean {
  if (!report.enabled || !report.nextRunAt) return false;
  return new Date(report.nextRunAt).getTime() <= now.getTime();
}
