// platform-lockdown.pgtest — Constitution 12 M13: an active platform lockdown actually stops the platform.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PlatformLockdownGate, revokeAllNonSuperAdminSessions, PLATFORM_LOCKDOWN_CACHE_MS } from './platform-lockdown';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const T = 'd1d1d1d1-0000-4000-8000-00000000000a', SA = 'd2d2d2d2-0000-4000-8000-00000000000a', OW = 'd3d3d3d3-0000-4000-8000-00000000000a';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'L', 'L', 'lk-t', 'LKT01', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${SA}', NULL, 'SA', 'sa-lk@x.test', 'x', 'active', 'SUPER_ADMIN'), ('${OW}', '${T}', 'Ow', 'ow-lk@x.test', 'x', 'active', 'OWNER') ON CONFLICT DO NOTHING`);
});
beforeEach(async () => { await pg.exec(`DELETE FROM emergency_lockdowns WHERE scope = 'platform'; DELETE FROM sessions WHERE user_id IN ('${SA}', '${OW}')`); });
const lockdown = () => pg.exec(`INSERT INTO emergency_lockdowns (lockdown_ref, scope, status, reason) VALUES ('LD-TEST-${Date.now()}', 'platform', 'active', 'breach')`);
const session = async (user: string, tenant: string | null) => (await pg.query(`INSERT INTO sessions (user_id, tenant_id, status, expires_at) VALUES ($1, $2, 'active', now() + interval '1 hour') RETURNING id`, [user, tenant])).rows[0].id;

describe('M13 the gate', () => {
  it('no lockdown → everyone passes', async () => { await expect(new PlatformLockdownGate(db).assertAllowed('OWNER')).resolves.toBeUndefined(); });
  it('active platform lockdown → an OWNER is refused (503); a SUPER_ADMIN still passes, to investigate and lift', async () => {
    await lockdown(); const g = new PlatformLockdownGate(db);
    await expect(g.assertAllowed('OWNER')).rejects.toMatchObject({ status: 503 });
    await expect(g.assertAllowed('SUPER_ADMIN')).resolves.toBeUndefined();
  });
  it('an ACCOUNT or TENANT lockdown does not stop the whole platform', async () => {
    await pg.exec(`INSERT INTO emergency_lockdowns (lockdown_ref, scope, target, status, reason) VALUES ('LD-T-${Date.now()}', 'tenant', '${T}', 'active', 'x')`);
    await expect(new PlatformLockdownGate(db).assertAllowed('OWNER')).resolves.toBeUndefined();
    await pg.exec(`DELETE FROM emergency_lockdowns WHERE scope = 'tenant'`);
  });
  it('cached for a few seconds (one query per interval, not per request); invalidate() reacts at once', async () => {
    const g = new PlatformLockdownGate(db); let t = 1_000_000; g.now = () => t;
    expect(await g.isActive()).toBe(false);
    await lockdown();
    expect(await g.isActive()).toBe(false);                       // still cached
    t += PLATFORM_LOCKDOWN_CACHE_MS + 1; expect(await g.isActive()).toBe(true);   // expires
    await pg.exec(`DELETE FROM emergency_lockdowns WHERE scope = 'platform'`); g.invalidate(); expect(await g.isActive()).toBe(false);
  });
});

describe('M13 enforced on real requests (TenantContextMiddleware)', () => {
  it('while locked, an owner request is refused before it reaches any handler', async () => {
    await lockdown();
    const mw = new TenantContextMiddleware(undefined, undefined, new PlatformLockdownGate(db));
    let reached = false;
    await expect(mw.use({ session: { userId: OW, tenantId: T, branchId: '', role: 'OWNER', permissions: [] }, headers: {}, query: {}, body: {} }, {}, () => { reached = true; })).rejects.toMatchObject({ status: 503 });
    expect(reached).toBe(false);
  });
});

describe('M13 executing it cuts existing sessions', () => {
  it('revokes every non-SUPER_ADMIN session, keeps Super Admins, keeps the initiator', async () => {
    const owner = await session(OW, T), sa = await session(SA, null), initiator = await session(SA, null);
    const n = await revokeAllNonSuperAdminSessions(db, 'test', initiator);
    const st = async (id: string) => (await pg.query(`SELECT status FROM sessions WHERE id = $1`, [id])).rows[0].status;
    expect(n).toBe(1);
    expect(await st(owner)).toBe('revoked'); expect(await st(sa)).toBe('active'); expect(await st(initiator)).toBe('active');
  });
});
