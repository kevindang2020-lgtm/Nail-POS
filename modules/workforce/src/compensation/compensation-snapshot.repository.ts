/**
 * compensation-snapshot.repository.ts — persistence for the IMMUTABLE compensation snapshot (spec §14).
 * `snapshotRowsFromResult` is a PURE mapper (engine result → DB rows) so it is unit-tested without a database.
 * `persistSnapshot` inserts idempotently (ON CONFLICT DO NOTHING) — snapshots are write-once; corrections go to the
 * adjustment ledger (P7), never an in-place edit. Reads power payroll/earnings/reports as the single source of truth.
 */
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, tenantTimeZone, type DB } from '@aipowersalon/database';
import type { TicketCompensationResult, TicketCompensationInput } from './compensation.types';
import { ymdOf } from '../payroll/payroll.dto';

export interface SnapshotRow {
  tenant_id: string; branch_id: string | null; ticket_id: string; service_line_id: string;
  technician_id: string | null; service_id: string | null;
  engine_version: string; policy_id: string | null; policy_version: number | null; commission_source: string | null; rule_source: string | null;
  gross_price_cents: number; discount_cents: number; discount_funding: string | null; tax_cents: number; supply_cents: number;
  commissionable_cents: number; commission_type: string | null; commission_value: number | null;
  tech_service_earnings_cents: number; salon_service_share_cents: number;
  card_tip_cents: number; cash_tip_cents: number; retail_commission_cents: number;
  snapshot_at: string;
}

/** PURE: flatten an engine result into one immutable row per (line, technician). */
export function snapshotRowsFromResult(
  input: TicketCompensationInput, result: TicketCompensationResult,
  meta: { tenantId: string; branchId: string | null; snapshotAt: string; engineVersion: string },
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  const techCredited = new Set<string>(); // tips/retail are per-technician — credit them on the first row only
  for (const line of result.lines) {
    const src = input.serviceLines.find((l) => l.lineId === line.lineId);
    // how many techs share this line — split the line's salon share across rows by tech-earnings weight for reporting
    for (const pt of line.perTech) {
      const tech = result.perTechnician.find((t) => t.technicianId === pt.technicianId);
      const firstForTech = !techCredited.has(pt.technicianId); techCredited.add(pt.technicianId);
      rows.push({
        tenant_id: meta.tenantId, branch_id: meta.branchId, ticket_id: result.ticketId,
        service_line_id: line.lineId, technician_id: pt.technicianId === 'unassigned' ? null : pt.technicianId,
        service_id: src?.serviceId ?? null,
        // provenance: the LINE's own rule wins (migration 587); the ticket-level policy is only a fallback
        engine_version: meta.engineVersion, policy_id: src?.policyId ?? input.policyId ?? null, policy_version: src?.policyVersion ?? input.policyVersion ?? null,
        commission_source: line.commissionSource ?? null, rule_source: src?.ruleSource ?? line.commissionSource ?? null,
        gross_price_cents: line.priceCents, discount_cents: line.discountCents, discount_funding: line.discountFunding,
        tax_cents: line.taxCents, supply_cents: line.supplyCents, commissionable_cents: pt.commissionableCents,
        commission_type: src?.commission.type ?? null, commission_value: src?.commission.value ?? null,
        tech_service_earnings_cents: pt.techServiceEarningsCents,
        // salon share is a line-level figure; attribute it to the first tech row only so Σ rows == line salon share
        salon_service_share_cents: pt === line.perTech[0] ? line.salonServiceShareCents : 0,
        card_tip_cents: firstForTech ? (tech?.cardTipCents ?? 0) : 0, cash_tip_cents: firstForTech ? (tech?.cashTipCents ?? 0) : 0,
        retail_commission_cents: firstForTech ? (tech?.retailCommissionCents ?? 0) : 0,
        snapshot_at: meta.snapshotAt,
      });
    }
  }
  return rows;
}

export class CompensationSnapshotRepository {
  constructor(private readonly db: Kysely<DB>) {}

  /** The branch's (or salon's) configured timezone — the ONE lookup (packages/database branch-timezone). Mandate §126. */
  async tenantTimezone(tenantId: string, branchId?: string | null): Promise<string> {
    try { return branchId ? await branchTimeZone(this.db, tenantId, branchId) : await tenantTimeZone(this.db, tenantId); }
    catch { return 'America/New_York'; }
  }

  /** A payroll period row (tenant-scoped) for the `pay_period` earnings option. */
  async payrollPeriod(tenantId: string, periodId: string): Promise<{ id: string; periodStart: string; periodEnd: string; status: string } | null> {
    const r: any = await (this.db as any).selectFrom('payroll_periods').select(['id', 'period_start', 'period_end', 'status'])
      .where('tenant_id', '=', tenantId).where('id', '=', periodId).executeTakeFirst().catch(() => null);
    return r ? { id: r.id, periodStart: ymdOf(r.period_start), periodEnd: ymdOf(r.period_end), status: r.status } : null;
  }

