// communications-limits.kysely.repository.ts — persistence + real usage for tenant messaging limits (§36). Writes are
// non-swallowing. Usage is counted from the canonical delivery log for the current calendar month, by channel, so the
// enforcement evaluator compares configured limits against REAL consumption. "This month" and "today" are the SALON's
// (its main location's zone) — not the database's UTC, which rolled a New York salon's day over at 8 pm (Oct 6 2026).
import { sql } from 'kysely';
import { tenantTimeZone, type AppDatabase } from '@aipowersalon/database';
import { dayStartMs, monthStartMs } from '@aipowersalon/date-time';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_MESSAGING_LIMIT } from '../communications-lifecycles';

export interface LimitRow {
  tenant_id: string; monthly_sms: number | null; monthly_email: number | null; monthly_push: number | null;
  daily_limit: number | null; enforcement: string; opt_out_rate_threshold_bps: number | null;
  failure_rate_threshold_bps: number | null; status: string; updated_at: string;
}

export class CommunicationsLimitsRepository {
  constructor(private readonly db: AppDatabase) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;
  private async since(tenantId: string, start: (tz: string, now: Date) => number): Promise<Date> {
    return new Date(start(await tenantTimeZone(this.db, tenantId), new Date(this.now())));
  }

  async tenantExists(tenantId: string): Promise<boolean> {
    const r = (await sql`select 1 as ok from tenants where id = ${tenantId} limit 1`.execute(this.db as any)).rows[0] as { ok: number } | undefined;
    return !!r;
  }

  async getLimit(tenantId: string): Promise<LimitRow | null> {
    const r = (await sql`select tenant_id::text as tenant_id, monthly_sms, monthly_email, monthly_push, daily_limit, enforcement, opt_out_rate_threshold_bps, failure_rate_threshold_bps, status, updated_at::text as updated_at from tenant_messaging_limits where tenant_id = ${tenantId} limit 1`.execute(this.db as any)).rows[0] as LimitRow | undefined;
    return r ?? null;
  }

  /** Month-to-date sent counts by channel for the tenant (the salon's calendar month). */
  async monthUsage(tenantId: string): Promise<{ sms: number; email: number; push: number; total: number }> {
    const r = (await sql`
      select
        count(*) filter (where channel = 'sms')::int as sms,
        count(*) filter (where channel = 'email')::int as email,
        count(*) filter (where channel = 'push')::int as push,
        count(*)::int as total
      from notification_delivery_logs
      where tenant_id = ${tenantId} and created_at >= ${(await this.since(tenantId, monthStartMs)) as any}`.execute(this.db as any)).rows[0] as { sms: number; email: number; push: number; total: number };
    return r ?? { sms: 0, email: 0, push: 0, total: 0 };
  }

  /** Today's (the salon's day) sent count for daily-limit evaluation. */
  async todayUsage(tenantId: string): Promise<number> {
    const r = (await sql`select count(*)::int as c from notification_delivery_logs where tenant_id = ${tenantId} and created_at >= ${(await this.since(tenantId, dayStartMs)) as any}`.execute(this.db as any)).rows[0] as { c: number };
    return r?.c ?? 0;
  }

  async upsertLimit(tenantId: string, i: { monthlySms: number | null; monthlyEmail: number | null; monthlyPush: number | null; dailyLimit: number | null; enforcement: string; optOutBps: number | null; failureBps: number | null; status: string; updatedBy: string | null }): Promise<void> {
    await sql`
      insert into tenant_messaging_limits (tenant_id, monthly_sms, monthly_email, monthly_push, daily_limit, enforcement, opt_out_rate_threshold_bps, failure_rate_threshold_bps, status, updated_by, updated_at)
      values (${tenantId}, ${i.monthlySms}, ${i.monthlyEmail}, ${i.monthlyPush}, ${i.dailyLimit}, ${i.enforcement}, ${i.optOutBps}, ${i.failureBps}, ${i.status}, ${i.updatedBy}, now())
      on conflict (tenant_id) do update set
        monthly_sms = excluded.monthly_sms, monthly_email = excluded.monthly_email, monthly_push = excluded.monthly_push,
        daily_limit = excluded.daily_limit, enforcement = excluded.enforcement,
        opt_out_rate_threshold_bps = excluded.opt_out_rate_threshold_bps, failure_rate_threshold_bps = excluded.failure_rate_threshold_bps,
        status = excluded.status, updated_by = excluded.updated_by, updated_at = now()
      where ${canMoveToSql(TENANT_MESSAGING_LIMIT, i.status, 'tenant_messaging_limits')}`.execute(this.db as any);
  }

  async writeAudit(tenantId: string, actor: { userId?: string; email?: string; ip?: string }, action: string, summary: string, metadata: unknown) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'communications', ${action}, 'tenant_messaging_limit', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
