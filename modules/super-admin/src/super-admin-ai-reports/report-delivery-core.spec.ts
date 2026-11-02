import { canDeliveryTransition, isRetryable, validateRecipientEligibility, aggregateDeliveryStatus, deliverySuccessRate, buildDeliveryKey } from './report-delivery-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
// transitions + retryable
ok(canDeliveryTransition('pending', 'delivered'), 'pending→delivered');
ok(canDeliveryTransition('failed', 'queued'), 'failed retryable→queued');
ok(!canDeliveryTransition('delivered', 'failed'), 'delivered terminal');
ok(isRetryable('failed') && isRetryable('bounced'), 'failed/bounced retryable');
ok(!isRetryable('delivered'), 'delivered not retryable');
// eligibility — cross-tenant isolation
{ const run = { scopeType: 'tenant', tenantId: 'tA' };
  ok(validateRecipientEligibility({ id: 'r1', tenantId: 'tA', active: true }, run).ok, 'same-tenant recipient eligible');
  ok(!validateRecipientEligibility({ id: 'r2', tenantId: 'tB', active: true }, run).ok, 'other-tenant recipient BLOCKED');
  ok(validateRecipientEligibility({ id: 'r3', isPlatform: true, active: true }, run).ok, 'platform recipient eligible for tenant run'); }
{ const run = { scopeType: 'platform', tenantId: null };
  ok(!validateRecipientEligibility({ id: 'r4', tenantId: 'tA', active: true }, run).ok, 'single-tenant recipient BLOCKED from platform run');
  ok(validateRecipientEligibility({ id: 'r5', isPlatform: true, active: true }, run).ok, 'platform recipient eligible for platform run'); }
ok(!validateRecipientEligibility({ id: 'r6', tenantId: 'tA', active: false }, { scopeType: 'tenant', tenantId: 'tA' }).ok, 'inactive blocked');
ok(!validateRecipientEligibility({ id: 'r7', tenantId: 'tA', suppressed: true }, { scopeType: 'tenant', tenantId: 'tA' }).ok, 'suppressed blocked');
ok(!validateRecipientEligibility({ id: 'r8', isPlatform: true, external: true }, { scopeType: 'platform', tenantId: null }).ok, 'external blocked without flag');
ok(validateRecipientEligibility({ id: 'r9', isPlatform: true, external: true }, { scopeType: 'platform', tenantId: null }, { allowExternal: true }).ok, 'external ok with flag');
// aggregate
eq(aggregateDeliveryStatus({ delivered: 5, failed: 0, bounced: 0, pending: 0, total: 5 }), 'delivered', 'all delivered');
eq(aggregateDeliveryStatus({ delivered: 3, failed: 1, bounced: 0, pending: 1, total: 5 }), 'partially_delivered', 'partial');
eq(aggregateDeliveryStatus({ delivered: 0, failed: 5, bounced: 0, pending: 0, total: 5 }), 'failed', 'all failed');
eq(aggregateDeliveryStatus({ delivered: 0, failed: 0, bounced: 0, pending: 0, total: 0 }), 'not_requested', 'none requested');
// success rate
eq(deliverySuccessRate(628, 636), 98.7, 'success rate'); eq(deliverySuccessRate(0, 0), 0, 'no div by zero');
// key
eq(buildDeliveryKey('run1', 'rec1'), 'run1|rec1', 'delivery key');
console.log(`report-delivery-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
