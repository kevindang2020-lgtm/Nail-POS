/**
 * compensation-earnings.ts — technician-facing earnings views (spec §16 receipt, §17 summary). PURE builders over the
 * canonical snapshot, so the Tech App reads the SAME numbers the engine produced (no parallel estimate). Values that
 * require payroll linkage (bonus, manual adjustments, guarantee top-up, approved/paid status) are surfaced honestly as
 * null / 'estimated' rather than fabricated — they fill in once a payroll period references the snapshot (§17 statuses).
 */
import type { Cents } from './compensation.types';
import type { SnapshotSums } from './compensation-payroll';

export interface TechEarningsSummary {
  serviceCommissionCents: Cents;
  cardTipCents: Cents;
  cashTipCents: Cents;
  tipsCents: Cents;
  retailCommissionCents: Cents;
  bonusCents: Cents | null;          // requires payroll linkage
  guaranteeTopUpCents: Cents | null; // finalized in payroll
  adjustmentsCents: Cents | null;    // approved adjustments (payroll)
  estimatedEarningsCents: Cents;     // snapshot-derived (service + retail + tips)
  status: 'estimated';               // snapshot is an estimate until payroll approves/locks
  tickets: number;
}

/** PURE: §17 category summary from a technician's snapshot sums for a period. */
export function technicianEarningsSummary(sums: SnapshotSums): TechEarningsSummary {
  const service = Math.max(0, Math.round(sums.techServiceEarningsCents));
  const retail = Math.max(0, Math.round(sums.retailCommissionCents));
  const card = Math.max(0, Math.round(sums.cardTipCents));
  const cash = Math.max(0, Math.round(sums.cashTipCents));
  // posted ledger adjustments (refund reversals are NEGATIVE) are part of period earnings — a refunded ticket's
  // commission must not keep showing as earned (mandate §47). Absent (fake ports) ⇒ null, never fabricated.
  const adj = sums.adjustmentsCents == null ? null : Math.round(sums.adjustmentsCents);
  return {
    serviceCommissionCents: service, cardTipCents: card, cashTipCents: cash, tipsCents: card + cash,
    retailCommissionCents: retail, bonusCents: null, guaranteeTopUpCents: null, adjustmentsCents: adj,
    estimatedEarningsCents: service + retail + card + cash + (adj ?? 0), status: 'estimated', tickets: sums.tickets,
  };
}

/** One line of the internal technician earnings receipt (§16). */
export interface ReceiptLine {
  serviceLineId: string; serviceId: string | null;
  grossPriceCents: Cents; discountCents: Cents; eligibleAfterDiscountCents: Cents;
  supplyCents: Cents; commissionableCents: Cents;
  commissionType: string | null; commissionValue: number | null;
  techServiceEarningsCents: Cents;
}

export interface TechTicketReceipt {
  ticketId: string;
  lines: ReceiptLine[];
  cardTipCents: Cents; cashTipCents: Cents; totalTipCents: Cents; salonTipCents: Cents; // 0
  serviceEarningsCents: Cents; retailCommissionCents: Cents;
  totalEarningsCents: Cents;
}

/** Snapshot row shape the receipt consumes (already scoped to the requesting technician). */
export interface EarningsSnapshotRow {
  service_line_id: string; service_id: string | null;
  gross_price_cents: number; discount_cents: number; supply_cents: number; commissionable_cents: number;
  commission_type: string | null; commission_value: number | null;
  tech_service_earnings_cents: number; card_tip_cents: number; cash_tip_cents: number; retail_commission_cents: number;
}

/** PURE: §16 internal earnings receipt for ONE ticket from this technician's snapshot rows. Salon tip is always 0. */
export function ticketEarningsReceipt(ticketId: string, rows: EarningsSnapshotRow[]): TechTicketReceipt {
  const lines: ReceiptLine[] = rows.map((r) => ({
    serviceLineId: r.service_line_id, serviceId: r.service_id,
    grossPriceCents: Number(r.gross_price_cents || 0), discountCents: Number(r.discount_cents || 0),
    eligibleAfterDiscountCents: Math.max(0, Number(r.gross_price_cents || 0) - Number(r.discount_cents || 0)),
    supplyCents: Number(r.supply_cents || 0), commissionableCents: Number(r.commissionable_cents || 0),
    commissionType: r.commission_type, commissionValue: r.commission_value,
    techServiceEarningsCents: Number(r.tech_service_earnings_cents || 0),
  }));
  const card = rows.reduce((a, r) => a + Number(r.card_tip_cents || 0), 0);
  const cash = rows.reduce((a, r) => a + Number(r.cash_tip_cents || 0), 0);
  const service = lines.reduce((a, l) => a + l.techServiceEarningsCents, 0);
  const retail = rows.reduce((a, r) => a + Number(r.retail_commission_cents || 0), 0);
  return {
    ticketId, lines, cardTipCents: card, cashTipCents: cash, totalTipCents: card + cash, salonTipCents: 0,
    serviceEarningsCents: service, retailCommissionCents: retail, totalEarningsCents: service + retail + card + cash,
  };
}
