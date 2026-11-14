/**
 * compensation.kysely.ports.ts — production (Kysely) implementation of CompensationPorts. Read-derived and defensive:
 * every query degrades to empty on error so the post-payment snapshot can never disturb a captured payment (failures
 * are LOGGED by the service, never silent). Persists the immutable snapshot (§14) and the per-tech tip allocations (§12).
 *
 * Tips: card vs cash comes from the ticket's PAYMENTS (payments.method + payments.tip_cents); when no payment row
 * carries the tip, the ticket's tip is attributed by its chosen_payment_method ('cash' → cash rail, anything else → card).
 * Merge Oct 12 2026 (Payroll mandate §21–§29): the "whole tip on the card rail" limitation is gone.
 */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { CompensationSnapshotRepository, type SnapshotRow } from './compensation-snapshot.repository';
import type { CompensationPorts, CompCtx, ServiceLineRow, TicketMeta } from './compensation.service';
import type { TipAllocationRow } from './compensation-tips';
import { cleanRetailPolicy } from './compensation-retail-policy.service';
import { stampCommissionOnLine } from './compensation-rule-loader';
import { loadTicketAllocations } from './compensation-line-allocations';
import { CompensationExceptionsRepository, type ExceptionKind } from './compensation-exceptions.repository';
import { epochToLocalDate } from '@aipowersalon/date-time';

/** PURE: split a ticket's tip into card/cash from its payment rows (settled rows only). Falls back to the ticket's
 *  chosen method when the payments carry no tip. Σ card + cash == the ticket tip, always (mandate §26). */
export function splitTipByPaymentMethod(
  ticketTipCents: number, payments: { method: string | null; tip_cents: number | string | null; status: string | null }[], chosenMethod: string | null | undefined,
): { cardTipCents: number; cashTipCents: number } {
  const settled = payments.filter((p) => ['approved', 'partial', 'partially_refunded', 'paid', 'captured', 'completed'].includes(String(p.status || 'approved')));
  let card = 0, cash = 0;
  for (const p of settled) {
    const t = Math.max(0, Math.round(Number(p.tip_cents) || 0));
    if ((p.method || '') === 'cash') cash += t; else card += t;
  }
  const total = Math.max(0, Math.round(ticketTipCents || 0));
  if (card + cash === 0 && total > 0) return (chosenMethod || '') === 'cash' ? { cardTipCents: 0, cashTipCents: total } : { cardTipCents: total, cashTipCents: 0 };
  if (card + cash !== total && total > 0) {
    // payments disagree with the ticket total (e.g. tip added after a partial payment) — keep the ticket total, assign
    // the remainder to the dominant rail so Σ == ticket tip
    const rem = total - (card + cash);
    if (cash >= card) cash += rem; else card += rem;
    if (cash < 0) { card += cash; cash = 0; } if (card < 0) { cash += card; card = 0; }
  }
  return { cardTipCents: card, cashTipCents: cash };
}

export class KyselyCompensationPorts implements CompensationPorts {
  private readonly snap: CompensationSnapshotRepository;
  constructor(private readonly db: Kysely<DB>) { this.snap = new CompensationSnapshotRepository(db); }

