// overview-floor.vitest.spec — Overview 27-inch mandate (Oct 28 2026) §12, §16–§17, §21, §28. The Overview's server rules:
// the 7-day trend has a point for every day; minutes left on a live service come from the visit's own durations (paused
// time excluded, never a universal default); inventory severity is Inventory's own rule with the branch overrides, most
// urgent first; insights are advisory, at most five, only when there is something to say, each naming where to act; every
// KPI has a written definition. The SQL that feeds these is verified on PostgreSQL 16 (see the status doc).
import { describe, it, expect } from 'vitest';
import { fillRevenueTrend, liveMinutesLeft, inventoryAlertStatus, inventoryAlertOrder, buildOverviewInsights, OVERVIEW_KPI_DEFINITIONS, OVERVIEW_INSIGHTS_MAX, type OverviewInsightFacts } from './overview-floor';
import { toPosOverviewState } from './overview.dto';
import { emptyOverview } from './overview.repository';

const facts = (o: Partial<OverviewInsightFacts> = {}): OverviewInsightFacts => ({ longestWaitMinutes: 0, waitingGuests: 0, averageServiceMinutes: 45, readyForCheckout: 0, staffOnBreak: 0, onDuty: 0, lowInventory: 0, topServiceName: null, topServiceRevenueCents: 0, appointmentsRemaining: 3, unassignedWaiting: 0, availableTechnicians: 0, ...o });

describe('Revenue Trend (§17)', () => {
  it('fills every one of the 7 days, ending on the business date', () => {
    const t = fillRevenueTrend([{ date: '2026-10-26', revenueCents: 1000 }, { date: '2026-10-28', revenueCents: 2500 }], '2026-10-28');
    expect(t.map((p) => p.date)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    expect(t.map((p) => p.revenueCents)).toEqual([0, 0, 0, 0, 1000, 0, 2500]);
  });
  it('crosses a month boundary', () => { expect(fillRevenueTrend([], '2026-11-02')[0].date).toBe('2026-10-27'); });
});

describe('Live Tech Queue minutes left (§12)', () => {
  const now = Date.UTC(2026, 9, 28, 15, 0);
  it('duration − elapsed, paused time excluded, never negative', () => {
    expect(liveMinutesLeft(now - 20 * 60000, 0, 60, now)).toBe(40);
    expect(liveMinutesLeft(now - 20 * 60000, 10 * 60000, 60, now)).toBe(50);
    expect(liveMinutesLeft(now - 90 * 60000, 0, 60, now)).toBe(0);
  });
  it('no duration or not started → null (no universal default)', () => {
    expect(liveMinutesLeft(now, 0, 0, now)).toBeNull(); expect(liveMinutesLeft(null, 0, 60, now)).toBeNull();
  });
});

describe('Inventory Alerts (§21)', () => {
  it("Inventory's thresholds: out / critical (explicit or half the reorder point) / low / fine", () => {
    expect(inventoryAlertStatus(0, 6, null)).toBe('out'); expect(inventoryAlertStatus(3, 6, null)).toBe('critical');
    expect(inventoryAlertStatus(5, 6, null)).toBe('low'); expect(inventoryAlertStatus(5, 6, 5)).toBe('critical'); expect(inventoryAlertStatus(7, 6, null)).toBeNull();
  });
  it('most urgent first: out, then critical, then low by how far below the reorder point', () => {
    const rows = [{ product: 'a', status: 'low', stock: 5, reorderLevel: 6 }, { product: 'b', status: 'out', stock: 0, reorderLevel: 6 }, { product: 'c', status: 'critical', stock: 2, reorderLevel: 6 }, { product: 'd', status: 'low', stock: 4, reorderLevel: 20 }];
    expect(rows.sort(inventoryAlertOrder).map((r) => r.product)).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('AI Insights are advisory (§16)', () => {
  it('nothing to say → no insights (no "High revenue service —", "Staff on break 0", "Inventory low 0")', () => {
    expect(buildOverviewInsights(facts())).toEqual([]);
  });
  it('a busy salon → at most five, in a fixed order, each with the page where staff act', () => {
    const ins = buildOverviewInsights(facts({ longestWaitMinutes: 41, waitingGuests: 18, readyForCheckout: 8, staffOnBreak: 2, onDuty: 10, lowInventory: 20, topServiceName: 'Acrylic Full Set', topServiceRevenueCents: 52000, unassignedWaiting: 6, availableTechnicians: 3 }));
    expect(ins).toHaveLength(OVERVIEW_INSIGHTS_MAX);
    expect(ins.map((i) => i.id)).toEqual(['long_wait', 'unassigned', 'checkout_backlog', 'inventory_low', 'staff_on_break']);
    expect(ins.every((i) => typeof i.route === 'string' && i.route.startsWith('/'))).toBe(true);
  });
  it('a long wait is relative to the service time (≥ 20 min or half the average service)', () => {
    expect(buildOverviewInsights(facts({ longestWaitMinutes: 19, waitingGuests: 2 })).length).toBe(0);
    expect(buildOverviewInsights(facts({ longestWaitMinutes: 25, waitingGuests: 2 }))[0].id).toBe('long_wait');
    expect(buildOverviewInsights(facts({ longestWaitMinutes: 25, waitingGuests: 2, averageServiceMinutes: 90 })).length).toBe(0);
  });
  it('the flat summary projection still reads the kept type codes', () => {
    const res = emptyOverview({ tenantId: 't', branchId: 'b' });
    res.analytics.quickInsights = buildOverviewInsights(facts({ staffOnBreak: 2, onDuty: 9, lowInventory: 3, topServiceName: 'Gel', topServiceRevenueCents: 100 }));
    expect(() => toPosOverviewState(res)).not.toThrow();
    expect(res.analytics.quickInsights.map((q) => q.type)).toEqual(['inventory_low', 'staff_on_break', 'high_revenue_service']);
  });
});

describe('KPI definitions (§28)', () => {
  it('every Overview KPI has a written definition', () => {
    for (const k of ['todayCheckIns', 'waitingGuests', 'walkInsToday', 'servingNow', 'readyCheckout', 'todayRevenue', 'averageTicket', 'staffOnDuty']) expect(OVERVIEW_KPI_DEFINITIONS[k]?.length).toBeGreaterThan(30);
  });
});
