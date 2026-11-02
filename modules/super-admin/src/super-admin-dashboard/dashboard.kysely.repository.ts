/**
 * dashboard.kysely.repository.ts — Postgres (Kysely) DashboardDataPort.
 *
 * ⚠️ STAGED: type-checked, NOT run against a live DB (see INTEGRATION_RUNBOOK §8). Facts are derived from `tenants` +
 * each tenant's latest `tenant_subscriptions` row; createdDaysAgo from tenants.created_at. Honest gaps (no fabrication):
 *  - usagePercent = 0 — there is no usage table in this schema; wire a real usage source to populate it.
 *  - plan prices come from env `PLAN_PRICES_JSON` (a JSON map planTier→cents) or {} — MRR is 0 until configured.
 *  - planTier uses the subscription `plan` string as-is; reconcile with your plan-tier vocabulary if it differs.
 */
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { PlatformTenantFact, PlatformTenantStatus } from './dashboard.dto';
import type { DashboardDataPort } from './dashboard.repository';

function platformStatus(tenantStatus: string, subStatus: string | undefined): PlatformTenantStatus {
  const t = (tenantStatus || '').toLowerCase();
  if (t === 'cancelled') return 'cancelled';
  if (t === 'suspended') return 'suspended';
  if (t === 'pending') return 'pending';
  const s = (subStatus || '').toLowerCase();
  if (s === 'trialing' || s === 'trial') return 'trialing';
  if (s === 'cancelled' || s === 'expired') return 'cancelled';
  return 'active';
}
const daysAgo = (v: any, now: number): number => {
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0;
};

export class KyselyDashboardRepository implements DashboardDataPort {
  constructor(private readonly db: Kysely<DB>) {}

  async getFacts(): Promise<PlatformTenantFact[]> {
    const now = Date.now();
    const tenants = await this.db.selectFrom('tenants').select(['id', 'status', 'created_at']).execute();
    const subs = await this.db.selectFrom('tenant_subscriptions').select(['tenant_id', 'plan', 'status', 'created_at']).execute();
    // latest subscription per tenant
    const latest = new Map<string, { plan: string; status: string }>();
    for (const s of subs) {
      const prev = (latest as any).get(s.tenant_id + '#ts');
      const ts = s.created_at instanceof Date ? s.created_at.getTime() : Date.parse(String(s.created_at));
      if (!prev || ts >= prev) { latest.set(s.tenant_id, { plan: s.plan, status: s.status }); (latest as any).set(s.tenant_id + '#ts', ts); }
    }
    return tenants.map((t) => {
      const sub = latest.get(t.id);
      return {
        status: platformStatus(t.status, sub?.status),
        planTier: sub?.plan ?? 'Trial',
        usagePercent: 0, // NOTE: no usage source in schema.
        createdDaysAgo: daysAgo(t.created_at, now),
      } as PlatformTenantFact;
    });
  }

  async getPlanPrices(): Promise<Record<string, number>> {
    try { return process.env.PLAN_PRICES_JSON ? JSON.parse(process.env.PLAN_PRICES_JSON) : {}; }
    catch { return {}; }
  }
}
