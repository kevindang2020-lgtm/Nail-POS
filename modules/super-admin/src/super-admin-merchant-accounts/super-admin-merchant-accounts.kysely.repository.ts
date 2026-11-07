// super-admin-merchant-accounts.kysely.repository.ts — reads the REAL merchant-account foundation:
// tenant_payment_config (one merchant account per tenant), joined to tenants and to per-tenant terminal counts
// (pos_payment_terminals) and funding references (payment_settlements). Tenant-scoped via parseScope/andTenant.
// Fail-soft (missing/empty tables yield neutral zeros). NO secrets are ever selected — the *_enc credential columns
// are deliberately excluded from every projection.
import { type AppDatabase, andTenant, type OverviewScope } from '@aipowersalon/database';
import { sql } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { PAYMENT_GATEWAY } from '@aipowersalon/payments';

const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => { try { return (await q.execute(db)).rows as T[]; } catch { return []; } };
const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => { try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; } };

export interface MerchantFilter {
  search?: string | null; processor?: string | null; underwritingStatus?: string | null;
  processingStatus?: string | null; riskStatus?: string | null; fundingSchedule?: string | null;
}

export interface MerchantRow {
  tenant_id: string; merchant_id: string | null; processor: string | null; status: string | null;
  onboarding_status: string | null; environment: string | null; configured_at: string | null;
  tenant_name: string | null; legal_name: string | null; branch_name: string | null; branch_count: number;
  terminal_count: number;
  active_rate: { bps: number; fee: number; plan: string | null } | null;
  risk_level: string | null;
  funding: { schedule: string | null; verification: string | null; bank_name: string | null; account_type: string | null; account_last4: string | null } | null;
}

export class SuperAdminMerchantAccountsRepository {
  constructor(private readonly db: AppDatabase) {}

  private whereFor(scope: OverviewScope, f: MerchantFilter) {
    const proc = f.processor && f.processor !== 'all' ? sql`and c.processor = ${f.processor}` : sql``;
    const under = f.underwritingStatus && f.underwritingStatus !== 'all' ? sql`and c.onboarding_status = ${f.underwritingStatus}` : sql``;
    const status = f.processingStatus && f.processingStatus !== 'all' ? sql`and c.status = ${f.processingStatus}` : sql``;
    const term = f.search ? `%${f.search.toLowerCase()}%` : null;
    const search = term ? sql`and (lower(coalesce(c.merchant_id,'')) like ${term} or lower(coalesce(t.legal_name,'')) like ${term} or lower(coalesce(t.display_name,'')) like ${term})` : sql``;
    const risk = f.riskStatus && f.riskStatus !== 'all' ? sql`and (select rr.risk_level from merchant_risk_reviews rr where rr.tenant_id = c.tenant_id order by rr.reviewed_at desc limit 1) = ${f.riskStatus}` : sql``;
    const funding = f.fundingSchedule && f.fundingSchedule !== 'all' ? sql`and (select fp.funding_schedule from merchant_funding_profiles fp where fp.tenant_id = c.tenant_id and fp.superseded_at is null order by fp.effective_at desc limit 1) = ${f.fundingSchedule}` : sql``;
    return sql`c.processor is distinct from 'none' ${andTenant(scope, 'c.tenant_id')} ${proc} ${under} ${status} ${search} ${risk} ${funding}`;
  }

