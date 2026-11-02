/**
 * compensation-tips.ts — tip persistence mapping + card/cash tip reporting (spec §12, §18). Pure, integer-cents.
 * Canonical tip data (card vs cash, per technician) lives in the immutable snapshot (§14). This module:
 *  • maps an engine result to the legacy `ticket_tip_allocations` rows (per-tech total) so existing tech/owner reads
 *    stay consistent — one source of truth, no parallel tip math;
 *  • aggregates snapshot tip rows into the §18 owner report. Salon tip share is always $0 (§12).
 */
import type { Cents, TicketCompensationInput, TicketCompensationResult } from './compensation.types';

export interface TipAllocationRow { tenant_id: string; branch_id: string | null; ticket_id: string; technician_id: string; tip_cents: Cents; }

/** PURE: per-technician tip allocations (card+cash) for the legacy table. Salon keeps none (§12). */
export function tipAllocationRowsFromResult(
  _input: TicketCompensationInput, result: TicketCompensationResult, meta: { tenantId: string; branchId: string | null },
): TipAllocationRow[] {
  return result.perTechnician
    .map((t) => ({ tenant_id: meta.tenantId, branch_id: meta.branchId, ticket_id: result.ticketId, technician_id: t.technicianId, tip_cents: t.cardTipCents + t.cashTipCents }))
    .filter((r) => r.tip_cents > 0 && r.technician_id !== 'unassigned');
}

/** A snapshot tip row as the report consumes it. */
export interface TipReportRow { technicianId: string | null; technicianName?: string | null; branchId?: string | null; cardTipCents: Cents; cashTipCents: Cents; ticketId: string; day: string; }

export interface TipReport {
  grossCardTipCents: Cents; cashTipCents: Cents; totalTipCents: Cents; salonTipCents: Cents; // always 0
  ticketCount: number; averageTipCents: Cents;
  byTechnician: { technicianId: string | null; technicianName?: string | null; cardTipCents: Cents; cashTipCents: Cents; totalCents: Cents }[];
  byBranch: { branchId: string | null; cardTipCents: Cents; cashTipCents: Cents; totalCents: Cents }[];
  byDay: { day: string; cardTipCents: Cents; cashTipCents: Cents; totalCents: Cents }[];
}

function groupSum<T extends string | null>(rows: TipReportRow[], key: (r: TipReportRow) => T) {
  const m = new Map<T, { cardTipCents: Cents; cashTipCents: Cents }>();
  for (const r of rows) { const k = key(r); const e = m.get(k) ?? { cardTipCents: 0, cashTipCents: 0 }; e.cardTipCents += r.cardTipCents; e.cashTipCents += r.cashTipCents; m.set(k, e); }
  return m;
}

/** PURE: build the §18 card-tip report from snapshot tip rows. */
export function buildTipReport(rows: TipReportRow[]): TipReport {
  const grossCard = rows.reduce((a, r) => a + r.cardTipCents, 0);
  const cash = rows.reduce((a, r) => a + r.cashTipCents, 0);
  const total = grossCard + cash;
  const tickets = new Set(rows.map((r) => r.ticketId));
  const nameById = new Map(rows.map((r) => [r.technicianId, r.technicianName]));
  const byTech = groupSum(rows, (r) => r.technicianId);
  const byBranch = groupSum(rows, (r) => r.branchId ?? null);
  const byDay = groupSum(rows, (r) => r.day);
  return {
    grossCardTipCents: grossCard, cashTipCents: cash, totalTipCents: total, salonTipCents: 0,
    ticketCount: tickets.size, averageTipCents: tickets.size ? Math.round(total / tickets.size) : 0,
    byTechnician: [...byTech].map(([technicianId, v]) => ({ technicianId, technicianName: nameById.get(technicianId), cardTipCents: v.cardTipCents, cashTipCents: v.cashTipCents, totalCents: v.cardTipCents + v.cashTipCents })),
    byBranch: [...byBranch].map(([branchId, v]) => ({ branchId, cardTipCents: v.cardTipCents, cashTipCents: v.cashTipCents, totalCents: v.cardTipCents + v.cashTipCents })),
    byDay: [...byDay].map(([day, v]) => ({ day, cardTipCents: v.cardTipCents, cashTipCents: v.cashTipCents, totalCents: v.cardTipCents + v.cashTipCents })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}
