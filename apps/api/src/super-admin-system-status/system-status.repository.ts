// Repository for System Status. In production reads status_components / status_incidents / status_scheduled_maintenance
// / status_public_updates. The in-memory impl seeds the 18 monitored services + incidents from the reference.
import type { ComponentLike, IncidentLike } from './system-status-core';

export interface MaintenanceRow { service: string; scope: string; windowStart: string; windowEnd: string; tenantImpact: number; noticeStatus: string; owner: string }
export interface PublicUpdateRow { time: string; title: string; audience: string; status: string }
export interface IncidentHistoryRow { incidentId: string; service: string; severity: string; rootCause: string; duration: string; status: string }
export interface PostIncidentReportRow { reportReference: string; title: string; incidentReference: string | null; owner: string; status: string; publishedAt: string | null }
export interface CommunicationRow { time: string; channel: string; audience: string; message: string; sentBy: string }
export interface RecoveryRow { incident: string; percentRecovered: number; nextMilestone: string; owner: string }
export interface ImpactRow { tenant: string; branch: string; service: string; impactLevel: string; commStatus: string }

export interface SystemStatusRepo {
  components(): Promise<ComponentLike[]>;
  incidents(): Promise<IncidentLike[]>;
  scheduledMaintenance(): Promise<MaintenanceRow[]>;
  publicUpdates(): Promise<PublicUpdateRow[]>;
  incidentHistory(): Promise<IncidentHistoryRow[]>;
  incidentReportsThisMonth(): Promise<number>;
  createIncident(input: { title: string; componentKey: string; severity: string; impact: string; affectedTenants: number }): Promise<IncidentLike>;
  updateIncidentStatus(id: string, status: string): Promise<IncidentLike | null>;
  publishUpdate(input: { title: string; body: string | null; audience: string; incidentId: string | null }): Promise<PublicUpdateRow>;
  scheduleMaintenance(input: { service: string; scope: string; windowStart: string; windowEnd: string; tenantImpact: number; owner: string }): Promise<MaintenanceRow>;
  postIncidentReports(): Promise<PostIncidentReportRow[]>;
  createPostIncidentReport(input: { title: string; incidentReference: string; summary: string | null; rootCause: string | null; owner: string }): Promise<PostIncidentReportRow>;
  healthTrend(): Promise<{ date: string; score: number }[]>;
  communications(): Promise<CommunicationRow[]>;
  notifyTenants(input: { message: string; channel: string; audience: string; incidentReference: string | null; sentBy: string }): Promise<CommunicationRow>;
  recoveryProgress(): Promise<RecoveryRow[]>;
  affectedTenants(): Promise<ImpactRow[]>;
}

const c = (key: string, name: string, category: string, status: string, uptime: number, rt: number | null, owner: string, affected: number, lastIncident: string | null): ComponentLike =>
  ({ key, name, category, status, uptimePct: uptime, responseTimeMs: rt, ownerTeam: owner, affectedTenants: affected, lastIncidentAt: lastIncident });

const seedComponents: ComponentLike[] = [
  c('main_app', 'Main Application', 'application', 'operational', 99.99, 120, 'Platform Team', 0, '2026-04-20'),
  c('tenant_pos_api', 'Tenant POS API', 'api', 'operational', 99.99, 145, 'API Team', 0, '2026-05-02'),
  c('booking', 'Booking System', 'application', 'degraded', 99.45, 820, 'Platform Team', 28, '2026-05-06'),
  c('checkin', 'Check-In System', 'application', 'operational', 99.97, 210, 'Platform Team', 0, '2026-05-01'),
  c('queue_sync', 'Queue Synchronization', 'application', 'partial_outage', 98.20, 2800, 'Platform Team', 14, '2026-05-06'),
  c('payments', 'Payment Processing', 'payments', 'operational', 99.99, 180, 'Payments Team', 0, '2026-04-28'),
  c('merchant', 'Merchant Integrations', 'payments', 'degraded', 99.30, 950, 'Payments Team', 9, '2026-05-06'),
  c('ai_receptionist', 'AI Receptionist', 'ai', 'operational', 99.95, 300, 'AI Team', 0, '2026-05-03'),
  c('sms', 'SMS Provider', 'communications', 'operational', 99.99, 160, 'Comm Team', 0, '2026-04-27'),
  c('email', 'Email Provider', 'communications', 'operational', 99.99, 140, 'Comm Team', 0, '2026-04-25'),
  c('push', 'Push Notifications', 'communications', 'operational', 99.98, 200, 'Comm Team', 1, '2026-04-29'),
  c('database', 'Database', 'infrastructure', 'operational', 99.99, 90, 'Infra Team', 0, '2026-04-25'),
  c('file_storage', 'File Storage', 'infrastructure', 'operational', 99.99, 110, 'Infra Team', 0, '2026-04-25'),
  c('backups', 'Backups', 'infrastructure', 'maintenance', 100.0, null, 'Infra Team', 0, null),
  c('reporting', 'Reporting', 'application', 'operational', 99.96, 220, 'Platform Team', 0, '2026-04-30'),
  c('mobile_apps', 'Mobile Apps', 'mobile', 'operational', 99.97, 250, 'Mobile Team', 3, '2026-05-01'),
  c('authentication', 'Authentication', 'identity', 'operational', 99.99, 130, 'Security Team', 0, '2026-04-29'),
  c('device_connectivity', 'Device Connectivity', 'infrastructure', 'operational', 99.95, 190, 'Infra Team', 0, '2026-04-28'),
];

