// Pure, DB-free engine for the System Status page. Computes the 10 KPIs, the status-level breakdown, per-category
// service health, and global uptime from monitored-service components + incidents. Honest rendering: metrics with no
// backing source (avg recovery time when there are no resolved incidents, health trend series) are surfaced as
// available:false rather than fabricated.

export type ServiceStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';
export const STATUS_LABEL: Record<ServiceStatus, string> = {
  operational: 'Operational', degraded: 'Degraded Performance', partial_outage: 'Partial Outage', major_outage: 'Major Outage', maintenance: 'Scheduled Maintenance',
};

export interface ComponentLike {
  key: string; name: string; category: string | null; status: string; uptimePct: number | null;
  responseTimeMs: number | null; ownerTeam: string | null; affectedTenants: number; lastIncidentAt: string | null;
}
export interface IncidentLike {
  id: string; reference: string | null; title: string; componentKey: string | null; severity: string; status: string;
  impact: string; startedAt: string; resolvedAt: string | null; affectedTenants: number;
}

export interface Kpi { key: string; label: string; value: string | null; available: boolean; unfavorableIfUp?: boolean }

const isActive = (s: string) => s !== 'resolved';

export function buildStatusKpis(components: ComponentLike[], incidents: IncidentLike[], counts: { scheduledMaintenance: number; publicUpdates: number; incidentReportsThisMonth: number }, now: number): Kpi[] {
  const byStatus = (s: ServiceStatus) => components.filter((c) => c.status === s).length;
  const active = incidents.filter((i) => isActive(i.status));
  const resolved = incidents.filter((i) => i.resolvedAt);
  const recoveryMins = resolved.map((i) => Math.max(0, (Date.parse(i.resolvedAt as string) - Date.parse(i.startedAt)) / 60000));
  const avgRecovery = recoveryMins.length ? Math.round(recoveryMins.reduce((a, m) => a + m, 0) / recoveryMins.length) : null;
  const affectedTenants = new Set<number>();
  const totalAffected = active.reduce((a, i) => a + (i.affectedTenants || 0), 0) || components.reduce((a, c) => a + (c.affectedTenants || 0), 0);

  const kpi = (key: string, label: string, value: string | null, extra: Partial<Kpi> = {}): Kpi => ({ key, label, value, available: value !== null, ...extra });
  return [
    kpi('operational', 'Services Operational', byStatus('operational').toLocaleString()),
    kpi('degraded', 'Degraded Services', byStatus('degraded').toLocaleString(), { unfavorableIfUp: true }),
    kpi('partial', 'Partial Outages', byStatus('partial_outage').toLocaleString(), { unfavorableIfUp: true }),
    kpi('major', 'Major Outages', byStatus('major_outage').toLocaleString(), { unfavorableIfUp: true }),
    kpi('maintenance', 'Scheduled Maintenance', counts.scheduledMaintenance.toLocaleString()),
    kpi('open_incidents', 'Open Incidents', active.length.toLocaleString(), { unfavorableIfUp: true }),
    kpi('affected_tenants', 'Affected Tenants', totalAffected.toLocaleString(), { unfavorableIfUp: true }),
    kpi('avg_recovery', 'Avg Recovery Time', avgRecovery === null ? null : `${avgRecovery} min`),
    kpi('public_updates', 'Public Status Updates', counts.publicUpdates.toLocaleString()),
    kpi('incident_reports', 'Incident Reports This Month', counts.incidentReportsThisMonth.toLocaleString()),
  ];
}

export function buildStatusBreakdown(components: ComponentLike[]) {
  const levels: ServiceStatus[] = ['operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance'];
  const total = components.length;
  return levels.map((s) => ({ status: s, label: STATUS_LABEL[s], count: components.filter((c) => c.status === s).length }))
    .map((x) => ({ ...x, pct: total > 0 ? Math.round((x.count / total) * 1000) / 10 : 0 }))
    .filter((x) => x.count > 0);
}

