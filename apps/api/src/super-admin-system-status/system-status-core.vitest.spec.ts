import { describe, it, expect } from 'vitest';
import { buildStatusKpis, buildStatusBreakdown, buildCategoryHealth, globalUptime, affectedByService, validateIncidentInput, isValidIncidentTransition, validatePublicUpdateInput, validateMaintenanceInput, validatePostIncidentReport, computeHealthScore, validateNotifyInput, type ComponentLike, type IncidentLike } from './system-status-core';

const NOW = Date.parse('2026-05-06T18:00:00Z');
const comp = (o: Partial<ComponentLike> & { key: string; name: string; status: string }): ComponentLike => ({ category: 'application', uptimePct: 99.99, responseTimeMs: 120, ownerTeam: 'Platform Team', affectedTenants: 0, lastIncidentAt: null, ...o });

const components: ComponentLike[] = [
  comp({ key: 'main_app', name: 'Main Application', status: 'operational', category: 'application' }),
  comp({ key: 'booking', name: 'Booking System', status: 'degraded', category: 'application', affectedTenants: 28 }),
  comp({ key: 'queue_sync', name: 'Queue Synchronization', status: 'partial_outage', category: 'application', affectedTenants: 14 }),
  comp({ key: 'payments', name: 'Payment Processing', status: 'operational', category: 'payments' }),
  comp({ key: 'merchant', name: 'Merchant Integrations', status: 'degraded', category: 'payments', affectedTenants: 9 }),
  comp({ key: 'backups', name: 'Backups', status: 'maintenance', category: 'infrastructure', uptimePct: 100 }),
];
const incidents: IncidentLike[] = [
  { id: '1', reference: 'INC-2026-0506-001', title: 'Booking latency', componentKey: 'booking', severity: 'high', status: 'investigating', impact: 'major', startedAt: '2026-05-06T10:12:00Z', resolvedAt: null, affectedTenants: 28 },
  { id: '2', reference: 'INC-2026-0506-002', title: 'Queue sync outage', componentKey: 'queue_sync', severity: 'medium', status: 'identified', impact: 'major', startedAt: '2026-05-06T11:05:00Z', resolvedAt: null, affectedTenants: 14 },
  { id: '3', reference: 'INC-2026-0505-010', title: 'Payment delay', componentKey: 'payments', severity: 'low', status: 'resolved', impact: 'minor', startedAt: '2026-05-05T09:00:00Z', resolvedAt: '2026-05-05T10:22:00Z', affectedTenants: 0 },
];
const counts = { scheduledMaintenance: 1, publicUpdates: 6, incidentReportsThisMonth: 9 };

