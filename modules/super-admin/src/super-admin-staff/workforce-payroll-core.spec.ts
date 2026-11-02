import { retryEligibility, backoffSeconds, validatePayrollRetry, summarizePayrollSync, PERMANENT_ERROR_CODES, PAYROLL_RETRY_AUDIT_TYPE, MIN_PAYROLL_REASON_LEN } from './workforce-payroll-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);

// eligibility
ok(retryEligibility({ status: 'failed', errorCode: 'PROVIDER_OUTAGE', attemptCount: 1, maxAttempts: 5 }).ok, 'transient failure retryable');
ok(retryEligibility({ status: 'retrying', errorCode: null, attemptCount: 2, maxAttempts: 5 }).ok, 'retrying retryable');
ok(!retryEligibility({ status: 'synced', errorCode: null, attemptCount: 0, maxAttempts: 5 }).ok, 'synced not retryable');
ok(!retryEligibility({ status: 'processing', errorCode: null, attemptCount: 0, maxAttempts: 5 }).ok, 'in-flight not retryable');
ok(!retryEligibility({ status: 'failed', errorCode: 'MAPPING_MISSING', attemptCount: 0, maxAttempts: 5 }).ok, 'permanent mapping error not retryable');
ok(!retryEligibility({ status: 'failed', errorCode: 'AUTH_FAILED', attemptCount: 0, maxAttempts: 5 }).ok, 'auth failure not retryable');
ok(!retryEligibility({ status: 'failed', errorCode: 'PROVIDER_OUTAGE', attemptCount: 5, maxAttempts: 5 }).ok, 'exhausted attempts not retryable');
PERMANENT_ERROR_CODES.forEach((c) => ok(!retryEligibility({ status: 'failed', errorCode: c.toLowerCase(), attemptCount: 0, maxAttempts: 5 }).ok, `${c} permanent (case-insensitive)`));

// backoff grows and caps
ok(backoffSeconds(1) === 60, 'attempt 1 → 60s');
ok(backoffSeconds(2) === 120, 'attempt 2 → 120s');
ok(backoffSeconds(3) === 240, 'attempt 3 → 240s');
ok(backoffSeconds(100) === 3600, 'caps at 3600s');

// retry reason validation
ok(!validatePayrollRetry({}).ok, 'missing reason rejected');
ok(!validatePayrollRetry({ reason: 'short' }).ok, `reason under ${MIN_PAYROLL_REASON_LEN} rejected`);
{ const v = validatePayrollRetry({ reason: '  provider outage cleared  ' }); ok(v.ok, 'valid reason accepted'); if (v.ok) eq(v.reason, 'provider outage cleared', 'reason trimmed'); }

// summary reconciles; successRate over terminal only
{ const s = summarizePayrollSync([{ status: 'synced', count: 90 }, { status: 'failed', count: 10 }, { status: 'processing', count: 5 }]);
  eq(s.total, 105, 'total counts all'); eq(s.successful, 90, 'successful'); eq(s.failed, 10, 'failed'); eq(s.successRate, 90, 'rate over terminal (90/100)'); }
{ const s = summarizePayrollSync([]); eq(s.total, 0, 'empty total 0'); eq(s.successRate, null, 'no terminal → null rate'); }
{ const s = summarizePayrollSync([{ status: 'pending', count: 3 }]); eq(s.successRate, null, 'only in-flight → null rate'); }

ok(PAYROLL_RETRY_AUDIT_TYPE === 'workforce_payroll_sync_retried', 'audit type stable');

console.log(`workforce-payroll-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