  /** Directory rows (paginated). Excludes all *_enc credential columns. Branch is derived (config is per-tenant). */
  async merchantsPage(scope: OverviewScope, f: MerchantFilter, page: number, pageSize: number) {
    const where = this.whereFor(scope, f);
    const total = await one<{ c: string }>(this.db, sql`select count(*)::text as c from tenant_payment_config c left join tenants t on t.id = c.tenant_id where ${where}`, { c: '0' });
    const offset = Math.max(0, (page - 1) * pageSize);
    const list = await rows<MerchantRow>(this.db, sql`
      select c.tenant_id::text as tenant_id, c.merchant_id, c.processor, c.status, c.onboarding_status, c.environment,
        c.configured_at::text as configured_at,
        coalesce(t.display_name, t.legal_name) as tenant_name, t.legal_name,
        (select b.name from branches b where b.tenant_id = c.tenant_id order by b.created_at nulls last, b.name limit 1) as branch_name,
        (select count(*) from branches b where b.tenant_id = c.tenant_id)::int as branch_count,
        (select count(*) from pos_payment_terminals pt where pt.tenant_id = c.tenant_id::text)::int as terminal_count,
        (select json_build_object('bps', rs.percentage_basis_points, 'fee', rs.per_txn_fee_minor, 'plan', pp.name)
         from merchant_rate_schedules rs left join merchant_pricing_plans pp on pp.id = rs.pricing_plan_id
         where rs.tenant_id = c.tenant_id and rs.status in ('approved','active') and rs.effective_at <= now() and (rs.expires_at is null or rs.expires_at > now())
         order by rs.effective_at desc limit 1) as active_rate,
        (select rr.risk_level from merchant_risk_reviews rr where rr.tenant_id = c.tenant_id order by rr.reviewed_at desc limit 1) as risk_level,
        (select json_build_object('schedule', fp.funding_schedule, 'verification', fp.bank_verification_status, 'bank_name', fp.bank_name, 'account_type', fp.account_type, 'account_last4', fp.account_last4)
         from merchant_funding_profiles fp where fp.tenant_id = c.tenant_id and fp.superseded_at is null order by fp.effective_at desc limit 1) as funding
      from tenant_payment_config c left join tenants t on t.id = c.tenant_id
      where ${where}
      order by (c.status = 'active') desc, c.configured_at desc nulls last
      limit ${pageSize} offset ${offset}`);
    return { rows: list, total: Number(total.c) || 0 };
  }

  /** A single merchant account by tenant id (the config PK), scoped. No secrets. */
  merchantByTenant(scope: OverviewScope, tenantId: string) {
    return one<MerchantRow | null>(this.db, sql`
      select c.tenant_id::text as tenant_id, c.merchant_id, c.processor, c.status, c.onboarding_status, c.environment,
        c.configured_at::text as configured_at,
        coalesce(t.display_name, t.legal_name) as tenant_name, t.legal_name,
        (select b.name from branches b where b.tenant_id = c.tenant_id order by b.created_at nulls last, b.name limit 1) as branch_name,
        (select count(*) from branches b where b.tenant_id = c.tenant_id)::int as branch_count,
        (select count(*) from pos_payment_terminals pt where pt.tenant_id = c.tenant_id::text)::int as terminal_count,
        (select json_build_object('bps', rs.percentage_basis_points, 'fee', rs.per_txn_fee_minor, 'plan', pp.name)
         from merchant_rate_schedules rs left join merchant_pricing_plans pp on pp.id = rs.pricing_plan_id
         where rs.tenant_id = c.tenant_id and rs.status in ('approved','active') and rs.effective_at <= now() and (rs.expires_at is null or rs.expires_at > now())
         order by rs.effective_at desc limit 1) as active_rate,
        (select rr.risk_level from merchant_risk_reviews rr where rr.tenant_id = c.tenant_id order by rr.reviewed_at desc limit 1) as risk_level,
        (select json_build_object('schedule', fp.funding_schedule, 'verification', fp.bank_verification_status, 'bank_name', fp.bank_name, 'account_type', fp.account_type, 'account_last4', fp.account_last4)
         from merchant_funding_profiles fp where fp.tenant_id = c.tenant_id and fp.superseded_at is null order by fp.effective_at desc limit 1) as funding
      from tenant_payment_config c left join tenants t on t.id = c.tenant_id
      where c.tenant_id = ${tenantId} ${andTenant(scope, 'c.tenant_id')}`, null);
  }

