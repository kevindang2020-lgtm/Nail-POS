// attempt-budget.pgtest — Security Deep Scan C4 / C8 regression tests against the real schema (PGlite).
//
// C4: the second factor could be guessed without limit for a Super Admin (TOTP path) and for staff — the login throttle
// counts only wrong passwords, and the MFA limiter was a no-op without Redis. The budget now lives in Postgres
// (auth_events), so it works with NO Redis at all — which is exactly how these tests run.
// C8: a Super Admin with a phone got SMS INSTEAD of the enrolled authenticator.
//
// Each LoginService test would FAIL on the old code: there, after ten wrong codes, the REAL code still signs in.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { hashPassword } from '@aipowersalon/auth';
import { MockSmsSender } from '@aipowersalon/notifications';
import { PostgresAttemptBudget, InMemoryAttemptBudget, guardedAttempt, type AttemptLockout } from './auth-attempt-budget';
import { LoginService } from './auth-login.service';
import { InMemoryAuthUserRepository, type AuthSeed } from './auth-user.repository';
import { SuperAdminOtpService, InMemorySuperAdminOtpStore } from './super-admin-login-otp';
import { totpCode, generateSecret } from './totp';
import { MfaController } from './mfa.controller';

let pg: any; let db: any;
const T = 'ab000000-0000-4000-8000-0000000000c4';
const SA = 'ab000000-0000-4000-8000-0000000000a1';
const SA2 = 'ab000000-0000-4000-8000-0000000000a2';
const MGR = 'ab000000-0000-4000-8000-0000000000b1';
const U1 = 'ab000000-0000-4000-8000-0000000000d1';
const U2 = 'ab000000-0000-4000-8000-0000000000d2';
const U3 = 'ab000000-0000-4000-8000-0000000000d3';
const SECRET = 'JBSWY3DPEHPK3PXP';
const PW = 'Correct-Horse-9!';

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'C4', 'C4', 'c4-t', 'C4SALON', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES
      ('${SA}', NULL, 'Root', 'root@c4.test', 'x', 'active', 'SUPER_ADMIN'),
      ('${SA2}', NULL, 'Root2', 'root2@c4.test', 'x', 'active', 'SUPER_ADMIN'),
      ('${MGR}', '${T}', 'Mo', 'mo@c4.test', 'x', 'active', 'MANAGER'),
      ('${U1}', '${T}', 'U1', 'u1@c4.test', 'x', 'active', 'TECHNICIAN'),
      ('${U2}', '${T}', 'U2', 'u2@c4.test', 'x', 'active', 'TECHNICIAN'),
      ('${U3}', '${T}', 'U3', 'u3@c4.test', 'x', 'active', 'TECHNICIAN') ON CONFLICT DO NOTHING`);
});

const spent = async (userId: string, kind: string) => Number((await pg.query(`SELECT count(*)::int n FROM auth_events WHERE event_type = 'ATTEMPT_BUDGET_SPENT' AND user_id = $1 AND reason = $2`, [userId, kind])).rows[0].n);

describe('PostgresAttemptBudget (auth_events, no Redis)', () => {
  it('admits max failures, then refuses; a correct answer is refunded; the exhausting failure records the lock once', async () => {
    const locks: AttemptLockout[] = [];
    const b = new PostgresAttemptBudget(db, { limits: { step_up: { max: 3, windowMs: 15 * 60_000 } }, onLockout: (e) => { locks.push(e); } });
    const ok = await b.admit('step_up', U1); expect(ok.allowed).toBe(true); await ok.settle(true);
    expect(await spent(U1, 'step_up')).toBe(0);                                  // a correct answer spends nothing
    for (let i = 0; i < 3; i++) { const a = await b.admit('step_up', U1, { tenantId: T, ip: '10.0.0.1' }); expect(a.allowed).toBe(true); await a.settle(false); }
    const refused = await b.admit('step_up', U1);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBeGreaterThan(0);
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatchObject({ kind: 'step_up', userId: U1, failures: 3, tenantId: T, ip: '10.0.0.1' });
    expect(Number((await pg.query(`SELECT count(*)::int n FROM auth_events WHERE event_type = 'ATTEMPT_BUDGET_LOCKED' AND user_id = $1`, [U1])).rows[0].n)).toBe(1);
  });
  it('budgets are per account and per kind', async () => {
    const b = new PostgresAttemptBudget(db, { limits: { mfa: { max: 1, windowMs: 15 * 60_000 } } });
    const a = await b.admit('mfa', U2); await a.settle(false);
    expect((await b.admit('mfa', U2)).allowed).toBe(false);
    expect((await b.admit('mfa', U3)).allowed).toBe(true);                       // another account
    expect((await b.admit('password_change', U2)).allowed).toBe(true);           // another kind
  });
  it('the window slides: failures older than the window no longer count', async () => {
    const b = new PostgresAttemptBudget(db, { limits: { temp_password_login: { max: 1, windowMs: 60_000 } } });
    const a = await b.admit('temp_password_login', U3); await a.settle(false);
    expect((await b.admit('temp_password_login', U3)).allowed).toBe(false);
    await pg.query(`UPDATE auth_events SET occurred_at = now() - interval '2 minutes' WHERE user_id = $1 AND reason = 'temp_password_login'`, [U3]);
    expect((await b.admit('temp_password_login', U3)).allowed).toBe(true);
  });
  // (concurrency — N parallel guesses admit at most the budget — needs real connections: attempt-budget.postgres-race spec)
  it('fails CLOSED when the budget cannot be read', async () => {
    const broken = { transaction: () => ({ execute: async () => { throw new Error('db down'); } }) };
    const b = new PostgresAttemptBudget(broken);
    expect((await b.admit('mfa', U1)).allowed).toBe(false);
  });
  it('guardedAttempt: a locked account never has its guess checked', async () => {
    const b = new InMemoryAttemptBudget({ limits: { mfa: { max: 1, windowMs: 60_000 } } });
    await guardedAttempt(b, 'mfa', 'x', {}, async () => false);
    let checked = false;
    const r = await guardedAttempt(b, 'mfa', 'x', {}, async () => { checked = true; return true; });
    expect(r).toMatchObject({ ok: false, locked: true });
    expect(checked).toBe(false);
  });
});

async function saService(opts: { phone: string | null; totp: string | null; sms?: MockSmsSender; userId?: string; email?: string }) {
  const hash = await hashPassword(PW);
  const seed: AuthSeed = {
    tenants: [], subscriptions: [], branches: [],
    users: [{ userId: opts.userId ?? SA, tenantId: null, branchId: null, role: 'SUPER_ADMIN', status: 'active', passwordHash: hash, mfaEnabled: true, fullName: 'Root', email: opts.email ?? 'root@c4.test', normalizedPhone: opts.phone, totpSecret: opts.totp } as any],
  };
  const sms = opts.sms ?? new MockSmsSender();
  const otp = new SuperAdminOtpService(new InMemorySuperAdminOtpStore(), sms);
  return { svc: new LoginService(new InMemoryAuthUserRepository(seed), undefined, undefined, otp, new PostgresAttemptBudget(db)), sms };
}

describe('C4 — the Super Admin TOTP path is budgeted (was unlimited)', () => {
  it('after 10 wrong codes, even the REAL authenticator code is refused', async () => {
    const { svc } = await saService({ phone: null, totp: SECRET });
    const login = (mfaCode: string) => svc.attempt({ portal: 'super-admin', identifier: 'root@c4.test', password: PW, mfaCode });
    for (let i = 0; i < 10; i++) expect((await login('000000')).outcome).toBe('MFA_REQUIRED');
    // on the old code this is SUCCESS: the SA path called checkMfa directly, with no budget
    expect((await login(totpCode(SECRET, Date.now()))).outcome).toBe('MFA_REQUIRED');
    expect(await spent(SA, 'mfa')).toBe(10);
  });
  it('the first step of a two-step sign-in (no code yet) spends nothing', async () => {
    const { svc } = await saService({ phone: null, totp: SECRET, userId: SA2, email: 'root2@c4.test' });
    for (let i = 0; i < 12; i++) expect((await svc.attempt({ portal: 'super-admin', identifier: 'root2@c4.test', password: PW })).outcome).toBe('MFA_REQUIRED');
    expect(await spent(SA2, 'mfa')).toBe(0);
    expect((await svc.attempt({ portal: 'super-admin', identifier: 'root2@c4.test', password: PW, mfaCode: totpCode(SECRET, Date.now()) })).outcome).toBe('SUCCESS');
  });
});

describe('C4 — the staff (salon code) path is budgeted (was unlimited)', () => {
  it('a manager with an authenticator: 10 wrong codes, then the real code is refused', async () => {
    const hash = await hashPassword(PW);
    const seed: AuthSeed = {
      tenants: [{ id: T, tenantCode: 'C4SALON', status: 'active' }], subscriptions: [{ tenantId: T, status: 'active' }], branches: [{ tenantId: T }],
      users: [{ userId: MGR, tenantId: T, branchId: null, role: 'MANAGER', status: 'active', passwordHash: hash, mfaEnabled: true, fullName: 'Mo', email: 'mo@c4.test', normalizedPhone: null, totpSecret: SECRET } as any],
    };
    const svc = new LoginService(new InMemoryAuthUserRepository(seed), undefined, undefined, undefined, new PostgresAttemptBudget(db));
    const login = (mfaCode: string) => svc.attempt({ portal: 'tenant', salonCode: 'C4SALON', identifier: 'mo@c4.test', password: PW, mfaCode });
    for (let i = 0; i < 10; i++) expect((await login('000000')).outcome).toBe('MFA_REQUIRED');
    expect((await login(totpCode(SECRET, Date.now()))).outcome).toBe('MFA_REQUIRED');   // old code: SUCCESS
  });
});

describe('C8 — an enrolled authenticator wins over SMS for a Super Admin', () => {
  it('with a phone AND a confirmed TOTP factor: no SMS is sent, and the authenticator code signs in', async () => {
    const sms = new MockSmsSender();
    const { svc } = await saService({ phone: '+15125554829', totp: 'KRSXG5CTMVRXEZLU', sms, userId: SA2, email: 'root2@c4.test' });
    const step1 = await svc.attempt({ portal: 'super-admin', identifier: 'root2@c4.test', password: PW });
    expect(step1.outcome).toBe('MFA_REQUIRED');
    expect(step1.maskedPhone).toBeUndefined();
    expect(sms.sent).toHaveLength(0);                                            // old code: an SMS code was sent instead
    const ok = await svc.attempt({ portal: 'super-admin', identifier: 'root2@c4.test', password: PW, mfaCode: totpCode('KRSXG5CTMVRXEZLU', Date.now()) });
    expect(ok.outcome).toBe('SUCCESS');                                          // old code: the TOTP code was ignored (MFA_REQUIRED)
  });
  it('with a phone and NO authenticator yet: SMS is still the factor (bootstrap), and it is budgeted', async () => {
    const sms = new MockSmsSender();
    const { svc } = await saService({ phone: '+15125554829', totp: null, sms });
    const step1 = await svc.attempt({ portal: 'super-admin', identifier: 'root@c4.test', password: PW });
    expect(step1.outcome).toBe('MFA_REQUIRED');
    expect(sms.sent).toHaveLength(1);
  });
});

describe('C4 — replacing an authenticator spends the same second-factor budget (a session could guess the current code forever)', () => {
  it('after 10 wrong current codes, the REAL current code is refused with 429', async () => {
    const enc = { encrypt: (x: string) => 'e:' + x, decrypt: (x: string) => x.slice(2) } as any;
    const secret = generateSecret();
    await pg.query(`DELETE FROM auth_events WHERE user_id = $1`, [U3]);
    await db.insertInto('mfa_factors').values({ user_id: U3, type: 'totp', secret_enc: enc.encrypt(secret), confirmed: true }).execute();
    const ctl = new MfaController(db, enc, { record: async () => true } as any);
    const r = { ctx: { userId: U3, tenantId: T } };
    const wrong = totpCode(secret, Date.now()) === '000000' ? '111111' : '000000';
    for (let i = 0; i < 10; i++) await expect(ctl.enroll(r, { currentCode: wrong })).rejects.toMatchObject({ status: 403 });
    await expect(ctl.enroll(r, { currentCode: totpCode(secret, Date.now()) })).rejects.toMatchObject({ status: 429 });   // old code: replaced
  });
});
