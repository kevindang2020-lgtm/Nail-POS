/**
 * invite-lifecycle-core.spec.ts — resend / cancel invite (§10). DB-free: audit() is a no-op and the repo is faked, so
 * this verifies the guardrails — both actions require auth context, require the account to still be 'invited', surface
 * not_found for a missing user; cancel moves the account to 'inactive'. Security Deep Scan C2 / A3 (Oct 23 2026): resend
 * DELIVERS a fresh temporary password to the invitee (email / SMS) and returns only the channel + a masked destination —
 * on the old code the password itself came back to the caller — and a platform account above the caller is refused.
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

import { platformPermissionsFor } from '@aipowersalon/permissions';
const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io', permissions: platformPermissionsFor('PLATFORM_ADMIN') as string[] };
const repo = (user: any, statusOk = true) => ({
  async userById() { return user; },
  async setUserStatus() { return statusOk; },
}) as any;
const sent: any[] = [];
const delivery = { async deliverTemporaryPassword(t: any, m: any, c: any) { sent.push({ t, m, c }); return { ok: true as const, delivery: 'email' as const, sentTo: 'p***@salon.com', expiresAt: '2026-10-23T13:00:00.000Z' }; } };
const svcWith = (r: any) => new SuperAdminPlatformService(r, undefined, undefined, undefined, undefined, delivery);
const invited = { id: 'u1', email: 'pending@salon.com', status: 'invited', role: 'MANAGER' };
const active = { id: 'u2', email: 'live@salon.com', status: 'active', role: 'MANAGER' };
const invitedTopAdmin = { id: 'u3', email: 'top@aipowersalon.io', status: 'invited', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN' };

async function main(): Promise<void> {
  console.log('\n== resend a pending invite ==');
  {
    const svc = svcWith(repo(invited));
    const res: any = await svc.resendInvite(CTX, 'u1');
    check('delivered to the invitee\'s own email', sent.at(-1)?.t?.email === 'pending@salon.com' && sent.at(-1)?.c === 'invite_resend');
    check('returns the channel + masked destination, NEVER the password (C2)', res.delivery === 'email' && res.sentTo === 'p***@salon.com' && !('temporaryPassword' in res));
    await throwsAsync('no delivery port → refused, nothing returned', () => new SuperAdminPlatformService(repo(invited)).resendInvite(CTX, 'u1'), 'unavailable');
    await throwsAsync('a platform account above the caller is refused (A3)', () => svcWith(repo(invitedTopAdmin)).resendInvite(CTX, 'u3'), 'forbidden');
  }
  console.log('\n== cancel a pending invite ==');
  {
    const svc = new SuperAdminPlatformService(repo(invited));
    const res: any = await svc.cancelInvite(CTX, 'u1');
    check('moves the invite to inactive', res.id === 'u1' && res.status === 'inactive');
  }
  console.log('\n== only a pending invite is actionable ==');
  {
    const svc = svcWith(repo(active));
    await throwsAsync('resend rejects a non-invited account', () => svc.resendInvite(CTX, 'u2'), 'invalid');
    await throwsAsync('cancel rejects a non-invited account', () => svc.cancelInvite(CTX, 'u2'), 'invalid');
  }
  console.log('\n== guardrails ==');
  {
    const svc = new SuperAdminPlatformService(repo(invited));
    await throwsAsync('resend rejects missing auth context', () => svc.resendInvite({}, 'u1'), 'invalid');
    await throwsAsync('cancel rejects missing auth context', () => svc.cancelInvite({}, 'u1'), 'invalid');
    const missing = svcWith(repo(null));
    await throwsAsync('resend surfaces not_found', () => missing.resendInvite(CTX, 'ghost'), 'not_found');
    await throwsAsync('cancel surfaces not_found', () => missing.cancelInvite(CTX, 'ghost'), 'not_found');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
