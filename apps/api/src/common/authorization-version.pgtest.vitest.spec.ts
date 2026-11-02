// authorization-version.pgtest.vitest.spec.ts — BUILD_PLAN Phase 9 (Constitution 2 §versioning) end to end through the REAL
// request path: TenantContextMiddleware + the RolePermissionGuard decision, against the real schema (PGlite, every
// migration). A change in the database reaches a session that was minted BEFORE it, on its very next request:
//   • a narrowed template → re-authorized for that request from the current grants, x-authorization-changed: 1, and the
//     key the person lost is refused (403 PERMISSION_DENIED with a reason);
//   • a DENY override → refused with reason denied_by_override;
//   • a deactivation → every session of the person is revoked (sessions table) and the request is 401 SESSION_ENDED.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { signSession, AuthorizationStateCache, KyselyAuthorizationStatePort, currentAuthorizationVersions } from '@aipowersalon/identity';
import { RolePermissionGuard } from '@aipowersalon/permissions/guards';
import { permissionsFor } from '@aipowersalon/permissions';
import { TenantContextMiddleware } from './tenant-context.middleware';

const SECRET = 'p9-authz-version-secret';
const T = 'aa900000-0000-4000-8000-0000000000a1';
const B1 = 'bb900000-0000-4000-8000-0000000000b1';
const MGR = 'cc900000-0000-4000-8000-0000000000c2';
const S1 = 'dd900000-0000-4000-8000-0000000000d1', S2 = 'dd900000-0000-4000-8000-0000000000d2';
let pg: any; let db: any; let mw: TenantContextMiddleware; let cache: AuthorizationStateCache;

/** A session store over the real sessions table (the production one is internal to identity). */
const sessionsOf = (k: any) => ({
  async create() { return null; },
  async isRevoked(id: string) { const r: any = (await sql`select status from sessions where id = ${id}`.execute(k)).rows[0]; return !r || String(r.status) === 'revoked'; },
  async revoke(id: string) { await sql`update sessions set status = 'revoked', revoked_at = now() where id = ${id}`.execute(k); },
});

async function call(token: string, key: string | null, path = '/pos/reports/sales') {
  const headers: Record<string, string> = {};
  const req: any = { headers: { authorization: 'Bearer ' + token }, originalUrl: path, url: path, method: 'GET', body: {}, query: {}, route: { path } };
  const res: any = { setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = v; } };
  let nextCalled = false;
  try { await mw.use(req, res, () => { nextCalled = true; }); } catch (e: any) { return { status: e.getStatus?.() ?? 500, body: e.getResponse?.(), headers, req }; }
  if (!nextCalled) return { status: 500, body: 'next not called', headers, req };
  if (key) {
    const handler = () => undefined;
    const g = new RolePermissionGuard({ get: (k: string, h: any) => (k === 'perm' && h === handler ? key : undefined) } as any);
    try { g.canActivate({ getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) } as any); }
    catch (e: any) { return { status: e.getStatus(), body: e.getResponse(), headers, req }; }
  }
  return { status: 200, body: null, headers, req };
}

async function mint(sid: string): Promise<string> {
  const v = await currentAuthorizationVersions(db, MGR, T);
  return signSession({ userId: MGR, tenantId: T, branchId: B1, role: 'MANAGER', permissions: permissionsFor('MANAGER'), subscriptionStatus: 'active', sid, av: v!.av, tv: v!.tv } as any, { secret: SECRET, ttlSeconds: 600 });
}

beforeAll(async () => {
  process.env.AUTH_SESSION_SECRET = SECRET;
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','Ver LLC','Ver','ver-p9','VERP9','active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B1}','${T}','Main','active');
    INSERT INTO users (id, tenant_id, branch_id, email, status, role) VALUES ('${MGR}','${T}','${B1}','m@ver.test','active','MANAGER');
    INSERT INTO sessions (id, user_id, tenant_id, branch_id, status, expires_at) VALUES ('${S1}','${MGR}','${T}','${B1}','active', now() + interval '1 day'), ('${S2}','${MGR}','${T}','${B1}','active', now() + interval '1 day');`);
  cache = new AuthorizationStateCache(new KyselyAuthorizationStatePort(db), 30_000);
  mw = new TenantContextMiddleware(sessionsOf(db) as any, undefined, undefined, null, null, cache);
}, 120_000);

describe('authorization version on the request path', () => {
  it('a fresh session is served from its own grant (no header) and may take payments', async () => {
    const r = await call(await mint(S1), 'checkout.process_payment');
    expect(r.status).toBe(200);
    expect(r.headers['x-authorization-changed']).toBeUndefined();
    expect(r.req.ctx.authz).toMatchObject({ reauthorized: false, scope: 'TENANT' });
  });
  it('the owner narrows the manager to Accountant IN THE DATABASE → the SAME session is re-authorized on its next request', async () => {
    const token = await mint(S1);
    await sql`insert into staff_role_assignments (tenant_id, user_id, template_key) values (${T}, ${MGR}, 'ACCOUNTANT')`.execute(db);
    cache.invalidateUser(MGR);   // in-process invalidation (another instance: within the 30 s cache)
    const r = await call(token, 'checkout.process_payment');
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'PERMISSION_DENIED', reason: 'missing_permission', permission: 'checkout.process_payment' });
    expect(r.headers['x-authorization-changed']).toBe('1');
    const ok = await call(token, 'reports.view');
    expect(ok.status).toBe(200);
    expect(ok.req.ctx.authz).toMatchObject({ reauthorized: true, templateKey: 'ACCOUNTANT' });
  });
  it('without the in-process invalidation the change still lands once the cache entry ages out (≤ 30 s)', async () => {
    const token = await mint(S1);
    const quick = new AuthorizationStateCache(new KyselyAuthorizationStatePort(db), 0);
    const mw2 = new TenantContextMiddleware(sessionsOf(db) as any, undefined, undefined, null, null, quick);
    await sql`insert into tenant_user_permission_overrides (tenant_id, user_id, permission, effect, reason, granted_by_user_id) values (${T}, ${MGR}, 'reports.view', 'DENY', 'audit', ${MGR})`.execute(db);
    const prev = mw; mw = mw2;
    try {
      const r = await call(token, 'pos.reports.view');
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ reason: 'denied_by_override', permission: 'pos.reports.view' });
    } finally { mw = prev; }
    await sql`update tenant_user_permission_overrides set revoked_at = now() where user_id = ${MGR}`.execute(db);
  });
  it('a deactivation revokes EVERY session of the person and the request is 401 SESSION_ENDED', async () => {
    const token = await mint(S1);
    await sql`update users set status = 'inactive' where id = ${MGR}`.execute(db);
    cache.invalidateUser(MGR);
    const r = await call(token, 'reports.view');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ code: 'SESSION_ENDED', reason: 'account_inactive' });
    const rows: any[] = (await sql`select status from sessions where user_id = ${MGR}`.execute(db)).rows;
    expect(rows.map((x) => x.status)).toEqual(['revoked', 'revoked']);
    const again = await call(token, null);
    expect(again.status).toBe(401);   // revoked at the session check now
  });
});
