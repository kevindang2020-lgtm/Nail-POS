import { normalizeDataClass, normalizeAction, validateRetentionRule, computeCutoff, nextRetentionVersion, assemblePurgePreview, MIN_RETENTION_DAYS } from './retention-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
// vocab
ok(normalizeDataClass('Audit Events') === 'audit_events', 'data class normalized');
ok(normalizeDataClass('bogus') === '', 'unknown class empty');
ok(normalizeAction('Anonymize') === 'anonymize' && normalizeAction('weird') === 'delete', 'action normalized');
// validation + floors
ok(validateRetentionRule({ dataClass: 'audit_events', retentionDays: 400, action: 'archive' }).ok, 'audit 400d ok');
ok(!validateRetentionRule({ dataClass: 'audit_events', retentionDays: 30, action: 'delete' }).ok, 'audit below floor rejected');
ok(!validateRetentionRule({ dataClass: 'login_attempts', retentionDays: 10, action: 'delete' }).ok, 'login below 90 rejected');
ok(validateRetentionRule({ dataClass: 'login_attempts', retentionDays: 90, action: 'delete' }).ok, 'login 90 ok');
ok(!validateRetentionRule({ dataClass: 'notifications', retentionDays: -5, action: 'delete' }).ok, 'negative rejected');
ok(!validateRetentionRule({ dataClass: 'bogus', retentionDays: 100, action: 'delete' }).ok, 'unknown class rejected');
ok(!validateRetentionRule({ dataClass: 'audit_events', retentionDays: 400, action: 'zap' }).ok, 'bad action rejected');
ok(MIN_RETENTION_DAYS.audit_events === 365, 'audit floor 365');
// cutoff
{ const now = Date.parse('2026-05-06T00:00:00Z'); const c = computeCutoff(now, 30); ok(c.slice(0, 10) === '2026-04-06', 'cutoff 30d back'); }
// versioning
ok(nextRetentionVersion([]) === 1 && nextRetentionVersion([1, 3]) === 4, 'versioning');
// preview (dry-run, legal hold excluded)
{ const p = assemblePurgePreview({ dataClass: 'notifications', cutoff: '2026-04-06T00:00:00Z', eligibleCount: 100, legalHoldExcluded: 5, action: 'delete' });
  ok(p.netToProcess === 95 && /Dry run — nothing deleted/.test(p.message) && /5 under legal hold excluded/.test(p.message), 'preview summary'); }
{ const p = assemblePurgePreview({ dataClass: 'notifications', cutoff: '2026-04-06T00:00:00Z', eligibleCount: 3, legalHoldExcluded: 0, action: 'archive' });
  ok(p.netToProcess === 3 && !/legal hold/.test(p.message), 'preview no legal hold'); }
console.log(`retention-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
