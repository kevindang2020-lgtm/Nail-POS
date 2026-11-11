// payroll.kysely.repository.ts — Postgres adapter. Upserting a line (unique per period+technician) recomputes the
// period totals in a follow-up aggregate update. Tenant-scoped; platform read is cross-tenant (Super-Admin only).
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import { applyListQuery, parseListQuery, assertTransition, escapeLike, type DB } from '@aipowersalon/database';
import { PAYROLL_PERIODS_SPEC } from './payroll.list-queries';
import type { PayrollContext, PayrollRepositoryPort, PeriodPage, CanonicalLineInput } from './payroll.repository';
import type { PayrollPeriodRow, PayrollLineRow, PeriodFilters, CreatePeriodRequest, PeriodStatus, CommissionType } from './payroll.dto';
import { PAYROLL_PERIOD, dashboardStatusOf, ymdOf, technicianTerm } from './payroll.dto';
import { clampPage } from '@aipowersalon/api-contracts';
import { periodsOverlap, overlapError } from './payroll-workflow';
// Vietnamese letters folded to plain ones for the technician search (the same fold technicianTerm applies to the term)
const FOLD_FROM = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ';
const FOLD_TO = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydaaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

export const toPeriod = (r: any): PayrollPeriodRow => withDashboard({
  id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, label: r.label ?? null,
  periodStart: ymdOf(r.period_start), periodEnd: ymdOf(r.period_end), status: (r.status || 'draft') as PeriodStatus,
  finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null, paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
  totalGrossCents: Number(r.total_gross_cents || 0), totalCommissionCents: Number(r.total_commission_cents || 0),
  totalTipsCents: Number(r.total_tips_cents || 0), totalPayableCents: Number(r.total_payable_cents || 0),
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  reopenReason: r.reopen_reason ?? null, reopenedAt: r.reopened_at ? new Date(r.reopened_at).toISOString() : null, reopenedBy: r.reopened_by ?? null,
  version: Number(r.version ?? 1), calculationVersion: r.calculation_version ?? null, previewHash: r.preview_hash ?? null, approvalHash: r.approval_hash ?? null,
  preparedAt: r.prepared_at ? new Date(r.prepared_at).toISOString() : null, preparedBy: r.prepared_by ?? null, approvedBy: r.approved_by ?? null, paidBy: r.paid_by ?? null,
  blockingCount: Number(r.blocking_count ?? 0), warningCount: Number(r.warning_count ?? 0), payDate: r.pay_date ? ymdOf(r.pay_date) : null,
});
function withDashboard(p: PayrollPeriodRow): PayrollPeriodRow { return { ...p, dashboardStatus: dashboardStatusOf(p) }; }
export const toLine = (r: any): PayrollLineRow => ({
  id: r.id, tenantId: r.tenant_id, periodId: r.period_id, technicianId: r.technician_id, technicianName: r.technician_name ?? null,
  servicesCount: Number(r.services_count || 0), grossSalesCents: Number(r.gross_sales_cents || 0),
  commissionType: (r.commission_type || 'percent') as CommissionType, commissionValue: Number(r.commission_value || 0),
  commissionCents: Number(r.commission_cents || 0), tipsCents: Number(r.tips_cents || 0), adjustmentCents: Number(r.adjustment_cents || 0),
  payableCents: Number(r.payable_cents || 0), createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
  retailCommissionCents: Number(r.retail_commission_cents || 0), cardTipCents: Number(r.card_tip_cents || 0), cashTipCents: Number(r.cash_tip_cents || 0),
  guaranteeTopUpCents: Number(r.guarantee_topup_cents || 0), hourlyPayCents: Number(r.hourly_pay_cents || 0), workedMinutes: Number(r.worked_minutes || 0),
  potentialOvertimeMinutes: Number(r.potential_overtime_minutes || 0), salaryPayCents: Number(r.salary_pay_cents || 0), bonusCents: Number(r.bonus_cents || 0),
  deductionCents: Number(r.deduction_cents || 0), netCents: Number(r.net_cents ?? r.payable_cents ?? 0), reviewRequired: !!r.review_required,
});

