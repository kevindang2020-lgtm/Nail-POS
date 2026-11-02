/**
 * category-duplicates-core.spec.ts — pure grouping logic for cross-tenant category duplicate review (§23). DB-free:
 * exercises groupCategoryDuplicates directly. A normalized name used by more than one tenant is a duplicate group;
 * single-tenant names are dropped; product counts and tenant counts aggregate correctly.
 */
import { groupCategoryDuplicates } from './super-admin-platform.repository';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const rows = [
  { norm: 'gel polish', tenant: 'Pilot Nail Salon', name: 'Gel Polish', products: 12 },
  { norm: 'gel polish', tenant: 'Westside Spa', name: 'Gel Polish ', products: 8 },
  { norm: 'gel polish', tenant: 'Downtown Nails', name: 'gel polish', products: 5 },
  { norm: 'skin care', tenant: 'Pilot Nail Salon', name: 'Skin Care', products: 4 }, // only one tenant → dropped
  { norm: 'nail care', tenant: 'Pilot Nail Salon', name: 'Nail Care', products: 7 },
  { norm: 'nail care', tenant: 'Westside Spa', name: 'Nail Care', products: 3 },
  { norm: '', tenant: 'X', name: '', products: 9 }, // blank normalized → skipped
];

function main(): void {
  const groups = groupCategoryDuplicates(rows);
  check('drops single-tenant + blank names (2 duplicate groups remain)', groups.length === 2);
  const gel = groups.find((g: any) => g.normalizedName === 'gel polish');
  check('gel polish present', !!gel);
  check('gel polish spans 3 tenants', gel?.tenantCount === 3);
  check('gel polish totals products (12+8+5=25)', gel?.totalProducts === 25);
  check('gel polish has 3 members', gel?.members?.length === 3);
  const nail = groups.find((g: any) => g.normalizedName === 'nail care');
  check('nail care spans 2 tenants', nail?.tenantCount === 2);
  check('groups sorted by tenantCount desc (gel polish first)', groups[0].normalizedName === 'gel polish');
  check('skin care excluded (single tenant)', !groups.find((g: any) => g.normalizedName === 'skin care'));

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main();
