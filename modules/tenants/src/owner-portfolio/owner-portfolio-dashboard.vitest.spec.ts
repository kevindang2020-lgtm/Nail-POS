// owner-portfolio-dashboard.vitest.spec.ts — the All Salons dashboard: ranking, revenue series, and the two
// bugs that made it wrong.
//
// What was broken before this:
//
//   1. loadTotals() selected `customers_waiting` FROM `queue_entries` — a table that does not exist. The real
//      one is `pos_queue_items` (migration 026). Postgres threw on the whole statement, so
//      GET /owner/portfolio/summary returned a 500 and the ENTIRE All Salons dashboard was dead in production.
//   2. SalonTotals requires checkedIn / servicesInProgress / readyForCheckout / newClientsToday /
//      aiReceptionistLive. None were selected or mapped, so summarize() added `undefined` — five of the twelve
//      KPI cards were NaN even when the query ran.
//   3. Revenue summed `payments` and never subtracted `payment_refunds`, a separate table. Every owner-facing
//      figure was OVERSTATED by every refund the salon had ever issued.
//
// (1) and (2) are pinned by the pgtest spec against a real schema; a unit test cannot catch a wrong table name.
// What IS unit-testable — and is what the money and the permission model actually turn on — is below.
import { describe, it, expect } from 'vitest';
import { summarize, topSalons, pctChange, type OwnerPortfolio, type SalonTotals } from './owner-portfolio-core';

const salon = (o: Partial<any> = {}): any => ({
  tenantId: 't1', salonName: 'Salon', storeCode: 'CODE', tenantStatus: 'active',
  accessLevel: 'owner', isPrimaryOwner: false, branches: [{ branchId: 'b1', name: 'Main', isActive: true }],
  ...o,
});

const totals = (o: Partial<SalonTotals> = {}): SalonTotals => ({
  tenantId: 't1',
  appointmentsToday: 0, checkedIn: 0, customersWaiting: 0, servicesInProgress: 0, readyForCheckout: 0,
  techniciansWorking: 0, newClientsToday: 0,
  revenueTodayCents: 0, revenueMonthCents: 0, tipsTodayCents: 0,
  revenueYesterdayCents: 0, tipsYesterdayCents: 0,
  appointmentsYesterday: 0, checkedInYesterday: 0, newClientsYesterday: 0,
  aiReceptionistLive: null,
  ...o,
});

const portfolio = (salons: any[]): OwnerPortfolio => ({ ownerUserId: 'u1', salons } as OwnerPortfolio);