const inc = (id: string, ref: string, title: string, key: string, sev: string, status: string, impact: string, started: string, resolved: string | null, affected: number): IncidentLike =>
  ({ id, reference: ref, title, componentKey: key, severity: sev, status, impact, startedAt: started, resolvedAt: resolved, affectedTenants: affected });

const seedIncidents: IncidentLike[] = [
  inc('1', 'INC-2026-0506-001', 'Booking System latency', 'booking', 'high', 'investigating', 'major', '2026-05-06T10:12:00Z', null, 28),
  inc('2', 'INC-2026-0506-002', 'Queue sync partial outage', 'queue_sync', 'medium', 'identified', 'major', '2026-05-06T11:05:00Z', null, 14),
  inc('3', 'INC-2026-0506-003', 'Merchant integration errors', 'merchant', 'medium', 'monitoring', 'minor', '2026-05-06T12:10:00Z', null, 9),
  inc('4', 'INC-2026-0506-010', 'Payment processing delay', 'payments', 'low', 'resolved', 'minor', '2026-05-06T08:00:00Z', '2026-05-06T09:22:00Z', 0),
  inc('5', 'INC-2026-0506-008', 'SMS provider network issue', 'sms', 'low', 'resolved', 'minor', '2026-05-06T07:10:00Z', '2026-05-06T07:55:00Z', 0),
  inc('6', 'INC-2026-0503-007', 'AI receptionist model timeout', 'ai_receptionist', 'medium', 'resolved', 'minor', '2026-05-03T06:00:00Z', '2026-05-03T07:10:00Z', 0),
];

