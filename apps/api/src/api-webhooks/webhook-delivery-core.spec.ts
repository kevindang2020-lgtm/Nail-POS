// webhook-delivery-core.spec.ts — DB-free harness spec.
import { sign, signatureHeader, buildEnvelope, backoffMs, shouldRetry, MAX_DELIVERY_ATTEMPTS } from './webhook-delivery-core';

let passed = 0, failed = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) === JSON.stringify(b)) passed++; else { failed++; console.error(`FAIL: ${m}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`); } };
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error(`FAIL: ${m}`); } };

// signing is deterministic and secret-dependent
const s1 = sign('whsec_abc', 1700000000, '{"a":1}');
const s2 = sign('whsec_abc', 1700000000, '{"a":1}');
const s3 = sign('whsec_DIFFERENT', 1700000000, '{"a":1}');
eq(s1, s2, 'same inputs → same signature');
ok(s1 !== s3, 'different secret → different signature');
ok(/^[0-9a-f]{64}$/.test(s1), 'signature is 64-hex (sha256)');
ok(sign('k', 1, 'a') !== sign('k', 2, 'a'), 'timestamp is part of the signature');
ok(sign('k', 1, 'a') !== sign('k', 1, 'b'), 'body is part of the signature');

// header format
eq(signatureHeader(1700000000, 'abcd'), 't=1700000000,v1=abcd', 'signature header format');

// envelope is valid JSON with the right shape
const env = buildEnvelope('webhook.test', 'evt_1', 1700000000, { message: 'hi' });
const parsed = JSON.parse(env);
eq(parsed.type, 'webhook.test', 'envelope type');
eq(parsed.id, 'evt_1', 'envelope id');
eq(parsed.created, 1700000000, 'envelope created');
eq(parsed.data.message, 'hi', 'envelope data');

// backoff: 1s,2s,4s,8s… capped at 60s
eq(backoffMs(1), 1000, 'backoff attempt 1 = 1s');
eq(backoffMs(2), 2000, 'backoff attempt 2 = 2s');
eq(backoffMs(3), 4000, 'backoff attempt 3 = 4s');
ok(backoffMs(20) === 60000, 'backoff capped at 60s');

// retry policy
ok(shouldRetry(null, 1), 'network error retries');
ok(shouldRetry(500, 1), '5xx retries');
ok(shouldRetry(429, 1), '429 retries');
ok(!shouldRetry(400, 1), '400 does not retry');
ok(!shouldRetry(404, 1), '404 does not retry');
ok(!shouldRetry(200, 1), '2xx does not retry');
ok(!shouldRetry(500, MAX_DELIVERY_ATTEMPTS), 'no retry past the attempt cap');

console.log(`\n[webhook-delivery-core] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