  /** Write-once. Idempotent: a retried checkout for the same (ticket,line,tech) is a no-op (§14). */
  async persistSnapshot(rows: SnapshotRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await (this.db as any).insertInto('ticket_compensation_snapshots')
      .values(rows).onConflict((oc: any) => oc.columns(['tenant_id', 'ticket_id', 'service_line_id', 'technician_id']).doNothing())
      .execute().catch(() => []);
    return Array.isArray(res) ? rows.length : 0;
  }

  async getByTicket(tenantId: string, ticketId: string): Promise<any[]> {
    return (this.db as any).selectFrom('ticket_compensation_snapshots')
      .selectAll().where('tenant_id', '=', tenantId).where('ticket_id', '=', ticketId)
      .execute().catch(() => []);
  }

  /** Persist refund/void reversal + manual adjustment ledger entries (§21/§24). Signed amounts; never rewrites the
   *  frozen snapshot. Best-effort insert into compensation_adjustments. */
  async persistAdjustments(tenantId: string, branchId: string | null, rows: import('./compensation-adjustments').AdjustmentEntry[]): Promise<number> {
    if (!rows.length) return 0;
    // Idempotent per refund (migration 588): a replayed refund hook hits the partial unique index and inserts nothing —
    // commission is never reversed twice and the first set of rows (history) is preserved.
    const res: any[] = await (this.db as any).insertInto('compensation_adjustments')
      .values(rows.map((r) => ({
        tenant_id: tenantId, branch_id: branchId, technician_id: r.technicianId, ticket_id: r.ticketId, service_line_id: r.serviceLineId,
        period_id: r.periodId, category: r.category, amount_cents: r.amountCents, reason: r.reason, status: r.status, source: r.source,
        targets_future_period: r.targetsFuturePeriod, requested_by: r.requestedBy, approved_by: r.approvedBy,
        refund_payment_id: r.refundPaymentId ?? null, original_period_id: r.originalPeriodId ?? null, chargeback_id: r.chargebackId ?? null,
      })))
      .onConflict((oc: any) => oc.expression(sql`tenant_id, refund_payment_id, COALESCE(service_line_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(technician_id, '00000000-0000-0000-0000-000000000000'::uuid), category`).where('refund_payment_id', 'is not', null).doNothing())
      .returning(['id'])
      .execute().catch((e: any) => { if (process.env.NODE_ENV !== 'test') console.error('compensation_adjustments_persist_failed', e?.message || e); return []; });
    return Array.isArray(res) ? res.length : 0;
  }

  /** Sum a technician's snapshot earnings over a HALF-OPEN period [fromIso, toIso) — the canonical read for payroll/
   *  earnings (§17/§20). `<=` on the upper bound double-counted a ticket paid exactly at the boundary into two periods.
   *  Includes the net of posted/approved/applied ledger adjustments (refund reversals, corrections) whose created_at
   *  falls in the window, so a refunded ticket's commission is NOT still shown as earned (mandate §47). */
  /** `branchId` (Oct 13 2026, FLOW D3/D4/D5): scope to ONE location — the Live Technician Schedule detail, the POS team
   *  list and the owner analytics read this instead of re-pricing lines with a current rate. */
  async sumByTechnicianPeriod(tenantId: string, technicianId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<{
    techServiceEarningsCents: number; cardTipCents: number; cashTipCents: number; retailCommissionCents: number; grossServiceCents: number; tickets: number; adjustmentsCents: number;
  }> {
    let sq = (this.db as any).selectFrom('ticket_compensation_snapshots')
      .selectAll().where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId)
      .where('snapshot_at', '>=', fromIso).where('snapshot_at', '<', toIso);
    if (branchId) sq = sq.where('branch_id', '=', branchId);
    const rows: any[] = await sq.execute().catch(() => []);
    let aq = (this.db as any).selectFrom('compensation_adjustments')
      .select(['amount_cents', 'category']).where('tenant_id', '=', tenantId).where('technician_id', '=', technicianId)
      .where('status', 'in', ['posted', 'approved', 'applied']).where('created_at', '>=', fromIso).where('created_at', '<', toIso);
    if (branchId) aq = aq.where('branch_id', '=', branchId);
    const adj: any[] = await aq.execute().catch(() => []);
    const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    const adjSum = (pred: (c: string) => boolean) => adj.filter((a) => pred(String(a.category))).reduce((a, r) => a + Number(r.amount_cents || 0), 0);
    const tipAdj = adjSum((c) => c === 'tip_correction');
    return {
      techServiceEarningsCents: sum('tech_service_earnings_cents'), cardTipCents: sum('card_tip_cents') + tipAdj,
      cashTipCents: sum('cash_tip_cents'), retailCommissionCents: sum('retail_commission_cents'),
      grossServiceCents: sum('gross_price_cents'),
      tickets: new Set(rows.map((r) => r.ticket_id)).size,
      adjustmentsCents: adjSum((c) => c !== 'tip_correction'),
    };
  }

