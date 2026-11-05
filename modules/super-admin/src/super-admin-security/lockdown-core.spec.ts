import { validateProposal, expectedConfirmationPhrase, verifyConfirmation, canLockdownTransition, mapToRevokeScope, violatesSelfPreservation, buildLockdownRef } from './lockdown-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
// proposal validation
ok(validateProposal('platform', null, 'active breach').ok, 'platform needs no target');
ok(!validateProposal('account', '', 'x').ok, 'account needs target');
ok(!validateProposal('tenant', '', 'x').ok, 'tenant needs target');
ok(!validateProposal('account', 'u1', '').ok, 'reason required');
ok(!validateProposal('galaxy', 'x', 'r').ok, 'bad scope');
ok(validateProposal('tenant', 't1', 'breach').ok, 'valid tenant proposal');
// phrase + confirmation (two-factor)
ok(expectedConfirmationPhrase('platform') === 'LOCKDOWN PLATFORM', 'phrase');
ok(!verifyConfirmation('platform', 'LOCKDOWN PLATFORM', false).ok, 'step-up required');
ok(!verifyConfirmation('platform', 'lockdown platform', true).ok, 'phrase case-sensitive');
ok(!verifyConfirmation('platform', 'WRONG', true).ok, 'wrong phrase rejected');
ok(verifyConfirmation('platform', 'LOCKDOWN PLATFORM', true).ok, 'both factors pass');
// transitions (never skip; always liftable)
ok(canLockdownTransition('proposed', 'confirmed') && canLockdownTransition('confirmed', 'active') && canLockdownTransition('active', 'lifted'), 'happy path');
ok(!canLockdownTransition('proposed', 'active'), 'cannot skip confirm');
ok(!canLockdownTransition('lifted', 'active'), 'lifted terminal');
ok(canLockdownTransition('proposed', 'cancelled') && canLockdownTransition('confirmed', 'cancelled'), 'cancellable pre-active');
// revoke mapping
ok(mapToRevokeScope('account').revokeScope === 'user' && mapToRevokeScope('tenant').revokeScope === 'tenant' && mapToRevokeScope('platform').revokeScope === null, 'scope mapping');
// self-preservation
ok(violatesSelfPreservation('account', 'admin1', 'admin1'), 'self-lockout detected');
ok(!violatesSelfPreservation('account', 'u2', 'admin1'), 'other account ok');
ok(!violatesSelfPreservation('tenant', 't1', 'admin1'), 'tenant scope not self');
// ref
ok(/^LKD-\d{4}-\d{3}$/.test(buildLockdownRef(Date.parse('2026-05-06T00:00:00Z'), 3)), 'ref format');
console.log(`lockdown-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
