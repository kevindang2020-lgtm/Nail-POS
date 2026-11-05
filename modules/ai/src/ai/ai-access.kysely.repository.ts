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

export interface SnapshotParts {
  tenantStatus: string | null;
  role: string | null;
  subscription: { status: string; trial_ends_at: string | Date | null; usage_limit: number; overage_enabled: boolean } | null;
  used: number;
  /** The usage counter could not be READ. Emphatically NOT the same as `used: 0`, which is a confident answer. */
  usageUnknown?: boolean;
  supportMode?: boolean;
  pastDuePolicy?: 'block' | 'limit';
}

/** Pure: raw query parts → access snapshot. Unknown tenant → 'suspended' (deny); no subscription → null (deny). */
export function assembleSnapshot(p: SnapshotParts): AiAccessSnapshot {
  return {
    tenantStatus: (p.tenantStatus as TenantAccountStatus) ?? 'suspended',
    supportMode: p.supportMode ?? false,
    packageEnabled: true, // Super-Admin global per-package disable is Phase 4; per-tenant disable is the 'disabled' status
    subscription: p.subscription ? { status: p.subscription.status as any, trialEndsAt: p.subscription.trial_ends_at } : null,
    usage: { used: p.used, limit: p.subscription?.usage_limit ?? 0, overageEnabled: !!p.subscription?.overage_enabled },
    // Carried through, never defaulted to false silently: `usage.used` is only meaningful when we actually read it.
    usageUnknown: !!p.usageUnknown,
    hasPermission: p.role ? can(p.role as Role, 'ai.use') : false,
    pastDuePolicy: p.pastDuePolicy ?? 'block',
  };
}

export class KyselyAiAccessRepo implements AiAccessRepo {
  constructor(private readonly db: Kysely<any>) {}

  async loadSnapshot(tenantId: string, packageCode: string, userId: string | null): Promise<AiAccessSnapshot> {
    const d = this.db as any;
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
            and created_at >= ${(subscription as any).current_period_starts_at}
        `.execute(d);
        used = Number(r.rows[0]?.n ?? 0);
      } catch {
        usageUnknown = true;
      }
    }
    return assembleSnapshot({ tenantStatus, role, subscription: subscription as any, used, usageUnknown });
  }
}

export class KyselyAiUsageLogger implements AiUsageLogger {
  constructor(private readonly db: Kysely<any>) {}
  async log(e: AiUsageEntry): Promise<void> {
    await sql`
      insert into ai_usage_logs (id, tenant_id, user_id, package_code, action, model_provider, model_name,
        input_tokens, output_tokens, total_tokens, cost_estimate_cents, cost_micro_usd, usage_unit, usage_amount, status, error_message, created_at, price_version_id, request_id)
      values (gen_random_uuid(), ${e.tenantId}, ${e.userId}, ${e.packageCode}, ${e.action}, ${e.modelProvider}, ${e.modelName},
        ${e.inputTokens}, ${e.outputTokens}, ${e.inputTokens + e.outputTokens}, ${Math.round((e.costMicroUsd ?? 0) / 10000)}, ${e.costMicroUsd ?? 0}, ${e.usageUnit}, ${e.usageAmount}, ${e.status}, ${e.errorMessage ?? null}, ${e.createdAt}, ${e.priceVersionId ?? null}, ${e.requestId ?? null})
      on conflict do nothing   -- Phase 14: a repeated requestId (uq_ai_usage_logs_request, 565) is metered once
    `.execute(this.db as any).catch(() => undefined);
  }
}
