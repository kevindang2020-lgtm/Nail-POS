// pin-set-security.pgtest — Oct 12 2026 merge (other-chat workforce audit P0 #6/#8), against the real schema.
//   • /auth/set-pin requires RE-AUTHENTICATION: the current password always works; once a PIN exists the current PIN
//     is accepted instead. A bare { pin } (what any open POS tab could send) is refused and nothing changes.
//   • it is rate-limited per user, fleet-wide (5 failed attempts / 10 min, counted in auth_events).
//   • the new PIN is 4–8 digits, hashed with the password hasher, audited (audit_events user_pin_set via AuditService) with no PIN in it.
//   • /auth/verify-pin still has NO default PIN (an unset PIN is pin_not_set, never 1234).
import { describe, it, expect, beforeAll } from 'vitest';
import { AuthController } from './auth.controller';
import { KyselyAuthEvents } from './auth-events';
import { hashPassword, verifyPassword } from '@aipowersalon/auth';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AuditService, KyselyAuditRepository } from '@aipowersalon/audit';

let pg: any; let db: any; let ctl: AuthController;
const T = 'c0c0c0c0-0000-4000-8000-0000000000a1', B = 'c0c0c0c0-0000-4000-8000-0000000000b1';
const U_NOPIN = 'c0c0c0c0-0000-4000-8000-0000000000d1', U_PIN = 'c0c0c0c0-0000-4000-8000-0000000000d2', U_RL = 'c0c0c0c0-0000-4000-8000-0000000000d3';

function res() {
  const out: any = { statusCode: 0, body: null };
  out.status = (c: number) => { out.statusCode = c; return out; };
  out.json = (b: any) => { out.body = b; return out; };
  return out;
}
const req = (userId: string) => ({ ctx: { userId, tenantId: T, branchId: B, role: 'FRONT_DESK' }, headers: {}, ip: '203.0.113.5' });
const pinHash = async (id: string) => (await pg.query(`select pin_hash from users where id = $1`, [id])).rows[0].pin_hash;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'P', 'P', 'pin-t', 'PINT1', 'active') ON CONFLICT DO NOTHING;
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING`);
  const pw = await hashPassword('Passw0rd!');
  await pg.query(`INSERT INTO users (id, tenant_id, branch_id, full_name, email, status, role, mfa_enabled, must_change_password, password_hash, pin_hash)
                  VALUES ($1,$2,$3,'No Pin','nopin@pin.test','active','FRONT_DESK',false,false,$5,null),
                         ($4,$2,$3,'Has Pin','haspin@pin.test','active','FRONT_DESK',false,false,$5,$6),
                         ($7,$2,$3,'Rate Limited','rl@pin.test','active','FRONT_DESK',false,false,$5,null)`, [U_NOPIN, T, B, U_PIN, pw, await hashPassword('4321'), U_RL]);
  ctl = new AuthController({} as any, {} as any, undefined, db, undefined, undefined, undefined, new KyselyAuthEvents(db), undefined, undefined, new AuditService(new KyselyAuditRepository(db)));
});

describe('/auth/verify-pin has no default PIN', () => {
  it('a user with no PIN is NOT verified by 1234', async () => {
    const r = res(); await ctl.verifyPin(req(U_NOPIN), { pin: '1234' }, r);
    expect(r.statusCode).toBe(403); expect(r.body.code).toBe('pin_not_set');
  });
});

describe('/auth/set-pin', () => {
  it('refuses a bare { pin } (no password, no current PIN) and leaves the PIN unchanged', async () => {
    const r = res(); await ctl.setPin(req(U_PIN), { pin: '9876' }, r);
    expect(r.statusCode).toBe(403); expect(r.body.code).toBe('STEP_UP_REQUIRED');
    expect(await verifyPassword('4321', await pinHash(U_PIN))).toBe(true);
  });
  it('refuses a wrong password', async () => {
    const r = res(); await ctl.setPin(req(U_PIN), { pin: '9876', currentPassword: 'wrong' }, r);
    expect(r.statusCode).toBe(403);
  });
  it('sets the PIN with the current password; audit row without the PIN in it', async () => {
    const r = res(); await ctl.setPin(req(U_NOPIN), { pin: '2468', currentPassword: 'Passw0rd!' }, r);
    expect(r.statusCode).toBe(200);
    const hash = await pinHash(U_NOPIN);
    expect(hash).toBeTruthy(); expect(hash).not.toBe('2468');
    expect(await verifyPassword('2468', hash)).toBe(true);
    // through modules/audit (audit_events, tenant-scoped) — re-pinned Oct 12 2026 from the raw audit_logs insert
    const a = (await pg.query(`select metadata from audit_events where action = 'user_pin_set' and actor_user_id = $1 and tenant_id = $2`, [U_NOPIN, T])).rows;
    expect(a.length).toBe(1);
    expect(JSON.stringify(a[0].metadata)).not.toContain('2468');
    expect(JSON.stringify(a[0].metadata)).toContain('password');
  });
  it('changes the PIN with the CURRENT PIN once one exists', async () => {
    const r = res(); await ctl.setPin(req(U_PIN), { pin: '1357', currentPin: '4321' }, r);
    expect(r.statusCode).toBe(200);
    expect(await verifyPassword('1357', await pinHash(U_PIN))).toBe(true);
  });
  it('rejects a non-numeric / too-short / too-long PIN', async () => {
    for (const pin of ['abc', '12', '123456789']) {
      const r = res(); await ctl.setPin(req(U_PIN), { pin, currentPin: '1357' }, r);
      expect(r.statusCode, pin).toBe(400);
    }
  });
  it('is rate-limited: 5 failed re-authentications in 10 minutes → 429, even with the right password', async () => {
    for (let i = 0; i < 5; i++) { const r = res(); await ctl.setPin(req(U_RL), { pin: '1357', currentPassword: 'wrong' }, r); expect(r.statusCode).toBe(403); }
    const r = res(); await ctl.setPin(req(U_RL), { pin: '1357', currentPassword: 'Passw0rd!' }, r);
    expect(r.statusCode).toBe(429);
    expect(await pinHash(U_RL)).toBeNull();
    // the window is in the shared auth_events table, so every instance sees the same count
    expect(Number((await pg.query(`select count(*)::int as n from auth_events where event_type = 'PIN_SET_FAILED' and user_id = $1`, [U_RL])).rows[0].n)).toBe(5);
    // a failure recorded by ANOTHER instance 15 minutes ago is outside the window
    await pg.query(`update auth_events set occurred_at = now() - interval '15 minutes' where event_type = 'PIN_SET_FAILED' and user_id = $1`, [U_RL]);
    const ok = res(); await ctl.setPin(req(U_RL), { pin: '8642', currentPassword: 'Passw0rd!' }, ok);
    expect(ok.statusCode).toBe(200);
  });
});