  /** KPI counts computed from real config + terminal data (unmodeled KPIs are handled honestly in the service). */
  kpiCounts(scope: OverviewScope) {
    return one<{ total: string; active: string; pending_underwriting: string; inactive: string; terminals: string }>(this.db, sql`
      select
        count(*) filter (where c.processor is distinct from 'none')::text as total,
        count(*) filter (where c.status = 'active')::text as active,
        count(*) filter (where c.onboarding_status in ('submitted','under_review'))::text as pending_underwriting,
        count(*) filter (where c.status in ('disabled','paused'))::text as inactive,
        (select count(*) from pos_payment_terminals pt where true ${andTenant(scope, 'pt.tenant_id')})::text as terminals
      from tenant_payment_config c
      where c.processor is distinct from 'none' ${andTenant(scope, 'c.tenant_id')}`,
      { total: '0', active: '0', pending_underwriting: '0', inactive: '0', terminals: '0' });
  }

  processorCounts(scope: OverviewScope) {
    return rows<{ processor: string | null; c: string }>(this.db, sql`
      select c.processor, count(*)::text as c from tenant_payment_config c
      where c.processor is distinct from 'none' ${andTenant(scope, 'c.tenant_id')} group by 1`);
  }

  statusCounts(scope: OverviewScope) {
    return rows<{ status: string | null; c: string }>(this.db, sql`
      select c.status, count(*)::text as c from tenant_payment_config c
      where c.processor is distinct from 'none' ${andTenant(scope, 'c.tenant_id')} group by 1`);
  }

  underwritingCounts(scope: OverviewScope) {
    return rows<{ onboarding_status: string | null; c: string }>(this.db, sql`
      select c.onboarding_status, count(*)::text as c from tenant_payment_config c
      where c.processor is distinct from 'none' ${andTenant(scope, 'c.tenant_id')} group by 1`);
  }

  /** Terminal assignment overview from real pos_payment_terminals rows. */
  terminalCounts(scope: OverviewScope) {
    return one<{ total: string; assigned: string; unassigned: string; inactive: string }>(this.db, sql`
      select count(*)::text as total,
        count(*) filter (where pt.branch_id is not null and pt.status = 'active')::text as assigned,
        count(*) filter (where pt.branch_id is null)::text as unassigned,
        count(*) filter (where pt.branch_id is not null and pt.status is distinct from 'active')::text as inactive
      from pos_payment_terminals pt where true ${andTenant(scope, 'pt.tenant_id')}`,
      { total: '0', assigned: '0', unassigned: '0', inactive: '0' });
  }

  /** Count of open/active merchant-account alerts (not resolved/closed). */
  alertCount(scope: OverviewScope) {
    return one<{ c: string }>(this.db, sql`
      select count(*)::text as c from merchant_account_alerts a
      where a.status not in ('resolved','closed') ${andTenant(scope, 'a.tenant_id')}`, { c: '0' });
  }

  /** Open/active merchant-account alerts (safe summaries only), most severe + most recent first. */
  openAlerts(scope: OverviewScope, limit = 6) {
    return rows<{ id: string; merchant_id: string | null; tenant_name: string | null; alert_type: string; severity: string; summary: string; status: string; assigned_reviewer_name: string | null; created_at: string }>(this.db, sql`
      select a.id::text as id, a.merchant_id, coalesce(t.display_name, t.legal_name) as tenant_name,
        a.alert_type, a.severity, a.summary, a.status, a.assigned_reviewer_name, a.created_at::text as created_at
      from merchant_account_alerts a left join tenants t on t.id = a.tenant_id
      where a.status not in ('resolved','closed') ${andTenant(scope, 'a.tenant_id')}
      order by (a.severity = 'critical') desc, a.created_at desc limit ${limit}`);
  }

  /** Bank-verification-pending count over current funding profiles. */
  bankVerificationPendingCount(scope: OverviewScope) {
    return one<{ c: string }>(this.db, sql`
      select count(*)::text as c from tenant_payment_config c
      where c.processor is distinct from 'none' ${andTenant(scope, 'c.tenant_id')}
        and (select fp.bank_verification_status from merchant_funding_profiles fp where fp.tenant_id = c.tenant_id and fp.superseded_at is null order by fp.effective_at desc limit 1)
            in ('pending','submitted','information_required','reverification_required')`, { c: '0' });
  }

