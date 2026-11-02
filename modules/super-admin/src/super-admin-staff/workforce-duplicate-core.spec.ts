import { validateDuplicateReview, DUPLICATE_REVIEW_AUDIT_TYPE, MIN_DUP_REASON_LEN } from './workforce-duplicate-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);

// too few members
ok(!validateDuplicateReview({ canonicalId: 'a', memberIds: ['a'], reason: 'a valid reason here' }).ok, 'single-member group rejected');
ok(!validateDuplicateReview({ canonicalId: 'a', memberIds: [], reason: 'a valid reason here' }).ok, 'empty group rejected');
// missing/invalid canonical
ok(!validateDuplicateReview({ memberIds: ['a', 'b'], reason: 'a valid reason here' }).ok, 'missing canonical rejected');
ok(!validateDuplicateReview({ canonicalId: 'c', memberIds: ['a', 'b'], reason: 'a valid reason here' }).ok, 'canonical not in members rejected');
// reason
ok(!validateDuplicateReview({ canonicalId: 'a', memberIds: ['a', 'b'], reason: 'short' }).ok, `reason under ${MIN_DUP_REASON_LEN} rejected`);
// happy path: dedups members, computes flagged = members - canonical
{ const v = validateDuplicateReview({ canonicalId: 'a', memberIds: ['a', 'b', 'b', 'c', ' '], reason: '  keep the oldest record  ' });
  ok(v.ok, 'valid review accepted'); if (v.ok) { eq(v.canonicalId, 'a', 'canonical passthrough'); eq(v.flaggedIds, ['b', 'c'], 'flagged = members minus canonical, deduped'); eq(v.reason, 'keep the oldest record', 'reason trimmed'); } }

ok(DUPLICATE_REVIEW_AUDIT_TYPE === 'workforce_duplicate_reviewed', 'audit type stable');

console.log(`workforce-duplicate-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
