// webhook-dispatch-core.spec.ts — DB-free harness spec.
import { planDeliveries, nextAttemptState, isDue, MAX_DELIVERY_ATTEMPTS } from './webhook-dispatch-core';

let passed = 0, failed = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) === JSON.stringify(b)) passed++; else { failed++; console.error(`FAIL: ${m}\n  expected ${JSON.stringify(b)}\n  got ${JSON.stringify(a)}`); } };
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error(`FAIL: ${m}`); } };

const hooks = [
  { id: 'w1', status: 'active', events: ['deployment.completed'] },
  { id: 'w2', status: 'active', events: ['*'] },
  { id: 'w3', status: 'paused', events: ['deployment.completed'] },
  { id: 'w4', status: 'active', events: ['appointment.created'] },
];
eq(planDeliveries('deployment.completed', hooks), ['w1', 'w2'], 'plans active subscribers + wildcard, skips paused & non-matching');
eq(planDeliveries('nothing.matches', hooks), ['w2'], 'wildcard still matches');
eq(planDeliveries('deployment.completed', []), [], 'no webhooks → no deliveries');

// delivered on success
eq(nextAttemptState({ attemptCount: 0, maxAttempts: 5 }, { ok: true, status: 200 }, 1000), { status: 'delivered', attemptCount: 1, nextAttemptAtMs: null, lastStatusCode: 200 }, 'success → delivered');

// retryable 5xx → pending scheduled with backoff
const r = nextAttemptState({ attemptCount: 0, maxAttempts: 5 }, { ok: false, status: 500 }, 1000);
eq(r.status, 'pending', '5xx → pending (retry)');
eq(r.attemptCount, 1, 'attempt incremented');
ok(r.nextAttemptAtMs !== null && r.nextAttemptAtMs > 1000, 'next attempt scheduled in the future');

// non-retryable 4xx → failed (terminal, attempts left)
eq(nextAttemptState({ attemptCount: 0, maxAttempts: 5 }, { ok: false, status: 400 }, 1000).status, 'failed', '400 → failed terminal');

// exhausted attempts → dead
eq(nextAttemptState({ attemptCount: MAX_DELIVERY_ATTEMPTS - 1, maxAttempts: MAX_DELIVERY_ATTEMPTS }, { ok: false, status: 500 }, 1000).status, 'dead', 'last attempt fails → dead');

// isDue
ok(isDue({ status: 'pending', nextAttemptAtMs: null }, 5000), 'pending with no schedule is due');
ok(isDue({ status: 'pending', nextAttemptAtMs: 4000 }, 5000), 'pending past its schedule is due');
ok(!isDue({ status: 'pending', nextAttemptAtMs: 9000 }, 5000), 'pending before its schedule is not due');
ok(!isDue({ status: 'delivered', nextAttemptAtMs: null }, 5000), 'delivered is never due');
ok(!isDue({ status: 'dead', nextAttemptAtMs: null }, 5000), 'dead is never due');

console.log(`\n[webhook-dispatch-core] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
