// refresh-device-binding.pgtest — Secure Tap to Pay M6-6 (§2 / §14 / §16 / §61 / §69) on the REAL migrated schema (689):
// identity's refresh rotation (KyselyRefreshRepository + KyselySessionStore) asks the payment-device registry
// (KyselyMobilePayDeviceStore, through the same refreshBlockFor answer the MobileCheckoutModule provides as
// REFRESH_DEVICE_GUARD) before extending a session opened on a payment phone; refresh_tokens.family_id names the chain and a
// reuse revokes the whole family.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RefreshSessionService, KyselyRefreshRepository, KyselySessionStore } from '@aipowersalon/identity';
import { KyselyMobilePayDeviceStore } from './mobile-pay-device.kysely';
import { refreshBlockFor } from './mobile-pay-device';
// merged Nov 7 2026: these pin the STRICT reuse rule (any reuse burns the family) — no grace window here
process.env.REFRESH_REUSE_GRACE_SECONDS = '0';

let pg: any; let db: any; let devices: KyselyMobilePayDeviceStore; let sessions: KyselySessionStore; let svc: RefreshSessionService;
const T = 'd6890000-0000-4000-8000-00000000000a', B = 'd6891000-0000-4000-8000-00000000000a';
const U = 'd6892000-0000-4000-8000-00000000000a', U2 = 'd6892000-0000-4000-8000-0000000000a2';
const one = async (q: string, p: unknown[] = []) => (await pg.query(q, p)).rows[0];
const signIn = async (userId: string, deviceId: string | null) => {
  const sid = (await sessions.create({ userId, tenantId: T, branchId: B, ttlSeconds: 3600, deviceId } as any))!;
  return { sid, ...(await svc.issue(sid, userId, 3600)) };
};

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'D689', 'D689', 'd689', 'D689', 'active')`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${B}', '${T}', 'Main')`);
  await pg.exec(`INSERT INTO users (id, tenant_id, email, full_name, role, status) VALUES ('${U}', '${T}', 'm@d689.test', 'Mgr', 'MANAGER', 'active'), ('${U2}', '${T}', 'm2@d689.test', 'Mgr B', 'MANAGER', 'active')`);
  devices = new KyselyMobilePayDeviceStore(db); sessions = new KyselySessionStore(db);
  svc = new RefreshSessionService(new KyselyRefreshRepository(db), sessions, undefined,
    () => ({ refreshBlock: async (q) => refreshBlockFor(await devices.get(q.tenantId, q.deviceId)) }));
}, 120_000);

