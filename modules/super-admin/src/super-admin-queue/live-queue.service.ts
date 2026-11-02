// live-queue.service.ts — Super Admin Live Queue Monitor (read-only, cross-tenant). Builds the full monitor payload
// (11 KPIs + every reference module) by composing the tested pure core (live-queue-core.ts) over REAL rows the
// repository reads from pos_queue_items (+ technicians.status and the *_devices heartbeat tables). Nothing is
// fabricated: modules with no canonical source (per-item sync status, full event timelines) are returned with
// `available:false` so the UI renders NotConnected. No write paths — the Super Admin monitors; the POS runs queues.

import {
  rollupKpis, statusDistribution, waitStats, currentWaitMin, evaluateStuck, isOverThreshold, isWaiting, thresholdBand,
  congestionLevel, isCongested, liveBucket, DEFAULT_WAIT_THRESHOLDS, DEFAULT_STUCK_RULES,
  type WaitThresholds, type QueueKpis, type LiveBucket, type ThresholdBand, type CongestionLevel,
} from './live-queue-core';
import type { OverviewScope } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { BranchCongestion, BranchThreshold, BranchWait, MetricTrend, NotConnected, QueueRow, TimelineEvent, QueueTimeline, RecentEvent, StuckRecord, TechAvailability, TodaySummary, TopBranch, WaitBranchStat, WaitAnalytics, LiveQueueOverview } from '@aipowersalon/api-contracts/platform';
import type { BranchCongestion, BranchThreshold, BranchWait, MetricTrend, NotConnected, QueueRow, TimelineEvent, QueueTimeline, RecentEvent, StuckRecord, TechAvailability, TodaySummary, TopBranch, WaitBranchStat, WaitAnalytics, LiveQueueOverview } from '@aipowersalon/api-contracts/platform';

export interface AdminCtx { userId?: string; email?: string; ip?: string }

export interface LiveQueueFilters {
  search: string;
  status: string;           // exact pos_queue_items status, '' = all active
  tenantId?: string;
  branchId?: string;
  page: number;
  pageSize: number;
  sort: string;             // queueId|customer|tenant|branch|status|wait|technician|service|updated
  direction: 'asc' | 'desc';
  scope?: OverviewScope;
}

// ---- raw bundle the repository returns (DB-shaped, ms timestamps) -------------------------------------------------
export interface RawLiveItem {
  id: string; tenantId: string; tenantName: string | null; branchId: string | null; branchName: string | null;
  customerName: string; isVip: boolean; priority: string; status: string; station: string | null;
  service: string | null; assignedTechnicianId: string | null; technicianName: string | null; technicianPhotoUrl?: string | null; source: string | null;
  checkedInAtMs: number; calledAtMs: number | null; startedAtMs: number | null; updatedAtMs: number;
}
export interface RawBranchMeta { branchId: string; branchName: string | null; tenantName: string | null; availableTechs: number; capacity: number }
export interface RawTechStatus { status: string; count: number }
export interface RawDeviceCounts { total: number | null; offline: number | null }
export interface RawTodayCounts { totalQueues: number; totalCustomers: number; completedServices: number }
export interface RawHourly { hour: number; count: number }

export interface RawLiveQueueData {
  aggItems: RawLiveItem[];         // all active items in scope (capped) — for KPIs/charts/derivations
  pageItems: RawLiveItem[];        // filtered+sorted+paginated slice — for the directory table
  pageTotal: number;
  branchMeta: RawBranchMeta[];
  techStatus: RawTechStatus[];
  devices: RawDeviceCounts;
  today: RawTodayCounts;
  hourly: RawHourly[];
}

interface Repo {
  liveQueueData(f: LiveQueueFilters): Promise<RawLiveQueueData>;
  insertSnapshot?(scopeKey: string, tenantId: string | null, metrics: Record<string, number | null>): Promise<void>;
  latestPriorSnapshot?(scopeKey: string, beforeIso: string): Promise<{ capturedAt: string; metrics: Record<string, number | null> } | null>;
}

// Whether an INCREASE in a metric is good for operations. Absent = neutral (favorability null).
const INCREASE_GOOD: Record<string, boolean> = {
  techniciansAvailable: true, customersInService: true, queueSyncPct: true, totalQueues: true, totalCustomers: true, completedServices: true,
  customersWaiting: false, avgWaitMin: false, longestWaitMin: false, unassignedCustomers: false, stuckRecords: false,
  offlineDevices: false, customersOverThreshold: false, congestedBranches: false, thresholdBreaches: false,
};

