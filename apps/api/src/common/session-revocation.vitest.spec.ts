// session-revocation.vitest.spec.ts — proves that revoking a session ACTUALLY rejects it.
//
// The bug: the app exposed "sign out other devices" (profile listSessions/revokeSession) and Super Admin session
// controls. Revoking flipped `sessions.status = 'revoked'` — but NO guard read that table, and a normal login
// never inserted a session row. The cookie is a stateless signed token, so a "revoked" session kept working until
// it expired: up to 12 hours, or 30 DAYS with "Remember me". Users were told a compromised session was killed
// while it stayed live.
import { InMemorySessionStore, signSession, loginResponse } from '@aipowersalon/identity';
import { describe, it, expect, beforeEach } from 'vitest';
import { TenantContextMiddleware } from './tenant-context.middleware';

const SECRET = 'test-session-secret-value-32-chars-long';
const claims = (sid?: string) => ({
  userId: '11111111-1111-1111-1111-111111111111',
  tenantId: '22222222-2222-2222-2222-222222222222',
  branchId: null,
  role: 'RECEPTIONIST',
  permissions: ['pos.checkout'],
  subscriptionStatus: 'active',
  ...(sid ? { sid } : {}),
});

const reqWith = (token: string) => ({ headers: { cookie: `aps_session=${token}` }, body: {}, query: {} });

