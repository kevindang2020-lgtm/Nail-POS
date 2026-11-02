import { normalizeSeverity, normalizeCategory, canTransition, buildTransition, assembleWorkflowCounts, isOpen, buildIncidentRef } from './incident-core';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}`);
// vocab
eq(normalizeSeverity('Critical'), 'critical', 'sev norm'); eq(normalizeSeverity('bogus'), 'medium', 'sev default');
eq(normalizeCategory('Network'), 'network', 'cat norm'); eq(normalizeCategory('weird'), 'other', 'cat default');
// transitions
ok(canTransition('detected', 'investigating'), 'detected→investigating');
ok(canTransition('investigating', 'contained'), 'investigating→contained');
ok(canTransition('contained', 'remediating'), 'contained→remediating');
ok(canTransition('remediating', 'monitoring') && canTransition('remediating', 'closed'), 'remediating→monitoring/closed');
ok(canTransition('closed', 'reopened'), 'closed→reopened');
ok(!canTransition('detected', 'closed') === false, 'detected→closed allowed (early dismissal)');
ok(!canTransition('detected', 'remediating'), 'no skip detected→remediating');
ok(!canTransition('closed', 'investigating'), 'closed cannot jump to investigating (must reopen)');
// buildTransition guards
ok(buildTransition({ from: 'detected', to: 'investigating', actor: 'a', reason: null, correlationId: null }).ok, 'valid transition');
ok(!buildTransition({ from: 'detected', to: 'remediating', actor: 'a', reason: 'x', correlationId: null }).ok, 'invalid rejected');
ok(!buildTransition({ from: 'detected', to: 'detected', actor: 'a', reason: null, correlationId: null }).ok, 'no-op rejected');
ok(!buildTransition({ from: 'remediating', to: 'closed', actor: 'a', reason: '', correlationId: null }).ok, 'close needs reason');
ok(!buildTransition({ from: 'closed', to: 'reopened', actor: 'a', reason: '', correlationId: null }).ok, 'reopen needs reason');
{ const r = buildTransition({ from: 'closed', to: 'reopened', actor: 'admin', reason: 'recurrence', correlationId: 'c1' }); ok(r.ok && r.record.fromStatus === 'closed' && r.record.toStatus === 'reopened' && r.record.actor === 'admin', 'record preserves actor/prev/new'); }
// workflow counts + open + ref
eq(assembleWorkflowCounts({ detected: 3, investigating: 2, contained: 1, remediating: 1, monitoring: 2, closed: 15 }), { detected: 3, investigating: 2, contained: 1, remediating: 1, closed: 17 }, 'workflow counts fold monitoring into closed');
ok(isOpen('investigating') && isOpen('monitoring') && !isOpen('closed'), 'open statuses');
eq(buildIncidentRef(Date.parse('2026-05-06T00:00:00Z'), 54), 'INC-2026-054', 'incident ref');
console.log(`incident-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