function metricsFrom(kpis: QueueKpis, today: { totalQueues: number; totalCustomers: number; completedServices: number }): Record<string, number | null> {
  return {
    customersWaiting: kpis.customersWaiting, techniciansAvailable: kpis.techniciansAvailable, customersInService: kpis.customersInService,
    avgWaitMin: kpis.avgWaitMin, longestWaitMin: kpis.longestWaitMin, unassignedCustomers: kpis.unassignedCustomers,
    queueSyncPct: kpis.queueSyncPct, stuckRecords: kpis.stuckRecords, offlineDevices: kpis.offlineDevices,
    customersOverThreshold: kpis.customersOverThreshold, congestedBranches: kpis.congestedBranches,
    totalQueues: today.totalQueues, totalCustomers: today.totalCustomers, completedServices: today.completedServices,
  };
}

function computeTrends(current: Record<string, number | null>, prior: Record<string, number | null>): Record<string, MetricTrend> {
  const out: Record<string, MetricTrend> = {};
  for (const [k, cur] of Object.entries(current)) {
    const p = prior[k];
    if (cur == null || p == null) continue;                 // no honest comparison → no trend chip
    const delta = Math.round((cur - p) * 10) / 10;
    const pct = p !== 0 ? Math.round(((cur - p) / Math.abs(p)) * 1000) / 10 : null;
    const good = INCREASE_GOOD[k];
    const favorable = delta === 0 || good === undefined ? null : good ? delta > 0 : delta < 0;
    out[k] = { delta, pct, favorable };
  }
  return out;
}

// ---- output payload ----------------------------------------------------------------------------------------------



/** Period-over-period trend for one metric. `favorable` is business-semantic (true = the change is good for operations,
 *  false = bad, null = neutral/flat), NOT merely the mathematical sign. */


const clampInt = (v: unknown, def: number, min: number, max: number): number => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
};
const clampStr = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const iso = (ms: number | null): string => (ms == null ? '' : new Date(ms).toISOString());

export class LiveQueueService {
  constructor(private readonly repo: Repo, private readonly thresholds: WaitThresholds = DEFAULT_WAIT_THRESHOLDS) {}

  parseFilters(q: Record<string, unknown>, scope?: OverviewScope): LiveQueueFilters {
    return {
      search: clampStr(q?.search), status: clampStr(q?.status, 40),
      tenantId: clampStr(q?.tenantId, 60) || undefined, branchId: clampStr(q?.branchId, 60) || undefined,
      page: clampInt(q?.page, 1, 1, 100000), pageSize: clampInt(q?.pageSize, 10, 1, 100),
      sort: clampStr(q?.sort, 24) || 'wait', direction: q?.direction === 'asc' ? 'asc' : 'desc', scope,
    };
  }

