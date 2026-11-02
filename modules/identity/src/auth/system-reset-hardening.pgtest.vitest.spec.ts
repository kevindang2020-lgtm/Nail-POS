// system-reset-hardening.pgtest — Security Deep Scan C6 / A2 / E4 / C12 regression tests (PGlite, the real schema).
//
//   C6/E4  POST /auth/admin/reset-user-password trusted a client header (x-mfa-verified) for Super Admin MFA and verified
//          the bare token itself (no revocation, no current grants). It now runs behind the session middleware + guards:
//          @RequirePermission + @RequireStepUp, and the actor is req.ctx.
//   E4     a MANAGER limited to some branches could reset anyone in the salon.
//   A2     the production audit port was a no-op — every reset / temporary-login / password-change record was dropped.
//   C12    change-password sessions and the reset counters were per-process Maps (a second replica broke both); the
//          tenant forgot flow counted no IP; /auth/temp-password-login had no attempt limit.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { MockSmsSender, MockEmailSender } from '@aipowersalon/notifications';
import { RecordingAuditSink } from '@aipowersalon/audit';
import { hashPassword } from '@aipowersalon/auth';
import { STEP_UP_META } from '@aipowersalon/permissions/guards';
import { SystemPasswordResetService, type UserRow } from './system-password-reset.service';
import { makeKyselySystemResetPorts } from './system-reset.ports.kysely';
import { SystemResetController } from './system-reset.controller';
import { signSession } from './auth-session-token';

