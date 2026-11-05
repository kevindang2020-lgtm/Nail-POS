import { describe, it, expect } from 'vitest';
import {
  currentWaitMin, completedWaitMin, waitStats, thresholdBand, isOverThreshold,
  liveBucket, statusDistribution, isUnassigned, congestionLevel, isCongested,
  evaluateStuck, rollupKpis, MS_PER_MIN, DEFAULT_WAIT_THRESHOLDS, DEFAULT_STUCK_RULES,
} from './live-queue-core';
import { QueueDetection } from '@aipowersalon/ai';

const now = Date.UTC(2026, 4, 6, 14, 34, 0); // May 06 2026 2:34 PM (the reference fixture clock)
const minsAgo = (m: number) => now - m * MS_PER_MIN;

describe('wait time', () => {
  it('current/completed wait are minute-rounded and never negative', () => {
    expect(currentWaitMin(minsAgo(18), now)).toBe(18);
    expect(currentWaitMin(now + 5 * MS_PER_MIN, now)).toBe(0); // future check-in (skew) → 0
    expect(completedWaitMin(minsAgo(40), minsAgo(8))).toBe(32);
  });
  it('waitStats computes avg/median/p90/longest, empty → zeros', () => {
    expect(waitStats([])).toEqual({ count: 0, avgMin: 0, medianMin: 0, p90Min: 0, longestMin: 0 });
    const s = waitStats([18, 32, 67, 9, 12, 45]);
    expect(s.count).toBe(6);
    expect(s.longestMin).toBe(67);
    expect(s.avgMin).toBe(Math.round((18 + 32 + 67 + 9 + 12 + 45) / 6));
    expect(s.p90Min).toBe(67);
  });
});

describe('thresholds — the salon defaults of the one settings source (BUILD_PLAN Phase 6)', () => {
  it('bands by the core ladder: warning = exceeded (20), alert = severe (30), critical = critical (45)', () => {
    expect(DEFAULT_WAIT_THRESHOLDS).toEqual({ warningMin: 20, alertMin: 30, criticalMin: 45 });
    expect(thresholdBand(10)).toBe('none');
    expect(thresholdBand(22)).toBe('warning');
    expect(thresholdBand(32)).toBe('alert');
    expect(thresholdBand(67)).toBe('critical');
    expect(isOverThreshold(22)).toBe(false); // warning is not "over"
    expect(isOverThreshold(30)).toBe(true);
    expect(isOverThreshold(67)).toBe(true);
  });
  it('agrees with the salons\' own alert scan minute for minute (no second engine)', () => {
    const t = QueueDetection.DEFAULT_DETECTION_THRESHOLDS;
    const map: Record<string, string> = { none: 'none', approaching: 'none', exceeded: 'warning', severe: 'alert', critical: 'critical' };
    for (let m = 0; m <= 120; m++) expect(thresholdBand(m)).toBe(map[QueueDetection.classifyWait(m, t)]);
    expect(DEFAULT_STUCK_RULES.stuckMinutes).toBe(t.stuckMinutes);
  });
});

describe('live buckets + distribution', () => {
  it('classifies into mutually exclusive buckets', () => {
    expect(liveBucket({ status: 'in_service', assignedTechnicianId: 't1' })).toBe('in_service');
    expect(liveBucket({ status: 'waiting', assignedTechnicianId: null })).toBe('unassigned');
    expect(liveBucket({ status: 'assigned', assignedTechnicianId: 't1' })).toBe('assigned');
    expect(liveBucket({ status: 'waiting', assignedTechnicianId: 't1' })).toBe('waiting');
    expect(liveBucket({ status: 'cancelled', assignedTechnicianId: null })).toBe('other');
    expect(isUnassigned({ status: 'waiting', assignedTechnicianId: null })).toBe(true);
  });
  it('distribution reconciles exactly to the live total', () => {
    const items = [
      { status: 'in_service', assignedTechnicianId: 't1' },
      { status: 'in_service', assignedTechnicianId: 't2' },
      { status: 'waiting', assignedTechnicianId: null },
      { status: 'assigned', assignedTechnicianId: 't3' },
      { status: 'cancelled', assignedTechnicianId: null },
    ];
    const d = statusDistribution(items);
    expect(d.total).toBe(5);
    expect(d.slices.reduce((a, s) => a + s.count, 0)).toBe(5);
    expect(d.slices.find((s) => s.bucket === 'in_service')!.count).toBe(2);
    expect(d.slices.find((s) => s.bucket === 'unassigned')!.count).toBe(1);
  });
});

