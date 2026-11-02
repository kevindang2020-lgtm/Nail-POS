// pos-search-isolation.vitest.spec.ts — security wiring tests for PosSearchService. Proves the trusted scope is
// derived ONLY from the session: tenantId always equals the session tenant, the default branch is the session branch,
// and "all locations" is honoured ONLY for a holder of owner.branches.view (a front desk cannot escalate).
//
// Oct 26 2026 (dead-code pass): this was pos-search-isolation.spec.ts, an esbuild ok()-style harness that matched no
// runner pattern (not *-core.spec.ts, not *.vitest.spec.ts), so it had silently not run since the Phase 9 permissions
// change. Its fixtures still used the pre-Phase-9 vocabulary (`pos.access`, OWNER with no permissions), so it failed
// with forbidden_pos_search. Ported to vitest with the CURRENT catalog permission sets (the same sets
// pos-search-core.spec.ts uses). The seven scenarios and their assertions are the original ones; only fixtures moved:
// OWNER/FRONT_DESK now carry their catalog grants, the escalation case uses FRONT_DESK (RECEPTION is no catalog role),
// and the CUSTOMER case holds global_search.use with a 2-char query, so it proves the ROLE is refused rather than
// tripping over a missing permission or the short-query early return. Mutation-checked: dropping the
// owner.branches.view gate in PosSearchService fails the front-desk escalation case.
import { describe, it, expect } from 'vitest';
import { PosSearchService, type SearchRepo, type Scope } from './pos-search.service';

// fake repo records every scope it is handed and returns one canned row per group
function makeRepo() {
  const seen: Scope[] = [];
  const m = (s: Scope) => { seen.push({ ...s }); return Promise.resolve([{ id: '1', title: 'Row' }]); };
  const repo: SearchRepo = { customers: m, appointments: m, services: m, technicians: m, tickets: m, receipts: m, queue: m };
  return { repo, seen, svc: new PosSearchService(repo, ctx) };
}
const ctx = { audit: { record: async () => {} }, clock: { iso: () => '2026-01-01T00:00:00Z' } };

// The catalog grants (BUILD_PLAN Phase 9: access + groups are PERMISSIONS, not role names) — kept identical to
// pos-search-core.spec.ts so the two suites cannot drift apart.
const OWNER = ['global_search.use', 'customers.view', 'booking.view', 'services.view', 'technicians.view', 'checkout.view', 'reports.view', 'queue.view', 'owner.branches.view'];
const FRONT_DESK = ['global_search.use', 'customers.view', 'booking.view', 'services.view', 'technicians.view', 'checkout.view', 'queue.view'];

describe('PosSearchService scope isolation', () => {
  it('scopes every query to the session tenant and the session branch', async () => {
    const { svc, seen } = makeRepo();
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'u', role: 'FRONT_DESK', permissions: FRONT_DESK }, 'sophia');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.tenantId === 'A')).toBe(true);
    expect(seen.every((s) => s.branchId === 'brA')).toBe(true);
  });

  it('ignores a tenant id smuggled onto the context object', async () => {
    const { svc, seen } = makeRepo();
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'u', role: 'FRONT_DESK', permissions: FRONT_DESK, queryTenantId: 'B' } as any, 'xy');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.tenantId === 'A')).toBe(true);
  });

  it('lets an owner (owner.branches.view) opt into all authorized locations', async () => {
    const { svc, seen } = makeRepo();
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'o', role: 'OWNER', permissions: OWNER }, 'xy', undefined, { allLocations: true });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.tenantId === 'A' && s.branchId === null)).toBe(true);
  });

  it('keeps a front desk without owner.branches.view pinned to its branch when it asks for all locations', async () => {
    const { svc, seen } = makeRepo();
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'r', role: 'FRONT_DESK', permissions: FRONT_DESK }, 'xy', undefined, { allLocations: true });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.branchId === 'brA')).toBe(true);
  });

  it('rejects a CUSTOMER whatever it holds, before any query runs', async () => {
    const { svc, seen } = makeRepo();
    await expect(svc.search({ tenantId: 'A', branchId: 'brA', userId: 'c', role: 'CUSTOMER', permissions: ['global_search.use'] }, 'xy')).rejects.toThrow();
    expect(seen.length).toBe(0);
  });

  it('queries only the groups a permission-limited role may see', async () => {
    const { svc, seen } = makeRepo();
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 't', role: 'TECHNICIAN', permissions: ['global_search.use', 'customers.view'] }, 'xy');
    expect(seen.length).toBe(1);
  });

  it('never touches the repo for a sub-2-character query', async () => {
    const { svc, seen } = makeRepo();
    const r = await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'u', role: 'OWNER', permissions: OWNER }, 'a');
    expect(seen.length).toBe(0);
    expect(r.totalCount).toBe(0);
  });
});
