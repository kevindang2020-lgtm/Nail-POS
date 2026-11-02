// step-up-attempt-budget.pgtest — Security Deep Scan C4: POST /auth/step-up re-proves a password for a session that is
// already signed in, and had NO attempt limit — a hijacked session was an unlimited password oracle. Now 5 wrong
// attempts per account per 15 minutes (Postgres, no Redis): after them even the RIGHT password and code are refused with
// 429 AUTH_ATTEMPTS_LOCKED, and the session is not stamped. On the old controller the last call below succeeded.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { hashPassword } from '@aipowersalon/auth';
import { totpCode } from '@aipowersalon/identity';
import { StepUpController } from './step-up';
import { seedRow } from '../events/pgtest-seed';

const U = '56565656-5656-4565-8565-565656565656', S = '57575757-5656-4565-8565-565656565657', SECRET = 'JBSWY3DPEHPK3PXP';
const mfa = { decrypt: (x: string) => x.replace(/^sealed:/, '') };
let db: any; let pg: any;
const req = () => ({ sessionId: S, ip: '198.51.100.20', ctx: { userId: U, role: 'SUPER_ADMIN' } });

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'users', { id: U, email: 'sa2@platform.test', role: 'SUPER_ADMIN', platform_role: 'PLATFORM_SUPER_ADMIN', status: 'active', password_hash: await hashPassword('correct horse battery') });
  await seedRow(pg, 'mfa_factors', { user_id: U, type: 'totp', confirmed: true, secret_enc: 'sealed:' + SECRET });
  await seedRow(pg, 'sessions', { id: S, user_id: U, status: 'active', expires_at: new Date(Date.now() + 3600_000).toISOString() });
});

describe('C4 — step-up attempts are budgeted', () => {
  it('5 wrong passwords, then the correct password + code is refused (429) and nothing is stamped; a HIGH event is recorded', async () => {
    const security: any[] = [];
    const ctl = new StepUpController(db, mfa, null, { async record(e: any) { security.push(e); return true; } } as any);
    const now = Date.now();
    for (let i = 0; i < 5; i++) await expect(ctl.stepUp({ password: 'wrong ' + i, code: totpCode(SECRET, now) }, req(), () => now)).rejects.toMatchObject({ status: 403 });
    await expect(ctl.stepUp({ password: 'correct horse battery', code: totpCode(SECRET, now) }, req(), () => now)).rejects.toMatchObject({ status: 429 });
    expect((await sql<any>`select last_step_up_at from sessions where id = ${S}`.execute(db)).rows[0].last_step_up_at).toBeNull();
    await new Promise((r) => setImmediate(r));
    expect(security).toHaveLength(1);
    expect(security[0]).toMatchObject({ type: 'LOGIN_FAILED_BURST', severity: 'HIGH', actorId: U });
  });
});
