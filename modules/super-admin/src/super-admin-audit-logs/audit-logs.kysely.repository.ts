// audit-logs.kysely.repository.ts — READ-ONLY aggregates over the append-only audit_events table. This surface never
// writes to, edits, or deletes audit_events (tamper-resistance). Tenant-scoped via parseScope/andTenant; fail-soft.
import { type AppDatabase, andTenant, type OverviewScope } from '@aipowersalon/database';
import { sql } from 'kysely';

export interface Range { start: Date; end: Date }
const rows = async <T>(db: AppDatabase, q: any): Promise<T[]> => { try { return (await q.execute(db)).rows as T[]; } catch { return []; } };
const one = async <T>(db: AppDatabase, q: any, dflt: T): Promise<T> => { try { const r = (await q.execute(db)).rows[0]; return (r ?? dflt) as T; } catch { return dflt; } };
const inWin = (r: Range, col = 'occurred_at') => sql`${sql.raw(col)} >= ${r.start.toISOString()}::timestamptz and ${sql.raw(col)} < ${r.end.toISOString()}::timestamptz`;

export class AuditLogsRepository {
  constructor(private readonly db: AppDatabase) {}

  counts(scope: OverviewScope, r: Range) {
    return one<{ total: string; critical: string; failed_logins: string; data_exports: string; role_changes: string; support_access: string; ai_config: string }>(this.db, sql`
      select count(*)::text as total,
        count(*) filter (where lower(severity) in ('high','critical'))::text as critical,
        count(*) filter (where lower(action) like '%login%' and lower(status) in ('failed','error'))::text as failed_logins,
        count(*) filter (where lower(action) like '%export%')::text as data_exports,
        count(*) filter (where lower(action) like '%role%')::text as role_changes,
        count(*) filter (where lower(action) like '%support%' or lower(module) = 'support')::text as support_access,
        count(*) filter (where lower(module) like '%ai%' and lower(action) like '%config%')::text as ai_config
      from audit_events where ${inWin(r)} ${andTenant(scope)}`,
      { total: '0', critical: '0', failed_logins: '0', data_exports: '0', role_changes: '0', support_access: '0', ai_config: '0' });
  }

  byCategory(scope: OverviewScope, r: Range) {
    return rows<{ module: string | null; count: string }>(this.db, sql`
      select module, count(*)::text as count from audit_events where ${inWin(r)} ${andTenant(scope)} group by module order by count(*) desc`);
  }

  byResult(scope: OverviewScope, r: Range) {
    return rows<{ status: string | null; count: string }>(this.db, sql`
      select status, count(*)::text as count from audit_events where ${inWin(r)} ${andTenant(scope)} group by status`);
  }

  byDay(scope: OverviewScope, r: Range) {
    return rows<{ day: string; count: string }>(this.db, sql`
      select to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') as day, count(*)::text as count
      from audit_events where ${inWin(r)} ${andTenant(scope)} group by 1 order by 1`);
  }

  topUsers(scope: OverviewScope, r: Range, limit = 5) {
    return rows<{ actor_name: string | null; count: string }>(this.db, sql`
      select coalesce(actor_name, 'system') as actor_name, count(*)::text as count
      from audit_events where ${inWin(r)} ${andTenant(scope)} group by 1 order by count(*) desc limit ${limit}`);
  }

  suspicious(scope: OverviewScope, r: Range, limit = 6) {
    return rows<{ occurred_at: string; actor_name: string | null; action: string | null; status: string | null; severity: string | null; ip: string | null }>(this.db, sql`
      select occurred_at::text as occurred_at, actor_name, action, status, severity, ip
      from audit_events where ${inWin(r)} ${andTenant(scope)}
        and (lower(severity) in ('high','critical') or (lower(action) like '%login%' and lower(status) in ('failed','error')) or lower(action) like '%support%')
      order by occurred_at desc limit ${limit}`);
  }

  trail(scope: OverviewScope, r: Range, limit = 20) {
    return rows<{ occurred_at: string; actor_name: string | null; actor_role: string | null; tenant_name: string | null; action: string | null; module: string | null; status: string | null; severity: string | null; ip: string | null; device: string | null; summary: string | null; metadata: any }>(this.db, sql`
      select a.occurred_at::text as occurred_at, a.actor_name, a.actor_role, coalesce(t.display_name, t.legal_name) as tenant_name,
        a.action, a.module, a.status, a.severity, a.ip, a.device, a.summary, a.metadata
      from audit_events a left join tenants t on t.id = a.tenant_id
      where ${inWin(r, 'a.occurred_at')} ${andTenant(scope, 'a.tenant_id')} order by a.occurred_at desc, a.id desc limit ${limit}`);
  }