  /** Count of current funding profiles flagged with a funding issue. */
  fundingIssuesCount(scope: OverviewScope) {
    return one<{ c: string }>(this.db, sql`
      select count(*)::text as c from merchant_funding_profiles fp
      join tenant_payment_config c on c.tenant_id = fp.tenant_id and c.processor is distinct from 'none'
      where fp.superseded_at is null and fp.has_funding_issue = true ${andTenant(scope, 'fp.tenant_id')}`, { c: '0' });
  }

  /** Top funding issues grouped by type over current profiles (reconciles to the flagged population). */
  topFundingIssues(scope: OverviewScope) {
    return rows<{ funding_issue_type: string | null; c: string }>(this.db, sql`
      select fp.funding_issue_type, count(*)::text as c from merchant_funding_profiles fp
      join tenant_payment_config c on c.tenant_id = fp.tenant_id and c.processor is distinct from 'none'
      where fp.superseded_at is null and fp.has_funding_issue = true ${andTenant(scope, 'fp.tenant_id')}
      group by 1 order by 2 desc`);
  }

  /** Count of merchant accounts whose CURRENT (latest) risk review is high or critical. */
  highRiskCount(scope: OverviewScope) {
    return one<{ c: string }>(this.db, sql`
      select count(*)::text as c from tenant_payment_config c
      where c.processor is distinct from 'none' ${andTenant(scope, 'c.tenant_id')}
        and (select rr.risk_level from merchant_risk_reviews rr where rr.tenant_id = c.tenant_id order by rr.reviewed_at desc limit 1) in ('high','critical')`,
      { c: '0' });
  }

  /** High-risk accounts list: merchants whose latest review is high/critical, worst/most-recent first. */
  highRiskAccounts(scope: OverviewScope, limit = 8) {
    return rows<{ tenant_id: string; merchant_id: string | null; tenant_name: string | null; risk_level: string; reviewed_at: string }>(this.db, sql`
      select c.tenant_id::text as tenant_id, c.merchant_id, coalesce(t.display_name, t.legal_name) as tenant_name,
        r.risk_level, r.reviewed_at::text as reviewed_at
      from tenant_payment_config c
      left join tenants t on t.id = c.tenant_id
      join lateral (select rr.risk_level, rr.reviewed_at from merchant_risk_reviews rr where rr.tenant_id = c.tenant_id order by rr.reviewed_at desc limit 1) r on true
      where c.processor is distinct from 'none' ${andTenant(scope, 'c.tenant_id')} and r.risk_level in ('high','critical')
      order by (r.risk_level = 'critical') desc, r.reviewed_at desc
      limit ${limit}`);
  }

  /** Recent merchant-account activity from the audit trail (safe summaries only; no secrets). */
  recentActivity(scope: OverviewScope, limit = 6) {
    return rows<{ occurred_at: string; tenant_id: string | null; actor_name: string | null; action: string | null; summary: string | null }>(this.db, sql`
      select occurred_at::text as occurred_at, tenant_id::text as tenant_id, actor_name, action, summary
      from audit_events where module = 'merchant-accounts' ${andTenant(scope)}
      order by occurred_at desc limit ${limit}`);
  }

  /** Append a single audit row for a merchant-accounts read, tenant-scoped where applicable. */
  // ── Controlled write path (Configure Processing Rates) ──────────────────────────────────────────────────────────
  // These reads/writes are NON-swallowing: genuine DB errors must propagate on the write path (they must not be
  // misread as "not found" or silently dropped). History is preserved — a new schedule is appended; prior rows are
  // never mutated or overwritten (the in-force rate is derived by effective_at ordering).

  /** Idempotency guard: an identical schedule (same tenant, effective instant, bps, fee) already appended → return it. */
  async findIdenticalRate(tenantId: string, effectiveAtIso: string, bps: number, fee: number): Promise<{ id: string } | null> {
    const r = (await sql`select id::text as id from merchant_rate_schedules
      where tenant_id = ${tenantId} and effective_at = ${effectiveAtIso}::timestamptz
        and percentage_basis_points = ${bps} and per_txn_fee_minor = ${fee}
      order by created_at desc limit 1`.execute(this.db!)).rows[0] as { id: string } | undefined;
    return r ?? null;
  }

