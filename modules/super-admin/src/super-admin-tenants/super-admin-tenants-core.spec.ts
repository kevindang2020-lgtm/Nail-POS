/**
 * super-admin-tenants-core.spec.ts
 * ---------------------------------------------------------------------------
 * Real assertion harness (no faked results). Compile + run:
 *   npx esbuild ...core.ts ...spec.ts --bundle --platform=node | node
 * Also compatible with vitest/jest in the repo (each check is an it()-able unit;
 * here we run them directly and print PASS/FAIL, exiting non-zero on any failure).
 */

import {
  centsToUsd,
  usdLabelToCents,
  derivePlanTier,
  derivePaymentLabel,
  subscriptionLabel,
  derivePaymentSetup,
  isAiEnabled,
  isSetupComplete,
  deriveDisplayStatus,
  payoffLabel,
  toViewRow,
  TAB_PREDICATES,
  tabCounts,
  applyFilter,
  applyTabThenFilter,
  paginate,
  buildKpis,
  buildTenantsState,
  canTransition,
  validateCreateTenant,
  validateSuspend,
  auditFor,
  type TenantRecord,
} from './super-admin-tenants-core';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name);
  }
}
function eq<T>(name: string, got: T, want: T): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  check(name + (ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`), ok);
}

/* --------- record factory --------- */
function rec(over: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: 'x',
    displayName: 'X Nails',
    tenantCode: 'XNAIL01',
    ownerName: 'Owner',
    ownerEmail: 'o@x.com',
    ownerPhone: '(555) 000-0000',
    ownerActivated: true,
    primaryCity: 'Cherry Hill',
    primaryState: 'NJ',
    branchCount: 1,
    storedStatus: 'active',
    plan: 'Pro Plan',
    subscriptionStatus: 'active',
    aiPackage: 'AI Basic',
    monthlyRevenueCents: 100000,
    usagePercent: 50,
    fiservConfigured: true,
    paymentConfigStatus: 'active',
    hardwarePayoffRemainingCents: 0,
    lastLoginLabel: '1 hr ago',
    createdLabel: 'Apr 02, 2026',
    createdDaysAgo: 36,
    customers: [980, 1500],
    technicians: [5, 6],
    aiCallsLabel: '1,260',
    smsLabel: '880',
    ...over,
  };
}

console.log('\n== formatting ==');
eq('centsToUsd whole', centsToUsd(486000), '$4,860');
eq('centsToUsd cents', centsToUsd(486050), '$4,860.50');
eq('centsToUsd zero', centsToUsd(0), '$0');
eq('usdLabelToCents round-trip', usdLabelToCents('$4,860'), 486000);
eq('usdLabelToCents with decimals', usdLabelToCents('$1,234.56'), 123456);

console.log('\n== plan tier derivation ==');
eq('gold->Premium', derivePlanTier('Gold Plan'), 'Premium');
eq('pro->Standard', derivePlanTier('Pro Plan'), 'Standard');
eq('starter->Basic', derivePlanTier('Starter Plan'), 'Basic');
eq('trial->Trial', derivePlanTier('Trial Plan'), 'Trial');

console.log('\n== payment label ==');
eq('active->Current', derivePaymentLabel('active'), 'Current');
eq('trialing->Trial', derivePaymentLabel('trialing'), 'Trial');
eq('past_due->Past Due', derivePaymentLabel('past_due'), 'Past Due');

console.log('\n== payment setup state (gateway config) ==');
eq('active->complete', derivePaymentSetup(rec({ paymentConfigStatus: 'active' })), 'complete');
eq('error->failed', derivePaymentSetup(rec({ paymentConfigStatus: 'error' })), 'failed');
eq('pending->pending', derivePaymentSetup(rec({ paymentConfigStatus: 'pending', fiservConfigured: false })), 'pending');
eq('disabled->incomplete', derivePaymentSetup(rec({ paymentConfigStatus: 'disabled', fiservConfigured: false })), 'incomplete');
eq('none(no fiserv)->incomplete', derivePaymentSetup(rec({ paymentConfigStatus: 'none', fiservConfigured: false })), 'incomplete');
eq('none(legacy fiserv)->complete', derivePaymentSetup(rec({ paymentConfigStatus: 'none', fiservConfigured: true })), 'complete');
{
  const rows = [
    toViewRow(rec({ id: 'a', paymentConfigStatus: 'active' })),
    toViewRow(rec({ id: 'b', paymentConfigStatus: 'error', fiservConfigured: false })),
    toViewRow(rec({ id: 'c', paymentConfigStatus: 'pending', fiservConfigured: false })),
    toViewRow(rec({ id: 'd', paymentConfigStatus: 'disabled', fiservConfigured: false })),
  ];
  eq('filter setup=failed', applyFilter(rows, { setup: 'failed' }).map((r) => r.id).join(','), 'b');
  eq('filter setup=pending', applyFilter(rows, { setup: 'pending' }).map((r) => r.id).join(','), 'c');
  eq('filter setup=complete', applyFilter(rows, { setup: 'complete' }).map((r) => r.id).join(','), 'a');
  eq('filter setup=incomplete', applyFilter(rows, { setup: 'incomplete' }).map((r) => r.id).join(','), 'd');
}
eq('posDevices maps from posDeviceCount', toViewRow(rec({ posDeviceCount: 7 })).posDevices, 7);
eq('posDevices null when no source', toViewRow(rec()).posDevices, null);
eq('sub active+date -> Renews', subscriptionLabel('active', '2026-04-12'), 'Renews Apr 12, 2026');
eq('sub trialing+iso -> Trial ends', subscriptionLabel('trialing', '2026-05-20T00:00:00.000Z'), 'Trial ends May 20, 2026');
eq('sub past_due+date', subscriptionLabel('past_due', '2026-03-01'), 'Past due (Mar 1, 2026)');
eq('sub cancelled -> Cancelled', subscriptionLabel('cancelled', null), 'Cancelled');
eq('sub active no date -> status word', subscriptionLabel('active', undefined), 'Active');
eq('sub unknown -> null', subscriptionLabel(undefined, undefined), null);
eq('expired->Past Due', derivePaymentLabel('expired'), 'Past Due');

console.log('\n== ai enabled ==');
check('AI Pro enabled', isAiEnabled('AI Pro') === true);
check('None disabled', isAiEnabled('None') === false);
check('empty disabled', isAiEnabled('') === false);

console.log('\n== setup completeness ==');
check('complete when all present', isSetupComplete(rec()) === true);
check('incomplete: no branch', isSetupComplete(rec({ branchCount: 0 })) === false);
check('incomplete: no fiserv', isSetupComplete(rec({ fiservConfigured: false })) === false);
check('incomplete: owner not activated', isSetupComplete(rec({ ownerActivated: false })) === false);

console.log('\n== display status precedence ==');
eq('suspended wins', deriveDisplayStatus(rec({ storedStatus: 'suspended', subscriptionStatus: 'past_due' })), 'suspended');
eq('cancelled is its own status', deriveDisplayStatus(rec({ storedStatus: 'cancelled' })), 'cancelled');
eq('cancelled outranks past_due', deriveDisplayStatus(rec({ storedStatus: 'cancelled', subscriptionStatus: 'past_due' })), 'cancelled');
eq('pastdue over setup', deriveDisplayStatus(rec({ subscriptionStatus: 'past_due', fiservConfigured: false })), 'pastdue');
eq('setup when incomplete', deriveDisplayStatus(rec({ fiservConfigured: false })), 'setup');
eq('warning: high usage', deriveDisplayStatus(rec({ usagePercent: 91 })), 'warning');
eq('warning: trial ending soon', deriveDisplayStatus(rec({ subscriptionStatus: 'trialing', createdDaysAgo: 6 })), 'warning');
eq('healthy baseline', deriveDisplayStatus(rec()), 'healthy');

console.log('\n== payoff label ==');
eq('payoff paid', payoffLabel(0), 'Paid off');
eq('payoff na', payoffLabel(-1), '—');
eq('payoff remaining', payoffLabel(120000), '$1,200 remaining');

console.log('\n== view-row parity with screen seed (luxe001) ==');
const luxe = toViewRow(
  rec({
    id: 'luxe001',
    displayName: 'Luxe Nails & Spa',
    tenantCode: 'LUXE001',
    ownerName: 'Emily Johnson',
    ownerEmail: 'emily@luxenails.com',
    ownerPhone: '(555) 123-4567',
    primaryCity: 'Cherry Hill',
    primaryState: 'NJ',
    branchCount: 3,
    plan: 'Gold Plan',
    subscriptionStatus: 'active',
    aiPackage: 'AI Pro',
    monthlyRevenueCents: 486000,
    usagePercent: 82,
    fiservConfigured: true,
    hardwarePayoffRemainingCents: 120000,
    lastLoginLabel: '12 min ago',
    createdLabel: 'May 08, 2026',
    createdDaysAgo: 0,
    customers: [2340, 2500],
    technicians: [9, 10],
    aiCallsLabel: '4,820',
    smsLabel: '2,940',
  }),
);
eq('luxe code', luxe.code, 'LUXE001');
eq('luxe planTier', luxe.planTier, 'Premium');
eq('luxe rev', luxe.rev, '$4,860');
eq('luxe pay', luxe.pay, 'Current');
eq('luxe status', luxe.status, 'healthy');
eq('luxe sl', luxe.sl, 'Healthy');
eq('luxe aiEnabled', luxe.aiEnabled, true);
eq('luxe payoff', luxe.payoff, '$1,200 remaining');

/* dataset for tabs / filters / kpis */
const ds = [
  rec({ id: 'a', plan: 'Gold Plan', aiPackage: 'AI Pro', primaryState: 'NJ', monthlyRevenueCents: 486000, usagePercent: 82, paymentConfigStatus: 'active' }), // healthy, current, gateway live
  rec({ id: 'b', subscriptionStatus: 'past_due', plan: 'Gold Plan', aiPackage: 'AI Pro', primaryState: 'NJ', monthlyRevenueCents: 274000, usagePercent: 91, paymentConfigStatus: 'active' }), // pastdue, gateway live
  rec({ id: 'c', plan: 'Trial Plan', subscriptionStatus: 'trialing', aiPackage: 'None', fiservConfigured: false, paymentConfigStatus: 'none', createdDaysAgo: 6, primaryState: 'PA', monthlyRevenueCents: 0 }), // trial -> setup, no gateway
  rec({ id: 'd', storedStatus: 'suspended', aiPackage: 'None', fiservConfigured: false, paymentConfigStatus: 'disabled', primaryState: 'DE', monthlyRevenueCents: 0 }), // suspended, gateway disabled
  rec({ id: 'e', fiservConfigured: false, aiPackage: 'None', paymentConfigStatus: 'pending', ownerActivated: false, primaryState: 'NJ', monthlyRevenueCents: 0 }), // setup, gateway pending
];
const rows = ds.map(toViewRow);

console.log('\n== tab predicates ==');
const tc = tabCounts(rows);
eq('all=5', tc.all, 5);
eq('pastdue=1', tc.pastdue, 1);
eq('suspended=1', tc.suspended, 1);
eq('setup=2 (c and e)', tc.setup, 2);
eq('ai=2 (a,b)', tc.ai, 2);
eq('nomid=3 (c,d,e)', tc.nomid, 3);
check('active tab excludes suspended/pastdue/setup', tc.active === rows.filter((r) => r.status === 'healthy' || r.status === 'warning').length);

console.log('\n== filters ==');
eq('filter plan Gold', applyFilter(rows, { plan: 'Gold Plan' }).length, 2);
eq('filter state PA', applyFilter(rows, { state: 'PA' }).length, 1);
eq('filter pay Past Due', applyFilter(rows, { pay: 'Past Due' }).length, 1);
eq('filter ai None', applyFilter(rows, { ai: 'None' }).length, 3);
eq('filter setup incomplete (c,d)', applyFilter(rows, { setup: 'incomplete' }).length, 2);
eq('filter setup complete (a,b)', applyFilter(rows, { setup: 'complete' }).length, 2);
eq('filter setup pending (e)', applyFilter(rows, { setup: 'pending' }).length, 1);
eq('search by code', applyFilter(rows, { q: 'XNAIL01' }).length, 5);
eq('tab+filter: ai tab then state NJ', applyTabThenFilter(rows, 'ai', { state: 'NJ' }).length, 2);

console.log('\n== pagination ==');
const bigRecords = Array.from({ length: 23 }, (_, i) => rec({ id: 'p' + i }));
const big = bigRecords.map(toViewRow);
const pg1 = paginate(big, 1, 10);
eq('page1 slice', pg1.slice.length, 10);
eq('totalPages', pg1.pagination.totalPages, 3);
const pg3 = paginate(big, 3, 10);
eq('page3 slice (remainder)', pg3.slice.length, 3);
const pgClamp = paginate(big, 99, 10);
eq('page clamps to last', pgClamp.pagination.page, 3);

console.log('\n== KPIs ==');
const k = buildKpis(rows);
const byLab = (l: string) => k.find((x) => x.lab === l)!.val;
eq('Total Tenants', byLab('Total Tenants'), '5');
eq('Past Due', byLab('Past Due'), '1');
eq('Suspended', byLab('Suspended'), '1');
eq('Setup Required', byLab('Setup Required'), '2');
eq('AI Enabled', byLab('AI Enabled'), '2');
eq('Monthly Revenue sum', byLab('Monthly Revenue'), '$7,600'); // 4860+2740+0+0+0
check('KPIs computed over full set in buildTenantsState (not just page)', (() => {
  const st = buildTenantsState(bigRecords, { page: 1, pageSize: 5 });
  return st.tenants.length === 5 && st.kpis.find((x) => x.lab === 'Total Tenants')!.val === '23';
})());

console.log('\n== status state machine ==');
check('pending->active ok', canTransition('pending', 'activate').ok);
check('active->suspended ok', canTransition('active', 'suspend').ok);
check('suspended->active ok', canTransition('suspended', 'reactivate').ok);
check('active->cancelled ok', canTransition('active', 'cancel').ok);
check('reactivate on active rejected', !canTransition('active', 'reactivate').ok);
check('suspend already suspended rejected', !canTransition('suspended', 'suspend').ok);
check('cancelled is terminal (no reactivate)', !canTransition('cancelled', 'reactivate').ok);
check('cancelled->active illegal', !canTransition('cancelled', 'activate').ok);
eq('suspend target', canTransition('active', 'suspend').to, 'suspended');

console.log('\n== validation ==');
check('create missing fields fails', !validateCreateTenant({}).ok);
check('create bad email fails', !validateCreateTenant({ displayName: 'A', ownerName: 'B', ownerEmail: 'nope', plan: 'Pro Plan' }).ok);
check('create bad code fails', !validateCreateTenant({ displayName: 'A', ownerName: 'B', ownerEmail: 'a@b.com', plan: 'Pro', tenantCode: 'bad code!' }).ok);
check('create happy path ok', validateCreateTenant({ displayName: 'Luxe', ownerName: 'Emily', ownerEmail: 'emily@luxe.com', plan: 'Gold Plan', tenantCode: 'LUXE001' }).ok);
check('suspend needs reason', !validateSuspend({ reason: 'no' }).ok);
check('suspend with reason ok', validateSuspend({ reason: 'Non-payment after 30 days' }).ok);
// support-session validation moved to the canonical /super-admin/platform path (round 8 retirement); covered by verify-super-admin-platform.

console.log('\n== audit ==');
eq('audit shape', auditFor('super_admin_tenant_suspended', 'luxe001', { reason: 'x' }), {
  actionType: 'super_admin_tenant_suspended',
  entityType: 'tenant',
  entityId: 'luxe001',
  metadata: { reason: 'x' },
});

console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
if (fail > 0) process.exit(1);
