// Kysely implementation — reads real auth/session/privacy/alert/audit/backup sources. No writes. Roles are uppercase in
// the real schema (SUPER_ADMIN/OWNER/MANAGER/FRONT_DESK/…); CUSTOMER rows are excluded from staff/security counts.
import { safeInet, type AppDatabase } from '@aipowersalon/database';
import { sql } from 'kysely';
import type { SecurityRepositoryPort, SecurityKpiTotals, DayCount, AuthRow, SessionRow, PrivacyRow, RoleRow, AlertRow, AuditRow, BlockedIpRow, IncidentLogRow, WorkflowStages } from './security.repository';

const n = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => { if (!v) return null; try { return new Date(v as any).toISOString(); } catch { return null; } };
const one = async (db: AppDatabase, q: any) => q.execute(db).then((x: any) => x.rows[0]).catch(() => undefined);
const many = async (db: AppDatabase, q: any) => q.execute(db).then((x: any) => x.rows).catch(() => []);

export class KyselySecurityRepository implements SecurityRepositoryPort {
  constructor(private readonly db: AppDatabase) {}

  async kpiTotals(): Promise<SecurityKpiTotals> {
    const u: any = await one(this.db, sql`select count(*) filter (where role <> 'CUSTOMER' and status = 'active')::int total, count(*) filter (where role <> 'CUSTOMER' and status = 'active' and mfa_enabled = true)::int mfa, count(*) filter (where role in ('SUPER_ADMIN','OWNER'))::int privileged from users`);
    const f: any = await one(this.db, sql`select count(*)::int c from login_attempts where success = false and created_at >= now() - interval '7 days'`);
    const s: any = await one(this.db, sql`select count(*) filter (where status = 'suspicious')::int suspicious, count(*) filter (where status = 'active' and expires_at > now())::int active from sessions`);
    const e: any = await one(this.db, sql`select count(*)::int c from report_exports where created_at >= now() - interval '7 days'`);
    const p: any = await one(this.db, sql`select count(*)::int c from customer_privacy_requests where status not in ('completed','rejected')`);
    const b: any = await one(this.db, sql`select count(*)::int total, count(*) filter (where status = 'completed')::int done from tenant_backup_requests`);
    const backupRate = b && n(b.total) > 0 ? Math.round((n(b.done) / n(b.total)) * 1000) / 10 : null;
    return { twoFaEnabled: n(u?.mfa), twoFaTotal: n(u?.total), failedLogins7d: n(f?.c), suspiciousSessions: n(s?.suspicious), privilegedAccounts: n(u?.privileged), dataExportEvents7d: n(e?.c), privacyRequestsOpen: n(p?.c), activeSessions: n(s?.active), backupSuccessRatePct: backupRate };
  }

  async failedLoginTrend7d(): Promise<DayCount[]> {
    const rows = await many(this.db, sql`select created_at::date d, count(*)::int c from login_attempts where success = false and created_at >= current_date - interval '6 days' group by created_at::date order by created_at::date`);
    return rows.map((r: any) => ({ day: iso(r.d) || String(r.d), count: n(r.c) }));
  }

  async authOverview(limit: number): Promise<AuthRow[]> {
    const rows = await many(this.db, sql`
      select u.id, u.full_name, u.role, u.mfa_enabled, u.last_login_at,
        (select count(*)::int from login_attempts la where la.identifier = u.email and la.success = false and la.created_at >= now() - interval '7 days') failed,
        (select status from sessions s where s.user_id = u.id order by s.created_at desc limit 1) sess_status
      from users u where u.role <> 'CUSTOMER' order by u.role, u.full_name limit ${limit}`);
    return rows.map((r: any) => ({ userId: String(r.id), name: r.full_name || '—', role: r.role, mfaEnabled: !!r.mfa_enabled, lastLogin: iso(r.last_login_at), failedLogins: n(r.failed), sessionStatus: r.sess_status || 'none', privileged: ['SUPER_ADMIN', 'OWNER'].includes(r.role) }));
  }

  async activeSessions(limit: number): Promise<SessionRow[]> {
    const rows = await many(this.db, sql`select s.user_id, u.full_name, u.role, s.ip_address, s.user_agent, s.status, s.created_at from sessions s left join users u on u.id = s.user_id where s.status <> 'revoked' order by s.created_at desc limit ${limit}`);
    return rows.map((r: any) => ({ userId: String(r.user_id), name: r.full_name || '—', role: r.role || '—', ip: r.ip_address || null, device: r.user_agent || null, status: r.status, lastActivity: iso(r.created_at) }));
  }

  async privacyRequests(limit: number): Promise<PrivacyRow[]> {
    const rows = await many(this.db, sql`select request_type, count(*)::int events, max(status) status, max(requester_name) requester, max(due_at) due, max(assigned_to_user_id::text) owner from customer_privacy_requests group by request_type order by count(*) desc limit ${limit}`);
    return rows.map((r: any) => ({ requestType: r.request_type, events: n(r.events), status: r.status, requester: r.requester || null, dueDate: iso(r.due), owner: r.owner || null }));
  }

