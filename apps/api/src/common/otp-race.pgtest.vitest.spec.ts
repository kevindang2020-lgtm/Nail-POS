// otp-race.pgtest — Constitution 12 §112–114: a one-time code is used ONCE and guessed at most MAX times, even concurrently.
import { SuperAdminOtpService, KyselySuperAdminOtpStore } from '@aipowersalon/identity';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const U = 'd4d4d4d4-0000-4000-8000-00000000000a';
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ('${U}', NULL, 'SA', 'sa-otp@x.test', 'x', 'active', 'SUPER_ADMIN') ON CONFLICT DO NOTHING`);
});
beforeEach(async () => { await pg.exec(`DELETE FROM super_admin_login_otp WHERE user_id = '${U}'`); });
async function issued(): Promise<{ svc: SuperAdminOtpService; code: string }> {
  let code = '';
  const svc = new SuperAdminOtpService(new KyselySuperAdminOtpStore(db), { send: async (_to: string, body: string) => { code = body.match(/\d{6}/)![0]; return { sid: 's' }; } } as any);
  await svc.issueAndSend(U, '+18565550142');
  return { svc, code };
}

describe('single use holds under concurrency', () => {
  it('the SAME correct code submitted twice at once yields exactly ONE success', async () => {
    const { svc, code } = await issued();
    const results = await Promise.all([svc.verify(U, code), svc.verify(U, code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('and it cannot be replayed afterwards', async () => {
    const { svc, code } = await issued();
    expect(await svc.verify(U, code)).toBe(true);
    expect(await svc.verify(U, code)).toBe(false);
  });
});

describe('the attempt cap holds under concurrency', () => {
  it('20 wrong guesses fired at once are all refused AND lock the challenge — then even the right code fails', async () => {
    const { svc, code } = await issued();
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 20 }, () => svc.verify(U, wrong)));
    expect((await pg.query(`SELECT attempts FROM super_admin_login_otp WHERE user_id = $1`, [U])).rows[0].attempts).toBeLessThanOrEqual(5);
    expect(await svc.verify(U, code)).toBe(false);          // locked: a fresh code is required
  });
});

describe('customer activation codes — the same two races, same fix', () => {
  it('one correct code submitted twice at once verifies ONCE; twenty parallel wrong guesses cannot outrun the limit', async () => {
    const { CustomerActivationService } = await import('@aipowersalon/booking') as any;
    const { KyselyActivationRepo } = await import('@aipowersalon/booking') as any;
    const { InMemoryTicketStore: Tickets } = await import('@aipowersalon/booking') as any;
    const PHONE = '+18565550199';
    await pg.exec(`DELETE FROM customer_phone_verifications WHERE normalized_phone = '${PHONE}'`);
    let code = '';
    const svc = new CustomerActivationService(new KyselyActivationRepo(db), { sendSms: async (msg: { body: string }) => { code = msg.body.match(/\d{6}/)![0]; return { sent: true, status: 'sent' as const }; } }, new Tickets());
    await svc.requestCode({ phone: PHONE });
    const [a, b] = await Promise.all([svc.verifyCode({ phone: PHONE, code }), svc.verifyCode({ phone: PHONE, code })]);
    expect([a, b].filter((r: any) => r.outcome !== 'FAILED')).toHaveLength(1);

    await pg.exec(`DELETE FROM customer_phone_verifications WHERE normalized_phone = '${PHONE}'`);
    await svc.requestCode({ phone: PHONE });
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 20 }, () => svc.verifyCode({ phone: PHONE, code: wrong })));
    expect((await pg.query(`SELECT max(attempts)::int m FROM customer_phone_verifications WHERE normalized_phone = $1`, [PHONE])).rows[0].m).toBeLessThanOrEqual(5);
    expect((await svc.verifyCode({ phone: PHONE, code })).outcome).toBe('FAILED');
  });
});

describe('temporary-password (reset) codes — six digits, the most serious of the three', () => {
  it('twenty parallel wrong guesses cannot outrun the limit; then even the right code is refused', async () => {
    const { PasswordResetService } = await import('@aipowersalon/identity') as any;
    const { makeKyselyResetPorts } = await import('@aipowersalon/identity') as any;
    const T = 'd5d5d5d5-0000-4000-8000-00000000000a', RU = 'd6d6d6d6-0000-4000-8000-00000000000a', PH = '+18565550177';
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'R', 'R', 'rst-t', 'RSTT1', 'active') ON CONFLICT DO NOTHING;
      INSERT INTO users (id, tenant_id, full_name, email, normalized_phone, password_hash, status, role) VALUES ('${RU}', '${T}', 'R', 'rst@x.test', '${PH}', 'x', 'active', 'MANAGER') ON CONFLICT DO NOTHING;
      DELETE FROM password_reset_tokens WHERE user_id = '${RU}';`);
    let temp = '';
    const svc = new PasswordResetService(makeKyselyResetPorts(db, { send: async (_to: string, body: string) => { temp = body.match(/APS-\d{6}/)![0]; return { sid: 's' }; } } as any));
    await svc.requestReset({ salonCode: 'RSTT1', phone: PH });
    expect(temp).toMatch(/^APS-\d{6}$/);
    const wrong = temp === 'APS-000000' ? 'APS-111111' : 'APS-000000';
    await Promise.all(Array.from({ length: 20 }, () => svc.loginWithTemp({ tenantCodeOrSlug: 'RSTT1', emailOrPhone: PH, password: wrong })));
    const row = (await pg.query(`SELECT attempt_count, max_attempts FROM password_reset_tokens WHERE user_id = $1`, [RU])).rows[0];
    expect(row.attempt_count).toBeLessThanOrEqual(row.max_attempts);
    expect((await svc.loginWithTemp({ tenantCodeOrSlug: 'RSTT1', emailOrPhone: PH, password: temp })).ok).toBe(false);
  });
});
