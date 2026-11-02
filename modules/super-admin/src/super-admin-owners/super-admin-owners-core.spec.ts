// super-admin-owners-core.spec.ts — Nest-free harness for SuperAdminOwnersService (now extracted from the module so it can
// be tested). A tiny Kysely-shaped fake returns canned rows keyed by table name, exercising the owner-resolution guards and
// the branch-assignment guards — most importantly the WITHIN-TENANT rule: a branch may be assigned to an owner only when it
// belongs to that owner's tenant; a branch from a different salon business is rejected. esbuild + node, ok() style.
import { SuperAdminOwnersService, SuperAdminOwnersError } from './super-admin-owners.service';

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; console.error('FAIL:', n); } };
async function throwsCode(name: string, fn: () => Promise<unknown>, code: string) {
  try { await fn(); ok(name, false); } catch (e: any) { ok(name, e instanceof SuperAdminOwnersError && e.code === code); }
}

// A minimal stand-in for the Kysely query builder. Every chainable method returns the same node; terminals resolve to the
// canned value for the table named in selectFrom (first word, so 'users as u' -> 'users'). Writes resolve to no-ops.
function chain(result: any) {
  const c: any = {
    select: () => c, leftJoin: () => c, innerJoin: () => c, where: () => c, orderBy: () => c, groupBy: () => c,
    limit: () => c, onConflict: () => c, returning: () => c, set: () => c, values: () => c,
    execute: async () => (Array.isArray(result) ? result : []),
    executeTakeFirst: async () => result,
    executeTakeFirstOrThrow: async () => { if (result == null) throw new Error('no row'); return result; },
  };
  return c;
}
function makeDb(canned: Record<string, any>) {
  const key = (t: string) => String(t).split(' ')[0];
  const db: any = {
    selectFrom: (t: string) => chain(canned[key(t)]),
    insertInto: (t: string) => chain(canned[key(t)] ?? { id: 'new-id' }),
    updateTable: () => chain(undefined),
    deleteFrom: () => chain({ numDeletedRows: 1 }),
    transaction: () => ({ execute: async (cb: any) => cb(db) }),
    fn: { countAll: () => ({ as: () => 'c' }) },
  };
  return db;
}
const svc = (canned: Record<string, any>) => new SuperAdminOwnersService(makeDb(canned) as any);
const OWNER_A = { id: 'owner-1', tenant_id: 'tenantA', full_name: 'Olivia', email: 'o@x.com', status: 'active' };

(async () => {
  // ---- owner resolution ----
  await throwsCode('an unknown owner is not_found', () => svc({ users: undefined }).getOwner('owner-1'), 'not_found');
  await throwsCode('an owner with no tenant is invalid', () => svc({ users: { ...OWNER_A, tenant_id: null } }).getOwner('owner-1'), 'invalid');

  // ---- createSalon ----
  await throwsCode('createSalon requires a salon name', () => svc({ users: OWNER_A }).createSalon('admin', 'owner-1', { name: '   ' }), 'invalid');

  // ---- assignBranch ----
  await throwsCode('assignBranch requires a branchId', () => svc({ users: OWNER_A }).assignBranch('admin', 'owner-1', {}), 'invalid');
  await throwsCode('assignBranch 404s an unknown branch', () => svc({ users: OWNER_A, branches: undefined }).assignBranch('admin', 'owner-1', { branchId: 'br1' }), 'not_found');
  await throwsCode('assignBranch REJECTS a branch from another salon business', () => svc({ users: OWNER_A, branches: { id: 'br1', tenant_id: 'tenantB' } }).assignBranch('admin', 'owner-1', { branchId: 'br1' }), 'invalid');
  {
    // same-tenant branch passes the cross-tenant guard and completes (getOwner returns the refreshed owner view)
    const out = await svc({ users: OWNER_A, branches: { id: 'br1', tenant_id: 'tenantA' }, user_branch_access: [] }).assignBranch('admin', 'owner-1', { branchId: 'br1' });
    ok('assignBranch allows a branch within the owner\'s tenant', (out as any).ownerId === 'owner-1' && (out as any).tenantId === 'tenantA');
  }

  // ---- updateBranch ----
  await throwsCode('updateBranch 404s when the owner is not assigned to the branch', () => svc({ users: OWNER_A, user_branch_access: undefined }).updateBranch('admin', 'owner-1', 'br1', { accessLevel: 'manager' }), 'not_found');
  await throwsCode('updateBranch rejects an invalid access level', () => svc({ users: OWNER_A, user_branch_access: { id: 'acc1' } }).updateBranch('admin', 'owner-1', 'br1', { accessLevel: 'super-duper' }), 'invalid');
  {
    // a valid access level on an existing assignment completes (returns the getOwner view)
    const out = await svc({ users: OWNER_A, user_branch_access: { id: 'acc1' }, branches: undefined }).updateBranch('admin', 'owner-1', 'br1', { accessLevel: 'manager' });
    ok('updateBranch accepts a valid access level', (out as any).ownerId === 'owner-1');
  }

  // ---- branch switch PIN ----
  await throwsCode('setBranchPin 404s when the owner is not assigned to the salon', () => svc({ users: OWNER_A, user_branch_access: undefined }).setBranchPin('admin', 'owner-1', 'br1', '123456'), 'not_found');
  await throwsCode('setBranchPin rejects a non-6-digit PIN', () => svc({ users: OWNER_A, user_branch_access: { id: 'acc1' } }).setBranchPin('admin', 'owner-1', 'br1', '123'), 'invalid');
  await throwsCode('setBranchPin rejects a non-numeric PIN', () => svc({ users: OWNER_A, user_branch_access: { id: 'acc1' } }).setBranchPin('admin', 'owner-1', 'br1', 'abcdef'), 'invalid');
  {
    // a valid 6-digit PIN on an assigned salon completes; getOwner surfaces hasSwitchPin (never the hash)
    const assigned = [{ branch_id: 'br1', branch_name: 'Downtown', access_level: 'owner', is_primary_owner: true, switch_pin_hash: 'scrypt$x' }];
    const out: any = await svc({ users: OWNER_A, user_branch_access: assigned, branches: [{ id: 'br1', name: 'Downtown', status: 'active' }] }).setBranchPin('admin', 'owner-1', 'br1', '430271');
    ok('setBranchPin accepts a valid 6-digit PIN', out.ownerId === 'owner-1');
    ok('getOwner exposes hasSwitchPin (boolean), not the hash', out.assignedBranches[0].hasSwitchPin === true && !('switch_pin_hash' in out.assignedBranches[0]));
    ok('getOwner flags a multi-salon owner only with >1 salon', out.isMultiSalon === false);
  }
  await throwsCode('clearBranchPin 404s when the owner is not assigned', () => svc({ users: OWNER_A, user_branch_access: undefined }).clearBranchPin('admin', 'owner-1', 'br1'), 'not_found');
  await throwsCode('createSalon rejects a bad switch PIN', () => svc({ users: OWNER_A }).createSalon('admin', 'owner-1', { name: 'New Salon', switchPin: '12' }), 'invalid');
  {
    // createSalon with a valid PIN completes (PIN hashed into the branches insert)
    const out: any = await svc({ users: OWNER_A, user_branch_access: [], branches: { id: 'new-id' } }).createSalon('admin', 'owner-1', { name: 'Uptown', switchPin: '518602' });
    ok('createSalon accepts a valid switch PIN', out.ownerId === 'owner-1');
  }

  console.log(`\nsuper-admin-owners-core: ${pass}/${pass + fail} passed` + (fail ? ` (${fail} FAILED)` : ' OK'));
  if (fail) process.exit(1);
})();