describe('topSalons — the ranked list', () => {
  it('ranks the owner\u2019s salons by refund-netted revenue, highest first', () => {
    const p = portfolio([
      salon({ tenantId: 'a', salonName: 'Luxe Downtown' }),
      salon({ tenantId: 'b', salonName: 'Belle Cherry Hill' }),
      salon({ tenantId: 'c', salonName: 'Radiant West End' }),
    ]);
    const t = [
      totals({ tenantId: 'a', revenueTodayCents: 562000 }),
      totals({ tenantId: 'b', revenueTodayCents: 348000 }),
      totals({ tenantId: 'c', revenueTodayCents: 259600 }),
    ];
    const r = topSalons(p, t);
    expect(r.map((x) => [x.rank, x.salonName, x.revenueTodayCents])).toEqual([
      [1, 'Luxe Downtown', 562000],
      [2, 'Belle Cherry Hill', 348000],
      [3, 'Radiant West End', 259600],
    ]);
  });

  it('EXCLUDES — and does not even NAME — a salon whose figures were never loaded for this owner', () => {
    // This is the line between "the owner's portfolio, ranked" and a platform leaderboard.
    //
    // How the exclusion actually works, precisely: the controller resolves the REPORTABLE salons first and only
    // queries totals for those, so a salon the owner may not report on arrives here with no totals at all. The
    // `canAtSalon(..., 'reports')` filter below is defence-in-depth — today every access level happens to carry
    // `reports`, so the operative guard is that the money was never fetched in the first place. That ordering is
    // the right one: a salon the owner cannot report on is never even SELECTed, so its revenue cannot leak
    // through an aggregate, a ranking, or a chart line.
    const p = portfolio([
      salon({ tenantId: 'a', salonName: 'Mine' }),
      salon({ tenantId: 'b', salonName: 'Not mine to report on' }),
    ]);
    const t = [totals({ tenantId: 'a', revenueTodayCents: 100 })];   // 'b' was never queried
    const r = topSalons(p, t);
    expect(r).toHaveLength(1);
    expect(r[0].salonName).toBe('Mine');
    expect(JSON.stringify(r)).not.toContain('Not mine');
  });

  it('drops a salon whose access level lacks `reports`, if one ever exists', () => {
    // Defence-in-depth against a future access level. Vacuous today by design, and it should stay that way.
    const p = portfolio([salon({ tenantId: 'a', salonName: 'No reports', accessLevel: 'no_reports' as any })]);
    expect(topSalons(p, [totals({ tenantId: 'a', revenueTodayCents: 999 })])).toEqual([]);
  });

  it('excludes a suspended salon', () => {
    const p = portfolio([
      salon({ tenantId: 'a', salonName: 'Active' }),
      salon({ tenantId: 'b', salonName: 'Suspended', tenantStatus: 'suspended' }),
    ]);
    const t = [totals({ tenantId: 'a', revenueTodayCents: 10 }), totals({ tenantId: 'b', revenueTodayCents: 500 })];
    expect(topSalons(p, t).map((x) => x.salonName)).toEqual(['Active']);
  });

  it('is stable on ties rather than reshuffling on every reload', () => {
    const p = portfolio([salon({ tenantId: 'a', salonName: 'Zeta' }), salon({ tenantId: 'b', salonName: 'Alpha' })]);
    const t = [totals({ tenantId: 'a', revenueTodayCents: 500 }), totals({ tenantId: 'b', revenueTodayCents: 500 })];
    expect(topSalons(p, t).map((x) => x.salonName)).toEqual(['Alpha', 'Zeta']);
  });

  it('handles a salon with no totals at all — it is omitted, not ranked as zero', () => {
    // A zero would tell the owner "this salon took nothing today". Absent data is not the same as no revenue.
    const p = portfolio([salon({ tenantId: 'a', salonName: 'Has data' }), salon({ tenantId: 'b', salonName: 'No data' })]);
    expect(topSalons(p, [totals({ tenantId: 'a', revenueTodayCents: 1 })]).map((x) => x.salonName)).toEqual(['Has data']);
  });
});

describe('summarize — the KPI cards that used to be NaN', () => {
  it('aggregates all five previously-unmapped fields as real numbers', () => {
    const p = portfolio([salon({ tenantId: 'a' }), salon({ tenantId: 'b' })]);
    const t = [
      totals({ tenantId: 'a', checkedIn: 40, servicesInProgress: 9, readyForCheckout: 7, newClientsToday: 12, aiReceptionistLive: true }),
      totals({ tenantId: 'b', checkedIn: 46, servicesInProgress: 9, readyForCheckout: 7, newClientsToday: 11, aiReceptionistLive: false }),
    ];
    const s: any = summarize(p, t);
    for (const k of ['checkedIn', 'servicesInProgress', 'readyForCheckout', 'newClientsToday']) {
      expect(Number.isNaN(s[k]), `${k} must not be NaN`).toBe(false);
    }
    expect(s.checkedIn).toBe(86);
    expect(s.servicesInProgress).toBe(18);
    expect(s.readyForCheckout).toBe(14);
    expect(s.newClientsToday).toBe(23);
  });

  it('reports the AI receptionist as none / live / degraded — never a fabricated "Online"', () => {
    // `false` means an agent exists and is DOWN. `null` means there was never one. Collapsing them would either
    // alarm a salon that never bought the feature, or — worse — paint a dead agent as fine.
    const p2 = portfolio([salon({ tenantId: 'a' }), salon({ tenantId: 'b' })]);

    // nobody configured one → 'none', not 'offline'
    expect((summarize(p2, [totals({ tenantId: 'a', aiReceptionistLive: null }), totals({ tenantId: 'b', aiReceptionistLive: null })]) as any).aiReceptionist).toBe('none');
    // all configured agents are up → 'live'
    expect((summarize(p2, [totals({ tenantId: 'a', aiReceptionistLive: true }), totals({ tenantId: 'b', aiReceptionistLive: null })]) as any).aiReceptionist).toBe('live');
    // one configured agent is down → 'degraded', surfaced rather than hidden behind the healthy one
    expect((summarize(p2, [totals({ tenantId: 'a', aiReceptionistLive: true }), totals({ tenantId: 'b', aiReceptionistLive: false })]) as any).aiReceptionist).toBe('degraded');
  });

  it('money aggregates in integer cents and stays an integer', () => {
    const p = portfolio([salon({ tenantId: 'a' }), salon({ tenantId: 'b' })]);
    const s: any = summarize(p, [
      totals({ tenantId: 'a', revenueTodayCents: 562_000, tipsTodayCents: 58_000 }),
      totals({ tenantId: 'b', revenueTodayCents: 696_600, tipsTodayCents: 67_800 }),
    ]);
    expect(s.revenueTodayCents).toBe(1_258_600);
    expect(Number.isInteger(s.revenueTodayCents)).toBe(true);
    expect(s.tipsTodayCents).toBe(125_800);
  });

  it('a refund-netted salon can go NEGATIVE for the day, and that is reported, not clamped to zero', () => {
    // A salon that refunded more than it took today really did take negative revenue. Clamping it to 0 would
    // hide a refund storm — exactly the thing an owner opens this dashboard to notice.
    const p = portfolio([salon({ tenantId: 'a' })]);
    const s: any = summarize(p, [totals({ tenantId: 'a', revenueTodayCents: -12_500 })]);
    expect(s.revenueTodayCents).toBe(-12_500);
  });
});

