/**
 * commission-basis.ts — THE one definition of what a service line's commission is computed on (Payroll mandate §17–§20;
 * ported from the other chat's Technician Profile phase 2, Oct 12 2026).
 *
 *   commissionable base = line_total_cents − line-level discount
 *
 *   • line_total_cents already carries price overrides and retail quantity (it is what the guest was charged for the line,
 *     pre-tax). price_cents_snapshot is the catalogue price at creation and is NOT the basis.
 *   • tax is never commissionable; tips are never in the split (they are allocated whole to technicians, salon 0).
 *   • a REMOVED line (removed_at IS NOT NULL) has no basis — it is excluded entirely.
 *   • ticket-level discounts are apportioned across lines by the engine (largest remainder) BEFORE this base is split;
 *     the engine's supply charge / non-commissionable deductions also apply there (compensation-engine.ts).
 *
 * `lineCommissionCents` is THE per-line commission formula (ONE-PAY, Oct 13 2026): the engine's service-line split calls
 * it, and nothing outside this directory prices a line — readers read the snapshot / ledger / payroll lines, or ask
 * CompensationService.previewForTicket (which runs this engine). The percent arithmetic itself is @aipowersalon/money
 * splitByPercent. check:one-payroll-calculation keeps it that way. Pure, integer cents.
 */

export interface CommissionBasisLine {
  line_total_cents: number | string | null | undefined;
  /** line-level discount already applied to this line (cents, >= 0). */
  discount_cents?: number | string | null;
  removed_at?: unknown;
}

export function commissionableBaseCents(line: CommissionBasisLine): number {
  if (line.removed_at != null) return 0;
  const total = Math.max(0, Math.round(Number(line.line_total_cents) || 0));
  const disc = Math.max(0, Math.round(Number(line.discount_cents) || 0));
  return Math.max(0, total - disc);
}

import { splitByPercent } from '@aipowersalon/money';

export type LineCommissionType = 'percent' | 'flat' | 'fixed';

/** THE one per-line commission formula over a commissionable base: percent → splitByPercent (clamped to the base);
 *  'flat' / 'fixed' → the amount, never more than the base and never negative. Unknown type ⇒ percent. */
export function lineCommissionCents(baseCents: number, commissionType: LineCommissionType | string | null | undefined, commissionValue: number | string | null | undefined): number {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  if (base === 0) return 0;
  const v = Number(commissionValue) || 0;
  if (commissionType === 'flat' || commissionType === 'fixed') return Math.min(base, Math.max(0, Math.round(v)));
  return splitByPercent(base, v).shareCents;
}

/** Platform fallback when a tenant has NOT set tenants.default_commission_percent (matches migration 472's column default). */
export const PLATFORM_FALLBACK_COMMISSION_PERCENT = 50;
