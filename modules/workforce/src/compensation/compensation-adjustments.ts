/**
 * compensation-adjustments.ts — refund / void / chargeback reversals (spec §21) + manual adjustments (§24). PURE.
 * The immutable snapshot (§14) is NEVER edited. A refund/void produces signed (negative) ledger entries that offset the
 * original earnings; reports/payroll sum snapshot + ledger. Tips reverse ONLY when the tip itself is refunded. A refund
 * after a paid payroll period targets a FUTURE period (never rewrites the locked period, §21). Chargebacks are NOT
 * auto-applied — they create a pending-review exception (§21). Integer cents.
 */
import type { Cents } from './compensation.types';

export type AdjustmentCategory =
  | 'refund_reversal' | 'void_reversal' | 'chargeback_reversal'
  | 'commission_correction' | 'tip_correction' | 'bonus' | 'guarantee_correction'
  | 'supply_correction' | 'prior_period' | 'payroll_correction'
  // wave 2 (Oct 12 2026): §33 the retail part of a reversal is its own category (RETAIL_COMMISSION_REVERSAL) — it used to
  // share the service category, so on a line carrying both the 588 idempotency index silently dropped the retail row;
  // §59 a configured deduction (negative, names its type).
  | 'retail_reversal' | 'deduction';
/** 'posted' = counted in period earnings immediately (auto reversals); 'applied' is the legacy equivalent kept for old rows. */
export type AdjustmentStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'pending_review' | 'posted';
/** Statuses that count toward period earnings / payroll. */
export const COUNTED_ADJUSTMENT_STATUSES: readonly AdjustmentStatus[] = ['posted', 'approved', 'applied'];
export type AdjustmentSource = 'refund' | 'void' | 'chargeback' | 'manual';

export interface AdjustmentEntry {
  technicianId: string | null;
  ticketId: string | null;
  serviceLineId: string | null;
  periodId: string | null;
  category: AdjustmentCategory;
  amountCents: Cents;            // signed — negative for reversals
  reason: string;
  status: AdjustmentStatus;
  source: AdjustmentSource;
  targetsFuturePeriod: boolean;  // true when the original period is already paid (§21)
  requestedBy: string | null;
  approvedBy: string | null;
  /** the refund payment this reversal belongs to — idempotency key with (service_line_id, technician_id, category), migration 588. */
  refundPaymentId?: string | null;
  /** wave 2 (migration 614): the LOCKED period this entry corrects (period_id is where it lands), the chargeback case it
   *  reverses, the configured deduction type, the manual reason code and the client idempotency key. */
  originalPeriodId?: string | null;
  chargebackId?: string | null;
  deductionType?: string | null;
  reasonCode?: string | null;
  idempotencyKey?: string | null;
}

/** Snapshot row shape the reversal consumes. */
export interface ReversibleRow {
  service_line_id: string; technician_id: string | null;
  tech_service_earnings_cents: number; salon_service_share_cents: number; supply_cents: number;
  card_tip_cents: number; cash_tip_cents: number; retail_commission_cents: number;
}

export interface RefundEvent {
  type: 'full' | 'partial' | 'void' | 'chargeback';
  /** for 'partial': which lines, and whether the tip/supply are part of the refund. */
  lines?: { serviceLineId: string; refundTip?: boolean; refundSupply?: boolean }[];
  /** for 'partial' WITHOUT line ids: the refunded amount vs the captured amount — commission is reversed PRO-RATA
   *  across every line (ratio = refundedCents / capturedCents, largest-remainder so Σ reversed == round(ratio × total)).
   *  Mandate §52 (partial refunds: proportional reversal, precise minor-unit rounding). */
  refundedCents?: number;
  capturedCents?: number;
  /** Oct 13 2026 (live money-chain proof): the part of capturedCents that is NOT commission basis (tips + tax). The
   *  pro-rata ratio is refundedCents / (capturedCents − nonCommissionableCents), capped at 1 — a $45.00 refund of a
   *  $45.00 service paid as $60.24 (tax + tip) reverses the whole commission, not 45/60.24 of it. Omitted → the old
   *  captured denominator (callers that do not know the ticket's tip/tax). */
  nonCommissionableCents?: number;
  /** the refund payment row id (idempotency; migration 588). */
  refundPaymentId?: string | null;
  /** for full/void: whether the tip was also refunded/voided (tips reverse ONLY if so). */
  tipRefunded?: boolean;
  /** policy: does a refund reverse the salon-retained supply too? default false (salon keeps supply). */
  supplyReversible?: boolean;
}

