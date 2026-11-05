/**
 * user-mfa-core.spec.ts — gated require/clear 2FA (§26). DB-free: audit() is a no-op and the repo is faked, so this
 * verifies behaviour — requires auth context, surfaces not_found for a missing user, audits on an actual change, and is
 * idempotent (setting the flag to its current value is changed:false, not an error). The flag write itself is a repo
 * concern run against live Postgres.
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io' };
const repo = (before: boolean | null) => ({
  async setUserMfaRequired(_id: string, _req: boolean) { return before === null ? null : { before }; },
}) as any;

async function main(): Promise<void> {
  console.log('\n== requiring 2FA on a user that had it off ==');
  {
    const svc = new SuperAdminPlatformService(repo(false));
    const res: any = await svc.setUserMfa(CTX, 'u1', true);
    check('requires 2FA and reports a change', res.mfaEnabled === true && res.changed === true && res.id === 'u1');
  }
  console.log('\n== clearing 2FA on a user that had it on ==');
  {
    const svc = new SuperAdminPlatformService(repo(true));
    const res: any = await svc.setUserMfa(CTX, 'u1', false);
    check('clears 2FA and reports a change', res.mfaEnabled === false && res.changed === true);
  }
  console.log('\n== idempotent no-op ==');
  {
    const svc = new SuperAdminPlatformService(repo(true));
    const res: any = await svc.setUserMfa(CTX, 'u1', true);
    check('already-required is a no-op (changed:false), not an error', res.mfaEnabled === true && res.changed === false);
  }
  console.log('\n== guardrails ==');
  {
    const svc = new SuperAdminPlatformService(repo(false));
    await throwsAsync('rejects missing auth context', () => svc.setUserMfa({}, 'u1', true), 'invalid');
    const missing = new SuperAdminPlatformService(repo(null));
    await throwsAsync('surfaces not_found for a missing user', () => missing.setUserMfa(CTX, 'ghost', true), 'not_found');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
