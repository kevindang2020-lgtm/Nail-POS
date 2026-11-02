// System Status service. Composes the overview: 10 KPIs, monitored-services table, status-level breakdown, per-category
// health, global uptime, affected-tenants-by-service, active incidents, scheduled maintenance, public updates, and
// incident history. Health trend + current-uptime sparkline need historical snapshots not modelled → honest NotConnected.
import { INCIDENT_STATES, buildStatusKpis, buildStatusBreakdown, buildCategoryHealth, globalUptime, affectedByService, validateIncidentInput, isValidIncidentTransition, validatePublicUpdateInput, validateMaintenanceInput, validatePostIncidentReport, validateNotifyInput, STATUS_LABEL, type ServiceStatus } from './system-status-core';
import type { SystemStatusRepo } from './system-status.repository';

const cap = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const INCIDENT_STATE_LABEL: Record<string, string> = { investigating: 'Investigating', identified: 'Identified', mitigating: 'Mitigating', monitoring: 'Monitoring', resolved: 'Resolved' };

export class SystemStatusService {
  constructor(private readonly repo: SystemStatusRepo, private readonly now: () => number = () => Date.now()) {}

  async getOverview(filters: { statusLevel?: string; serviceGroup?: string; incidentStatus?: string } = {}) {
    const now = this.now();
    const [allComponents, incidents, maintenance, publicUpdates, history, reportsThisMonth, postIncidentReports, healthTrend, communications, recoveryProgress, affectedTenants] = await Promise.all([
      this.repo.components(), this.repo.incidents(), this.repo.scheduledMaintenance(), this.repo.publicUpdates(), this.repo.incidentHistory(), this.repo.incidentReportsThisMonth(), this.repo.postIncidentReports(), this.repo.healthTrend(), this.repo.communications(), this.repo.recoveryProgress(), this.repo.affectedTenants(),
    ]);
    // Filters narrow the monitored-services view + status breakdown + active incidents; the 10 KPIs stay platform-wide
    // (they represent whole-platform totals). Region / date scope isn't modelled, so those filters remain inert.
    const components = allComponents.filter((c) =>
      (!filters.statusLevel || c.status === filters.statusLevel) &&
      (!filters.serviceGroup || (c.category || '').toLowerCase() === filters.serviceGroup.toLowerCase()));
    const activeAll = incidents.filter((i) => i.status !== 'resolved');
    const active = filters.incidentStatus ? activeAll.filter((i) => i.status === filters.incidentStatus) : activeAll;
    const nameFor = (key: string | null) => allComponents.find((c) => c.key === key)?.name || key || '—';

    // Incident timeline funnel by workflow state.
    const timeline = ['detected', 'investigating', 'identified', 'mitigating', 'monitoring', 'resolved'].map((stage) => {
      const map: Record<string, (i: typeof incidents[number]) => boolean> = {
        detected: (i) => i.status !== 'resolved', investigating: (i) => i.status === 'investigating', identified: (i) => i.status === 'identified',
        // Was `i.status === 'identified'`: the status could not be stored, so every identified incident was counted
        // twice — once as Identified and again as Mitigating. Migration 445 made it real.
        mitigating: (i) => i.status === 'mitigating', monitoring: (i) => i.status === 'monitoring', resolved: (i) => i.status === 'resolved',
      };
      return { stage: cap(stage), count: incidents.filter(map[stage]).length };
    });

    return {
      // KPIs, category health, and global uptime stay platform-wide (whole-platform totals).
      kpis: buildStatusKpis(allComponents, incidents, { scheduledMaintenance: maintenance.filter((m) => m.noticeStatus === 'published').length, publicUpdates: publicUpdates.filter((u) => u.status === 'published').length, incidentReportsThisMonth: reportsThisMonth }, now),
      services: components.map((c) => ({
        key: c.key, service: c.name, category: cap(c.category || '—'), status: c.status, statusLabel: STATUS_LABEL[c.status as ServiceStatus] || cap(c.status),
        uptimePct: c.uptimePct, responseTimeMs: c.responseTimeMs, ownerTeam: c.ownerTeam || '—', affectedTenants: c.affectedTenants, lastIncidentAt: c.lastIncidentAt,
      })),
      statusBreakdown: buildStatusBreakdown(components),
      categoryHealth: buildCategoryHealth(allComponents),
      globalUptime: globalUptime(allComponents),
      affectedByService: affectedByService(incidents, allComponents),
      activeIncidents: active.map((i) => ({ incidentId: i.reference || i.id, service: nameFor(i.componentKey), severity: cap(i.severity), status: INCIDENT_STATE_LABEL[i.status] || cap(i.status), startedAt: i.startedAt, affectedTenants: i.affectedTenants })),
      incidentTimeline: timeline,
      scheduledMaintenance: maintenance.map((m) => ({ ...m, scope: cap(m.scope), noticeStatus: cap(m.noticeStatus), owner: m.owner })),
      publicUpdates: publicUpdates.map((u) => ({ ...u, audience: cap(u.audience), status: cap(u.status) })),
      incidentHistory: history,
      postIncidentReports: postIncidentReports.map((r) => ({ ...r, status: cap(r.status) })),
      // Live Health Overview trend from daily health snapshots (documented weighted-availability score).
      healthTrend: { available: healthTrend.length > 0, points: healthTrend.map((p) => ({ date: p.date, pct: p.score })) },
      communicationLog: communications.map((c) => ({ ...c, channel: cap(c.channel) })),
      recoveryProgress,
      affectedTenants,
    };
  }