export interface ReversalOptions {
  reason: string;
  requestedBy: string | null;
  priorPeriodPaid?: boolean;     // refund after a paid payroll period → future-period adjustment + approval
  requireApproval?: boolean;     // when true, entries are 'pending' instead of 'posted'
  /** wave 2 §54/§129: the open period the correction lands in + the locked period it corrects. */
  targetPeriodId?: string | null;
  originalPeriodId?: string | null;
  /** wave 2 §55: the chargebacks row this reversal belongs to (idempotency, migration 614). */
  chargebackId?: string | null;
}

/** PURE: build the reversal ledger entries for a refund/void/chargeback against a ticket's snapshot rows (§21). */
export function buildRefundReversal(ticketId: string, rows: ReversibleRow[], event: RefundEvent, opts: ReversalOptions): AdjustmentEntry[] {
  const isVoid = event.type === 'void';
  const isChargeback = event.type === 'chargeback';
  const category: AdjustmentCategory = isVoid ? 'void_reversal' : isChargeback ? 'chargeback_reversal' : 'refund_reversal';
  const source: AdjustmentSource = isVoid ? 'void' : isChargeback ? 'chargeback' : 'refund';
  const targetsFuturePeriod = !!opts.priorPeriodPaid;
  // A refund is a FACT (mandate §51): entries post immediately unless the tenant opted into review (requireApproval) or
  // the original period is already paid (future-period routing, §54). Chargebacks always wait for review (§55).
  const status: AdjustmentStatus = isChargeback ? 'pending_review' : (opts.requireApproval || targetsFuturePeriod) ? 'pending' : 'posted';

  // Partial refund WITHOUT line ids → pro-rata share of every line (ratio of refunded to captured money).
  // wave 2: a PARTIAL chargeback (disputed amount < captured) reverses pro-rata exactly like a partial refund (§52/§55)
  // The denominator is the COMMISSIONABLE captured money: captured minus tips/tax when the caller knows them (a
  // nonsense value — nothing commissionable left — falls back to the captured amount; never a division by zero).
  const commissionable = event.capturedCents != null && event.nonCommissionableCents != null && event.nonCommissionableCents >= 0 && event.capturedCents - event.nonCommissionableCents > 0
    ? event.capturedCents - event.nonCommissionableCents : event.capturedCents;
  const proRata = (event.type === 'partial' || isChargeback) && !(event.lines?.length) && event.refundedCents != null && commissionable != null && commissionable > 0
    ? Math.max(0, Math.min(1, event.refundedCents / commissionable)) : null;

  const affected = (r: ReversibleRow): { reverseTip: boolean; reverseSupply: boolean; ratio: number } | null => {
    if (isChargeback && proRata != null && proRata < 1) return proRata > 0 ? { reverseTip: !!event.tipRefunded, reverseSupply: !!event.supplyReversible, ratio: proRata } : null;
    if (event.type === 'full' || isVoid || isChargeback) return { reverseTip: !!event.tipRefunded || isVoid, reverseSupply: !!event.supplyReversible, ratio: 1 };
    if (proRata != null) return proRata > 0 ? { reverseTip: !!event.tipRefunded, reverseSupply: !!event.supplyReversible, ratio: proRata } : null;
    const sel = event.lines?.find((l) => l.serviceLineId === r.service_line_id);
    if (!sel) return null; // partial refund: untouched line
    return { reverseTip: !!sel.refundTip, reverseSupply: !!sel.refundSupply, ratio: 1 };
  };

  // pro-rata amounts use largest-remainder across rows so Σ reversed == round(ratio × Σ original) exactly (§135)
  const prorate = (amounts: number[], ratio: number): number[] => {
    if (ratio === 1) return amounts.map((a) => Math.abs(Math.round(a)));
    const total = amounts.reduce((a, b) => a + Math.abs(Math.round(b)), 0);
    const target = Math.round(total * ratio);
    return allocateLR(target, amounts.map((a) => Math.abs(Math.round(a))));
  };

  const sel = rows.map((r) => ({ r, a: affected(r) })).filter((x) => x.a) as { r: ReversibleRow; a: { reverseTip: boolean; reverseSupply: boolean; ratio: number } }[];
  const ratio = sel[0]?.a.ratio ?? 1;
  const svc = prorate(sel.map((x) => x.r.tech_service_earnings_cents), ratio);
  const ret = prorate(sel.map((x) => x.r.retail_commission_cents), ratio);
  const tip = prorate(sel.map((x) => (x.r.card_tip_cents || 0) + (x.r.cash_tip_cents || 0)), ratio);
  const sup = prorate(sel.map((x) => x.r.supply_cents), ratio);

  const entries: AdjustmentEntry[] = [];
  sel.forEach(({ r, a }, i) => {
    const reverse = (amount: number, cat: AdjustmentCategory) => {
      if (amount === 0) return;
      entries.push({
        technicianId: r.technician_id, ticketId, serviceLineId: r.service_line_id, periodId: opts.targetPeriodId ?? null,
        category: cat, amountCents: -Math.abs(Math.round(amount)), reason: opts.reason, status, source,
        targetsFuturePeriod, requestedBy: opts.requestedBy, approvedBy: null, refundPaymentId: event.refundPaymentId ?? null,
        originalPeriodId: opts.originalPeriodId ?? null, chargebackId: opts.chargebackId ?? null,
      });
    };
    reverse(svc[i], category);
    reverse(ret[i], 'retail_reversal');
    if (a.reverseTip) reverse(tip[i], 'tip_correction');
    if (a.reverseSupply) reverse(sup[i], 'supply_correction');
  });
  return entries;
}

