// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { CongestionLevel, LiveBucket, QueueKpis, ThresholdBand } from '@aipowersalon/api-contracts/platform';
import type { CongestionLevel, LiveBucket, QueueKpis, ThresholdBand } from '@aipowersalon/api-contracts/platform';
// live-queue-core.ts — PURE, I/O-free core for the Super Admin Live Queue Monitor: wait-time stats, live status
// distribution and the KPI rollup. BUILD_PLAN Phase 6 (audit "parallel implementations" 2): the wait bands, congestion
// level and stuck-record rules are NOT computed here any more — they come from the ONE queue detection core in
// @aipowersalon/ai (QueueDetection: the same functions and the same salon-default thresholds the salons' own alert scan
// uses). This monitor used to run its own engine at 30/45/60 min with its own congestion score while the salons were
// alerted at 10/20/30/45; a branch could be "critical" on the POS and "fine" on the platform screen.
// The service/repository feed these real rows from pos_queue_items
// (+ the existing devices/technician-availability modules) — this file fabricates nothing and has no DB/clock dependency
// (callers pass `nowMs`). Mirrors the audit-first / reuse-don't-duplicate discipline: no queue logic is re-implemented,
// only the read-side aggregation the monitor needs.

import { QueueDetection } from '@aipowersalon/ai';

// ---------------------------------------------------------------------------------------------------------------------
// Vocabulary (pos_queue_items.status, migrations 026 + 480) — the detection core's
// ---------------------------------------------------------------------------------------------------------------------

export type QueueStatus =
  | 'waiting' | 'called' | 'assigned' | 'ready_for_tech' | 'moved_to_tech_queue'
  | 'in_service' | 'completed' | 'done' | 'cancelled' | 'removed';

export const ACTIVE_STATUSES: readonly string[] = [...QueueDetection.PRE_SERVICE_STATUSES, ...QueueDetection.IN_SERVICE_STATUSES];
export const isActive = (s: string): boolean => QueueDetection.isPreService(s) || QueueDetection.isInService(s);
export const isWaiting = (s: string): boolean => QueueDetection.isPreService(s);

// ---------------------------------------------------------------------------------------------------------------------
// Wait time. Current wait = now - checked_in_at while still waiting. Completed wait = started_at - checked_in_at.
// All values are minutes (rounded), never negative (clock skew / timezone conversion can't produce a negative wait).
// ---------------------------------------------------------------------------------------------------------------------

export const MS_PER_MIN = 60_000;
const nonNegMin = (ms: number): number => (ms <= 0 ? 0 : Math.round(ms / MS_PER_MIN));

/** Minutes a customer has been waiting (since they entered the waiting state). */
export function currentWaitMin(checkedInAtMs: number, nowMs: number): number {
  return nonNegMin(nowMs - checkedInAtMs);
}
/** Minutes a customer waited before service began. */
export function completedWaitMin(checkedInAtMs: number, startedAtMs: number): number {
  return nonNegMin(startedAtMs - checkedInAtMs);
}

export interface WaitStats { count: number; avgMin: number; medianMin: number; p90Min: number; longestMin: number }

/** Average / median / 90th-percentile / longest over a set of wait minutes. Empty input → all zeros (honest, not null-y).
 *  Percentile uses nearest-rank on the sorted set. */