  async getOverview(_ctx: AdminCtx, f: LiveQueueFilters): Promise<LiveQueueOverview> {
    const now = Date.now();
    const data = await this.repo.liveQueueData(f);
    const t = this.thresholds;

    // --- per-branch aggregation over the active items (capacity from branchMeta) ---
    const byBranch = new Map<string, RawLiveItem[]>();
    for (const it of data.aggItems) {
      const key = it.branchId ?? '∅';
      (byBranch.get(key) ?? byBranch.set(key, []).get(key)!).push(it);
    }
    const metaByBranch = new Map(data.branchMeta.map((m) => [m.branchId, m]));

    const waitTimeByBranch: BranchWait[] = [];
    const topBranches: TopBranch[] = [];
    const branchesOverThreshold: BranchThreshold[] = [];
    const congestion: BranchCongestion[] = [];
    const waitByBranchFull: WaitBranchStat[] = [];
    let congestedCount = 0;

    for (const [branchId, items] of byBranch) {
      const branch = items[0]?.branchName ?? null;
      const waiting = items.filter((i) => liveBucket(i) === 'waiting' || liveBucket(i) === 'assigned' || liveBucket(i) === 'unassigned');
      const waitMins = waiting.map((i) => currentWaitMin(i.checkedInAtMs, now));
      const stats = waitStats(waitMins);
      const overT = waitMins.filter((w) => isOverThreshold(w, t)).length;
      const meta = metaByBranch.get(branchId);
      const cInputs = { waiting: waiting.length, overThreshold: overT, longestWaitMin: stats.longestMin, availableTechs: meta?.availableTechs ?? 0, capacity: meta?.capacity ?? 1 };
      const level = congestionLevel(cInputs, t);
      const congested = isCongested(cInputs, t);
      if (congested) congestedCount++;

      if (waiting.length > 0) {
        waitTimeByBranch.push({ branchId, branch, avgWaitMin: stats.avgMin });
        waitByBranchFull.push({ branchId, branch, waiting: waiting.length, overThreshold: overT, avgMin: stats.avgMin, medianMin: stats.medianMin, p90Min: stats.p90Min, longestMin: stats.longestMin });
      }
      topBranches.push({ branchId, branch, activeCount: items.length });
      if (overT > 0) branchesOverThreshold.push({ branchId, branch, overThreshold: overT, longestWaitMin: stats.longestMin });
      congestion.push({ branchId, branch, level, score: 0, waiting: waiting.length });
    }
    waitTimeByBranch.sort((a, b) => b.avgWaitMin - a.avgWaitMin);
    topBranches.sort((a, b) => b.activeCount - a.activeCount);
    branchesOverThreshold.sort((a, b) => b.overThreshold - a.overThreshold || b.longestWaitMin - a.longestWaitMin);

    // --- stuck derivation over active items (no business-state mutation) ---
    const stuckByItem = new Map<string, { reason: string | null }>();
    const stuckRecords: StuckRecord[] = [];
    for (const it of data.aggItems) {
      const r = evaluateStuck({ status: it.status, assignedTechnicianId: it.assignedTechnicianId, checkedInAtMs: it.checkedInAtMs, calledAtMs: it.calledAtMs, startedAtMs: it.startedAtMs, updatedAtMs: it.updatedAtMs }, now, DEFAULT_STUCK_RULES);
      if (r.stuck) {
        stuckByItem.set(it.id, { reason: r.reason });
        stuckRecords.push({
          queueId: it.id, tenantName: it.tenantName, branchName: it.branchName, customer: it.customerName,
          status: it.status, reason: r.reason, stuckMin: r.stuckMin, waitMin: currentWaitMin(it.checkedInAtMs, now),
        });
      }
    }
    stuckRecords.sort((a, b) => b.stuckMin - a.stuckMin);

    // --- devices + technician availability (real sources; honest null when unavailable) ---
    const offlineDevices = data.devices.offline;
    const techTotal = data.techStatus.reduce((a, s) => a + s.count, 0);
    const techCount = (s: string) => data.techStatus.filter((x) => x.status === s).reduce((a, x) => a + x.count, 0);
    const available = techCount('available');
    const techAvailability: TechAvailability | NotConnected = techTotal === 0
      ? { available: false, reason: 'No technician availability reported' }
      : {
          total: techTotal, available, busy: techCount('busy') + techCount('on_shift'), onBreak: techCount('on_break'),
          slices: [
            { label: 'Available', count: available },
            { label: 'Busy', count: techCount('busy') + techCount('on_shift') },
            { label: 'On Break', count: techCount('on_break') },
            { label: 'Offline', count: techCount('offline') + techCount('off_shift') },
          ].filter((s) => s.count > 0),
        };

    // --- KPIs via the tested core ---
    const kpis = rollupKpis(
      data.aggItems.map((i) => ({ status: i.status, assignedTechnicianId: i.assignedTechnicianId, branchId: i.branchId, checkedInAtMs: i.checkedInAtMs })),
      { techniciansAvailable: techTotal === 0 ? null : available, offlineDevices, syncedPct: null },
      now, congestedCount, stuckByItem.size, t,
    );

    // --- live status distribution (reconciles to live total) ---
    const dist = statusDistribution(data.aggItems.map((i) => ({ status: i.status, assignedTechnicianId: i.assignedTechnicianId })));

    // --- directory rows (paginated slice) ---
    const rows: QueueRow[] = data.pageItems.map((i) => {
      const waitMin = currentWaitMin(i.checkedInAtMs, now);
      const st = stuckByItem.get(i.id);
      return {
        queueId: i.id, tenantId: i.tenantId, branchId: i.branchId, customer: i.customerName, tenantName: i.tenantName, branchName: i.branchName, status: i.status,
        bucket: liveBucket(i), waitMin, technicianName: i.technicianName, service: i.service, isVip: i.isVip,
        deviceStatus: 'unknown', syncStatus: 'unknown', thresholdFlag: thresholdBand(waitMin, t),
        stuck: !!st, stuckReason: st?.reason ?? null,
      };
    });

    // --- recent events derived from REAL signals (queue lifecycle timestamps + threshold/stuck), capped & ordered ---
    const recentEvents = this.deriveRecentEvents(data.aggItems, stuckByItem, now, t).slice(0, 12);

    // --- today summary (9 metrics) ---
    const todaySummary: TodaySummary = {
      totalQueues: data.today.totalQueues, totalCustomers: data.today.totalCustomers,
      avgWaitMin: kpis.avgWaitMin, longestWaitMin: kpis.longestWaitMin, completedServices: data.today.completedServices,
      thresholdBreaches: kpis.customersOverThreshold, syncSuccessPct: null, stuckRecords: kpis.stuckRecords, offlineDevices,
    };

    const totalPages = Math.max(1, Math.ceil(data.pageTotal / f.pageSize));
    // --- period-over-period trends from the snapshot store (honest — empty until a prior snapshot exists) ---
    const scopeKey = f.tenantId ?? 'platform';
    const currentMetrics = metricsFrom(kpis, data.today);
    let trends: Record<string, MetricTrend> = {};
    let trendsSince: string | null = null;
    if (this.repo.latestPriorSnapshot) {
      const cutoffIso = new Date(now - 60_000).toISOString(); // ignore snapshots < 1 min old (avoid self-compare)
      const prior = await this.repo.latestPriorSnapshot(scopeKey, cutoffIso);
      if (prior) { trends = computeTrends(currentMetrics, prior.metrics); trendsSince = prior.capturedAt; }
    }
    // --- wait-time analytics (overall + per-branch), all from the tested core over real waiting items ---
    const allWaitMins = data.aggItems.filter((i) => isWaiting(i.status)).map((i) => currentWaitMin(i.checkedInAtMs, now));
    const overall = waitStats(allWaitMins);
    const waitAnalytics: WaitAnalytics = {
      overall: { count: overall.count, avgMin: overall.avgMin, medianMin: overall.medianMin, p90Min: overall.p90Min, longestMin: overall.longestMin },
      overThreshold: allWaitMins.filter((w) => isOverThreshold(w, t)).length,
      thresholds: { warningMin: t.warningMin, alertMin: t.alertMin, criticalMin: t.criticalMin },
      byBranch: waitByBranchFull.sort((a, b) => b.avgMin - a.avgMin).slice(0, 20),
    };
    return {
      meta: { generatedAt: new Date(now).toISOString(), scope: f.scope ? 'tenant' : 'platform' },
      kpis,
      queues: { rows, total: data.pageTotal, page: Math.min(f.page, totalPages), pageSize: f.pageSize, totalPages },
      healthAlerts: { congestedBranches: congestedCount, offlineDevices, customersOverThreshold: kpis.customersOverThreshold, stuckRecords: kpis.stuckRecords },
      waitTimeByBranch: waitTimeByBranch.slice(0, 12),
      liveStatusDistribution: dist,
      topBranches: topBranches.slice(0, 8),
      synchronizationStatus: { available: false, reason: 'No per-queue synchronization source connected' },
      recentEvents,
      branchesOverThreshold: branchesOverThreshold.slice(0, 8),
      congestion: congestion.filter((c) => c.level !== 'normal').sort((a, b) => b.waiting - a.waiting),
      technicianAvailability: techAvailability,
      queueVolumeTrend: data.hourly.map((h) => ({ hour: h.hour, count: h.count })),
      todaySummary,
      waitAnalytics,
      stuckRecords: stuckRecords.slice(0, 50),
      queueTimelines: this.buildTimelines(data.aggItems, stuckByItem, now, t).slice(0, 15),
      trends,
      trendsSince,
    };
  }

