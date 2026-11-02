// mfa-recovery-codes.vitest.spec.ts — Constitution 3 §66–67 (Step 3): ten single-use codes, hash only, a new set retires
// the old, sign-in accepts one once in place of the authenticator; real Postgres for the store and the one-use race.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { RecoveryCodes, InMemoryRecoveryCodeStore, KyselyRecoveryCodeStore, newRecoveryCode, normalizeRecoveryCode, looksLikeRecoveryCode, hashRecoveryCode, RECOVERY_CODE_COUNT } from './mfa-recovery-codes';
import { LoginService } from './auth-login.service';
import { hashPassword } from '@aipowersalon/auth';
import { generateSecret } from './totp';

describe('recovery codes — the rule', () => {
  it('format XXXX-XXXX from an unambiguous alphabet; typing is forgiving; a 6-digit TOTP is not mistaken for one', () => {
    for (let i = 0; i < 50; i++) expect(newRecoveryCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(normalizeRecoveryCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(looksLikeRecoveryCode('abcd efgh')).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
    expect(hashRecoveryCode('u1', 'ABCD-EFGH')).not.toBe(hashRecoveryCode('u2', 'ABCD-EFGH'));   // bound to the user
  });
  it('ten codes, stored only as hashes; each works once; a new set retires the old one', async () => {
    const store = new InMemoryRecoveryCodeStore(); const rc = new RecoveryCodes(store);
    const first = await rc.generate('u1');
    expect(first).toHaveLength(RECOVERY_CODE_COUNT);
    expect(JSON.stringify(store.rows)).not.toContain(first[0]);
    expect(await rc.consume('u1', first[0].toLowerCase())).toBe(true);
    expect(await rc.consume('u1', first[0])).toBe(false);   // once
    expect(await rc.consume('u2', first[1])).toBe(false);   // another account
    expect(await rc.remaining('u1')).toBe(9);
    const second = await rc.generate('u1');
    expect(await rc.consume('u1', first[1])).toBe(false);   // retired
    expect(await rc.consume('u1', second[0])).toBe(true);
    expect(await rc.remaining('u1')).toBe(9);
  });
});

describe('sign-in accepts a recovery code once in place of the authenticator', () => {
  it('right password + a recovery code → SUCCESS; the same code again → MFA refused', async () => {
    const hash = await hashPassword('Owner-Passphrase-1!');
    const store = new InMemoryRecoveryCodeStore(); const rc = new RecoveryCodes(store); const codes = await rc.generate('u1');
    const user: any = { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'OWNER', status: 'active', passwordHash: hash, mfaEnabled: true, fullName: 'O', email: 'o@x.test', normalizedPhone: null, totpSecret: generateSecret() };
    const repo: any = {
      async findTenantUserForLogin() { return { tenantFound: true, tenantStatus: 'active', subscriptionStatus: 'active', user, branchCount: 1, singleBranchId: 'b1' }; },
      async findSuperAdminForLogin() { return {}; }, async findCustomersForLogin() { return []; },
      async markTotpStepUsed() { return true; },
      consumeRecoveryCode: (uid: string, c: string) => rc.consume(uid, c),
    };
    const svc = new LoginService(repo);
    const go = (code: string) => svc.attempt({ portal: 'tenant', salonCode: 'PALACE', identifier: 'o@x.test', password: 'Owner-Passphrase-1!', mfaCode: code } as any);
    expect((await go(codes[0])).outcome).toBe('SUCCESS');
    expect((await go(codes[0])).outcome).not.toBe('SUCCESS');
    expect((await go('ZZZZ-ZZZZ')).outcome).not.toBe('SUCCESS');
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a7c00000-0000-4000-8000-0000000000a1', B = 'b7c00000-0000-4000-8000-0000000000b1', U = 'c7c00000-0000-4000-8000-0000000000c1';
describe.skipIf(!url)('recovery codes on real Postgres (migration 495)', () => {
  let db: Kysely<any>; let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 12 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'RC', 'RC', 'rc-salon', 'RCSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, branch_id, email, password_hash, status, role) values (${U}, ${T}, ${B}, 'rc@example.test', 'x', 'active', 'OWNER') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => { await sql`delete from mfa_recovery_codes where user_id = ${U}`.execute(db).catch(() => undefined); await db?.destroy(); });
  it('generate / retire / remaining on the real table; ten simultaneous uses of ONE code → exactly one succeeds', async () => {
    const rc = new RecoveryCodes(new KyselyRecoveryCodeStore(db));
    const a = await rc.generate(U); const b = await rc.generate(U);
    expect(await rc.remaining(U)).toBe(10);
    expect(await rc.consume(U, a[0])).toBe(false);   // the first set is retired
    const results = await Promise.all(Array.from({ length: 10 }, () => rc.consume(U, b[0])));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await rc.remaining(U)).toBe(9);
  });
});
