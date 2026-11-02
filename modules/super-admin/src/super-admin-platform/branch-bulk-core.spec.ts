/**
 * branch-bulk-core.spec.ts — verifies pure bulk-action helpers.
 * Pure + DB-free; run by scripts/run-core-specs.sh (esbuild + node).
 */
import { parseIdList, validateBulkStatus, summarizeBulk, BULK_SELECTION_LIMIT } from './branch-bulk-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== parseIdList ==');
  check('array trims + dedupes', JSON.stringify(parseIdList([' a ', 'a', 'b', ''])) === JSON.stringify(['a', 'b']));
  check('comma string parsed', JSON.stringify(parseIdList('a, b ,a,')) === JSON.stringify(['a', 'b']));
  check('empty → []', parseIdList(undefined).length === 0);

  console.log('\n== validateBulkStatus ==');
  check('empty selection rejected', validateBulkStatus({ status: 'suspended', reason: 'audit' }).ok === false);
  check('missing status rejected', validateBulkStatus({ branchIds: ['a'], reason: 'audit' }).ok === false);
  check('missing reason rejected', validateBulkStatus({ branchIds: ['a'], status: 'suspended' }).ok === false);
  {
    const over = Array.from({ length: BULK_SELECTION_LIMIT + 1 }, (_, i) => 'b' + i);
    check('over-limit rejected', validateBulkStatus({ branchIds: over, status: 'suspended', reason: 'audit' }).ok === false);
  }
  {
    const r = validateBulkStatus({ branchIds: ['a', 'b', 'a'], status: 'Suspended', reason: '  fraud sweep ' });
    check('accepts + dedupes', r.ok === true && r.value.branchIds.length === 2);
    if (r.ok) { check('status lowercased', r.value.status === 'suspended'); check('reason trimmed', r.value.reason === 'fraud sweep'); }
  }

  console.log('\n== summarizeBulk ==');
  {
    const sum = summarizeBulk([{ ok: true }, { ok: false }, { ok: true }]);
    check('summary counts', sum.total === 3 && sum.succeeded === 2 && sum.failed === 1);
  }

  console.log(`\nbranch-bulk-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
