// menu-insights-core.spec.ts — Nest-free assertions for the insights rules: empty/honest-empty, top performer,
// low margin, raise price (uplift math), bundle opportunity, promote underperformer, and formatting. Runs under
// scripts/run-core-specs.sh.
import {
  computeMenuInsights, marginPct, fmtUsd, type ServiceMetric, type ProductMetric, type ComboMetric, type MenuInsight,
} from './menu-insights-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
const NOW = '2026-05-06T18:00:00.000Z';
const svc = (o: Partial<ServiceMetric> & { serviceId: string; name: string }): ServiceMetric => ({
  categoryId: 'cat1', categoryName: 'Cat 1', priceCents: 5000, costCents: null, bookings: 0, revenueCents: 0, addOnAttachRate: null, ...o,
});
const find = (rows: MenuInsight[], kind: string) => rows.find((r) => r.kind === kind);

// ---- formatting + margin ----
ok('fmtUsd whole', fmtUsd(50000) === '$500');
ok('fmtUsd plus', fmtUsd(50000, true) === '+$500');
ok('fmtUsd cents', fmtUsd(42050) === '$420.50');
ok('fmtUsd thousands', fmtUsd(420000) === '$4,200');
ok('marginPct basic', marginPct(1200, 960) === 20);
ok('marginPct null cost', marginPct(1000, null) === null);
ok('marginPct zero price', marginPct(0, 100) === null);

// ---- honest empty ----
const empty = computeMenuInsights({ windowDays: 30, services: [], products: [], combos: [], nowIso: NOW });
ok('empty hasEnoughData=false', empty.hasEnoughData === false);
ok('empty insights = []', empty.insights.length === 0);
ok('empty coverage reported', empty.coverage.services === 0 && empty.coverage.totalServiceRevenueCents === 0);

// services present but zero revenue/bookings/cost → still not enough data
const noActivity = computeMenuInsights({ windowDays: 30, services: [svc({ serviceId: 's1', name: 'A' })], products: [], combos: [], nowIso: NOW });
ok('zero-activity hasEnoughData=false', noActivity.hasEnoughData === false);

// ---- top performer ----
const tp = computeMenuInsights({
  windowDays: 30, products: [], combos: [], nowIso: NOW,
  services: [svc({ serviceId: 'a', name: 'Gel Manicure', revenueCents: 2100 }), svc({ serviceId: 'b', name: 'B', revenueCents: 1000 }), svc({ serviceId: 'c', name: 'C', revenueCents: 900 })],
});
const tpI = find(tp.insights, 'top_performer');
ok('top_performer fires', !!tpI);
ok('top_performer subject', tpI?.subjectId === 'a');
ok('top_performer pct = 53', tpI?.impactValue === 53); // 2100/4000 = 52.5 → 53
ok('top_performer cta', tpI?.ctaAction === 'keep_promoting');

// no top performer when share below 15% (many equal services)
const flat = computeMenuInsights({
  windowDays: 30, products: [], combos: [], nowIso: NOW,
  services: Array.from({ length: 10 }, (_, i) => svc({ serviceId: 's' + i, name: 'S' + i, revenueCents: 1000 })),
});
ok('no top_performer under 15%', !find(flat.insights, 'top_performer'));

// ---- low margin ----
const lm = computeMenuInsights({
  windowDays: 30, products: [], combos: [], nowIso: NOW,
  services: [svc({ serviceId: 'p', name: 'Paraffin', priceCents: 1200, costCents: 960, revenueCents: 5000 }), svc({ serviceId: 'q', name: 'Q', priceCents: 1000, costCents: null, revenueCents: 4000 })],
});
const lmI = find(lm.insights, 'low_margin');
ok('low_margin fires for costed service', lmI?.subjectId === 'p');
ok('low_margin value = 20', lmI?.impactValue === 20);
ok('low_margin severity warning', lmI?.severity === 'warning');
ok('no low_margin when cost unknown', !lm.insights.some((i) => i.kind === 'low_margin' && i.subjectId === 'q'));

// ---- raise price (uplift math) ----
const rp = computeMenuInsights({
  windowDays: 30, products: [], combos: [], nowIso: NOW,
  services: [
    svc({ serviceId: 'x', name: 'Gel X Full Set', priceCents: 4500, bookings: 50, revenueCents: 100000 }),
    svc({ serviceId: 'y', name: 'Y', priceCents: 6000, bookings: 5, revenueCents: 30000 }),
    svc({ serviceId: 'z', name: 'Z', priceCents: 6000, bookings: 3, revenueCents: 18000 }),
  ],
});
const rpI = find(rp.insights, 'raise_price');
ok('raise_price fires for high-demand below-median', rpI?.subjectId === 'x');
ok('raise_price uplift = +$500/mo', rpI?.impactLabel === '+$500/mo'); // suggested $10 cap × 50 bookings/mo = $500
ok('raise_price cta', rpI?.ctaAction === 'review_pricing');

// ---- bundle opportunity ----
const combos: ComboMetric[] = [{ aId: 'a', aName: 'Gel Mani', bId: 'n', bName: 'Nail Art', baseConversion: 0.20, comboConversion: 0.58, sampleSize: 40 }];
const bo = computeMenuInsights({ windowDays: 30, services: [], products: [], combos, nowIso: NOW });
const boI = find(bo.insights, 'bundle_opportunity');
ok('bundle_opportunity fires', !!boI);
ok('bundle_opportunity lift = 38%', boI?.impactValue === 38);
ok('bundle_opportunity cta', boI?.ctaAction === 'create_bundle');
const thin = computeMenuInsights({ windowDays: 30, services: [], products: [], combos: [{ aId: 'c', aName: 'C', bId: 'd', bName: 'D', baseConversion: 0.2, comboConversion: 0.45, sampleSize: 10 }], nowIso: NOW });
ok('no bundle for thin sample', !find(thin.insights, 'bundle_opportunity'));

// ---- promote underperformer ----
const products: ProductMetric[] = [
  { productId: 'u', name: 'U', unitsSold: 100, revenueCents: 50000, marginPct: 60 },
  { productId: 'v', name: 'V', unitsSold: 90, revenueCents: 45000, marginPct: 60 },
  { productId: 'w', name: 'W', unitsSold: 80, revenueCents: 40000, marginPct: 60 },
  { productId: 'lav', name: 'Cuticle Oil - Lavender', unitsSold: 5, revenueCents: 2000, marginPct: 66 },
];
const pu = computeMenuInsights({ windowDays: 30, services: [], products, combos: [], nowIso: NOW });
const puI = find(pu.insights, 'promote_underperformer');
ok('promote fires for underperformer', puI?.subjectId === 'lav');
ok('promote cta', puI?.ctaAction === 'create_bundle');

// ---- cap ----
ok('respects MAX_INSIGHTS cap', computeMenuInsights({ windowDays: 30, products, combos, nowIso: NOW, services: rp.coverage ? [
  svc({ serviceId: 'x', name: 'X', priceCents: 4500, bookings: 50, revenueCents: 100000, costCents: 4200 }),
] : [] }).insights.length <= 8);

console.log(`menu-insights-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
