// bundles-core.spec.ts — Nest-free assertions for bundle math: component totals, savings (cents + %),
// active-window logic, window validation, kind guards, and KPI summary. Runs under scripts/run-core-specs.sh.
import {
  componentsTotalCents, savingsCents, savingsPct, isActiveNow, isValidWindow, isBundleKind, isBundleStatus,
  isBundleItemType, summarize, BUNDLE_KINDS, type BundleSummaryRow,
} from './bundles-core';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

// ---- component totals ----
ok('componentsTotal sums qty×unit', componentsTotalCents([{ quantity: 1, unitPriceCents: 4500 }, { quantity: 1, unitPriceCents: 5500 }]) === 10000);
ok('componentsTotal multiplies quantity', componentsTotalCents([{ quantity: 2, unitPriceCents: 5500 }, { quantity: 1, unitPriceCents: 6000 }]) === 17000);
ok('componentsTotal floors fractional qty', componentsTotalCents([{ quantity: 2.9, unitPriceCents: 100 }]) === 200);
ok('componentsTotal clamps negatives to 0', componentsTotalCents([{ quantity: -3, unitPriceCents: 500 }, { quantity: 1, unitPriceCents: -200 }]) === 0);
ok('componentsTotal empty = 0', componentsTotalCents([]) === 0);

// ---- savings (cents) ----
ok('savings = components − price', savingsCents(10000, 9200) === 800);
ok('savings floored at 0 when price ≥ components', savingsCents(5000, 6000) === 0);
ok('savings exact-equal = 0', savingsCents(1900, 1900) === 0);

// ---- savings (%) ----
ok('savingsPct rounds', savingsPct(10000, 9200) === 8);
ok('savingsPct 0 when no components', savingsPct(0, 9200) === 0);
ok('savingsPct 0 when no saving', savingsPct(1900, 1900) === 0);
ok('savingsPct VIP 12%', savingsPct(17000, 14900) === 12); // 2100/17000 = 12.35 → 12

// ---- active window ----
const NOW = '2026-05-06T18:00:00.000Z';
ok('inactive never live', isActiveNow('inactive', null, null, NOW) === false);
ok('archived never live', isActiveNow('archived', null, null, NOW) === false);
ok('active no window = live', isActiveNow('active', null, null, NOW) === true);
ok('active before start = not live', isActiveNow('active', '2026-06-01T00:00:00.000Z', null, NOW) === false);
ok('active after end = not live', isActiveNow('active', null, '2026-05-01T00:00:00.000Z', NOW) === false);
ok('active inside window = live', isActiveNow('active', '2026-05-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z', NOW) === true);

// ---- window validation ----
ok('window valid when open-ended', isValidWindow('2026-05-01T00:00:00Z', null) === true);
ok('window valid end>start', isValidWindow('2026-05-01T00:00:00Z', '2026-05-31T00:00:00Z') === true);
ok('window invalid end<start', isValidWindow('2026-05-31T00:00:00Z', '2026-05-01T00:00:00Z') === false);
ok('window invalid end=start', isValidWindow('2026-05-01T00:00:00Z', '2026-05-01T00:00:00Z') === false);

// ---- guards ----
ok('kind guard accepts known', BUNDLE_KINDS.every((k) => isBundleKind(k)));
ok('kind guard rejects junk', !isBundleKind('combo') && !isBundleKind(7));
ok('status guard', isBundleStatus('active') && !isBundleStatus('deleted'));
ok('item-type guard', isBundleItemType('service') && isBundleItemType('product') && !isBundleItemType('membership'));

// ---- KPI summary ----
const rows: BundleSummaryRow[] = [
  { kind: 'bundle', status: 'active', priceCents: 9200, componentsTotalCents: 10000, startsAt: null, endsAt: null },
  { kind: 'package', status: 'active', priceCents: 14900, componentsTotalCents: 17000, startsAt: null, endsAt: null },
  { kind: 'promo', status: 'active', priceCents: 4900, componentsTotalCents: 5900, startsAt: null, endsAt: '2026-05-01T00:00:00Z' }, // ended → active but not live
  { kind: 'membership', status: 'active', priceCents: 1900, componentsTotalCents: 1900, startsAt: null, endsAt: null }, // no saving
  { kind: 'promo', status: 'inactive', priceCents: 7500, componentsTotalCents: 8200, startsAt: null, endsAt: null },
];
const k = summarize(rows, NOW);
ok('summary totalBundles', k.totalBundles === 5);
ok('summary activeBundles', k.activeBundles === 4);
ok('summary inactiveBundles', k.inactiveBundles === 1);
ok('summary liveNow excludes ended', k.liveNow === 3);
ok('summary byKind', k.byKind.bundle === 1 && k.byKind.package === 1 && k.byKind.promo === 2 && k.byKind.membership === 1);
ok('summary totalSavings = 800+2100+1000+0', k.totalSavingsCents === 3900);
ok('summary avgSavingsPct over priced active (8,12,17,0→avg of 8/12/17)', k.avgSavingsPct === Math.round((8 + 12 + 17 + 0) / 4));

console.log(`bundles-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
