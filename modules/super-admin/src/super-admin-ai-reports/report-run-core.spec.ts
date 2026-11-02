import { buildRunIdempotencyKey, canGenTransition, validateMetricsSnapshot, generateReportReference } from './report-run-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
// idempotency key is stable + scope-sensitive
const k1 = buildRunIdempotencyKey({ reportKey: 'daily_platform', scopeType: 'platform', start: '2026-05-01', end: '2026-05-06', source: 'on_demand' });
const k2 = buildRunIdempotencyKey({ reportKey: 'Daily_Platform', scopeType: 'PLATFORM', start: '2026-05-01', end: '2026-05-06', source: 'on_demand' });
eq(k1, k2, 'key is case-insensitive stable');
ok(k1 !== buildRunIdempotencyKey({ reportKey: 'daily_platform', scopeType: 'tenant', tenantId: 't1', start: '2026-05-01', end: '2026-05-06', source: 'on_demand' }), 'scope changes key');
ok(k1 !== buildRunIdempotencyKey({ reportKey: 'daily_platform', scopeType: 'platform', start: '2026-05-02', end: '2026-05-06', source: 'on_demand' }), 'period changes key');
// transitions
ok(canGenTransition('requested', 'collecting'), 'requested→collecting');
ok(canGenTransition('collecting', 'completed'), 'collecting→completed');
ok(canGenTransition('collecting', 'partial'), 'collecting→partial');
ok(!canGenTransition('completed', 'collecting'), 'completed terminal');
ok(!canGenTransition('requested', 'completed'), 'no skip to completed');
// snapshot validation / grounding
{ const r = validateMetricsSnapshot({ start: '2026-05-01', end: '2026-05-06', hasData: true, metrics: { revenueCents: 128000, bookings: 42 } });
  ok(r.ok && r.status === 'completed' && (r.metrics as any).dataAvailable === true, 'valid data → completed'); }
{ const r = validateMetricsSnapshot({ start: '2026-05-01', end: '2026-05-06', hasData: false, metrics: {} });
  ok(r.ok && r.status === 'partial' && (r.metrics as any).dataAvailable === false && /unavailable/i.test(String((r.metrics as any).note)), 'no data → partial + honest note'); }
ok(!validateMetricsSnapshot({ start: 'bad', end: '2026-05-06', hasData: true, metrics: {} }).ok, 'invalid date rejected');
ok(!validateMetricsSnapshot({ start: '2026-05-10', end: '2026-05-01', hasData: true, metrics: {} }).ok, 'end<start rejected');
ok(!validateMetricsSnapshot({ start: '2026-05-01', end: '2026-05-06', hasData: true, metrics: { x: NaN } }).ok, 'NaN metric rejected');
ok(!validateMetricsSnapshot({ start: '2026-05-01', end: '2026-05-06', hasData: true, metrics: { x: Infinity } }).ok, 'Infinity metric rejected');
// reference
ok(/^RPT-DAILY_PLATFORM-\d{8}-\d+$/.test(generateReportReference('daily_platform', Date.parse('2026-05-06T00:00:00Z'))), 'reference format');
console.log(`report-run-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
