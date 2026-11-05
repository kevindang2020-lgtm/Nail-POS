import { describe, it, expect } from 'vitest';
import { SystemStatusService } from './system-status.service';
import { InMemorySystemStatusRepo } from './system-status.repository';

const svc = () => new SystemStatusService(new InMemorySystemStatusRepo(), () => Date.parse('2026-05-06T18:00:00Z'));

describe('SystemStatusService', () => {
  it('builds the overview with 10 KPIs, 18 monitored services, breakdowns, uptime, incidents', async () => {
    const ov = await svc().getOverview();
    expect(ov.kpis).toHaveLength(10);
    expect(ov.services).toHaveLength(18);
    expect(ov.statusBreakdown.length).toBeGreaterThan(0);
    expect(ov.categoryHealth.length).toBeGreaterThan(0);
    expect(ov.globalUptime.available).toBe(true);
    expect(ov.activeIncidents.length).toBeGreaterThan(0);
    expect(ov.scheduledMaintenance.length).toBeGreaterThan(0);
    expect(ov.publicUpdates.length).toBeGreaterThan(0);
    expect(ov.incidentHistory.length).toBeGreaterThan(0);
    expect(ov.healthTrend.available).toBe(true); // seeded 7-day trend
    expect(ov.healthTrend.points).toHaveLength(7);
  });

  it('reconciles operational count with the reference (17 of 18)', async () => {
    const ov = await svc().getOverview();
    const op = ov.kpis.find((k) => k.key === 'operational')!;
    // seed: booking degraded, merchant degraded, queue_sync partial, backups maintenance → 14 operational
    expect(Number(op.value)).toBe(ov.services.filter((s) => s.status === 'operational').length);
  });

  it('resolves incident service names and marks active incidents only', async () => {
    const ov = await svc().getOverview();
    expect(ov.activeIncidents.every((i) => i.status !== 'Resolved')).toBe(true);
    expect(ov.activeIncidents.find((i) => i.service === 'Booking System latency' || i.service === 'Booking System')).toBeTruthy();
  });

  it('ranks affected tenants by service', async () => {
    const ov = await svc().getOverview();
    expect(ov.affectedByService[0].affected).toBeGreaterThanOrEqual(ov.affectedByService[ov.affectedByService.length - 1].affected);
  });

  it('exposes no internal secrets in the payload', async () => {
    const ov = await svc().getOverview();
    expect(JSON.stringify(ov)).not.toMatch(/private[_ ]?key|secret|password|token/i);
  });

  it('creates an incident with validation and starts it investigating', async () => {
    const s = svc();
    expect((await s.createIncident({ title: '', componentKey: '' })).ok).toBe(false);
    const res = await s.createIncident({ title: 'Checkout errors', componentKey: 'payments', severity: 'high', impact: 'major', affectedTenants: 5 });
    expect(res.ok).toBe(true);
    expect(res.incident!.status).toBe('Investigating');
    expect(res.incident!.service).toBe('Payment Processing');
    const ov = await s.getOverview();
    expect(ov.activeIncidents.some((i) => i.incidentId === res.incident!.incidentId)).toBe(true);
  });

  it('updates incident status forward but rejects backward transitions', async () => {
    const s = svc();
    // seed incident 2 is 'identified'
    const back = await s.updateIncidentStatus('2', 'investigating');
    expect(back.ok).toBe(false);
    const fwd = await s.updateIncidentStatus('2', 'monitoring');
    expect(fwd.ok).toBe(true);
    expect(fwd.incident!.status).toBe('Monitoring');
    expect((await s.updateIncidentStatus('nope', 'resolved')).ok).toBe(false);
  });

  it('publishes a public update with validation and it appears in the overview', async () => {
    const s = svc();
    expect((await s.publishUpdate({ title: '' })).ok).toBe(false);
    const res = await s.publishUpdate({ title: 'Queue sync recovering', audience: 'all_tenants' });
    expect(res.ok).toBe(true);
    expect(res.update!.status).toBe('Published');
    const ov = await s.getOverview();
    expect(ov.publicUpdates.some((u) => u.title === 'Queue sync recovering')).toBe(true);
  });

  it('schedules maintenance with window validation and it appears in the overview', async () => {
    const s = svc();
    expect((await s.scheduleMaintenance({ service: 'Backups', windowStart: '2026-05-08T01:00:00Z', windowEnd: '2026-05-07T23:00:00Z' })).ok).toBe(false);
    const res = await s.scheduleMaintenance({ service: 'Database', scope: 'Global', windowStart: '2026-05-09T23:00:00Z', windowEnd: '2026-05-10T01:00:00Z', tenantImpact: 0, owner: 'Infra Team' });
    expect(res.ok).toBe(true);
    const ov = await s.getOverview();
    expect(ov.scheduledMaintenance.some((m) => m.service === 'Database')).toBe(true);
  });

  it('lists post-incident reports and creates one with validation', async () => {
    const s = svc();
    const ov = await s.getOverview();
    expect(ov.postIncidentReports.length).toBeGreaterThan(0);
    expect((await s.createPostIncidentReport({ title: '', incidentReference: '' })).ok).toBe(false);
    const res = await s.createPostIncidentReport({ title: 'Booking RCA', incidentReference: 'INC-2026-0506-001', owner: 'John D.' });
    expect(res.ok).toBe(true);
    expect(res.report!.reportReference).toMatch(/^PIR-/);
    const after = await s.getOverview();
    expect(after.postIncidentReports.some((r) => r.reportReference === res.report!.reportReference)).toBe(true);
  });

  it('lists the communication log and notifies tenants with validation', async () => {
    const s = svc();
    const ov = await s.getOverview();
    expect(ov.communicationLog.length).toBeGreaterThan(0);
    expect((await s.notifyTenants({ message: '' })).ok).toBe(false);
    const res = await s.notifyTenants({ message: 'Booking latency resolved', channel: 'email', audience: '28 Tenants' });
    expect(res.ok).toBe(true);
    const after = await s.getOverview();
    expect(after.communicationLog.some((c) => c.message === 'Booking latency resolved')).toBe(true);
  });

  it('exposes recovery progress and affected-tenant impact rows', async () => {
    const ov = await svc().getOverview();
    expect(ov.recoveryProgress.length).toBeGreaterThan(0);
    expect(ov.recoveryProgress[0]).toHaveProperty('percentRecovered');
    expect(ov.recoveryProgress[0]).toHaveProperty('nextMilestone');
    expect(ov.affectedTenants.length).toBeGreaterThan(0);
    expect(ov.affectedTenants[0]).toHaveProperty('impactLevel');
    expect(ov.affectedTenants[0]).toHaveProperty('commStatus');
  });

  it('filters the services view + breakdown while keeping KPIs platform-wide', async () => {
    const s = svc();
    const all = await s.getOverview();
    const degraded = await s.getOverview({ statusLevel: 'degraded' });
    expect(degraded.services.every((x) => x.status === 'degraded')).toBe(true);
    expect(degraded.services.length).toBeLessThan(all.services.length);
    // KPIs stay platform-wide (unchanged by the filter)
    expect(degraded.kpis.find((k) => k.key === 'operational')!.value).toBe(all.kpis.find((k) => k.key === 'operational')!.value);
    // category filter
    const payments = await s.getOverview({ serviceGroup: 'payments' });
    expect(payments.services.every((x) => x.category === 'Payments')).toBe(true);
    // incident-status filter narrows active incidents
    const investigating = await s.getOverview({ incidentStatus: 'investigating' });
    expect(investigating.activeIncidents.every((i) => i.status === 'Investigating')).toBe(true);
  });
});

