/**
 * session-revocation-core.spec.ts — session oversight + revocation (§27). DB-free: audit() is a no-op and the repo is
 * faked, so this verifies the service behaviour — list passes through, single-revoke requires a sessionId and surfaces
 * not_found when nothing live matched, revoke-all reports the count, and both writes require auth context. The actual
 * sessions/refresh_tokens updates are a repo concern run against live Postgres.
 */
import { SuperAdminPlatformService, PlatformError } from './super-admin-platform.service';

let pass = 0, fail = 0;
function check(name: string, cond: boolean): void { if (cond) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name); } }
async function throwsAsync(name: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); check(name, false); }
  catch (e: any) { check(name, e instanceof PlatformError && (!code || e.code === code)); }
}

const CTX = { userId: 'sa-1', email: 'admin@aipowersalon.io' };
// Security Deep Scan A3: revoke-all reads the target first — a platform account at or above the caller is refused
const USERS: Record<string, any> = { u1: { id: 'u1', role: 'MANAGER' }, top: { id: 'top', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN' } };
const repo = (sessions: any[], revokeResult: any, allCount = 0) => ({
  async userById(id: string) { return USERS[id] ?? null; },
  async userActiveSessions() { return sessions; },
  async revokeSession() { return revokeResult; },
  async revokeAllUserSessions() { return { count: allCount }; },
}) as any;

async function main(): Promise<void> {
  console.log('\n== list a user\'s active sessions ==');
  {
    const svc = new SuperAdminPlatformService(repo([{ id: 's1', deviceId: 'iPad', ipAddress: '10.0.0.2' }], { userId: 'u1' }));
    const res: any = await svc.userSessions('u1');
    check('returns the active sessions', Array.isArray(res) && res.length === 1 && res[0].id === 's1');
    await throwsAsync('list rejects missing userId', () => Promise.resolve().then(() => svc.userSessions('')), 'invalid');
  }
  console.log('\n== revoke a single session ==');
  {
    const svc = new SuperAdminPlatformService(repo([], { userId: 'u1' }));
    const res: any = await svc.revokeSession(CTX, 's1');
    check('revokes and reports', res.sessionId === 's1' && res.revoked === true);
    await throwsAsync('revoke rejects missing sessionId', () => svc.revokeSession(CTX, ''), 'invalid');
    await throwsAsync('revoke rejects missing auth context', () => svc.revokeSession({}, 's1'), 'invalid');
  }
  console.log('\n== no live session matched ==');
  {
    const svc = new SuperAdminPlatformService(repo([], null));
    await throwsAsync('surfaces not_found when nothing live matched', () => svc.revokeSession(CTX, 'gone'), 'not_found');
  }
  console.log('\n== revoke all sessions for a user ==');
  {
    const svc = new SuperAdminPlatformService(repo([], { userId: 'u1' }, 3));
    const res: any = await svc.revokeAllUserSessions(CTX, 'u1');
    check('reports how many were revoked', res.userId === 'u1' && res.revoked === 3);
    await throwsAsync('revoke-all rejects missing auth context', () => svc.revokeAllUserSessions({}, 'u1'), 'invalid');
    await throwsAsync('revoke-all rejects missing userId', () => svc.revokeAllUserSessions(CTX, ''), 'invalid');
    await throwsAsync('revoke-all refuses a platform account at or above the caller (A3)', () => svc.revokeAllUserSessions(CTX, 'top'), 'forbidden');
  }

  console.log(`\n──────────── ${pass}/${pass + fail} passed ────────────\n`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