  /** Capture a KPI snapshot for the given scope (platform or tenant). Intended to be called on a schedule (cron) — and
   *  also manually — so that period-over-period trends have a real baseline. Returns the captured metrics. */
  async captureSnapshot(ctx: AdminCtx, f: LiveQueueFilters): Promise<{ ok: boolean; scopeKey: string; metrics: Record<string, number | null> }> {
    const overview = await this.getOverview(ctx, f);
    const scopeKey = f.tenantId ?? 'platform';
    const metrics = metricsFrom(overview.kpis, { totalQueues: overview.todaySummary.totalQueues, totalCustomers: overview.todaySummary.totalCustomers, completedServices: overview.todaySummary.completedServices });
    if (this.repo.insertSnapshot) await this.repo.insertSnapshot(scopeKey, f.tenantId ?? null, metrics);
    return { ok: true, scopeKey, metrics };
  }

  /** Per-queue timelines RECONSTRUCTED from the row's real lifecycle timestamps (check-in → called → assigned →
   *  in-service) plus threshold/stuck markers. This is honestly a reconstruction, not a tamper-evident append-only
   *  event log (which has no source yet) — events are ordered chronologically and never overwrite each other. */
  private buildTimelines(items: RawLiveItem[], stuck: Map<string, { reason: string | null }>, now: number, t: WaitThresholds): QueueTimeline[] {
    // Prioritise the most interesting queues: stuck first, then longest-waiting.
    const ranked = items.slice().sort((a, b) => {
      const sa = stuck.has(a.id) ? 1 : 0, sb = stuck.has(b.id) ? 1 : 0;
      if (sa !== sb) return sb - sa;
      return currentWaitMin(b.checkedInAtMs, now) - currentWaitMin(a.checkedInAtMs, now);
    });
    return ranked.map((i): QueueTimeline => {
      const events: TimelineEvent[] = [];
      const src = i.source ? ` via ${i.source.replace(/_/g, ' ')}` : '';
      events.push({ at: iso(i.checkedInAtMs), label: `Entered queue${src}`, state: 'waiting', kind: 'queued' });
      if (i.calledAtMs) events.push({ at: iso(i.calledAtMs), label: 'Customer called', state: 'called', kind: 'called' });
      if (i.assignedTechnicianId && (i.status === 'assigned' || i.startedAtMs)) events.push({ at: iso(i.calledAtMs ?? i.updatedAtMs), label: `Assigned to ${i.technicianName ?? 'technician'}`, state: 'assigned', kind: 'assigned' });
      if (i.startedAtMs) events.push({ at: iso(i.startedAtMs), label: 'Service started', state: 'in_service', kind: 'service_started' });
      const w = currentWaitMin(i.checkedInAtMs, now);
      if (isOverThreshold(w, t)) events.push({ at: iso(i.updatedAtMs), label: `Wait exceeded ${t.alertMin} min (${thresholdBand(w, t)})`, state: 'alert', kind: 'threshold' });
      const st = stuck.get(i.id);
      if (st) events.push({ at: iso(i.updatedAtMs), label: `Flagged stuck${st.reason ? ` — ${st.reason.replace(/_/g, ' ')}` : ''}`, state: 'stuck', kind: 'stuck' });
      events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)); // chronological
      return { queueId: i.id, customer: i.customerName, tenantName: i.tenantName, branchName: i.branchName, source: i.source, currentState: i.status, events };
    });
  }

  /** Recent events from real lifecycle signals — never fabricated. Ordered newest-first by the relevant timestamp. */
  private deriveRecentEvents(items: RawLiveItem[], stuck: Map<string, { reason: string | null }>, now: number, t: WaitThresholds): RecentEvent[] {
    const ev: RecentEvent[] = [];
    for (const i of items) {
      if (i.startedAtMs) ev.push({ at: iso(i.startedAtMs), queueId: i.id, summary: `${i.id.slice(0, 8)} service started`, branch: i.branchName, tenantName: i.tenantName, newState: 'in_service', kind: 'service_started' });
      else if (i.calledAtMs) ev.push({ at: iso(i.calledAtMs), queueId: i.id, summary: `${i.id.slice(0, 8)} called`, branch: i.branchName, tenantName: i.tenantName, newState: 'called', kind: 'called' });
      else ev.push({ at: iso(i.checkedInAtMs), queueId: i.id, summary: `${i.id.slice(0, 8)} added to queue`, branch: i.branchName, tenantName: i.tenantName, newState: 'waiting', kind: 'queued' });
      const w = currentWaitMin(i.checkedInAtMs, now);
      if (isOverThreshold(w, t)) ev.push({ at: iso(i.updatedAtMs), queueId: i.id, summary: `${i.id.slice(0, 8)} wait exceeded ${t.alertMin} min`, branch: i.branchName, tenantName: i.tenantName, newState: 'alert', kind: 'threshold' });
      if (stuck.has(i.id)) ev.push({ at: iso(i.updatedAtMs), queueId: i.id, summary: `${i.id.slice(0, 8)} flagged stuck`, branch: i.branchName, tenantName: i.tenantName, newState: 'stuck', kind: 'stuck' });
    }
    return ev.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }
}
