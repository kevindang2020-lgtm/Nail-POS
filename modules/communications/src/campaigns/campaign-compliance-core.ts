// Pure, DB-free engine for campaign compliance: summarize open flags into the reference alert categories, decide
// pause-eligibility, and validate campaign limits. No fabrication — "all compliant" is only reported when there are
// genuinely no open flags.

export interface FlagLike { flagType: string; status: string }

export interface AlertCategory { key: string; label: string; count: number }
export interface AlertSummary { categories: AlertCategory[]; totalFlagged: number; allCompliant: boolean }

const OPEN = new Set(['open', 'reviewing']);
const CATEGORY_LABEL: Record<string, string> = {
  high_opt_out: 'flagged for high opt-out rate',
  spam_complaints: 'flagged for spam complaints',
  awaiting_review: 'awaiting compliance review',
  abusive: 'flagged as abusive',
  rate_limit_exceeded: 'flagged for exceeding limits',
};

export function summarizeAlerts(flags: FlagLike[]): AlertSummary {
  const open = flags.filter((f) => OPEN.has(f.status));
  const counts = new Map<string, number>();
  for (const f of open) counts.set(f.flagType, (counts.get(f.flagType) || 0) + 1);
  const categories = [...counts.entries()].map(([key, count]) => ({ key, label: CATEGORY_LABEL[key] || key, count }))
    .sort((a, b) => b.count - a.count);
  return { categories, totalFlagged: open.length, allCompliant: open.length === 0 };
}

/** A campaign can be paused only while it is live or upcoming. */
export function canPause(status: string): boolean {
  return ['active', 'in_progress', 'sending', 'scheduled'].includes(status);
}

export interface LimitsInput {
  maxSendsPerDay?: number | null;
  maxCampaignsPerDay?: number | null;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  minHoursBetween?: number | null;
}

const nonNegOrNull = (v: unknown): boolean => v == null || (Number.isInteger(v) && (v as number) >= 0);
const hourOrNull = (v: unknown): boolean => v == null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 23);

export function validateLimits(input: LimitsInput): { errors: string[] } {
  const errors: string[] = [];
  if (!nonNegOrNull(input.maxSendsPerDay)) errors.push('Max sends per day must be a non-negative whole number.');
  if (!nonNegOrNull(input.maxCampaignsPerDay)) errors.push('Max campaigns per day must be a non-negative whole number.');
  if (!nonNegOrNull(input.minHoursBetween)) errors.push('Minimum hours between sends must be a non-negative whole number.');
  if (!hourOrNull(input.quietHoursStart)) errors.push('Quiet hours start must be an hour 0–23.');
  if (!hourOrNull(input.quietHoursEnd)) errors.push('Quiet hours end must be an hour 0–23.');
  return { errors };
}
