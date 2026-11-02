// Kysely (Postgres) repo for System Status, reading/writing the status_components + status_incidents +
// status_scheduled_maintenance + status_public_updates tables (migrations 147 + 187). Reads are resilient: if a table
// is empty or unavailable, methods return empty lists so the page renders honestly rather than erroring. Writes audit.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SystemStatusRepo, MaintenanceRow, PublicUpdateRow, IncidentHistoryRow, PostIncidentReportRow, CommunicationRow, RecoveryRow, ImpactRow } from './system-status.repository';
import type { ComponentLike, IncidentLike } from './system-status-core';
import { canMoveToSql } from '@aipowersalon/database';
import { STATUS_INCIDENT } from './incident-lifecycle';

const iso = (d: unknown): string | null => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const durationLabel = (startMs: number, endMs: number): string => {
  const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

export class KyselySystemStatusRepo implements SystemStatusRepo {
  constructor(private readonly db: Kysely<DB>) {}

  async components(): Promise<ComponentLike[]> {
    try {
      const r = await sql<any>`SELECT key, name, category, status, uptime_pct, response_time_ms, owner_team, affected_tenants, last_incident_at FROM status_components ORDER BY sort_order, name`.execute(this.db);
      return r.rows.map((x) => ({ key: x.key, name: x.name, category: x.category, status: x.status, uptimePct: num(x.uptime_pct), responseTimeMs: num(x.response_time_ms), ownerTeam: x.owner_team, affectedTenants: Number(x.affected_tenants || 0), lastIncidentAt: iso(x.last_incident_at) }));
    } catch { return []; }
  }
  async incidents(): Promise<IncidentLike[]> {
    try {
      const r = await sql<any>`SELECT id, incident_reference, title, component_key, severity, status, impact, started_at, resolved_at, affected_tenants FROM status_incidents ORDER BY started_at DESC LIMIT 500`.execute(this.db);
      return r.rows.map((x) => ({ id: x.id, reference: x.incident_reference, title: x.title, componentKey: x.component_key, severity: x.severity || 'medium', status: x.status, impact: x.impact || 'minor', startedAt: iso(x.started_at) as string, resolvedAt: iso(x.resolved_at), affectedTenants: Number(x.affected_tenants || 0) }));
    } catch { return []; }
  }
  async scheduledMaintenance(): Promise<MaintenanceRow[]> {
    try {
      const r = await sql<any>`SELECT service, scope, window_start, window_end, tenant_impact, notice_status, owner_team FROM status_scheduled_maintenance WHERE notice_status <> 'cancelled' ORDER BY window_start LIMIT 100`.execute(this.db);
      return r.rows.map((x) => ({ service: x.service || '—', scope: x.scope || 'Global', windowStart: iso(x.window_start) as string, windowEnd: iso(x.window_end) as string, tenantImpact: Number(x.tenant_impact || 0), noticeStatus: x.notice_status, owner: x.owner_team || '—' }));
    } catch { return []; }
  }
  async publicUpdates(): Promise<PublicUpdateRow[]> {
    try {
      const r = await sql<any>`SELECT title, audience, status, COALESCE(published_at, created_at) AS ts FROM status_public_updates ORDER BY COALESCE(published_at, created_at) DESC LIMIT 50`.execute(this.db);
      return r.rows.map((x) => ({ time: iso(x.ts) as string, title: x.title, audience: x.audience, status: x.status }));
    } catch { return []; }
  }
  async incidentHistory(): Promise<IncidentHistoryRow[]> {
    try {
      const r = await sql<any>`SELECT incident_reference, component_key, severity, root_cause, started_at, resolved_at, status FROM status_incidents WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 25`.execute(this.db);
      const comps = await this.components();
      const nameFor = (k: string | null) => comps.find((c) => c.key === k)?.name || k || '—';
      return r.rows.map((x) => ({
        incidentId: x.incident_reference || '—', service: nameFor(x.component_key), severity: (x.severity || 'medium').replace(/\b\w/, (c: string) => c.toUpperCase()),
        rootCause: x.root_cause || '—', duration: durationLabel(Date.parse(iso(x.started_at) as string), Date.parse(iso(x.resolved_at) as string)), status: 'Resolved',
      }));
    } catch { return []; }
  }
  async incidentReportsThisMonth(): Promise<number> {
    try { const r = await sql<{ n: number }>`SELECT count(*)::int AS n FROM status_incidents WHERE started_at >= date_trunc('month', now())`.execute(this.db); return Number(r.rows[0]?.n ?? 0); } catch { return 0; }
  }

  async createIncident(input: { title: string; componentKey: string; severity: string; impact: string; affectedTenants: number }): Promise<IncidentLike> {
    const d = new Date();
    const ref = `INC-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 900) + 100)}`;
    const r = await sql<any>`INSERT INTO status_incidents (incident_reference, title, component_key, severity, status, impact, affected_tenants, started_at) VALUES (${ref}, ${input.title}, ${input.componentKey}, ${input.severity}, 'investigating', ${input.impact}, ${input.affectedTenants}, now()) RETURNING id, incident_reference, title, component_key, severity, status, impact, started_at, resolved_at, affected_tenants`.execute(this.db);
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, created_at) VALUES ('status_incident_created', 'status_incident', ${r.rows[0].id}, now())`.execute(this.db); } catch { /* best-effort */ }
    const x = r.rows[0];
    return { id: x.id, reference: x.incident_reference, title: x.title, componentKey: x.component_key, severity: x.severity, status: x.status, impact: x.impact, startedAt: iso(x.started_at) as string, resolvedAt: iso(x.resolved_at), affectedTenants: Number(x.affected_tenants || 0) };
  }
  async updateIncidentStatus(id: string, status: string): Promise<IncidentLike | null> {
    const resolved = status === 'resolved' ? sql`, resolved_at = COALESCE(resolved_at, now())` : sql``;
    const r = await sql<any>`UPDATE status_incidents SET status = ${status} ${resolved} WHERE (id::text = ${id} OR incident_reference = ${id}) AND ${canMoveToSql(STATUS_INCIDENT, status)} RETURNING id, incident_reference, title, component_key, severity, status, impact, started_at, resolved_at, affected_tenants`.execute(this.db);
    if (!r.rows[0]) return null;
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, entity_id, created_at) VALUES ('status_incident_status', 'status_incident', ${r.rows[0].id}, now())`.execute(this.db); } catch { /* best-effort */ }
    const x = r.rows[0];
    return { id: x.id, reference: x.incident_reference, title: x.title, componentKey: x.component_key, severity: x.severity, status: x.status, impact: x.impact, startedAt: iso(x.started_at) as string, resolvedAt: iso(x.resolved_at), affectedTenants: Number(x.affected_tenants || 0) };
  }
  async publishUpdate(input: { title: string; body: string | null; audience: string; incidentId: string | null }): Promise<PublicUpdateRow> {
    const r = await sql<any>`INSERT INTO status_public_updates (incident_id, title, body, audience, status, published_at) VALUES (${input.incidentId}, ${input.title}, ${input.body}, ${input.audience}, 'published', now()) RETURNING title, audience, status, published_at`.execute(this.db);
    const x = r.rows[0];
    return { time: iso(x.published_at) as string, title: x.title, audience: x.audience, status: x.status };
  }
  async scheduleMaintenance(input: { service: string; scope: string; windowStart: string; windowEnd: string; tenantImpact: number; owner: string }): Promise<MaintenanceRow> {
    const r = await sql<any>`INSERT INTO status_scheduled_maintenance (service, scope, window_start, window_end, tenant_impact, notice_status, owner_team) VALUES (${input.service}, ${input.scope}, ${input.windowStart}, ${input.windowEnd}, ${input.tenantImpact}, 'published', ${input.owner}) RETURNING service, scope, window_start, window_end, tenant_impact, notice_status, owner_team`.execute(this.db);
    const x = r.rows[0];
    return { service: x.service, scope: x.scope, windowStart: iso(x.window_start) as string, windowEnd: iso(x.window_end) as string, tenantImpact: Number(x.tenant_impact || 0), noticeStatus: x.notice_status, owner: x.owner_team || '—' };
  }
  async postIncidentReports(): Promise<PostIncidentReportRow[]> {
    try {
      const r = await sql<any>`SELECT report_reference, title, incident_reference, owner, status, published_at FROM status_post_incident_reports ORDER BY COALESCE(published_at, created_at) DESC LIMIT 50`.execute(this.db);
      return r.rows.map((x) => ({ reportReference: x.report_reference, title: x.title, incidentReference: x.incident_reference, owner: x.owner || '—', status: x.status, publishedAt: iso(x.published_at) }));
    } catch { return []; }
  }
  async createPostIncidentReport(input: { title: string; incidentReference: string; summary: string | null; rootCause: string | null; owner: string }): Promise<PostIncidentReportRow> {
    const d = new Date();
    const ref = `PIR-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 900) + 100)}`;
    const r = await sql<any>`INSERT INTO status_post_incident_reports (report_reference, title, incident_reference, summary, root_cause, owner, status, published_at) VALUES (${ref}, ${input.title}, ${input.incidentReference}, ${input.summary}, ${input.rootCause}, ${input.owner}, 'published', now()) RETURNING report_reference, title, incident_reference, owner, status, published_at`.execute(this.db);
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, created_at) VALUES ('status_pir_created', 'status_post_incident_report', now())`.execute(this.db); } catch { /* best-effort */ }
    const x = r.rows[0];
    return { reportReference: x.report_reference, title: x.title, incidentReference: x.incident_reference, owner: x.owner || '—', status: x.status, publishedAt: iso(x.published_at) };
  }
  async healthTrend(): Promise<{ date: string; score: number }[]> {
    try {
      const r = await sql<any>`SELECT snapshot_date, health_score FROM status_health_snapshots WHERE snapshot_date >= (now()::date - INTERVAL '6 days') ORDER BY snapshot_date`.execute(this.db);
      return r.rows.map((x) => ({ date: (iso(x.snapshot_date) as string).slice(0, 10), score: Number(x.health_score) }));
    } catch { return []; }
  }
  async communications(): Promise<CommunicationRow[]> {
    try {
      const r = await sql<any>`SELECT sent_at, channel, audience, message, sent_by FROM status_communications ORDER BY sent_at DESC LIMIT 50`.execute(this.db);
      return r.rows.map((x) => ({ time: iso(x.sent_at) as string, channel: x.channel, audience: x.audience, message: x.message, sentBy: x.sent_by || 'System' }));
    } catch { return []; }
  }
  async notifyTenants(input: { message: string; channel: string; audience: string; incidentReference: string | null; sentBy: string }): Promise<CommunicationRow> {
    const r = await sql<any>`INSERT INTO status_communications (incident_reference, channel, audience, message, sent_by) VALUES (${input.incidentReference}, ${input.channel}, ${input.audience}, ${input.message}, ${input.sentBy}) RETURNING sent_at, channel, audience, message, sent_by`.execute(this.db);
    try { await sql`INSERT INTO audit_logs (action_type, entity_type, created_at) VALUES ('status_tenants_notified', 'status_communication', now())`.execute(this.db); } catch { /* best-effort */ }
    const x = r.rows[0];
    return { time: iso(x.sent_at) as string, channel: x.channel, audience: x.audience, message: x.message, sentBy: x.sent_by || 'System' };
  }
  async recoveryProgress(): Promise<RecoveryRow[]> {
    try {
      const r = await sql<any>`SELECT incident_reference, recovery_percentage, next_milestone, recovery_owner FROM status_incidents WHERE status <> 'resolved' AND (recovery_percentage > 0 OR next_milestone IS NOT NULL) ORDER BY started_at DESC LIMIT 25`.execute(this.db);
      return r.rows.map((x) => ({ incident: x.incident_reference || '—', percentRecovered: Number(x.recovery_percentage || 0), nextMilestone: x.next_milestone || '—', owner: x.recovery_owner || '—' }));
    } catch { return []; }
  }
  async affectedTenants(): Promise<ImpactRow[]> {
    try {
      const r = await sql<any>`SELECT tenant_name, branch_name, service, impact_level, comm_status FROM status_incident_impact ORDER BY created_at DESC LIMIT 50`.execute(this.db);
      const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      return r.rows.map((x) => ({ tenant: x.tenant_name || '—', branch: x.branch_name || '—', service: x.service || '—', impactLevel: cap(x.impact_level), commStatus: cap(x.comm_status) }));
    } catch { return []; }
  }
}