describe('system-status engine', () => {
  it('builds the 10 KPIs in order', () => {
    const k = buildStatusKpis(components, incidents, counts, NOW);
    expect(k.map((x) => x.key)).toEqual(['operational', 'degraded', 'partial', 'major', 'maintenance', 'open_incidents', 'affected_tenants', 'avg_recovery', 'public_updates', 'incident_reports']);
    const byKey = Object.fromEntries(k.map((x) => [x.key, x]));
    expect(byKey.operational.value).toBe('2');
    expect(byKey.degraded.value).toBe('2');
    expect(byKey.partial.value).toBe('1');
    expect(byKey.open_incidents.value).toBe('2');            // 2 active (1 resolved excluded)
    expect(byKey.affected_tenants.value).toBe('42');          // 28 + 14
    expect(byKey.avg_recovery.value).toBe('82 min');          // resolved incident 3: 10:22-09:00
  });

  it('reports avg recovery Not Available when there are no resolved incidents', () => {
    const byKey = Object.fromEntries(buildStatusKpis(components, incidents.filter((i) => !i.resolvedAt), counts, NOW).map((x) => [x.key, x]));
    expect(byKey.avg_recovery.available).toBe(false);
  });

  it('builds the status-level breakdown with percentages', () => {
    const b = buildStatusBreakdown(components);
    expect(b.reduce((s, x) => s + x.count, 0)).toBe(6);
    expect(b.find((x) => x.status === 'operational')!.count).toBe(2);
  });

  it('rolls up category health', () => {
    const c = buildCategoryHealth(components);
    const payments = c.find((x) => x.label === 'Payments')!;
    expect(payments.total).toBe(2);
    expect(payments.allOperational).toBe(false); // merchant is degraded
  });

  it('computes global uptime, honest when absent', () => {
    expect(globalUptime(components).available).toBe(true);
    expect(globalUptime(components).pct).toBeGreaterThan(99);
    expect(globalUptime(components.map((c) => ({ ...c, uptimePct: null }))).available).toBe(false);
  });

  it('ranks affected tenants by service from active incidents', () => {
    const a = affectedByService(incidents, components);
    expect(a[0].service).toBe('Booking System');
    expect(a[0].affected).toBe(28);
  });

  it('validates incident input against known services', () => {
    const keys = components.map((c) => c.key);
    expect(validateIncidentInput({ title: '', componentKey: '' }, keys).errors.length).toBeGreaterThanOrEqual(2);
    expect(validateIncidentInput({ title: 'X', componentKey: 'nope' }, keys).errors.some((e) => e.includes('Unknown service'))).toBe(true);
    expect(validateIncidentInput({ title: 'Booking slow', componentKey: 'booking', severity: 'high', impact: 'major' }, keys).errors).toHaveLength(0);
    expect(validateIncidentInput({ title: 'X', componentKey: 'booking', severity: 'nope' }, keys).errors).toContain('Invalid severity.');
  });

  it('allows forward/same incident transitions but not backward', () => {
    expect(isValidIncidentTransition('investigating', 'identified')).toBe(true);
    expect(isValidIncidentTransition('identified', 'identified')).toBe(true);
    expect(isValidIncidentTransition('monitoring', 'resolved')).toBe(true);
    expect(isValidIncidentTransition('resolved', 'investigating')).toBe(false);
    expect(isValidIncidentTransition('identified', 'investigating')).toBe(false);
  });

  it('validates public-update input', () => {
    expect(validatePublicUpdateInput({ title: '' }).errors).toContain('An update title is required.');
    expect(validatePublicUpdateInput({ title: 'Update', audience: 'nope' }).errors).toContain('Invalid audience.');
    expect(validatePublicUpdateInput({ title: 'Update', audience: 'all_tenants' }).errors).toHaveLength(0);
  });

  it('validates maintenance input including window ordering', () => {
    expect(validateMaintenanceInput({ service: '', windowStart: '2026-05-06T23:00:00Z', windowEnd: '2026-05-07T01:00:00Z' }).errors).toContain('A service is required.');
    expect(validateMaintenanceInput({ service: 'Backups', windowStart: '2026-05-07T01:00:00Z', windowEnd: '2026-05-06T23:00:00Z' }).errors.some((e) => e.includes('cannot end before'))).toBe(true);
    expect(validateMaintenanceInput({ service: 'Backups', windowStart: '2026-05-06T23:00:00Z', windowEnd: '2026-05-07T01:00:00Z' }).errors).toHaveLength(0);
  });

  it('validates post-incident report input', () => {
    expect(validatePostIncidentReport({ title: '', incidentReference: '' }).errors.length).toBe(2);
    expect(validatePostIncidentReport({ title: 'Booking RCA', incidentReference: 'INC-2026-0506-001' }).errors).toHaveLength(0);
  });

  it('computes a documented platform-health score weighted by status', () => {
    expect(computeHealthScore([])).toBeNull();
    // all operational → 100
    expect(computeHealthScore(components.map((c) => ({ ...c, status: 'operational' })))).toBe(100);
    // one major outage among 2 → mean(1, 0) = 50
    expect(computeHealthScore([{ ...components[0], status: 'operational' }, { ...components[0], status: 'major_outage' }])).toBe(50);
    // degraded contributes 0.8
    expect(computeHealthScore([{ ...components[0], status: 'degraded' }])).toBe(80);
  });

  it('validates notify input', () => {
    expect(validateNotifyInput({ message: '' }).errors).toContain('A message is required.');
    expect(validateNotifyInput({ message: 'Investigating booking latency', channel: 'nope' }).errors).toContain('Invalid channel.');
    expect(validateNotifyInput({ message: 'Investigating booking latency', channel: 'email' }).errors).toHaveLength(0);
  });
});
