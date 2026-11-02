// billing-core.spec.ts — verifies the pure billing roll-up. Run by scripts/run-core-specs.sh (process.exit(1) on fail).
import { buildBilling, normalizeSubscriptionUpdate } from './billing-core';
import type { BillingFact } from './billing.dto';

let failures = 0;
function check(name: string, cond: boolean) { if (!cond) { console.error('FAIL:', name); failures++; } else { console.log('ok:', name); } }

const facts: BillingFact[] = [
  { tenantId: 't1', tenantName: 'Palace Nails', tenantStatus: 'active', plan: 'Pro', subscriptionStatus: 'active', currentPeriodEnd: null, processor: 'cardpointe', merchantIdLast4: '4242', paymentConfigured: true, paymentStatus: 'active', hardwareTotalCents: 120000, hardwareRemainingCents: 40000, hardwareStatus: 'active' },
  { tenantId: 't2', tenantName: 'Glow Bar', tenantStatus: 'active', plan: 'Starter', subscriptionStatus: 'active', currentPeriodEnd: null, processor: 'fiserv', merchantIdLast4: null, paymentConfigured: false, paymentStatus: 'pending', hardwareTotalCents: 0, hardwareRemainingCents: 0, hardwareStatus: 'none' },
  { tenantId: 't3', tenantName: 'Lotus Spa', tenantStatus: 'active', plan: 'Pro', subscriptionStatus: 'trialing', currentPeriodEnd: null, processor: 'none', merchantIdLast4: null, paymentConfigured: false, paymentStatus: 'none', hardwareTotalCents: 50000, hardwareRemainingCents: 0, hardwareStatus: 'paid_off' },
  { tenantId: 't4', tenantName: 'Old Town', tenantStatus: 'suspended', plan: 'Starter', subscriptionStatus: 'cancelled', currentPeriodEnd: null, processor: 'none', merchantIdLast4: null, paymentConfigured: false, paymentStatus: 'disabled', hardwareTotalCents: 0, hardwareRemainingCents: 0, hardwareStatus: 'none' },
];
const prices = { Pro: 9900, Starter: 4900 };

const { rows, overview } = buildBilling(facts, prices);

// MRR only counts ACTIVE subscriptions: t1 Pro 9900 + t2 Starter 4900 = 14800 (t3 trialing → 0, t4 cancelled → 0)
check('mrr sums active only', overview.mrrCents === 14800);
check('row mrr active', rows.find((r) => r.tenantId === 't1')!.mrrCents === 9900);
check('row mrr trialing is 0', rows.find((r) => r.tenantId === 't3')!.mrrCents === 0);
check('row mrr cancelled is 0', rows.find((r) => r.tenantId === 't4')!.mrrCents === 0);
check('total tenants', overview.totalTenants === 4);
check('sub status active count', overview.bySubscriptionStatus.active === 2);
check('sub status trialing count', overview.bySubscriptionStatus.trialing === 1);
check('sub status cancelled count', overview.bySubscriptionStatus.cancelled === 1);
check('pay status active count', overview.byPaymentStatus.active === 1);
check('pay status pending count', overview.byPaymentStatus.pending === 1);
check('pay status none count', overview.byPaymentStatus.none === 1);
// hardware outstanding = only status 'active' remaining: t1 40000 (t3 paid_off → excluded)
check('hardware outstanding', overview.hardwareOutstandingCents === 40000);
// plan distribution excludes cancelled/expired: Pro x2 (t1,t3), Starter x1 (t2) — t4 cancelled excluded
check('plan dist Pro count', overview.planDistribution.find((p) => p.plan === 'Pro')!.count === 2);
check('plan dist Starter count', overview.planDistribution.find((p) => p.plan === 'Starter')!.count === 1);
check('plan dist sorted desc', overview.planDistribution[0].plan === 'Pro');
// no raw MID leakage — only last4 surfaces
check('mid last4 surfaced', rows.find((r) => r.tenantId === 't1')!.merchantIdLast4 === '4242');

// empty input → safe zeros
const empty = buildBilling([], {});
check('empty mrr 0', empty.overview.mrrCents === 0);
check('empty tenants 0', empty.overview.totalTenants === 0);
check('empty plan dist []', empty.overview.planDistribution.length === 0);

// planCatalog reflects configured plan-price keys, sorted
check('planCatalog sorted keys', JSON.stringify(overview.planCatalog) === JSON.stringify(['Pro', 'Starter']));
check('empty planCatalog []', empty.overview.planCatalog.length === 0);

// normalizeSubscriptionUpdate — validation
check('normalize plan only', JSON.stringify(normalizeSubscriptionUpdate({ plan: ' Pro ' })) === JSON.stringify({ plan: 'Pro' }));
check('normalize status only', JSON.stringify(normalizeSubscriptionUpdate({ status: 'past_due' })) === JSON.stringify({ status: 'past_due' }));
check('normalize both', JSON.stringify(normalizeSubscriptionUpdate({ plan: 'Pro', status: 'active' })) === JSON.stringify({ plan: 'Pro', status: 'active' }));
let threw = false; try { normalizeSubscriptionUpdate({}); } catch { threw = true; } check('normalize empty throws', threw);
threw = false; try { normalizeSubscriptionUpdate({ status: 'bogus' }); } catch { threw = true; } check('normalize bad status throws', threw);
threw = false; try { normalizeSubscriptionUpdate({ plan: '' }); } catch { threw = true; } check('normalize empty plan throws', threw);
threw = false; try { normalizeSubscriptionUpdate({ status: 'none' }); } catch { threw = true; } check('normalize none status throws (not settable)', threw);

if (failures > 0) { console.error(`\n${failures} billing-core checks FAILED`); process.exit(1); }
console.log('\nbilling-core: all checks passed');