describe('M6-6 refresh rotation × payment device (Postgres)', () => {
  it('§14: the family id is stored on the root and inherited by every rotation; another sign-in is another family', async () => {
    const a = await signIn(U, null); const b = await signIn(U, null);
    const r1: any = await svc.rotate(a.refreshToken); expect(r1.ok).toBe(true);
    const fams = (await pg.query(`select distinct family_id from refresh_tokens where session_id = $1`, [a.sid])).rows;
    expect(fams).toEqual([{ family_id: a.familyId }]);
    expect(b.familyId).not.toBe(a.familyId);
  });

  it('§69: reusing a rotated token revokes every token of the family and the session; TOKEN_REUSE carries the family', async () => {
    const a = await signIn(U, null);
    const r1: any = await svc.rotate(a.refreshToken); const r2: any = await svc.rotate(r1.refreshToken); expect(r2.ok).toBe(true);
    expect(await svc.rotate(r1.refreshToken)).toMatchObject({ ok: false, reason: 'reused', familyId: a.familyId, sessionId: a.sid });
    expect(Number((await one(`select count(*)::int n from refresh_tokens where family_id = $1 and revoked_at is null`, [a.familyId])).n)).toBe(0);
    expect(await sessions.isRevoked(a.sid)).toBe(true);
    expect(await svc.rotate(r2.refreshToken)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('a legacy row with no family_id still burns as its session (migration 689 backfill rule)', async () => {
    const a = await signIn(U, null);
    await pg.query(`update refresh_tokens set family_id = null where session_id = $1`, [a.sid]);
    const r1: any = await svc.rotate(a.refreshToken); expect(r1.ok).toBe(true);
    expect(await svc.rotate(a.refreshToken)).toMatchObject({ reason: 'reused', familyId: a.sid });
    expect(Number((await one(`select count(*)::int n from refresh_tokens where session_id = $1 and revoked_at is null`, [a.sid])).n)).toBe(0);
  });

  it('§61: an ACTIVE phone refreshes; once REVOKED the next refresh is DEVICE_REVOKED and the session + family end', async () => {
    await devices.upsertOnRegister(T, { deviceId: 'pay-phone-1', branchId: B, registeredBy: U, tapToPayCapable: true });
    await devices.setStatus(T, 'pay-phone-1', 'active', U);
    const a = await signIn(U, 'pay-phone-1');
    const r1: any = await svc.rotate(a.refreshToken); expect(r1.ok).toBe(true);
    // revoke the row directly — what a revoke from ANY path (Owner app, Super Admin) leaves behind
    await pg.query(`update mobile_pay_devices set status = 'revoked', revoked_at = now() where tenant_id = $1 and device_id = 'pay-phone-1'`, [T]);
    expect(await svc.rotate(r1.refreshToken)).toMatchObject({ ok: false, reason: 'device_revoked', deviceId: 'pay-phone-1', tenantId: T });
    expect(await sessions.isRevoked(a.sid)).toBe(true);
    expect(Number((await one(`select count(*)::int n from refresh_tokens where family_id = $1 and revoked_at is null`, [a.familyId])).n)).toBe(0);
  });

  it('a SUSPENDED (disabled) phone: refresh refused DEVICE_SUSPENDED, the session survives; re-activated → refresh works', async () => {
    await devices.upsertOnRegister(T, { deviceId: 'pay-phone-2', branchId: B, registeredBy: U, tapToPayCapable: true });
    await devices.setStatus(T, 'pay-phone-2', 'active', U);
    const a = await signIn(U, 'pay-phone-2');
    await devices.setStatus(T, 'pay-phone-2', 'disabled', U, 'owner paused');
    expect(await svc.rotate(a.refreshToken)).toMatchObject({ ok: false, reason: 'device_suspended' });
    expect(await sessions.isRevoked(a.sid)).toBe(false);
    await devices.setStatus(T, 'pay-phone-2', 'active', U);
    expect((await svc.rotate(a.refreshToken)).ok).toBe(true);
  });

  it('a session on a device id that is NOT a payment phone (a browser key) refreshes as before', async () => {
    const a = await signIn(U2, 'web-browser-key-123');
    expect((await svc.rotate(a.refreshToken)).ok).toBe(true);
  });

  it('M6-6 §14 / §77: who is signed in on a SHARED phone now, and which phone a session belongs to (the realtime device room)', async () => {
    await devices.upsertOnRegister(T, { deviceId: 'front-desk', registeredBy: U, tapToPayCapable: true, pairing: { branchId: B, approvedBy: U, shared: true } });
    expect(await devices.signedInUser(T, 'front-desk')).toBeNull();
    const a = await signIn(U, 'front-desk');
    expect(await devices.signedInUser(T, 'front-desk')).toBe(U);
    expect(await devices.deviceForSession(T, a.sid)).toBe('front-desk');
    await sessions.revoke(a.sid);                                   // Manager A signs out …
    const b = await signIn(U2, 'front-desk');                       // … Manager B signs in on the same phone
    expect(await devices.signedInUser(T, 'front-desk')).toBe(U2);
    expect(await devices.deviceForSession(T, a.sid)).toBeNull();    // a revoked session joins no device room
    expect(await devices.deviceForSession(T, b.sid)).toBe('front-desk');
    expect(await devices.deviceForSession('d6890000-0000-4000-8000-0000000000ff', b.sid)).toBeNull();   // another salon: nothing
    const browser = await signIn(U2, 'web-browser-key-456');
    expect(await devices.deviceForSession(T, browser.sid)).toBeNull();   // not a payment phone
    await devices.setStatus(T, 'front-desk', 'revoked', U, 'lost');
    expect(await devices.deviceForSession(T, b.sid)).toBeNull();    // a revoked phone has no room
  });

  it('M6-6 §15 / §62: the owner\'s device activity — this phone\'s sign-ins and its audit history, tenant-scoped', async () => {
    await devices.upsertOnRegister(T, { deviceId: 'mgr-phone', registeredBy: U, tapToPayCapable: true, pairing: { branchId: B, approvedBy: U } });
    const a = await signIn(U, 'mgr-phone');
    const other = await signIn(U, 'some-other-phone');
    await pg.query(`INSERT INTO audit_events (tenant_id, branch_id, actor_user_id, actor_name, module, action, resource_type, resource_id, status, severity, metadata, session_id)
      VALUES ($1,$2,$3,'Mgr','mobile_checkout','mobile_pay_device_activated','mobile_checkout','mgr-phone','success','low','{}'::jsonb,null),
             ($1,$2,$3,'Mgr','mobile_checkout','checkout_payment_claimed','mobile_checkout','tk-1','success','low','{"deviceId":"mgr-phone"}'::jsonb,null),
             ($1,$2,$3,'Mgr','checkout','pos_payment_recorded','ticket','tk-2','success','low','{"ticketId":"tk-2"}'::jsonb,$4),
             ($1,$2,$3,'Mgr','checkout','unrelated','ticket','tk-3','success','low','{}'::jsonb,$5)`, [T, B, U, a.sid, other.sid]);
    const act = await devices.activity(T, 'mgr-phone');
    expect(act.sessions.map((x) => x.id)).toEqual([a.sid]);
    expect(act.audit.map((x) => x.action).sort()).toEqual(['checkout_payment_claimed', 'mobile_pay_device_activated', 'pos_payment_recorded']);
    expect(act.audit.find((x) => x.action === 'pos_payment_recorded')?.ticketId).toBe('tk-2');
    const elsewhere = await devices.activity('d6890000-0000-4000-8000-0000000000ff', 'mgr-phone');   // another salon sees nothing
    expect(elsewhere).toEqual({ sessions: [], audit: [] });
  });
});

