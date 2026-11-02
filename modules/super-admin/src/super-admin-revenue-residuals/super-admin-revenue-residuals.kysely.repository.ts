import { stashExportBytes, loadExportBytes, type ExportArtifactStore } from '../export-artifact-store';
// super-admin-revenue-residuals.kysely.repository.ts — platform Revenue & Residuals reads for Super Admin.
// Path contains 'super-admin' → intentionally cross-tenant (tenant-isolation scanner allowlisted).
// Every metric is computed from real records (migration 177); an empty ledger returns honest zeros — no fabrication.
// Money is integer cents throughout.

import type { ResidualReconcileResult, ResidualRevenueForecast } from '@aipowersalon/api-contracts/platform';   // the wire contracts (Constitution 13 §15)
import { sql, type Kysely } from 'kysely';
import { createHash } from 'node:crypto';
import { computeThreeWaySplit, computeLayeredResidualSplit, layeredFromFlat } from './revenue-split';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql, InvalidStateTransitionError } from '@aipowersalon/database';
import { RESIDUAL_STATEMENT_REVIEW, PARTNER_PAYOUT, TENANT_INCENTIVE, REVENUE_ADJUSTMENT, REVENUE_ACCOUNTING_PERIOD, REVENUE_EXPORT_JOB } from '../lifecycles';

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export type RevenueListOpts = {
  q?: string; agreementId?: string; tenantId?: string; branchId?: string; processor?: string;
  startDate?: string; endDate?: string; revenueType?: string; status?: string;
  page: number; pageSize: number; sort?: string; direction?: string;
};

export class KyselyRevenueResidualsRepo {
  // B-18: export bytes go to the private store when one is bound (content_key); the legacy content column is still read
  constructor(private readonly db: Kysely<DB>, private readonly store: ExportArtifactStore | null = null) {}

