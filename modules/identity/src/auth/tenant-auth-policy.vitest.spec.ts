// tenant-auth-policy.vitest.spec.ts — Constitution 3 Step 9: the salon's sign-in policy is enforced.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { hashPassword } from '@aipowersalon/auth';
import { policyFromStored, PLATFORM_DEFAULT_POLICY, KyselyTenantAuthPolicy, type TenantAuthPolicy } from './tenant-auth-policy';
import { LoginService } from './auth-login.service';
import { generateSecret } from './totp';

describe('policy reading', () => {
  it('no saved policy → today’s behaviour (passkeys stay ON even though the stored default says off)', () => {
    expect(policyFromStored(null)).toEqual(PLATFORM_DEFAULT_POLICY);
    expect(PLATFORM_DEFAULT_POLICY).toMatchObject({ explicit: false, passkeyEnabled: true, mfaForOwner: false });
  });
  it('a saved policy is enforced as saved', () => {
    expect(policyFromStored({ mfaForOwner: true, passkeyEnabled: false, pinLogin: false, rememberTrustedDevices: false })).toEqual({ explicit: true, mfaForOwner: true, passkeyEnabled: false, pinLogin: false, rememberTrustedDevices: false, autoLockEnabled: true, autoLockMinutes: 60 });
  });
  it('POS auto-lock (Kevin, Oct 12 2026): ON at 60 minutes for every salon unless it saved another choice', () => {
    expect(PLATFORM_DEFAULT_POLICY).toMatchObject({ autoLockEnabled: true, autoLockMinutes: 60 });
    expect(policyFromStored({ pinLogin: true })).toMatchObject({ autoLockEnabled: true, autoLockMinutes: 60 });   // saved before the field existed
    expect(policyFromStored({ autoLockEnabled: false, autoLockMinutes: 15 })).toMatchObject({ autoLockEnabled: false, autoLockMinutes: 15 });
    expect(policyFromStored({ autoLockMinutes: 7 })).toMatchObject({ autoLockMinutes: 60 });                     // not a choice
  });
});

describe('sign-in under "require two-factor for owners and managers"', () => {
  let hash: string; beforeAll(async () => { hash = await hashPassword('Policy-Passphrase-1!'); });
  const run = async (role: string, totp: boolean, policy: Partial<TenantAuthPolicy>, mfaCode?: string) => {
    const user: any = { userId: 'u1', tenantId: 't1', branchId: 'b1', role, status: 'active', passwordHash: hash, mfaEnabled: false, fullName: 'X', email: 'x@x.test', normalizedPhone: null, totpSecret: totp ? generateSecret() : null };
    const repo: any = { async findTenantUserForLogin() { return { tenantFound: true, tenantStatus: 'active', subscriptionStatus: 'active', user, branchCount: 1, singleBranchId: 'b1' }; },
      async findSuperAdminForLogin() { return {}; }, async findCustomersForLogin() { return []; }, async markTotpStepUsed() { return true; } };
    const svc = new LoginService(repo, undefined, undefined, undefined, undefined, { get: async () => ({ ...PLATFORM_DEFAULT_POLICY, explicit: true, ...policy }) });
    return svc.attempt({ portal: 'tenant', salonCode: 'S', identifier: 'x@x.test', password: 'Policy-Passphrase-1!', ...(mfaCode ? { mfaCode } : {}) } as any);
  };
  it('an OWNER or MANAGER with an authenticator must give the code', async () => {
    expect((await run('OWNER', true, { mfaForOwner: true })).outcome).toBe('MFA_REQUIRED');
    expect((await run('MANAGER', true, { mfaForOwner: true })).outcome).toBe('MFA_REQUIRED');
  });
  it('an OWNER without one signs in to a session limited to setting it up — never locked out', async () => {
    const r: any = await run('OWNER', false, { mfaForOwner: true });
    expect(r.outcome).toBe('SUCCESS'); expect(r.principal.restriction).toBe('MFA_ENROLLMENT_REQUIRED');
  });
  it('front desk is not covered; with the policy off nothing changes', async () => {
    const fd: any = await run('FRONT_DESK', true, { mfaForOwner: true }); expect(fd.outcome).toBe('SUCCESS'); expect(fd.principal.restriction).toBeUndefined();
    const off: any = await run('OWNER', true, { mfaForOwner: false }); expect(off.outcome).toBe('SUCCESS');
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a8100000-0000-4000-8000-0000000000a1', T2 = 'a8100000-0000-4000-8000-0000000000a2';
describe.skipIf(!url)('policy store on real Postgres', () => {
  let db: Kysely<any>; let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    for (const [t, slug] of [[T, 'pol-a'], [T2, 'pol-b']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase()}, 'active') on conflict (id) do nothing`.execute(db);
    await sql`delete from tenant_settings where tenant_id in (${T}, ${T2})`.execute(db);
    await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'security', ${JSON.stringify({ mfaForOwner: true, passkeyEnabled: false, pinLogin: true, rememberTrustedDevices: false, auditRetention: '90d' })}::jsonb)`.execute(db);
  });
  afterAll(async () => { await sql`delete from tenant_settings where tenant_id in (${T}, ${T2})`.execute(db).catch(() => undefined); await db?.destroy(); });
  it('a salon that saved its policy gets it; a salon that never did keeps today’s behaviour', async () => {
    const store = new KyselyTenantAuthPolicy(db);
    expect(await store.get(T)).toEqual({ explicit: true, mfaForOwner: true, passkeyEnabled: false, pinLogin: true, rememberTrustedDevices: false, autoLockEnabled: true, autoLockMinutes: 60 });
    expect(await store.get(T2)).toEqual(PLATFORM_DEFAULT_POLICY);
  });
});