/** local largest-remainder (kept here so this module stays dependency-free of the engine). */
function allocateLR(total: number, weights: number[]): number[] {
  const n = weights.length; if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) { const out = new Array(n).fill(0); out[0] = total; return out; }
  const exact = weights.map((w) => (total * w) / sumW);
  const floor = exact.map((x) => Math.floor(x));
  let rem = total - floor.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  const out = floor.slice();
  for (let k = 0; k < order.length && rem > 0; k++) { out[order[k].i] += 1; rem--; }
  return out;
}

export interface ManualAdjustmentRequest {
  technicianId?: string | null;
  ticketId?: string | null;
  periodId?: string | null;
  category?: AdjustmentCategory;
  amountCents?: number;          // signed
  reason?: string;
  requestedBy?: string | null;
  approvedBy?: string | null;
}

/** Threshold (cents) above which a manual adjustment requires owner approval (§24). */
export const LARGE_ADJUSTMENT_CENTS = 20000;

/** PURE: validate + assemble a manual adjustment (§24). Never allows a silent edit of paid earnings. */
export function buildManualAdjustment(req: ManualAdjustmentRequest): { entry?: AdjustmentEntry; errors: string[] } {
  const errors: string[] = [];
  if (!req.technicianId) errors.push('technicianId is required.');
  if (!req.ticketId && !req.periodId) errors.push('A ticket or a pay period is required.');
  if (req.amountCents == null || !Number.isInteger(req.amountCents) || req.amountCents === 0) errors.push('A non-zero whole-cents amount is required.');
  if (!req.category) errors.push('A category is required.');
  if (!req.reason || !req.reason.trim()) errors.push('A reason is required.');
  if (!req.requestedBy) errors.push('requestedBy is required.');
  const large = req.amountCents != null && Math.abs(req.amountCents) >= LARGE_ADJUSTMENT_CENTS;
  if (large && !req.approvedBy) errors.push('Adjustments at or above the large-adjustment threshold require owner approval.');
  if (errors.length) return { errors };
  return {
    errors: [],
    entry: {
      technicianId: req.technicianId!, ticketId: req.ticketId ?? null, serviceLineId: null, periodId: req.periodId ?? null,
      category: req.category!, amountCents: Math.round(req.amountCents!), reason: req.reason!.trim(),
      status: req.approvedBy ? 'approved' : 'pending', source: 'manual',
      targetsFuturePeriod: false, requestedBy: req.requestedBy!, approvedBy: req.approvedBy ?? null,
    },
  };
}