  /** Oct 13 2026 (FLOW duplicate D4/D5): commission per technician over a half-open window from the snapshot — service
   *  earnings + retail commission + posted/approved ledger adjustments (tips excluded) — for the POS team list and the
   *  owner analytics, which used to multiply sales by the technician's CURRENT rate. Optional branch scope. */
  /** ONE-PAY (Oct 13 2026): also `tipsCents` — card + cash from the snapshot plus posted tip_correction entries, the same
   *  tips sumByTechnicianPeriod reports — so no screen attributes a ticket's tip on its own. */
  async commissionByTechnician(tenantId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<Map<string, { commissionCents: number; tickets: number; tipsCents: number }>> {
    const out = new Map<string, { commissionCents: number; tickets: number; tipsCents: number }>();
    const cur = (k: string) => out.get(k) ?? { commissionCents: 0, tickets: 0, tipsCents: 0 };
    let sq = (this.db as any).selectFrom('ticket_compensation_snapshots')
      .select(['technician_id', sql<number>`coalesce(sum(tech_service_earnings_cents + retail_commission_cents), 0)`.as('earn'), sql<number>`count(distinct ticket_id)`.as('tickets'),
        sql<number>`coalesce(sum(card_tip_cents + cash_tip_cents), 0)`.as('tips')])
      .where('tenant_id', '=', tenantId).where('snapshot_at', '>=', fromIso).where('snapshot_at', '<', toIso).groupBy('technician_id');
    if (branchId) sq = sq.where('branch_id', '=', branchId);
    for (const r of (await sq.execute().catch(() => [])) as any[]) out.set(String(r.technician_id), { commissionCents: Number(r.earn) || 0, tickets: Number(r.tickets) || 0, tipsCents: Number(r.tips) || 0 });
    let aq = (this.db as any).selectFrom('compensation_adjustments')
      .select(['technician_id', 'category', sql<number>`coalesce(sum(amount_cents), 0)`.as('adj')])
      .where('tenant_id', '=', tenantId).where('status', 'in', ['posted', 'approved', 'applied'])
      .where('created_at', '>=', fromIso).where('created_at', '<', toIso).groupBy(['technician_id', 'category']);
    if (branchId) aq = aq.where('branch_id', '=', branchId);
    for (const r of (await aq.execute().catch(() => [])) as any[]) {
      const k = String(r.technician_id); const c = cur(k); const v = Number(r.adj) || 0;
      out.set(k, String(r.category) === 'tip_correction' ? { ...c, tipsCents: c.tipsCents + v } : { ...c, commissionCents: c.commissionCents + v });
    }
    return out;
  }

  /** This technician's snapshot LINES in [fromIso, toIso) with the service name — the single detail reader for the
   *  Tech App earnings screen (same store, same numbers as the summary; mandate §86–§87). */
  async linesByTechnicianPeriod(tenantId: string, technicianId: string, fromIso: string, toIso: string): Promise<{ serviceName: string; lineTotalCents: number; commissionCents: number; completedAt: string; ticketId: string; ruleSource: string | null }[]> {
    const rows: any[] = await (this.db as any).selectFrom('ticket_compensation_snapshots as s')
      .leftJoin('ticket_service_lines as l', 'l.id', 's.service_line_id')
      .select(['s.ticket_id as ticket_id', 's.gross_price_cents as gross_price_cents', 's.tech_service_earnings_cents as tech_service_earnings_cents', 's.snapshot_at as snapshot_at', 's.rule_source as rule_source', 'l.service_name_snapshot as service_name'])
      .where('s.tenant_id', '=', tenantId).where('s.technician_id', '=', technicianId)
      .where('s.snapshot_at', '>=', fromIso).where('s.snapshot_at', '<', toIso)
      .orderBy('s.snapshot_at', 'asc').execute().catch(() => []);
    return rows.map((r) => ({ serviceName: r.service_name ?? '', lineTotalCents: Number(r.gross_price_cents || 0), commissionCents: Number(r.tech_service_earnings_cents || 0),
      completedAt: new Date(r.snapshot_at).toISOString(), ticketId: r.ticket_id, ruleSource: r.rule_source ?? null }));
  }

  /** §18 card/cash tip report from the canonical snapshot over a period. */
  async tipReport(tenantId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<any[]> {
    let q = (this.db as any).selectFrom('ticket_compensation_snapshots')
      .select(['technician_id', 'branch_id', 'ticket_id', 'card_tip_cents', 'cash_tip_cents', 'snapshot_at'])
      .where('tenant_id', '=', tenantId).where('snapshot_at', '>=', fromIso).where('snapshot_at', '<', toIso);
    if (branchId) q = q.where('branch_id', '=', branchId);
    const rows: any[] = await q.execute().catch(() => []);
    return rows.map((r) => ({ technicianId: r.technician_id, branchId: r.branch_id, ticketId: r.ticket_id,
      cardTipCents: Number(r.card_tip_cents || 0), cashTipCents: Number(r.cash_tip_cents || 0),
      day: String(r.snapshot_at).slice(0, 10) }));
  }

  /** Per-technician snapshot sums for ALL technicians with earnings in the window (payroll period auto-build). */
  async sumAllTechniciansPeriod(tenantId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<{ technicianId: string; branchId: string | null; sums: { techServiceEarningsCents: number; cardTipCents: number; cashTipCents: number; retailCommissionCents: number; grossServiceCents: number; tickets: number } }[]> {
    let q = (this.db as any).selectFrom('ticket_compensation_snapshots')
      .select(['technician_id', 'branch_id', 'ticket_id', 'tech_service_earnings_cents', 'card_tip_cents', 'cash_tip_cents', 'retail_commission_cents', 'gross_price_cents'])
      .where('tenant_id', '=', tenantId).where('snapshot_at', '>=', fromIso).where('snapshot_at', '<', toIso);
    if (branchId) q = q.where('branch_id', '=', branchId);
    const rows: any[] = await q.execute().catch(() => []);
    const byTech = new Map<string, { branchId: string | null; tickets: Set<string>; s: any }>();
    for (const r of rows) {
      const id = r.technician_id; if (!id) continue;
      const e = byTech.get(id) ?? { branchId: r.branch_id ?? null, tickets: new Set<string>(), s: { techServiceEarningsCents: 0, cardTipCents: 0, cashTipCents: 0, retailCommissionCents: 0, grossServiceCents: 0 } };
      e.s.techServiceEarningsCents += Number(r.tech_service_earnings_cents || 0); e.s.cardTipCents += Number(r.card_tip_cents || 0);
      e.s.cashTipCents += Number(r.cash_tip_cents || 0); e.s.retailCommissionCents += Number(r.retail_commission_cents || 0);
      e.s.grossServiceCents += Number(r.gross_price_cents || 0); e.tickets.add(r.ticket_id); byTech.set(id, e);
    }
    return [...byTech].map(([technicianId, e]) => ({ technicianId, branchId: e.branchId, sums: { ...e.s, tickets: e.tickets.size } }));
  }

  /** Snapshot rows for ONE ticket, scoped to a single technician (Tech App receipt — never another tech's data). */
  async getByTicketForTechnician(tenantId: string, ticketId: string, technicianId: string): Promise<any[]> {
    return (this.db as any).selectFrom('ticket_compensation_snapshots')
      .selectAll().where('tenant_id', '=', tenantId).where('ticket_id', '=', ticketId).where('technician_id', '=', technicianId)
      .execute().catch(() => []);
  }

  /** Raw rows for the commission/supply reports over a period (optionally branch-scoped). */
  async reportRows(tenantId: string, fromIso: string, toIso: string, branchId?: string | null): Promise<any[]> {
    let q = (this.db as any).selectFrom('ticket_compensation_snapshots')
      .select(['technician_id', 'branch_id', 'service_id', 'snapshot_at', 'gross_price_cents', 'discount_cents', 'supply_cents', 'commissionable_cents', 'tech_service_earnings_cents', 'salon_service_share_cents', 'retail_commission_cents'])
      .where('tenant_id', '=', tenantId).where('snapshot_at', '>=', fromIso).where('snapshot_at', '<', toIso);
    if (branchId) q = q.where('branch_id', '=', branchId);
    const rows: any[] = await q.execute().catch(() => []);
    return rows.map((r) => ({ technicianId: r.technician_id, branchId: r.branch_id, serviceId: r.service_id, day: String(r.snapshot_at).slice(0, 10),
      grossPriceCents: Number(r.gross_price_cents || 0), discountCents: Number(r.discount_cents || 0), supplyCents: Number(r.supply_cents || 0),
      commissionableCents: Number(r.commissionable_cents || 0), techServiceEarningsCents: Number(r.tech_service_earnings_cents || 0),
      salonServiceShareCents: Number(r.salon_service_share_cents || 0), retailCommissionCents: Number(r.retail_commission_cents || 0) }));
  }
}
