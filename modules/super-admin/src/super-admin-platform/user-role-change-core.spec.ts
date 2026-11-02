/**
 * user-role-change-core.spec.ts — gated role change (§15 "Change Role"). DB-free: audit() is a no-op and the repo is
 * faked, so this verifies the guardrails — role must be a known role (CUSTOMER excluded), you cannot change your own
 * role, a same-role no-op is rejected, and a missing user surfaces not_found. The actual update + before/after read is
 * a repo concern run against live Postgres.
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io' };
const writes: string[] = [];
const repo = (before: string | null, otherOwners = 1) => ({
  async userForRoleChange(_id: string) { return before === null ? null : { role: before, tenantId: 't1' }; },
  async otherActiveOwnerCount() { return otherOwners; },
  async setUserRole(id: string, role: string) { writes.push(`${id}:${role}`); return before === null ? null : { before }; },
}) as any;

async function main(): Promise<void> {
  console.log('\n== a valid role change returns before/after and is reportable ==');
  {
    const svc = new SuperAdminPlatformService(repo('FRONT_DESK'));
    const res: any = await svc.setUserRole(CTX, 'u1', 'MANAGER');
    check('returns id + before + after', res.id === 'u1' && res.before === 'FRONT_DESK' && res.after === 'MANAGER');
  }
  console.log('\n== guardrails ==');
  {
    const svc = new SuperAdminPlatformService(repo('FRONT_DESK'));
    await throwsAsync('rejects an unknown role', () => svc.setUserRole(CTX, 'u1', 'WIZARD'), 'invalid');
    await throwsAsync('rejects CUSTOMER as a target role', () => svc.setUserRole(CTX, 'u1', 'CUSTOMER'), 'invalid');
    await throwsAsync('rejects changing your own role', () => svc.setUserRole(CTX, 'sa-1', 'OWNER'), 'invalid');
    await throwsAsync('rejects missing auth context', () => svc.setUserRole({}, 'u1', 'OWNER'), 'invalid');
  }
  console.log('\n== the platform plane is not reachable from here (Oct 6 2026) ==');
  {
    writes.length = 0;
    await throwsAsync('refuses making salon staff a SUPER_ADMIN', () => new SuperAdminPlatformService(repo('FRONT_DESK')).setUserRole(CTX, 'u1', 'SUPER_ADMIN'), 'forbidden');
    await throwsAsync('refuses moving a platform account to a salon role', () => new SuperAdminPlatformService(repo('SUPER_ADMIN')).setUserRole(CTX, 'u2', 'OWNER'), 'forbidden');
    await throwsAsync('refuses demoting a salon\'s ONLY owner (BUILD_PLAN Phase 9: 409 LAST_OWNER)', () => new SuperAdminPlatformService(repo('OWNER', 0)).setUserRole(CTX, 'u3', 'MANAGER'), 'conflict');
    check('nothing was written by a refused change', writes.length === 0);
    await new SuperAdminPlatformService(repo('OWNER', 1)).setUserRole(CTX, 'u4', 'MANAGER');
    check('an owner with a co-owner can be changed', writes.includes('u4:MANAGER'));
  }
  console.log('\n== no-op + missing ==');
  {
    writes.length = 0;
    const same = new SuperAdminPlatformService(repo('MANAGER'));
    await throwsAsync('rejects a same-role no-op', () => same.setUserRole(CTX, 'u1', 'MANAGER'), 'invalid');
    check('a same-role no-op is refused BEFORE writing', writes.length === 0);
    const missing = new SuperAdminPlatformService(repo(null));
    await throwsAsync('surfaces not_found when the user is missing', () => missing.setUserRole(CTX, 'ghost', 'OWNER'), 'not_found');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