export function waitStats(mins: readonly number[]): WaitStats {
  const xs = mins.filter((m) => Number.isFinite(m) && m >= 0).slice().sort((a, b) => a - b);
  if (xs.length === 0) return { count: 0, avgMin: 0, medianMin: 0, p90Min: 0, longestMin: 0 };
  const sum = xs.reduce((a, b) => a + b, 0);
  const at = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(p * xs.length) - 1))];
  const median = xs.length % 2 ? xs[(xs.length - 1) / 2] : Math.round((xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
  return { count: xs.length, avgMin: Math.round(sum / xs.length), medianMin: median, p90Min: at(0.9), longestMin: xs[xs.length - 1] };
}

// ---------------------------------------------------------------------------------------------------------------------
// Thresholds — the salon defaults of the one settings source. The monitor's three bands are the core's upper three
// wait levels: warning = "exceeded", alert = "severe", critical = "critical" ("approaching" is a board colour only).
// ---------------------------------------------------------------------------------------------------------------------

export interface WaitThresholds { warningMin: number; alertMin: number; criticalMin: number }
const D = QueueDetection.DEFAULT_DETECTION_THRESHOLDS;
export const DEFAULT_WAIT_THRESHOLDS: WaitThresholds = { warningMin: D.waitExceededMin, alertMin: D.waitSevereMin, criticalMin: D.waitCriticalMin };

/** The detection core's thresholds for a monitor band set (the other detectors keep the salon defaults). */
export function detectionThresholds(t: WaitThresholds = DEFAULT_WAIT_THRESHOLDS): QueueDetection.DetectionThresholds {
  return { ...D, waitApproachingMin: Math.min(D.waitApproachingMin, t.warningMin), waitExceededMin: t.warningMin, waitSevereMin: t.alertMin, waitCriticalMin: t.criticalMin };
}

export function thresholdBand(waitMin: number, t: WaitThresholds = DEFAULT_WAIT_THRESHOLDS): ThresholdBand {
  const level = QueueDetection.classifyWait(waitMin, detectionThresholds(t));
  return level === 'critical' ? 'critical' : level === 'severe' ? 'alert' : level === 'exceeded' ? 'warning' : 'none';
}
/** A customer is "over threshold" once they reach the alert boundary (warning is informational). */
export const isOverThreshold = (waitMin: number, t: WaitThresholds = DEFAULT_WAIT_THRESHOLDS): boolean =>
  thresholdBand(waitMin, t) === 'alert' || thresholdBand(waitMin, t) === 'critical';

// ---------------------------------------------------------------------------------------------------------------------
// Live status distribution. Buckets are MUTUALLY EXCLUSIVE and reconcile exactly to the live total (spec §18, §41).
// "unassigned" is an ASSIGNMENT state layered over the lifecycle: an active, not-yet-in-service item with no technician.
// ---------------------------------------------------------------------------------------------------------------------

export interface LiveItemLite { status: string; assignedTechnicianId: string | null }

/** Single source of truth for which live bucket a row falls in. in_service first (regardless of assignment); then an
 *  active pre-service item is 'unassigned' when it has no technician, else 'assigned' (status assigned) or 'waiting'. */
export function liveBucket(item: LiveItemLite): LiveBucket {
  const s = item.status;
  if (QueueDetection.isInService(s)) return 'in_service';
  if (!isWaiting(s)) return 'other';
  if (!item.assignedTechnicianId) return 'unassigned';
  if (s === 'assigned') return 'assigned';
  return 'waiting'; // waiting | called | handed to the tech queue, with a technician earmarked
}

export interface DistributionSlice { bucket: LiveBucket; count: number }

export function statusDistribution(items: readonly LiveItemLite[]): { slices: DistributionSlice[]; total: number } {
  const order: LiveBucket[] = ['waiting', 'assigned', 'in_service', 'unassigned', 'other'];
  const counts = new Map<LiveBucket, number>(order.map((b) => [b, 0]));
  for (const it of items) counts.set(liveBucket(it), (counts.get(liveBucket(it)) ?? 0) + 1);
  const slices = order.map((bucket) => ({ bucket, count: counts.get(bucket) ?? 0 })).filter((s) => s.count > 0);
  return { slices, total: items.length };
}

export const isUnassigned = (item: LiveItemLite): boolean => liveBucket(item) === 'unassigned';

// ---------------------------------------------------------------------------------------------------------------------
// Congestion — the detection core's classifyCongestion (waiting per FREE technician against the salon setting, plus the
// longest wait against the ladder). The monitor's level names: the core's 'high' is shown as 'congested'.
// ---------------------------------------------------------------------------------------------------------------------

export interface CongestionInputs {
  waiting: number;            // active pre-service customers at the branch
  overThreshold: number;      // of those, how many are over the alert threshold (shown; the level does not need it)
  longestWaitMin: number;     // longest current wait at the branch
  availableTechs: number;     // technicians currently available to take a customer
  capacity: number;           // serviceable capacity (stations / on-shift techs) — shown; the level reads free technicians
}

export function congestionLevel(i: CongestionInputs, t: WaitThresholds = DEFAULT_WAIT_THRESHOLDS): CongestionLevel {
  const c = QueueDetection.classifyCongestion({ waitingCount: i.waiting, longestWaitMinutes: i.longestWaitMin, availableTechnicians: i.availableTechs }, detectionThresholds(t));
  return c.level === 'high' ? 'congested' : c.level;
}
/** A branch counts toward "Congested Branches" once it reaches the 'congested' band or worse. */
export const isCongested = (i: CongestionInputs, t?: WaitThresholds): boolean => {
  const lvl = congestionLevel(i, t);
  return lvl === 'congested' || lvl === 'severe' || lvl === 'critical';
};

// ---------------------------------------------------------------------------------------------------------------------
// Stuck records — the detection core's evaluateStuck (real updated_at, the real status vocabulary, the salon's stuck
// window). Never mutates anything. The monitor keeps its reason codes for the screen.
// ---------------------------------------------------------------------------------------------------------------------

export interface StuckRules { stuckMinutes: number }
export const DEFAULT_STUCK_RULES: StuckRules = { stuckMinutes: D.stuckMinutes };

export interface StuckInputs {
  status: string;
  assignedTechnicianId: string | null;
  checkedInAtMs: number;
  calledAtMs: number | null;
  startedAtMs: number | null;
  updatedAtMs: number;
}
export interface StuckResult { stuck: boolean; reason: string | null; stuckMin: number }

const REASON: Record<QueueDetection.StuckReason, string> = {
  assigned_not_started: 'assigned_no_service_start', called_not_progressed: 'called_not_progressed', handoff_stale: 'handoff_stale',
  waiting_no_change: 'waiting_no_change', technician_clocked_out: 'technician_clocked_out',
};
export function evaluateStuck(i: StuckInputs, nowMs: number, rules: StuckRules = DEFAULT_STUCK_RULES): StuckResult {
  const r = QueueDetection.evaluateStuck({ status: i.status, assignedTechnicianId: i.assignedTechnicianId, startedAt: i.startedAtMs == null ? null : new Date(i.startedAtMs).toISOString(),
    updatedAt: Number.isFinite(i.updatedAtMs) ? new Date(i.updatedAtMs).toISOString() : null }, nowMs, rules);
  return r.stuck && r.reason ? { stuck: true, reason: REASON[r.reason], stuckMin: r.minutes } : { stuck: false, reason: null, stuckMin: 0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// KPI rollup (spec §7, §41). The monitor's 11 cards. Values that have a real source are computed here from the live
// items + the externally-supplied device/technician counts. Sync% has NO canonical per-item source yet, so it is
// surfaced as `null` (the UI renders NotConnected) rather than a fabricated percentage.
// ---------------------------------------------------------------------------------------------------------------------

export interface QueueKpiItem {
  status: string;
  assignedTechnicianId: string | null;
  branchId: string | null;
  checkedInAtMs: number;
}
export interface ExternalCounts {
  techniciansAvailable: number | null; // from live-technician-schedule (null if unavailable)
  offlineDevices: number | null;       // from devices module heartbeat (null if unavailable)
  syncedPct: number | null;            // null until a per-item sync source exists — honest gap
}

export function rollupKpis(
  items: readonly QueueKpiItem[],
  external: ExternalCounts,
  nowMs: number,
  congestedBranchCount: number,
  stuckCount: number,
  thresholds: WaitThresholds = DEFAULT_WAIT_THRESHOLDS,
): QueueKpis {
  const waitMins = items.filter((i) => isWaiting(i.status)).map((i) => currentWaitMin(i.checkedInAtMs, nowMs));
  const stats = waitStats(waitMins);
  let waiting = 0, inService = 0, unassigned = 0, overThreshold = 0;
  for (const it of items) {
    const b = liveBucket({ status: it.status, assignedTechnicianId: it.assignedTechnicianId });
    if (b === 'in_service') inService++;
    else if (b === 'unassigned') { unassigned++; waiting++; }
    else if (b === 'waiting' || b === 'assigned') waiting++;
    if (isWaiting(it.status) && isOverThreshold(currentWaitMin(it.checkedInAtMs, nowMs), thresholds)) overThreshold++;
  }
  return {
    customersWaiting: waiting,
    techniciansAvailable: external.techniciansAvailable,
    customersInService: inService,
    avgWaitMin: stats.avgMin,
    longestWaitMin: stats.longestMin,
    unassignedCustomers: unassigned,
    queueSyncPct: external.syncedPct,
    stuckRecords: stuckCount,
    offlineDevices: external.offlineDevices,
    customersOverThreshold: overThreshold,
    congestedBranches: congestedBranchCount,
  };
}
