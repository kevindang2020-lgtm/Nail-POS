/**
 * invite-user-core.spec.ts — secure Invite User workflow (§10). DB-free: audit() is a no-op and the repo is faked, so
 * this verifies the backend guardrails — valid email + name, role must be invitable (CUSTOMER cannot be invited), a
 * tenant role requires a tenantId while a Super Admin must not be tenant-scoped, and a duplicate email is rejected.
 * Security Deep Scan C3 (Oct 23 2026): the invite is now the secure token invitation (createInvitation) — no temporary
 * password is ever returned to the caller, and a platform (SUPER_ADMIN) invite needs platform_roles.manage plus a named
 * platform role within the inviter's own permissions. On the old code these cases fail (a temp password came back, and a
 * SUPER_ADMIN account was minted with no platform role and only users.manage).
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

import { platformPermissionsFor } from '@aipowersalon/permissions';
const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io' };
const TOP = { ...CTX, permissions: platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[] };
const ADMIN = { ...CTX, permissions: platformPermissionsFor('PLATFORM_ADMIN') as string[] };
const created: any[] = [];
const repo = (emailTaken: boolean) => ({
  async emailExists() { return emailTaken; },
  async phoneExists() { return false; },
  async createInvitation(input: any) { created.push(input); return { id: 'inv-new', userId: null, token: 'raw-token', tokenPrefix: 'raw-', expiresAt: '2026-11-01T00:00:00.000Z', reused: false }; },
  async setInvitationDelivery() { /* recorded */ },
}) as any;
const GOOD = { email: 'New.Manager@Salon.com', fullName: 'New Manager', role: 'MANAGER', tenantId: 'tenant-1' };

async function main(): Promise<void> {
  console.log('\n== a valid tenant-role invite becomes a token invitation — never a password ==');
  {
    const svc = new SuperAdminPlatformService(repo(false));
    const res: any = await svc.inviteUser(CTX, GOOD);
    check('returns the invitation id + normalised email + role', res.id === 'inv-new' && res.email === 'new.manager@salon.com' && res.role === 'MANAGER');
    check('NO temporary password is returned to the caller (C3)', !('temporaryPassword' in res) && !JSON.stringify(res).includes('Tmp-'));
    check('created through createInvitation (no platform role for a salon role)', created.at(-1)?.role === 'MANAGER' && created.at(-1)?.platformRole === null);
  }
  console.log('\n== a platform account invite: platform_roles.manage + a named role within the ceiling (C3) ==');
  {
    const svc = new SuperAdminPlatformService(repo(false));
    await throwsAsync('refused without platform_roles.manage (users.manage alone is not enough)', () => svc.inviteUser(ADMIN, { email: 'sa2@aipowersalon.io', fullName: 'Second Admin', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT' }), 'forbidden');
    await throwsAsync('refused with no platform role named', () => svc.inviteUser(TOP, { email: 'sa2@aipowersalon.io', fullName: 'Second Admin', role: 'SUPER_ADMIN' }), 'invalid');
    const res: any = await svc.inviteUser(TOP, { email: 'sa2@aipowersalon.io', fullName: 'Second Admin', role: 'SUPER_ADMIN', platformRole: 'PLATFORM_SUPPORT' });
    check('a top platform admin invites with the named role, no tenant, no password', res.role === 'SUPER_ADMIN' && res.id === 'inv-new' && created.at(-1)?.platformRole === 'PLATFORM_SUPPORT' && !('temporaryPassword' in res));
  }
  console.log('\n== createSuperAdmin is retired (C3) ==');
  {
    const svc = new SuperAdminPlatformService(repo(false));
    await throwsAsync('POST /platform/users answers gone', () => svc.createSuperAdmin(TOP, { email: 'x@y.com', fullName: 'X Y' }), 'gone');
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
