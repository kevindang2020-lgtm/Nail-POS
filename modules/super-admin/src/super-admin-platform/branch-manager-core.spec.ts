/**
 * branch-manager-core.spec.ts — verifies pure validation for the controlled Assign Manager command.
 * Pure + DB-free; run by scripts/run-core-specs.sh (esbuild + node).
 */
import { validateAssignManager, ASSIGNABLE_MANAGER_ROLES } from './branch-manager-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== assignable roles ==');
  check('MANAGER + OWNER are assignable', ASSIGNABLE_MANAGER_ROLES.includes('MANAGER') && ASSIGNABLE_MANAGER_ROLES.includes('OWNER'));

  console.log('\n== required fields ==');
  {
    const r = validateAssignManager({});
    check('rejects empty', r.ok === false);
    if (!r.ok) { check('requires manager', r.errors.some((e) => /manager/i.test(e))); check('requires reason', r.errors.some((e) => /reason/i.test(e))); }
    const noReason = validateAssignManager({ managerUserId: 'u1' });
    check('manager without reason rejected', noReason.ok === false);
  }

  console.log('\n== effective date ==');
  {
    const bad = validateAssignManager({ managerUserId: 'u1', reason: 'reorg', effectiveDate: '07/01/2026' });
    check('bad date format rejected', bad.ok === false);
    const good = validateAssignManager({ managerUserId: 'u1', reason: 'reorg', effectiveDate: '2026-07-01' });
    check('valid ISO date accepted', good.ok === true && good.value.effectiveDate === '2026-07-01');
    const none = validateAssignManager({ managerUserId: 'u1', reason: 'reorg' });
    check('no date → null', none.ok === true && none.value.effectiveDate === null);
  }

  console.log('\n== normalization ==');
  {
    const r = validateAssignManager({ managerUserId: '  u-9 ', reason: '  promote  ' });
    check('accepts', r.ok === true);
    if (r.ok) { check('manager trimmed', r.value.managerUserId === 'u-9'); check('reason trimmed', r.value.reason === 'promote'); }
  }

  console.log(`\nbranch-manager-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
