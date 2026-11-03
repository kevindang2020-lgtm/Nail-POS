// tenant-ai.repository.ts — tenant-scoped reads/writes for the tenant-owner AI surface. Every method is filtered by the
// caller's own tenant_id (resolved from the session in the controller), so a tenant can only ever see/affect its own
// AI subscriptions and usage. Raw sql, guarded.
import { sql, type Kysely } from 'kysely';
import type { SubRow, NormalizedAssign } from '../super-admin-ai/ai-admin-core';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_AI_SUBSCRIPTION } from '@aipowersalon/ai';

export interface TenantUsageRow { packageCode: string; used: number; calls: number }

export interface TenantAiRepo {
  listForTenant(tenantId: string): Promise<SubRow[]>;
  getOne(tenantId: string, packageCode: string): Promise<SubRow | null>;
  usageForTenant(tenantId: string): Promise<TenantUsageRow[]>;
  upsert(tenantId: string, v: NormalizedAssign): Promise<void>;
  cancel(tenantId: string, packageCode: string): Promise<boolean>;
}

const iso = (d: Date | string | null) => (d == null ? null : d instanceof Date ? d.toISOString() : d);

export class InMemoryTenantAiRepo implements TenantAiRepo {
  public rows: SubRow[] = [];
  public usage: TenantUsageRow[] = [];
  async listForTenant(tenantId: string) { return this.rows.filter((r) => r.tenantId === tenantId).map((r) => ({ ...r })); }
  async getOne(tenantId: string, code: string) { return this.rows.find((r) => r.tenantId === tenantId && r.packageCode === code) ?? null; }
  async usageForTenant() { return this.usage.map((u) => ({ ...u })); }
  async upsert(tenantId: string, v: NormalizedAssign) {
    const i = this.rows.findIndex((r) => r.tenantId === tenantId && r.packageCode === v.packageCode);
    const row: SubRow = { tenantId, packageCode: v.packageCode, status: v.status, billingPeriod: v.billingPeriod, priceCents: v.priceCents, usageLimit: v.usageLimit, overageEnabled: v.overageEnabled, trialEndsAt: iso(v.trialEndsAt), currentPeriodStartsAt: iso(v.currentPeriodStartsAt) };
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...row }; else this.rows.push(row);
  }
  async cancel(tenantId: string, code: string) { const r = this.rows.find((x) => x.tenantId === tenantId && x.packageCode === code); if (!r) return false; r.status = 'cancelled'; return true; }
}

export class KyselyTenantAiRepo implements TenantAiRepo {
  constructor(private readonly db: Kysely<any>) {}
  private map = (r: any): SubRow => ({
    tenantId: String(r.tenant_id), packageCode: String(r.package_code), status: r.status, billingPeriod: r.billing_period,
    priceCents: Number(r.price_cents || 0), usageLimit: Number(r.usage_limit || 0), overageEnabled: !!r.overage_enabled,
    trialEndsAt: r.trial_ends_at ?? null, currentPeriodStartsAt: r.current_period_starts_at ?? null,
  });
  async listForTenant(tenantId: string): Promise<SubRow[]> {
    return sql`select tenant_id, package_code, status, billing_period, price_cents, usage_limit, overage_enabled, trial_ends_at, current_period_starts_at from tenant_ai_subscriptions where tenant_id = ${tenantId}`
      .execute(this.db).then((r: any) => r.rows.map(this.map));   // Nov 2 2026: a read error is an error, never "not subscribed"
  }
  async getOne(tenantId: string, code: string): Promise<SubRow | null> {
    return sql`select tenant_id, package_code, status, billing_period, price_cents, usage_limit, overage_enabled, trial_ends_at, current_period_starts_at from tenant_ai_subscriptions where tenant_id = ${tenantId} and package_code = ${code}`
      .execute(this.db).then((r: any) => (r.rows[0] ? this.map(r.rows[0]) : null));
  }
  async usageForTenant(tenantId: string): Promise<TenantUsageRow[]> {
    // AI Usage & Limits guide §14: usage of the CURRENT billing period (the access gate's rule), not all-time — the
    // packages list used to show lifetime totals against a monthly limit
    return sql`select l.package_code, coalesce(sum(l.usage_amount),0)::int used, count(*)::int calls from ai_usage_logs l
      left join tenant_ai_subscriptions s on s.tenant_id = l.tenant_id and s.package_code = l.package_code
      where l.tenant_id = ${tenantId} and l.status = 'success' and (s.current_period_starts_at is null or l.created_at >= s.current_period_starts_at) group by l.package_code`
      .execute(this.db).then((r: any) => r.rows.map((x: any) => ({ packageCode: String(x.package_code), used: Number(x.used || 0), calls: Number(x.calls || 0) })));   // never a false 0
  }
  async upsert(tenantId: string, v: NormalizedAssign): Promise<void> {
    await sql`
      insert into tenant_ai_subscriptions (id, tenant_id, package_code, status, billing_period, price_cents, currency, usage_limit, overage_enabled, trial_starts_at, trial_ends_at, current_period_starts_at)
      values (gen_random_uuid(), ${tenantId}, ${v.packageCode}, ${v.status}, ${v.billingPeriod}, ${v.priceCents}, ${v.currency}, ${v.usageLimit}, ${v.overageEnabled}, ${iso(v.trialStartsAt)}, ${iso(v.trialEndsAt)}, ${iso(v.currentPeriodStartsAt)})
      on conflict (tenant_id, package_code) do update set status=excluded.status, trial_starts_at=excluded.trial_starts_at,
        trial_ends_at=excluded.trial_ends_at, current_period_starts_at=excluded.current_period_starts_at, updated_at=now()
      where ${canMoveToSql(TENANT_AI_SUBSCRIPTION, v.status, 'tenant_ai_subscriptions')}
    `.execute(this.db);
  }
  async cancel(tenantId: string, code: string): Promise<boolean> {
    // AI Usage & Limits guide §7: only a live subscription can be cancelled, and "ok" means a row actually changed
    // (it used to report success for an already-cancelled or missing package).
    const r: any = await sql`update tenant_ai_subscriptions set status='cancelled', cancelled_at=now(), updated_at=now() where tenant_id=${tenantId} and package_code=${code}
      and status in ('active', 'trialing', 'past_due', 'unpaid') and ${canMoveToSql(TENANT_AI_SUBSCRIPTION, 'cancelled')}`.execute(this.db);
    return Number(r?.numAffectedRows ?? r?.numUpdatedOrDeletedRows ?? 0) > 0;
  }
}
