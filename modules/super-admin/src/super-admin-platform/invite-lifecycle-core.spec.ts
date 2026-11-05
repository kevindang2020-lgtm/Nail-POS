/**
 * invite-lifecycle-core.spec.ts — resend / cancel invite (§10). DB-free: audit() is a no-op and the repo is faked, so
 * this verifies the guardrails — both actions require auth context, require the account to still be 'invited', surface
 * not_found for a missing user; resend returns a fresh one-time temp password, cancel moves the account to 'inactive'.
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io' };
const repo = (user: any, statusOk = true) => ({
  async userById() { return user; },
  async resetUserPassword() { return user ? { email: user.email, temporaryPassword: 'Tmp-RESEND12' } : null; },
  async setUserStatus() { return statusOk; },
}) as any;
const invited = { id: 'u1', email: 'pending@salon.com', status: 'invited' };
const active = { id: 'u2', email: 'live@salon.com', status: 'active' };

async function main(): Promise<void> {
  console.log('\n== resend a pending invite ==');
  {
    const svc = new SuperAdminPlatformService(repo(invited));
    const res: any = await svc.resendInvite(CTX, 'u1');
    check('returns email + fresh temp password', res.email === 'pending@salon.com' && res.temporaryPassword === 'Tmp-RESEND12');
  }
  console.log('\n== cancel a pending invite ==');
  {
    const svc = new SuperAdminPlatformService(repo(invited));
    const res: any = await svc.cancelInvite(CTX, 'u1');
    check('moves the invite to inactive', res.id === 'u1' && res.status === 'inactive');
  }
  console.log('\n== only a pending invite is actionable ==');
  {
    const svc = new SuperAdminPlatformService(repo(active));
    await throwsAsync('resend rejects a non-invited account', () => svc.resendInvite(CTX, 'u2'), 'invalid');
    await throwsAsync('cancel rejects a non-invited account', () => svc.cancelInvite(CTX, 'u2'), 'invalid');
  }
  console.log('\n== guardrails ==');
  {
    const svc = new SuperAdminPlatformService(repo(invited));
    await throwsAsync('resend rejects missing auth context', () => svc.resendInvite({}, 'u1'), 'invalid');
    await throwsAsync('cancel rejects missing auth context', () => svc.cancelInvite({}, 'u1'), 'invalid');
    const missing = new SuperAdminPlatformService(repo(null));
    await throwsAsync('resend surfaces not_found', () => missing.resendInvite(CTX, 'ghost'), 'not_found');
    await throwsAsync('cancel surfaces not_found', () => missing.cancelInvite(CTX, 'ghost'), 'not_found');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
