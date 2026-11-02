// logs-core.spec.ts — DB-free harness spec.
import { isSeverity, isCategory, severityRank, normalizeFilters, matchesFilters, type LogRowLike } from './logs-core';

let passed = 0, failed = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) === JSON.stringify(b)) passed++; else { failed++; console.error(`FAIL: ${m}\n  expected ${JSON.stringify(b)}\n  got ${JSON.stringify(a)}`); } };
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error(`FAIL: ${m}`); } };

ok(isSeverity('warning') && isSeverity('critical'), 'valid severities');
ok(!isSeverity('debug') && !isSeverity(''), 'invalid severities');
ok(isCategory('device') && isCategory('integration') && !isCategory('other'), 'category validation');
ok(severityRank('info') < severityRank('error'), 'severity ranking');

eq(normalizeFilters({}).limit, 100, 'default limit');
eq(normalizeFilters({ limit: 9999 }).limit, 500, 'limit capped at 500');
eq(normalizeFilters({ limit: 0 }).limit, 1, 'limit floored at 1');
eq(normalizeFilters({ category: 'bogus' }).category, undefined, 'invalid category dropped');
eq(normalizeFilters({ category: 'device', severity: 'error', source: 'Webhook', search: 'Foo' }), { category: 'device', severity: 'error', source: 'webhook', search: 'foo', limit: 100 }, 'normalized filters');

const r: LogRowLike = { category: 'integration', severity: 'error', source: 'webhook', message: 'Delivery failed for CRM', createdMs: 1 };
ok(matchesFilters(r, normalizeFilters({ category: 'integration' })), 'category match');
ok(!matchesFilters(r, normalizeFilters({ category: 'device' })), 'category mismatch excluded');
ok(matchesFilters(r, normalizeFilters({ severity: 'error' })), 'severity match');
ok(!matchesFilters(r, normalizeFilters({ severity: 'info' })), 'severity mismatch excluded');
ok(matchesFilters(r, normalizeFilters({ source: 'webhook' })), 'source match');
ok(matchesFilters(r, normalizeFilters({ search: 'crm' })), 'search matches message (case-insensitive)');
ok(!matchesFilters(r, normalizeFilters({ search: 'payment' })), 'search non-match excluded');

console.log(`\n[logs-core] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
