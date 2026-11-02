// technician-revocation.pgtest.vitest.spec.ts — workforce audit P0 #4/#5, against the real schema (every migration
// in PGlite). [Ported Oct 12 2026 from the Technician Profile package's auth/technician-revocation.pgtest — the chain
// lives in modules/workforce/src/technicians/revoke-technician-access.ts here.] POS suspend/archive, "disconnect
// membership" and the Super Admin suspend/lock/revoke-sessions paths all run the SAME chain; this proves what the chain
// does to the rows:
//   • sessions end (status 'revoked' AND revoked_at — the guard reads either; modules/identity session-revoked-markers
//     pgtest pins the guard side)
//   • users.status flips, the membership flips, the kiosk Clock PIN is disabled, an audit row lands
// Adapted: sessions are inserted as rows (modules/identity's KyselySessionStore is not a public export); the login
// lookup assertions are covered in modules/identity (technician-global-status-login spec).
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { hashPassword } from '@aipowersalon/auth';
import { revokeTechnicianAccess, restoreTechnicianAccess, restorePlatformTechnicianAccess } from './revoke-technician-access';
import { KyselyClockPinRepository } from '../technician-clock-pin/technician-clock-pin.kysely.repository';
import { TechnicianClockPinService } from '../technician-clock-pin/technician-clock-pin.service';

type Harness = { pg: any; db: any; q: (s: string, p?: unknown[]) => Promise<any[]>; count: (s: string, p?: unknown[]) => Promise<number> };
async function bootPg(): Promise<Harness> {
  const pg: any = await migratedPglite();
  const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
  return { pg, db: kyselyFor(pg), q, count: async (s: string, p: unknown[] = []) => Number((await q(s, p))[0]?.n ?? 0) };
}
const uuid = (p: string, s: string | number) => `${p.padEnd(8, '0')}-0000-4000-8000-${String(s).padStart(12, '0')}`;

const P = 'ab';
const TA = uuid(P, 1), TB = uuid(P, 2);
const BA = uuid(P, 'b1'), BB = uuid(P, 'b2');
const GTP = uuid(P, 'c0de');
const UA = uuid(P, 'a1'), UB = uuid(P, 'a2');      // the technician's login at A and at B
const TECH_A = uuid(P, 'e1'), TECH_B = uuid(P, 'e2');
const MGR = uuid(P, 'ab1');

let h: Harness;
const store = { create: async (s: { userId: string; tenantId: string; branchId: string; ttlSeconds: number }) => {
  const id = randomUUID();
  await h.q(`insert into sessions (id, user_id, tenant_id, branch_id, status, expires_at, last_seen_at) values ($1,$2,$3,$4,'active', now() + make_interval(secs => $5), now())`, [id, s.userId, s.tenantId, s.branchId, s.ttlSeconds]);
  return id;
} };
const isRevoked = async (sid: string) => { const r = (await h.q(`select status, revoked_at, expires_at from sessions where id = $1`, [sid]))[0]; return !r || r.status === 'revoked' || r.revoked_at != null; };
let sidA1: string, sidA2: string, sidB: string;

