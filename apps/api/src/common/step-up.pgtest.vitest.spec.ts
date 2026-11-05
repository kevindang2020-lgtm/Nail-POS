// step-up.pgtest — Constitution 7 §8 on the real schema: a critical route is refused without a fresh step-up; password +
// TOTP re-proven for the SAME session stamps it; a wrong password or a replayed code does not; the stamp expires.
import { describe, it, expect, beforeAll } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { hashPassword } from '@aipowersalon/auth';
import { STEP_UP_META } from '@aipowersalon/permissions/guards';
import { StepUpGuard, StepUpController } from './step-up';
import { seedRow } from '../events/pgtest-seed';
import { createHmac } from 'node:crypto';

// RFC 6238 TOTP for the test (base32 secret → 6 digits), so the code the controller verifies is computed independently
function b32(s: string) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0'); const out: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
function totp(secret: string, atMs: number) { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000))); const h = createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, '0'); }

const U = '54545454-5454-4545-8545-545454545454', S = '55555555-5454-4545-8545-545454545455', SECRET = 'JBSWY3DPEHPK3PXP';
const mfa = { decrypt: (x: string) => x.replace(/^sealed:/, '') };
let db: any; let ctl: StepUpController;
const req = () => ({ sessionId: S, ctx: { userId: U, role: 'SUPER_ADMIN' } });
function guardCtx(maxAge: number | undefined) {
  const r = req(); const handler = () => undefined;
  const reflector = { get: (k: string) => (k === STEP_UP_META ? maxAge : undefined) } as unknown as Reflector;
  return { guard: new StepUpGuard(reflector, db), context: { getType: () => 'http', switchToHttp: () => ({ getRequest: () => r }), getHandler: () => handler } as any };
}

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'users', { id: U, email: 'sa@platform.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN', status: 'active', password_hash: await hashPassword('correct horse battery') });
  await seedRow(pg, 'mfa_factors', { user_id: U, type: 'totp', confirmed: true, secret_enc: 'sealed:' + SECRET });
  await seedRow(pg, 'sessions', { id: S, user_id: U, status: 'active', expires_at: new Date(Date.now() + 3600_000).toISOString() });
  ctl = new StepUpController(db, mfa);
});

describe('step-up for critical platform actions (§8)', () => {
  it('a route without @RequireStepUp is untouched; a critical route is refused with STEP_UP_REQUIRED before any step-up', async () => {
    let g = guardCtx(undefined); expect(await g.guard.canActivate(g.context)).toBe(true);
    g = guardCtx(300); await expect(g.guard.canActivate(g.context)).rejects.toThrow(ForbiddenException);
  });
  it('a wrong password is refused with 403 (never 401, which would sign the app out) and stamps nothing', async () => {
    const now = Date.now();
    await expect(ctl.stepUp({ password: 'wrong password', code: totp(SECRET, now) }, req(), () => now)).rejects.toMatchObject({ status: 403 });
    expect((await sql<any>`select last_step_up_at from sessions where id = ${S}`.execute(db)).rows[0].last_step_up_at).toBeNull();
  });
  it('password + TOTP for this session stamps it, and the critical route then passes', async () => {
    const now = Date.now();
    expect(await ctl.stepUp({ password: 'correct horse battery', code: totp(SECRET, now) }, req(), () => now)).toMatchObject({ ok: true });
    const g = guardCtx(300); expect(await g.guard.canActivate(g.context)).toBe(true);
  });
  it('the same code cannot be used twice (single use per 30-second step)', async () => {
    const now = Date.now();
    await expect(ctl.stepUp({ password: 'correct horse battery', code: totp(SECRET, now) }, req(), () => now)).rejects.toMatchObject({ status: 403 });
  });
  it('the stamp expires: a route demanding a step-up within 0 seconds of an older stamp is refused', async () => {
    await sql`update sessions set last_step_up_at = now() - interval '10 minutes' where id = ${S}`.execute(db);
    const g = guardCtx(300); await expect(g.guard.canActivate(g.context)).rejects.toThrow(ForbiddenException);
  });
  it('without a confirmed authenticator a platform account cannot step up (password + MFA is the rule, not password alone)', async () => {
    await sql`update mfa_factors set confirmed = false where user_id = ${U}`.execute(db);
    await expect(ctl.stepUp({ password: 'correct horse battery', code: '123456' }, req(), () => Date.now())).rejects.toMatchObject({ status: 409 });
    await sql`update mfa_factors set confirmed = true where user_id = ${U}`.execute(db);
  });
});
