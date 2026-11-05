// deployments-core.spec.ts — DB-free harness spec (auto-discovered by scripts/run-core-specs.sh).
import { updateAvailable, isPending, pendingCount, summarize, nextStatus, type DeployRecord } from './deployments-core';

let passed = 0, failed = 0;
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) === JSON.stringify(b)) passed++; else { failed++; console.error(`FAIL: ${m}\n  expected ${JSON.stringify(b)}\n  got      ${JSON.stringify(a)}`); } };
const ok = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error(`FAIL: ${m}`); } };

const rec = (o: Partial<DeployRecord>): DeployRecord => ({ id: 'd', component: 'iPad App', componentKind: 'app', installedVersion: 'v3.2.1', latestVersion: 'v3.3.0', targetCount: 2, status: 'available', scheduledIso: null, branchId: null, ...o });

// updateAvailable
ok(updateAvailable(rec({})), 'installed != latest ⇒ update available');
ok(!updateAvailable(rec({ installedVersion: 'v3.3.0' })), 'installed == latest ⇒ none');
ok(!updateAvailable(rec({ status: 'completed' })), 'completed ⇒ none');
ok(!updateAvailable(rec({ status: 'up_to_date' })), 'up_to_date ⇒ none');
ok(updateAvailable(rec({ installedVersion: null })), 'unknown installed + known latest ⇒ available');
ok(!updateAvailable(rec({ latestVersion: null })), 'no latest version ⇒ none');

// isPending / pendingCount
ok(isPending(rec({ status: 'available' })), 'available + update ⇒ pending');
ok(!isPending(rec({ status: 'in_progress' })), 'in_progress ⇒ not pending');
ok(isPending(rec({ status: 'scheduled' })), 'scheduled + update ⇒ pending');
eq(pendingCount([rec({ id: '1' }), rec({ id: '2', status: 'in_progress' }), rec({ id: '3', installedVersion: 'v3.3.0' })]), 1, 'one of three pending');

// summarize
const sum = summarize([
  rec({ id: '1' }),                                  // pending
  rec({ id: '2', status: 'in_progress' }),           // in progress (not pending, not up-to-date)
  rec({ id: '3', installedVersion: 'v3.3.0' }),      // up to date
  rec({ id: '4', status: 'up_to_date' }),            // up to date
]);
eq(sum, { total: 4, pending: 1, upToDate: 2, inProgress: 1 }, 'summary counts');

// nextStatus state machine
eq(nextStatus('available', 'schedule'), 'scheduled', 'available → schedule');
eq(nextStatus('scheduled', 'start'), 'in_progress', 'scheduled → start');
eq(nextStatus('in_progress', 'complete'), 'completed', 'in_progress → complete');
eq(nextStatus('in_progress', 'fail'), 'failed', 'in_progress → fail');
eq(nextStatus('completed', 'rollback'), 'rolled_back', 'completed → rollback');
eq(nextStatus('completed', 'start'), null, 'cannot start a completed deployment');
eq(nextStatus('available', 'complete'), null, 'cannot complete an un-started deployment (no fake completion)');
eq(nextStatus('available', 'bogus'), null, 'unknown action → null');

console.log(`\n[deployments-core] ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
