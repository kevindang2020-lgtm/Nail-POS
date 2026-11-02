// step-up-all-realms.postgres-race.vitest.spec.ts — Constitution 3 Step 5: step-up opened to every realm, with the
// proof scaled to the account, the strength on the session, and every attempt in auth_events; plus the event scrubber.
// Real Postgres part opt-in: PG_RACE_URL (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { hashPassword } from '@aipowersalon/auth';
import { KyselyAuthEvents, scrubAuthMetadata, maskIdentifier, generateSecret, totpCode } from '@aipowersalon/identity';
import { StepUpController } from './step-up';

describe('auth events — nothing replayable is stored', () => {
  it('credential-named keys are dropped at any depth; identifiers are masked', () => {
    expect(scrubAuthMetadata({ portal: 'tenant', password: 'x', mfaCode: '123456', nested: { refreshToken: 'rt_x', ok: true }, Authorization: 'Bearer y', pin: '1234' }))
      .toEqual({ portal: 'tenant', nested: { ok: true } });
    expect(maskIdentifier('maria@salon.com')).toBe('m***@salon.com');
    expect(maskIdentifier('+1 (856) 555-0101')).toBe('***0101');
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a7e00000-0000-4000-8000-0000000000a1', B = 'b7e00000-0000-4000-8000-0000000000b1';
const OWNER = 'c7e00000-0000-4000-8000-0000000000c1', SA = 'c7e00000-0000-4000-8000-0000000000c2', MFAU = 'c7e00000-0000-4000-8000-0000000000c3';
describe.skipIf(!url)('step-up for every realm (real Postgres)', () => {
  let db: Kysely<any>; let pool: pg.Pool; let ctl: StepUpController; const secret = generateSecret();
  const mfa = { decrypt: (s: string) => s };   // the factor's secret stored as-is in this test
  const sessionFor = async (userId: string, tenantId: string | null) => String(((await sql`insert into sessions (user_id, tenant_id, status, expires_at) values (${userId}::uuid, ${tenantId}::uuid, 'active', now() + interval '1 hour') returning id`.execute(db)).rows[0] as any).id);
  const req = (userId: string, sid: string, tenantId: string | null) => ({ ctx: { userId, tenantId }, sessionId: sid, headers: { 'user-agent': 'vitest' } });
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 3 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    ctl = new StepUpController(db, mfa, new KyselyAuthEvents(db));
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'SU', 'SU', 'su-salon', 'SUSL', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    const h = await hashPassword('Step-Up-Passphrase-1!');
    await sql`insert into users (id, tenant_id, branch_id, email, password_hash, status, role) values (${OWNER}, ${T}, ${B}, 'su-owner@example.test', ${h}, 'active', 'OWNER'), (${MFAU}, ${T}, ${B}, 'su-mfa@example.test', ${h}, 'active', 'MANAGER') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, email, password_hash, status, role) values (${SA}, null, 'su-sa@example.test', ${h}, 'active', 'SUPER_ADMIN') on conflict (id) do nothing`.execute(db);
    await sql`delete from mfa_factors where user_id = ${MFAU}`.execute(db);
    await sql`insert into mfa_factors (user_id, type, secret_enc, confirmed) values (${MFAU}, 'totp', ${secret}, true)`.execute(db);
    await sql`delete from auth_events where user_id in (${OWNER}, ${SA}, ${MFAU})`.execute(db);
  });
  afterAll(async () => { for (const u of [OWNER, SA, MFAU]) { await sql`delete from auth_events where user_id = ${u}`.execute(db).catch(() => undefined); await sql`delete from sessions where user_id = ${u}`.execute(db).catch(() => undefined); } await sql`delete from mfa_factors where user_id = ${MFAU}`.execute(db).catch(() => undefined); await db?.destroy(); });

  it('a salon owner WITHOUT an authenticator re-proves the password: stamped with strength "password", event recorded', async () => {
    const sid = await sessionFor(OWNER, T);
    await expect(ctl.stepUp({ password: 'wrong' }, req(OWNER, sid, T))).rejects.toMatchObject({ response: { code: 'STEP_UP_FAILED' } });
    expect(await ctl.stepUp({ password: 'Step-Up-Passphrase-1!' }, req(OWNER, sid, T))).toMatchObject({ ok: true, strength: 'password' });
    const s: any = (await sql`select last_step_up_at, step_up_strength, last_primary_auth_at from sessions where id = ${sid}::uuid`.execute(db)).rows[0];
    expect(s).toMatchObject({ step_up_strength: 'password' }); expect(s.last_step_up_at).not.toBeNull(); expect(s.last_primary_auth_at).not.toBeNull();
    let ev: any[] = []; for (let i = 0; i < 40 && ev.length < 2; i++) { ev = (await sql`select event_type, outcome, reason, metadata from auth_events where user_id = ${OWNER} and event_type like 'STEP_UP_%' order by occurred_at`.execute(db)).rows; if (ev.length < 2) await new Promise((r) => setTimeout(r, 25)); }
    expect(ev.map((e) => `${e.event_type}:${e.outcome}:${e.reason ?? ''}`)).toEqual(['STEP_UP_FAILED:failure:wrong_password', 'STEP_UP_SUCCEEDED:success:']);
    expect(JSON.stringify(ev)).not.toMatch(/Step-Up-Passphrase|wrong"/);
  });
  it('an account WITH an authenticator must give password AND code; strength "password_mfa"; a replayed code is refused', async () => {
    const sid = await sessionFor(MFAU, T);
    await expect(ctl.stepUp({ password: 'Step-Up-Passphrase-1!' }, req(MFAU, sid, T))).rejects.toMatchObject({ response: { code: 'INVALID' } });
    const code = totpCode(secret, Date.now());
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(ctl.stepUp({ password: 'Step-Up-Passphrase-1!', code: wrong }, req(MFAU, sid, T))).rejects.toMatchObject({ response: { code: 'STEP_UP_FAILED' } });   // right password, wrong code
    expect(await ctl.stepUp({ password: 'Step-Up-Passphrase-1!', code }, req(MFAU, sid, T))).toMatchObject({ ok: true, strength: 'password_mfa' });
    await expect(ctl.stepUp({ password: 'Step-Up-Passphrase-1!', code }, req(MFAU, sid, T))).rejects.toMatchObject({ response: { code: 'STEP_UP_FAILED' } });
  });
  it('a SUPER_ADMIN without an authenticator is still refused — never downgraded to password-only', async () => {
    const sid = await sessionFor(SA, null);
    await expect(ctl.stepUp({ password: 'Step-Up-Passphrase-1!' }, req(SA, sid, null))).rejects.toMatchObject({ response: { code: 'MFA_NOT_ENROLLED' } });
    // events are written fire-and-forget (they never delay the response) — wait for the row
    let ev: any; for (let i = 0; i < 40 && !ev; i++) { ev = (await sql`select event_type, reason from auth_events where user_id = ${SA}`.execute(db)).rows[0]; if (!ev) await new Promise((r) => setTimeout(r, 25)); }
    expect(ev).toMatchObject({ event_type: 'STEP_UP_FAILED', reason: 'mfa_not_enrolled' });
  });
});
