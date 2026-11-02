/**
 * branch-transfer-core.spec.ts — verifies pure validation + impact domains for the controlled branch-transfer request.
 * Pure + DB-free; run by scripts/run-core-specs.sh (esbuild + node).
 */
import { validateTransferRequest, TRANSFER_IMPACT_DOMAINS } from './branch-transfer-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== required fields ==');
  {
    const r = validateTransferRequest({});
    check('rejects empty', r.ok === false);
    if (!r.ok) {
      check('requires destination', r.errors.some((e) => /destination/i.test(e)));
      check('requires reason', r.errors.some((e) => /reason/i.test(e)));
      check('requires typed confirm', r.errors.some((e) => /branch name/i.test(e)));
    }
  }

  console.log('\n== reason length + confirm ==');
  {
    const shortReason = validateTransferRequest({ destinationTenantId: 't2', reason: 'too short', confirmName: 'X' });
    check('short reason rejected', shortReason.ok === false);
    const noConfirm = validateTransferRequest({ destinationTenantId: 't2', reason: 'consolidating into the parent group' });
    check('missing confirm rejected', noConfirm.ok === false);
  }

  console.log('\n== effective date ==');
  {
    const bad = validateTransferRequest({ destinationTenantId: 't2', reason: 'consolidating into the parent group', confirmName: 'Downtown', effectiveDate: 'soon' });
    check('bad date rejected', bad.ok === false);
    const ok = validateTransferRequest({ destinationTenantId: 't2', reason: 'consolidating into the parent group', confirmName: 'Downtown', effectiveDate: '2026-08-01' });
    check('valid date accepted', ok.ok === true && ok.value.effectiveDate === '2026-08-01');
  }

  console.log('\n== normalization + accept ==');
  {
    const r = validateTransferRequest({ destinationTenantId: '  t2 ', reason: '  consolidating into the parent group  ', confirmName: '  Downtown Branch ' });
    check('accepts', r.ok === true);
    if (r.ok) { check('dest trimmed', r.value.destinationTenantId === 't2'); check('confirm trimmed', r.value.confirmName === 'Downtown Branch'); check('no date → null', r.value.effectiveDate === null); }
  }

  console.log('\n== impact domains: financial history is retained, not moved ==');
  {
    const settlements = TRANSFER_IMPACT_DOMAINS.find((d) => /settlement|payments/i.test(d.domain));
    check('payments/settlements retained', settlements?.disposition === 'retain');
    const reporting = TRANSFER_IMPACT_DOMAINS.find((d) => /reporting|audit/i.test(d.domain));
    check('reporting/audit retained', reporting?.disposition === 'retain');
    check('domains documented', TRANSFER_IMPACT_DOMAINS.length >= 8);
  }

  console.log(`\nbranch-transfer-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
