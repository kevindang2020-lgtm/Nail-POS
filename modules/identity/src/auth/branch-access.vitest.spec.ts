import { describe, it, expect } from 'vitest';
import { BranchSelectionService, InMemoryBranchAccessRepository, type BranchSessionInput } from './branch-access';
import { technicianEnterableBranches } from './authorization-state';

const session: BranchSessionInput = { userId: 'u1', tenantId: 't1', branchId: null, role: 'OWNER' as any, permissions: ['pos.view'], subscriptionStatus: 'active' };
const repo = new InMemoryBranchAccessRepository({ t1: [{ id: 'b1', isActive: true }, { id: 'b2', isActive: false }] });
const svc = new BranchSelectionService(repo);

describe('BranchSelectionService.selectBranch', () => {
  it('valid active branch in the tenant → claims with branchId set', async () => {
    const claims = await svc.selectBranch(session, 'b1');
    expect(claims).toEqual({ userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER', permissions: ['pos.view'], subscriptionStatus: 'active' });
  });
  it('branch not in tenant → branch_not_found', async () => {
    await expect(svc.selectBranch(session, 'bX')).rejects.toMatchObject({ code: 'branch_not_found' });
  });
  it('inactive branch → branch_inactive', async () => {
    await expect(svc.selectBranch(session, 'b2')).rejects.toMatchObject({ code: 'branch_inactive' });
  });
  it('empty branchId → invalid', async () => {
    await expect(svc.selectBranch(session, '   ')).rejects.toMatchObject({ code: 'invalid' });
  });
  it('missing session → not_authenticated', async () => {
    await expect(svc.selectBranch(null, 'b1')).rejects.toMatchObject({ code: 'not_authenticated' });
  });
  it('no tenant (e.g. super-admin) → invalid', async () => {
    await expect(svc.selectBranch({ ...session, tenantId: null }, 'b1')).rejects.toMatchObject({ code: 'invalid' });
  });

  it('list returns the tenant branches for an authenticated session', async () => {
    expect(await svc.list(session)).toEqual([{ id: 'b1', isActive: true }, { id: 'b2', isActive: false }]);
  });
  it('list rejects an unauthenticated session', async () => {
    await expect(svc.list(null)).rejects.toMatchObject({ code: 'not_authenticated' });
  });
});

// ── §6 "User has access to the branch" — per-user grants (user_branch_access / Owner Multi-Salon) ──
// Previously the picker and selectBranch used the tenant's FULL branch list, so a user with an explicit, limited
// grant could select a branch they were never granted and get a session scoped to it.
describe('per-user branch access (spec §6)', () => {
  const T = 't1';
  const session = (userId: string): any => ({ userId, tenantId: T, branchId: null, role: 'OWNER', permissions: [], subscriptionStatus: 'active' });

  const port = (grants: Record<string, string[]>): any => ({
    async branchesForTenant() {
      return [
        { id: 'b1', name: 'Merchantville', city: null, isActive: true },
        { id: 'b2', name: 'Cherry Hill', city: null, isActive: true },
        { id: 'b3', name: 'Camden', city: null, isActive: true },
      ];
    },
    async branchIdsForUser(_t: string, userId: string) { return grants[userId] ?? []; },
  });

  it('a user with explicit grants sees ONLY their granted branches', async () => {
    const svc = new BranchSelectionService(port({ owner2: ['b1', 'b2'] }));
    const list = await svc.list(session('owner2'));
    expect(list.map((b) => b.id)).toEqual(['b1', 'b2']);
  });

  it('SECURITY: they cannot select a branch they were never granted', async () => {
    const svc = new BranchSelectionService(port({ owner2: ['b1', 'b2'] }));
    await expect(svc.selectBranch(session('owner2'), 'b3')).rejects.toMatchObject({ code: 'branch_not_found' });
  });

  it('they CAN select a branch they were granted', async () => {
    const svc = new BranchSelectionService(port({ owner2: ['b1', 'b2'] }));
    const claims = await svc.selectBranch(session('owner2'), 'b2');
    expect(claims.branchId).toBe('b2');
  });

  it('the refusal does not reveal whether the branch exists (same error as a bogus id)', async () => {
    const svc = new BranchSelectionService(port({ owner2: ['b1'] }));
    const real = await svc.selectBranch(session('owner2'), 'b3').catch((e) => e);
    const bogus = await svc.selectBranch(session('owner2'), 'does-not-exist').catch((e) => e);
    expect(real.code).toBe(bogus.code);
    expect(real.message).toBe(bogus.message);
  });

  it('NO REGRESSION: ordinary staff with no explicit grants still see every tenant branch', async () => {
    const svc = new BranchSelectionService(port({}));            // no grants for anyone
    const list = await svc.list(session('receptionist'));
    expect(list.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    const claims = await svc.selectBranch(session('receptionist'), 'b3');
    expect(claims.branchId).toBe('b3');                          // unchanged behavior
  });

  it('fails SAFE: if the grant lookup throws, behavior falls back to the tenant list (no lockout)', async () => {
    const broken: any = {
      async branchesForTenant() { return [{ id: 'b1', name: 'X', city: null, isActive: true }]; },
      async branchIdsForUser() { throw new Error('db down'); },
    };
    const svc = new BranchSelectionService(broken);
    expect((await svc.list(session('u1'))).map((b) => b.id)).toEqual(['b1']);
  });
});

describe('Sep 2026 merge — a per-branch role (developer feature) never widens an unchanged role', () => {
  it('same role at the branch: the session permissions stand (an owner-set restriction is not reset)', async () => {
    const svc2 = new BranchSelectionService(Object.assign(Object.create(repo), { roleForBranch: async () => 'OWNER' }));
    const claims = await svc2.selectBranch(session, 'b1');
    expect(claims.permissions).toEqual(['pos.view']);
  });
  it('BUILD_PLAN Phase 9: a DIFFERENT role at the branch never REPLACES the session role, nor adds a permission', async () => {
    const svc2 = new BranchSelectionService(Object.assign(Object.create(repo), { roleForBranch: async () => 'MANAGER' }));
    const claims = await svc2.selectBranch({ ...session, role: 'FRONT_DESK' as any, permissions: ['pos.login', 'checkout.view'] }, 'b1');
    expect(claims.role).toBe('FRONT_DESK');                              // was: 'MANAGER' (the row replaced the role)
    expect(claims.permissions).toEqual(['pos.login', 'checkout.view']);   // was: every MANAGER default
  });
});

// ── BUILD_PLAN Phase 9: template scope read at branch selection (Kevin's decision (1)) ──
describe('template scope confines branch selection', () => {
  const T = 't1';
  const branches = [{ id: 'b1', name: 'A', city: null, isActive: true }, { id: 'b2', name: 'B', city: null, isActive: true }, { id: 'b3', name: 'C', city: null, isActive: true }];
  const port = (enterable: Record<string, string[] | null>): any => ({
    async branchesForTenant() { return branches; },
    async branchIdsForUser() { return []; },
    async enterableBranchesFor(_t: string, userId: string) { return enterable[userId] ?? null; },
  });
  const s = (userId: string, role = 'FRONT_DESK'): any => ({ userId, tenantId: T, branchId: null, role, permissions: ['pos.login'], subscriptionStatus: 'active', av: 4, tv: 2 });
  it('a branch-scoped receptionist confined to the home branch cannot select another one', async () => {
    const svc = new BranchSelectionService(port({ desk: ['b1'] }));
    expect((await svc.list(s('desk'))).map((b) => b.id)).toEqual(['b1']);
    await expect(svc.selectBranch(s('desk'), 'b2')).rejects.toMatchObject({ code: 'branch_not_found' });
    const c = await svc.selectBranch(s('desk'), 'b1');
    expect(c).toMatchObject({ branchId: 'b1', av: 4, tv: 2 });   // the versions ride along unchanged
  });
  it('SELECTED_BRANCHES: exactly the granted branches; TENANT / legacy (null): every branch', async () => {
    const svc = new BranchSelectionService(port({ inv: ['b2', 'b3'], gm: null }));
    expect((await svc.list(s('inv', 'MANAGER'))).map((b) => b.id)).toEqual(['b2', 'b3']);
    expect((await svc.list(s('gm', 'MANAGER'))).map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect((await svc.selectBranch(s('gm', 'MANAGER'), 'b3')).branchId).toBe('b3');
  });
  it('a failing scope lookup falls back to the salon\'s branches (no lockout on a DB blip)', async () => {
    const svc = new BranchSelectionService({ ...port({}), async enterableBranchesFor() { throw new Error('db down'); } } as any);
    expect((await svc.list(s('x'))).length).toBe(3);
  });
});

// ── TECHNICIAN sessions fail CLOSED (Oct 12 2026 merge, other chat — workforce audit P2 #28) ───────────────────────
// A technician's branches are her employment (one user_branch_access grant per active membership, WF 578 backfill).
// Adapted: ours keeps the home branch when she has no grant (technicianEnterableBranches) instead of nothing at all.
describe('branch selection for TECHNICIAN sessions fails closed', () => {
  const T = 't1';
  const tech = (userId: string, role = 'TECHNICIAN'): any => ({ userId, tenantId: T, branchId: null, role, permissions: ['pos.login'], subscriptionStatus: 'active' });
  const all = [{ id: 'A', name: 'Merchantville', city: null, isActive: true }, { id: 'B', name: 'Cherry Hill', city: null, isActive: true }, { id: 'C', name: 'Camden', city: null, isActive: true }];
  const grantsPort = (grants: Record<string, string[]>): any => ({ async branchesForTenant() { return all; }, async branchIdsForUser(_t: string, u: string) { return grants[u] ?? []; } });

  it('grants at A and B → A and B only; C is closed', async () => {
    const svc = new BranchSelectionService(grantsPort({ lan: ['A', 'B'] }));
    expect((await svc.list(tech('lan'))).map((b) => b.id)).toEqual(['A', 'B']);
    await expect(svc.selectBranch(tech('lan'), 'C')).rejects.toMatchObject({ code: 'branch_not_found' });
  });
  it('a technician with NO grants (grant-only port) selects NOTHING; the same user as OWNER keeps the documented fail-open', async () => {
    const svc = new BranchSelectionService(grantsPort({}));
    expect(await svc.list(tech('nobody'))).toEqual([]);
    await expect(svc.selectBranch(tech('nobody'), 'A')).rejects.toMatchObject({ code: 'branch_not_found' });
    expect((await svc.list(tech('nobody', 'OWNER'))).map((b) => b.id)).toEqual(['A', 'B', 'C']);
  });
  it('a lookup ERROR is a closed door for a technician (and still an open one for an owner)', async () => {
    const broken: any = { async branchesForTenant() { return all; }, async branchIdsForUser() { throw new Error('db down'); } };
    expect(await new BranchSelectionService(broken).list(tech('u'))).toEqual([]);
    expect((await new BranchSelectionService(broken).list(tech('u', 'OWNER'))).length).toBe(3);
    const brokenScope: any = { async branchesForTenant() { return all; }, async enterableBranchesFor() { throw new Error('db down'); } };
    expect(await new BranchSelectionService(brokenScope).list(tech('u'))).toEqual([]);
  });
  it('"any branch" (null) from the scope port never opens the salon to a technician', async () => {
    const anyPort: any = { async branchesForTenant() { return all; }, async enterableBranchesFor() { return null; } };
    expect(await new BranchSelectionService(anyPort).list(tech('u'))).toEqual([]);
    expect((await new BranchSelectionService(anyPort).list(tech('u', 'MANAGER'))).length).toBe(3);
  });
  it('a port that does not model grants at all gives a technician nothing', async () => {
    const svc = new BranchSelectionService(new InMemoryBranchAccessRepository({ t1: [{ id: 'A', isActive: true }] }));
    expect(await svc.list(tech('u'))).toEqual([]);
    expect((await svc.list(tech('u', 'MANAGER'))).map((b) => b.id)).toEqual(['A']);
  });
  it('technicianEnterableBranches: grants → those; none → home; neither → none (never null)', () => {
    expect(technicianEnterableBranches(['B', 'A', 'A'], 'C')).toEqual(['A', 'B']);
    expect(technicianEnterableBranches([], 'C')).toEqual(['C']);
    expect(technicianEnterableBranches([], null)).toEqual([]);
  });
});
