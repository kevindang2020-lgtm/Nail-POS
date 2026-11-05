// login-risk.vitest.spec.ts — Constitution 3 Step 10b: credential-stuffing block and elevated sign-ins.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { hashPassword } from '@aipowersalon/auth';
import { ipNetwork, assessRisk, KyselyLoginRisk, STUFFING_DISTINCT_ACCOUNTS, type LoginRiskPort } from './login-risk';
import { LoginService } from './auth-login.service';
import { generateSecret } from './totp';
import { hashDeviceKey } from './auth-devices';

describe('risk rules', () => {
  it('networks: IPv4 /24, IPv6 /48, mapped v4, junk → null', () => {
    expect(ipNetwork('203.0.113.77')).toBe('203.0.113.0/24'); expect(ipNetwork('::ffff:10.1.2.3')).toBe('10.1.2.0/24');
    expect(ipNetwork('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48'); expect(ipNetwork('nope')).toBeNull(); expect(ipNetwork(null)).toBeNull();
  });
  it('elevated only for new device AND new network AND an account with history', () => {
    expect(assessRisk({ newDevice: true, newNetwork: true, hasHistory: true })).toBe('elevated');
    expect(assessRisk({ newDevice: true, newNetwork: true, hasHistory: false })).toBe('normal');
    expect(assessRisk({ newDevice: true, newNetwork: false, hasHistory: true })).toBe('normal');
    expect(assessRisk({ newDevice: false, newNetwork: true, hasHistory: true })).toBe('normal');
  });
});

describe('sign-in under risk', () => {
  let hash: string; beforeAll(async () => { hash = await hashPassword('Risk-Passphrase-1!'); });
  const run = async (risk: Partial<LoginRiskPort>, totp: boolean) => {
    const user: any = { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'FRONT_DESK', status: 'active', passwordHash: hash, mfaEnabled: false, fullName: 'X', email: 'x@x.test', normalizedPhone: null, totpSecret: totp ? generateSecret() : null };
    let checked = 0;
    const repo: any = { async findTenantUserForLogin() { checked++; return { tenantFound: true, tenantStatus: 'active', subscriptionStatus: 'active', user, branchCount: 1, singleBranchId: 'b1' }; },
      async findSuperAdminForLogin() { return {}; }, async findCustomersForLogin() { return []; }, async markTotpStepUsed() { return true; } };
    const port: LoginRiskPort = { stuffingBlocked: async () => false, assess: async () => ({ level: 'normal', signals: { newDevice: false, newNetwork: false, hasHistory: true } }), ...risk } as any;
    const svc = new LoginService(repo, undefined, undefined, undefined, undefined, undefined, port);
    const r: any = await svc.attempt({ portal: 'tenant', salonCode: 'S', identifier: 'x@x.test', password: 'Risk-Passphrase-1!', ip: '203.0.113.9' } as any);
    return { r, checked };
  };
  const elevated = { assess: async () => ({ level: 'elevated' as const, signals: { newDevice: true, newNetwork: true, hasHistory: true } }) };
  it('elevated + an authenticator (two-factor switched off) → the code is required', async () => { expect((await run(elevated, true)).r.outcome).toBe('MFA_REQUIRED'); });
  it('elevated without an authenticator → signs in, risk reported for the log', async () => { const { r } = await run(elevated, false); expect(r.outcome).toBe('SUCCESS'); expect(r.risk.level).toBe('elevated'); });
  it('a credential-stuffing address is refused BEFORE any account is looked up', async () => {
    const { r, checked } = await run({ stuffingBlocked: async () => true }, false);
    expect(r.outcome).toBe('RATE_LIMITED'); expect(checked).toBe(0);
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a8300000-0000-4000-8000-0000000000a1', B = 'b8300000-0000-4000-8000-0000000000b1', U = 'c8300000-0000-4000-8000-0000000000c1', FRESH = 'c8300000-0000-4000-8000-0000000000c2';
describe.skipIf(!url)('risk signals on real Postgres', () => {
  let db: Kysely<any>; let pool: pg.Pool; let risk: KyselyLoginRisk;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) }); risk = new KyselyLoginRisk(db);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'RK', 'RK', 'rk-salon', 'RKSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    for (const [u, e] of [[U, 'rk@example.test'], [FRESH, 'rk-fresh@example.test']]) await sql`insert into users (id, tenant_id, branch_id, email, password_hash, status, role) values (${u}, ${T}, ${B}, ${e}, 'x', 'active', 'OWNER') on conflict (id) do nothing`.execute(db);
    await sql`delete from auth_devices where user_id in (${U}, ${FRESH})`.execute(db); await sql`delete from auth_events where user_id in (${U}, ${FRESH})`.execute(db);
    await sql`insert into auth_devices (user_id, device_key_hash, trust_state) values (${U}, ${hashDeviceKey('dv_home_home_home_home')}, 'recognized')`.execute(db);
    await sql`insert into auth_events (event_type, outcome, user_id, ip) values ('LOGIN_SUCCEEDED', 'success', ${U}, '198.51.100.20')`.execute(db);
    await sql`delete from login_attempts where ip_address in ('192.0.2.50', '192.0.2.51')`.execute(db);
  });
  afterAll(async () => { await sql`delete from login_attempts where ip_address in ('192.0.2.50', '192.0.2.51')`.execute(db).catch(() => undefined); for (const u of [U, FRESH]) { await sql`delete from auth_devices where user_id = ${u}`.execute(db).catch(() => undefined); await sql`delete from auth_events where user_id = ${u}`.execute(db).catch(() => undefined); } await db?.destroy(); });

  it('known device or known network → normal; unknown device on an unknown network → elevated; no history → normal', async () => {
    expect((await risk.assess(U, 'dv_home_home_home_home', '203.0.113.5')).level).toBe('normal');   // known device
    expect((await risk.assess(U, 'dv_new_new_new_new_new', '198.51.100.99')).level).toBe('normal');   // same /24 as before
    expect(await risk.assess(U, 'dv_new_new_new_new_new', '203.0.113.5')).toEqual({ level: 'elevated', signals: { newDevice: true, newNetwork: true, hasHistory: true } });
    expect((await risk.assess(FRESH, null, '203.0.113.5')).level).toBe('normal');                    // first sign-ins after deploy
  });
  it(`stuffing: ${STUFFING_DISTINCT_ACCOUNTS} different accounts failing from one address → blocked; one fewer → not; one account failing many times → not`, async () => {
    for (let i = 0; i < STUFFING_DISTINCT_ACCOUNTS - 1; i++) await sql`insert into login_attempts (identifier, ip_address, success) values (${'victim' + i + '@x.test'}, '192.0.2.50', false)`.execute(db);
    expect(await risk.stuffingBlocked('192.0.2.50')).toBe(false);
    await sql`insert into login_attempts (identifier, ip_address, success) values ('victim-last@x.test', '192.0.2.50', false)`.execute(db);
    expect(await risk.stuffingBlocked('192.0.2.50')).toBe(true);
    for (let i = 0; i < 30; i++) await sql`insert into login_attempts (identifier, ip_address, success) values ('same@x.test', '192.0.2.51', false)`.execute(db);
    expect(await risk.stuffingBlocked('192.0.2.51')).toBe(false);   // that is the per-account throttle's job
  });
});
