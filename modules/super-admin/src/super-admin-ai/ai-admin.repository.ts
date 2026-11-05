// ai-admin.repository.ts — data port for the Super-Admin AI subscription manager + an in-memory adapter (tested) and a
// Kysely adapter (raw sql, guarded). Operates on tenant_ai_subscriptions and rolls usage from ai_usage_logs.
import { sql, type Kysely } from 'kysely';
import type { SubRow, NormalizedAssign } from './ai-admin-core';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_AI_SUBSCRIPTION } from '@aipowersalon/ai';

export interface AiUsageSummaryRow { packageCode: string; status: string; calls: number; usageAmount: number; costMicroUsd: number }
export interface AiUsageStats { totalInteractions: number; totalTokens: number; totalCostCents: number; successRate: number; byAction: { action: string; count: number }[]; byProvider: { provider: string; count: number }[]; daily: { date: string; count: number }[] }

export interface AiAdminRepo {
  listSubscriptions(): Promise<SubRow[]>;
  packageTenants(packageCode: string): Promise<Array<SubRow & { tenantName: string | null }>>;
  upsert(tenantId: string, v: NormalizedAssign): Promise<void>;
  update(tenantId: string, packageCode: string, patch: Record<string, unknown>): Promise<boolean>;
  cancel(tenantId: string, packageCode: string): Promise<boolean>;
  usageSummary(): Promise<AiUsageSummaryRow[]>;
  usageStats(): Promise<AiUsageStats>;
}

const iso = (d: Date | string | null) => (d == null ? null : d instanceof Date ? d.toISOString() : d);

export class InMemoryAiAdminRepo implements AiAdminRepo {
  public rows: Array<SubRow & { tenantName?: string | null }> = [];
  public usage: AiUsageSummaryRow[] = [];
  async listSubscriptions() { return this.rows.map((r) => ({ ...r })); }
  async packageTenants(code: string) { return this.rows.filter((r) => r.packageCode === code).map((r) => ({ ...r, tenantName: r.tenantName ?? null })); }
  async upsert(tenantId: string, v: NormalizedAssign) {
    const i = this.rows.findIndex((r) => r.tenantId === tenantId && r.packageCode === v.packageCode);
    const row: SubRow = { tenantId, packageCode: v.packageCode, status: v.status, billingPeriod: v.billingPeriod, priceCents: v.priceCents, usageLimit: v.usageLimit, overageEnabled: v.overageEnabled, trialEndsAt: iso(v.trialEndsAt), currentPeriodStartsAt: iso(v.currentPeriodStartsAt) };
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...row }; else this.rows.push(row);
  }
  async update(tenantId: string, code: string, patch: Record<string, unknown>) {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.packageCode === code);
    if (!r) return false; Object.assign(r, patch); return true;
  }
  async cancel(tenantId: string, code: string) {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.packageCode === code);
    if (!r) return false; r.status = 'cancelled'; return true;
  }
  async usageSummary() { return this.usage.map((u) => ({ ...u })); }
  async usageStats(): Promise<AiUsageStats> { return { totalInteractions: 0, totalTokens: 0, totalCostCents: 0, successRate: 0, byAction: [], byProvider: [], daily: [] }; }
}

