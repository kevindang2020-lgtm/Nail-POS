// ephemeral-grants.pgtest — migration 456: short-lived grants survive a restart, work on any instance, and are single-use.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyEphemeralGrants, grantHash } from '@aipowersalon/auth';
import { GrantTicketStore } from '@aipowersalon/booking';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });

describe('the store', () => {
  it('stores only the SHA-256 of the token — a database read yields no usable grant', async () => {
    const token = await new KyselyEphemeralGrants(db).put('activation_ticket', { phone: '+18565550100' }, 60_000);
    const rows = (await pg.query(`SELECT token_hash, payload::text p FROM ephemeral_grants`)).rows;
    expect(rows.some((r: any) => r.token_hash === grantHash(token))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
  it('a grant made on server A is redeemed on server B — two instances, one database', async () => {
    const A = new KyselyEphemeralGrants(db), B = new KyselyEphemeralGrants(db);
    const token = await A.put('activation_ticket', { phone: '+18565550101' }, 60_000);
    expect(await B.take('activation_ticket', token)).toEqual({ phone: '+18565550101' });
  });
  it('single use under concurrency: two simultaneous redemptions, exactly one wins', async () => {
    const g = new KyselyEphemeralGrants(db); const token = await g.put('activation_ticket', { phone: 'x' }, 60_000);
    const [a, b] = await Promise.all([new KyselyEphemeralGrants(db).take('activation_ticket', token), new KyselyEphemeralGrants(db).take('activation_ticket', token)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
  it('peek does not consume; take does', async () => {
    const g = new KyselyEphemeralGrants(db); const t = await g.put('password_reset_session', { userId: 'u' }, 60_000);
    expect(await g.peek('password_reset_session', t)).toEqual({ userId: 'u' }); expect(await g.peek('password_reset_session', t)).toEqual({ userId: 'u' });
    expect(await g.take('password_reset_session', t)).toEqual({ userId: 'u' }); expect(await g.take('password_reset_session', t)).toBeNull();
  });
  it('an expired grant is refused (and removed); a grant of the wrong kind is refused', async () => {
    let now = Date.now(); const g = new KyselyEphemeralGrants(db, () => now);
    const t = await g.put('activation_ticket', { phone: 'x' }, 1_000);
    expect(await g.peek('password_reset_session', t)).toBeNull();          // wrong kind
    now += 2_000;
    expect(await g.peek('activation_ticket', t)).toBeNull(); expect(await g.take('activation_ticket', t)).toBeNull();
  });
});

describe('activation tickets survive a restart', () => {
  it('issued by one GrantTicketStore, redeemed once by a fresh one (a restarted or second server)', async () => {
    const issued = await new GrantTicketStore(new KyselyEphemeralGrants(db)).issue('+18565550102', [{ tenantId: 't', salonName: 'S' } as any]);
    expect(issued).toMatch(/^tkt_[A-Za-z0-9_-]{43}$/);
    const fresh = new GrantTicketStore(new KyselyEphemeralGrants(db));
    expect(await fresh.consume(issued)).toMatchObject({ phone: '+18565550102' });
    expect(await fresh.consume(issued)).toBeNull();
    expect(await fresh.consume('tkt-1-guess')).toBeNull();
  });
});

describe('password reset survives a restart, and stores no plaintext', () => {
  it('temp password accepted on server A, new password chosen on server B; the temp code itself is still refused', async () => {
    const { PasswordResetService } = await import('@aipowersalon/identity') as any;
    const { makeKyselyResetPorts } = await import('@aipowersalon/identity') as any;
    const T = 'e1e1e1e1-0000-4000-8000-00000000000a', U = 'e2e2e2e2-0000-4000-8000-00000000000a', PH = '+18565550188';
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'G', 'G', 'grt-t', 'GRTT1', 'active') ON CONFLICT DO NOTHING;
      INSERT INTO users (id, tenant_id, full_name, email, normalized_phone, password_hash, status, role) VALUES ('${U}', '${T}', 'G', 'grt@x.test', '${PH}', 'x', 'active', 'MANAGER') ON CONFLICT DO NOTHING`);
    let temp = '';
    const sms = { send: async (_to: string, body: string) => { temp = body.match(/APS-\d{6}/)![0]; return { sid: 's' }; } } as any;
    const A = new PasswordResetService(makeKyselyResetPorts(db, sms)), B = new PasswordResetService(makeKyselyResetPorts(db, sms));
    await A.requestReset({ salonCode: 'GRTT1', phone: PH });
    const login = await A.loginWithTemp({ tenantCodeOrSlug: 'GRTT1', emailOrPhone: PH, password: temp });
    expect(login.ok).toBe(true);
    const rst = login.resetSessionToken;
    expect(JSON.stringify((await pg.query(`SELECT payload FROM ephemeral_grants WHERE kind = 'password_reset_session'`)).rows)).not.toContain(temp);   // no plaintext stored
    await expect(B.completeReset({ resetSessionToken: rst, newPassword: temp, confirmPassword: temp })).rejects.toThrow(/cannot be the temporary password/);
    const prevSecret = process.env.AUTH_SESSION_SECRET; process.env.AUTH_SESSION_SECRET = 'x'.repeat(48);   // minting the new session needs one
    let done: any;
    try { done = await B.completeReset({ resetSessionToken: rst, newPassword: 'NewSecret99', confirmPassword: 'NewSecret99' }); }
    finally { if (prevSecret === undefined) delete process.env.AUTH_SESSION_SECRET; else process.env.AUTH_SESSION_SECRET = prevSecret; }
    expect(done.userId).toBe(U);
    // The reset session itself is consumed — not only protected by the (separately single-use) token. A mutation that
    // left it reusable survived until this line: the token alone was already refusing the replay.
    expect(await new KyselyEphemeralGrants(db).peek('password_reset_session', rst)).toBeNull();
    await expect(B.completeReset({ resetSessionToken: rst, newPassword: 'Other12345', confirmPassword: 'Other12345' })).rejects.toThrow(/invalid_or_expired/);
  });
});
