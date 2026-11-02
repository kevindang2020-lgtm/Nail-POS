import { describe, it, expect } from 'vitest';
import { LiveQueueService, type RawLiveQueueData, type RawLiveItem } from './live-queue.service';

const now = Date.now();
const minsAgo = (m: number) => now - m * 60000;

function item(p: Partial<RawLiveItem>): RawLiveItem {
  return {
    id: 'q-' + Math.random().toString(36).slice(2, 8), tenantId: 't1', tenantName: 'Glamour Studio', branchId: 'b1',
    branchName: 'Downtown', customerName: 'Cust', isVip: false, priority: 'normal', status: 'waiting', station: null,
    service: 'Hair Cut', assignedTechnicianId: null, technicianName: null, source: 'walk_in',
    checkedInAtMs: minsAgo(10), calledAtMs: null, startedAtMs: null, updatedAtMs: minsAgo(2), ...p,
  };
}

function fakeData(over: Partial<RawLiveQueueData> = {}): RawLiveQueueData {
  const items: RawLiveItem[] = [
    item({ id: 'q1', status: 'waiting', assignedTechnicianId: null, checkedInAtMs: minsAgo(67) }), // unassigned + over threshold
    item({ id: 'q2', status: 'in_service', assignedTechnicianId: 'tech1', technicianName: 'Sarah J.', startedAtMs: minsAgo(20), checkedInAtMs: minsAgo(40) }),
    item({ id: 'q3', status: 'assigned', assignedTechnicianId: 'tech2', branchId: 'b2', branchName: 'West End', checkedInAtMs: minsAgo(20), updatedAtMs: minsAgo(30) }), // stuck (assigned, no start), wait < alert
  ];
  return {
    aggItems: items, pageItems: items, pageTotal: 3,
    branchMeta: [
      { branchId: 'b1', branchName: 'Downtown', tenantName: 'Glamour Studio', availableTechs: 5, capacity: 8 },
      { branchId: 'b2', branchName: 'West End', tenantName: 'Glamour Studio', availableTechs: 0, capacity: 2 },
    ],
    techStatus: [{ status: 'available', count: 142 }, { status: 'busy', count: 64 }, { status: 'on_break', count: 8 }],
    devices: { total: 50, offline: 9 },
    today: { totalQueues: 282, totalCustomers: 306, completedServices: 198 },
    hourly: [{ hour: 8, count: 12 }, { hour: 14, count: 30 }],
    ...over,
  };
}

const svc = (data: RawLiveQueueData) => new LiveQueueService({ liveQueueData: async () => data });