  /** Append a new effective-dated rate schedule (history-preserving). Returns the new id. */
  async insertRateSchedule(tenantId: string, i: { bps: number; fee: number; monthly: number; refund: number; chargeback: number; planId: string | null; effectiveAtIso: string; changeReason: string; createdBy: string | null; status: string }): Promise<{ id: string }> {
    const r = (await sql`insert into merchant_rate_schedules
      (tenant_id, pricing_plan_id, percentage_basis_points, per_txn_fee_minor, monthly_fee_minor, refund_fee_minor, chargeback_fee_minor, effective_at, status, change_reason, created_by)
      values (${tenantId}, ${i.planId}, ${i.bps}, ${i.fee}, ${i.monthly}, ${i.refund}, ${i.chargeback}, ${i.effectiveAtIso}::timestamptz, ${i.status}, ${i.changeReason}, ${i.createdBy})
      returning id::text as id`.execute(this.db!)).rows[0] as { id: string };
    return r;
  }

  /** Terminal lookup for assignment validation (tenant ownership, current branch). */
  async terminalById(terminalId: string): Promise<{ tenant_id: string; branch_id: string | null; status: string | null; label: string | null } | null> {
    const r = (await sql`select tenant_id, branch_id, status, label from pos_payment_terminals where id = ${terminalId} limit 1`.execute(this.db!)).rows[0] as { tenant_id: string; branch_id: string | null; status: string | null; label: string | null } | undefined;
    return r ?? null;
  }

  /** Assign a terminal to a branch and mark it active. Non-swallowing. Prior branch is preserved in the audit. */
  async assignTerminal(terminalId: string, branchId: string, status: string): Promise<{ updated: number }> {
    const r = await sql`update pos_payment_terminals set branch_id = ${branchId}, status = ${status}, paired_at = now()
      where id = ${terminalId}`.execute(this.db!);
    return { updated: Number(r.numAffectedRows ?? 0) };
  }

  /** Which tenant currently holds this MID (merchant_id), if any — used to prevent cross-account MID conflicts. */
  async midOwner(merchantId: string): Promise<{ tenant_id: string } | null> {
    // wave 3 PAYI §5/§10: a MID may also belong to a branch merchant account — both tables decide who holds it
    const r = (await sql`select tenant_id::text as tenant_id from tenant_payment_config where merchant_id = ${merchantId}
      union all select tenant_id::text from payment_merchant_accounts where merchant_id = ${merchantId} limit 1`.execute(this.db!)).rows[0] as { tenant_id: string } | undefined;
    return r ?? null;
  }

  /** True when the branch belongs to the tenant (branch-ownership / cross-tenant guard). */
  async branchBelongsToTenant(branchId: string, tenantId: string): Promise<boolean> {
    const r = (await sql`select 1 as ok from branches where id = ${branchId} and tenant_id = ${tenantId} limit 1`.execute(this.db!)).rows[0] as { ok: number } | undefined;
    return !!r;
  }

  /** Assign/update the MID (merchant_id) on the merchant account. Non-swallowing. Prior MID is preserved in the audit. */
  async assignMid(tenantId: string, merchantId: string, updatedBy: string | null): Promise<{ updated: number }> {
    const r = await sql`update tenant_payment_config set merchant_id = ${merchantId}, config_version = config_version + 1, updated_at = now(), updated_by_user_id = ${updatedBy}
      where tenant_id = ${tenantId}`.execute(this.db!);
    return { updated: Number(r.numAffectedRows ?? 0) };
  }