async function seedProfile() {
  await h.q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','A','rva','RVA'),($2,'B','B','rvb','RVB')`, [TA, TB]);
  await h.q(`insert into branches (id, tenant_id, name, status) values ($1,$2,'A-Main','active'),($3,$4,'B-Main','active')`, [BA, TA, BB, TB]);
  await h.q(`insert into global_tech_profiles (id, public_slug, display_name, tech_code, status) values ($1,'rv-tech','Riley V','TECH-RV0001','active')`, [GTP]);
  await h.q(`insert into users (id, tenant_id, branch_id, full_name, email, status, role, mfa_enabled, must_change_password, global_tech_profile_id, password_hash)
             values ($1,$2,$3,'Riley V','riley@rv-a.test','active','TECHNICIAN',false,false,$7,$8),
                    ($4,$5,$6,'Riley V','riley@rv-b.test','active','TECHNICIAN',false,false,$7,$8),
                    ($9,$2,$3,'Mgr','mgr@rv-a.test','active','MANAGER',false,false,null,$8)`, [UA, TA, BA, UB, TB, BB, GTP, await hashPassword('Secret-123'), MGR]);
  await h.q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active, status, global_tech_profile_id)
             values ($1,$2,$3,$4,'Riley','V','Riley V',true,'active',$9),($5,$6,$7,$8,'Riley','V','Riley V',true,'active',$9)`, [TECH_A, TA, BA, UA, TECH_B, TB, BB, UB, GTP]);
  await h.q(`insert into tech_salon_memberships (global_tech_profile_id, tenant_id, branch_id, status) values ($1,$2,$3,'active'),($1,$4,$5,'active')`, [GTP, TA, BA, TB, BB]);
  const pins = new KyselyClockPinRepository(h.db as any);
  await pins.upsertPin({ tenantId: TA, branchId: BA }, TECH_A, await hashPassword('2580'), MGR);
  await pins.upsertPin({ tenantId: TB, branchId: BB }, TECH_B, await hashPassword('2580'), null);
}

async function freshSessions() {
  sidA1 = (await store.create({ userId: UA, tenantId: TA, branchId: BA, ttlSeconds: 3600 }))!;
  sidA2 = (await store.create({ userId: UA, tenantId: TA, branchId: BA, ttlSeconds: 3600 }))!;
  sidB = (await store.create({ userId: UB, tenantId: TB, branchId: BB, ttlSeconds: 3600 }))!;
}
const sessionRow = async (sid: string) => (await h.q(`select status, revoked_at from sessions where id = $1`, [sid]))[0];
const userStatus = async (id: string) => (await h.q(`select status from users where id = $1`, [id]))[0].status;
const membership = async (t: string) => (await h.q(`select status, end_date from tech_salon_memberships where global_tech_profile_id = $1 and tenant_id = $2`, [GTP, t]))[0];
const pinDisabled = async (t: string, tech: string) => (await h.q(`select disabled_at from technician_clock_pins where tenant_id = $1 and technician_id = $2`, [t, tech]))[0]?.disabled_at != null;

beforeAll(async () => {
  h = await bootPg();
  await seedProfile();
}, 240000);

describe('POS suspend (TechniciansService.setLifecycle → chain, mode suspend)', () => {
  // Re-pinned (merge): a SALON suspension leaves the employment (membership) active — the roster status, the login, the
  // sessions and the Clock PIN carry it; their package set the membership to the platform state 'suspended', which our
  // machine (TECH_SALON_MEMBERSHIP) reserves for the platform and never lets a salon flow re-activate.
  it('ends every session at THIS salon, suspends the login, disables the PIN, audits — membership untouched — and leaves salon B alone', async () => {
    await freshSessions();
    expect(await isRevoked(sidA1)).toBe(false);
    const res = await revokeTechnicianAccess(h.db, { tenantId: TA, technicianId: TECH_A, mode: 'suspend', reason: 'late 3x', actor: { userId: MGR, role: 'MANAGER', branchId: BA }, source: 'pos_suspended' });
    expect(res.sessionsRevoked).toBe(2);
    expect(res.usersUpdated).toBe(1);
    expect(res.membershipsUpdated).toBe(0);
    expect(res.clockPinsDisabled).toBe(1);

    for (const sid of [sidA1, sidA2]) {
      const r = await sessionRow(sid);
      expect(r.status).toBe('revoked'); expect(r.revoked_at).not.toBeNull();
      expect(await isRevoked(sid)).toBe(true);
    }
    expect(await userStatus(UA)).toBe('suspended');
    expect((await membership(TA)).status).toBe('active');
    expect(await pinDisabled(TA, TECH_A)).toBe(true);
    // the kiosk no longer identifies the PIN
    const pinSvc = new TechnicianClockPinService(new KyselyClockPinRepository(h.db as any));
    expect((await pinSvc.identifyByPin({ tenantId: TA, branchId: BA }, '2580')).outcome).toBe('no_match');

    // tenant isolation: salon B's login, session, membership and PIN are untouched
    expect((await sessionRow(sidB)).status).toBe('active');
    expect(await userStatus(UB)).toBe('active');
    expect((await membership(TB)).status).toBe('active');
    expect(await pinDisabled(TB, TECH_B)).toBe(false);

    const audit = await h.q(`select metadata from audit_events where action = 'technician_access_revoked' and module = 'workforce' and tenant_id = $1 order by created_at desc limit 1`, [TA]);
    expect(audit.length).toBe(1);
    const md = typeof audit[0].metadata === 'string' ? JSON.parse(audit[0].metadata) : audit[0].metadata;
    expect(md.source).toBe('pos_suspended');
    expect(md.sessionsRevoked).toBe(2);
    expect(JSON.stringify(md)).not.toContain('2580');
  });

  it('restore (POS activate) reinstates the login + membership but NOT the sessions or the PIN', async () => {
    const r = await restoreTechnicianAccess(h.db, { tenantId: TA, technicianId: TECH_A, actor: { userId: MGR, role: 'MANAGER' }, source: 'pos_technician_activated' });
    expect(r.usersUpdated).toBe(1); expect(r.membershipsUpdated).toBe(0);   // the membership was never suspended (see above)
    expect(await userStatus(UA)).toBe('active');
    expect((await membership(TA)).status).toBe('active');
    expect((await sessionRow(sidA1)).status).toBe('revoked');
    expect(await pinDisabled(TA, TECH_A)).toBe(true);
    // a manager PIN reset clears the disable
    await new KyselyClockPinRepository(h.db as any).upsertPin({ tenantId: TA }, TECH_A, await hashPassword('7391'), MGR);
    expect(await pinDisabled(TA, TECH_A)).toBe(false);
  });
});

describe('disconnect membership (TechProfileService.posDeactivateMembership → chain, mode terminate)', () => {
  it('login inactive, membership former with end_date, sessions revoked, PIN disabled', async () => {
    await freshSessions();
    const res = await revokeTechnicianAccess(h.db, { tenantId: TA, technicianId: TECH_A, globalTechProfileId: GTP, mode: 'terminate', actor: { userId: MGR, role: 'MANAGER' }, source: 'membership_deactivate' });
    expect(res.sessionsRevoked).toBe(2);
    expect(await userStatus(UA)).toBe('inactive');
    const m = await membership(TA); expect(m.status).toBe('former'); expect(m.end_date).not.toBeNull();
    expect(await pinDisabled(TA, TECH_A)).toBe(true);
    expect((await sessionRow(sidB)).status).toBe('active');
    await restoreTechnicianAccess(h.db, { tenantId: TA, technicianId: TECH_A, actor: { userId: MGR, role: 'MANAGER' }, source: 'test_reset' });
  });
});

describe('Super Admin suspend / lock / revoke-sessions (platform-wide, tenantId null)', () => {
  it('revoke-sessions ends every login of the profile at every salon and touches nothing else', async () => {
    await freshSessions();
    const live = await h.count(`select count(*)::int as n from sessions where user_id in ($1,$2) and status = 'active'`, [UA, UB]);
    expect(live).toBeGreaterThanOrEqual(3);   // the three fresh ones + salon-B sessions earlier tenant-scoped runs left alive
    const res = await revokeTechnicianAccess(h.db, { tenantId: null, globalTechProfileId: GTP, mode: 'sessions_only', actor: { userId: null, role: 'SUPER_ADMIN' }, source: 'super_admin_revoke_sessions' });
    expect(res.sessionsRevoked).toBe(live);
    for (const sid of [sidA1, sidA2, sidB]) expect(await isRevoked(sid)).toBe(true);
    expect(await userStatus(UA)).toBe('active'); expect(await userStatus(UB)).toBe('active');
    expect((await membership(TB)).status).toBe('active');
  });

  // Re-pinned (merge): the platform suspension PAUSES memberships (pause_reason 'platform_suspend:…') — our machine's
  // platform hold — and the platform restore lifts exactly those (a membership the Super Admin paused for another
  // reason stays paused).
  it('suspend cuts users + pauses memberships at every salon; platform restore brings them back; a salon "activate" cannot', async () => {
    await freshSessions();
    await h.q(`update global_tech_profiles set status = 'suspended' where id = $1`, [GTP]);
    const res = await revokeTechnicianAccess(h.db, { tenantId: null, globalTechProfileId: GTP, mode: 'suspend', reason: 'fraud', actor: { userId: null, role: 'SUPER_ADMIN' }, source: 'super_admin_suspend' });
    expect(res.sessionsRevoked).toBe(3);
    for (const sid of [sidA1, sidA2, sidB]) expect((await sessionRow(sid)).status).toBe('revoked');
    expect(res.usersUpdated).toBe(2);
    expect(res.membershipsUpdated).toBe(2);
    expect((await membership(TA)).status).toBe('paused'); expect((await membership(TB)).status).toBe('paused');
    expect(await userStatus(UA)).toBe('suspended'); expect(await userStatus(UB)).toBe('suspended');
    expect((await h.q(`select status from global_tech_profiles where id = $1`, [GTP]))[0].status).toBe('suspended');

    // a salon's POS "activate" while the platform hold is on reinstates nothing
    const salon = await restoreTechnicianAccess(h.db, { tenantId: TA, technicianId: TECH_A, actor: { userId: MGR, role: 'MANAGER' }, source: 'pos_technician_activated' });
    expect([salon.usersUpdated, salon.membershipsUpdated]).toEqual([0, 0]);
    expect(await userStatus(UA)).toBe('suspended'); expect((await membership(TA)).status).toBe('paused');

    await h.q(`update global_tech_profiles set status = 'active' where id = $1`, [GTP]);
    const back = await restorePlatformTechnicianAccess(h.db, { globalTechProfileId: GTP, actor: { userId: null, role: 'SUPER_ADMIN' }, source: 'super_admin_restore' });
    expect(back.usersUpdated).toBe(2); expect(back.membershipsUpdated).toBe(2);
    expect(await userStatus(UA)).toBe('active');
    expect((await membership(TA)).status).toBe('active');
  });

  it('never demotes a non-technician login that happens to share the user id set', async () => {
    const before = await userStatus(MGR);
    await revokeTechnicianAccess(h.db, { tenantId: TA, userId: MGR, mode: 'suspend', actor: { userId: MGR, role: 'MANAGER' }, source: 'test' });
    expect(await userStatus(MGR)).toBe(before);
  });
});