describe('pctChange — the change percentages in the reference image', () => {
  it('computes a real change against a real baseline', () => {
    expect(pctChange(12_586_00, 10_462_00)).toBe(20.3);   // the image's "Revenue ↑20.3%" — now DERIVED, not typed
    expect(pctChange(128, 108)).toBe(18.5);
  });

  it('reports a DECREASE rather than hiding it', () => {
    expect(pctChange(80, 100)).toBe(-20);
  });

  it('returns NULL when there is no baseline — never "+100%", never 0', () => {
    // A salon that took nothing yesterday and $5,000 today did not grow by a percentage. The comparison is
    // undefined, and the card must say NOTHING rather than print a figure that looks precise and means nothing.
    expect(pctChange(500_000, 0)).toBeNull();
    expect(pctChange(0, 0)).toBeNull();
  });

  it('handles a negative baseline (a refund-heavy yesterday) without flipping the sign', () => {
    // Yesterday netted -$100, today +$100. The magnitude of the baseline is what scales the change; using the
    // signed value would report a *fall* when revenue actually rose.
    expect(pctChange(10_000, -10_000)).toBe(200);
  });

  it('never returns Infinity or NaN', () => {
    for (const [c, p] of [[1, 0], [0, 0], [NaN, 1], [1, NaN], [Infinity, 1]] as [number, number][]) {
      const r = pctChange(c, p);
      expect(r === null || Number.isFinite(r)).toBe(true);
    }
  });
});

describe('summarize — changes block', () => {
  it('compares TODAY against YESTERDAY over exactly the same salon set', () => {
    const p = portfolio([salon({ tenantId: 'a' }), salon({ tenantId: 'b' })]);
    const s: any = summarize(p, [
      totals({ tenantId: 'a', revenueTodayCents: 600_000, revenueYesterdayCents: 500_000 }),
      totals({ tenantId: 'b', revenueTodayCents: 400_000, revenueYesterdayCents: 500_000 }),
    ]);
    // 1,000,000 today vs 1,000,000 yesterday → 0. Emphatically NOT +20%, which is what you would get by
    // reading salon 'a' alone: 'b' fell by exactly as much as 'a' rose. The UI hides a 0 chip, so the card
    // shows the number with no delta — which is the truth.
    expect(s.changes.revenueTodayPct).toBe(0);
  });

  it('leaves every change NULL when there is no yesterday at all — a brand-new portfolio shows no deltas', () => {
    const p = portfolio([salon({ tenantId: 'a' })]);
    const s: any = summarize(p, [totals({ tenantId: 'a', revenueTodayCents: 500_000, appointmentsToday: 40 })]);
    expect(s.changes.revenueTodayPct).toBeNull();
    expect(s.changes.appointmentsPct).toBeNull();
    expect(s.changes.newClientsPct).toBeNull();
  });
});