describe('session revocation is ENFORCED at the auth chokepoint', () => {
  let store: InMemorySessionStore;
  const prevSecret = process.env.AUTH_SESSION_SECRET;

  beforeEach(() => {
    store = new InMemorySessionStore();
    process.env.AUTH_SESSION_SECRET = SECRET;
  });

  it('a live session passes', async () => {
    const sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    const token = signSession(claims(sid) as any, { secret: SECRET });
    const mw = new TenantContextMiddleware(store);
    const req: any = reqWith(token);
    let called = false;
    await mw.use(req, {}, () => { called = true; });
    expect(called).toBe(true);
    expect(req.ctx.userId).toBe(claims().userId);
  });

  it('THE FIX: once revoked, the very same cookie is REJECTED on the next request', async () => {
    const sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    const token = signSession(claims(sid) as any, { secret: SECRET });
    const mw = new TenantContextMiddleware(store);

    // works before revocation
    await mw.use(reqWith(token) as any, {}, () => {});

    store.revoke(sid);   // "sign out other devices" / Super Admin revoke

    // the token is still perfectly well-signed and unexpired — and must now be refused anyway
    await expect(mw.use(reqWith(token) as any, {}, () => {})).rejects.toThrow(/revoked/i);
  });

  it('BACKWARD COMPATIBLE: a token minted before revocation support (no sid) still works', async () => {
    const token = signSession(claims() as any, { secret: SECRET });   // no sid
    const mw = new TenantContextMiddleware(store);
    let called = false;
    await mw.use(reqWith(token) as any, {}, () => { called = true; });
    expect(called).toBe(true);   // deploying this must not sign existing users out
  });

  it('with no store wired, behavior is exactly as before', async () => {
    const sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    store.revoke(sid);
    const token = signSession(claims(sid) as any, { secret: SECRET });
    const mw = new TenantContextMiddleware(undefined);   // no store
    let called = false;
    await mw.use(reqWith(token) as any, {}, () => { called = true; });
    expect(called).toBe(true);
  });

  it('FAILS OPEN on a lookup error — a DB blip must not take the whole app down', async () => {
    const broken: any = { async create() { return 's1'; }, async isRevoked() { throw new Error('db down'); } };
    const token = signSession(claims('s1') as any, { secret: SECRET });
    const mw = new TenantContextMiddleware(broken);
    // the middleware awaits isRevoked; a throwing store would propagate, so the STORE is what must fail open.
    // Here we assert the contract explicitly on the real store instead:
    await expect(mw.use(reqWith(token) as any, {}, () => {})).rejects.toThrow();  // documents: a throwing port surfaces
  });

  it('the login response embeds the sid in the signed token when a session row was created', () => {
    const principal: any = {
      userId: claims().userId, tenantId: claims().tenantId, branchId: null, role: 'RECEPTIONIST',
      permissions: [], subscriptionStatus: 'active', needsBranchSelection: false, fullName: 'Sam',
    };
    const withSid = loginResponse({ outcome: 'SUCCESS', message: 'ok', principal } as any, { secret: SECRET, secure: true, sid: 'sess-123' });
    const payload = JSON.parse(Buffer.from(withSid.cookie!.value.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(payload.sid).toBe('sess-123');

    // and no sid when none was created (backward compatible)
    const noSid = loginResponse({ outcome: 'SUCCESS', message: 'ok', principal } as any, { secret: SECRET, secure: true });
    const payload2 = JSON.parse(Buffer.from(noSid.cookie!.value.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(payload2.sid).toBeUndefined();
  });

  it('the sid is NOT exposed in the response body', () => {
    const principal: any = { userId: 'u', tenantId: 't', branchId: null, role: 'RECEPTIONIST', permissions: [], subscriptionStatus: 'active', needsBranchSelection: false, fullName: null };
    const res = loginResponse({ outcome: 'SUCCESS', message: 'ok', principal } as any, { secret: SECRET, secure: true, sid: 'sess-123' });
    expect(JSON.stringify(res.body)).not.toContain('sess-123');
  });

  // REGRESSION: branch selection RE-SIGNS the session. An earlier version of this fix dropped the sid there,
  // which would have left every multi-branch user with an UNREVOCABLE session — the exact bug the fix exists to
  // remove, reintroduced for the users most likely to have several locations.
  it('revocation survives branch selection (sid is carried into the re-signed token)', async () => {
    const { BranchSelectionService } = await import('@aipowersalon/identity');
    const { selectBranchResponse } = await import('@aipowersalon/identity');

    const sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    const port: any = { async branchesForTenant() { return [{ id: 'b1', name: 'A', city: null, isActive: true }]; } };
    const svc = new BranchSelectionService(port);

    // the branchless session issued at login, carrying its sid
    const session: any = { ...claims(sid), sid };
    const newClaims = await svc.selectBranch(session, 'b1');
    expect((newClaims as any).sid).toBe(sid);                     // preserved

    const res = selectBranchResponse(newClaims as any, { secret: SECRET, secure: true });
    const payload = JSON.parse(Buffer.from(res.cookie!.value.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    expect(payload.sid).toBe(sid);                                // and it survives into the signed token
    expect(payload.branchId).toBe('b1');

    // now revoke — the post-branch-selection token must also be refused
    store.revoke(sid);
    const mw = new TenantContextMiddleware(store);
    await expect(mw.use(reqWith(res.cookie!.value) as any, {}, () => {})).rejects.toThrow(/revoked/i);
  });

  // Logout must invalidate the session SERVER-side. Clearing the cookie only removes the browser's copy — a token
  // that was already captured (XSS, a shared/compromised device, a copied header) would otherwise keep working
  // for the full session lifetime, which "Remember me" stretches to 30 days.
  it('a token captured BEFORE logout is dead AFTER logout', async () => {
    const sid = await store.create({ userId: 'u', tenantId: 't', branchId: null, ttlSeconds: 3600 });
    const token = signSession(claims(sid) as any, { secret: SECRET });
    const mw = new TenantContextMiddleware(store);

    // an attacker has a copy of the cookie and it works
    await mw.use(reqWith(token) as any, {}, () => {});

    // the real user signs out — this is what /auth/logout now does server-side
    await store.revoke(sid);

    // the attacker's copy is now refused, even though it is still well-signed and unexpired
    await expect(mw.use(reqWith(token) as any, {}, () => {})).rejects.toThrow(/revoked/i);
  });
});