const CATEGORY_LABEL: Record<string, string> = {
  application: 'Application', api: 'API', payments: 'Payments', communications: 'Communications',
  infrastructure: 'Infrastructure', identity: 'Identity', ai: 'AI', mobile: 'Mobile',
};
export function buildCategoryHealth(components: ComponentLike[]) {
  const groups = new Map<string, ComponentLike[]>();
  for (const c of components) { const k = c.category || 'other'; (groups.get(k) ?? groups.set(k, []).get(k)!).push(c); }
  return [...groups.entries()].map(([category, rows]) => ({
    category, label: CATEGORY_LABEL[category] || category, total: rows.length,
    operational: rows.filter((r) => r.status === 'operational').length,
    allOperational: rows.every((r) => r.status === 'operational'),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

export function globalUptime(components: ComponentLike[]): { available: boolean; pct: number | null } {
  const vals = components.map((c) => c.uptimePct).filter((v): v is number => typeof v === 'number');
  if (!vals.length) return { available: false, pct: null };
  return { available: true, pct: Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 100) / 100 };
}

export function affectedByService(incidents: IncidentLike[], components: ComponentLike[]): { service: string; affected: number }[] {
  const active = incidents.filter((i) => isActive(i.status) && i.affectedTenants > 0);
  const nameFor = (key: string | null) => components.find((c) => c.key === key)?.name || key || 'Unknown';
  const map = new Map<string, number>();
  for (const i of active) { const s = nameFor(i.componentKey); map.set(s, (map.get(s) || 0) + i.affectedTenants); }
  return [...map.entries()].map(([service, affected]) => ({ service, affected })).sort((a, b) => b.affected - a.affected);
}

// ---- Incident lifecycle validation (pure) ----
// §169 — MITIGATING added (migration 445). Order is the lifecycle; transitions only move forward.
export const INCIDENT_STATES = ['investigating', 'identified', 'mitigating', 'monitoring', 'resolved'] as const;
export type IncidentState = typeof INCIDENT_STATES[number];
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'informational']);
const IMPACTS = new Set(['none', 'minor', 'major', 'critical']);

export interface IncidentInput { title?: string | null; componentKey?: string | null; severity?: string | null; impact?: string | null; affectedTenants?: number | null }

export function validateIncidentInput(input: IncidentInput, knownComponentKeys: string[]): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.title ?? '').trim()) errors.push('An incident title is required.');
  if (!String(input.componentKey ?? '').trim()) errors.push('An affected service is required.');
  else if (!knownComponentKeys.includes(String(input.componentKey))) errors.push('Unknown service.');
  if (input.severity && !SEVERITIES.has(String(input.severity))) errors.push('Invalid severity.');
  if (input.impact && !IMPACTS.has(String(input.impact))) errors.push('Invalid impact.');
  if (input.affectedTenants != null && (input.affectedTenants < 0 || !Number.isFinite(input.affectedTenants))) errors.push('Affected tenants must be zero or greater.');
  return { errors };
}

/** §171 / §175: the severities that count as SEV1 and SEV2. */
export const SERIOUS_SEVERITIES: ReadonlySet<string> = new Set(['critical', 'high']);
export const SEV_LABEL: Record<string, string> = { critical: 'SEV1', high: 'SEV2', medium: 'SEV3', low: 'SEV4', informational: 'SEV4' };

/**
 * The ONE set of incident transition rules (Constitution 11 §169–175). Both the status route and the older service
 * method call this, so there cannot be a path with weaker rules.
 *   • forward only — resolved never becomes investigating again (open a new incident instead);
 *   • §171 a SEV1/SEV2 cannot move past Investigating without an incident commander: "do not leave a critical alert
 *     without an accountable responder";
 *   • §168/§175 a SEV1/SEV2 cannot be resolved without a written resolution — the postmortem starts from it.
 */
export function checkIncidentTransition(current: { status: string; severity: string; commander: string | null }, to: string, resolution?: string | null): string[] {
  const errors: string[] = [];
  if (!(INCIDENT_STATES as readonly string[]).includes(to)) return ['Invalid status.'];
  if (!isValidIncidentTransition(current.status, to)) errors.push(`Cannot move an incident from ${current.status} back to ${to}.`);
  const serious = SERIOUS_SEVERITIES.has(current.severity);
  if (serious && to !== 'investigating' && !String(current.commander ?? '').trim()) {
    errors.push(`A ${SEV_LABEL[current.severity]} incident needs an incident commander before it can move past Investigating.`);
  }
  if (serious && to === 'resolved' && !String(resolution ?? '').trim()) {
    errors.push(`A ${SEV_LABEL[current.severity]} incident needs a written resolution to be resolved.`);
  }
  return errors;
}