  async roleRestrictions(): Promise<RoleRow[]> {
    const r: any = await one(this.db, sql`select count(*) filter (where role = 'SUPER_ADMIN')::int sa, count(*) filter (where role in ('OWNER','ADMIN'))::int ad, count(*) filter (where role = 'MANAGER')::int mg, count(*) filter (where role in ('FRONT_DESK','RECEPTION','TECHNICIAN','STAFF'))::int st from users`);
    return [
      { roleCategory: 'Super Admin', users: n(r?.sa), privileged: 'Full Access' },
      { roleCategory: 'Admin', users: n(r?.ad), privileged: 'High Access' },
      { roleCategory: 'Manager', users: n(r?.mg), privileged: 'Limited Access' },
      { roleCategory: 'Staff', users: n(r?.st), privileged: 'No Privileged Access' },
    ];
  }

  async recentAlerts(limit: number): Promise<AlertRow[]> {
    const rows = await many(this.db, sql`select id, title, severity, status, tenant_name, created_at from alerts order by created_at desc limit ${limit}`);
    return rows.map((r: any) => ({ id: String(r.id), title: r.title, severity: r.severity || null, status: r.status || null, tenant: r.tenant_name || null, createdAt: iso(r.created_at) }));
  }

  async auditFeed(limit: number): Promise<AuditRow[]> {
    const rows = await many(this.db, sql`select id, occurred_at, actor_name, actor_role, module, action, status, severity, ip, tenant_id from audit_events order by occurred_at desc limit ${limit}`);
    return rows.map((r: any) => ({ id: String(r.id), occurredAt: iso(r.occurred_at), actorName: r.actor_name || null, actorRole: r.actor_role || null, module: r.module || null, action: r.action || null, status: r.status || null, severity: r.severity || null, ip: (safeInet(r?.ip) ?? undefined) || null, tenant: r.tenant_id ? String(r.tenant_id) : null }));
  }

  async failedLoginsToday(): Promise<number> { const r: any = await one(this.db, sql`select count(*)::int c from login_attempts where success = false and created_at::date = current_date`); return n(r?.c); }
  async sessionsRevokedToday(): Promise<number> { const r: any = await one(this.db, sql`select count(*)::int c from sessions where revoked_at::date = current_date`); return n(r?.c); }
  async backupJobsCompletedToday(): Promise<{ completed: number; total: number }> { const r: any = await one(this.db, sql`select count(*)::int total, count(*) filter (where status = 'completed')::int done from tenant_backup_requests where created_at::date = current_date`); return { completed: n(r?.done), total: n(r?.total) }; }

  async recentBlockedIps(limit: number): Promise<BlockedIpRow[]> {
    const rows = await many(this.db, sql`select target, threat_type, country, blocked_at, status from ip_block_rules where is_allowlist = false order by blocked_at desc limit ${limit}`);
    return rows.map((r: any) => ({ target: r.target, threatType: r.threat_type || null, country: r.country || null, blockedAt: iso(r.blocked_at), status: r.status }));
  }
  async blockedIpsActive(): Promise<number> { const r: any = await one(this.db, sql`select count(*)::int c from ip_block_rules where is_allowlist = false and status = 'blocked'`); return n(r?.c); }
  async blockedIpsToday(): Promise<number> { const r: any = await one(this.db, sql`select count(*)::int c from ip_block_rules where is_allowlist = false and blocked_at::date = current_date`); return n(r?.c); }


  async recentIncidents(limit: number): Promise<IncidentLogRow[]> {
    const rows = await many(this.db, sql`select incident_ref, tenant_id, severity, status, assigned_to_user_id, updated_at from security_incidents order by detected_at desc limit ${limit}`);
    return rows.map((r: any) => ({ incidentRef: r.incident_ref, tenant: r.tenant_id ? String(r.tenant_id) : null, severity: r.severity, status: r.status, assignedTo: r.assigned_to_user_id ? String(r.assigned_to_user_id) : null, updatedAt: iso(r.updated_at) }));
  }
  async incidentWorkflow(): Promise<WorkflowStages> {
    const rows = await many(this.db, sql`select status, count(*)::int c from security_incidents group by status`);
    const m: Record<string, number> = {}; rows.forEach((r: any) => { m[r.status] = n(r.c); });
    return { detected: m.detected || 0, investigating: m.investigating || 0, contained: m.contained || 0, remediating: m.remediating || 0, closed: (m.closed || 0) + (m.monitoring || 0) };
  }
  async incidentsOpen(): Promise<number> { const r: any = await one(this.db, sql`select count(*)::int c from security_incidents where status <> 'closed'`); return n(r?.c); }
  async incidentsOpenedToday(): Promise<number> { const r: any = await one(this.db, sql`select count(*)::int c from security_incidents where detected_at::date = current_date`); return n(r?.c); }

  async policyCompliance(): Promise<{ session: boolean | null; password: boolean | null; mfa: boolean | null }> {
    const rows = await many(this.db, sql`select distinct on (kind) kind, compliant from security_policies where status = 'active' order by kind, version desc`);
    const m: Record<string, boolean> = {}; rows.forEach((r: any) => { m[r.kind] = r.compliant === true; });
    const g = (k: string) => Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null;
    return { session: g('session'), password: g('password'), mfa: g('mfa') };
  }

  async activePrivilegedGrants(): Promise<number> { const r: any = await one(this.db, sql`select count(*)::int c from privileged_access_grants where status = 'active' and expires_at > now()`); return n(r?.c); }
}
