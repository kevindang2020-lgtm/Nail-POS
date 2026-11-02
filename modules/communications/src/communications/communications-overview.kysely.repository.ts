// communications-overview.kysely.repository.ts — platform messaging oversight aggregates over REAL tables:
// notification_delivery_logs (canonical unified delivery log: channel, status, provider_id, template, error), plus
// notification_opt_outs, pos_message_templates, and tenants. Tenant-scoped via parseScope/andTenant. Fail-soft
// (missing/empty tables yield neutral zeros). No secrets; targets are already masked in these tables.
import { type AppDatabase, andTenant, type OverviewScope } from '@aipowersalon/database';
import { sql } from 'kysely';

export interface Range { start: Date; end: Date }
const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => { try { return (await q.execute(db)).rows as T[]; } catch { return []; } };
const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => { try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; } };
const inWindow = (r: Range, col = 'created_at') => sql`${sql.raw(col)} >= ${r.start.toISOString()}::timestamptz and ${sql.raw(col)} < ${r.end.toISOString()}::timestamptz`;

export class CommunicationsOverviewRepository {
  constructor(private readonly db: AppDatabase) {}

  /** Sent/delivered/failed/suppressed over a window (canonical delivery log). */
  kpiCounts(scope: OverviewScope, r: Range) {
    return one<{ sent: string; delivered: string; failed: string; suppressed: string }>(this.db, sql`
      select count(*)::text as sent,
        count(*) filter (where status = 'delivered')::text as delivered,
        count(*) filter (where status in ('failed','error','undelivered'))::text as failed,
        count(*) filter (where status in ('suppressed','blocked'))::text as suppressed
      from notification_delivery_logs where ${inWindow(r)} ${andTenant(scope)}`,
      { sent: '0', delivered: '0', failed: '0', suppressed: '0' });
  }

  optOutCount(scope: OverviewScope, r: Range) {
    return one<{ window: string; total: string }>(this.db, sql`
      select count(*) filter (where opted_out_at >= ${r.start.toISOString()}::timestamptz and opted_out_at < ${r.end.toISOString()}::timestamptz)::text as window,
        count(*)::text as total
      from notification_opt_outs where true ${andTenant(scope)}`, { window: '0', total: '0' });
  }

  channelCounts(scope: OverviewScope, r: Range) {
    return rows<{ channel: string | null; sent: string; delivered: string; failed: string }>(this.db, sql`
      select channel, count(*)::text as sent,
        count(*) filter (where status = 'delivered')::text as delivered,
        count(*) filter (where status in ('failed','error','undelivered'))::text as failed
      from notification_delivery_logs where ${inWindow(r)} ${andTenant(scope)} group by channel`);
  }

  statusByDay(scope: OverviewScope, r: Range) {
    return rows<{ day: string; sent: string; delivered: string; failed: string; suppressed: string }>(this.db, sql`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
        count(*)::text as sent,
        count(*) filter (where status = 'delivered')::text as delivered,
        count(*) filter (where status in ('failed','error','undelivered'))::text as failed,
        count(*) filter (where status in ('suppressed','blocked'))::text as suppressed
      from notification_delivery_logs where ${inWindow(r)} ${andTenant(scope)} group by 1 order by 1`);
  }

  providerAgg(scope: OverviewScope, r: Range) {
    return rows<{ provider_id: string | null; delivered: string; failed: string; total: string }>(this.db, sql`
      select provider_id,
        count(*) filter (where status = 'delivered')::text as delivered,
        count(*) filter (where status in ('failed','error','undelivered'))::text as failed,
        count(*)::text as total
      from notification_delivery_logs where ${inWindow(r)} ${andTenant(scope)} group by provider_id`);
  }

  tenantUsage(scope: OverviewScope, r: Range, limit = 8) {
    return rows<{ tenant_id: string; tenant_name: string | null; sent: string; delivered: string; failed: string }>(this.db, sql`
      select l.tenant_id::text as tenant_id, coalesce(t.display_name, t.legal_name) as tenant_name,
        count(*)::text as sent,
        count(*) filter (where l.status = 'delivered')::text as delivered,
        count(*) filter (where l.status in ('failed','error','undelivered'))::text as failed
      from notification_delivery_logs l left join tenants t on t.id = l.tenant_id
      where ${inWindow(r, 'l.created_at')} ${andTenant(scope, 'l.tenant_id')} group by 1, 2 order by count(*) desc limit ${limit}`);
  }

  tenantOptOuts(scope: OverviewScope) {
    return rows<{ tenant_id: string; opt_outs: string }>(this.db, sql`
      select tenant_id::text as tenant_id, count(*)::text as opt_outs from notification_opt_outs
      where true ${andTenant(scope)} group by 1`);
  }

  recentFailures(scope: OverviewScope, limit = 6) {
    return rows<{ tenant_name: string | null; channel: string | null; template: string | null; error_message: string | null; provider_id: string | null; created_at: string }>(this.db, sql`
      select coalesce(t.display_name, t.legal_name) as tenant_name, l.channel, l.template, l.error_message, l.provider_id, l.created_at::text as created_at
      from notification_delivery_logs l left join tenants t on t.id = l.tenant_id
      where l.status in ('failed','error','undelivered') ${andTenant(scope, 'l.tenant_id')}
      order by l.created_at desc limit ${limit}`);
  }

  topActivity(scope: OverviewScope, r: Range, limit = 6) {
    return rows<{ template: string | null; channel: string | null; sent: string; delivered: string; tenants: string }>(this.db, sql`
      select coalesce(template, '(ad hoc)') as template, channel,
        count(*)::text as sent,
        count(*) filter (where status = 'delivered')::text as delivered,
        count(distinct tenant_id)::text as tenants
      from notification_delivery_logs where ${inWindow(r)} ${andTenant(scope)}
      group by 1, 2 order by count(*) desc limit ${limit}`);
  }

  templateCount(scope: OverviewScope) {
    return one<{ c: string }>(this.db, sql`select count(*)::text as c from pos_message_templates where true ${andTenant(scope)}`, { c: '0' });
  }

  activeTenantsMessaging(scope: OverviewScope, r: Range) {
    return one<{ c: string }>(this.db, sql`select count(distinct tenant_id)::text as c from notification_delivery_logs where ${inWindow(r)} ${andTenant(scope)}`, { c: '0' });
  }

  /** Today's per-channel counts + delivery for the At-a-Glance summary. */
  todayByChannel(scope: OverviewScope, dayStart: Date) {
    return rows<{ channel: string | null; sent: string; delivered: string }>(this.db, sql`
      select channel, count(*)::text as sent, count(*) filter (where status = 'delivered')::text as delivered
      from notification_delivery_logs where created_at >= ${dayStart.toISOString()}::timestamptz ${andTenant(scope)} group by channel`);
  }

  async writeAudit(actor: { userId?: string; email?: string; ip?: string }, action: string, scope: OverviewScope, summary: string, metadata: unknown) {
    if (!scope.tenantId) return; // audit_events.tenant_id NOT NULL → only tenant-scoped reads recorded here
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${scope.tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'communications', ${action}, 'communications', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort audit */ }
  }
}