/** §175: serious incidents resolved without a post-incident report — the postmortems that are owed. */
export function postmortemsOwed(incidents: Array<{ id: string; reference: string | null; severity: string; status: string }>, reportedReferences: ReadonlySet<string>): string[] {
  return incidents.filter((i) => SERIOUS_SEVERITIES.has(i.severity) && i.status === 'resolved' && !reportedReferences.has(i.reference ?? i.id))
    .map((i) => i.reference ?? i.id);
}

// A status may stay the same or move forward along the lifecycle; it cannot move backward (e.g. resolved → investigating).
export function isValidIncidentTransition(from: string, to: string): boolean {
  const fi = (INCIDENT_STATES as readonly string[]).indexOf(from);
  const ti = (INCIDENT_STATES as readonly string[]).indexOf(to);
  if (ti < 0) return false;
  if (fi < 0) return true;
  return ti >= fi;
}

const AUDIENCES = new Set(['all_tenants', 'affected_tenants', 'internal']);
export interface PublicUpdateInput { title?: string | null; body?: string | null; audience?: string | null; incidentId?: string | null }
export function validatePublicUpdateInput(input: PublicUpdateInput): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.title ?? '').trim()) errors.push('An update title is required.');
  if (input.audience && !AUDIENCES.has(String(input.audience))) errors.push('Invalid audience.');
  return { errors };
}

export interface MaintenanceInput { service?: string | null; componentKey?: string | null; scope?: string | null; windowStart?: string | null; windowEnd?: string | null; tenantImpact?: number | null }
export function validateMaintenanceInput(input: MaintenanceInput): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.service ?? '').trim() && !String(input.componentKey ?? '').trim()) errors.push('A service is required.');
  const start = input.windowStart ? Date.parse(String(input.windowStart)) : NaN;
  const end = input.windowEnd ? Date.parse(String(input.windowEnd)) : NaN;
  if (!Number.isFinite(start)) errors.push('A valid start time is required.');
  if (!Number.isFinite(end)) errors.push('A valid end time is required.');
  if (Number.isFinite(start) && Number.isFinite(end) && end < start) errors.push('The maintenance window cannot end before it starts.');
  return { errors };
}

export interface PostIncidentReportInput { title?: string | null; incidentReference?: string | null; summary?: string | null; rootCause?: string | null; owner?: string | null }
export function validatePostIncidentReport(input: PostIncidentReportInput): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.title ?? '').trim()) errors.push('A report title is required.');
  if (!String(input.incidentReference ?? '').trim()) errors.push('A related incident is required.');
  return { errors };
}

// Platform-health score (0–100). Documented formula: the mean per-service availability factor across monitored
// services, expressed as a percentage. Each service contributes a status factor:
//   operational = 1.0, degraded = 0.8, partial_outage = 0.5, major_outage = 0.0, maintenance = 1.0 (planned, excluded
//   from penalty). Services are weighted equally (no criticality weighting is modelled yet — when a criticality column
//   exists it should multiply each factor). Returns null when there are no monitored services.
const STATUS_FACTOR: Record<string, number> = { operational: 1, degraded: 0.8, partial_outage: 0.5, major_outage: 0, maintenance: 1 };
export function computeHealthScore(components: ComponentLike[]): number | null {
  if (!components.length) return null;
  const sum = components.reduce((a, c) => a + (STATUS_FACTOR[c.status] ?? 0.5), 0);
  return Math.round((sum / components.length) * 1000) / 10;
}

const CHANNELS = new Set(['email', 'sms', 'push', 'in_app', 'public_status', 'tenant_notice']);
export interface NotifyInput { message?: string | null; channel?: string | null; audience?: string | null; incidentReference?: string | null }
export function validateNotifyInput(input: NotifyInput): { errors: string[] } {
  const errors: string[] = [];
  if (!String(input.message ?? '').trim()) errors.push('A message is required.');
  if (input.channel && !CHANNELS.has(String(input.channel))) errors.push('Invalid channel.');
  return { errors };
}
