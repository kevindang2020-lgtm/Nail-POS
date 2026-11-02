import { canTransition, validateTransition, applyApproval, canDisable, requireReason } from './promotion-lifecycle-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
// transitions
ok(canTransition('draft', 'pending_approval'), 'draft→pending');
ok(canTransition('pending_approval', 'approved'), 'pending→approved');
ok(canTransition('approved', 'active'), 'approved→active');
ok(canTransition('active', 'paused'), 'active→paused');
ok(canTransition('active', 'disabled'), 'active→disabled');
ok(!canTransition('active', 'draft'), 'active→draft blocked');
ok(!canTransition('disabled', 'active'), 'disabled is terminal');
ok(!canTransition('completed', 'active'), 'completed→active blocked');
ok(canTransition('completed', 'archived'), 'completed→archived');
ok(!validateTransition('active', 'nonsense').ok, 'unknown target rejected');
{ const r = validateTransition('draft', 'approved'); ok(r.ok && r.status === 'approved', 'valid transition returns status'); }
// approval
{ const r = applyApproval('pending_approval', 'approve'); ok(r.ok && r.approvalStatus === 'approved' && r.status === 'approved', 'approve pending'); }
{ const r = applyApproval('pending_approval', 'reject'); ok(r.ok && r.approvalStatus === 'rejected' && r.status === 'rejected', 'reject pending'); }
{ const r = applyApproval('draft', 'approve'); ok(r.ok, 'approve draft ok'); }
ok(!applyApproval('active', 'approve').ok, 'cannot approve an active promotion');
ok(!applyApproval('completed', 'reject').ok, 'cannot reject a completed promotion');
// disable
ok(canDisable('active').ok, 'active disable ok');
ok(canDisable('scheduled').ok, 'scheduled disable ok');
ok(!canDisable('draft').ok, 'draft disable blocked');
ok(!canDisable('completed').ok, 'completed disable blocked');
ok(!canDisable('disabled').ok, 'already disabled blocked');
// reason
ok(!requireReason('').ok, 'empty reason rejected');
ok(!requireReason('no').ok, 'short reason rejected');
ok(requireReason('policy violation').ok, 'valid reason ok');
console.log(`promotion-lifecycle-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
