import { offerStatus, assemblePromotionKpis, assembleStatusMix, deriveOfferExceptions, pct } from './promotions-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);

// status mapping
eq(offerStatus('in_progress'), { label: 'Active', tone: 'ok' }, 'in_progress → Active');
eq(offerStatus('scheduled'), { label: 'Scheduled', tone: 'warn' }, 'scheduled → warn');
eq(offerStatus('cancelled'), { label: 'Cancelled', tone: 'danger' }, 'cancelled → danger');
eq(offerStatus('completed'), { label: 'Completed', tone: 'info' }, 'completed → info');
eq(offerStatus('weird'), { label: 'weird', tone: 'muted' }, 'unknown passthrough muted');

// KPI assembly: real six resolve; the other six are honest gaps with notes
{ const k = assemblePromotionKpis({ activePromotions: 78, scheduledPromotions: 22, completedPromotions: 164, discountRedemptions: 12846, revenueImpactCents: 12876400, participatingBranches: 342, platformOffers: 24, highValuePending: 11, averageDiscountPct: 18.7 });
  eq(k.activePromotions, { value: 78, available: true }, 'active real');
  ok(k.revenueImpactCents.value === 12876400 && k.revenueImpactCents.available, 'revenue real');
  ok(k.platformOffers.value === 24 && k.platformOffers.available, 'platform offers now real');
  ok(k.highValuePending.value === 11 && k.highValuePending.available, 'high-value now real');
  ok(k.averageDiscountPct.value === 18.7 && k.averageDiscountPct.available, 'weighted avg discount now real');
  ok(k.promotionTemplates.available === false && !!k.promotionTemplates.note, 'templates honest gap w/ note');
  ok(k.abuseAlerts.available === false, 'abuse honest gap');
  ok(k.redemptionRatePct.available === false, 'redemption rate honest gap'); }
// platform offers of 0 is a real answer, not a gap
{ const k = assemblePromotionKpis({ platformOffers: 0 }); ok(k.platformOffers.available === true && k.platformOffers.value === 0, 'zero platform offers is real'); }

// status mix reconciles + merges synonyms (in_progress + active both → Active)
{ const m = assembleStatusMix([{ status: 'in_progress', count: 70 }, { status: 'active', count: 8 }, { status: 'scheduled', count: 22 }, { status: 'completed', count: 164 }]);
  eq(m.total, 264, 'total = sum'); const active = m.segments.find((s) => s.label === 'Active'); eq(active?.value, 78, 'in_progress+active merged to 78'); }
{ const m = assembleStatusMix([]); eq(m.total, 0, 'empty total 0'); }

// pct
eq(pct(78, 264), 29.5, 'pct rounded'); eq(pct(1, 0), 0, 'no div by zero');

// offer exceptions — real derived integrity checks
{ const e = deriveOfferExceptions({ id: 'o1', name: 'Bad Dates', tenant: 'Glamour', status: 'scheduled', startAt: '2026-05-10T00:00:00Z', endAt: '2026-05-01T00:00:00Z', branchId: 'b1', tenantId: 't1', revenueCents: 0 });
  eq(e.length, 1, 'one exception'); eq(e[0].issue, 'End date before start date', 'end<start detected'); eq(e[0].severity, 'High', 'high severity'); }
{ const e = deriveOfferExceptions({ id: 'o2', name: 'Stale', tenant: 'Luxe', status: 'active', startAt: '2026-01-01T00:00:00Z', endAt: '2020-01-01T00:00:00Z', branchId: null, tenantId: null, revenueCents: -5 });
  const issues = e.map((x) => x.issue);
  ok(issues.includes('End date before start date'), 'bad dates'); ok(issues.includes('Expired but still active'), 'expired-active'); ok(issues.includes('Missing tenant'), 'missing tenant'); ok(issues.includes('Negative revenue recorded'), 'negative revenue'); }
{ const e = deriveOfferExceptions({ id: 'o3', name: 'Clean', tenant: 'Elite', status: 'active', startAt: '2026-05-01T00:00:00Z', endAt: '2026-12-01T00:00:00Z', branchId: 'b1', tenantId: 't1', revenueCents: 1000 });
  eq(e.length, 0, 'clean offer → no exceptions'); }

// promotion mix by type (now a real structured column)
import { assembleTypeMix, weightedDiscountPct } from './promotions-core';
{ const m = assembleTypeMix([{ type: 'percentage', count: 38 }, { type: 'fixed_amount', count: 20 }, { type: 'buy_x_get_y', count: 12 }, { type: 'bundle', count: 6 }, { type: 'free_service', count: 2 }]);
  eq(m.total, 78, 'type mix total'); eq(m.segments[0], { label: 'Percentage Discount', value: 38 }, 'top type labelled'); }
{ const m = assembleTypeMix([{ type: 'percentage', count: 0 }]); eq(m.total, 0, 'empty type mix'); }
eq(weightedDiscountPct(3120, 15600), 20, 'weighted discount 20%');
eq(weightedDiscountPct(0, 0), null, 'no eligible → null');

console.log(`promotions-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