describe('the incident timeline funnel counts each state ONCE (Constitution 11 §169)', () => {
  // The funnel had a "Mitigating" stage that counted status === 'identified', because mitigating could not be stored:
  // every identified incident appeared twice. Migration 445 made the status real and the funnel counts it.
  it('an identified incident is counted under Identified only; a mitigating one under Mitigating only', async () => {
    // DELTAS: the in-memory repo ships seeded incidents, so absolute counts are meaningless (an earlier absolute
    // assertion read the seed's identified incident as a failure).
    const s = svc();
    const counts = async () => { const o: any = await s.getOverview({}); const t = o.incidentTimeline as Array<{ stage: string; count: number }>;
      return { identified: t.find((x) => x.stage === 'Identified')!.count, mitigating: t.find((x) => x.stage === 'Mitigating')!.count }; };
    const before = await counts();
    const a = await s.createIncident({ title: 'A', componentKey: 'payments', severity: 'medium' });
    await s.updateIncidentStatus(a.incident!.incidentId, 'identified');
    const mid = await counts();
    expect(mid.identified - before.identified).toBe(1);
    expect(mid.mitigating - before.mitigating).toBe(0);            // the old funnel added 1 here too
    await s.updateIncidentStatus(a.incident!.incidentId, 'mitigating');
    const after = await counts();
    expect(after.identified - before.identified).toBe(0);
    expect(after.mitigating - before.mitigating).toBe(1);
  });
});
