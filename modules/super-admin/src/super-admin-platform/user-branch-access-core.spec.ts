/**
 * user-branch-access-core.spec.ts — gated branch-access assign/revoke (§15/§36). DB-free: audit() is a no-op and the
 * repo is faked, so this verifies the guardrails — both actions require an active support session for the tenant, a
 * reason, and the core ids; assign additionally constrains access_level and surfaces not_found when the repo reports
 * the user/branch don't belong to the tenant. The actual upsert/delete is a repo concern run against live Postgres.
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io' };
const T = 'tenant-1';
const activeSession = { id: 'sess-1', tenant_id: T, ended_at: null, expires_at: new Date(Date.now() + 3600_000).toISOString() };
const repo = (sessions: any[], assignResult: any, removed = 1) => ({
  async supportSessions(active: boolean) { return active ? sessions.filter((s) => !s.ended_at && new Date(s.expires_at).getTime() > Date.now()) : sessions.slice(); },
  async assignUserBranch() { return assignResult; },
  async revokeUserBranch() { return { removed }; },
}) as any;
const GOOD = { sessionId: 'sess-1', tenantId: T, userId: 'u1', branchId: 'b1', accessLevel: 'manager', reason: 'assigning branch access for support' };

async function main(): Promise<void> {
  console.log('\n== assign inside an active session ==');
  {
    const svc = new SuperAdminPlatformService(repo([activeSession], { ok: true }));
    const res: any = await svc.assignUserBranch(CTX, GOOD);
    check('assign returns ok + scope', res.ok === true && res.userId === 'u1' && res.branchId === 'b1' && res.accessLevel === 'manager');
  }
  console.log('\n== revoke inside an active session ==');
  {
    const svc = new SuperAdminPlatformService(repo([activeSession], { ok: true }, 1));
    const res: any = await svc.revokeUserBranch(CTX, { sessionId: 'sess-1', tenantId: T, userId: 'u1', branchId: 'b1', reason: 'removing stale branch access' });
    check('revoke returns removed count', res.ok === true && res.removed === 1);
  }

  console.log('\n== guardrails ==');
  {
    const svc = new SuperAdminPlatformService(repo([activeSession], { ok: true }));
    await throwsAsync('assign rejects bad access level', () => svc.assignUserBranch(CTX, { ...GOOD, accessLevel: 'god' }), 'invalid');
    await throwsAsync('assign rejects short reason', () => svc.assignUserBranch(CTX, { ...GOOD, reason: 'x' }), 'invalid');
    await throwsAsync('assign rejects missing branchId', () => svc.assignUserBranch(CTX, { ...GOOD, branchId: '' }), 'invalid');
    await throwsAsync('assign rejects missing sessionId', () => svc.assignUserBranch(CTX, { ...GOOD, sessionId: '' }), 'invalid');
    await throwsAsync('assign rejects tenant mismatch', () => svc.assignUserBranch(CTX, { ...GOOD, tenantId: 'other' }), 'invalid');
    await throwsAsync('assign rejects missing auth context', () => svc.assignUserBranch({}, GOOD), 'invalid');
    await throwsAsync('revoke rejects short reason', () => svc.revokeUserBranch(CTX, { ...GOOD, reason: '' }), 'invalid');
  }

  console.log('\n== no session / not in tenant ==');
  {
    const noSess = new SuperAdminPlatformService(repo([], { ok: true }));
    await throwsAsync('assign rejects when no active session', () => noSess.assignUserBranch(CTX, GOOD), 'not_found');
    const notInTenant = new SuperAdminPlatformService(repo([activeSession], null));
    await throwsAsync('assign surfaces not_found when user/branch not in tenant', () => notInTenant.assignUserBranch(CTX, GOOD), 'not_found');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
