// billing-proration-core.ts — pure, documented proration math (integer cents; rounding only at the final cent). Used for
// plan changes and mid-cycle add-on changes. Model: within the current billing period [periodStart, periodEnd), the
// unused portion of the OLD price is credited and the NEW price is charged for the remaining days.
//
//   daysTotal      = calendar days in the period
//   daysRemaining  = whole days from effectiveDate to periodEnd (clamped 0..daysTotal)
//   creditCents    = round(oldMonthlyCents * daysRemaining / daysTotal)   (unused old plan)
//   chargeCents    = round(newMonthlyCents * daysRemaining / daysTotal)   (prorated new plan)
//   netCents       = chargeCents - creditCents  (positive = charge now, negative = credit back)

export interface ProrationInput { oldMonthlyCents: number; newMonthlyCents: number; periodStart: string | Date; periodEnd: string | Date; effectiveDate?: string | Date }
export interface Proration { daysTotal: number; daysRemaining: number; creditCents: number; chargeCents: number; netCents: number }

const DAY = 86400000;
const asDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));
const wholeDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

export function computeProration(input: ProrationInput): Proration {
  const start = asDate(input.periodStart), end = asDate(input.periodEnd);
  const eff = input.effectiveDate ? asDate(input.effectiveDate) : new Date();
  const daysTotal = Math.max(1, wholeDays(start, end));
  const daysRemaining = Math.max(0, Math.min(daysTotal, wholeDays(eff, end)));
  const frac = daysRemaining / daysTotal;
  const creditCents = Math.round(Math.max(0, input.oldMonthlyCents) * frac);
  const chargeCents = Math.round(Math.max(0, input.newMonthlyCents) * frac);
  return { daysTotal, daysRemaining, creditCents, chargeCents, netCents: chargeCents - creditCents };
}

export class TrialExtensionError extends Error {}

// Extend a trial end date by N days, enforcing a maximum cumulative extension policy. Returns the new end (ISO date).
export function computeTrialExtension(currentEnd: string | Date, addDays: number, alreadyExtendedDays: number, maxExtensionDays = 30): string {
  if (!Number.isInteger(addDays) || addDays <= 0) throw new TrialExtensionError('Extension days must be a positive integer');
  if (alreadyExtendedDays + addDays > maxExtensionDays) throw new TrialExtensionError(`Cumulative trial extension cannot exceed ${maxExtensionDays} days`);
  const end = asDate(currentEnd);
  return new Date(end.getTime() + addDays * DAY).toISOString().slice(0, 10);
}