  recentExports(scope: OverviewScope, limit = 6) {
    return rows<{ occurred_at: string; actor_name: string | null; summary: string | null; module: string | null }>(this.db, sql`
      select occurred_at::text as occurred_at, actor_name, summary, module
      from audit_events where lower(action) like '%export%' ${andTenant(scope)} order by occurred_at desc limit ${limit}`);
  }

  beforeAfterEvents(scope: OverviewScope, limit = 6) {
    return rows<{ occurred_at: string; actor_name: string | null; action: string | null; metadata: any }>(this.db, sql`
      select occurred_at::text as occurred_at, actor_name, action, metadata
      from audit_events where (metadata ? 'before' or metadata ? 'after') ${andTenant(scope)} order by occurred_at desc limit ${limit}`);
  }

  accessSource(scope: OverviewScope, r: Range) {
    return rows<{ device: string | null; count: string }>(this.db, sql`
      select device, count(*)::text as count from audit_events where ${inWin(r)} ${andTenant(scope)} group by device order by count(*) desc`);
  }

  todayCounts(scope: OverviewScope, dayStart: Date) {
    return one<{ total: string; failed_logins: string; high_risk: string }>(this.db, sql`
      select count(*)::text as total,
        count(*) filter (where lower(action) like '%login%' and lower(status) in ('failed','error'))::text as failed_logins,
        count(*) filter (where lower(severity) in ('high','critical'))::text as high_risk
      from audit_events where occurred_at >= ${dayStart.toISOString()}::timestamptz ${andTenant(scope)}`,
      { total: '0', failed_logins: '0', high_risk: '0' });
  }

  // Legal hold register (separate table; safe to read even if migration not yet applied).
  // Deterministic, complete trail for evidence export: excludes the audit-log's own meta events (avoids auditing the
  // audit recursively), bounded to events at/before asOf, ordered stably so re-verification reproduces byte-for-byte.
  trailForExport(scope: OverviewScope, asOf: string, limit = 5000) {
    return rows<{ occurred_at: string; actor_name: string | null; actor_role: string | null; tenant_name: string | null; action: string | null; status: string | null; ip: string | null; device: string | null; summary: string | null; metadata: any }>(this.db, sql`
      select a.occurred_at::text as occurred_at, a.actor_name, a.actor_role, coalesce(t.display_name, t.legal_name) as tenant_name,
        a.action, a.status, a.ip, a.device, a.summary, a.metadata
      from audit_events a left join tenants t on t.id = a.tenant_id
      where a.occurred_at <= ${asOf}::timestamptz and coalesce(a.module,'') <> 'audit-logs' ${andTenant(scope, 'a.tenant_id')}
      order by a.occurred_at desc, a.id desc limit ${limit}`);
  }

  legalHoldActiveCount() {
    return one<{ c: string }>(this.db, sql`select count(*)::text as c from audit_legal_holds where status = 'active'`, { c: '0' }).then((r) => Number(r.c) || 0);
  }
  legalHoldRecords(limit = 6) {
    return rows<{ hold_ref: string; scope_type: string; scope_value: string | null; status: string; reason: string; created_at: string }>(this.db, sql`
      select hold_ref, scope_type, scope_value, status, reason, created_at::text as created_at from audit_legal_holds order by created_at desc limit ${limit}`);
  }

  // Investigation case register (separate table).
  investigationsOpenCount() {
    return one<{ c: string }>(this.db, sql`select count(*)::text as c from audit_investigations where status = any(array['open','in_progress','waiting','escalated','reopened'])`, { c: '0' }).then((r) => Number(r.c) || 0);
  }
  investigationsRecent(limit = 6) {
    return rows<{ case_ref: string; title: string; severity: string; assignee: string | null; status: string }>(this.db, sql`
      select case_ref, title, severity, assignee, status from audit_investigations where status = any(array['open','in_progress','waiting','escalated','reopened']) order by created_at desc limit ${limit}`);
  }

  // Evidence packet register (separate table).
  evidenceReadyCount() {
    return one<{ c: string }>(this.db, sql`select count(*)::text as c from audit_evidence_packs where status = 'ready'`, { c: '0' }).then((r) => Number(r.c) || 0);
  }
  exportFlagsOpenCount() {
    return one<{ c: string }>(this.db, sql`select count(*)::text as c from audit_export_flags where status = 'open'`, { c: '0' }).then((r) => Number(r.c) || 0);
  }
}