export class KyselyAiAdminRepo implements AiAdminRepo {
  constructor(private readonly db: Kysely<any>) {}
  private map = (r: any): SubRow => ({
    tenantId: String(r.tenant_id), packageCode: String(r.package_code), status: r.status, billingPeriod: r.billing_period,
    priceCents: Number(r.price_cents || 0), usageLimit: Number(r.usage_limit || 0), overageEnabled: !!r.overage_enabled,
    trialEndsAt: r.trial_ends_at ?? null, currentPeriodStartsAt: r.current_period_starts_at ?? null,
  });
  async listSubscriptions(): Promise<SubRow[]> {
    return sql`select tenant_id, package_code, status, billing_period, price_cents, usage_limit, overage_enabled, trial_ends_at, current_period_starts_at from tenant_ai_subscriptions`
      .execute(this.db as any).then((r: any) => r.rows.map(this.map)).catch(() => []);
  }
  async packageTenants(code: string) {
    return sql`
      select s.tenant_id, s.package_code, s.status, s.billing_period, s.price_cents, s.usage_limit, s.overage_enabled, s.trial_ends_at, s.current_period_starts_at, t.display_name as tenant_name
      from tenant_ai_subscriptions s left join tenants t on t.id = s.tenant_id where s.package_code = ${code} order by s.created_at desc
    `.execute(this.db as any).then((r: any) => r.rows.map((row: any) => ({ ...this.map(row), tenantName: row.tenant_name ?? null }))).catch(() => []);
  }
  async upsert(tenantId: string, v: NormalizedAssign): Promise<void> {
    await sql`
      insert into tenant_ai_subscriptions (id, tenant_id, package_code, status, billing_period, price_cents, currency, usage_limit, overage_enabled, trial_starts_at, trial_ends_at, current_period_starts_at)
      values (gen_random_uuid(), ${tenantId}, ${v.packageCode}, ${v.status}, ${v.billingPeriod}, ${v.priceCents}, ${v.currency}, ${v.usageLimit}, ${v.overageEnabled}, ${iso(v.trialStartsAt)}, ${iso(v.trialEndsAt)}, ${iso(v.currentPeriodStartsAt)})
      on conflict (tenant_id, package_code) do update set status=excluded.status, billing_period=excluded.billing_period,
        price_cents=excluded.price_cents, usage_limit=excluded.usage_limit, overage_enabled=excluded.overage_enabled,
        trial_starts_at=excluded.trial_starts_at, trial_ends_at=excluded.trial_ends_at,
        current_period_starts_at=excluded.current_period_starts_at, updated_at=now()
      where ${canMoveToSql(TENANT_AI_SUBSCRIPTION, v.status, 'tenant_ai_subscriptions')}
    `.execute(this.db as any);
  }
  async update(tenantId: string, code: string, patch: Record<string, unknown>): Promise<boolean> {
    const cols: Record<string, string> = { status: 'status', usageLimit: 'usage_limit', overageEnabled: 'overage_enabled', billingPeriod: 'billing_period', priceCents: 'price_cents' };
    const sets = Object.entries(patch).filter(([k]) => cols[k]).map(([k, val]) => sql`${sql.raw(cols[k])} = ${val as any}`);
    if (!sets.length) return false;
    const r: any = await sql`update tenant_ai_subscriptions set ${sql.join(sets, sql`, `)}, updated_at = now() where tenant_id = ${tenantId} and package_code = ${code} and ${patch.status !== undefined ? canMoveToSql(TENANT_AI_SUBSCRIPTION, String(patch.status)) : sql`true`}`.execute(this.db as any).catch(() => null);
    return !!r && (r.numAffectedRows ?? 1n) !== 0n;
  }
  async cancel(tenantId: string, code: string): Promise<boolean> {
    const r: any = await sql`update tenant_ai_subscriptions set status='cancelled', cancelled_at=now(), updated_at=now() where tenant_id=${tenantId} and package_code=${code} and ${canMoveToSql(TENANT_AI_SUBSCRIPTION, 'cancelled')}`.execute(this.db as any).catch(() => null);
    return !!r;
  }
  async usageSummary(): Promise<AiUsageSummaryRow[]> {
    return sql`select package_code, status, count(*)::int calls, coalesce(sum(usage_amount),0)::int usage_amount, coalesce(sum(cost_micro_usd),0)::bigint cost_micro_usd from ai_usage_logs group by package_code, status`
      .execute(this.db as any).then((r: any) => r.rows.map((x: any) => ({ packageCode: String(x.package_code), status: String(x.status), calls: Number(x.calls || 0), usageAmount: Number(x.usage_amount || 0), costMicroUsd: Number(x.cost_micro_usd || 0) }))).catch(() => []);
  }

  async usageStats(): Promise<AiUsageStats> {
    const totalsRow: any = await sql`select count(*)::int interactions, coalesce(sum(total_tokens),0)::bigint tokens, coalesce(sum(cost_estimate_cents),0)::bigint cost, count(*) filter (where status='success')::int ok from ai_usage_logs`.execute(this.db as any).then((r: any) => r.rows[0]).catch(() => ({}));
    const act: any[] = await sql`select coalesce(action,'other') action, count(*)::int n from ai_usage_logs group by action order by n desc limit 8`.execute(this.db as any).then((r: any) => r.rows).catch(() => []);
    const prov: any[] = await sql`select coalesce(model_provider,'other') provider, count(*)::int n from ai_usage_logs group by model_provider order by n desc limit 6`.execute(this.db as any).then((r: any) => r.rows).catch(() => []);
    const daily: any[] = await sql`select to_char(created_at::date,'YYYY-MM-DD') d, count(*)::int n from ai_usage_logs where created_at >= current_date - interval '13 days' group by created_at::date order by created_at::date`.execute(this.db as any).then((r: any) => r.rows).catch(() => []);
    const total = Number(totalsRow?.interactions || 0);
    return {
      totalInteractions: total, totalTokens: Number(totalsRow?.tokens || 0), totalCostCents: Number(totalsRow?.cost || 0),
      successRate: total > 0 ? Math.round((Number(totalsRow?.ok || 0) / total) * 1000) / 10 : 0,
      byAction: act.map((x) => ({ action: String(x.action), count: Number(x.n) })),
      byProvider: prov.map((x) => ({ provider: String(x.provider), count: Number(x.n) })),
      daily: daily.map((x) => ({ date: String(x.d), count: Number(x.n) })),
    };
  }
}
