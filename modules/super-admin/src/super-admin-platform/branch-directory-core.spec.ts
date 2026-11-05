/**
 * branch-directory-core.spec.ts — verifies server-side normalize/filter/sort/paginate for the All Branches Directory.
 * Pure + DB-free; run by scripts/run-core-specs.sh (esbuild + node).
 */
import { normalizeBranchQuery, filterBranches, sortBranches, paginateBranches, type BranchDirRow } from './branch-directory-core';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }

const row = (over: Partial<BranchDirRow>): BranchDirRow => ({ id: 'id', name: 'B', tenantId: 't', tenantName: 'Ten', city: 'NYC', state: 'NY', status: 'active', manager: 'M', staff: 0, todaysAppts: 0, revenueMtdCents: 0, devices: null, openTickets: 0, queueWaiting: 0, healthScore: null, ...over });

function main(): void {
  console.log('\n== normalize: defaults + clamping + whitelist ==');
  {
    const q = normalizeBranchQuery(undefined);
    check('default page 1', q.page === 1);
    check('default pageSize 10', q.pageSize === 10);
    check('default sort revenueMtdCents', q.sort === 'revenueMtdCents');
    check('default dir desc', q.dir === 'desc');
    const q2 = normalizeBranchQuery({ page: '3', pageSize: '999', sort: 'evil', dir: 'asc', search: '  Down ', status: 'ACTIVE' });
    check('pageSize clamped to 100', q2.pageSize === 100);
    check('bad sort falls back', q2.sort === 'revenueMtdCents');
    check('dir asc honored', q2.dir === 'asc');
    check('search trimmed+lowered', q2.search === 'down');
    check('status lowered', q2.status === 'active');
    check('page parsed', q2.page === 3);
  }

  console.log('\n== filter: status / tenant / city / health / search ==');
  {
    const rows = [
      row({ id: '1', name: 'Downtown', status: 'active', tenantName: 'Luxe', city: 'New York', healthScore: 92, manager: 'Emma' }),
      row({ id: '2', name: 'Uptown', status: 'suspended', tenantName: 'Bella', city: 'Austin', healthScore: 30, manager: 'Olivia' }),
      row({ id: '3', name: 'Midtown', status: 'active', tenantName: 'Luxe', city: 'New York', healthScore: null, manager: 'Sam' }),
    ];
    check('status filter', filterBranches(rows, normalizeBranchQuery({ status: 'active' })).length === 2);
    check('tenant filter by name', filterBranches(rows, normalizeBranchQuery({ tenant: 'Bella' })).length === 1);
    check('city filter', filterBranches(rows, normalizeBranchQuery({ city: 'Austin' })).length === 1);
    check('search by manager', filterBranches(rows, normalizeBranchQuery({ search: 'emma' })).length === 1);
    check('search by name', filterBranches(rows, normalizeBranchQuery({ search: 'town' })).length === 3);
    check('healthMax excludes null + high', filterBranches(rows, normalizeBranchQuery({ healthMax: 49 })).length === 1);
  }

  console.log('\n== sort: numeric desc, nulls last ==');
  {
    const rows = [row({ id: 'a', healthScore: 50 }), row({ id: 'b', healthScore: null }), row({ id: 'c', healthScore: 90 })];
    const sorted = sortBranches(rows, 'healthScore', 'desc');
    check('highest health first', sorted[0].id === 'c');
    check('null last on desc', sorted[2].id === 'b');
    const asc = sortBranches(rows, 'healthScore', 'asc');
    check('null still last on asc', asc[2].id === 'b');
    check('lowest non-null first on asc', asc[0].id === 'a');
  }

  console.log('\n== paginate: page slice + total + facets ==');
  {
    const all: BranchDirRow[] = [];
    for (let i = 0; i < 23; i++) all.push(row({ id: 'b' + i, name: 'Branch ' + i, revenueMtdCents: i * 100, tenantName: i % 2 ? 'Luxe' : 'Bella', city: i % 3 ? 'NYC' : 'LA', status: i % 5 ? 'active' : 'paused' }));
    const p1 = paginateBranches(all, normalizeBranchQuery({ page: 1, pageSize: 10, sort: 'revenueMtdCents', dir: 'desc' }));
    check('total 23', p1.total === 23);
    check('pages 3', p1.pages === 3);
    check('page has 10', p1.rows.length === 10);
    check('sorted desc: first is highest revenue', p1.rows[0].revenueMtdCents === 2200);
    const p3 = paginateBranches(all, normalizeBranchQuery({ page: 3, pageSize: 10 }));
    check('last page has 3', p3.rows.length === 3);
    const over = paginateBranches(all, normalizeBranchQuery({ page: 99, pageSize: 10 }));
    check('page clamped to last', over.page === 3);
    check('facets: 2 tenants', p1.facets.tenants.length === 2);
    check('facets: 2 cities', p1.facets.cities.length === 2);
    check('facets: 2 statuses', p1.facets.statuses.length === 2);
    check('facets computed from full set (not the page)', p1.facets.statuses.includes('paused'));
  }

  console.log(`\nbranch-directory-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