export class KyselyPayrollRepository implements PayrollRepositoryPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** Will payroll transitions reach the owner's and technicians' screens through the realtime projection? */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  async technicianUserIds(ctx: PayrollContext, technicianIds: string[]): Promise<Record<string, string>> {
    if (!technicianIds.length) return {};
    const rows = await this.db.selectFrom('technicians').where('tenant_id', '=', ctx.tenantId).where('id', 'in', technicianIds)
      .select(['id', 'user_id']).execute().catch(() => [] as any[]);
    const out: Record<string, string> = {};
    for (const r of rows as any[]) if (r.user_id) out[r.id] = r.user_id;
    return out;
  }

  async createPeriod(ctx: PayrollContext, req: CreatePeriodRequest): Promise<PayrollPeriodRow> {
    // one salon's periods are created one at a time (advisory lock), and never over another period's days (deep-scan,
    // Oct 22 2026: the builder pays every sale in the window, so an overlapping period paid the same tickets twice)
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'pay-period-create:' + ctx.tenantId}))`.execute(trx);
      const branchId = ctx.branchId ?? null;
      const near = await trx.selectFrom('payroll_periods').select(['id', 'label', 'branch_id', sql<string>`period_start::text`.as('ps'), sql<string>`period_end::text`.as('pe')])
        .where('tenant_id', '=', ctx.tenantId).where('status', '<>', 'canceled')   // a canceled period holds no days (Weekly Paycheck §3.4)
        .where(sql<boolean>`period_start <= ${req.periodEnd}::date AND period_end >= ${req.periodStart}::date`).execute();
      const clash = near.find((p) => periodsOverlap({ periodStart: p.ps, periodEnd: p.pe, branchId: (p.branch_id as string | null) ?? null }, { periodStart: req.periodStart, periodEnd: req.periodEnd, branchId }));
      if (clash) throw overlapError({ id: String(clash.id), periodStart: clash.ps, periodEnd: clash.pe, label: (clash.label as string | null) ?? null });
      const ins = await trx.insertInto('payroll_periods').values({
        tenant_id: ctx.tenantId, branch_id: branchId, label: req.label ?? null,
        period_start: req.periodStart as any, period_end: req.periodEnd as any, status: 'draft', created_by: ctx.userId ?? null,
      } as any).returningAll().executeTakeFirstOrThrow();
      return toPeriod(ins);
    });
  }

  async getPeriod(ctx: PayrollContext, id: string): Promise<PayrollPeriodRow | null> {
    const r = await this.db.selectFrom('payroll_periods').selectAll().where('id', '=', id).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return r ? toPeriod(r) : null;
  }

  // BUILD_PLAN Phase 12 (DoD #21/#22): filters, search and order from PAYROLL_PERIODS_SPEC — columns from the spec, values bound
  private async page(where: (qb: any) => any, f: PeriodFilters): Promise<PeriodPage> {
    const lq = parseListQuery(f as Record<string, unknown>, PAYROLL_PERIODS_SPEC);
    // batch 9: ?technician= — periods with a line for a technician whose name (accent-free) or phone matches
    const term = technicianTerm(f.technician);
    const baseWhere = !term ? where : (qb: any) => where(qb).where(sql<boolean>`exists (select 1 from payroll_lines pl left join technicians t on t.id = pl.technician_id and t.tenant_id = pl.tenant_id
      where pl.period_id = payroll_periods.id and pl.tenant_id = payroll_periods.tenant_id
        and (lower(translate(coalesce(pl.technician_name, '') || ' ' || coalesce(t.full_name, ''), ${FOLD_FROM}, ${FOLD_TO})) like ${'%' + escapeLike(term.text) + '%'}
          ${term.digits ? sql`or coalesce(t.normalized_phone, '') like ${'%' + term.digits + '%'}` : sql``}))`);
    const page = clampPage(f.page);
    const pageSize = lq.limit;
    const countRow: any = await applyListQuery(baseWhere(this.db.selectFrom('payroll_periods')), lq, { sort: false, limit: false }).select(sql<number>`count(*)`.as('n')).executeTakeFirst().catch(() => ({ n: 0 }));
    const totalItems = Number(countRow?.n || 0);
    const rows = await applyListQuery(baseWhere(this.db.selectFrom('payroll_periods')), lq, { limit: false }).selectAll().limit(pageSize).offset((page - 1) * pageSize).execute().catch(() => []);
    return { items: (rows as any[]).map(toPeriod), pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) } };
  }
  listPeriods(tenantId: string, filters: PeriodFilters): Promise<PeriodPage> { return this.page((qb) => qb.where('tenant_id', '=', tenantId), filters); }
  listPlatform(filters: PeriodFilters & { tenantId?: string }): Promise<PeriodPage> { return this.page((qb) => (filters.tenantId ? qb.where('tenant_id', '=', filters.tenantId) : qb), filters); }

  async getLines(ctx: PayrollContext, periodId: string): Promise<PayrollLineRow[]> {
    const p = await this.getPeriod(ctx, periodId);
    if (!p) return [];
    const rows = await this.db.selectFrom('payroll_lines').selectAll().where('period_id', '=', periodId).where('tenant_id', '=', ctx.tenantId).orderBy('payable_cents', 'desc').execute();
    return (rows as any[]).map(toLine);
  }

  private async recompute(ctx: PayrollContext, periodId: string): Promise<PayrollPeriodRow | null> {
    const agg: any = await this.db.selectFrom('payroll_lines')
      .select([sql<number>`coalesce(sum(gross_sales_cents),0)`.as('g'), sql<number>`coalesce(sum(commission_cents),0)`.as('c'), sql<number>`coalesce(sum(tips_cents),0)`.as('t'), sql<number>`coalesce(sum(payable_cents),0)`.as('p')])
      .where('period_id', '=', periodId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    const r = await this.db.updateTable('payroll_periods').set({
      total_gross_cents: Number(agg?.g || 0), total_commission_cents: Number(agg?.c || 0), total_tips_cents: Number(agg?.t || 0), total_payable_cents: Number(agg?.p || 0), updated_at: sql`now()`,
      version: sql`version + 1`,   // wave 2 (§75): every line change is a new version — a stale approve / pay is refused
    } as any).where('id', '=', periodId).where('tenant_id', '=', ctx.tenantId).returningAll().executeTakeFirst();
    return r ? toPeriod(r) : null;
  }

  async persistCanonicalLine(ctx: PayrollContext, periodId: string, l: CanonicalLineInput) {
    const p = await this.getPeriod(ctx, periodId);
    if (!p) return null;
    const vals = {
      tenant_id: ctx.tenantId, period_id: periodId, technician_id: l.technicianId, technician_name: l.technicianName ?? null,
      services_count: l.servicesCount, gross_sales_cents: l.grossSalesCents, commission_type: 'canonical', commission_value: 0,
      commission_cents: l.serviceCommissionCents, retail_commission_cents: l.retailCommissionCents,
      card_tip_cents: l.cardTipCents, cash_tip_cents: l.cashTipCents, guarantee_topup_cents: l.guaranteeTopUpCents,
      tips_cents: l.tipsCents, adjustment_cents: l.adjustmentCents, payable_cents: l.payableCents,
      hourly_pay_cents: l.hourlyPayCents ?? 0, worked_minutes: l.workedMinutes ?? 0, potential_overtime_minutes: l.potentialOvertimeMinutes ?? 0,
      salary_pay_cents: l.salaryPayCents ?? 0, bonus_cents: l.bonusCents ?? 0, deduction_cents: l.deductionCents ?? 0,
      net_cents: l.netCents ?? l.payableCents, review_required: !!l.reviewRequired,
    };
    const ins = await this.db.insertInto('payroll_lines').values(vals as any)
      .onConflict((oc) => oc.columns(['period_id', 'technician_id']).doUpdateSet({
        technician_name: l.technicianName ?? null, services_count: l.servicesCount, gross_sales_cents: l.grossSalesCents,
        commission_type: 'canonical', commission_value: 0, commission_cents: l.serviceCommissionCents,
        retail_commission_cents: l.retailCommissionCents, card_tip_cents: l.cardTipCents, cash_tip_cents: l.cashTipCents,
        guarantee_topup_cents: l.guaranteeTopUpCents, tips_cents: l.tipsCents, adjustment_cents: l.adjustmentCents,
        payable_cents: l.payableCents, updated_at: sql`now()`,
        hourly_pay_cents: l.hourlyPayCents ?? 0, worked_minutes: l.workedMinutes ?? 0, potential_overtime_minutes: l.potentialOvertimeMinutes ?? 0,
        salary_pay_cents: l.salaryPayCents ?? 0, bonus_cents: l.bonusCents ?? 0, deduction_cents: l.deductionCents ?? 0,
        net_cents: l.netCents ?? l.payableCents, review_required: !!l.reviewRequired,
      } as any))
      .returningAll().executeTakeFirstOrThrow();
    const period = await this.recompute(ctx, periodId);
    return { period: period!, line: toLine(ins) };
  }

  /** §65 (200-technician salon): the whole build in ONE multi-row upsert (chunked) and ONE totals recompute — the
   *  per-line path above cost a period read + upsert + aggregate + period update per technician. Same rows, same totals;
   *  the period version moves once for the build (it is one change), not once per technician. */
  async persistCanonicalLines(ctx: PayrollContext, periodId: string, input: CanonicalLineInput[]): Promise<PayrollPeriodRow | null> {
    const p = await this.getPeriod(ctx, periodId);
    if (!p) return null;
    if (!input.length) return p;
    // one row per technician (a later entry wins, exactly as sequential upserts would) — one INSERT cannot touch a row twice
    const byTech = new Map<string, CanonicalLineInput>();
    for (const l of input) byTech.set(l.technicianId, l);
    const rows = [...byTech.values()].map((l) => ({
      tenant_id: ctx.tenantId, period_id: periodId, technician_id: l.technicianId, technician_name: l.technicianName ?? null,
      services_count: l.servicesCount, gross_sales_cents: l.grossSalesCents, commission_type: 'canonical', commission_value: 0,
      commission_cents: l.serviceCommissionCents, retail_commission_cents: l.retailCommissionCents,
      card_tip_cents: l.cardTipCents, cash_tip_cents: l.cashTipCents, guarantee_topup_cents: l.guaranteeTopUpCents,
      tips_cents: l.tipsCents, adjustment_cents: l.adjustmentCents, payable_cents: l.payableCents,
      hourly_pay_cents: l.hourlyPayCents ?? 0, worked_minutes: l.workedMinutes ?? 0, potential_overtime_minutes: l.potentialOvertimeMinutes ?? 0,
      salary_pay_cents: l.salaryPayCents ?? 0, bonus_cents: l.bonusCents ?? 0, deduction_cents: l.deductionCents ?? 0,
      net_cents: l.netCents ?? l.payableCents, review_required: !!l.reviewRequired,
    }));
    for (let at = 0; at < rows.length; at += 500) {
      await this.db.insertInto('payroll_lines').values(rows.slice(at, at + 500))
        .onConflict((oc) => oc.columns(['period_id', 'technician_id']).doUpdateSet((eb) => ({
          technician_name: eb.ref('excluded.technician_name'), services_count: eb.ref('excluded.services_count'), gross_sales_cents: eb.ref('excluded.gross_sales_cents'),
          commission_type: eb.ref('excluded.commission_type'), commission_value: eb.ref('excluded.commission_value'), commission_cents: eb.ref('excluded.commission_cents'),
          retail_commission_cents: eb.ref('excluded.retail_commission_cents'), card_tip_cents: eb.ref('excluded.card_tip_cents'), cash_tip_cents: eb.ref('excluded.cash_tip_cents'),
          guarantee_topup_cents: eb.ref('excluded.guarantee_topup_cents'), tips_cents: eb.ref('excluded.tips_cents'), adjustment_cents: eb.ref('excluded.adjustment_cents'),
          payable_cents: eb.ref('excluded.payable_cents'), updated_at: sql`now()`,
          hourly_pay_cents: eb.ref('excluded.hourly_pay_cents'), worked_minutes: eb.ref('excluded.worked_minutes'), potential_overtime_minutes: eb.ref('excluded.potential_overtime_minutes'),
          salary_pay_cents: eb.ref('excluded.salary_pay_cents'), bonus_cents: eb.ref('excluded.bonus_cents'), deduction_cents: eb.ref('excluded.deduction_cents'),
          net_cents: eb.ref('excluded.net_cents'), review_required: eb.ref('excluded.review_required'),
        })))
        .execute();
    }
    return this.recompute(ctx, periodId);
  }

  async pruneCanonicalLines(ctx: PayrollContext, periodId: string, keepTechnicianIds: string[]): Promise<void> {
    let q = this.db.deleteFrom('payroll_lines').where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId).where('commission_type', '=', 'canonical');
    if (keepTechnicianIds.length) q = q.where('technician_id', 'not in', keepTechnicianIds);
    await q.execute();
  }

  // upsertLine / removeLine (hand-typed lines) were REMOVED Oct 13 2026 (FLOW D7): PREPARE's canonical build is the one writer.

  async setStatus(ctx: PayrollContext, periodId: string, status: PeriodStatus, meta?: { reopenReason?: string }): Promise<PayrollPeriodRow | null> {
    const set: any = { status, updated_at: sql`now()` };
    if (status === 'finalized') set.finalized_at = sql`now()`;
    if (status === 'paid') set.paid_at = sql`now()`;
    if (status === 'draft' && meta?.reopenReason) { set.reopen_reason = meta.reopenReason; set.reopened_by = (ctx as any).userId ?? null; set.reopened_at = sql`now()`; }
    return this.db.transaction().execute(async (trx) => {
      // a period can only become 'paid' once (the service refuses a transition out of a locked period), so a row that
      // was not already paid IS the fact
      const was: any = await trx.selectFrom('payroll_periods').select(['status', 'branch_id', 'total_payable_cents'] as any).where('id', '=', periodId).where('tenant_id', '=', ctx.tenantId).forUpdate().executeTakeFirst();
      if (!was) return null;
      // Phase 12 (#27): the machine decides on the LOCKED row — the service's earlier read can be stale (a concurrent
      // "mark paid" and "reopen" both passed it, and the reopen then unlocked a paid period)
      // a repeat of the state it is already in is an idempotent no-op (no event) — every other move goes through the machine
      if (String(was.status) !== status) assertTransition(PAYROLL_PERIOD, String(was.status), status, { permissions: (ctx as { permissions?: string[] }).permissions ?? [] });   // paid → finalized is system-only
      const r = await trx.updateTable('payroll_periods').set(set).where('id', '=', periodId).where('tenant_id', '=', ctx.tenantId).returningAll().executeTakeFirst();
      // payroll.period_paid / period_finalized / period_reopened — recorded with the status write, only on a real
      // transition. Totals + the technicians on the period (each is told their earnings changed), no per-person pay.
      const type = status === 'paid' ? DOMAIN_EVENTS.PAYROLL_PERIOD_PAID : status === 'finalized' ? DOMAIN_EVENTS.PAYROLL_PERIOD_FINALIZED : status === 'draft' ? DOMAIN_EVENTS.PAYROLL_PERIOD_REOPENED : null;
      if (r && type && was && String(was.status) !== status && this.outbox) {
        const techs = (await trx.selectFrom('payroll_lines').select('technician_id').where('period_id', '=', periodId).where('tenant_id', '=', ctx.tenantId).execute()).map((l: any) => String(l.technician_id)).filter(Boolean);
        await this.outbox.write(trx, createDomainEvent({
          eventType: type, tenantId: ctx.tenantId, branchId: (was.branch_id as string) ?? undefined, aggregateType: 'payroll_period', aggregateId: periodId,
          actorId: (ctx as any).userId || undefined, actorType: 'user', payload: { periodId, status, previousStatus: String(was.status), totalPayableCents: Number(was.total_payable_cents ?? 0), technicianIds: [...new Set(techs)] } }));
      }
      return r ? toPeriod(r) : null;
    });
  }
}