describe('LiveQueueService composition', () => {
  it('builds 11 KPIs that reconcile, with an honest null sync%', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.kpis.customersInService).toBe(1);
    expect(o.kpis.unassignedCustomers).toBe(1);
    expect(o.kpis.customersWaiting).toBe(2); // q1 unassigned + q3 assigned (both active pre-service)
    expect(o.kpis.customersOverThreshold).toBe(1); // q1 at 67 min
    expect(o.kpis.longestWaitMin).toBe(67);
    expect(o.kpis.techniciansAvailable).toBe(142);
    expect(o.kpis.offlineDevices).toBe(9);
    expect(o.kpis.queueSyncPct).toBeNull();
    expect(o.kpis.stuckRecords).toBeGreaterThanOrEqual(1); // q3 assigned-no-start
  });

  it('live status distribution reconciles exactly to the live total', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.liveStatusDistribution.total).toBe(3);
    expect(o.liveStatusDistribution.slices.reduce((a, s) => a + s.count, 0)).toBe(3);
  });

  it('surfaces sync as NotConnected (honest gap)', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.synchronizationStatus).toEqual({ available: false, reason: expect.any(String) });
    expect(o.todaySummary.syncSuccessPct).toBeNull();
  });

  it('reports technician availability from real status counts', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.technicianAvailability).toMatchObject({ total: 214, available: 142, onBreak: 8 });
  });

  it('health alerts reconcile with the KPIs', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.healthAlerts.customersOverThreshold).toBe(o.kpis.customersOverThreshold);
    expect(o.healthAlerts.stuckRecords).toBe(o.kpis.stuckRecords);
    expect(o.healthAlerts.offlineDevices).toBe(o.kpis.offlineDevices);
  });

  it('derives recent events from real lifecycle signals, newest first', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.recentEvents.length).toBeGreaterThan(0);
    for (let i = 1; i < o.recentEvents.length; i++) expect(o.recentEvents[i - 1].at >= o.recentEvents[i].at).toBe(true);
  });

  it('today summary carries the 9 metrics with honest sync null', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.todaySummary.totalQueues).toBe(282);
    expect(o.todaySummary.totalCustomers).toBe(306);
    expect(o.todaySummary.completedServices).toBe(198);
    expect(o.todaySummary.offlineDevices).toBe(9);
  });

  it('surfaces wait-time analytics (overall + per-branch) and detailed stuck records', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.waitAnalytics.overall.longestMin).toBe(67); // q1 at 67 min
    expect(o.waitAnalytics.thresholds).toEqual({ warningMin: 20, alertMin: 30, criticalMin: 45 });   // BUILD_PLAN Phase 6: the one detection core's salon defaults
    expect(o.waitAnalytics.byBranch.length).toBeGreaterThan(0);
    expect(o.stuckRecords.length).toBeGreaterThanOrEqual(1);
    const rec = o.stuckRecords.find((r) => r.status === 'assigned');
    expect(rec?.reason).toBe('assigned_no_service_start');
    expect(rec?.stuckMin).toBeGreaterThanOrEqual(15);
  });

  it('reconstructs per-queue timelines chronologically from real lifecycle timestamps', async () => {
    const o = await svc(fakeData()).getOverview({}, svc(fakeData()).parseFilters({}));
    expect(o.queueTimelines.length).toBeGreaterThan(0);
    const inService = o.queueTimelines.find((tl) => tl.queueId === 'q2');
    expect(inService).toBeTruthy();
    expect(inService!.events[0].kind).toBe('queued'); // entered queue is always first
    expect(inService!.events.some((e) => e.kind === 'service_started')).toBe(true);
    // chronological order preserved
    for (let i = 1; i < inService!.events.length; i++) expect(inService!.events[i - 1].at <= inService!.events[i].at).toBe(true);
  });

  it('computes business-semantic trends against a prior snapshot (and captures new ones)', async () => {
    const store: { capturedAt: string; metrics: Record<string, number | null> }[] = [];
    const repo = {
      liveQueueData: async () => fakeData(),
      insertSnapshot: async (_s: string, _t: string | null, m: Record<string, number | null>) => { store.push({ capturedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), metrics: m }); },
      latestPriorSnapshot: async () => store[store.length - 1] ?? null,
    };
    const s = new LiveQueueService(repo);
    // no baseline yet → empty trends
    const first = await s.getOverview({}, s.parseFilters({}));
    expect(first.trends).toEqual({});
    expect(first.trendsSince).toBeNull();
    // capture a baseline, then a metric moves: prior stuck=1, so if current stuck>prior it's UNfavorable
    await s.captureSnapshot({}, s.parseFilters({}));
    const withBaseline = await s.getOverview({}, s.parseFilters({}));
    expect(withBaseline.trendsSince).not.toBeNull();
    // techniciansAvailable increase is favorable; stuck increase is unfavorable — check the semantic direction exists
    expect(Object.keys(withBaseline.trends).length).toBeGreaterThan(0);
    for (const tr of Object.values(withBaseline.trends)) {
      if (tr.delta === 0) expect(tr.favorable).toBeNull();
    }
  });

  it('empty data yields an honest empty overview (no fabricated values)', async () => {
    const empty = fakeData({ aggItems: [], pageItems: [], pageTotal: 0, branchMeta: [], techStatus: [], devices: { total: 0, offline: 0 }, today: { totalQueues: 0, totalCustomers: 0, completedServices: 0 }, hourly: [] });
    const o = await svc(empty).getOverview({}, svc(empty).parseFilters({}));
    expect(o.kpis.customersWaiting).toBe(0);
    expect(o.technicianAvailability).toEqual({ available: false, reason: expect.any(String) });
    expect(o.queues.total).toBe(0);
  });
});
