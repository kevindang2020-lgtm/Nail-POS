// ai-usage-alerts.ts — AI Usage & Limits Complete Build Guide (Oct 30 2026) §10: server-side 80 / 90 / 100 % usage
// alerts for fixed-period quotas. ONE row per tenant × package × billing period × threshold (unique index, migration
// 723), so a burst of calls, a retried provider call or a re-read never creates a second alert. The usage counted is
// exactly the access gate's: successful ai_usage_logs rows since the subscription's current_period_starts_at.
// An alert NEVER upgrades, charges, or raises a limit — it only records that a threshold was crossed.
import { sql, type Kysely } from 'kysely';
import { getAiPackage } from './ai-catalog';

export const USAGE_ALERT_THRESHOLDS = [80, 90, 100] as const;
export type UsageAlertThreshold = (typeof USAGE_ALERT_THRESHOLDS)[number];
/** the thresholds a used / limit pair has crossed (limit ≤ 0 = unlimited / not metered → none) */
export function crossedThresholds(used: number, limit: number): UsageAlertThreshold[] {
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return [];
  return USAGE_ALERT_THRESHOLDS.filter((t) => used * 100 >= limit * t);
}

/** Record every threshold the tenant's current period has crossed (one package, or all of the tenant's metered
 *  subscriptions). Returns the newly inserted alerts. Statuses that cannot consume usage are skipped. */
export async function syncUsageAlerts(db: Kysely<any>, tenantId: string, packageCode?: string): Promise<{ packageCode: string; threshold: number }[]> {
  const only = packageCode ? sql`and s.package_code = ${packageCode}` : sql``;
  const rows = (await sql<any>`
    select s.package_code, s.usage_limit, s.current_period_starts_at,
      (select coalesce(sum(l.usage_amount), 0)::bigint from ai_usage_logs l where l.tenant_id = s.tenant_id and l.package_code = s.package_code
         and l.status = 'success' and l.created_at >= s.current_period_starts_at) as used
    from tenant_ai_subscriptions s
    where s.tenant_id = ${tenantId} and s.usage_limit > 0 and s.status in ('active', 'trialing', 'past_due') ${only}`.execute(db)).rows;
  const out: { packageCode: string; threshold: number }[] = [];
  for (const r of rows) {
    const used = Number(r.used ?? 0), limit = Number(r.usage_limit ?? 0);
    const unit = getAiPackage(String(r.package_code))?.usageUnit ?? 'units';
    for (const t of crossedThresholds(used, limit)) {
      // the period start is copied in SQL (never round-tripped through a JS Date, which would drop the microseconds and
      // stop the alert from matching its period)
      const ins = await sql<any>`insert into ai_usage_alerts (tenant_id, package_code, period_start, threshold, used, usage_limit, usage_unit)
        select s.tenant_id, s.package_code, s.current_period_starts_at, ${t}, ${used}, ${limit}, ${unit} from tenant_ai_subscriptions s
        where s.tenant_id = ${tenantId} and s.package_code = ${r.package_code}
        on conflict (tenant_id, package_code, period_start, threshold) do nothing returning id`.execute(db);
      if (ins.rows.length) out.push({ packageCode: String(r.package_code), threshold: t });
    }
  }
  return out;
}
