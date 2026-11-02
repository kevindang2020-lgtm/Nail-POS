// smart-reminders.kysely.repository.ts — platform reminder-oversight aggregates over REAL tables:
// appointment_reminder_attempts (per-attempt: channel, status ∈ sent|failed|blocked, error, created_at),
// reminder_settings (per-tenant: enabled, channel, lead/window minutes), and tenants. Tenant-scoped via
// parseScope/andTenant; fail-soft (missing/empty tables yield neutral zeros).
import { type AppDatabase, andTenant, type OverviewScope } from '@aipowersalon/database';
import { sql } from 'kysely';

export interface Range { start: Date; end: Date }
const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => { try { return (await q.execute(db)).rows as T[]; } catch { return []; } };
const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => { try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; } };
const inWin = (r: Range, col = 'created_at') => sql`${sql.raw(col)} >= ${r.start.toISOString()}::timestamptz and ${sql.raw(col)} < ${r.end.toISOString()}::timestamptz`;

export class SmartRemindersRepository {
  constructor(private readonly db: AppDatabase) {}

  attemptCounts(scope: OverviewScope, r: Range) {
    return one<{ total: string; delivered: string; failed: string; blocked: string }>(this.db, sql`
      select count(*)::text as total,
        count(*) filter (where status = 'sent')::text as delivered,
        count(*) filter (where status = 'failed')::text as failed,
        count(*) filter (where status = 'blocked')::text as blocked
      from appointment_reminder_attempts where ${inWin(r)} ${andTenant(scope)}`,
      { total: '0', delivered: '0', failed: '0', blocked: '0' });
  }

  channelCounts(scope: OverviewScope, r: Range) {
    return rows<{ channel: string | null; total: string; delivered: string }>(this.db, sql`
      select channel, count(*)::text as total, count(*) filter (where status = 'sent')::text as delivered
      from appointment_reminder_attempts where ${inWin(r)} ${andTenant(scope)} group by channel`);
  }

  statusByDay(scope: OverviewScope, r: Range) {
    return rows<{ day: string; total: string; delivered: string; failed: string; blocked: string }>(this.db, sql`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::text as total,
        count(*) filter (where status = 'sent')::text as delivered,
        count(*) filter (where status = 'failed')::text as failed,
        count(*) filter (where status = 'blocked')::text as blocked
      from appointment_reminder_attempts where ${inWin(r)} ${andTenant(scope)} group by 1 order by 1`);
  }

  tenantUsage(scope: OverviewScope, r: Range, limit = 10) {
    return rows<{ tenant_id: string; tenant_name: string | null; total: string; delivered: string; failed: string; sms: string; email: string; push: string }>(this.db, sql`
      select a.tenant_id::text as tenant_id, coalesce(t.display_name, t.legal_name) as tenant_name,
        count(*)::text as total,
        count(*) filter (where a.status = 'sent')::text as delivered,
        count(*) filter (where a.status = 'failed')::text as failed,
        count(*) filter (where a.channel = 'sms')::text as sms,
        count(*) filter (where a.channel = 'email')::text as email,
        count(*) filter (where a.channel = 'push')::text as push
      from appointment_reminder_attempts a left join tenants t on t.id = a.tenant_id
      where ${inWin(r, 'a.created_at')} ${andTenant(scope, 'a.tenant_id')} group by 1, 2 order by count(*) desc limit ${limit}`);
  }

  recentActivity(scope: OverviewScope, limit = 6) {
    return rows<{ tenant_name: string | null; channel: string | null; status: string; error: string | null; created_at: string }>(this.db, sql`
      select coalesce(t.display_name, t.legal_name) as tenant_name, a.channel, a.status, a.error, a.created_at::text as created_at
      from appointment_reminder_attempts a left join tenants t on t.id = a.tenant_id
      where true ${andTenant(scope, 'a.tenant_id')} order by a.created_at desc limit ${limit}`);
  }

  failures(scope: OverviewScope, limit = 6) {
    return rows<{ tenant_name: string | null; channel: string | null; status: string; error: string | null; created_at: string }>(this.db, sql`
      select coalesce(t.display_name, t.legal_name) as tenant_name, a.channel, a.status, a.error, a.created_at::text as created_at
      from appointment_reminder_attempts a left join tenants t on t.id = a.tenant_id
      where a.status in ('failed','blocked') ${andTenant(scope, 'a.tenant_id')} order by a.created_at desc limit ${limit}`);
  }

  /** Tenants with any failed/blocked attempt in the window — a real "problematic" signal (flows aren't modelled). */
  problematicTenants(scope: OverviewScope, r: Range) {
    return one<{ c: string }>(this.db, sql`select count(distinct tenant_id)::text as c from appointment_reminder_attempts where status in ('failed','blocked') and ${inWin(r)} ${andTenant(scope)}`, { c: '0' });
  }

  /** reminder_settings aggregate: enabled configs (active flows), total customizations, channels configured. */
  settingsAgg(scope: OverviewScope) {
    return one<{ enabled: string; total: string; sms: string; email: string; avg_lead: string | null }>(this.db, sql`
      select count(*) filter (where enabled)::text as enabled, count(*)::text as total,
        count(*) filter (where channel = 'sms')::text as sms, count(*) filter (where channel = 'email')::text as email,
        round(avg(lead_minutes))::text as avg_lead
      from reminder_settings where true ${andTenant(scope)}`, { enabled: '0', total: '0', sms: '0', email: '0', avg_lead: null });
  }

  tenantsUsing(scope: OverviewScope, r: Range) {
    return one<{ c: string }>(this.db, sql`
      select count(distinct tid)::text as c from (
        select tenant_id as tid from appointment_reminder_attempts where ${inWin(r)} ${andTenant(scope)}
        union select tenant_id as tid from reminder_settings where enabled ${andTenant(scope)}
      ) u`, { c: '0' });
  }

  todayByChannel(scope: OverviewScope, dayStart: Date) {
    return rows<{ channel: string | null; total: string; delivered: string; failed: string }>(this.db, sql`
      select channel, count(*)::text as total, count(*) filter (where status='sent')::text as delivered, count(*) filter (where status='failed')::text as failed
      from appointment_reminder_attempts where created_at >= ${dayStart.toISOString()}::timestamptz ${andTenant(scope)} group by channel`);
  }

  async writeAudit(actor: { userId?: string; email?: string; ip?: string }, action: string, scope: OverviewScope, summary: string, metadata: unknown) {
    if (!scope.tenantId) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const actorId = actor.userId && uuid.test(actor.userId) ? actor.userId : null;
    try {
      await sql`insert into audit_events (tenant_id, occurred_at, actor_user_id, actor_name, module, action, resource_type, summary, status, severity, ip, metadata)
        values (${scope.tenantId}, now(), ${actorId}, ${actor.email ?? 'super_admin'}, 'smart-reminders', ${action}, 'smart_reminders', ${summary}, 'ok', 'info', ${actor.ip ?? null}, ${JSON.stringify(metadata ?? {})}::jsonb)`.execute(this.db as any);
    } catch { /* best-effort */ }
  }
}
