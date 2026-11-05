/**
 * invite-user-core.spec.ts — secure Invite User workflow (§10). DB-free: audit() is a no-op and the repo is faked, so
 * this verifies the backend guardrails — valid email + name, role must be invitable (CUSTOMER cannot be invited), a
 * tenant role requires a tenantId while a Super Admin must not be tenant-scoped, and a duplicate email is rejected.
 * The actual user insert + temp-password mint is a repo concern exercised against live Postgres.
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io' };
const repo = (emailTaken: boolean) => ({
  async emailExists() { return emailTaken; },
  async inviteUser() { return { id: 'u-new', temporaryPassword: 'Tmp-ABCD1234' }; },
}) as any;
const GOOD = { email: 'New.Manager@Salon.com', fullName: 'New Manager', role: 'MANAGER', tenantId: 'tenant-1' };

async function main(): Promise<void> {
  console.log('\n== a valid tenant-role invite returns a one-time temp password ==');
  {
    const svc = new SuperAdminPlatformService(repo(false));
    const res: any = await svc.inviteUser(CTX, GOOD);
    check('returns id + normalised email + role + temp password', res.id === 'u-new' && res.email === 'new.manager@salon.com' && res.role === 'MANAGER' && res.temporaryPassword === 'Tmp-ABCD1234');
  }
  console.log('\n== a platform Super Admin invite needs no tenant ==');
  {
    const svc = new SuperAdminPlatformService(repo(false));
    const res: any = await svc.inviteUser(CTX, { email: 'sa2@aipowersalon.io', fullName: 'Second Admin', role: 'SUPER_ADMIN' });
    check('super admin invite ok with no tenant', res.role === 'SUPER_ADMIN' && res.id === 'u-new');
  }

  console.log('\n== guardrails ==');
  {
    const svc = new SuperAdminPlatformService(repo(false));
    await throwsAsync('rejects invalid email', () => svc.inviteUser(CTX, { ...GOOD, email: 'nope' }), 'invalid');
    await throwsAsync('rejects short name', () => svc.inviteUser(CTX, { ...GOOD, fullName: 'X' }), 'invalid');
    await throwsAsync('rejects unknown role', () => svc.inviteUser(CTX, { ...GOOD, role: 'WIZARD' }), 'invalid');
    await throwsAsync('rejects inviting a CUSTOMER as a user', () => svc.inviteUser(CTX, { ...GOOD, role: 'CUSTOMER' }), 'invalid');
    await throwsAsync('rejects a tenant role with no tenant', () => svc.inviteUser(CTX, { ...GOOD, tenantId: '' }), 'invalid');
    await throwsAsync('rejects a Super Admin scoped to a tenant', () => svc.inviteUser(CTX, { email: 'x@y.com', fullName: 'X Y', role: 'SUPER_ADMIN', tenantId: 'tenant-1' }), 'invalid');
    await throwsAsync('rejects missing auth context', () => svc.inviteUser({}, GOOD), 'invalid');
  }

  console.log('\n== duplicate email ==');
  {
    const dup = new SuperAdminPlatformService(repo(true));
    await throwsAsync('rejects an email that already exists', () => dup.inviteUser(CTX, GOOD), 'invalid');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
