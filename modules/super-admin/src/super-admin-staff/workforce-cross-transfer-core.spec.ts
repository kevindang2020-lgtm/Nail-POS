import { validateCrossTransferRequest, validateCrossTransferDecision, CROSS_TRANSFER_REQUEST_AUDIT_TYPE, CROSS_TRANSFER_DECIDE_AUDIT_TYPE, MIN_CROSS_REASON_LEN } from './workforce-cross-transfer-core';

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);

// request: destination tenant required + must differ
ok(!validateCrossTransferRequest({ reason: 'a sufficiently long reason' }, 't1').ok, 'missing toTenantId rejected');
ok(!validateCrossTransferRequest({ toTenantId: 't1', reason: 'a sufficiently long reason' }, 't1').ok, 'same tenant rejected');
// reason bar is higher (12)
ok(!validateCrossTransferRequest({ toTenantId: 't2', reason: 'too short' }, 't1').ok, `reason under ${MIN_CROSS_REASON_LEN} rejected`);
// bad effective date
ok(!validateCrossTransferRequest({ toTenantId: 't2', reason: 'a sufficiently long reason', effectiveDate: '13/40/2026' }, 't1').ok, 'invalid effectiveDate rejected');
ok(!validateCrossTransferRequest({ toTenantId: 't2', reason: 'a sufficiently long reason', effectiveDate: '2026-13-40' }, 't1').ok, 'out-of-range date rejected');
// happy path with optional branch + date, trims reason
{ const v = validateCrossTransferRequest({ toTenantId: '  t2  ', toBranchId: '  b9 ', effectiveDate: '2026-07-01', reason: '  approved relocation to sister brand  ' }, 't1');
  ok(v.ok, 'valid cross-transfer accepted'); if (v.ok) { eq(v.toTenantId, 't2', 'toTenantId trimmed'); eq(v.toBranchId, 'b9', 'toBranchId trimmed'); eq(v.effectiveDate, '2026-07-01', 'date kept'); eq(v.reason, 'approved relocation to sister brand', 'reason trimmed'); } }
// happy path without branch/date → nulls
{ const v = validateCrossTransferRequest({ toTenantId: 't2', reason: 'valid business justification' }, 't1'); ok(v.ok, 'valid without branch/date'); if (v.ok) { eq(v.toBranchId, null, 'branch null'); eq(v.effectiveDate, null, 'date null'); } }
// current tenant null (no guard trip) still needs reason + tenant
{ const v = validateCrossTransferRequest({ toTenantId: 't2', reason: 'valid business justification' }, null); ok(v.ok, 'null current tenant ok'); }

// decision
ok(!validateCrossTransferDecision({ decision: 'maybe' }).ok, 'bad decision rejected');
ok(!validateCrossTransferDecision({ decision: 'reject', note: 'short' }).ok, 'reject needs long note');
{ const v = validateCrossTransferDecision({ decision: 'approve' }); ok(v.ok, 'approve without note ok'); if (v.ok) eq(v.note, null, 'approve note null'); }
{ const v = validateCrossTransferDecision({ decision: 'reject', note: 'destination tenant declined the request' }); ok(v.ok, 'reject with long note ok'); }

ok(CROSS_TRANSFER_REQUEST_AUDIT_TYPE === 'workforce_cross_tenant_transfer_requested', 'request audit type');
ok(CROSS_TRANSFER_DECIDE_AUDIT_TYPE === 'workforce_cross_tenant_transfer_decided', 'decide audit type');

console.log(`workforce-cross-transfer-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