  async loadServiceLines(ctx: CompCtx, ticketId: string): Promise<ServiceLineRow[]> {
    const rows: any[] = await this.db.selectFrom('ticket_service_lines')
      .select(['id', 'service_id', 'technician_id', 'price_cents_snapshot', 'line_total_cents', 'commission_type_snapshot', 'commission_value_snapshot', 'supply_method_snapshot', 'supply_value_snapshot', 'category_snapshot', 'line_kind', 'is_add_on', 'removed_at', 'policy_id', 'rule_source'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId)
      // Tips mandate (Oct 29 2026): a DETERMINISTIC line order — the tip is credited to a technician's FIRST row, so an
      // unordered read could credit it to a different line on a retried snapshot (see persistSnapshot)
      .orderBy('created_at', 'asc').orderBy('id', 'asc')
      .execute().catch(() => []);
    // A line that reached payment with NO commission snapshot (e.g. inserted by an older service-done path) is priced
    // NOW with the full precedence (rule → service rate → tenant default) and stamped, so it can never snapshot at $0.
    for (const r of rows) {
      if (r.removed_at == null && r.commission_value_snapshot == null && (r.line_kind ?? '') !== 'retail') {
        const picked = await stampCommissionOnLine(this.db, ctx.tenantId, r.id).catch(() => null);
        if (picked) { r.commission_type_snapshot = picked.commissionType; r.commission_value_snapshot = picked.commissionValue; r.supply_method_snapshot = picked.supplyMethod; r.supply_value_snapshot = picked.supplyValue; r.policy_id = picked.policyId; r.rule_source = picked.source; }
      }
    }
    const allocs = await loadTicketAllocations(this.db, ctx.tenantId, ticketId);
    return rows.map((r) => ({
      id: r.id, service_id: r.service_id ?? null, technician_id: r.technician_id ?? null,
      price_cents_snapshot: Number(r.price_cents_snapshot || 0), line_total_cents: Number(r.line_total_cents || 0),
      commission_type_snapshot: r.commission_type_snapshot || 'percent', commission_value_snapshot: Number(r.commission_value_snapshot || 0),
      supply_method_snapshot: r.supply_method_snapshot || 'none', supply_value_snapshot: Number(r.supply_value_snapshot || 0),
      category_snapshot: r.category_snapshot ?? null, is_add_on: !!r.is_add_on, line_kind: r.line_kind ?? null,
      removed_at: r.removed_at ?? null, policy_id: r.policy_id ?? null, rule_source: r.rule_source ?? null,
      allocations: allocs.get(r.id) ?? [],
    }));
  }

  /** tenant flag (tenant_settings.compensation.refundReversalReview): route refund reversals to review instead of posting. */
  async refundReversalReview(ctx: CompCtx): Promise<boolean> {
    try {
      const s: any = await this.db.selectFrom('tenant_settings').select(['settings_json'])
        .where('tenant_id', '=', ctx.tenantId).where('category', '=', 'compensation').where('branch_id', 'is', null).executeTakeFirst();
      const j = s?.settings_json ? (typeof s.settings_json === 'string' ? JSON.parse(s.settings_json) : s.settings_json) : null;
      return j?.refundReversalReview === true;
    } catch { return false; }
  }

  async loadTicketMeta(ctx: CompCtx, ticketId: string): Promise<TicketMeta | null> {
    const t: any = await this.db.selectFrom('tickets')
      .select(['discount_cents', 'tip_cents', 'paid_at', 'chosen_payment_method']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId)
      .executeTakeFirst().catch(() => null);
    if (!t) return null;
    const payments: any[] = await this.db.selectFrom('payments').select(['method', 'tip_cents', 'status'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).execute().catch(() => []);
    const tipSplit = splitTipByPaymentMethod(Number(t.tip_cents || 0), payments, t.chosen_payment_method);
    // An explicit per-technician allocation already on file (manual POST /pos/tickets/:id/tip-allocation, or a
    // customer-directed split) governs the ticket's tip — the ONE tip store (mandate §25: explicit split wins).
    const directedRows: any[] = await this.db.selectFrom('ticket_tip_allocations').select(['technician_id', 'tip_cents'])
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).execute().catch(() => []);
    const directedTips = directedRows.length ? directedRows.map((r) => ({ technicianId: r.technician_id, tipCents: Number(r.tip_cents || 0) })) : undefined;
    // Salon-level compensation settings (spec §11 tip policy + §16 retail commission): tenant_settings category
    // 'compensation'. Best-effort; any miss falls through to the defaults in the engine (equal tips for 3+, no retail).
    let manyTechTipMethod: string | undefined;
    let retailCommission: { method: string; value: number } | undefined;
    try {
      const s: any = await this.db.selectFrom('tenant_settings').select(['settings_json'])
        .where('tenant_id', '=', ctx.tenantId).where('category', '=', 'compensation')
        .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]))
        .orderBy('branch_id', 'desc').executeTakeFirst();
      const j = s?.settings_json ? (typeof s.settings_json === 'string' ? JSON.parse(s.settings_json) : s.settings_json) : null;
      if (j && (j.manyTechTipMethod === 'equal' || j.manyTechTipMethod === 'proportional')) manyTechTipMethod = j.manyTechTipMethod;
      if (j?.retailCommission) { const rc = cleanRetailPolicy(j.retailCommission); if (rc.method !== 'none') retailCommission = rc; }
    } catch { /* best-effort */ }
    return {
      discountCents: Number(t.discount_cents || 0),
      cardTipCents: tipSplit.cardTipCents, cashTipCents: tipSplit.cashTipCents,
      manyTechTipMethod, retailCommission, directedTips,
      paidAtIso: t.paid_at ? new Date(t.paid_at).toISOString() : new Date().toISOString(),
    };
  }

  async persistSnapshot(rows: SnapshotRow[]): Promise<number> { return this.snap.persistSnapshot(rows); }
  async loadSnapshotRows(ctx: CompCtx, ticketId: string) {
    const rows = await this.snap.getByTicket(ctx.tenantId, ticketId);
    return rows.map((r: any) => ({
      service_line_id: r.service_line_id, technician_id: r.technician_id,
      tech_service_earnings_cents: Number(r.tech_service_earnings_cents || 0), salon_service_share_cents: Number(r.salon_service_share_cents || 0),
      supply_cents: Number(r.supply_cents || 0), card_tip_cents: Number(r.card_tip_cents || 0), cash_tip_cents: Number(r.cash_tip_cents || 0),
      retail_commission_cents: Number(r.retail_commission_cents || 0),
    }));
  }
  async persistAdjustments(ctx: CompCtx, rows: any[]): Promise<number> { return this.snap.persistAdjustments(ctx.tenantId, ctx.branchId, rows); }
  async isTicketPeriodPaid(ctx: CompCtx, ticketId: string): Promise<boolean> {
    try {
      const t: any = await this.db.selectFrom('tickets').select(['paid_at']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
      const paidAt = t?.paid_at; if (!paidAt) return false;
      const p: any = await this.db.selectFrom('payroll_periods').select(['status'])
        .where('tenant_id', '=', ctx.tenantId)
        .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]))
        .where('period_start', '<=', paidAt).where('period_end', '>=', paidAt).where('status', '=', 'paid')
        .executeTakeFirst();
      return !!p;
    } catch { return false; }
  }

  /** wave 2 §54/§129: the ticket's pay period by its paid date IN THE SALON'S ZONE (§126 — not UTC midnight). Locked =
   *  approved (finalized) or paid. The correction lands in the earliest OPEN (draft) period that starts after the locked one
   *  (same branch or salon-wide); none yet → null and the entry lands by its date when that period is built. */
  async lockedPeriodRouting(ctx: CompCtx, ticketId: string): Promise<{ locked: boolean; originalPeriodId: string | null; targetPeriodId: string | null }> {
    const t: any = await this.db.selectFrom('tickets').select(['paid_at', 'branch_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', ticketId).executeTakeFirst();
    if (!t?.paid_at) return { locked: false, originalPeriodId: null, targetPeriodId: null };
    const branchId = t.branch_id ?? ctx.branchId ?? null;
    const tz = await this.snap.tenantTimezone(ctx.tenantId, branchId);
    const day = epochToLocalDate(new Date(t.paid_at).getTime(), tz);
    const scope = (eb: any) => (branchId ? eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]) : eb('branch_id', 'is', null));
    const p: any = await this.db.selectFrom('payroll_periods').select(['id', 'period_end', 'status'])
      .where('tenant_id', '=', ctx.tenantId).where(scope).where('period_start', '<=', day).where('period_end', '>=', day)
      .where('status', 'in', ['finalized', 'paid']).orderBy('period_start', 'desc').executeTakeFirst();
    if (!p) return { locked: false, originalPeriodId: null, targetPeriodId: null };
    const next: any = await this.db.selectFrom('payroll_periods').select(['id'])
      .where('tenant_id', '=', ctx.tenantId).where(scope).where('status', '=', 'draft').where('period_start', '>', p.period_end)
      .orderBy('period_start', 'asc').executeTakeFirst();
    return { locked: true, originalPeriodId: p.id, targetPeriodId: next?.id ?? null };
  }

  async raiseException(ctx: CompCtx, e: { kind: string; severity: 'blocking' | 'warning'; dedupeKey: string; ticketId?: string | null; periodId?: string | null; detail?: Record<string, unknown> }): Promise<void> {
    await new CompensationExceptionsRepository(this.db).raise(ctx.tenantId, { ...e, kind: e.kind as ExceptionKind, branchId: ctx.branchId });
  }

  /** Upsert on (tenant, ticket, technician): the engine's allocation is the single tip record for the ticket. */
  async persistTipAllocations(rows: TipAllocationRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const res = await this.db.insertInto('ticket_tip_allocations')
      .values(rows.map((r) => ({ tenant_id: r.tenant_id, branch_id: r.branch_id, ticket_id: r.ticket_id, technician_id: r.technician_id, tip_cents: r.tip_cents })))
      .onConflict((oc: any) => oc.columns(['tenant_id', 'ticket_id', 'technician_id']).doUpdateSet({ tip_cents: (eb: any) => eb.ref('excluded.tip_cents') }))
      .execute().catch(() => []);
    return Array.isArray(res) ? rows.length : 0;
  }
}