export class InMemorySystemStatusRepo implements SystemStatusRepo {
  private incidentList: IncidentLike[] = seedIncidents.map((x) => ({ ...x }));
  private seq = 100;
  private maintenanceList: MaintenanceRow[] = [{ service: 'Backups', scope: 'Global', windowStart: '2026-05-06T23:00:00Z', windowEnd: '2026-05-07T01:00:00Z', tenantImpact: 0, noticeStatus: 'published', owner: 'Infra Team' }];
  private updateList: PublicUpdateRow[] = [
    { time: '2026-05-06T12:20:00Z', title: 'Queue Sync Partial Outage Update', audience: 'all_tenants', status: 'published' },
    { time: '2026-05-06T11:45:00Z', title: 'Booking System Latency Investigating', audience: 'affected_tenants', status: 'published' },
    { time: '2026-05-06T10:00:00Z', title: 'Backups Maintenance Notice', audience: 'all_tenants', status: 'published' },
  ];
  async components() { return seedComponents.map((x) => ({ ...x })); }
  async incidents() { return this.incidentList.map((x) => ({ ...x })); }
  async scheduledMaintenance(): Promise<MaintenanceRow[]> { return this.maintenanceList.map((x) => ({ ...x })); }
  async publicUpdates(): Promise<PublicUpdateRow[]> { return this.updateList.map((x) => ({ ...x })); }
  async incidentHistory(): Promise<IncidentHistoryRow[]> {
    return [
      { incidentId: 'INC-2026-0506-010', service: 'Payment Processing', severity: 'Low', rootCause: 'Third-party API Delay', duration: '1h 22m', status: 'Resolved' },
      { incidentId: 'INC-2026-0506-008', service: 'SMS Provider', severity: 'Low', rootCause: 'Provider Network Issue', duration: '45m', status: 'Resolved' },
      { incidentId: 'INC-2026-0503-007', service: 'AI Receptionist', severity: 'Medium', rootCause: 'Model Timeout', duration: '1h 10m', status: 'Resolved' },
    ];
  }
  async incidentReportsThisMonth() { return 9; }
  async createIncident(input: { title: string; componentKey: string; severity: string; impact: string; affectedTenants: number }): Promise<IncidentLike> {
    const d = new Date();
    const ref = `INC-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-${String(this.seq++).padStart(3, '0')}`;
    const rec: IncidentLike = { id: ref, reference: ref, title: input.title, componentKey: input.componentKey, severity: input.severity, status: 'investigating', impact: input.impact, startedAt: new Date().toISOString(), resolvedAt: null, affectedTenants: input.affectedTenants };
    this.incidentList.unshift(rec);
    return { ...rec };
  }
  async updateIncidentStatus(id: string, status: string): Promise<IncidentLike | null> {
    const i = this.incidentList.find((x) => x.id === id || x.reference === id);
    if (!i) return null;
    i.status = status;
    if (status === 'resolved' && !i.resolvedAt) i.resolvedAt = new Date().toISOString();
    return { ...i };
  }
  async publishUpdate(input: { title: string; body: string | null; audience: string; incidentId: string | null }): Promise<PublicUpdateRow> {
    const rec: PublicUpdateRow = { time: new Date().toISOString(), title: input.title, audience: input.audience, status: 'published' };
    this.updateList.unshift(rec);
    return { ...rec };
  }
  async scheduleMaintenance(input: { service: string; scope: string; windowStart: string; windowEnd: string; tenantImpact: number; owner: string }): Promise<MaintenanceRow> {
    const rec: MaintenanceRow = { service: input.service, scope: input.scope, windowStart: input.windowStart, windowEnd: input.windowEnd, tenantImpact: input.tenantImpact, noticeStatus: 'published', owner: input.owner };
    this.maintenanceList.unshift(rec);
    return { ...rec };
  }
  private reportList: PostIncidentReportRow[] = [
    { reportReference: 'PIR-2026-0504-001', title: 'Booking System Report', incidentReference: 'INC-2026-0506-010', owner: 'John D.', status: 'published', publishedAt: '2026-05-04T00:00:00Z' },
    { reportReference: 'PIR-2026-0504-002', title: 'SMS Provider Report', incidentReference: 'INC-2026-0504-008', owner: 'Sarah L.', status: 'published', publishedAt: '2026-05-04T00:00:00Z' },
  ];
  private pirSeq = 100;
  async postIncidentReports(): Promise<PostIncidentReportRow[]> { return this.reportList.map((x) => ({ ...x })); }
  async createPostIncidentReport(input: { title: string; incidentReference: string; summary: string | null; rootCause: string | null; owner: string }): Promise<PostIncidentReportRow> {
    const d = new Date();
    const ref = `PIR-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-${String(this.pirSeq++).padStart(3, '0')}`;
    const rec: PostIncidentReportRow = { reportReference: ref, title: input.title, incidentReference: input.incidentReference, owner: input.owner, status: 'published', publishedAt: new Date().toISOString() };
    this.reportList.unshift(rec);
    return { ...rec };
  }
  async healthTrend(): Promise<{ date: string; score: number }[]> {
    // Seven trailing days of the documented platform-health score (dev fixture; production reads status_health_snapshots).
    const scores = [99.2, 99.5, 98.8, 99.1, 99.4, 98.6, 98.9];
    const base = Date.parse('2026-05-06T00:00:00Z');
    return scores.map((score, i) => ({ date: new Date(base - (6 - i) * 86400000).toISOString().slice(0, 10), score }));
  }
  private commList: CommunicationRow[] = [
    { time: '2026-05-06T12:30:00Z', channel: 'email', audience: '28 Tenants', message: 'Booking System Update', sentBy: 'System' },
    { time: '2026-05-06T12:31:00Z', channel: 'sms', audience: '14 Tenants', message: 'Queue Sync Partial Outage', sentBy: 'System' },
    { time: '2026-05-06T12:31:00Z', channel: 'in_app', audience: '9 Tenants', message: 'Merchant Integrations Update', sentBy: 'System' },
  ];
  async communications(): Promise<CommunicationRow[]> { return this.commList.map((x) => ({ ...x })); }
  async notifyTenants(input: { message: string; channel: string; audience: string; incidentReference: string | null; sentBy: string }): Promise<CommunicationRow> {
    const rec: CommunicationRow = { time: new Date().toISOString(), channel: input.channel, audience: input.audience, message: input.message, sentBy: input.sentBy };
    this.commList.unshift(rec);
    return { ...rec };
  }
  async recoveryProgress(): Promise<RecoveryRow[]> {
    return [
      { incident: 'INC-2026-0506-001', percentRecovered: 45, nextMilestone: 'Root Cause to be Confirmed', owner: 'John D.' },
      { incident: 'INC-2026-0506-002', percentRecovered: 30, nextMilestone: 'Implement Fix', owner: 'Priya S.' },
      { incident: 'INC-2026-0506-003', percentRecovered: 20, nextMilestone: 'Vendor Response', owner: 'Rohan K.' },
    ];
  }
  async affectedTenants(): Promise<ImpactRow[]> {
    return [
      { tenant: 'VIP Nail Club', branch: 'Downtown', service: 'Booking System', impactLevel: 'high', commStatus: 'in_progress' },
      { tenant: 'Spa Pedicure Club', branch: 'LA Branch', service: 'Queue Sync', impactLevel: 'medium', commStatus: 'in_progress' },
      { tenant: 'Gel Polish Plus', branch: 'Chicago', service: 'Merchant Integrations', impactLevel: 'medium', commStatus: 'sent' },
    ];
  }
}
