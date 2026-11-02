/**
 * branch-create-core.spec.ts — verifies pure validation/normalization for the controlled Add Branch command.
 * Pure + DB-free; run by scripts/run-core-specs.sh (esbuild + node).
 */
import { validateCreateBranch } from './branch-create-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== required fields ==');
  {
    const r = validateCreateBranch({});
    check('rejects empty', r.ok === false);
    if (!r.ok) { check('requires tenant', r.errors.some((e) => /tenant/i.test(e))); check('requires name', r.errors.some((e) => /name/i.test(e))); }
    const noName = validateCreateBranch({ tenantId: 't1', name: 'A' });
    check('name min length 2', noName.ok === false);
  }

  console.log('\n== email + timezone validation ==');
  {
    const badEmail = validateCreateBranch({ tenantId: 't1', name: 'Downtown', managerEmail: 'nope' });
    check('bad email rejected', badEmail.ok === false);
    const badTz = validateCreateBranch({ tenantId: 't1', name: 'Downtown', timezone: 'EST' });
    check('non-IANA timezone rejected', badTz.ok === false);
    const ok = validateCreateBranch({ tenantId: 't1', name: 'Downtown', managerEmail: 'm@x.com', timezone: 'America/New_York' });
    check('valid email + tz accepted', ok.ok === true);
  }

  console.log('\n== normalization ==');
  {
    const r = validateCreateBranch({ tenantId: '  t1 ', name: '  Glamour Downtown ', city: ' NYC ', address: '', openingStatus: 'planned' });
    check('accepts', r.ok === true);
    if (r.ok) {
      check('tenant trimmed', r.value.tenantId === 't1');
      check('name trimmed', r.value.name === 'Glamour Downtown');
      check('city trimmed', r.value.city === 'NYC');
      check('empty address → null', r.value.address === null);
      check('planned → pending status', r.value.status === 'pending');
      check('verification draft', r.value.verificationStatus === 'draft');
    }
  }

  console.log('\n== opening status → lifecycle ==');
  {
    const active = validateCreateBranch({ tenantId: 't1', name: 'Branch', openingStatus: 'active' });
    check('active → active', active.ok === true && active.value.status === 'active');
    const blank = validateCreateBranch({ tenantId: 't1', name: 'Branch' });
    check('blank → pending', blank.ok === true && blank.value.status === 'pending');
  }

  console.log(`\nbranch-create-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