let pg: any; let db: any;
const T = 'ac000000-0000-4000-8000-0000000000c6';
const B1 = 'ac000000-0000-4000-8000-0000000000b1', B2 = 'ac000000-0000-4000-8000-0000000000b2';
const MGR = 'ac000000-0000-4000-8000-0000000000a1', TECH1 = 'ac000000-0000-4000-8000-0000000000a2', TECH2 = 'ac000000-0000-4000-8000-0000000000a3';
const SA = 'ac000000-0000-4000-8000-0000000000a4';

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'C6', 'C6', 'c6-t', 'C6SALON', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B1}', '${T}', 'One'), ('${B2}', '${T}', 'Two') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, branch_id, full_name, email, normalized_phone, password_hash, status, role) VALUES
      ('${MGR}', '${T}', '${B1}', 'Mo', 'mo@c6.test', NULL, 'x', 'active', 'MANAGER'),
      ('${TECH1}', '${T}', '${B1}', 'Ti', 'ti@c6.test', NULL, 'x', 'active', 'TECHNICIAN'),
      ('${TECH2}', '${T}', '${B2}', 'Tu', 'tu@c6.test', NULL, 'x', 'active', 'TECHNICIAN'),
      ('${SA}', NULL, NULL, 'Root', 'root@c6.test', NULL, 'x', 'active', 'SUPER_ADMIN') ON CONFLICT DO NOTHING`);
});

/** One "replica": its own service instance and ports over the SAME database. */
const replica = (audit = new RecordingAuditSink()) => {
  const sms = new MockSmsSender(); const email = new MockEmailSender();
  return { svc: new SystemPasswordResetService(makeKyselySystemResetPorts(db, sms, email, { audit })), sms, email, audit };
};
const tempFrom = (body: string) => /temporary password is: (\S+)/.exec(body)?.[1] ?? '';
const manager = (branchIds: string[] | null) => ({ userId: MGR, role: 'MANAGER' as const, tenantId: T, permissions: ['users.reset_staff_password'], branchIds });
const userRow = async (id: string): Promise<{ user: UserRow; hash: string; exp: number }> => {
  const r = (await pg.query(`SELECT id, tenant_id, branch_id, full_name, role, status, email, normalized_phone, temp_password_hash, temp_password_expires_at FROM users WHERE id = $1`, [id])).rows[0];
  return { user: { userId: r.id, tenantId: r.tenant_id, branchId: r.branch_id, fullName: r.full_name, role: r.role, status: r.status, email: r.email, normalizedPhone: r.normalized_phone, permissions: [] }, hash: r.temp_password_hash, exp: new Date(r.temp_password_expires_at).getTime() };
};

describe('C6 / E4 — the admin reset route', () => {
  it('declares the permission and the step-up the global guards enforce (the route is no longer self-authenticating)', () => {
    const h = SystemResetController.prototype.adminReset;
    expect(Reflect.getMetadata('perm', h)).toBe('roles.manage');
    expect(Reflect.getMetadata(STEP_UP_META, h)).toBeGreaterThan(0);
  });
  it('ignores the bearer token and x-mfa-verified header — without the middleware-verified req.ctx it is 401', async () => {
    const secret = 'c6-test-secret-value-32-chars-long!!';
    const prev = process.env.AUTH_SESSION_SECRET; process.env.AUTH_SESSION_SECRET = secret;
    try {
      const token = signSession({ userId: SA, tenantId: null, branchId: null, role: 'SUPER_ADMIN', permissions: ['super_admin.users.reset_password'], subscriptionStatus: 'active', sid: SA } as any, { secret });
      const c = new SystemResetController(replica().svc, db);
      // old code: verified this token itself, took mfaVerified from the header, and went on to reset TECH1
      await expect(c.adminReset({ targetUserId: TECH1, deliveryMethod: 'email', reason: 'test' }, { headers: { authorization: `Bearer ${token}`, 'x-mfa-verified': '1' } }))
        .rejects.toMatchObject({ status: 401 });
    } finally { if (prev === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = prev; }
  });
  it('a Super Admin actor is refused without a server-side MFA step-up', async () => {
    await expect(replica().svc.adminResetUserPassword({ userId: SA, role: 'SUPER_ADMIN', tenantId: null, permissions: ['super_admin.users.reset_password'], mfaVerified: false }, TECH1, { deliveryMethod: 'email', reason: 'r' }))
      .rejects.toThrow('mfa_required');
  });
  it('E4: a manager limited to branch One cannot reset someone in branch Two (old code: reset went through)', async () => {
    await expect(replica().svc.adminResetUserPassword(manager([B1]), TECH2, { deliveryMethod: 'email', reason: 'r' })).rejects.toThrow('forbidden_out_of_branch');
    expect((await replica().svc.adminResetUserPassword(manager([B1]), TECH1, { deliveryMethod: 'email', reason: 'r' })).ok).toBe(true);
    expect((await replica().svc.adminResetUserPassword(manager(null), TECH2, { deliveryMethod: 'email', reason: 'r' })).ok).toBe(true);   // tenant-wide manager
  });
});

describe('A2 — reset audit records reach the audit writer (the port was a no-op)', () => {
  it('admin reset, temporary-password login and the password change are all recorded', async () => {
    const r = replica();
    await r.svc.adminResetUserPassword(manager(null), TECH1, { deliveryMethod: 'email', reason: 'forgot it' });
    const actions = r.audit.entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['password_reset_sent', 'temporary_password_created', 'manager_user_password_reset']));
    const reset = r.audit.entries.find((e) => e.action === 'manager_user_password_reset')!;
    expect(reset).toMatchObject({ tenantId: T, userId: MGR, module: 'auth', resourceType: 'user', resourceId: TECH1, reason: 'forgot it' });
    const temp = tempFrom(r.email.sent.at(-1)!.body);
    const { user, hash, exp } = await userRow(TECH1);
    const login = await r.svc.loginWithTemporaryPassword(user, temp, { hash, expiresAt: exp });
    expect(login.ok).toBe(true);
    await r.svc.changeTemporaryPassword({ changePasswordSessionId: (login as any).changePasswordSessionId, newPassword: 'NewPassw0rd-123', confirmPassword: 'NewPassw0rd-123' });
    expect(r.audit.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['temporary_password_login', 'password_changed', 'sessions_revoked_after_password_change']));
  });
});

describe('C12 — state lives in Postgres, not one process', () => {
  it('a change-password session started on one replica completes on another (old code: invalid_or_expired_session)', async () => {
    const a = replica(), b = replica();
    await a.svc.adminResetUserPassword(manager(null), TECH2, { deliveryMethod: 'email', reason: 'r' });
    const temp = tempFrom(a.email.sent.at(-1)!.body);
    const { user, hash, exp } = await userRow(TECH2);
    const login = await a.svc.loginWithTemporaryPassword(user, temp, { hash, expiresAt: exp });
    expect(login.ok).toBe(true);
    const sid = (login as any).changePasswordSessionId as string;
    // the temporary password itself is still refused as the new one — checked against the stored HASH
    await expect(b.svc.changeTemporaryPassword({ changePasswordSessionId: sid, newPassword: temp, confirmPassword: temp })).rejects.toThrow();
    const done = await b.svc.changeTemporaryPassword({ changePasswordSessionId: sid, newPassword: 'Another-Pass-456', confirmPassword: 'Another-Pass-456' });
    expect(done.ok).toBe(true);
    // single use: the same session cannot change the password twice, on any replica
    await expect(a.svc.changeTemporaryPassword({ changePasswordSessionId: sid, newPassword: 'Third-Pass-7890', confirmPassword: 'Third-Pass-7890' })).rejects.toThrow('invalid_or_expired_session');
    // and nothing in the grant holds the temporary password
    const payloads = (await pg.query(`SELECT payload::text p FROM ephemeral_grants WHERE kind = 'password_reset_session'`)).rows.map((x: any) => x.p).join(' ');
    expect(payloads).not.toContain(temp);
  });
  it('the temporary-password login has an attempt limit: after 5 wrong guesses the RIGHT one is refused (old code: no limit)', async () => {
    const r = replica();
    await pg.query(`DELETE FROM auth_events WHERE user_id = $1`, [TECH1]);
    const temp = 'Temp-Right-1234';
    await pg.query(`UPDATE users SET temp_password_hash = $2, temp_password_expires_at = now() + interval '15 minutes' WHERE id = $1`, [TECH1, await hashPassword(temp)]);
    const { user, hash, exp } = await userRow(TECH1);
    for (let i = 0; i < 5; i++) expect(await r.svc.loginWithTemporaryPassword(user, 'wrong-guess-' + i, { hash, expiresAt: exp }, { ip: '198.51.100.7' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await replica().svc.loginWithTemporaryPassword(user, temp, { hash, expiresAt: exp })).toMatchObject({ ok: false, reason: 'rate_limited' });
  });
  it('reset-request counters are shared by every replica (Super Admin: 2 per identifier per 15 min)', async () => {
    const sends = [replica(), replica(), replica()];
    for (const r of sends) await r.svc.superAdminForgotPassword({ emailOrPhone: 'root@c6.test', deliveryMethod: 'email', ip: '203.0.113.9' });
    expect(sends.reduce((n, r) => n + r.email.sent.length, 0)).toBe(2);   // old code: 3 — each process counted alone
  });
  it('the tenant forgot flow counts the caller IP (5 per IP per 15 min across identifiers)', async () => {
    const r = replica();
    for (let i = 0; i < 6; i++) await r.svc.tenantForgotPassword({ tenantCodeOrSlug: 'C6SALON', emailOrPhone: `nobody${i}@c6.test`, ip: '192.0.2.44' });
    expect(r.audit.entries.filter((e) => e.action === 'password_reset_rate_limited')).toHaveLength(1);   // old code: 0 — no IP was counted
  });
});
