// deposit-reconciliation.periods.ts — accounting-period close with a guard that will NOT close over unresolved
// material differences (spec: material exceptions must be resolved or explicitly approved as outstanding). The
// guard is pure so it is unit-testable; "material" = high/critical severity OR amount at/above a threshold.
import type { ReconException } from './deposit-reconciliation.exceptions';

export type PeriodStatus = 'open' | 'closed';
export interface ReconPeriod {
  id: string;
  label: string;
  periodStart: string;   // YYYY-MM-DD
  periodEnd: string;     // YYYY-MM-DD
  status: PeriodStatus;
  closedByUserId: string | null;
  closedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CloseGuardOptions { materialThresholdCents: number }
export const DEFAULT_CLOSE_OPTIONS: CloseGuardOptions = { materialThresholdCents: 10000 }; // $100

const inRange = (createdAt: string, start: string, end: string): boolean => {
  const d = String(createdAt).slice(0, 10);
  return d >= start && d <= end;
};
export function isMaterial(e: ReconException, opts: CloseGuardOptions): boolean {
  return e.severity === 'high' || e.severity === 'critical' || Math.abs(e.amountCents) >= opts.materialThresholdCents;
}

export interface CloseCheck { ok: boolean; blockers: ReconException[]; warnings: ReconException[] }

// A period can close only if there are no UNRESOLVED MATERIAL exceptions dated within it. Unresolved non-material
// exceptions are surfaced as warnings (they don't block, but the closer sees them).
export function canClosePeriod(exceptions: ReconException[], period: { periodStart: string; periodEnd: string }, opts: CloseGuardOptions = DEFAULT_CLOSE_OPTIONS): CloseCheck {
  const unresolvedInPeriod = exceptions.filter((e) => e.status !== 'resolved' && inRange(e.createdAt, period.periodStart, period.periodEnd));
  const blockers = unresolvedInPeriod.filter((e) => isMaterial(e, opts));
  const warnings = unresolvedInPeriod.filter((e) => !isMaterial(e, opts));
  return { ok: blockers.length === 0, blockers, warnings };
}

export function validateCreatePeriod(i: { label?: string; periodStart?: string; periodEnd?: string }): { ok: boolean; error?: string } {
  const d = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!i?.label || !String(i.label).trim()) return { ok: false, error: 'A label is required' };
  if (!d(i.periodStart) || !d(i.periodEnd)) return { ok: false, error: 'Valid start and end dates (YYYY-MM-DD) are required' };
  if ((i.periodStart as string) > (i.periodEnd as string)) return { ok: false, error: 'Start date must be on or before end date' };
  return { ok: true };
}
