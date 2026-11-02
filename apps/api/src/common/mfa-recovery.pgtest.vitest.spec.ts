// Constitution 7 §24 on the real schema — Reset MFA through a secure workflow, end to end: a platform administrator
// resets (factors gone, sessions ended, one single-use token); the user re-enrols with token + own password + a live code.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { createHmac } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { hashPassword } from '@aipowersalon/auth';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { KyselyPlatformStaffRepository } from '@aipowersalon/super-admin';
import { MfaRecoveryController } from '../../../../modules/identity/src/auth/mfa-recovery.controller';

function b32(s: string) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0'); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret: string, atMs: number) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000))); const h = createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0'); }

const ADMIN = '78787878-7878-4787-8787-787878787878', USER = '79797979-7979-4797-8797-797979797979';
const all = platformPermissionsFor('PLATFORM_SUPER_ADMIN') as string[];
let db: any; let repo: KyselyPlatformStaffRepository; let ctl: MfaRecoveryController;
const plain = { encrypt: (s: string) => 'sealed:' + s, decrypt: (s: string) => s.replace(/^sealed:/, '') } as any;
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`insert into users (id, email, role, status, platform_role) values ($1, 'admin@platform.test', 'SUPER_ADMIN', 'active', 'PLATFORM_SUPER_ADMIN')`, [ADMIN]);
  await pg.query(`insert into users (id, email, role, status, platform_role, password_hash) values ($1, 'lost.phone@platform.test', 'SUPER_ADMIN', 'active', 'PLATFORM_SUPPORT', $2)`, [USER, await hashPassword('correct horse battery')]);
  await pg.query(`insert into mfa_factors (user_id, type, secret_enc, confirmed) values ($1, 'totp', 'sealed:OLDSECRETOLDSECR', true)`, [USER]);
  await pg.query(`insert into sessions (user_id, status, expires_at) values ($1, 'active', now() + interval '1 hour')`, [USER]);
  repo = new KyselyPlatformStaffRepository(db); ctl = new MfaRecoveryController(db, plain);
});

describe('MFA reset and recovery (§24)', () => {
  let token = '';
  it('reset: refused for yourself and without a reason; otherwise removes the factor, ends sessions, issues a token, audits', async () => {
    expect(await repo.resetMfa({ userId: ADMIN, permissions: all }, ADMIN, 'lost my own phone')).toMatchObject({ ok: false, code: 'self_change' });
    expect(await repo.resetMfa({ userId: ADMIN, permissions: all }, USER, 'x')).toMatchObject({ ok: false, code: 'reason_required' });
    const r: any = await repo.resetMfa({ userId: ADMIN, permissions: all }, USER, 'user lost their phone');
    expect(r.ok).toBe(true); token = r.token;
    expect((await sql<any>`select count(*)::int n from mfa_factors where user_id = ${USER}`.execute(db)).rows[0].n).toBe(0);
    expect((await sql<any>`select count(*)::int n from sessions where user_id = ${USER} and revoked_at is null`.execute(db)).rows[0].n).toBe(0);
    expect((await sql<any>`select token_hash from mfa_recovery_tokens where user_id = ${USER}`.execute(db)).rows[0].token_hash).not.toBe(token);   // only the hash is stored
    expect((await sql<any>`select count(*)::int n from audit_logs where action_type = 'platform_user_mfa_reset'`.execute(db)).rows[0].n).toBe(1);
  });
  it('recovery needs the token AND the password; the token alone is refused (and counted)', async () => {
    await expect(ctl.start({ token, password: 'wrong password' })).rejects.toMatchObject({ status: 400 });
    expect((await sql<any>`select failed_attempts from mfa_recovery_tokens where user_id = ${USER}`.execute(db)).rows[0].failed_attempts).toBe(1);
    await expect(ctl.start({ token: 'not-a-token', password: 'correct horse battery' })).rejects.toMatchObject({ status: 400 });
  });
  it('token + password → a new secret; a live code confirms it; the token is then spent', async () => {
    const s = await ctl.start({ token, password: 'correct horse battery' });
    expect(s.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(await ctl.confirm({ token, code: totp(s.secret, Date.now()) })).toEqual({ ok: true, confirmed: true });
    expect((await sql<any>`select confirmed from mfa_factors where user_id = ${USER}`.execute(db)).rows.map((r: any) => r.confirmed)).toEqual([true]);
    await expect(ctl.start({ token, password: 'correct horse battery' })).rejects.toMatchObject({ status: 400 });   // single use
  });
  it('five wrong attempts burn a fresh token', async () => {
    const r: any = await repo.resetMfa({ userId: ADMIN, permissions: all }, USER, 'lost the phone again');
    for (let i = 0; i < 5; i++) await expect(ctl.start({ token: r.token, password: 'nope nope nope' })).rejects.toBeTruthy();
    await expect(ctl.start({ token: r.token, password: 'correct horse battery' })).rejects.toMatchObject({ status: 400 });
  });
});
