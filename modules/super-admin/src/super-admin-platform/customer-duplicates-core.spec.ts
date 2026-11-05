/**
 * customer-duplicates-core.spec.ts — pure grouping of duplicate-candidate rows into review cases (§25).
 * Verifies: rows are grouped by (kind, tenant, key); phone keys are 'exact' confidence and email keys 'high';
 * member phone/email are masked; and a key with only one member is not a case.
 */
import { groupCustomerDuplicates } from './super-admin-platform.repository';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== groups duplicates by phone (exact) and email (high), masked ==');
  const rows = [
    { kind: 'phone', key: '5551234567', tenant_id: 'T1', tenant_name: 'Pilot', id: 'a', full_name: 'Grace Kim', phone_display: '(555) 123-4567', email: 'grace@x.io', branch_name: 'Downtown', status: 'active', created_at: '2026-01-01' },
    { kind: 'phone', key: '5551234567', tenant_id: 'T1', tenant_name: 'Pilot', id: 'b', full_name: 'G. Kim', phone_display: '(555) 123-4567', email: 'grace2@x.io', branch_name: 'Westside', status: 'active', created_at: '2026-02-01' },
    { kind: 'email', key: 'dup@x.io', tenant_id: 'T1', tenant_name: 'Pilot', id: 'c', full_name: 'Nora Patel', phone_display: '(555) 999-0000', email: 'dup@x.io', branch_name: 'Downtown', status: 'active', created_at: '2026-01-10' },
    { kind: 'email', key: 'dup@x.io', tenant_id: 'T1', tenant_name: 'Pilot', id: 'd', full_name: 'Nora P.', phone_display: '(555) 999-0001', email: 'dup@x.io', branch_name: 'Uptown', status: 'inactive', created_at: '2026-03-01' },
    // single-member key (different tenant) — must NOT become a case
    { kind: 'phone', key: '5550000000', tenant_id: 'T2', tenant_name: 'Other', id: 'e', full_name: 'Solo', phone_display: '(555) 000-0000', email: null, branch_name: 'Main', status: 'active', created_at: '2026-01-01' },
  ];
  const cases = groupCustomerDuplicates(rows);
  check('produces exactly two cases', cases.length === 2);
  const phoneCase = cases.find((c: any) => c.kind === 'phone' && c.tenantId === 'T1');
  const emailCase = cases.find((c: any) => c.kind === 'email' && c.tenantId === 'T1');
  check('phone case has both members + exact confidence', !!phoneCase && phoneCase.members.length === 2 && phoneCase.confidence === 'exact');
  check('email case has both members + high confidence', !!emailCase && emailCase.members.length === 2 && emailCase.confidence === 'high');
  check('member phone is masked (last 4 only)', !!phoneCase && phoneCase.members[0].phone === '•••4567');
  check('member email is masked', !!emailCase && emailCase.members[0].email === 'd•••@x.io');
  check('case key is masked, not raw', !!phoneCase && phoneCase.keyMasked === '•••4567' && !!emailCase && emailCase.keyMasked === 'd•••@x.io');
  check('single-member key is not a case', !cases.some((c: any) => c.tenantId === 'T2'));
  check('tenant name is carried', !!phoneCase && phoneCase.tenantName === 'Pilot');

  console.log('\n== empty input → no cases ==');
  check('empty rows → []', groupCustomerDuplicates([]).length === 0);

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main();