describe('congestion — the core\'s classifier', () => {
  it('a well-staffed branch with a big queue is NOT congested', () => {
    const i = { waiting: 20, overThreshold: 0, longestWaitMin: 8, availableTechs: 18, capacity: 20 };
    expect(isCongested(i)).toBe(false);
    expect(congestionLevel(i)).toBe('normal');   // 1.1 waiting per free technician (< 0.625 × 2) and a short wait
  });
  it('an understaffed branch with breaches IS congested/severe', () => {
    const i = { waiting: 22, overThreshold: 14, longestWaitMin: 67, availableTechs: 1, capacity: 4 };
    expect(congestionLevel(i)).toBe('critical');
    expect(isCongested(i)).toBe(true);
  });
  it('the core\'s "high" is the monitor\'s "congested"', () => {
    expect(congestionLevel({ waiting: 4, overThreshold: 0, longestWaitMin: 5, availableTechs: 2, capacity: 2 })).toBe('congested');
  });
});

describe('stuck derivation (no state mutation)', () => {
  it('flags an assigned row with no service start past the window', () => {
    const r = evaluateStuck({ status: 'assigned', assignedTechnicianId: 't1', checkedInAtMs: minsAgo(40), calledAtMs: minsAgo(36), startedAtMs: null, updatedAtMs: minsAgo(35) }, now);   // past the 30-min stuck window
    expect(r.stuck).toBe(true);
    expect(r.reason).toBe('assigned_no_service_start');
  });
  it('does not flag an in-service or freshly-updated row', () => {
    expect(evaluateStuck({ status: 'in_service', assignedTechnicianId: 't1', checkedInAtMs: minsAgo(60), calledAtMs: minsAgo(50), startedAtMs: minsAgo(40), updatedAtMs: minsAgo(40) }, now).stuck).toBe(false);
    expect(evaluateStuck({ status: 'waiting', assignedTechnicianId: null, checkedInAtMs: minsAgo(5), calledAtMs: null, startedAtMs: null, updatedAtMs: minsAgo(2) }, now).stuck).toBe(false);
  });
});

describe('KPI rollup', () => {
  it('reconciles waiting/in-service/unassigned/over-threshold and passes through honest gaps', () => {
    const items = [
      { status: 'waiting', assignedTechnicianId: null, branchId: 'b1', checkedInAtMs: minsAgo(67) }, // unassigned + over threshold
      { status: 'waiting', assignedTechnicianId: 't1', branchId: 'b1', checkedInAtMs: minsAgo(18) },
      { status: 'assigned', assignedTechnicianId: 't2', branchId: 'b1', checkedInAtMs: minsAgo(9) },
      { status: 'in_service', assignedTechnicianId: 't3', branchId: 'b2', checkedInAtMs: minsAgo(50) },
      { status: 'cancelled', assignedTechnicianId: null, branchId: 'b2', checkedInAtMs: minsAgo(80) },
    ];
    const k = rollupKpis(items, { techniciansAvailable: 142, offlineDevices: 9, syncedPct: null }, now, 5, 7);
    expect(k.customersWaiting).toBe(3);   // 2 waiting + 1 assigned (active pre-service)
    expect(k.customersInService).toBe(1);
    expect(k.unassignedCustomers).toBe(1);
    expect(k.customersOverThreshold).toBe(1); // the 67-min waiter
    expect(k.longestWaitMin).toBe(67);
    expect(k.techniciansAvailable).toBe(142);
    expect(k.offlineDevices).toBe(9);
    expect(k.queueSyncPct).toBeNull(); // honest gap — no per-item sync source
    expect(k.congestedBranches).toBe(5);
    expect(k.stuckRecords).toBe(7);
  });
});
