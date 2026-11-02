// api-webhooks-core.spec.ts — DB-free harness spec (auto-discovered by scripts/run-core-specs.sh).
import {
  keyStatus, maskedKey, isValidScope, isValidEvent, composeKey, isSafeWebhookUrl, normalizeScopes, normalizeEvents,
} from './api-webhooks-core';

let passed = 0, failed = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) === JSON.stringify(b)) passed++; else { failed++; console.error(`FAIL: ${m}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`); } };
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error(`FAIL: ${m}`); } };

const NOW = 1_000_000_000_000;

// keyStatus
eq(keyStatus({ revokedMs: null, expiresMs: null }, NOW), 'active', 'no revoke/expiry → active');
eq(keyStatus({ revokedMs: NOW - 1, expiresMs: null }, NOW), 'revoked', 'revoked');
eq(keyStatus({ revokedMs: null, expiresMs: NOW - 1 }, NOW), 'expired', 'past expiry → expired');
eq(keyStatus({ revokedMs: null, expiresMs: NOW + 10_000 }, NOW), 'active', 'future expiry → active');
eq(keyStatus({ revokedMs: NOW - 1, expiresMs: NOW - 1 }, NOW), 'revoked', 'revoke beats expiry');

// maskedKey
eq(maskedKey('ak_live_Ab12'), 'ak_live_Ab12••••••••', 'masked key keeps prefix only');

// scope/event validation
ok(isValidScope('services.read') && isValidScope('pos:write') && isValidScope('a-b_c'), 'valid scopes accepted');
ok(!isValidScope('Bad Scope') && !isValidScope('1bad') && !isValidScope(''), 'invalid scopes rejected');
ok(isValidEvent('appointment.created') && !isValidEvent('Has Space') && !isValidEvent('1nope'), 'event validation');
eq(normalizeScopes(['Services.Read', 'services.read', 'bad scope', '']), ['services.read'], 'scopes normalized + deduped + filtered');
eq(normalizeEvents(['Appointment.Created', 'appointment.created']), ['appointment.created'], 'events normalized + deduped');

// composeKey
const ck = composeKey('live', 'Ab12cd34ef');
eq(ck, { raw: 'ak_live_Ab12cd34ef', prefix: 'ak_live_Ab12' }, 'compose live key');
eq(composeKey('test', 'Zz99yy88').prefix, 'ak_test_Zz99', 'compose test prefix');
eq(composeKey('weird', 'Q1234567').raw.slice(0, 8), 'ak_live_', 'unknown env defaults to live');

// isSafeWebhookUrl — public https allowed
ok(isSafeWebhookUrl('https://hooks.example.com/abc').ok, 'public https allowed');
ok(!isSafeWebhookUrl('http://hooks.example.com/abc').ok, 'http rejected');
ok(!isSafeWebhookUrl('https://localhost/x').ok, 'localhost rejected');
ok(!isSafeWebhookUrl('https://127.0.0.1/x').ok, 'loopback IPv4 rejected');
ok(!isSafeWebhookUrl('https://10.0.0.5/x').ok, '10/8 private rejected');
ok(!isSafeWebhookUrl('https://192.168.1.10/x').ok, '192.168 private rejected');
ok(!isSafeWebhookUrl('https://172.16.0.1/x').ok, '172.16/12 private rejected');
ok(isSafeWebhookUrl('https://172.32.0.1/x').ok, '172.32 is public (outside 16-31)');
ok(!isSafeWebhookUrl('https://169.254.169.254/latest/meta-data').ok, 'cloud metadata IP rejected');
ok(!isSafeWebhookUrl('https://[fd00::1]/x').ok, 'IPv6 unique-local rejected');
ok(!isSafeWebhookUrl('not a url').ok, 'malformed URL rejected');
eq(isSafeWebhookUrl('http://x.com').reason, 'URL must use https', 'reason surfaced for http');

console.log(`\n[api-webhooks-core] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
