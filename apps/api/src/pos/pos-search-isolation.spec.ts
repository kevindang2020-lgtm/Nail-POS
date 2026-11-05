// pos-search-isolation.spec.ts — security wiring tests for PosSearchService. Proves the trusted scope is
// derived ONLY from the session: tenantId always equals the session tenant, the default branch is the
// session branch, and "all locations" is honored ONLY for OWNER/MANAGER (a receptionist cannot escalate).
import { PosSearchService, type SearchRepo, type Scope } from './pos-search.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };

// fake repo records every scope it is handed and returns one canned row per group
function makeRepo() {
  const seen: Scope[] = [];
  const m = (s: Scope) => { seen.push({ ...s }); return Promise.resolve([{ id: '1', title: 'Row' }]); };
  const repo: SearchRepo = { customers: m, appointments: m, services: m, technicians: m, tickets: m, receipts: m, queue: m };
  return { repo, seen };
}
const ctx = { audit: { record: async () => {} }, clock: { iso: () => '2026-01-01T00:00:00Z' } };
const perms = ['customers.view', 'appointments.view', 'services.view', 'technicians.view', 'tickets.view', 'reports.view'];

(async () => {
  // 1) tenant is always the session tenant, default branch is the session branch
  {
    const { repo, seen } = makeRepo();
    const svc = new PosSearchService(repo, ctx);
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'u', role: 'FRONT_DESK', permissions: perms }, 'sophia');
    ok('all queries scoped to session tenant A', seen.length > 0 && seen.every((s) => s.tenantId === 'A'));
    ok('all queries scoped to session branch brA', seen.every((s) => s.branchId === 'brA'));
  }

  // 2) a client-supplied tenant/location is structurally impossible — only tc is used.
  {
    const { repo, seen } = makeRepo();
    const svc = new PosSearchService(repo, ctx);
    // even if extra fields are smuggled onto the context object, the service reads tenantId/branchId from tc itself
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'u', role: 'FRONT_DESK', permissions: perms, queryTenantId: 'B' } as any, 'xy');
    ok('smuggled tenantId ignored (still A)', seen.every((s) => s.tenantId === 'A'));
  }

  // 3) OWNER may opt into all authorized locations (branchId = null)
  {
    const { repo, seen } = makeRepo();
    const svc = new PosSearchService(repo, ctx);
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'o', role: 'OWNER', permissions: [] }, 'xy', undefined, { allLocations: true });
    ok('OWNER all-locations drops branch filter', seen.every((s) => s.tenantId === 'A' && s.branchId === null));
  }

  // 4) RECEPTION cannot escalate to all locations — stays pinned to its branch
  {
    const { repo, seen } = makeRepo();
    const svc = new PosSearchService(repo, ctx);
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'r', role: 'RECEPTION', permissions: perms }, 'xy', undefined, { allLocations: true });
    ok('RECEPTION cannot escalate to all locations', seen.every((s) => s.branchId === 'brA'));
  }

  // 5) forbidden roles are rejected (no query runs)
  {
    const { repo, seen } = makeRepo();
    const svc = new PosSearchService(repo, ctx);
    let threw = false;
    try { await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'c', role: 'CUSTOMER', permissions: ['pos.access'] }, 'x'); } catch { threw = true; }
    ok('CUSTOMER role forbidden, no repo query ran', threw && seen.length === 0);
  }

  // 6) permission-limited role only queries permitted groups
  {
    const { repo, seen } = makeRepo();
    const svc = new PosSearchService(repo, ctx);
    await svc.search({ tenantId: 'A', branchId: 'brA', userId: 't', role: 'TECHNICIAN', permissions: ['pos.access', 'customers.view'] }, 'xy');
    ok('TECHNICIAN with only customers.view queries exactly 1 group', seen.length === 1);
  }

  // 7) short query never touches the repo
  {
    const { repo, seen } = makeRepo();
    const svc = new PosSearchService(repo, ctx);
    const r = await svc.search({ tenantId: 'A', branchId: 'brA', userId: 'u', role: 'OWNER', permissions: [] }, 'a');
    ok('sub-2-char query returns empty, no repo query', seen.length === 0 && r.totalCount === 0);
  }

  console.log(`pos-search-isolation: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
