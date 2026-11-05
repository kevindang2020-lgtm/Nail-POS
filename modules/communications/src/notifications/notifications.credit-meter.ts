// notifications.credit-meter.ts — MERGE ADAPTER (Project B feature → Project A base).
// Project B metered SMS/email sends through its standalone UsageLimitsService. Project A consolidated all
// usage-limit data into the canonical `tenant_usage_limits` table (managed by super-admin-platform). To avoid
// re-introducing B's duplicate usage-limits module/routes, this thin adapter implements the NotificationMeter
// contract directly against that shared table using raw SQL (no kysely.types edits, same semantics as B):
//   - limit_value <= 0  → unlimited (always has capacity)
//   - otherwise         → has capacity iff used_value + amount <= limit_value
//   - adjust()          → best-effort increment of used_value (clamped at 0), never blocks the send
// Metrics: 'sms_credits' / 'email_credits' (see notifications-core.creditMetricForChannel).
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { NotificationMeter } from './notifications.service';

export class TenantUsageLimitsMeter implements NotificationMeter {
  constructor(private readonly db: Kysely<DB>) {}

  async hasCapacity(tenantId: string, metric: string, amount = 1): Promise<boolean> {
    if (!tenantId || !metric) return true;
    const res = await sql<{ limit_value: number; used_value: number }>`
      SELECT limit_value, used_value FROM tenant_usage_limits
      WHERE tenant_id = ${tenantId} AND metric = ${metric} LIMIT 1
    `.execute(this.db);
    const row = res.rows[0];
    if (!row) return true;                       // no cap configured → unlimited
    if (Number(row.limit_value) <= 0) return true; // 0 / negative → unlimited
    return Number(row.used_value) + Math.max(0, amount) <= Number(row.limit_value);
  }

  async adjust(tenantId: string, metric: string, delta: number): Promise<void> {
    if (!tenantId || !metric) return;
    const d = Math.trunc(Number(delta) || 0);
    if (d === 0) return;
    // Upsert the counter row, clamping used_value at 0. limit_value defaults to 0 (unlimited) when absent.
    await sql`
      INSERT INTO tenant_usage_limits (tenant_id, metric, limit_value, used_value)
      VALUES (${tenantId}, ${metric}, 0, GREATEST(0, ${d}))
      ON CONFLICT (tenant_id, metric)
      DO UPDATE SET used_value = GREATEST(0, tenant_usage_limits.used_value + ${d})
    `.execute(this.db);
  }
}
