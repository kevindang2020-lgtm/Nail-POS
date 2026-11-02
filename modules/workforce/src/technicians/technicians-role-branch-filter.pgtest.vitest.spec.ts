// technicians-role-branch-filter.pgtest — 200-technician mandate §34 (Oct 26 2026): the Team page's Role and Branch are
// SERVER filters. The role tabs used to filter only the 20 rows of the page on screen; now `role` and `branchId` narrow
// the whole roster before paging. A branch-scoped session never widens its scope through `branchId`.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { KyselyTechniciansRepository } from './technicians.kysely.repository';

const T = 'cfcfcfcf-0000-4000-8000-000000000001';
const B1 = 'cfcfcfcf-0000-4000-8000-000000000002';
const B2 = 'cfcfcfcf-0000-4000-8000-000000000003';
const tech = (n: number) => `cfcfcfcf-0000-4000-8000-${String(1000 + n).padStart(12, '0')}`;
const owner: any = { tenantId: T, branchId: '', userId: 'cfcfcfcf-0000-4000-8000-0000000000c1', role: 'OWNER', permissions: ['*'] };
const scopedB1: any = { ...owner, branchId: B1 };
let repo: KyselyTechniciansRepository;

beforeAll(async () => {
  const pg: any = await migratedPglite(); clearBranchTimeZoneCache();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Role Branch LLC','Role Branch','role-branch','RBR001','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$3,'Cherry Hill','active','America/New_York'), ($2,$3,'Moorestown','active','America/New_York')`, [B1, B2, T]);
  // 60 technicians: #1–40 in B1 (every 4th a Senior Technician), #41–55 in B2 (Technician), #56–60 in B2 as Nail Artist
  for (let n = 1; n <= 60; n++) {
    const branch = n <= 40 ? B1 : B2;
    const role = n > 55 ? 'Nail Artist' : n <= 40 && n % 4 === 0 ? 'Senior Technician' : 'Technician';
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, role_label) values ($1,$2,$3,'Tech',$4,$5,'active',$6)`,
      [tech(n), T, branch, String(n).padStart(3, '0'), `Tech ${String(n).padStart(3, '0')}`, role]);
  }
  repo = new KyselyTechniciansRepository(kyselyFor(pg) as never);
});

describe('Team page: role and branch filter on the server (§34)', () => {
  it('role filters the WHOLE roster before paging (10 seniors across pages, not the first page only)', async () => {
    const r: any = await repo.query(owner, { role: 'Senior Technician', pageSize: 5 } as never);
    expect(r.rows.pagination.totalItems).toBe(10);
    expect(r.rows.pagination.totalPages).toBe(2);
    expect(r.rows.items.every((t: any) => t.role === 'Senior Technician')).toBe(true);
    const un: any = await repo.query(owner, { role: 'Nail Artist' } as never);
    expect(un.rows.pagination.totalItems).toBe(5);
    // the role counts still describe the whole team
    expect(r.teamSummary.roleCounts).toEqual({ 'Nail Artist': 5, 'Senior Technician': 10, Technician: 45 });
  });

  it('branchId narrows to that branch; combines with role', async () => {
    const b2: any = await repo.query(owner, { branchId: B2, pageSize: 100 } as never);
    expect(b2.rows.pagination.totalItems).toBe(20);
    const b1Sen: any = await repo.query(owner, { branchId: B1, role: 'Senior Technician' } as never);
    expect(b1Sen.rows.pagination.totalItems).toBe(10);
    expect(b2.filterFacets.branches.map((b: any) => b.name)).toEqual(['Cherry Hill', 'Moorestown']);
  });

  it('a branch-scoped session cannot widen its scope with another branchId; its facet lists only its own branch', async () => {
    const other: any = await repo.query(scopedB1, { branchId: B2, pageSize: 100 } as never);
    expect(other.rows.pagination.totalItems).toBe(0);          // never B2's twenty
    const own: any = await repo.query(scopedB1, { pageSize: 100 } as never);
    expect(own.rows.pagination.totalItems).toBe(40);
    expect(own.filterFacets.branches).toEqual([{ branchId: B1, name: 'Cherry Hill' }]);
  });
});