  /** §9.2 surcharge enrollment on the merchant that charges this branch (its own row) or the tenant default. Returns the
   *  previous values for the audit; null when that merchant row does not exist. Non-swallowing. */
  async setSurchargeEnrollment(tenantId: string, branchId: string | null, v: { enrolled: boolean; rateBps: number | null; reference: string | null }, updatedBy: string | null)
    : Promise<{ previous: { enrolled: boolean; rateBps: number | null; reference: string | null } } | null> {
    const table = branchId ? sql`payment_merchant_accounts` : sql`tenant_payment_config`;
    const where = branchId ? sql`tenant_id = ${tenantId} and branch_id = ${branchId}` : sql`tenant_id = ${tenantId}`;
    const actor = branchId ? sql`updated_by = ${updatedBy}` : sql`updated_by_user_id = ${updatedBy}`;
    const prev = (await sql`select surcharge_enrolled, surcharge_rate_bps, surcharge_reference from ${table} where ${where} limit 1`.execute(this.db!)).rows[0] as { surcharge_enrolled: boolean | null; surcharge_rate_bps: number | null; surcharge_reference: string | null } | undefined;
    if (!prev) return null;
    await sql`update ${table} set surcharge_enrolled = ${v.enrolled}, surcharge_rate_bps = ${v.rateBps}, surcharge_reference = ${v.reference},
      config_version = config_version + 1, updated_at = now(), ${actor} where ${where}`.execute(this.db!);
    return { previous: { enrolled: !!prev.surcharge_enrolled, rateBps: prev.surcharge_rate_bps == null ? null : Number(prev.surcharge_rate_bps), reference: prev.surcharge_reference ?? null } };
  }

  /** Update a merchant account's processing status (lifecycle transition — never a delete). Non-swallowing. */
  async updateProcessingStatus(tenantId: string, status: string, updatedBy: string | null): Promise<{ updated: number }> {
    const r = await sql`update tenant_payment_config set status = ${status}, config_version = config_version + 1, updated_at = now(), updated_by_user_id = ${updatedBy}
      where tenant_id = ${tenantId} and ${canMoveToSql(PAYMENT_GATEWAY, status)}`.execute(this.db!);
    return { updated: Number(r.numAffectedRows ?? 0) };
  }

  /** Supersede the current funding profile (history-preserving) — prior masked/enc values are retained on the old row. */
  async supersedeCurrentFunding(tenantId: string): Promise<void> {
    await sql`update merchant_funding_profiles set superseded_at = now()
      where tenant_id = ${tenantId} and superseded_at is null`.execute(this.db!);
  }

  /** Append a new current funding profile. Full numbers live ONLY in the *_enc columns; masked columns hold last4 only. */
  async insertFundingProfile(tenantId: string, i: { fundingSchedule: string; bankVerificationStatus: string; bankName: string | null; accountType: string | null; accountLast4: string | null; routingLast4: string | null; bankAccountEnc: string | null; routingEnc: string | null; createdBy: string | null }): Promise<{ id: string }> {
    const r = (await sql`insert into merchant_funding_profiles
      (tenant_id, funding_schedule, bank_verification_status, bank_name, account_type, account_last4, routing_last4, bank_account_enc, routing_number_enc, has_funding_issue, effective_at, superseded_at, created_by)
      values (${tenantId}, ${i.fundingSchedule}, ${i.bankVerificationStatus}, ${i.bankName}, ${i.accountType}, ${i.accountLast4}, ${i.routingLast4}, ${i.bankAccountEnc}, ${i.routingEnc}, false, now(), null, ${i.createdBy})
      returning id::text as id`.execute(this.db!)).rows[0] as { id: string };
    return r;
  }

  /** Validate a pricing plan id exists (returns its name) — null when the id is unknown. */
  async pricingPlanName(planId: string): Promise<{ name: string } | null> {
    const r = (await sql`select name from merchant_pricing_plans where id = ${planId} limit 1`.execute(this.db!)).rows[0] as { name: string } | undefined;
    return r ?? null;
  }

  async writeAudit(actor: { userId?: string; email?: string; ip?: string }, action: string, scope: OverviewScope, summary: string, metadata: unknown) {
    if (!scope.tenantId) return; // audit_events.tenant_id is NOT NULL → only tenant-scoped reads are recorded here
    // actor_user_id is a uuid column; a non-uuid principal id must be stored as null rather than silently failing the insert.
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${scope.tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'merchant-accounts', ${action}, 'merchant_account', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db!);
    } catch { /* audit is best-effort; never break the read */ }
  }
}
