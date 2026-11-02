// ai-access.kysely.repository.ts — production AiAccessRepo + usage logger. Reads the real paid subscription
// (tenant_ai_subscriptions), the tenant account status (tenants), the user's role (users → RBAC), and the current-period
// usage total (ai_usage_logs) to build the access snapshot the gate evaluates. Raw `sql`, every query `.catch`-guarded
// so a transient DB error fails CLOSED (default-deny), never open. The mapping is extracted into a pure `assembleSnapshot`
// so it can be unit-tested without a database.
import { sql, type Kysely } from 'kysely';
import { can, type Role } from '@aipowersalon/permissions';
import type { AiAccessRepo } from './ai-assistant.service';
import type { AiAccessSnapshot, TenantAccountStatus } from './ai-access-gate';
import type { AiUsageLogger, AiUsageEntry } from './ai-gateway';
import { logException } from '@aipowersalon/observability';
import { syncUsageAlerts } from './ai-usage-alerts';

export interface SnapshotParts {
  tenantStatus: string | null;
  role: string | null;
  subscription: { status: string; trial_ends_at: string | Date | null; usage_limit: number; overage_enabled: boolean } | null;
  used: number;
  /** The usage counter could not be READ. Emphatically NOT the same as `used: 0`, which is a confident answer. */
  usageUnknown?: boolean;
  supportMode?: boolean;
  pastDuePolicy?: 'block' | 'limit';
  /** Super Admin's global availability (platform_ai_package_settings, migration 723). Absent = enabled. */
  packageEnabled?: boolean;
  /** AI-02: the branch override row when the call has a branch context (migration 728). Absent / null = no context. */
  branchOverride?: { branchId: string; enabled: boolean | null } | null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pgCode = (e: unknown) => String((e as { code?: unknown } | null)?.code ?? '');
/** optional context of one access decision: the branch the request runs in (from the session, never the body) */
export interface AccessContext { branchId?: string | null }

/** Pure: raw query parts → access snapshot. Unknown tenant → 'suspended' (deny); no subscription → null (deny). */
export function assembleSnapshot(p: SnapshotParts): AiAccessSnapshot {
  return {
    tenantStatus: (p.tenantStatus as TenantAccountStatus) ?? 'suspended',
    supportMode: p.supportMode ?? false,
    packageEnabled: p.packageEnabled ?? true, // Super Admin global per-package availability (platform_ai_package_settings); per-tenant disable is the 'disabled' status
    subscription: p.subscription ? { status: p.subscription.status as any, trialEndsAt: p.subscription.trial_ends_at } : null,
    usage: { used: p.used, limit: p.subscription?.usage_limit ?? 0, overageEnabled: !!p.subscription?.overage_enabled },
    // Carried through, never defaulted to false silently: `usage.used` is only meaningful when we actually read it.
    usageUnknown: !!p.usageUnknown,
    hasPermission: p.role ? can(p.role as Role, 'ai.use') : false,
    pastDuePolicy: p.pastDuePolicy ?? 'block',
    branchOverride: p.branchOverride ?? null,
  };
}

export class KyselyAiAccessRepo implements AiAccessRepo {
  constructor(private readonly db: Kysely<any>) {}

  async loadSnapshot(tenantId: string, packageCode: string, userId: string | null, opts?: AccessContext): Promise<AiAccessSnapshot> {
    const d = this.db;
    const tenantStatus = await sql<{ status: string }>`select status from tenants where id = ${tenantId}`
      .execute(d).then((r: any) => r.rows[0]?.status ?? null).catch(() => null);
    const role = userId
      // Defense-in-depth: scope the role lookup to THIS tenant. tenantId + userId always arrive together from the same
      // session, so this is behavior-identical for every real user; it only fails closed if a tenant user's id is ever
      // mispaired with a different tenant. `tenant_id is null` preserves platform/SUPER_ADMIN rows (no tenant_id).
      ? await sql<{ role: string }>`select role from users where id = ${userId} and (tenant_id = ${tenantId} or tenant_id is null)`.execute(d).then((r: any) => r.rows[0]?.role ?? null).catch(() => null)
      : null;
    const subscription = await sql`
      select status, trial_ends_at, current_period_starts_at, usage_limit, overage_enabled
      from tenant_ai_subscriptions where tenant_id = ${tenantId} and package_code = ${packageCode}
    `.execute(d).then((r: any) => r.rows[0] ?? null).catch(() => null);
    let used = 0;
    let usageUnknown = false;
    if (subscription) {
      // This used to be `.catch(() => 0)`. A failed count therefore looked EXACTLY like a tenant who had used
      // nothing — and `0 + 1 > limit` is false, so `limit_exceeded` could never fire. One flaky query silently
      // removed every tenant's usage cap, and they kept consuming AI for free until a human noticed.
      //
      // Zero is not "unknown". So say unknown.
      try {
        const r: any = await sql<{ n: number }>`
          select coalesce(sum(usage_amount), 0)::int n from ai_usage_logs
          where tenant_id = ${tenantId} and package_code = ${packageCode} and status = 'success'
            and created_at >= ${subscription.current_period_starts_at}
        `.execute(d);
        used = Number(r.rows[0]?.n ?? 0);
      } catch {
        usageUnknown = true;
      }
    }
    // Super Admin's global switch (AI Usage & Limits guide §7/§16). No row = enabled. A failed read keeps the package
    // enabled (the table may not exist before migration 723) but is logged, never swallowed.
    const packageEnabled = await sql<{ enabled: boolean }>`select enabled from platform_ai_package_settings where package_code = ${packageCode}`
      .execute(d).then((r: any) => (r.rows[0] ? !!r.rows[0].enabled : true))
      .catch((e: unknown) => { logException(e, { where: 'ai-access.package_settings_unreadable', packageCode }); return true; });
    const branchOverride = await this.branchOverride(tenantId, packageCode, opts?.branchId ?? null);
    return assembleSnapshot({ tenantStatus, role, subscription: subscription, used, usageUnknown, packageEnabled, branchOverride });
  }