  async notifyTenants(input: { message?: string; channel?: string; audience?: string; incidentReference?: string; sentBy?: string }): Promise<{ ok: boolean; errors?: string[]; sent?: { channel: string; audience: string; message: string } }> {
    const { errors } = validateNotifyInput(input);
    if (errors.length) return { ok: false, errors };
    const rec = await this.repo.notifyTenants({ message: String(input.message), channel: input.channel || 'in_app', audience: input.audience || 'affected_tenants', incidentReference: input.incidentReference ?? null, sentBy: input.sentBy || 'Super Admin' });
    return { ok: true, sent: { channel: cap(rec.channel), audience: rec.audience, message: rec.message } };
  }

  async createPostIncidentReport(input: { title?: string; incidentReference?: string; summary?: string; rootCause?: string; owner?: string }): Promise<{ ok: boolean; errors?: string[]; report?: { reportReference: string; title: string; status: string } }> {
    const { errors } = validatePostIncidentReport(input);
    if (errors.length) return { ok: false, errors };
    const rec = await this.repo.createPostIncidentReport({ title: String(input.title), incidentReference: String(input.incidentReference), summary: input.summary ?? null, rootCause: input.rootCause ?? null, owner: input.owner || '—' });
    return { ok: true, report: { reportReference: rec.reportReference, title: rec.title, status: cap(rec.status) } };
  }

  async createIncident(input: { title?: string; componentKey?: string; severity?: string; impact?: string; affectedTenants?: number }): Promise<{ ok: boolean; errors?: string[]; incident?: { incidentId: string; service: string; severity: string; status: string } }> {
    const components = await this.repo.components();
    const { errors } = validateIncidentInput(input, components.map((c) => c.key));
    if (errors.length) return { ok: false, errors };
    const created = await this.repo.createIncident({ title: String(input.title), componentKey: String(input.componentKey), severity: input.severity || 'medium', impact: input.impact || 'minor', affectedTenants: Math.max(0, Number(input.affectedTenants) || 0) });
    const service = components.find((c) => c.key === created.componentKey)?.name || created.componentKey || '—';
    return { ok: true, incident: { incidentId: created.reference || created.id, service, severity: cap(created.severity), status: INCIDENT_STATE_LABEL[created.status] || cap(created.status) } };
  }

  async updateIncidentStatus(id: string, status: string): Promise<{ ok: boolean; errors?: string[]; incident?: { incidentId: string; status: string } }> {
    if (!(INCIDENT_STATES as readonly string[]).includes(status)) return { ok: false, errors: ['Invalid status.'] };
    const existing = (await this.repo.incidents()).find((i) => i.id === id || i.reference === id);
    if (!existing) return { ok: false, errors: ['Incident not found.'] };
    if (!isValidIncidentTransition(existing.status, status)) return { ok: false, errors: [`Cannot move an incident from ${existing.status} back to ${status}.`] };
    const updated = await this.repo.updateIncidentStatus(id, status);
    return updated ? { ok: true, incident: { incidentId: updated.reference || updated.id, status: INCIDENT_STATE_LABEL[updated.status] || cap(updated.status) } } : { ok: false, errors: ['Incident not found.'] };
  }

  async publishUpdate(input: { title?: string; body?: string; audience?: string; incidentId?: string }): Promise<{ ok: boolean; errors?: string[]; update?: { title: string; audience: string; status: string } }> {
    const { errors } = validatePublicUpdateInput(input);
    if (errors.length) return { ok: false, errors };
    const rec = await this.repo.publishUpdate({ title: String(input.title), body: input.body ?? null, audience: input.audience || 'all_tenants', incidentId: input.incidentId ?? null });
    return { ok: true, update: { title: rec.title, audience: cap(rec.audience), status: cap(rec.status) } };
  }

  async scheduleMaintenance(input: { service?: string; scope?: string; windowStart?: string; windowEnd?: string; tenantImpact?: number; owner?: string }): Promise<{ ok: boolean; errors?: string[]; maintenance?: { service: string; scope: string; noticeStatus: string } }> {
    const { errors } = validateMaintenanceInput(input);
    if (errors.length) return { ok: false, errors };
    const rec = await this.repo.scheduleMaintenance({ service: String(input.service), scope: input.scope || 'Global', windowStart: String(input.windowStart), windowEnd: String(input.windowEnd), tenantImpact: Math.max(0, Number(input.tenantImpact) || 0), owner: input.owner || '—' });
    return { ok: true, maintenance: { service: rec.service, scope: cap(rec.scope), noticeStatus: cap(rec.noticeStatus) } };
  }
}
