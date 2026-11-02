/**
 * branch-lifecycle-core.spec.ts — verifies the pure status lifecycle: allowed transitions, required reason,
 * typed-confirmation for high-risk targets, and impact summaries. Pure + DB-free (esbuild + node).
 */
import { canTransition, validateStatusChange, impactSummary, HIGH_RISK_TARGETS } from './branch-lifecycle-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== allowed transitions ==');
  check('active → paused', canTransition('active', 'paused'));
  check('active → suspended', canTransition('active', 'suspended'));
  check('paused → active', canTransition('paused', 'active'));
  check('suspended → active', canTransition('suspended', 'active'));
  check('closing → closed', canTransition('closing', 'closed'));
  check('active → closed (illegal, must go via closing)', !canTransition('active', 'closed'));
  check('suspended → paused (illegal)', !canTransition('suspended', 'paused'));
  check('closed → active (illegal)', !canTransition('closed', 'active'));
  check('case-insensitive', canTransition('ACTIVE', 'Paused'));

  console.log('\n== reason required ==');
  {
    const r = validateStatusChange({ from: 'active', to: 'paused', reason: '' });
    check('no reason rejected', r.ok === false);
    const r2 = validateStatusChange({ from: 'active', to: 'paused', reason: 'ok now' });
    check('with reason accepted (pause = no typed confirm)', r2.ok === true);
  }

  console.log('\n== high-risk typed confirmation ==');
  {
    check('suspend is high-risk', HIGH_RISK_TARGETS.has('suspended'));
    const noConfirm = validateStatusChange({ from: 'active', to: 'suspended', reason: 'fraud review' });
    check('suspend without typed name rejected', noConfirm.ok === false);
    const wrong = validateStatusChange({ from: 'active', to: 'suspended', reason: 'fraud review', confirmName: 'Wrong', branchName: 'Glamour Downtown' });
    check('wrong typed name rejected', wrong.ok === false);
    const ok = validateStatusChange({ from: 'active', to: 'suspended', reason: 'fraud review', confirmName: ' glamour downtown ', branchName: 'Glamour Downtown' });
    check('correct typed name (case/space-insensitive) accepted', ok.ok === true);
  }

  console.log('\n== illegal transition rejected with helpful message ==');
  {
    const r = validateStatusChange({ from: 'closed', to: 'active', reason: 'reopen please' });
    check('closed → active rejected', r.ok === false);
    if (!r.ok) check('message mentions cannot be changed', r.errors.some((e) => /cannot/i.test(e)));
  }

  console.log('\n== impact summaries are non-empty + specific ==');
  check('suspend impact lists settlement halt', impactSummary('suspended').some((l) => /settlement/i.test(l)));
  check('suspend impact says data preserved', impactSummary('suspended').some((l) => /preserved|not deleted/i.test(l)));
  check('pause impact non-empty', impactSummary('paused').length > 0);
  check('reactivate impact says no data changed', impactSummary('active').some((l) => /no data/i.test(l)));

  console.log(`\nbranch-lifecycle-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
