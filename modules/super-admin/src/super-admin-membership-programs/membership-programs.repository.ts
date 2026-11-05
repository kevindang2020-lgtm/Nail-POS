// membership-programs.repository.ts — READ-ONLY, cross-tenant platform oversight aggregation for the Super Admin
// "Membership Programs" screen. Reads the canonical membership tables the tenant engine writes (membership_plans/_versions,
// customer_memberships, membership_payments, membership_credit_ledger, membership_benefits, membership_activity). Money is
// integer cents. Never re-implements billing. Concepts not yet modeled (suspicious/duplicate, support cases) return 0
// honestly. With no DB it returns an all-zero overview (no fabricated data).
import { Kysely, sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { detectDuplicates, detectSuspicious, type ChargeRow, type MembershipRow } from './membership-actions-core';
import { toCsv, programToExportRecord, selectColumns, REPORTS, billingFailureToRecord, cancellationToRecord, revenueTenantToRecord, suspiciousToRecord } from './membership-export-core';
import { computeTrend, KPI_POLARITY } from './membership-trend-core';
import { writeSupportAccessNotice } from '../support-mode/support-access-notice';
import { canMoveToSql } from '@aipowersalon/database';
import { MEMBERSHIP_TEMPLATE } from '../lifecycles';
import { MEMBERSHIP_PLAN } from '@aipowersalon/memberships';

const n = (v: unknown): number => (v == null ? 0 : Number(v) || 0);

export interface ProgramsKpis {
  totalPrograms: number; activeMembers: number; pausedMembers: number; cancelledMembers: number; pastDueMembers: number;
  trialMembers: number; mrrCents: number; failedPayments: number; benefitsIssued: number; benefitsRedeemed: number;
  unusedCredits: number; expiringCredits: number; tenantParticipation: { active: number; total: number };
  branchParticipation: { active: number; total: number }; suspiciousCount: number;
}
export interface ProgramsOverview {
  kpis: ProgramsKpis;
  kpiTrends: Record<string, { deltaPct: number | null; favorable: boolean | null }>;
  programMix: { type: string; count: number }[];
  statusBreakdown: { status: string; count: number }[];
  revenueTrend: { date: string; cents: number }[];
  membersVsRedeemed: { date: string; members: number; redeemed: number }[];
  topPrograms: { planId: string; name: string; type: string; activeMembers: number; priceCents: number; includedBenefits: number; redemptionRatePct: number; revenueCents: number; status: string }[];
  tenantPerformance: { tenantId: string; tenant: string; activePrograms: number; members: number; mrrCents: number; billingFailures: number; pauseRatePct: number; status: string }[];
  billingFailures: { tenantProgram: string; issue: string; severity: string; status: string; at: string | null }[];
  atAGlance: { newMembersToday: number; revenueTodayCents: number; failedPaymentsToday: number; benefitsRedeemedToday: number; expiringCreditsToday: number; supportCasesOpen: number };
}

const ACTIVE_STATUSES = "('active','paused','past_due','trial')";

export interface MembershipControls {
  enabledGlobally: boolean;
  planGating: Record<string, boolean>;
  limits: Record<string, number>;
  rules: any;
  plans: { code: string; name: string }[];
  templates: { id: string; name: string; description: string | null; productType: string; billingInterval: string; intervalCount: number; priceCents: number; trialDays: number; benefits: any[]; status: string; version: number; updatedAt: string }[];
}
export type MPAuditActor = { userId?: string | null; role?: string | null };

export class MembershipProgramsRepository {
  constructor(private readonly db: Kysely<DB> | null) {}

  async overview(): Promise<ProgramsOverview> {
    if (!this.db) return zero();

    const kpiQ: any = await sql`
      SELECT
        (SELECT COUNT(*) FROM membership_plans WHERE status='active')::int AS total_programs,
        COUNT(*) FILTER (WHERE cm.status='active')::int  AS active_members,
        COUNT(*) FILTER (WHERE cm.status='paused')::int  AS paused_members,
        COUNT(*) FILTER (WHERE cm.status='cancelled')::int AS cancelled_members,
        COUNT(*) FILTER (WHERE cm.status='past_due')::int AS pastdue_members,
        COUNT(*) FILTER (WHERE cm.status='trial')::int   AS trial_members
      FROM customer_memberships cm`.execute(this.db).catch(() => ({ rows: [{}] }));
    const k = kpiQ.rows[0] ?? {};

    const mrrQ: any = await sql`
      SELECT COALESCE(SUM(pv.price_cents),0) AS mrr FROM customer_memberships cm
      JOIN membership_plan_versions pv ON pv.id = cm.plan_version_id
      WHERE cm.status IN ('active','past_due')`.execute(this.db).catch(() => ({ rows: [{}] }));

    const payQ: any = await sql`
      SELECT COUNT(*) FILTER (WHERE status='failed')::int AS failed FROM membership_payments`.execute(this.db).catch(() => ({ rows: [{}] }));

    const credQ: any = await sql`
      SELECT
        COUNT(*) FILTER (WHERE entry_type='issued')::int AS issued,
        COUNT(*) FILTER (WHERE entry_type='redeemed')::int AS redeemed,
        GREATEST(COALESCE(SUM(quantity) FILTER (WHERE entry_type='issued'),0) - COALESCE(SUM(quantity) FILTER (WHERE entry_type='redeemed'),0), 0)::int AS unused,
        COUNT(*) FILTER (WHERE entry_type='issued' AND expires_at IS NOT NULL AND expires_at <= now() + interval '30 days' AND expires_at > now())::int AS expiring
      FROM membership_credit_ledger`.execute(this.db).catch(() => ({ rows: [{}] }));
    const c = credQ.rows[0] ?? {};

    const partQ: any = await sql`
      SELECT
        (SELECT COUNT(DISTINCT tenant_id) FROM membership_plans WHERE status='active')::int AS active_tenants,
        (SELECT COUNT(*) FROM tenants)::int AS total_tenants,
        (SELECT COUNT(DISTINCT branch_id) FROM membership_plans WHERE status='active' AND branch_id IS NOT NULL)::int AS active_branches,
        (SELECT COUNT(*) FROM branches)::int AS total_branches`.execute(this.db).catch(() => ({ rows: [{}] }));
    const p = partQ.rows[0] ?? {};

    const mixQ: any = await sql`
      SELECT product_type AS type, COUNT(*)::int AS count FROM membership_plans WHERE status='active' GROUP BY product_type ORDER BY count DESC`.execute(this.db).catch(() => ({ rows: [] }));
    const statusQ: any = await sql`
      SELECT status, COUNT(*)::int AS count FROM customer_memberships GROUP BY status ORDER BY count DESC`.execute(this.db).catch(() => ({ rows: [] }));

    const revTrendQ: any = await sql`
      SELECT to_char(date_trunc('day', settled_at), 'Mon DD') AS date, COALESCE(SUM(amount_cents),0) AS cents
      FROM membership_payments WHERE status='succeeded' AND settled_at >= now() - interval '7 days'
      GROUP BY 1, date_trunc('day', settled_at) ORDER BY date_trunc('day', settled_at)`.execute(this.db).catch(() => ({ rows: [] }));
    const mvrQ: any = await sql`
      WITH days AS (SELECT generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') AS d)
      SELECT to_char(days.d, 'Mon DD') AS date,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE date_trunc('day', cm.started_at) = days.d)::int AS members,
        (SELECT COUNT(*) FROM membership_credit_ledger cl WHERE cl.entry_type='redeemed' AND date_trunc('day', cl.created_at) = days.d)::int AS redeemed
      FROM days ORDER BY days.d`.execute(this.db).catch(() => ({ rows: [] }));

    const topQ: any = await sql`
      SELECT mp.id AS plan_id, mp.name, mp.product_type AS type, mp.status,
        COALESCE(pv.price_cents,0) AS price_cents,
        (SELECT COUNT(*) FROM membership_benefits mb WHERE mb.plan_version_id = mp.current_version_id)::int AS benefits,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.plan_id = mp.id AND cm.status='active')::int AS active_members,
        (SELECT COALESCE(SUM(amount_cents),0) FROM membership_payments mpay WHERE mpay.customer_membership_id IN (SELECT id FROM customer_memberships WHERE plan_id = mp.id) AND mpay.status='succeeded') AS revenue,
        (SELECT COUNT(*) FROM membership_credit_ledger cl WHERE cl.customer_membership_id IN (SELECT id FROM customer_memberships WHERE plan_id = mp.id) AND cl.entry_type='redeemed')::int AS redeemed,
        (SELECT COUNT(*) FROM membership_credit_ledger cl WHERE cl.customer_membership_id IN (SELECT id FROM customer_memberships WHERE plan_id = mp.id) AND cl.entry_type='issued')::int AS issued
      FROM membership_plans mp LEFT JOIN membership_plan_versions pv ON pv.id = mp.current_version_id
      WHERE mp.status='active' ORDER BY revenue DESC LIMIT 5`.execute(this.db).catch(() => ({ rows: [] }));

    const tenantQ: any = await sql`
      SELECT t.id AS tenant_id, COALESCE(t.display_name, t.legal_name, t.id::text) AS tenant,
        (SELECT COUNT(*) FROM membership_plans mp WHERE mp.tenant_id = t.id AND mp.status='active')::int AS active_programs,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.tenant_id = t.id)::int AS members,
        (SELECT COALESCE(SUM(pv.price_cents),0) FROM customer_memberships cm JOIN membership_plan_versions pv ON pv.id = cm.plan_version_id WHERE cm.tenant_id = t.id AND cm.status IN ('active','past_due')) AS mrr,
        (SELECT COUNT(*) FROM membership_payments mpay WHERE mpay.tenant_id = t.id AND mpay.status='failed')::int AS billing_failures,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.tenant_id = t.id AND cm.status='paused')::int AS paused,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.tenant_id = t.id)::int AS total_members
      FROM tenants t WHERE EXISTS (SELECT 1 FROM membership_plans mp WHERE mp.tenant_id = t.id)
      ORDER BY mrr DESC`.execute(this.db).catch(() => ({ rows: [] }));

    const failQ: any = await sql`
      SELECT COALESCE(tn.display_name, tn.legal_name) AS tenant, mp.name AS program, mpay.failure_reason AS issue, mpay.created_at AS at
      FROM membership_payments mpay
      JOIN customer_memberships cm ON cm.id = mpay.customer_membership_id
      JOIN membership_plans mp ON mp.id = cm.plan_id
      JOIN tenants tn ON tn.id = mpay.tenant_id
      WHERE mpay.status='failed' ORDER BY mpay.created_at DESC LIMIT 8`.execute(this.db).catch(() => ({ rows: [] }));

    const glanceQ: any = await sql`
      SELECT
        (SELECT COUNT(*) FROM customer_memberships WHERE date_trunc('day', started_at)=date_trunc('day', now()))::int AS new_members,
        (SELECT COALESCE(SUM(amount_cents),0) FROM membership_payments WHERE status='succeeded' AND date_trunc('day', settled_at)=date_trunc('day', now())) AS revenue,
        (SELECT COUNT(*) FROM membership_payments WHERE status='failed' AND date_trunc('day', created_at)=date_trunc('day', now()))::int AS failed,
        (SELECT COUNT(*) FROM membership_credit_ledger WHERE entry_type='redeemed' AND date_trunc('day', created_at)=date_trunc('day', now()))::int AS redeemed,
        (SELECT COUNT(*) FROM membership_credit_ledger WHERE entry_type='issued' AND expires_at IS NOT NULL AND date_trunc('day', expires_at)=date_trunc('day', now()))::int AS expiring`.execute(this.db).catch(() => ({ rows: [{}] }));
    const g = glanceQ.rows[0] ?? {};

    const kpis = {
      totalPrograms: n(k.total_programs), activeMembers: n(k.active_members), pausedMembers: n(k.paused_members),
      cancelledMembers: n(k.cancelled_members), pastDueMembers: n(k.pastdue_members), trialMembers: n(k.trial_members),
      mrrCents: n(mrrQ.rows[0]?.mrr), failedPayments: n(payQ.rows[0]?.failed), benefitsIssued: n(c.issued),
      benefitsRedeemed: n(c.redeemed), unusedCredits: n(c.unused), expiringCredits: n(c.expiring),
      tenantParticipation: { active: n(p.active_tenants), total: n(p.total_tenants) },
      branchParticipation: { active: n(p.active_branches), total: n(p.total_branches) },
      suspiciousCount: await this.countSuspicious(),
    };
    const prior = await this.latestPriorSnapshot();
    const currentVals: Record<string, number> = {
      ...kpis, tenantParticipation: kpis.tenantParticipation.active, branchParticipation: kpis.branchParticipation.active,
    } as any;
    const kpiTrends: Record<string, { deltaPct: number | null; favorable: boolean | null }> = {};
    for (const key of Object.keys(KPI_POLARITY)) kpiTrends[key] = computeTrend(key, currentVals[key] ?? 0, prior[key]);

    return {
      kpis, kpiTrends,
      programMix: (mixQ.rows as any[]).map((r) => ({ type: String(r.type ?? 'other'), count: n(r.count) })),
      statusBreakdown: (statusQ.rows as any[]).map((r) => ({ status: String(r.status), count: n(r.count) })),
      revenueTrend: (revTrendQ.rows as any[]).map((r) => ({ date: String(r.date), cents: n(r.cents) })),
      membersVsRedeemed: (mvrQ.rows as any[]).map((r) => ({ date: String(r.date), members: n(r.members), redeemed: n(r.redeemed) })),
      topPrograms: (topQ.rows as any[]).map((r) => ({
        planId: String(r.plan_id), name: String(r.name), type: String(r.type ?? 'other'), activeMembers: n(r.active_members),
        priceCents: n(r.price_cents), includedBenefits: n(r.benefits), redemptionRatePct: n(r.issued) > 0 ? Math.round((n(r.redeemed) / n(r.issued)) * 1000) / 10 : 0,
        revenueCents: n(r.revenue), status: String(r.status),
      })),
      tenantPerformance: (tenantQ.rows as any[]).map((r) => {
        const paused = n(r.paused), total = n(r.total_members);
        const pauseRate = total > 0 ? Math.round((paused / total) * 1000) / 10 : 0;
        const fails = n(r.billing_failures);
        const status = fails >= 3 ? 'At Risk' : fails >= 1 ? 'Watch' : n(r.members) >= 10 ? 'Strong' : 'Healthy';
        return { tenantId: String(r.tenant_id), tenant: String(r.tenant), activePrograms: n(r.active_programs), members: total, mrrCents: n(r.mrr), billingFailures: fails, pauseRatePct: pauseRate, status };
      }),
      billingFailures: (failQ.rows as any[]).map((r) => {
        const issue = String(r.issue ?? 'Failed recurring payment').replace(/_/g, ' ');
        const severity = /declined|invalid|fraud/i.test(issue) ? 'High' : /timeout|unavailable/i.test(issue) ? 'Medium' : 'Low';
        return { tenantProgram: `${r.tenant ?? ''} / ${r.program ?? ''}`, issue, severity, status: 'Retry Pending', at: r.at ? new Date(r.at).toISOString() : null };
      }),
      atAGlance: {
        newMembersToday: n(g.new_members), revenueTodayCents: n(g.revenue), failedPaymentsToday: n(g.failed),
        benefitsRedeemedToday: n(g.redeemed), expiringCreditsToday: n(g.expiring), supportCasesOpen: 0,
      },
    };
  }

  async getControls(): Promise<MembershipControls> {
    if (!this.db) return { enabledGlobally: true, planGating: {}, limits: {}, rules: {}, plans: [], templates: [] };
    const cfg: any = await sql`SELECT enabled_globally, plan_gating, limits, rules FROM membership_platform_config WHERE singleton = true LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const c = cfg.rows[0] ?? {};
    const plansQ: any = await sql`SELECT code, name FROM subscription_plans WHERE status='active' OR status IS NULL ORDER BY display_order NULLS LAST, code`.execute(this.db).catch(() => ({ rows: [] }));
    const tplQ: any = await sql`SELECT id, name, description, product_type, billing_interval, interval_count, price_cents, trial_days, benefits, status, version, updated_at FROM membership_templates WHERE status <> 'archived' ORDER BY updated_at DESC`.execute(this.db).catch(() => ({ rows: [] }));
    return {
      enabledGlobally: c.enabled_globally ?? true,
      planGating: c.plan_gating ?? {}, limits: c.limits ?? {}, rules: c.rules ?? {},
      plans: (plansQ.rows as any[]).map((p) => ({ code: String(p.code), name: String(p.name) })),
      templates: (tplQ.rows as any[]).map((t) => ({ id: String(t.id), name: String(t.name), description: t.description ?? null, productType: String(t.product_type), billingInterval: String(t.billing_interval), intervalCount: n(t.interval_count), priceCents: n(t.price_cents), trialDays: n(t.trial_days), benefits: Array.isArray(t.benefits) ? t.benefits : [], status: String(t.status), version: n(t.version), updatedAt: new Date(t.updated_at).toISOString() })),
    };
  }

  async patchConfig(actor: MPAuditActor, patch: { enabledGlobally?: boolean; planGating?: Record<string, boolean>; limits?: Record<string, number>; rules?: any }, action: string): Promise<void> {
    if (!this.db) return;
    const sets: any[] = [];
    if (patch.enabledGlobally !== undefined) sets.push(sql`enabled_globally = ${patch.enabledGlobally}`);
    if (patch.planGating !== undefined) sets.push(sql`plan_gating = ${JSON.stringify(patch.planGating)}::jsonb`);
    if (patch.limits !== undefined) sets.push(sql`limits = ${JSON.stringify(patch.limits)}::jsonb`);
    if (patch.rules !== undefined) sets.push(sql`rules = ${JSON.stringify(patch.rules)}::jsonb`);
    if (sets.length === 0) return;
    sets.push(sql`updated_by_user_id = ${actor.userId ?? null}`); sets.push(sql`updated_at = now()`);
    await sql`UPDATE membership_platform_config SET ${sql.join(sets, sql`, `)} WHERE singleton = true`.execute(this.db);
    await this.writeAudit(actor, action, 'platform', patch);
  }

  async createTemplate(actor: MPAuditActor, t: any): Promise<{ id: string }> {
    if (!this.db) return { id: 'stub' };
    const r: any = await sql`
      INSERT INTO membership_templates (name, description, product_type, billing_interval, interval_count, price_cents, trial_days, benefits, status, created_by_user_id)
      VALUES (${t.name}, ${t.description}, ${t.productType}, ${t.billingInterval}, ${t.intervalCount}, ${t.priceCents}, ${t.trialDays}, ${JSON.stringify(t.benefits)}::jsonb, ${t.status ?? 'draft'}, ${actor.userId ?? null})
      RETURNING id`.execute(this.db);
    const id = String(r.rows[0].id);
    await this.writeAudit(actor, 'membership.template.created', id, { name: t.name, status: t.status ?? 'draft' });
    return { id };
  }

  async updateTemplate(actor: MPAuditActor, id: string, t: any, status?: string): Promise<boolean> {
    if (!this.db) return false;
    const r: any = await sql`
      UPDATE membership_templates SET name = ${t.name}, description = ${t.description}, product_type = ${t.productType},
        billing_interval = ${t.billingInterval}, interval_count = ${t.intervalCount}, price_cents = ${t.priceCents},
        trial_days = ${t.trialDays}, benefits = ${JSON.stringify(t.benefits)}::jsonb,
        status = COALESCE(${status ?? null}, status), version = version + 1, updated_at = now()
      WHERE id = ${id} AND ${status ? canMoveToSql(MEMBERSHIP_TEMPLATE, status) : sql`true`} RETURNING id`.execute(this.db).catch(() => ({ rows: [] }));
    if (r.rows.length === 0) return false;
    await this.writeAudit(actor, 'membership.template.updated', id, { name: t.name, status });
    return true;
  }

  // ---- Unit 4: sensitive tenant-oversight actions ----

  async listDuplicateCharges(): Promise<any[]> {
    if (!this.db) return [];
    const q: any = await sql`
      SELECT p.id, p.customer_membership_id AS membership_id, p.amount_cents, p.status, p.created_at,
        cm.member_number, mp.name AS program, COALESCE(t.display_name, t.legal_name) AS tenant
      FROM membership_payments p
      JOIN customer_memberships cm ON cm.id = p.customer_membership_id
      JOIN membership_plans mp ON mp.id = cm.plan_id
      JOIN tenants t ON t.id = p.tenant_id
      WHERE p.status='succeeded' ORDER BY p.created_at`.execute(this.db).catch(() => ({ rows: [] }));
    const rows: ChargeRow[] = (q.rows as any[]).map((r) => ({ id: String(r.id), membershipId: String(r.membership_id), amountCents: n(r.amount_cents), status: String(r.status), createdAt: new Date(r.created_at).toISOString(), tenant: r.tenant ?? undefined, program: r.program ?? undefined, memberNumber: r.member_number ?? null }));
    return detectDuplicates(rows).map((c) => ({ ...c, amountLabel: c.amountCents }));
  }

  async programImpact(planId: string): Promise<any | null> {
    if (!this.db) return null;
    const q: any = await sql`
      SELECT mp.id, mp.name, mp.status, COALESCE(t.display_name, t.legal_name) AS tenant,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.plan_id=mp.id AND cm.status='active')::int AS active,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.plan_id=mp.id AND cm.status='trial')::int AS trial,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.plan_id=mp.id AND cm.status='past_due')::int AS past_due,
        (SELECT COALESCE(SUM(pv.price_cents),0) FROM customer_memberships cm JOIN membership_plan_versions pv ON pv.id=cm.plan_version_id WHERE cm.plan_id=mp.id AND cm.status IN ('active','past_due')) AS mrr,
        (SELECT COUNT(*) FROM membership_credit_ledger cl WHERE cl.customer_membership_id IN (SELECT id FROM customer_memberships WHERE plan_id=mp.id) AND cl.entry_type='issued')::int AS credits_issued
      FROM membership_plans mp JOIN tenants t ON t.id=mp.tenant_id WHERE mp.id=${planId}`.execute(this.db).catch(() => ({ rows: [] }));
    const r = q.rows[0]; if (!r) return null;
    return { planId: String(r.id), name: String(r.name), status: String(r.status), tenant: String(r.tenant), activeMembers: n(r.active), trialMembers: n(r.trial), pastDueMembers: n(r.past_due), mrrCents: n(r.mrr), creditsIssued: n(r.credits_issued) };
  }

  async disableProgram(actor: MPAuditActor, planId: string, reason: string): Promise<boolean> {
    if (!this.db) return false;
    const impact = await this.programImpact(planId);
    if (!impact) return false;
    // Stop new enrollment by disabling the plan. History (memberships, payments, credits) is preserved untouched.
    const r: any = await sql`UPDATE membership_plans SET status='disabled', updated_at=now() WHERE id=${planId} AND ${canMoveToSql(MEMBERSHIP_PLAN, 'disabled')} RETURNING id`.execute(this.db).catch(() => ({ rows: [] }));
    if (r.rows.length === 0) return false;
    await this.writeAudit(actor, 'membership.program.disabled', planId, { reason, impact });
    return true;
  }

  // Compensating credit-ledger entry. NEVER mutates existing rows; a credit adds, a debit reverses, both with a reason
  // and a linkage note. Preserves full history.
  async createCorrection(actor: MPAuditActor, c: { membershipId: string; direction: 'credit' | 'debit'; quantity: number; amountCents: number; reason: string }): Promise<{ ok: boolean; notFound?: boolean; entryId?: string }> {
    if (!this.db) return { ok: false };
    const exists: any = await sql`SELECT tenant_id FROM customer_memberships WHERE id=${c.membershipId}`.execute(this.db).catch(() => ({ rows: [] }));
    if (exists.rows.length === 0) return { ok: false, notFound: true };
    const tenantId = String(exists.rows[0].tenant_id);
    const entryType = c.direction === 'credit' ? 'issued' : 'reversed';
    const ins: any = await sql`
      INSERT INTO membership_credit_ledger (tenant_id, customer_membership_id, entry_type, quantity, amount_cents, reason, created_by_user_id, created_at)
      VALUES (${tenantId}, ${c.membershipId}, ${entryType}, ${c.quantity}, ${c.amountCents}, ${'platform_correction: ' + c.reason}, ${actor.userId ?? null}, now())
      RETURNING id`.execute(this.db);
    const entryId = String(ins.rows[0].id);
    await this.writeAudit(actor, 'membership.correction.created', entryId, { membershipId: c.membershipId, direction: c.direction, quantity: c.quantity, amountCents: c.amountCents, reason: c.reason });
    return { ok: true, entryId };
  }

  // ---- Unit 5: suspicious/duplicate membership review + audited support mode ----

  // ---- Unit 6/7: filter-aware, audited CSV export (no card/customer-contact data) ----
  async exportProgramsCsv(actor: MPAuditActor, f: { tenantId?: string; status?: string; productType?: string; columns?: string[] }): Promise<{ filename: string; csv: string; rowCount: number }> {
    const rows = await this.listPrograms({ tenantId: f.tenantId, status: f.status, productType: f.productType });
    const columns = selectColumns(f.columns);
    const csv = toCsv(columns, rows.map((r) => programToExportRecord({ name: r.name, tenantName: r.tenantName, productType: r.productType, billingInterval: r.billingInterval, priceCents: r.priceCents, activeMembers: r.activeMembers, totalMembers: r.totalMembers, revenueCents: r.revenueCents, status: r.status })));
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await this.writeAudit(actor, 'membership.report.exported', 'platform', { report: 'programs', rowCount: rows.length, columns: columns.map((c) => c.key), filters: { tenantId: f.tenantId ?? null, status: f.status ?? null, productType: f.productType ?? null } });
    return { filename: `membership-programs-${stamp}.csv`, csv, rowCount: rows.length };
  }

  // Any of the §54 report types → a safe, filter-aware, audited CSV. Unknown report falls back to the program directory.
  async exportReportCsv(actor: MPAuditActor, report: string, f: { tenantId?: string; status?: string; productType?: string }): Promise<{ filename: string; csv: string; rowCount: number }> {
    if (!REPORTS[report] || report === 'programs') return this.exportProgramsCsv(actor, f);
    let records: Record<string, string>[] = [];
    if (report === 'billing-failures') records = (await this.listBillingFailures()).map(billingFailureToRecord);
    else if (report === 'cancellations') records = (await this.listCancellationsPauses()).map(cancellationToRecord);
    else if (report === 'revenue') records = (await this.revenueBreakdown()).byTenant.map(revenueTenantToRecord);
    else if (report === 'suspicious') records = (await this.listSuspicious()).map(suspiciousToRecord);
    const columns = REPORTS[report].columns;
    const csv = toCsv(columns, records);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    await this.writeAudit(actor, 'membership.report.exported', 'platform', { report, rowCount: records.length, columns: columns.map((c) => c.key) });
    return { filename: `membership-${report}-${stamp}.csv`, csv, rowCount: records.length };
  }

  // ---- KPI click-through drill-downs (read-only; member_number is a non-PII identifier) ----
  async listMembers(f: { status?: string; tenantId?: string }): Promise<any[]> {
    if (!this.db) return [];
    const where: any[] = [sql`1=1`];
    if (f.status) where.push(sql`cm.status = ${f.status}`);
    if (f.tenantId) where.push(sql`cm.tenant_id = ${f.tenantId}`);
    const q: any = await sql`
      SELECT cm.member_number, cm.status, cm.started_at, cm.next_billing_at, cm.current_period_end,
        mp.name AS program, COALESCE(t.display_name, t.legal_name) AS tenant
      FROM customer_memberships cm JOIN membership_plans mp ON mp.id = cm.plan_id JOIN tenants t ON t.id = cm.tenant_id
      WHERE ${sql.join(where, sql` AND `)} ORDER BY cm.started_at DESC LIMIT 200`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map((r) => ({ memberNumber: r.member_number ?? '—', tenant: String(r.tenant ?? ''), program: String(r.program ?? ''), status: String(r.status), startedAt: r.started_at ? new Date(r.started_at).toISOString() : null, nextBillingAt: r.next_billing_at ? new Date(r.next_billing_at).toISOString() : null }));
  }

  async creditsSummary(): Promise<any[]> {
    if (!this.db) return [];
    const q: any = await sql`
      SELECT mp.name AS program, COALESCE(t.display_name, t.legal_name) AS tenant,
        COUNT(*) FILTER (WHERE cl.entry_type='issued')::int AS issued,
        COUNT(*) FILTER (WHERE cl.entry_type='redeemed')::int AS redeemed,
        GREATEST(COUNT(*) FILTER (WHERE cl.entry_type='issued') - COUNT(*) FILTER (WHERE cl.entry_type='redeemed'), 0)::int AS unused,
        COUNT(*) FILTER (WHERE cl.entry_type='issued' AND cl.expires_at IS NOT NULL AND cl.expires_at <= now() + interval '30 days' AND cl.expires_at > now())::int AS expiring
      FROM membership_credit_ledger cl
      JOIN customer_memberships cm ON cm.id = cl.customer_membership_id
      JOIN membership_plans mp ON mp.id = cm.plan_id JOIN tenants t ON t.id = cm.tenant_id
      GROUP BY mp.id, mp.name, t.display_name, t.legal_name ORDER BY issued DESC`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map((r) => ({ program: String(r.program), tenant: String(r.tenant), issued: n(r.issued), redeemed: n(r.redeemed), unused: n(r.unused), expiring: n(r.expiring) }));
  }

  // Latest KPI snapshot strictly before today, as a flat {key: value} map (empty if none → trends render neutral).
  async latestPriorSnapshot(): Promise<Record<string, number>> {
    if (!this.db) return {};
    const q: any = await sql`
      SELECT kpi_key, value_num FROM membership_kpi_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM membership_kpi_snapshots WHERE snapshot_date < current_date)`.execute(this.db).catch(() => ({ rows: [] }));
    const out: Record<string, number> = {};
    for (const r of q.rows as any[]) out[String(r.kpi_key)] = n(r.value_num);
    return out;
  }

  // Production job path: write today's KPI values as a snapshot (idempotent per day/key). Not called on read.
  async snapshotToday(): Promise<void> {
    if (!this.db) return;
    const ov = await this.overview();
    const flat: Record<string, number> = { ...ov.kpis, tenantParticipation: ov.kpis.tenantParticipation.active, branchParticipation: ov.kpis.branchParticipation.active } as any;
    for (const key of Object.keys(KPI_POLARITY)) {
      await sql`INSERT INTO membership_kpi_snapshots (snapshot_date, kpi_key, value_num) VALUES (current_date, ${key}, ${flat[key] ?? 0})
        ON CONFLICT (snapshot_date, kpi_key) DO UPDATE SET value_num = EXCLUDED.value_num`.execute(this.db).catch(() => {});
    }
  }

  async countSuspicious(): Promise<number> {
    if (!this.db) return 0;
    return (await this.listSuspicious()).length;
  }

  async listSuspicious(): Promise<any[]> {
    if (!this.db) return [];
    // Signal 1: a customer holding 2+ active memberships (duplicate/abuse), via the pure detector.
    const q: any = await sql`
      SELECT cm.id AS membership_id, cm.customer_id, cm.plan_id, cm.status,
        mp.name AS program, COALESCE(t.display_name, t.legal_name) AS tenant,
        COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name) AS customer_name
      FROM customer_memberships cm
      JOIN membership_plans mp ON mp.id = cm.plan_id
      JOIN tenants t ON t.id = cm.tenant_id
      LEFT JOIN customers c ON c.id = cm.customer_id
      WHERE cm.status='active'`.execute(this.db).catch(() => ({ rows: [] }));
    const rows: MembershipRow[] = (q.rows as any[]).map((r) => ({ membershipId: String(r.membership_id), customerId: String(r.customer_id), planId: String(r.plan_id), status: String(r.status), tenant: r.tenant ?? undefined, program: r.program ?? undefined, customerName: r.customer_name ?? null }));
    const cases: any[] = detectSuspicious(rows);
    // Signals 2-4: credit-ledger anomalies (SQL, since they join ledger↔membership↔payments).
    cases.push(...await this.ledgerSignals());
    return cases;
  }

  // Ledger-based suspicious signals, each investigation-only. Excludes trials/comped where a legitimately unpaid credit is expected.
  private async ledgerSignals(): Promise<any[]> {
    if (!this.db) return [];
    const mk = (type: string, severity: string) => (r: any) => ({ type, customerId: String(r.customer_id ?? ''), customerName: r.customer_name ?? null, membershipIds: [String(r.membership_id)], count: n(r.n) || 1, severity, tenant: r.tenant ?? undefined });
    const nameSel = sql`COALESCE(c.first_name || ' ' || c.last_name, c.first_name, c.last_name) AS customer_name`;
    const pastDueQ: any = await sql`
      SELECT cm.id AS membership_id, cm.customer_id, COALESCE(t.display_name,t.legal_name) AS tenant, ${nameSel}, COUNT(*)::int AS n
      FROM membership_credit_ledger cl JOIN customer_memberships cm ON cm.id=cl.customer_membership_id
      JOIN tenants t ON t.id=cm.tenant_id LEFT JOIN customers c ON c.id=cm.customer_id
      WHERE cl.entry_type='redeemed' AND cm.status='past_due'
      GROUP BY cm.id, cm.customer_id, t.display_name, t.legal_name, c.first_name, c.last_name`.execute(this.db).catch(() => ({ rows: [] }));
    const afterCancelQ: any = await sql`
      SELECT cm.id AS membership_id, cm.customer_id, COALESCE(t.display_name,t.legal_name) AS tenant, ${nameSel}, COUNT(*)::int AS n
      FROM membership_credit_ledger cl JOIN customer_memberships cm ON cm.id=cl.customer_membership_id
      JOIN tenants t ON t.id=cm.tenant_id LEFT JOIN customers c ON c.id=cm.customer_id
      WHERE cl.entry_type='redeemed' AND cm.canceled_at IS NOT NULL AND cl.created_at > cm.canceled_at
      GROUP BY cm.id, cm.customer_id, t.display_name, t.legal_name, c.first_name, c.last_name`.execute(this.db).catch(() => ({ rows: [] }));
    const noPayQ: any = await sql`
      SELECT cm.id AS membership_id, cm.customer_id, COALESCE(t.display_name,t.legal_name) AS tenant, ${nameSel}, COUNT(*)::int AS n
      FROM membership_credit_ledger cl JOIN customer_memberships cm ON cm.id=cl.customer_membership_id
      JOIN tenants t ON t.id=cm.tenant_id LEFT JOIN customers c ON c.id=cm.customer_id
      WHERE cl.entry_type='issued' AND cm.status NOT IN ('trial') AND cm.comped IS NOT TRUE
        AND NOT EXISTS (SELECT 1 FROM membership_payments p WHERE p.customer_membership_id=cm.id AND p.status='succeeded')
      GROUP BY cm.id, cm.customer_id, t.display_name, t.legal_name, c.first_name, c.last_name`.execute(this.db).catch(() => ({ rows: [] }));
    return [
      ...(pastDueQ.rows as any[]).map(mk('benefit_redeemed_while_past_due', 'high')),
      ...(afterCancelQ.rows as any[]).map(mk('benefit_redeemed_after_cancel', 'high')),
      ...(noPayQ.rows as any[]).map(mk('credit_issued_without_payment', 'medium')),
    ];
  }

  /**
   * Constitution 7 — ONE Support Mode store. Opened here, a session is a support_access_sessions row like every other
   * entry (so the SUPPORT MODE banner shows it, the owner is told in the same transaction, it can be extended under the same
   * cap and ended from the banner). membership_support_sessions was merged into it and dropped (migration 541).
   * Scope: 'read_only' → READ_ONLY, 'assist' → STANDARD_SUPPORT.
   */
  async openSupportSession(actor: MPAuditActor, s: { tenantId: string; reason: string; durationMinutes: number; accessLevel: string }): Promise<{ id: string; expiresAt: string; tenant: string }> {
    if (!this.db) return { id: 'stub', expiresAt: new Date().toISOString(), tenant: '' };
    const scope = s.accessLevel === 'assist' ? 'STANDARD_SUPPORT' : 'READ_ONLY';
    const out = await this.db.transaction().execute(async (trx: any) => {
      const r: any = await sql`
        INSERT INTO support_access_sessions (tenant_id, admin_user_id, admin_email, reason, scope, expires_at)
        VALUES (${s.tenantId}, ${actor.userId ?? null}, ${(actor as any).email ?? null}, ${s.reason}, ${scope}, now() + (${s.durationMinutes} * interval '1 minute'))
        RETURNING id, expires_at`.execute(trx);
      await writeSupportAccessNotice(trx, { tenantId: s.tenantId, sessionId: String(r.rows[0].id), reason: s.reason, scope, expiresAt: r.rows[0].expires_at });
      return r.rows[0];
    });
    const tn: any = await sql`SELECT COALESCE(display_name, legal_name) AS name FROM tenants WHERE id=${s.tenantId}`.execute(this.db).catch(() => ({ rows: [{}] }));
    const id = String(out.id);
    await this.writeAudit(actor, 'membership.support_mode.entered', id, { tenantId: s.tenantId, reason: s.reason, accessLevel: s.accessLevel, scope, durationMinutes: s.durationMinutes });
    return { id, expiresAt: new Date(out.expires_at).toISOString(), tenant: String(tn.rows[0]?.name ?? '') };
  }

  /** The CALLER's current live Support Mode session (from the one store) — never another administrator's. */
  async activeSupportSession(actor?: MPAuditActor): Promise<any | null> {
    if (!this.db || !actor?.userId) return null;
    const q: any = await sql`
      SELECT s.id, s.tenant_id, s.reason, s.scope, s.started_at, s.expires_at, COALESCE(t.display_name, t.legal_name) AS tenant
      FROM support_access_sessions s JOIN tenants t ON t.id = s.tenant_id
      WHERE s.admin_user_id = ${actor.userId} AND s.ended_at IS NULL AND s.expires_at > now() ORDER BY s.started_at DESC LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const r = q.rows[0]; if (!r) return null;
    return { id: String(r.id), tenantId: String(r.tenant_id), tenant: String(r.tenant), reason: String(r.reason), accessLevel: r.scope === 'READ_ONLY' ? 'read_only' : 'assist',
      openedAt: new Date(r.started_at).toISOString(), expiresAt: new Date(r.expires_at).toISOString() };
  }

  async closeSupportSession(actor: MPAuditActor, id: string): Promise<boolean> {
    if (!this.db) return false;
    const r: any = await sql`UPDATE support_access_sessions SET ended_at = now() WHERE id = ${id} AND admin_user_id = ${actor.userId ?? null} AND ended_at IS NULL RETURNING id`.execute(this.db).catch(() => ({ rows: [] }));
    if (r.rows.length === 0) return false;
    await this.writeAudit(actor, 'membership.support_mode.exited', id, {});
    return true;
  }


  private async writeAudit(actor: MPAuditActor, action: string, entityId: string, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    await (this.db as any).insertInto('audit_logs').values({
      id: sql`gen_random_uuid()`, tenant_id: null, user_id: actor.userId ?? null, role: actor.role ?? 'SUPER_ADMIN',
      action_type: action, entity_type: 'membership_program', entity_id: entityId, metadata_json: JSON.stringify(meta),
    }).execute().catch(() => {});
  }

  // ---- Unit 3: Tenant Membership Oversight (read-only drill-downs) ----

  async listPrograms(f: { tenantId?: string; status?: string; productType?: string }): Promise<any[]> {
    if (!this.db) return [];
    const where: any[] = [sql`1=1`];
    if (f.tenantId) where.push(sql`mp.tenant_id = ${f.tenantId}`);
    if (f.status) where.push(sql`mp.status = ${f.status}`);
    if (f.productType) where.push(sql`mp.product_type = ${f.productType}`);
    const q: any = await sql`
      SELECT mp.id, mp.name, mp.product_type, mp.status, mp.tenant_id,
        COALESCE(t.display_name, t.legal_name, mp.tenant_id::text) AS tenant_name,
        COALESCE(pv.price_cents,0) AS price_cents, pv.billing_interval,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.plan_id = mp.id AND cm.status='active')::int AS active_members,
        (SELECT COUNT(*) FROM customer_memberships cm WHERE cm.plan_id = mp.id)::int AS total_members,
        (SELECT COALESCE(SUM(amount_cents),0) FROM membership_payments p WHERE p.customer_membership_id IN (SELECT id FROM customer_memberships WHERE plan_id = mp.id) AND p.status='succeeded') AS revenue
      FROM membership_plans mp JOIN tenants t ON t.id = mp.tenant_id
      LEFT JOIN membership_plan_versions pv ON pv.id = mp.current_version_id
      WHERE ${sql.join(where, sql` AND `)} ORDER BY revenue DESC`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map((r) => ({ planId: String(r.id), name: String(r.name), productType: String(r.product_type), status: String(r.status), tenantId: String(r.tenant_id), tenantName: String(r.tenant_name), priceCents: n(r.price_cents), billingInterval: r.billing_interval ?? null, activeMembers: n(r.active_members), totalMembers: n(r.total_members), revenueCents: n(r.revenue) }));
  }

  async listBillingFailures(): Promise<any[]> {
    if (!this.db) return [];
    const q: any = await sql`
      SELECT p.id, p.amount_cents, p.failure_reason, p.attempt_number, p.created_at, p.status,
        cm.member_number, mp.name AS program, COALESCE(t.display_name, t.legal_name) AS tenant
      FROM membership_payments p
      JOIN customer_memberships cm ON cm.id = p.customer_membership_id
      JOIN membership_plans mp ON mp.id = cm.plan_id
      JOIN tenants t ON t.id = p.tenant_id
      WHERE p.status='failed' ORDER BY p.created_at DESC LIMIT 100`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map((r) => ({ id: String(r.id), tenant: String(r.tenant ?? ''), program: String(r.program ?? ''), memberNumber: r.member_number ?? null, amountCents: n(r.amount_cents), reason: String(r.failure_reason ?? 'unknown').replace(/_/g, ' '), attempt: n(r.attempt_number), at: r.created_at ? new Date(r.created_at).toISOString() : null }));
  }

  async revenueBreakdown(): Promise<{ totalCents: number; byTenant: any[]; byProgram: any[] }> {
    if (!this.db) return { totalCents: 0, byTenant: [], byProgram: [] };
    const totalQ: any = await sql`SELECT COALESCE(SUM(amount_cents),0) AS total FROM membership_payments WHERE status='succeeded'`.execute(this.db).catch(() => ({ rows: [{}] }));
    const tenantQ: any = await sql`
      SELECT COALESCE(t.display_name, t.legal_name) AS tenant, COALESCE(SUM(p.amount_cents),0) AS revenue,
        (SELECT COALESCE(SUM(pv.price_cents),0) FROM customer_memberships cm JOIN membership_plan_versions pv ON pv.id=cm.plan_version_id WHERE cm.tenant_id=t.id AND cm.status IN ('active','past_due')) AS mrr
      FROM membership_payments p JOIN tenants t ON t.id=p.tenant_id WHERE p.status='succeeded' GROUP BY t.id, t.display_name, t.legal_name ORDER BY revenue DESC`.execute(this.db).catch(() => ({ rows: [] }));
    const progQ: any = await sql`
      SELECT mp.name AS program, COALESCE(SUM(p.amount_cents),0) AS revenue
      FROM membership_payments p JOIN customer_memberships cm ON cm.id=p.customer_membership_id JOIN membership_plans mp ON mp.id=cm.plan_id
      WHERE p.status='succeeded' GROUP BY mp.id, mp.name ORDER BY revenue DESC LIMIT 10`.execute(this.db).catch(() => ({ rows: [] }));
    return {
      totalCents: n(totalQ.rows[0]?.total),
      byTenant: (tenantQ.rows as any[]).map((r) => ({ tenant: String(r.tenant), revenueCents: n(r.revenue), mrrCents: n(r.mrr) })),
      byProgram: (progQ.rows as any[]).map((r) => ({ program: String(r.program), revenueCents: n(r.revenue) })),
    };
  }

  async listCancellationsPauses(): Promise<any[]> {
    if (!this.db) return [];
    const q: any = await sql`
      SELECT cm.member_number, cm.status, cm.canceled_at, cm.cancel_reason, cm.paused_at, cm.pause_resumes_at,
        mp.name AS program, COALESCE(t.display_name, t.legal_name) AS tenant
      FROM customer_memberships cm JOIN membership_plans mp ON mp.id=cm.plan_id JOIN tenants t ON t.id=cm.tenant_id
      WHERE cm.status IN ('cancelled','paused') ORDER BY COALESCE(cm.canceled_at, cm.paused_at) DESC LIMIT 100`.execute(this.db).catch(() => ({ rows: [] }));
    return (q.rows as any[]).map((r) => ({ memberNumber: r.member_number ?? null, tenant: String(r.tenant ?? ''), program: String(r.program ?? ''), status: String(r.status), reason: r.cancel_reason ? String(r.cancel_reason).replace(/_/g, ' ') : null, at: r.canceled_at ? new Date(r.canceled_at).toISOString() : (r.paused_at ? new Date(r.paused_at).toISOString() : null), resumesAt: r.pause_resumes_at ? new Date(r.pause_resumes_at).toISOString() : null }));
  }
}

function zero(): ProgramsOverview {
  return {
    kpis: { totalPrograms: 0, activeMembers: 0, pausedMembers: 0, cancelledMembers: 0, pastDueMembers: 0, trialMembers: 0, mrrCents: 0, failedPayments: 0, benefitsIssued: 0, benefitsRedeemed: 0, unusedCredits: 0, expiringCredits: 0, tenantParticipation: { active: 0, total: 0 }, branchParticipation: { active: 0, total: 0 }, suspiciousCount: 0 },
    kpiTrends: {},
    programMix: [], statusBreakdown: [], revenueTrend: [], membersVsRedeemed: [], topPrograms: [], tenantPerformance: [], billingFailures: [],
    atAGlance: { newMembersToday: 0, revenueTodayCents: 0, failedPaymentsToday: 0, benefitsRedeemedToday: 0, expiringCreditsToday: 0, supportCasesOpen: 0 },
  };
}