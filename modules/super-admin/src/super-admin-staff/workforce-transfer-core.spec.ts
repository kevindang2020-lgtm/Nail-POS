import { validateTransferRequest, validateTransferDecision, summarizeTransferPipeline, TRANSFER_STATUSES, TRANSFER_REQUEST_AUDIT_TYPE, TRANSFER_DECIDE_AUDIT_TYPE, MIN_TRANSFER_REASON_LEN } from './workforce-transfer-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);

// request validation
{ const v = validateTransferRequest({ reason: 'a valid reason here' }, 'b1'); ok(!v.ok, 'missing toBranchId rejected'); }
{ const v = validateTransferRequest({ toBranchId: 'b1', reason: 'a valid reason here' }, 'b1'); ok(!v.ok, 'same-branch rejected'); }
{ const v = validateTransferRequest({ toBranchId: 'b2', reason: 'short' }, 'b1'); ok(!v.ok, `reason under ${MIN_TRANSFER_REASON_LEN} rejected`); }
{ const v = validateTransferRequest({ toBranchId: '  b2  ', reason: '  cover maternity leave at downtown  ' }, 'b1'); ok(v.ok, 'valid accepted'); if (v.ok) { eq(v.toBranchId, 'b2', 'toBranchId trimmed'); eq(v.reason, 'cover maternity leave at downtown', 'reason trimmed'); } }
{ const v = validateTransferRequest({ toBranchId: 'b2', reason: 'worker had no prior branch' }, null); ok(v.ok, 'null current branch is allowed (unassigned → assigned)'); }

// decision validation
{ const v = validateTransferDecision({ decision: 'nope' }); ok(!v.ok, 'bad decision rejected'); }
{ const v = validateTransferDecision({ decision: 'reject', note: 'no' }); ok(!v.ok, 'reject without adequate note rejected'); }
{ const v = validateTransferDecision({ decision: 'reject', note: 'headcount already balanced' }); ok(v.ok, 'reject with note accepted'); if (v.ok) eq(v.note, 'headcount already balanced', 'note kept'); }
{ const v = validateTransferDecision({ decision: 'approve' }); ok(v.ok, 'approve without note accepted'); if (v.ok) eq(v.note, null, 'approve note null'); }

// pipeline summary
{ const s = summarizeTransferPipeline([{ status: 'requested', count: 3 }, { status: 'approved', count: 5 }, { status: 'weird', count: 9 }]);
  eq(s.total, 8, 'unknown statuses excluded from total'); eq(s.byStatus.requested, 3, 'requested counted'); eq(s.byStatus.approved, 5, 'approved counted'); eq(s.byStatus.rejected, 0, 'missing status filled 0'); }

ok(TRANSFER_STATUSES.length === 4, 'four statuses');
ok(TRANSFER_REQUEST_AUDIT_TYPE === 'workforce_transfer_requested' && TRANSFER_DECIDE_AUDIT_TYPE === 'workforce_transfer_decided', 'audit types stable');

console.log(`workforce-transfer-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