  /** AI-02 (Four-Module guide §12): the branch's override. No branch context → null (salon-wide decision). No row →
   *  inherit. A missing table (before migration 728) → inherit, logged. Any other read failure FAILS CLOSED for that
   *  branch (enabled: false) — a branch that turned AI off must not silently get it back because a query failed. */
  private async branchOverride(tenantId: string, packageCode: string, branchId: string | null): Promise<SnapshotParts['branchOverride']> {
    if (!branchId || !UUID_RE.test(branchId)) return null;
    try {
      const r: any = await sql`select b.override_enabled from tenant_ai_branch_settings b
        where b.tenant_id = ${tenantId} and b.branch_id = ${branchId} and b.package_code = ${packageCode}`.execute(this.db);
      const row = r.rows[0];
      return { branchId, enabled: row ? (row.override_enabled == null ? null : !!row.override_enabled) : null };
    } catch (e) {
      logException(e, { where: 'ai-access.branch_settings_unreadable', tenantId, packageCode });
      return { branchId, enabled: pgCode(e) === '42P01' ? null : false };
    }
  }
}

export class KyselyAiUsageLogger implements AiUsageLogger {
  constructor(private readonly db: Kysely<any>) {}
  async log(e: AiUsageEntry): Promise<void> {
    // AI-02: branch attribution (migration 728) only when the gateway knows the branch; otherwise NULL = "unavailable".
    const branchId = e.branchId && UUID_RE.test(e.branchId) ? e.branchId : null;
    const insert = (withBranch: boolean) => sql`
      insert into ai_usage_logs (id, tenant_id, user_id, package_code, action, model_provider, model_name,
        input_tokens, output_tokens, total_tokens, cost_estimate_cents, cost_micro_usd, usage_unit, usage_amount, status, error_message, created_at, price_version_id, request_id${withBranch ? sql`, branch_id` : sql``})
      values (gen_random_uuid(), ${e.tenantId}, ${e.userId}, ${e.packageCode}, ${e.action}, ${e.modelProvider}, ${e.modelName},
        ${e.inputTokens}, ${e.outputTokens}, ${e.inputTokens + e.outputTokens}, ${Math.round((e.costMicroUsd ?? 0) / 10000)}, ${e.costMicroUsd ?? 0}, ${e.usageUnit}, ${e.usageAmount}, ${e.status}, ${e.errorMessage ?? null}, ${e.createdAt}, ${e.priceVersionId ?? null}, ${e.requestId ?? null}${withBranch ? sql`, ${branchId}` : sql``})
      on conflict do nothing   -- Phase 14: a repeated requestId (uq_ai_usage_logs_request, 565) is metered once
    `.execute(this.db);
    try { await insert(!!branchId); }
    catch (x) {
      // before migration 728 the column does not exist: meter the call without the branch rather than not at all
      if (branchId && pgCode(x) === '42703') await insert(false).catch((y: unknown) => logException(y, { where: 'ai-usage-log.insert', tenantId: e.tenantId }));
      else logException(x, { where: 'ai-usage-log.insert', tenantId: e.tenantId });
    }
    // AI Usage & Limits guide §10: record the 80 / 90 / 100 % threshold this call crossed (deduplicated per period). An
    // alert never blocks, charges or upgrades; a failure to record it is logged and the screen backfills it on read.
    if (e.status === 'success') await syncUsageAlerts(this.db, e.tenantId, e.packageCode).catch((x: unknown) => logException(x, { where: 'ai-usage-alerts.sync', tenantId: e.tenantId }));
  }
}
