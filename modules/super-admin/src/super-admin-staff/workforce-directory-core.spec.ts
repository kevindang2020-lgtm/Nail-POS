/**
 * workforce-directory-core.spec.ts — verifies safe query normalization (page/pageSize clamps, sort whitelist,
 * role-category → roles mapping, filter lowercasing). Pure + DB-free; run via esbuild + node.
 */
import { normalizeWorkforceQuery, SORT_COLUMN, pagesFor } from './workforce-directory-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

function main(): void {
  console.log('\n== defaults ==');
  {
    const q = normalizeWorkforceQuery(undefined);
    check('page 1', q.page === 1);
    check('pageSize 10', q.pageSize === 10);
    check('sort name asc', q.sort === 'name' && q.dir === 'asc');
    check('no role filter', q.roleCategory === '' && q.roles.length === 0);
  }

  console.log('\n== clamps ==');
  {
    check('page floored to 1', normalizeWorkforceQuery({ page: -3 }).page === 1);
    check('pageSize capped at 100', normalizeWorkforceQuery({ pageSize: 9999 }).pageSize === 100);
    check('pageSize floored at 1', normalizeWorkforceQuery({ pageSize: 0 }).pageSize === 1);
  }

  console.log('\n== sort whitelist (no injection) ==');
  {
    check('unknown sort → name', normalizeWorkforceQuery({ sort: 'u.password_hash; drop table users' }).sort === 'name');
    check('valid sort kept', normalizeWorkforceQuery({ sort: 'lastActivity', dir: 'DESC' }).sort === 'lastActivity');
    check('dir desc honored', normalizeWorkforceQuery({ dir: 'desc' }).dir === 'desc');
    check('every sort key has a column', Object.keys(SORT_COLUMN).length === 7);
  }

  console.log('\n== role-category mapping ==');
  {
    check('technician → [TECHNICIAN]', JSON.stringify(normalizeWorkforceQuery({ role: 'technician' }).roles) === JSON.stringify(['TECHNICIAN']));
    check('receptionist → RECEPTION+FRONT_DESK', JSON.stringify(normalizeWorkforceQuery({ role: 'receptionist' }).roles) === JSON.stringify(['RECEPTION', 'FRONT_DESK']));
    check('manager → MANAGER+OWNER', JSON.stringify(normalizeWorkforceQuery({ role: 'manager' }).roles) === JSON.stringify(['MANAGER', 'OWNER']));
    check('garbage role → none', normalizeWorkforceQuery({ role: 'wizard' }).roleCategory === '');
  }

  console.log('\n== filters + search ==');
  {
    const q = normalizeWorkforceQuery({ search: '  Sarah ', status: 'Active', tenantId: ' t1 ', branchId: '' });
    check('search lowercased+trimmed', q.search === 'sarah');
    check('status lowercased', q.status === 'active');
    check('tenantId trimmed', q.tenantId === 't1');
    check('empty branchId → undefined', q.branchId === undefined);
  }

  console.log('\n== pagesFor ==');
  check('50/10 → 5 pages', pagesFor(50, 10) === 5);
  check('0 rows → 1 page', pagesFor(0, 10) === 1);
  check('11/10 → 2 pages', pagesFor(11, 10) === 2);

  console.log(`\nworkforce-directory-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