  async overview(): Promise<any> {
    const [kpi, byProc, split, trend, activity, outstanding, forecast]: any = await Promise.all([
      sql<any>`select
          coalesce(sum(gross_revenue_cents) filter (where revenue_source='subscription'),0)::bigint as subscription,
          coalesce(sum(gross_revenue_cents) filter (where revenue_source='processing_residual'),0)::bigint as residuals,
          coalesce(sum(gross_revenue_cents) filter (where revenue_source in ('subscription','monthly_recurring')),0)::bigint as mrr,
          coalesce(sum(gross_revenue_cents) filter (where revenue_source='add_on'),0)::bigint as addon,
          coalesce(sum(refunds_credits_cents),0)::bigint as refunds,
          coalesce(sum(outstanding_balance_cents),0)::bigint as outstanding,
          coalesce(sum(forecasted_revenue_cents),0)::bigint as forecast,
          coalesce(sum(processor_share_cents) filter (where status in ('approved','payable','partially_paid','overdue')),0)::bigint as payouts_due
        from revenue_records`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined),
      sql<any>`select coalesce(processor,'Unknown') as processor, coalesce(sum(gross_revenue_cents),0)::bigint as amount
        from revenue_records group by processor order by amount desc`.execute(this.db).then((r: any) => r.rows).catch(() => []),
      sql<any>`select coalesce(sum(ai_powersalon_share_cents),0)::bigint as ai, coalesce(sum(processor_share_cents),0)::bigint as processor,
          coalesce(sum(salon_incentive_share_cents),0)::bigint as salon from revenue_records`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined),
      sql<any>`select to_char(coalesce(effective_date, created_at::date),'YYYY-MM-DD') as d,
          coalesce(sum(gross_revenue_cents),0)::bigint as gross, coalesce(sum(net_revenue_cents),0)::bigint as net
        from revenue_records where coalesce(effective_date, created_at::date) >= (current_date - interval '35 days')
        group by d order by d asc`.execute(this.db).then((r: any) => r.rows).catch(() => []),
      sql<any>`select to_char(l.created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') as at, l.action, a.code as agreement_code, l.tenant_id::text as tenant_id,
          l.new_value, l.reason from revenue_audit_log l left join revenue_agreements a on a.id = l.agreement_id
        order by l.created_at desc limit 8`.execute(this.db).then((r: any) => r.rows).catch(() => []),
      sql<any>`select tenant_id::text as tenant_id, coalesce(sum(outstanding_balance_cents),0)::bigint as amount,
          max(coalesce(effective_date, created_at::date)) as last_activity,
          (current_date - max(coalesce(effective_date, created_at::date)))::int as age_days
        from revenue_records where outstanding_balance_cents > 0 group by tenant_id order by amount desc limit 6`.execute(this.db).then((r: any) => r.rows).catch(() => []),
      sql<any>`select coalesce(sum(forecasted_revenue_cents),0)::bigint as gross,
          coalesce(sum(ai_powersalon_share_cents),0)::bigint as ai, coalesce(sum(processor_share_cents),0)::bigint as processor,
          coalesce(sum(salon_incentive_share_cents),0)::bigint as salon, coalesce(sum(net_revenue_cents),0)::bigint as net
        from revenue_records`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined),
    ]);

    const procRows = (byProc ?? []).map((r: any) => ({ processor: String(r.processor), amountCents: n(r.amount) }));
    const procTotal = procRows.reduce((a: number, r: any) => a + r.amountCents, 0);
    const splitAi = n(split?.ai), splitProc = n(split?.processor), splitSalon = n(split?.salon);
    const splitTotal = splitAi + splitProc + splitSalon;

    return {
      kpis: {
        subscriptionRevenueCents: n(kpi?.subscription), processingResidualsCents: n(kpi?.residuals),
        monthlyRecurringRevenueCents: n(kpi?.mrr), addOnRevenueCents: n(kpi?.addon),
        refundsCreditsCents: n(kpi?.refunds), outstandingBalancesCents: n(kpi?.outstanding),
        forecastedRevenueCents: n(kpi?.forecast), partnerPayoutsDueCents: n(kpi?.payouts_due),
      },
      revenueByProcessor: { totalCents: procTotal, slices: procRows.map((r: any) => ({ processor: r.processor, amountCents: r.amountCents, pct: procTotal ? Math.round((r.amountCents / procTotal) * 1000) / 10 : 0 })) },
      revenueSplitBreakdown: {
        totalCents: splitTotal, aiCents: splitAi, processorCents: splitProc, salonCents: splitSalon,
        aiPct: splitTotal ? Math.round((splitAi / splitTotal) * 1000) / 10 : 0,
        processorPct: splitTotal ? Math.round((splitProc / splitTotal) * 1000) / 10 : 0,
        salonPct: splitTotal ? Math.round((splitSalon / splitTotal) * 1000) / 10 : 0,
      },
      revenueTrend: (trend ?? []).map((r: any) => ({ date: r.d, grossCents: n(r.gross), netCents: n(r.net) })),
      recentActivity: (activity ?? []).map((r: any) => ({ at: r.at ?? null, action: String(r.action ?? ''), agreementCode: r.agreement_code ?? null, tenantId: r.tenant_id ?? null, amount: r.new_value ?? null, reason: r.reason ?? null })),
      outstandingBalances: (outstanding ?? []).map((r: any) => ({ tenantId: r.tenant_id ?? null, amountCents: n(r.amount), ageDays: n(r.age_days), lastActivity: r.last_activity ?? null })),
      forecastSummary: { grossCents: n(forecast?.gross), netCents: n(forecast?.net), aiCents: n(forecast?.ai), processorCents: n(forecast?.processor), salonCents: n(forecast?.salon) },
    };
  }

  async listRecords(opts: RevenueListOpts): Promise<{ rows: any[]; total: number }> {
    const p = Math.max(1, Math.trunc(opts.page || 1));
    const ps = Math.min(5000, Math.max(1, Math.trunc(opts.pageSize || 10)));
    // Security Deep Scan §84 (S-A6): an own-key lookup — `sort=constructor` used to answer Object's constructor function.
    const SORTS: Record<string, string> = { effective_date: 'r.effective_date', gross: 'r.gross_revenue_cents', net: 'r.net_revenue_cents', created: 'r.created_at' };
    const sortCol = Object.prototype.hasOwnProperty.call(SORTS, opts.sort ?? '') ? SORTS[opts.sort as string] : 'r.effective_date';
    const dir = (opts.direction ?? 'desc').toLowerCase() === 'asc' ? sql`asc` : sql`desc`;
    const where = sql`where true
      ${opts.q ? sql`and (a.code ilike ${'%' + opts.q + '%'} or a.name ilike ${'%' + opts.q + '%'} or t.display_name ilike ${'%' + opts.q + '%'} or r.source_reference ilike ${'%' + opts.q + '%'})` : sql``}
      ${opts.agreementId ? sql`and r.agreement_id = ${opts.agreementId}` : sql``}
      ${opts.tenantId ? sql`and r.tenant_id = ${opts.tenantId}` : sql``}
      ${opts.branchId ? sql`and r.branch_id = ${opts.branchId}` : sql``}
      ${opts.processor ? sql`and r.processor = ${opts.processor}` : sql``}
      ${opts.revenueType ? sql`and r.revenue_source = ${opts.revenueType}` : sql``}
      ${opts.status ? sql`and r.status = ${opts.status}` : sql``}
      ${opts.startDate ? sql`and coalesce(r.effective_date, r.created_at::date) >= ${opts.startDate}` : sql``}
      ${opts.endDate ? sql`and coalesce(r.effective_date, r.created_at::date) <= ${opts.endDate}` : sql``}`;
    try {
      const rows: any = await sql<any>`
        select r.id::text as id, a.code as agreement_code, r.agreement_id::text as agreement_id, r.tenant_id::text as tenant_id,
          t.display_name as tenant_name, r.branch_id::text as branch_id, b.name as branch_name, r.processor, r.revenue_source,
          r.gross_revenue_cents, r.ai_powersalon_pct, r.processor_pct, r.salon_pct,
          r.ai_powersalon_share_cents, r.processor_share_cents, r.salon_incentive_share_cents,
          r.refunds_credits_cents, r.net_revenue_cents, to_char(r.effective_date,'YYYY-MM-DD') as effective_date, r.status
        from revenue_records r
        left join revenue_agreements a on a.id = r.agreement_id
        left join tenants t on t.id = r.tenant_id
        left join branches b on b.id = r.branch_id
        ${where} order by ${sql.raw(sortCol)} ${dir} nulls last limit ${ps} offset ${(p - 1) * ps}`.execute(this.db);
      const totalRow: any = await sql<any>`select count(*)::int as nrows from revenue_records r left join revenue_agreements a on a.id = r.agreement_id left join tenants t on t.id = r.tenant_id ${where}`.execute(this.db);
      const mapped = (rows.rows ?? []).map((x: any) => ({
        id: String(x.id), agreementCode: x.agreement_code ?? null, agreementId: x.agreement_id ?? null,
        tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null, branchId: x.branch_id ?? null, branchName: x.branch_name ?? null,
        processor: x.processor ?? null, revenueSource: x.revenue_source ?? null, grossRevenueCents: n(x.gross_revenue_cents),
        aiPct: x.ai_powersalon_pct == null ? null : Number(x.ai_powersalon_pct), processorPct: x.processor_pct == null ? null : Number(x.processor_pct), salonPct: x.salon_pct == null ? null : Number(x.salon_pct),
        aiShareCents: n(x.ai_powersalon_share_cents), processorShareCents: n(x.processor_share_cents), salonIncentiveShareCents: n(x.salon_incentive_share_cents),
        refundsCreditsCents: n(x.refunds_credits_cents), netRevenueCents: n(x.net_revenue_cents), effectiveDate: x.effective_date ?? null, status: x.status,
      }));
      return { rows: mapped, total: n(totalRow.rows?.[0]?.nrows) };
    } catch { return { rows: [], total: 0 }; }
  }

  async agreementDetail(agreementId: string): Promise<any | null> {
    try {
      const a: any = await sql<any>`
        select a.id::text as id, a.code, a.name, a.tenant_id::text as tenant_id, t.display_name as tenant_name,
          a.branch_id::text as branch_id, b.name as branch_name, a.processor, a.revenue_source, a.status,
          v.ai_powersalon_pct, v.processor_pct, v.salon_pct, to_char(v.effective_date,'YYYY-MM-DD') as effective_date
        from revenue_agreements a
        left join revenue_agreement_versions v on v.id = a.current_version_id
        left join tenants t on t.id = a.tenant_id
        left join branches b on b.id = a.branch_id
        where a.id = ${agreementId}`.execute(this.db).then((r: any) => r.rows[0]);
      if (!a) return null;
      const agg: any = await sql<any>`select
          coalesce(sum(gross_revenue_cents) filter (where revenue_source in ('subscription','monthly_recurring')),0)::bigint as mrr,
          coalesce(sum(gross_revenue_cents) filter (where revenue_source='add_on'),0)::bigint as addon,
          coalesce(sum(gross_revenue_cents) filter (where revenue_source='processing_residual'),0)::bigint as residuals,
          coalesce(sum(refunds_credits_cents),0)::bigint as refunds, coalesce(sum(net_revenue_cents),0)::bigint as net,
          coalesce(sum(outstanding_balance_cents),0)::bigint as outstanding, coalesce(sum(forecasted_revenue_cents),0)::bigint as forecast
        from revenue_records where agreement_id = ${agreementId}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
      return {
        id: String(a.id), code: a.code, name: a.name, tenantId: a.tenant_id ?? null, tenantName: a.tenant_name ?? null,
        branchId: a.branch_id ?? null, branchName: a.branch_name ?? null, processor: a.processor ?? null, revenueSource: a.revenue_source ?? null, status: a.status,
        aiPct: a.ai_powersalon_pct == null ? null : Number(a.ai_powersalon_pct), processorPct: a.processor_pct == null ? null : Number(a.processor_pct), salonPct: a.salon_pct == null ? null : Number(a.salon_pct),
        effectiveDate: a.effective_date ?? null,
        monthlyRecurringRevenueCents: n(agg?.mrr), addOnRevenueCents: n(agg?.addon), processingResidualsCents: n(agg?.residuals),
        refundsCreditsCents: n(agg?.refunds), netRevenueCents: n(agg?.net), outstandingBalanceCents: n(agg?.outstanding), forecastedRevenueCents: n(agg?.forecast),
      };
    } catch { return null; }
  }

  async defaultAgreementId(): Promise<string | null> {
    try {
      const r: any = await sql<any>`select id::text as id from revenue_agreements order by created_at desc limit 1`.execute(this.db);
      return r.rows?.[0]?.id ?? null;
    } catch { return null; }
  }

  // ── Agreement picker + version history (reads) ──
  async listAgreements(opts: { q?: string; tenantId?: string; processor?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 100));
    try {
      const r: any = await sql<any>`
        select a.id::text as id, a.code, a.name, a.tenant_id::text as tenant_id, t.display_name as tenant_name, a.branch_id::text as branch_id,
          a.processor, a.revenue_source, a.status, v.ai_powersalon_pct, v.processor_pct, v.salon_pct, to_char(v.effective_date,'YYYY-MM-DD') as effective_date,
          to_char(v.expiration_date,'YYYY-MM-DD') as expiration_date, v.version_number
        from revenue_agreements a
        left join revenue_agreement_versions v on v.id = a.current_version_id
        left join tenants t on t.id = a.tenant_id
        where true
          ${opts.q ? sql`and (a.code ilike ${'%' + opts.q + '%'} or a.name ilike ${'%' + opts.q + '%'})` : sql``}
          ${opts.tenantId ? sql`and a.tenant_id = ${opts.tenantId}` : sql``}
          ${opts.processor ? sql`and a.processor = ${opts.processor}` : sql``}
          ${opts.status ? sql`and a.status = ${opts.status}` : sql``}
        order by a.created_at desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), code: x.code, name: x.name, tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null, branchId: x.branch_id ?? null,
        processor: x.processor ?? null, revenueSource: x.revenue_source ?? null, status: x.status,
        aiPct: x.ai_powersalon_pct == null ? null : Number(x.ai_powersalon_pct), processorPct: x.processor_pct == null ? null : Number(x.processor_pct), salonPct: x.salon_pct == null ? null : Number(x.salon_pct),
        effectiveDate: x.effective_date ?? null, expirationDate: x.expiration_date ?? null, versionNumber: x.version_number == null ? null : Number(x.version_number),
      }));
    } catch { return []; }
  }

  async listVersions(agreementId: string): Promise<any[]> {
    try {
      const r: any = await sql<any>`
        select v.id::text as id, v.version_number, v.ai_powersalon_pct, v.processor_pct, v.salon_pct,
          to_char(v.effective_date,'YYYY-MM-DD') as effective_date, to_char(v.expiration_date,'YYYY-MM-DD') as expiration_date,
          v.currency, v.rounding_policy, v.refund_allocation, v.change_reason, to_char(v.created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') as created_at,
          (v.id = a.current_version_id) as is_current
        from revenue_agreement_versions v join revenue_agreements a on a.id = v.agreement_id
        where v.agreement_id = ${agreementId} order by v.version_number desc`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), versionNumber: Number(x.version_number), aiPct: Number(x.ai_powersalon_pct), processorPct: Number(x.processor_pct), salonPct: Number(x.salon_pct),
        effectiveDate: x.effective_date ?? null, expirationDate: x.expiration_date ?? null, currency: x.currency, roundingPolicy: x.rounding_policy,
        refundAllocation: x.refund_allocation, changeReason: x.change_reason ?? null, createdAt: x.created_at ?? null, isCurrent: !!x.is_current,
      }));
    } catch { return []; }
  }

  // Detect an ACTIVE agreement for the same scope (tenant/branch/processor/revenue_source) whose current
  // version's effective window OVERLAPS the proposed window. Returns the conflicting code, or null.
  private async findOverlap(scope: { tenantId?: string | null; branchId?: string | null; processor?: string | null; revenueSource?: string | null }, effective: string, expiration: string | null, excludeAgreementId?: string): Promise<string | null> {
    const r: any = await sql<any>`
      select a.code from revenue_agreements a join revenue_agreement_versions v on v.id = a.current_version_id
      where a.status = 'active'
        and a.tenant_id is not distinct from ${scope.tenantId ?? null}::uuid
        and a.branch_id is not distinct from ${scope.branchId ?? null}::uuid
        and coalesce(a.processor,'') = coalesce(${scope.processor ?? null},'')
        and coalesce(a.revenue_source,'') = coalesce(${scope.revenueSource ?? null},'')
        ${excludeAgreementId ? sql`and a.id <> ${excludeAgreementId}` : sql``}
        and v.effective_date <= ${expiration ?? '9999-12-31'}::date
        and coalesce(v.expiration_date, '9999-12-31'::date) >= ${effective}::date
      limit 1`.execute(this.db);
    return r.rows?.[0]?.code ?? null;
  }

  private async nextAgreementCode(trx: any): Promise<string> {
    const yr = new Date().getUTCFullYear();
    const r: any = await sql<any>`select coalesce(max(substring(code from '\\d+$')::int),0) as maxn from revenue_agreements where code like ${'AGR-' + yr + '-%'}`.execute(trx);
    const next = (Number(r.rows?.[0]?.maxn) || 0) + 1;
    return `AGR-${yr}-${String(next).padStart(4, '0')}`;
  }

  // Create agreement + immutable version 1 + audit (atomic). Caller pre-validates split=100 + dates.
  async createAgreement(actor: { id?: string; role?: string }, input: {
    name: string; agreementType?: string; tenantId?: string | null; branchId?: string | null; processor?: string | null; revenueSource?: string | null;
    aiPct: number; processorPct: number; salonPct: number; effectiveDate: string; expirationDate?: string | null; currency?: string;
    roundingPolicy?: string; refundAllocation?: string; minimumVolumeCents?: number | null; maximumVolumeCents?: number | null;
    status?: string; changeReason?: string;
  }): Promise<{ ok: true; id: string; code: string; versionId: string } | { ok: false; error: string; conflict?: string }> {
    const status = input.status ?? 'active';
    if (status === 'active') {
      const conflict = await this.findOverlap({ tenantId: input.tenantId, branchId: input.branchId, processor: input.processor, revenueSource: input.revenueSource }, input.effectiveDate, input.expirationDate ?? null);
      if (conflict) return { ok: false, error: 'overlap', conflict };
    }
    try {
      return await this.db.transaction().execute(async (trx) => {
        const code = await this.nextAgreementCode(trx);
        const ins: any = await sql<any>`
          insert into revenue_agreements (code, name, agreement_type, tenant_id, branch_id, processor, revenue_source, status, created_by, approved_by, approved_at)
          values (${code}, ${input.name}, ${input.agreementType ?? null}, ${input.tenantId ?? null}::uuid, ${input.branchId ?? null}::uuid, ${input.processor ?? null}, ${input.revenueSource ?? null},
                  ${status}, ${actor.id ?? null}::uuid, ${status === 'active' ? (actor.id ?? null) : null}::uuid, ${status === 'active' ? sql`now()` : null})
          returning id::text as id`.execute(trx);
        const agreementId = ins.rows[0].id;
        const ver: any = await sql<any>`
          insert into revenue_agreement_versions (agreement_id, version_number, ai_powersalon_pct, processor_pct, salon_pct, effective_date, expiration_date, currency, rounding_policy, refund_allocation, minimum_volume_cents, maximum_volume_cents, change_reason, created_by)
          values (${agreementId}::uuid, 1, ${input.aiPct}, ${input.processorPct}, ${input.salonPct}, ${input.effectiveDate}::date, ${input.expirationDate ?? null}::date, ${input.currency ?? 'USD'}, ${input.roundingPolicy ?? 'largest_remainder'}, ${input.refundAllocation ?? 'ai_powersalon'}, ${input.minimumVolumeCents ?? null}, ${input.maximumVolumeCents ?? null}, ${input.changeReason ?? 'Initial agreement'}, ${actor.id ?? null}::uuid)
          returning id::text as id`.execute(trx);
        const versionId = ver.rows[0].id;
        await sql`update revenue_agreements set current_version_id = ${versionId}::uuid where id = ${agreementId}::uuid`.execute(trx);
        await sql`insert into revenue_audit_log (action, agreement_id, agreement_version_id, tenant_id, branch_id, processor, actor_id, actor_role, field, new_value, reason)
          values ('agreement_created', ${agreementId}::uuid, ${versionId}::uuid, ${input.tenantId ?? null}::uuid, ${input.branchId ?? null}::uuid, ${input.processor ?? null}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'split', ${`${input.aiPct}/${input.processorPct}/${input.salonPct}`}, ${input.changeReason ?? 'Initial agreement'})`.execute(trx);
        return { ok: true as const, id: agreementId, code, versionId };
      });
    } catch (e: any) {
      if (String(e?.message ?? '').includes('revenue_agreements_code_key')) return { ok: false, error: 'duplicate_code' };
      return { ok: false, error: 'write_failed' };
    }
  }

  // Add a NEW immutable version to an existing agreement. Prior versions are never rewritten; current_version_id advances.
  async addVersion(actor: { id?: string; role?: string }, agreementId: string, input: {
    aiPct: number; processorPct: number; salonPct: number; effectiveDate: string; expirationDate?: string | null; currency?: string;
    roundingPolicy?: string; refundAllocation?: string; changeReason?: string;
  }): Promise<{ ok: true; versionId: string; versionNumber: number } | { ok: false; error: string; conflict?: string }> {
    const head: any = await sql<any>`select id::text as id, tenant_id::text as tenant_id, branch_id::text as branch_id, processor, revenue_source, status from revenue_agreements where id = ${agreementId}`.execute(this.db).catch(() => ({ rows: [] }));
    const a = head.rows?.[0];
    if (!a) return { ok: false, error: 'not_found' };
    if (a.status === 'active') {
      const conflict = await this.findOverlap({ tenantId: a.tenant_id, branchId: a.branch_id, processor: a.processor, revenueSource: a.revenue_source }, input.effectiveDate, input.expirationDate ?? null, agreementId);
      if (conflict) return { ok: false, error: 'overlap', conflict };
    }
    try {
      return await this.db.transaction().execute(async (trx) => {
        const mx: any = await sql<any>`select coalesce(max(version_number),0) as mx from revenue_agreement_versions where agreement_id = ${agreementId}::uuid`.execute(trx);
        const versionNumber = (Number(mx.rows?.[0]?.mx) || 0) + 1;
        const ver: any = await sql<any>`
          insert into revenue_agreement_versions (agreement_id, version_number, ai_powersalon_pct, processor_pct, salon_pct, effective_date, expiration_date, currency, rounding_policy, refund_allocation, change_reason, created_by)
          values (${agreementId}::uuid, ${versionNumber}, ${input.aiPct}, ${input.processorPct}, ${input.salonPct}, ${input.effectiveDate}::date, ${input.expirationDate ?? null}::date, ${input.currency ?? 'USD'}, ${input.roundingPolicy ?? 'largest_remainder'}, ${input.refundAllocation ?? 'ai_powersalon'}, ${input.changeReason ?? 'Revised terms'}, ${actor.id ?? null}::uuid)
          returning id::text as id`.execute(trx);
        const versionId = ver.rows[0].id;
        await sql`update revenue_agreements set current_version_id = ${versionId}::uuid, updated_at = now() where id = ${agreementId}::uuid`.execute(trx);
        await sql`insert into revenue_audit_log (action, agreement_id, agreement_version_id, tenant_id, branch_id, processor, actor_id, actor_role, field, new_value, reason)
          values ('agreement_version_created', ${agreementId}::uuid, ${versionId}::uuid, ${a.tenant_id ?? null}::uuid, ${a.branch_id ?? null}::uuid, ${a.processor ?? null}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'split', ${`${input.aiPct}/${input.processorPct}/${input.salonPct}`}, ${input.changeReason ?? 'Revised terms'})`.execute(trx);
        return { ok: true as const, versionId, versionNumber };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Review Residual Statements: idempotent import (dedupe on hash), review, list, detail.
  // ══════════════════════════════════════════════════════════════════════════════════════

  private statementHash(i: { processor: string; statementRef: string; periodStart: string; periodEnd: string; processorCalculatedCents: number }): string {
    return createHash('sha256').update([i.processor, i.statementRef, i.periodStart, i.periodEnd, String(i.processorCalculatedCents)].join('|')).digest('hex');
  }

  // Find an ACTIVE agreement matching a line's scope + the statement period (for line matching).
  private async matchAgreementForLine(scope: { tenantId?: string | null; processor: string; periodStart: string; periodEnd: string }): Promise<string | null> {
    const r: any = await sql<any>`
      select a.id::text as id from revenue_agreements a join revenue_agreement_versions v on v.id = a.current_version_id
      where a.status = 'active' and coalesce(a.processor,'') = ${scope.processor}
        and coalesce(a.revenue_source,'') in ('processing_residual','')
        and a.tenant_id is not distinct from ${scope.tenantId ?? null}::uuid
        and v.effective_date <= ${scope.periodEnd}::date and coalesce(v.expiration_date,'9999-12-31'::date) >= ${scope.periodStart}::date
      order by v.effective_date desc limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    return r.rows?.[0]?.id ?? null;
  }

  async importStatement(actor: { id?: string; role?: string }, input: {
    processor: string; statementRef: string; merchantAccount?: string | null; tenantId?: string | null; branchId?: string | null;
    periodStart: string; periodEnd: string; currency?: string; transactionVolumeCents?: number; eligibleRevenueCents?: number;
    processingResidualCents?: number; feesCents?: number; refundsCents?: number; chargebacksCents?: number; adjustmentsCents?: number;
    processorCalculatedCents: number; sourceFile?: string | null; applicableCostsCents?: number;
    lines?: { merchantAccount?: string | null; tenantId?: string | null; branchId?: string | null; grossVolumeCents?: number; eligibleRevenueCents?: number; residualCents?: number; note?: string | null }[];
  }): Promise<{ ok: true; imported: boolean; duplicate: boolean; statementId: string; linesImported: number; unmatchedLines: number } | { ok: false; error: string }> {
    const hash = this.statementHash({ processor: input.processor, statementRef: input.statementRef, periodStart: input.periodStart, periodEnd: input.periodEnd, processorCalculatedCents: input.processorCalculatedCents });
    const existing: any = await sql<any>`select id::text as id from residual_statements where import_hash = ${hash} limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    if (existing.rows?.[0]) return { ok: true, imported: false, duplicate: true, statementId: existing.rows[0].id, linesImported: 0, unmatchedLines: 0 };

    const lines = input.lines ?? [];
    const matched: (string | null)[] = [];
    for (const ln of lines) matched.push(await this.matchAgreementForLine({ tenantId: ln.tenantId ?? input.tenantId ?? null, processor: input.processor, periodStart: input.periodStart, periodEnd: input.periodEnd }));
    const unmatched = matched.filter((m) => !m).length;

    try {
      return await this.db.transaction().execute(async (trx) => {
        const ins: any = await sql<any>`
          insert into residual_statements (processor, statement_ref, merchant_account, tenant_id, branch_id, period_start, period_end, currency,
            transaction_volume_cents, eligible_revenue_cents, processing_residual_cents, applicable_costs_cents, fees_cents, refunds_cents, chargebacks_cents, adjustments_cents,
            processor_calculated_cents, import_hash, source_file, unmatched_lines, created_by)
          values (${input.processor}, ${input.statementRef}, ${input.merchantAccount ?? null}, ${input.tenantId ?? null}::uuid, ${input.branchId ?? null}::uuid,
            ${input.periodStart}::date, ${input.periodEnd}::date, ${input.currency ?? 'USD'}, ${input.transactionVolumeCents ?? 0}, ${input.eligibleRevenueCents ?? 0},
            ${input.processingResidualCents ?? 0}, ${Math.abs(Math.round(Number(input.applicableCostsCents) || 0))}, ${input.feesCents ?? 0}, ${input.refundsCents ?? 0}, ${input.chargebacksCents ?? 0}, ${input.adjustmentsCents ?? 0},
            ${input.processorCalculatedCents}, ${hash}, ${input.sourceFile ?? null}, ${unmatched}, ${actor.id ?? null}::uuid)
          returning id::text as id`.execute(trx);
        const statementId = ins.rows[0].id;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          await sql`insert into residual_statement_lines (statement_id, merchant_account, tenant_id, branch_id, gross_volume_cents, eligible_revenue_cents, residual_cents, matched, agreement_id, note)
            values (${statementId}::uuid, ${ln.merchantAccount ?? null}, ${ln.tenantId ?? input.tenantId ?? null}::uuid, ${ln.branchId ?? input.branchId ?? null}::uuid,
              ${ln.grossVolumeCents ?? 0}, ${ln.eligibleRevenueCents ?? 0}, ${ln.residualCents ?? 0}, ${!!matched[i]}, ${matched[i] ?? null}::uuid, ${ln.note ?? null})`.execute(trx);
        }
        await sql`insert into revenue_audit_log (action, tenant_id, branch_id, processor, actor_id, actor_role, field, new_value, reason)
          values ('residual_statement_imported', ${input.tenantId ?? null}::uuid, ${input.branchId ?? null}::uuid, ${input.processor}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'statement_ref', ${input.statementRef}, ${`imported ${lines.length} line(s), ${unmatched} unmatched`})`.execute(trx);
        return { ok: true as const, imported: true, duplicate: false, statementId, linesImported: lines.length, unmatchedLines: unmatched };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async listStatements(opts: { processor?: string; tenantId?: string; reviewStatus?: string; limit?: number } = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 50));
    try {
      const r: any = await sql<any>`
        select s.id::text as id, s.processor, s.statement_ref, s.merchant_account, s.tenant_id::text as tenant_id, t.display_name as tenant_name,
          to_char(s.period_start,'YYYY-MM-DD') as period_start, to_char(s.period_end,'YYYY-MM-DD') as period_end,
          s.processing_residual_cents, s.processor_calculated_cents, s.import_status, s.review_status, s.unmatched_lines, to_char(s.created_at,'YYYY-MM-DD') as created_at
        from residual_statements s left join tenants t on t.id = s.tenant_id
        where true ${opts.processor ? sql`and s.processor = ${opts.processor}` : sql``} ${opts.tenantId ? sql`and s.tenant_id = ${opts.tenantId}` : sql``} ${opts.reviewStatus ? sql`and s.review_status = ${opts.reviewStatus}` : sql``}
        order by s.created_at desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), processor: x.processor, statementRef: x.statement_ref, merchantAccount: x.merchant_account ?? null, tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null,
        periodStart: x.period_start, periodEnd: x.period_end, processingResidualCents: n(x.processing_residual_cents), processorCalculatedCents: n(x.processor_calculated_cents),
        importStatus: x.import_status, reviewStatus: x.review_status, unmatchedLines: n(x.unmatched_lines), createdAt: x.created_at,
      }));
    } catch { return []; }
  }

  async statementDetail(id: string): Promise<any | null> {
    try {
      const s: any = await sql<any>`select s.*, t.display_name as tenant_name from residual_statements s left join tenants t on t.id = s.tenant_id where s.id = ${id}`.execute(this.db).then((r: any) => r.rows[0]);
      if (!s) return null;
      const lines: any = await sql<any>`select id::text as id, merchant_account, tenant_id::text as tenant_id, gross_volume_cents, eligible_revenue_cents, residual_cents, matched, agreement_id::text as agreement_id, note from residual_statement_lines where statement_id = ${id} order by created_at asc`.execute(this.db);
      return {
        id: String(s.id), processor: s.processor, statementRef: s.statement_ref, merchantAccount: s.merchant_account ?? null, tenantId: s.tenant_id ?? null, tenantName: s.tenant_name ?? null,
        periodStart: String(s.period_start).slice(0, 10), periodEnd: String(s.period_end).slice(0, 10),
        transactionVolumeCents: n(s.transaction_volume_cents), eligibleRevenueCents: n(s.eligible_revenue_cents), processingResidualCents: n(s.processing_residual_cents),
        feesCents: n(s.fees_cents), refundsCents: n(s.refunds_cents), chargebacksCents: n(s.chargebacks_cents), adjustmentsCents: n(s.adjustments_cents), processorCalculatedCents: n(s.processor_calculated_cents),
        importStatus: s.import_status, reviewStatus: s.review_status, reviewNotes: s.review_notes ?? null, unmatchedLines: n(s.unmatched_lines),
        lines: (lines.rows ?? []).map((x: any) => ({ id: String(x.id), merchantAccount: x.merchant_account ?? null, tenantId: x.tenant_id ?? null, grossVolumeCents: n(x.gross_volume_cents), eligibleRevenueCents: n(x.eligible_revenue_cents), residualCents: n(x.residual_cents), matched: !!x.matched, agreementId: x.agreement_id ?? null, note: x.note ?? null })),
      };
    } catch { return null; }
  }

  async reviewStatement(actor: { id?: string; role?: string }, id: string, status: string, notes?: string): Promise<{ ok: true; reviewStatus: string } | { ok: false; error: string }> {
    const cur: any = await sql<any>`select review_status, tenant_id::text as tenant_id, processor from residual_statements where id = ${id}`.execute(this.db).catch(() => ({ rows: [] }));
    const row = cur.rows?.[0];
    if (!row) return { ok: false, error: 'not_found' };
    try {
      return await this.db.transaction().execute(async (trx) => {
        await sql`update residual_statements set review_status = ${status}, review_notes = coalesce(${notes ?? null}, review_notes), reviewed_by = ${actor.id ?? null}::uuid, reviewed_at = now() where id = ${id}::uuid and ${canMoveToSql(RESIDUAL_STATEMENT_REVIEW, status)}`.execute(trx);
        await sql`insert into revenue_audit_log (action, tenant_id, processor, actor_id, actor_role, field, old_value, new_value, reason)
          values ('residual_statement_reviewed', ${row.tenant_id ?? null}::uuid, ${row.processor}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'review_status', ${row.review_status}, ${status}, ${notes ?? null})`.execute(trx);
        return { ok: true as const, reviewStatus: status };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Reconcile Processor Reports: compare processor-reported residual header vs the sum of the
  // statement's line residuals; store the agreement-derived split for reference. Never mutates the statement.
  // ══════════════════════════════════════════════════════════════════════════════════════
  private async currentSplitFor(agreementId: string | null): Promise<{ ai: number; processor: number; salon: number } | null> {
    if (!agreementId) return null;
    const r: any = await sql<any>`select v.ai_powersalon_pct as ai, v.processor_pct as processor, v.salon_pct as salon
      from revenue_agreements a join revenue_agreement_versions v on v.id = a.current_version_id where a.id = ${agreementId}`.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows?.[0];
    return x ? { ai: Number(x.ai), processor: Number(x.processor), salon: Number(x.salon) } : null;
  }

  async reconcileStatement(actor: { id?: string; role?: string }, statementId: string, notes?: string): Promise<ResidualReconcileResult | { ok: false; error: string }> {
    const s: any = await sql<any>`select id::text as id, tenant_id::text as tenant_id, branch_id::text as branch_id, processor, currency,
        to_char(period_start,'YYYY-MM-DD') as ps, to_char(period_end,'YYYY-MM-DD') as pe, processing_residual_cents, applicable_costs_cents from residual_statements where id = ${statementId}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!s) return { ok: false, error: 'not_found' };
    const lines: any = await sql<any>`select coalesce(sum(residual_cents),0)::bigint as sum_residual, count(*)::int as n, max(agreement_id::text) as agreement_id from residual_statement_lines where statement_id = ${statementId}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ sum_residual: 0, n: 0, agreement_id: null }));

    const actual = n(s.processing_residual_cents);
    const expected = n(lines.sum_residual);
    const nLines = n(lines.n);
    const difference = actual - expected;
    const differenceType = nLines === 0 ? 'no_lines' : difference === 0 ? 'match' : difference > 0 ? 'processor_over' : 'processor_under';
    const status = differenceType === 'match' ? 'matched' : 'variance';

    const split = await this.currentSplitFor(lines.agreement_id ?? null) ?? await (async () => {
      const a = await this.matchAgreementForLine({ tenantId: s.tenant_id ?? null, processor: s.processor, periodStart: s.ps, periodEnd: s.pe });
      return this.currentSplitFor(a);
    })();
    // Expected shares are NET-FIRST and layered: applicable costs come off the reported residual before any
    // split, then the economic shares (platform-retained / processor-retained / tenant payable) come from the
    // layered Schedule-A model. Mapped onto the flat exp shape the insert below expects.
    const layeredExp = split ? computeLayeredResidualSplit(actual, layeredFromFlat(split), { applicableCostsCents: n(s.applicable_costs_cents) }) : null;
    const exp = layeredExp ? { aiShareCents: layeredExp.platformRetainedCents, processorShareCents: layeredExp.processorRetainedCents, salonIncentiveShareCents: layeredExp.platformOwesTenantCents } : null;

    try {
      return await this.db.transaction().execute(async (trx) => {
        const ins: any = await sql<any>`
          insert into processor_reconciliations (statement_id, agreement_id, tenant_id, branch_id, processor, period_start, period_end, currency,
            expected_amount_cents, actual_amount_cents, difference_cents, difference_type, expected_ai_cents, expected_processor_cents, expected_salon_cents, status, reviewer, notes)
          values (${statementId}::uuid, ${lines.agreement_id ?? null}::uuid, ${s.tenant_id ?? null}::uuid, ${s.branch_id ?? null}::uuid, ${s.processor}, ${s.ps}::date, ${s.pe}::date, ${s.currency ?? 'USD'},
            ${expected}, ${actual}, ${difference}, ${differenceType}, ${exp?.aiShareCents ?? 0}, ${exp?.processorShareCents ?? 0}, ${exp?.salonIncentiveShareCents ?? 0}, ${status}, ${actor.id ?? null}::uuid, ${notes ?? null})
          returning id::text as id`.execute(trx);
        const reconciliationId = ins.rows[0].id;
        if (status === 'matched') await sql`update residual_statements set review_status = 'reconciled' where id = ${statementId}::uuid and review_status <> 'reconciled' and ${canMoveToSql(RESIDUAL_STATEMENT_REVIEW, 'reconciled')}`.execute(trx);
        await sql`insert into revenue_audit_log (action, tenant_id, branch_id, processor, actor_id, actor_role, field, old_value, new_value, reason)
          values ('processor_report_reconciled', ${s.tenant_id ?? null}::uuid, ${s.branch_id ?? null}::uuid, ${s.processor}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'difference_cents', ${String(expected)}, ${String(actual)}, ${`${differenceType} (${difference} cents)`})`.execute(trx);
        return { ok: true as const, reconciliationId, status, differenceCents: difference, differenceType, expectedAmountCents: expected, actualAmountCents: actual, expected: { ai: exp?.aiShareCents ?? 0, processor: exp?.processorShareCents ?? 0, salon: exp?.salonIncentiveShareCents ?? 0 } };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async listReconciliations(opts: { statementId?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 50));
    try {
      const r: any = await sql<any>`
        select rc.id::text as id, rc.statement_id::text as statement_id, s.statement_ref, rc.processor, rc.tenant_id::text as tenant_id, t.display_name as tenant_name,
          to_char(rc.period_start,'YYYY-MM-DD') as period_start, to_char(rc.period_end,'YYYY-MM-DD') as period_end,
          rc.expected_amount_cents, rc.actual_amount_cents, rc.difference_cents, rc.difference_type, rc.status,
          rc.expected_ai_cents, rc.expected_processor_cents, rc.expected_salon_cents, to_char(rc.created_at,'YYYY-MM-DD') as created_at
        from processor_reconciliations rc left join residual_statements s on s.id = rc.statement_id left join tenants t on t.id = rc.tenant_id
        where true ${opts.statementId ? sql`and rc.statement_id = ${opts.statementId}` : sql``} ${opts.status ? sql`and rc.status = ${opts.status}` : sql``}
        order by rc.created_at desc, rc.id desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), statementId: x.statement_id ?? null, statementRef: x.statement_ref ?? null, processor: x.processor ?? null, tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null,
        periodStart: x.period_start ?? null, periodEnd: x.period_end ?? null, expectedAmountCents: n(x.expected_amount_cents), actualAmountCents: n(x.actual_amount_cents),
        differenceCents: n(x.difference_cents), differenceType: x.difference_type, status: x.status,
        expectedAiCents: n(x.expected_ai_cents), expectedProcessorCents: n(x.expected_processor_cents), expectedSalonCents: n(x.expected_salon_cents), createdAt: x.created_at ?? null,
      }));
    } catch { return []; }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Calculate Partner Payouts: idempotent, agreement-driven payout of the processor's share over a period.
  // ══════════════════════════════════════════════════════════════════════════════════════
  async calculatePartnerPayout(actor: { id?: string; role?: string }, input: { agreementId: string; periodStart: string; periodEnd: string; priorBalanceCents?: number }): Promise<{ ok: true; duplicate: boolean; payoutId: string; processor: string; eligibleRevenueCents: number; partnerPct: number; partnerGrossShareCents: number; refundAllocationCents: number; adjustmentAllocationCents: number; priorBalanceCents: number; amountDueCents: number; status: string; applicableCostsCents?: number; netPoolCents?: number; processorOwesPlatformCents?: number; platformOwesTenantCents?: number; platformRetainedCents?: number } | { ok: false; error: string }> {
    const head: any = await sql<any>`select a.processor, a.tenant_id::text as tenant_id, a.branch_id::text as branch_id,
        v.ai_powersalon_pct as ai, v.processor_pct as processor_pct, v.salon_pct as salon, v.currency
      from revenue_agreements a left join revenue_agreement_versions v on v.id = a.current_version_id where a.id = ${input.agreementId}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!head) return { ok: false, error: 'not_found' };
    if (head.processor_pct == null) return { ok: false, error: 'agreement_has_no_version' };
    const processor = String(head.processor ?? '');
    const split = { ai: Number(head.ai), processor: Number(head.processor_pct), salon: Number(head.salon) };

    const agg: any = await sql<any>`select coalesce(sum(processing_residual_cents),0)::bigint as eligible, coalesce(sum(applicable_costs_cents),0)::bigint as costs, coalesce(sum(refunds_cents),0)::bigint as refunds, coalesce(sum(adjustments_cents),0)::bigint as adjustments
      from residual_statements where processor = ${processor} and period_start <= ${input.periodEnd}::date and period_end >= ${input.periodStart}::date`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ eligible: 0, costs: 0, refunds: 0, adjustments: 0 }));
    const eligible = n(agg.eligible);
    // NET-FIRST, layered: applicable processor/card-network costs come off the top to form the Net Revenue pool;
    // the processor's retained share is its % of that NET pool — never a flat cut of the raw gross.
    const layered = computeLayeredResidualSplit(eligible, layeredFromFlat(split), { applicableCostsCents: n(agg.costs) });
    const partnerGross = layered.processorRetainedCents;
    const refundAlloc = Math.round((n(agg.refunds) * split.processor) / 100);
    const adjustmentAlloc = Math.round((n(agg.adjustments) * split.processor) / 100);
    const priorBalance = Math.round(Number(input.priorBalanceCents) || 0);
    const amountDue = partnerGross - refundAlloc + adjustmentAlloc + priorBalance;

    const idem = createHash('sha256').update(['payout', input.agreementId, processor, input.periodStart, input.periodEnd].join('|')).digest('hex');
    const existing: any = await sql<any>`select id::text as id, status, amount_due_cents, partner_gross_share_cents, eligible_revenue_cents, refund_allocation_cents, adjustment_allocation_cents, prior_balance_cents, partner_pct from partner_payouts where idempotency_key = ${idem} limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    if (existing.rows?.[0]) {
      const e = existing.rows[0];
      return { ok: true, duplicate: true, payoutId: e.id, processor, eligibleRevenueCents: n(e.eligible_revenue_cents), partnerPct: Number(e.partner_pct), partnerGrossShareCents: n(e.partner_gross_share_cents), refundAllocationCents: n(e.refund_allocation_cents), adjustmentAllocationCents: n(e.adjustment_allocation_cents), priorBalanceCents: n(e.prior_balance_cents), amountDueCents: n(e.amount_due_cents), status: e.status };
    }

    const snapshot = JSON.stringify({ eligible, applicableCosts: n(agg.costs), netPool: layered.netPoolCents, split, layered: { processorRetainedCents: layered.processorRetainedCents, processorOwesPlatformCents: layered.processorOwesPlatformCents, platformOwesTenantCents: layered.platformOwesTenantCents, platformRetainedCents: layered.platformRetainedCents }, refunds: n(agg.refunds), adjustments: n(agg.adjustments), refundAlloc, adjustmentAlloc, priorBalance, computedAt: new Date().toISOString() });
    try {
      return await this.db.transaction().execute(async (trx) => {
        const ins: any = await sql<any>`
          insert into partner_payouts (agreement_id, processor, period_start, period_end, tenant_id, branch_id, currency, eligible_revenue_cents, partner_pct,
            partner_gross_share_cents, refund_allocation_cents, adjustment_allocation_cents, prior_balance_cents, amount_paid_cents, amount_due_cents, status, idempotency_key, calc_snapshot, created_by)
          values (${input.agreementId}::uuid, ${processor}, ${input.periodStart}::date, ${input.periodEnd}::date, ${head.tenant_id ?? null}::uuid, ${head.branch_id ?? null}::uuid, ${head.currency ?? 'USD'},
            ${eligible}, ${split.processor}, ${partnerGross}, ${refundAlloc}, ${adjustmentAlloc}, ${priorBalance}, 0, ${amountDue}, 'calculated', ${idem}, ${snapshot}::jsonb, ${actor.id ?? null}::uuid)
          returning id::text as id`.execute(trx);
        const payoutId = ins.rows[0].id;
        await sql`insert into revenue_audit_log (action, agreement_id, tenant_id, branch_id, processor, actor_id, actor_role, field, new_value, reason)
          values ('partner_payout_calculated', ${input.agreementId}::uuid, ${head.tenant_id ?? null}::uuid, ${head.branch_id ?? null}::uuid, ${processor}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'amount_due_cents', ${String(amountDue)}, ${`eligible ${eligible} @ ${split.processor}%`})`.execute(trx);
        return { ok: true as const, duplicate: false, payoutId, processor, eligibleRevenueCents: eligible, partnerPct: split.processor, partnerGrossShareCents: partnerGross, refundAllocationCents: refundAlloc, adjustmentAllocationCents: adjustmentAlloc, priorBalanceCents: priorBalance, amountDueCents: amountDue, status: 'calculated', applicableCostsCents: n(agg.costs), netPoolCents: layered.netPoolCents, processorOwesPlatformCents: layered.processorOwesPlatformCents, platformOwesTenantCents: layered.platformOwesTenantCents, platformRetainedCents: layered.platformRetainedCents };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async approvePartnerPayout(actor: { id?: string; role?: string }, id: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
    const cur: any = await sql<any>`select status, agreement_id::text as agreement_id, processor, tenant_id::text as tenant_id from partner_payouts where id = ${id}`.execute(this.db).catch(() => ({ rows: [] }));
    const row = cur.rows?.[0];
    if (!row) return { ok: false, error: 'not_found' };
    if (!['calculated', 'pending_approval', 'draft'].includes(row.status)) return { ok: false, error: 'invalid_state' };
    try {
      return await this.db.transaction().execute(async (trx) => {
        const moved: any = await sql`update partner_payouts set status = 'approved', approved_by = ${actor.id ?? null}::uuid, approved_at = now() where id = ${id}::uuid and status = ${row.status} and ${canMoveToSql(PARTNER_PAYOUT, 'approved')} returning id`.execute(trx);
        if (!moved.rows.length) throw new InvalidStateTransitionError(PARTNER_PAYOUT, row.status, 'approved', 'concurrent');
        await sql`insert into revenue_audit_log (action, agreement_id, tenant_id, processor, actor_id, actor_role, field, old_value, new_value)
          values ('partner_payout_approved', ${row.agreement_id ?? null}::uuid, ${row.tenant_id ?? null}::uuid, ${row.processor}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'status', ${row.status}, 'approved')`.execute(trx);
        return { ok: true as const, status: 'approved' };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async listPartnerPayouts(opts: { processor?: string; agreementId?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 50));
    try {
      const r: any = await sql<any>`
        select p.id::text as id, p.agreement_id::text as agreement_id, a.code as agreement_code, p.processor, to_char(p.period_start,'YYYY-MM-DD') as period_start, to_char(p.period_end,'YYYY-MM-DD') as period_end,
          p.eligible_revenue_cents, p.partner_pct, p.partner_gross_share_cents, p.refund_allocation_cents, p.adjustment_allocation_cents, p.prior_balance_cents, p.amount_paid_cents, p.amount_due_cents, p.status, to_char(p.created_at,'YYYY-MM-DD') as created_at
        from partner_payouts p left join revenue_agreements a on a.id = p.agreement_id
        where true ${opts.processor ? sql`and p.processor = ${opts.processor}` : sql``} ${opts.agreementId ? sql`and p.agreement_id = ${opts.agreementId}` : sql``} ${opts.status ? sql`and p.status = ${opts.status}` : sql``}
        order by p.created_at desc, p.id desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), agreementId: x.agreement_id ?? null, agreementCode: x.agreement_code ?? null, processor: x.processor, periodStart: x.period_start, periodEnd: x.period_end,
        eligibleRevenueCents: n(x.eligible_revenue_cents), partnerPct: x.partner_pct == null ? null : Number(x.partner_pct), partnerGrossShareCents: n(x.partner_gross_share_cents),
        refundAllocationCents: n(x.refund_allocation_cents), adjustmentAllocationCents: n(x.adjustment_allocation_cents), priorBalanceCents: n(x.prior_balance_cents), amountPaidCents: n(x.amount_paid_cents), amountDueCents: n(x.amount_due_cents), status: x.status, createdAt: x.created_at,
      }));
    } catch { return []; }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Calculate Tenant Incentives: idempotent, agreement-driven salon share for a specific tenant over a period.
  // ══════════════════════════════════════════════════════════════════════════════════════
  async calculateTenantIncentive(actor: { id?: string; role?: string }, input: { agreementId: string; tenantId: string; periodStart: string; periodEnd: string; priorUnpaidBalanceCents?: number }): Promise<{ ok: true; duplicate: boolean; incentiveId: string; eligibleGrossRevenueCents: number; salonPct: number; incentiveEarnedCents: number; refundAllocationCents: number; adjustmentAllocationCents: number; priorUnpaidBalanceCents: number; currentAmountDueCents: number; status: string; applicableCostsCents?: number; netPoolCents?: number; processorOwesPlatformCents?: number; platformRetainedCents?: number } | { ok: false; error: string }> {
    const head: any = await sql<any>`select a.branch_id::text as branch_id, v.ai_powersalon_pct as ai, v.processor_pct as processor, v.salon_pct as salon, v.currency
      from revenue_agreements a left join revenue_agreement_versions v on v.id = a.current_version_id where a.id = ${input.agreementId}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!head) return { ok: false, error: 'not_found' };
    if (head.salon == null) return { ok: false, error: 'agreement_has_no_version' };
    const split = { ai: Number(head.ai), processor: Number(head.processor), salon: Number(head.salon) };

    // tenant-scoped eligible revenue: only this tenant's residual for the period
    const agg: any = await sql<any>`select coalesce(sum(processing_residual_cents),0)::bigint as eligible, coalesce(sum(applicable_costs_cents),0)::bigint as costs, coalesce(sum(refunds_cents),0)::bigint as refunds, coalesce(sum(adjustments_cents),0)::bigint as adjustments
      from residual_statements where tenant_id = ${input.tenantId}::uuid and period_start <= ${input.periodEnd}::date and period_end >= ${input.periodStart}::date`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ eligible: 0, costs: 0, refunds: 0, adjustments: 0 }));
    const eligible = n(agg.eligible);
    // NET-FIRST, layered: the tenant incentive is that tenant's % of the NET pool (after applicable costs), and it
    // is an AI PowerSalon-MANAGED payable carved out of the platform's contractual share — never a processor payout.
    const layered = computeLayeredResidualSplit(eligible, layeredFromFlat(split), { applicableCostsCents: n(agg.costs) });
    const earned = layered.platformOwesTenantCents;
    const refundAlloc = Math.round((n(agg.refunds) * split.salon) / 100);
    const adjustmentAlloc = Math.round((n(agg.adjustments) * split.salon) / 100);
    const priorUnpaid = Math.round(Number(input.priorUnpaidBalanceCents) || 0);
    const due = earned - refundAlloc + adjustmentAlloc + priorUnpaid;

    const idem = createHash('sha256').update(['incentive', input.agreementId, input.tenantId, input.periodStart, input.periodEnd].join('|')).digest('hex');
    const existing: any = await sql<any>`select id::text as id, status, eligible_gross_revenue_cents, salon_pct, incentive_earned_cents, refund_allocation_cents, adjustment_allocation_cents, prior_unpaid_balance_cents, current_amount_due_cents from tenant_incentives where idempotency_key = ${idem} limit 1`.execute(this.db).catch(() => ({ rows: [] }));
    if (existing.rows?.[0]) {
      const e = existing.rows[0];
      return { ok: true, duplicate: true, incentiveId: e.id, eligibleGrossRevenueCents: n(e.eligible_gross_revenue_cents), salonPct: Number(e.salon_pct), incentiveEarnedCents: n(e.incentive_earned_cents), refundAllocationCents: n(e.refund_allocation_cents), adjustmentAllocationCents: n(e.adjustment_allocation_cents), priorUnpaidBalanceCents: n(e.prior_unpaid_balance_cents), currentAmountDueCents: n(e.current_amount_due_cents), status: e.status };
    }

    const snapshot = JSON.stringify({ eligible, applicableCosts: n(agg.costs), netPool: layered.netPoolCents, split, layered: { processorRetainedCents: layered.processorRetainedCents, processorOwesPlatformCents: layered.processorOwesPlatformCents, platformOwesTenantCents: layered.platformOwesTenantCents, platformRetainedCents: layered.platformRetainedCents }, refunds: n(agg.refunds), adjustments: n(agg.adjustments), refundAlloc, adjustmentAlloc, priorUnpaid, computedAt: new Date().toISOString() });
    try {
      return await this.db.transaction().execute(async (trx) => {
        const ins: any = await sql<any>`
          insert into tenant_incentives (agreement_id, tenant_id, branch_id, period_start, period_end, currency, eligible_gross_revenue_cents, salon_pct,
            incentive_earned_cents, refund_allocation_cents, adjustment_allocation_cents, prior_unpaid_balance_cents, amount_paid_cents, current_amount_due_cents, status, idempotency_key, calc_snapshot, created_by)
          values (${input.agreementId}::uuid, ${input.tenantId}::uuid, ${head.branch_id ?? null}::uuid, ${input.periodStart}::date, ${input.periodEnd}::date, ${head.currency ?? 'USD'}, ${eligible}, ${split.salon},
            ${earned}, ${refundAlloc}, ${adjustmentAlloc}, ${priorUnpaid}, 0, ${due}, 'calculated', ${idem}, ${snapshot}::jsonb, ${actor.id ?? null}::uuid)
          returning id::text as id`.execute(trx);
        const incentiveId = ins.rows[0].id;
        await sql`insert into revenue_audit_log (action, agreement_id, tenant_id, branch_id, actor_id, actor_role, field, new_value, reason)
          values ('tenant_incentive_calculated', ${input.agreementId}::uuid, ${input.tenantId}::uuid, ${head.branch_id ?? null}::uuid, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'current_amount_due_cents', ${String(due)}, ${`eligible ${eligible} @ ${split.salon}%`})`.execute(trx);
        return { ok: true as const, duplicate: false, incentiveId, eligibleGrossRevenueCents: eligible, salonPct: split.salon, incentiveEarnedCents: earned, refundAllocationCents: refundAlloc, adjustmentAllocationCents: adjustmentAlloc, priorUnpaidBalanceCents: priorUnpaid, currentAmountDueCents: due, status: 'calculated', applicableCostsCents: n(agg.costs), netPoolCents: layered.netPoolCents, processorOwesPlatformCents: layered.processorOwesPlatformCents, platformRetainedCents: layered.platformRetainedCents };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async approveTenantIncentive(actor: { id?: string; role?: string }, id: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
    const cur: any = await sql<any>`select status, agreement_id::text as agreement_id, tenant_id::text as tenant_id from tenant_incentives where id = ${id}`.execute(this.db).catch(() => ({ rows: [] }));
    const row = cur.rows?.[0];
    if (!row) return { ok: false, error: 'not_found' };
    if (!['calculated', 'pending_approval', 'draft'].includes(row.status)) return { ok: false, error: 'invalid_state' };
    try {
      return await this.db.transaction().execute(async (trx) => {
        const moved: any = await sql`update tenant_incentives set status = 'approved', approved_by = ${actor.id ?? null}::uuid, approved_at = now() where id = ${id}::uuid and status = ${row.status} and ${canMoveToSql(TENANT_INCENTIVE, 'approved')} returning id`.execute(trx);
        if (!moved.rows.length) throw new InvalidStateTransitionError(TENANT_INCENTIVE, row.status, 'approved', 'concurrent');
        await sql`insert into revenue_audit_log (action, agreement_id, tenant_id, actor_id, actor_role, field, old_value, new_value)
          values ('tenant_incentive_approved', ${row.agreement_id ?? null}::uuid, ${row.tenant_id ?? null}::uuid, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'status', ${row.status}, 'approved')`.execute(trx);
        return { ok: true as const, status: 'approved' };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async listTenantIncentives(opts: { tenantId?: string; agreementId?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 50));
    try {
      const r: any = await sql<any>`
        select i.id::text as id, i.agreement_id::text as agreement_id, a.code as agreement_code, i.tenant_id::text as tenant_id, t.display_name as tenant_name,
          to_char(i.period_start,'YYYY-MM-DD') as period_start, to_char(i.period_end,'YYYY-MM-DD') as period_end,
          i.eligible_gross_revenue_cents, i.salon_pct, i.incentive_earned_cents, i.refund_allocation_cents, i.adjustment_allocation_cents, i.prior_unpaid_balance_cents, i.amount_paid_cents, i.current_amount_due_cents, i.status, to_char(i.created_at,'YYYY-MM-DD') as created_at
        from tenant_incentives i left join revenue_agreements a on a.id = i.agreement_id left join tenants t on t.id = i.tenant_id
        where true ${opts.tenantId ? sql`and i.tenant_id = ${opts.tenantId}` : sql``} ${opts.agreementId ? sql`and i.agreement_id = ${opts.agreementId}` : sql``} ${opts.status ? sql`and i.status = ${opts.status}` : sql``}
        order by i.created_at desc, i.id desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), agreementId: x.agreement_id ?? null, agreementCode: x.agreement_code ?? null, tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null, periodStart: x.period_start, periodEnd: x.period_end,
        eligibleGrossRevenueCents: n(x.eligible_gross_revenue_cents), salonPct: x.salon_pct == null ? null : Number(x.salon_pct), incentiveEarnedCents: n(x.incentive_earned_cents),
        refundAllocationCents: n(x.refund_allocation_cents), adjustmentAllocationCents: n(x.adjustment_allocation_cents), priorUnpaidBalanceCents: n(x.prior_unpaid_balance_cents), amountPaidCents: n(x.amount_paid_cents), currentAmountDueCents: n(x.current_amount_due_cents), status: x.status, createdAt: x.created_at,
      }));
    } catch { return []; }
  }

  // Audit a payout-report export (the export itself contains no card/bank/credential fields).
  async recordExportAudit(actor: { id?: string; role?: string }, dataset: string, rowCount: number, filterSummary: string): Promise<void> {
    try {
      await sql`insert into revenue_audit_log (action, actor_id, actor_role, field, new_value, reason)
        values ('payout_report_exported', ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'dataset', ${dataset}, ${`${rowCount} row(s); ${filterSummary}`})`.execute(this.db);
    } catch { /* best-effort audit */ }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Approve Revenue Adjustments: adjustments never edit originals — approval creates a SEPARATE ledger entry.
  // High-value adjustments require DUAL approval by two distinct actors. Locked periods are blocked.
  // ══════════════════════════════════════════════════════════════════════════════════════
  private static readonly DUAL_APPROVAL_THRESHOLD_CENTS = 1000000; // >= $10,000 requires two approvers

  private async isPeriodLocked(periodId?: string | null): Promise<boolean> {
    if (!periodId) return false;
    const r: any = await sql<any>`select status from revenue_accounting_periods where id = ${periodId}`.execute(this.db).catch(() => ({ rows: [] }));
    return r.rows?.[0]?.status === 'locked';
  }

  private async nextAdjustmentCode(trx: any): Promise<string> {
    const yr = new Date().getUTCFullYear();
    const r: any = await sql<any>`select coalesce(max(substring(adjustment_ref from '\\d+$')::int),0) as maxn from revenue_adjustments where adjustment_ref like ${'ADJ-' + yr + '-%'}`.execute(trx);
    return `ADJ-${yr}-${String((Number(r.rows?.[0]?.maxn) || 0) + 1).padStart(4, '0')}`;
  }

  async createAdjustment(actor: { id?: string; role?: string }, input: {
    revenueRecordId?: string | null; agreementId?: string | null; accountingPeriodId?: string | null; tenantId?: string | null; branchId?: string | null; processor?: string | null;
    adjustmentType: string; amountCents: number; reason: string; supportingEvidence?: string | null;
  }): Promise<{ ok: true; adjustmentId: string; ref: string; requiresDualApproval: boolean; status: string } | { ok: false; error: string }> {
    if (!Number.isFinite(input.amountCents) || input.amountCents === 0) return { ok: false, error: 'amount_required' };
    if (!String(input.reason ?? '').trim()) return { ok: false, error: 'reason_required' };
    if (await this.isPeriodLocked(input.accountingPeriodId)) return { ok: false, error: 'period_locked' };

    const requiresDual = Math.abs(input.amountCents) >= KyselyRevenueResidualsRepo.DUAL_APPROVAL_THRESHOLD_CENTS;
    const direction = input.amountCents >= 0 ? 'increase' : 'decrease';
    try {
      return await this.db.transaction().execute(async (trx) => {
        const ref = await this.nextAdjustmentCode(trx);
        const ins: any = await sql<any>`
          insert into revenue_adjustments (adjustment_ref, agreement_id, revenue_record_id, accounting_period_id, tenant_id, branch_id, processor, adjustment_type, amount_cents, direction, reason, supporting_evidence, requires_dual_approval, requested_by, status)
          values (${ref}, ${input.agreementId ?? null}::uuid, ${input.revenueRecordId ?? null}::uuid, ${input.accountingPeriodId ?? null}::uuid, ${input.tenantId ?? null}::uuid, ${input.branchId ?? null}::uuid, ${input.processor ?? null}, ${input.adjustmentType}, ${input.amountCents}, ${direction}, ${input.reason}, ${input.supportingEvidence ?? null}, ${requiresDual}, ${actor.id ?? null}::uuid, 'pending_approval')
          returning id::text as id`.execute(trx);
        const adjustmentId = ins.rows[0].id;
        await sql`insert into revenue_audit_log (action, agreement_id, revenue_record_id, tenant_id, branch_id, accounting_period_id, processor, actor_id, actor_role, field, new_value, reason)
          values ('revenue_adjustment_requested', ${input.agreementId ?? null}::uuid, ${input.revenueRecordId ?? null}::uuid, ${input.tenantId ?? null}::uuid, ${input.branchId ?? null}::uuid, ${input.accountingPeriodId ?? null}::uuid, ${input.processor ?? null}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'amount_cents', ${String(input.amountCents)}, ${input.reason})`.execute(trx);
        return { ok: true as const, adjustmentId, ref, requiresDualApproval: requiresDual, status: 'pending_approval' };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async approveAdjustment(actor: { id?: string; role?: string }, id: string): Promise<{ ok: true; status: string; needsSecondApproval?: boolean; ledgerRecordId?: string } | { ok: false; error: string }> {
    const a: any = await sql<any>`select * from revenue_adjustments where id = ${id}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!a) return { ok: false, error: 'not_found' };
    if (!['pending_approval', 'pending_second_approval'].includes(a.status)) return { ok: false, error: 'invalid_state' };
    if (await this.isPeriodLocked(a.accounting_period_id ? String(a.accounting_period_id) : null)) return { ok: false, error: 'period_locked' };

    // dual-approval: first approval only records the approver and waits for a distinct second approver
    if (a.status === 'pending_approval' && a.requires_dual_approval) {
      try {
        await this.db.transaction().execute(async (trx) => {
          const moved: any = await sql`update revenue_adjustments set approved_by = ${actor.id ?? null}::uuid, status = 'pending_second_approval', approved_at = now() where id = ${id}::uuid and status = 'pending_approval' and ${canMoveToSql(REVENUE_ADJUSTMENT, 'pending_second_approval')} returning id`.execute(trx);
          if (!moved.rows.length) throw new InvalidStateTransitionError(REVENUE_ADJUSTMENT, a.status, 'pending_second_approval', 'concurrent');
          await sql`insert into revenue_audit_log (action, revenue_record_id, tenant_id, actor_id, actor_role, field, old_value, new_value, reason)
            values ('revenue_adjustment_approved', ${a.revenue_record_id ?? null}::uuid, ${a.tenant_id ?? null}::uuid, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'status', 'pending_approval', 'pending_second_approval', 'first approval (dual required)')`.execute(trx);
        });
        return { ok: true, status: 'pending_second_approval', needsSecondApproval: true };
      } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
    }
    // second approval must be a DISTINCT actor
    if (a.status === 'pending_second_approval') {
      if (a.approved_by && actor.id && String(a.approved_by) === String(actor.id)) return { ok: false, error: 'same_approver' };
    }

    // apply: create the SEPARATE ledger entry; original revenue record is untouched
    try {
      return await this.db.transaction().execute(async (trx) => {
        const ledger: any = await sql<any>`
          insert into revenue_records (agreement_id, tenant_id, branch_id, processor, revenue_source, source_reference, accounting_period_id, currency,
            gross_revenue_cents, adjustments_cents, net_revenue_cents, effective_date, status)
          values (${a.agreement_id ?? null}::uuid, ${a.tenant_id ?? null}::uuid, ${a.branch_id ?? null}::uuid, ${a.processor ?? null}, 'adjustment', ${a.adjustment_ref}, ${a.accounting_period_id ?? null}::uuid, 'USD',
            0, ${a.amount_cents}, ${a.amount_cents}, current_date, 'adjusted')
          returning id::text as id`.execute(trx);
        const ledgerRecordId = ledger.rows[0].id;
        const secondCol = a.status === 'pending_second_approval' ? sql`second_approved_by = ${actor.id ?? null}::uuid,` : sql`approved_by = coalesce(approved_by, ${actor.id ?? null}::uuid),`;
        // Phase 12 (#27): applied ONCE — a concurrent approval that got here first makes this one roll its ledger entry back
        const moved: any = await sql`update revenue_adjustments set ${secondCol} status = 'applied', ledger_record_id = ${ledgerRecordId}::uuid, applied_at = now(), approved_at = coalesce(approved_at, now()) where id = ${id}::uuid and status = ${a.status} and ${canMoveToSql(REVENUE_ADJUSTMENT, 'applied')} returning id`.execute(trx);
        if (!moved.rows.length) throw new InvalidStateTransitionError(REVENUE_ADJUSTMENT, a.status, 'applied', 'concurrent');
        await sql`insert into revenue_audit_log (action, revenue_record_id, tenant_id, branch_id, accounting_period_id, processor, actor_id, actor_role, field, old_value, new_value, reason)
          values ('revenue_adjustment_approved', ${a.revenue_record_id ?? null}::uuid, ${a.tenant_id ?? null}::uuid, ${a.branch_id ?? null}::uuid, ${a.accounting_period_id ?? null}::uuid, ${a.processor ?? null}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'status', ${a.status}, 'applied', ${`ledger entry ${ledgerRecordId} (${a.amount_cents} cents); original preserved`})`.execute(trx);
        return { ok: true as const, status: 'applied', ledgerRecordId };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async rejectAdjustment(actor: { id?: string; role?: string }, id: string, reason?: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
    const a: any = await sql<any>`select status, revenue_record_id::text as revenue_record_id, tenant_id::text as tenant_id from revenue_adjustments where id = ${id}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!a) return { ok: false, error: 'not_found' };
    if (!['pending_approval', 'pending_second_approval'].includes(a.status)) return { ok: false, error: 'invalid_state' };
    try {
      return await this.db.transaction().execute(async (trx) => {
        const moved: any = await sql`update revenue_adjustments set status = 'rejected', rejected_reason = ${reason ?? null} where id = ${id}::uuid and status = ${a.status} and ${canMoveToSql(REVENUE_ADJUSTMENT, 'rejected')} returning id`.execute(trx);
        if (!moved.rows.length) throw new InvalidStateTransitionError(REVENUE_ADJUSTMENT, a.status, 'rejected', 'concurrent');
        await sql`insert into revenue_audit_log (action, revenue_record_id, tenant_id, actor_id, actor_role, field, old_value, new_value, reason)
          values ('revenue_adjustment_rejected', ${a.revenue_record_id ?? null}::uuid, ${a.tenant_id ?? null}::uuid, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'status', ${a.status}, 'rejected', ${reason ?? null})`.execute(trx);
        return { ok: true as const, status: 'rejected' };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  // Reverse an APPLIED adjustment: post a compensating ledger entry (negated), preserving both originals.
  async reverseAdjustment(actor: { id?: string; role?: string }, id: string, reason?: string): Promise<{ ok: true; status: string; reversalLedgerId: string } | { ok: false; error: string }> {
    const a: any = await sql<any>`select * from revenue_adjustments where id = ${id}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!a) return { ok: false, error: 'not_found' };
    if (a.status !== 'applied') return { ok: false, error: 'invalid_state' };
    if (await this.isPeriodLocked(a.accounting_period_id ? String(a.accounting_period_id) : null)) return { ok: false, error: 'period_locked' };
    try {
      return await this.db.transaction().execute(async (trx) => {
        const rev: any = await sql<any>`
          insert into revenue_records (agreement_id, tenant_id, branch_id, processor, revenue_source, source_reference, accounting_period_id, currency,
            gross_revenue_cents, adjustments_cents, net_revenue_cents, effective_date, status)
          values (${a.agreement_id ?? null}::uuid, ${a.tenant_id ?? null}::uuid, ${a.branch_id ?? null}::uuid, ${a.processor ?? null}, 'adjustment', ${a.adjustment_ref + '-REV'}, ${a.accounting_period_id ?? null}::uuid, 'USD',
            0, ${-a.amount_cents}, ${-a.amount_cents}, current_date, 'adjusted')
          returning id::text as id`.execute(trx);
        const reversalLedgerId = rev.rows[0].id;
        const moved: any = await sql`update revenue_adjustments set status = 'reversed', rejected_reason = coalesce(${reason ?? null}, rejected_reason) where id = ${id}::uuid and ${canMoveToSql(REVENUE_ADJUSTMENT, 'reversed')} returning id`.execute(trx);
        if (!moved.rows.length) throw new InvalidStateTransitionError(REVENUE_ADJUSTMENT, 'applied', 'reversed', 'concurrent');   // reversed once: the compensating entry rolls back
        await sql`insert into revenue_audit_log (action, revenue_record_id, tenant_id, branch_id, accounting_period_id, processor, actor_id, actor_role, field, old_value, new_value, reason)
          values ('revenue_adjustment_reversed', ${a.revenue_record_id ?? null}::uuid, ${a.tenant_id ?? null}::uuid, ${a.branch_id ?? null}::uuid, ${a.accounting_period_id ?? null}::uuid, ${a.processor ?? null}, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'status', 'applied', 'reversed', ${`compensating ledger entry ${reversalLedgerId} (${-a.amount_cents} cents); original + prior ledger preserved${reason ? '; ' + reason : ''}`})`.execute(trx);
        return { ok: true as const, status: 'reversed', reversalLedgerId };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async listAdjustments(opts: { revenueRecordId?: string; agreementId?: string; status?: string; limit?: number } = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 50));
    try {
      const r: any = await sql<any>`
        select adj.id::text as id, adj.adjustment_ref, adj.agreement_id::text as agreement_id, a.code as agreement_code, adj.revenue_record_id::text as revenue_record_id,
          adj.tenant_id::text as tenant_id, t.display_name as tenant_name, adj.processor, adj.adjustment_type, adj.amount_cents, adj.direction, adj.reason,
          adj.requires_dual_approval, adj.status, adj.ledger_record_id::text as ledger_record_id, to_char(adj.created_at,'YYYY-MM-DD') as created_at
        from revenue_adjustments adj left join revenue_agreements a on a.id = adj.agreement_id left join tenants t on t.id = adj.tenant_id
        where true ${opts.revenueRecordId ? sql`and adj.revenue_record_id = ${opts.revenueRecordId}` : sql``} ${opts.agreementId ? sql`and adj.agreement_id = ${opts.agreementId}` : sql``} ${opts.status ? sql`and adj.status = ${opts.status}` : sql``}
        order by adj.created_at desc, adj.id desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), adjustmentRef: x.adjustment_ref, agreementId: x.agreement_id ?? null, agreementCode: x.agreement_code ?? null, revenueRecordId: x.revenue_record_id ?? null,
        tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null, processor: x.processor ?? null, adjustmentType: x.adjustment_type, amountCents: n(x.amount_cents), direction: x.direction, reason: x.reason,
        requiresDualApproval: !!x.requires_dual_approval, status: x.status, ledgerRecordId: x.ledger_record_id ?? null, createdAt: x.created_at,
      }));
    } catch { return []; }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Lock Finalized Accounting Periods: create/list, pre-lock readiness + lock, reopen (reason-gated).
  // Once locked, the adjustment workflow (createAdjustment/approveAdjustment) blocks changes to the period.
  // ══════════════════════════════════════════════════════════════════════════════════════
  async createPeriod(actor: { id?: string; role?: string }, input: { name: string; startDate: string; endDate: string; currency?: string }): Promise<{ ok: true; periodId: string; status: string } | { ok: false; error: string }> {
    try {
      const ins: any = await sql<any>`insert into revenue_accounting_periods (name, start_date, end_date, currency, status)
        values (${input.name}, ${input.startDate}::date, ${input.endDate}::date, ${input.currency ?? 'USD'}, 'open') returning id::text as id`.execute(this.db);
      const periodId = ins.rows[0].id;
      await sql`insert into revenue_audit_log (action, actor_id, actor_role, field, new_value, reason)
        values ('accounting_period_created', ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'name', ${input.name}, ${`${input.startDate}..${input.endDate}`})`.execute(this.db).catch(() => undefined);
      return { ok: true, periodId, status: 'open' };
    } catch (e: any) {
      if (String(e?.message ?? '').includes('revenue_accounting_periods_name_key') || String(e?.message ?? '').includes('unique')) return { ok: false, error: 'duplicate_name' };
      return { ok: false, error: 'write_failed' };
    }
  }

  // Pre-lock readiness for a period: unreviewed statements + open variances (advisory) + pending adjustments (hard block).
  private async periodReadiness(period: { id: string; start: string; end: string }): Promise<{ unreviewedStatements: number; openVariances: number; pendingAdjustments: number }> {
    const [st, rc, adj]: any = await Promise.all([
      sql<any>`select count(*)::int as n from residual_statements where period_start <= ${period.end}::date and period_end >= ${period.start}::date and review_status not in ('reviewed','reconciled')`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 })),
      sql<any>`select count(*)::int as n from processor_reconciliations where period_start <= ${period.end}::date and period_end >= ${period.start}::date and status = 'variance'`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 })),
      sql<any>`select count(*)::int as n from revenue_adjustments where accounting_period_id = ${period.id}::uuid and status in ('pending_approval','pending_second_approval')`.execute(this.db).then((r: any) => r.rows[0]).catch(() => ({ n: 0 })),
    ]);
    return { unreviewedStatements: n(st.n), openVariances: n(rc.n), pendingAdjustments: n(adj.n) };
  }

  async lockPeriod(actor: { id?: string; role?: string }, id: string, reason?: string): Promise<{ ok: true; status: string; readiness: any } | { ok: false; error: string; readiness?: any }> {
    const p: any = await sql<any>`select status, to_char(start_date,'YYYY-MM-DD') as s, to_char(end_date,'YYYY-MM-DD') as e, name from revenue_accounting_periods where id = ${id}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!p) return { ok: false, error: 'not_found' };
    if (p.status === 'locked') return { ok: false, error: 'already_locked' };
    const readiness = await this.periodReadiness({ id, start: p.s, end: p.e });
    if (readiness.pendingAdjustments > 0) return { ok: false, error: 'pending_adjustments', readiness };
    try {
      return await this.db.transaction().execute(async (trx) => {
        await sql`update revenue_accounting_periods set status = 'locked', locked_by = ${actor.id ?? null}::uuid, locked_at = now(), lock_reason = ${reason ?? null} where id = ${id}::uuid and ${canMoveToSql(REVENUE_ACCOUNTING_PERIOD, 'locked')}`.execute(trx);
        await sql`insert into revenue_audit_log (action, accounting_period_id, actor_id, actor_role, field, old_value, new_value, reason)
          values ('accounting_period_locked', ${id}::uuid, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'status', ${p.status}, 'locked', ${reason ?? null})`.execute(trx);
        return { ok: true as const, status: 'locked', readiness };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async reopenPeriod(actor: { id?: string; role?: string }, id: string, reason: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
    const p: any = await sql<any>`select status from revenue_accounting_periods where id = ${id}`.execute(this.db).then((r: any) => r.rows[0]).catch(() => undefined);
    if (!p) return { ok: false, error: 'not_found' };
    if (p.status !== 'locked') return { ok: false, error: 'not_locked' };
    try {
      return await this.db.transaction().execute(async (trx) => {
        await sql`update revenue_accounting_periods set status = 'reopened', reopened_by = ${actor.id ?? null}::uuid, reopened_at = now(), reopen_reason = ${reason} where id = ${id}::uuid and ${canMoveToSql(REVENUE_ACCOUNTING_PERIOD, 'reopened')}`.execute(trx);
        await sql`insert into revenue_audit_log (action, accounting_period_id, actor_id, actor_role, field, old_value, new_value, reason)
          values ('accounting_period_reopened', ${id}::uuid, ${actor.id ?? null}::uuid, ${actor.role ?? null}, 'status', 'locked', 'reopened', ${reason})`.execute(trx);
        return { ok: true as const, status: 'reopened' };
      });
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async listPeriods(opts: { status?: string; limit?: number } = {}): Promise<any[]> {
    const lim = Math.min(200, Math.max(1, opts.limit ?? 50));
    try {
      const r: any = await sql<any>`
        select id::text as id, name, to_char(start_date,'YYYY-MM-DD') as start_date, to_char(end_date,'YYYY-MM-DD') as end_date, currency, status,
          to_char(locked_at,'YYYY-MM-DD') as locked_at, lock_reason, to_char(reopened_at,'YYYY-MM-DD') as reopened_at, reopen_reason
        from revenue_accounting_periods where true ${opts.status ? sql`and status = ${opts.status}` : sql``} order by start_date desc, name desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({
        id: String(x.id), name: x.name, startDate: x.start_date, endDate: x.end_date, currency: x.currency, status: x.status,
        lockedAt: x.locked_at ?? null, lockReason: x.lock_reason ?? null, reopenedAt: x.reopened_at ?? null, reopenReason: x.reopen_reason ?? null,
      }));
    } catch { return []; }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Track Unpaid Residuals: outstanding residual balances aged into current / 31-60 / 61-90 / 90+ buckets.
  // Aging is by record age (current_date - effective_date). Read-only aggregation over revenue_records.
  // ══════════════════════════════════════════════════════════════════════════════════════
  async unpaidResidualsAging(opts: { processor?: string; tenantId?: string } = {}): Promise<{ rows: any[]; totals: any }> {
    try {
      const r: any = await sql<any>`
        select r.tenant_id::text as tenant_id, t.display_name as tenant_name, r.processor,
          count(distinct r.agreement_id)::int as agreement_count,
          coalesce(sum(r.outstanding_balance_cents),0)::bigint as outstanding,
          coalesce(sum(case when (current_date - r.effective_date) <= 30 then r.outstanding_balance_cents else 0 end),0)::bigint as cur,
          coalesce(sum(case when (current_date - r.effective_date) between 31 and 60 then r.outstanding_balance_cents else 0 end),0)::bigint as b31,
          coalesce(sum(case when (current_date - r.effective_date) between 61 and 90 then r.outstanding_balance_cents else 0 end),0)::bigint as b61,
          coalesce(sum(case when (current_date - r.effective_date) > 90 then r.outstanding_balance_cents else 0 end),0)::bigint as b90,
          coalesce(max(current_date - r.effective_date),0)::int as oldest_age
        from revenue_records r left join tenants t on t.id = r.tenant_id
        where r.outstanding_balance_cents > 0 ${opts.processor ? sql`and r.processor = ${opts.processor}` : sql``} ${opts.tenantId ? sql`and r.tenant_id = ${opts.tenantId}::uuid` : sql``}
        group by r.tenant_id, t.display_name, r.processor
        order by outstanding desc, r.processor asc`.execute(this.db);
      const rows = (r.rows ?? []).map((x: any) => ({
        tenantId: x.tenant_id ?? null, tenantName: x.tenant_name ?? null, processor: x.processor ?? null, agreementCount: n(x.agreement_count),
        outstandingCents: n(x.outstanding), currentCents: n(x.cur), b31_60Cents: n(x.b31), b61_90Cents: n(x.b61), b90PlusCents: n(x.b90), oldestAgeDays: n(x.oldest_age),
      }));
      const totals = rows.reduce((acc: any, x: any) => ({
        outstandingCents: acc.outstandingCents + x.outstandingCents, currentCents: acc.currentCents + x.currentCents,
        b31_60Cents: acc.b31_60Cents + x.b31_60Cents, b61_90Cents: acc.b61_90Cents + x.b61_90Cents, b90PlusCents: acc.b90PlusCents + x.b90PlusCents,
      }), { outstandingCents: 0, currentCents: 0, b31_60Cents: 0, b61_90Cents: 0, b90PlusCents: 0 });
      return { rows, totals };
    } catch { return { rows: [], totals: { outstandingCents: 0, currentCents: 0, b31_60Cents: 0, b61_90Cents: 0, b90PlusCents: 0 } }; }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Revenue Forecast: least-squares linear trend on trailing monthly NET revenue, with a ±1σ band
  // and a per-processor split of the projected next period. Read-only. Adjustment ledger entries excluded.
  // ══════════════════════════════════════════════════════════════════════════════════════
  async revenueForecast(opts: { horizonMonths?: number } = {}): Promise<ResidualRevenueForecast> {
    const horizon = Math.min(12, Math.max(1, Math.trunc(opts.horizonMonths || 3)));
    try {
      const hist: any = await sql<any>`
        select to_char(date_trunc('month', effective_date),'YYYY-MM') as month,
          coalesce(sum(gross_revenue_cents),0)::bigint as gross, coalesce(sum(net_revenue_cents),0)::bigint as net
        from revenue_records where effective_date is not null and revenue_source <> 'adjustment'
        group by 1 order by 1`.execute(this.db);
      const history = (hist.rows ?? []).map((x: any) => ({ month: x.month, grossCents: n(x.gross), netCents: n(x.net) }));
      if (history.length < 2) return { available: false, reason: 'insufficient_history' };

      // least-squares on (x = 0..n-1, y = netCents)
      const ys = history.map((h: any) => h.netCents);
      const nPts = ys.length;
      const xs = ys.map((_: number, i: number) => i);
      const meanX = xs.reduce((a: number, b: number) => a + b, 0) / nPts;
      const meanY = ys.reduce((a: number, b: number) => a + b, 0) / nPts;
      let num = 0, den = 0;
      for (let i = 0; i < nPts; i++) { num += (xs[i] - meanX) * (ys[i] - meanY); den += (xs[i] - meanX) ** 2; }
      const slope = den === 0 ? 0 : num / den;
      const intercept = meanY - slope * meanX;
      const predict = (x: number) => intercept + slope * x;
      const variance = ys.reduce((acc: number, y: number, i: number) => acc + (y - predict(xs[i])) ** 2, 0) / nPts;
      const sigma = Math.sqrt(variance);

      // month labels for the projection
      const lastMonth = history[history.length - 1].month as string;
      const [ly, lm] = lastMonth.split('-').map((v: string) => parseInt(v, 10));
      const monthLabel = (offset: number) => { const d = new Date(Date.UTC(ly, lm - 1 + offset, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

      const projection = Array.from({ length: horizon }, (_, k) => {
        const x = nPts + k;
        const p = Math.max(0, Math.round(predict(x)));
        return { month: monthLabel(k + 1), projectedNetCents: p, lowCents: Math.max(0, Math.round(p - sigma)), highCents: Math.round(p + sigma) };
      });
      const nextPeriod = projection[0];
      const monthlyGrowthPct = meanY === 0 ? 0 : Math.round((slope / meanY) * 1000) / 10;

      // per-processor split of the projected next period from trailing net share
      const proc: any = await sql<any>`
        select processor, coalesce(sum(net_revenue_cents),0)::bigint as net from revenue_records
        where effective_date is not null and revenue_source <> 'adjustment' and processor is not null
        group by processor order by net desc`.execute(this.db);
      const procRows = (proc.rows ?? []).map((x: any) => ({ processor: x.processor, net: n(x.net) }));
      const procTotal = procRows.reduce((a: number, b: any) => a + b.net, 0) || 1;
      const byProcessor = procRows.map((p: any) => ({ processor: p.processor, sharePct: Math.round((p.net / procTotal) * 1000) / 10, projectedNetCents: Math.round(nextPeriod.projectedNetCents * (p.net / procTotal)) }));

      return { available: true, methodology: 'least-squares linear trend on trailing monthly net revenue (±1σ band)', history, projection, nextPeriod, monthlyGrowthPct, byProcessor };
    } catch { return { available: false, reason: 'error' }; }
  }

  // ══════════════════════════════════════════════════════════════════════════════════════
  // Background export jobs: enqueue → run off the request path → persist result for download.
  // ══════════════════════════════════════════════════════════════════════════════════════
  async createExportJob(actor: { id?: string; role?: string }, input: { dataset: string; format: string; filters: any }): Promise<{ ok: true; jobId: string; status: string } | { ok: false; error: string }> {
    try {
      const ins: any = await sql<any>`insert into revenue_export_jobs (dataset, format, filters, status, requested_by)
        values (${input.dataset}, ${input.format}, ${JSON.stringify(input.filters ?? {})}::jsonb, 'queued', ${actor.id ?? null}::uuid) returning id::text as id`.execute(this.db);
      return { ok: true, jobId: ins.rows[0].id, status: 'queued' };
    } catch (e) { return { ok: false, error: e instanceof InvalidStateTransitionError ? 'invalid_state' : 'write_failed' }; }
  }

  async markExportJobRunning(jobId: string): Promise<void> {
    await sql`update revenue_export_jobs set status = 'running', started_at = now() where id = ${jobId}::uuid and status = 'queued' and ${canMoveToSql(REVENUE_EXPORT_JOB, 'running')}`.execute(this.db).catch(() => undefined);
  }

  async completeExportJob(jobId: string, res: { filename: string; mime: string; encoding: string; content: string; rowCount: number }): Promise<void> {
    const contentKey = this.store ? await stashExportBytes(this.store, 'revenue-exports', jobId, res.filename, Buffer.from(res.content, res.encoding === 'base64' ? 'base64' : 'utf8'), res.mime) : null;   // B-18
    await sql`update revenue_export_jobs set status = 'completed', filename = ${res.filename}, mime = ${res.mime}, encoding = ${res.encoding}, content = ${contentKey ? null : res.content}, content_key = ${contentKey}, row_count = ${res.rowCount}, completed_at = now() where id = ${jobId}::uuid and ${canMoveToSql(REVENUE_EXPORT_JOB, 'completed')}`.execute(this.db).catch(() => undefined);
  }

  async failExportJob(jobId: string, error: string): Promise<void> {
    await sql`update revenue_export_jobs set status = 'failed', error = ${error}, completed_at = now() where id = ${jobId}::uuid and ${canMoveToSql(REVENUE_EXPORT_JOB, 'failed')}`.execute(this.db).catch(() => undefined);
  }

  async getExportJob(jobId: string): Promise<any | null> {
    try {
      const r: any = await sql<any>`select id::text as id, dataset, format, status, row_count, filename, mime, encoding, content, content_key, error,
        to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') as created_at, to_char(completed_at,'YYYY-MM-DD"T"HH24:MI:SS') as completed_at
        from revenue_export_jobs where id = ${jobId}`.execute(this.db);
      const x = r.rows?.[0];
      if (!x) return null;
      const done = x.status === 'completed';
      // B-18: a job completed since migration 677 holds a private-store key; the content is read back in the row's encoding
      const bytes = done ? await loadExportBytes(this.store, x.content_key, { base64: String(x.encoding ?? '').toLowerCase() === 'base64' ? x.content : null, text: String(x.encoding ?? '').toLowerCase() === 'base64' ? null : x.content }) : null;
      const content = bytes ? (String(x.encoding ?? '').toLowerCase() === 'base64' ? bytes.toString('base64') : bytes.toString('utf8')) : null;
      return {
        id: String(x.id), dataset: x.dataset, format: x.format, status: x.status, rowCount: n(x.row_count), error: x.error ?? null,
        filename: done ? x.filename : null, mime: done ? x.mime : null, encoding: done ? x.encoding : null, content,
        createdAt: x.created_at ?? null, completedAt: x.completed_at ?? null,
      };
    } catch { return null; }
  }

  async listExportJobs(limit = 20): Promise<any[]> {
    const lim = Math.min(100, Math.max(1, limit));
    try {
      const r: any = await sql<any>`select id::text as id, dataset, format, status, row_count, filename, error,
        to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') as created_at, to_char(completed_at,'YYYY-MM-DD"T"HH24:MI:SS') as completed_at
        from revenue_export_jobs order by created_at desc, id desc limit ${lim}`.execute(this.db);
      return (r.rows ?? []).map((x: any) => ({ id: String(x.id), dataset: x.dataset, format: x.format, status: x.status, rowCount: n(x.row_count), filename: x.filename ?? null, error: x.error ?? null, createdAt: x.created_at ?? null, completedAt: x.completed_at ?? null }));
    } catch { return []; }
  }
}
