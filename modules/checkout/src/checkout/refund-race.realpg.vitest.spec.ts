// refund-race.realpg — Constitution 12 L6: the refund cap and the manager-approval rule under REAL concurrency.
//
// Two refund reservations for the same payment, on two real connections, at the same moment. PGlite could not run
// this (one session; the advisory lock never blocks itself) — the pre-existing over-refund cap let both pass there
// too. Real PostgreSQL serializes them on pg_advisory_xact_lock, so the second re-sums after the first commits.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startRealPostgres } from '@aipowersalon/testing';

const T = 'f1f1f1f1-0000-4000-8000-00000000000a', B = 'f2f2f2f2-0000-4000-8000-00000000000a', U = 'f3f3f3f3-0000-4000-8000-00000000000a';
let real: any; let repo: any;
beforeAll(async () => {
  real = await startRealPostgres();
  if (!real) return;
  await real.pool.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1, 'R', 'R', 'race-t', 'RACE1', 'active') ON CONFLICT DO NOTHING`, [T]);
  await real.pool.query(`INSERT INTO branches (id, tenant_id, name) VALUES ($1, $2, 'Main') ON CONFLICT DO NOTHING`, [B, T]);
  const { KyselyCheckoutRepository } = await import('./checkout.kysely.repository') as any;
  repo = new KyselyCheckoutRepository(real.db);
}, 120_000);
afterAll(async () => { await real?.stop(); });

const ctx = (role: string) => ({ tenantId: T, branchId: B, userId: U, role, permissions: ['*'] }) as any;
const pay = () => `e0e0e0e0-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
// Decided at collection time (before beforeAll runs): the binaries' location is the only thing known that early.
const skip = () => !process.env.REALPG_MODULES;

describe('L6 — real PostgreSQL, real concurrency', () => {
  it.skipIf(skip())('two $30 refunds of a $50 payment, at once, on two connections: exactly ONE passes the over-refund cap', async () => {
    const id = pay();
    const [a, b] = await Promise.all([
      repo.reserveRefundAtomic(ctx('OWNER'), { paymentId: id, capturedCents: 5_000, amountCents: 3_000, method: 'card', canApprove: true }),
      repo.reserveRefundAtomic(ctx('OWNER'), { paymentId: id, capturedCents: 5_000, amountCents: 3_000, method: 'card', canApprove: true }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = [a, b].find((r) => !r.ok) as any;
    expect(loser.refundable).toBe(2_000);                       // the loser saw the winner's $30 already reserved
  });
  it.skipIf(skip())('two $30 CASH refunds by front desk, at once: exactly ONE passes the manager-approval rule (M9), the other is told to get a manager', async () => {
    const id = pay();
    const [a, b] = await Promise.all([
      repo.reserveRefundAtomic(ctx('FRONT_DESK'), { paymentId: id, capturedCents: 10_000, amountCents: 3_000, method: 'cash' }),
      repo.reserveRefundAtomic(ctx('FRONT_DESK'), { paymentId: id, capturedCents: 10_000, amountCents: 3_000, method: 'cash' }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ ok: false, approvalRequired: true });
  });
  it.skipIf(skip())('ten refunds fired at once against one payment never exceed what was captured', async () => {
    const id = pay();
    const rs = await Promise.all(Array.from({ length: 10 }, () => repo.reserveRefundAtomic(ctx('OWNER'), { paymentId: id, capturedCents: 10_000, amountCents: 3_000, method: 'card', canApprove: true })));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);            // 3 × $30 = $90 ≤ $100; a 4th would exceed it
    const total = (await real.pool.query(`SELECT coalesce(sum(amount_cents), 0)::int s FROM payment_refunds WHERE payment_id = $1`, [id])).rows[0].s;
    expect(total).toBeLessThanOrEqual(10_000);
  });
  it('says plainly when it did not run', () => { if (skip()) console.log('realpg: REALPG_MODULES not set — real-PostgreSQL tests skipped (they are not claimed)'); else expect(real, 'REALPG_MODULES set but the database did not start').toBeTruthy(); });
});

describe('H8 on real PostgreSQL — one-time codes under real concurrent connections', () => {
  const SA = 'f4f4f4f4-0000-4000-8000-00000000000a';
  it.skipIf(skip())('the same correct Super Admin code on two connections at once: exactly ONE login; twenty parallel wrong guesses cannot outrun the limit', async () => {
    await real.pool.query(`INSERT INTO users (id, tenant_id, full_name, email, password_hash, status, role) VALUES ($1, NULL, 'SA', 'sa-race@x.test', 'x', 'active', 'SUPER_ADMIN') ON CONFLICT DO NOTHING`, [SA]);
    const { SuperAdminOtpService } = await import('@aipowersalon/identity') as any;
    const { KyselySuperAdminOtpStore } = await import('@aipowersalon/identity') as any;
    let code = '';
    const svc = () => new SuperAdminOtpService(new KyselySuperAdminOtpStore(real.db), { send: async (_t: string, body: string) => { code = body.match(/\d{6}/)![0]; return { sid: 's' }; } });
    await svc().issueAndSend(SA, '+18565550142');
    const results = await Promise.all([svc().verify(SA, code), svc().verify(SA, code)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await real.pool.query(`DELETE FROM super_admin_login_otp WHERE user_id = $1`, [SA]);
    await svc().issueAndSend(SA, '+18565550142');
    const wrong = code === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 20 }, () => svc().verify(SA, wrong)));
    expect((await real.pool.query(`SELECT attempts FROM super_admin_login_otp WHERE user_id = $1`, [SA])).rows[0].attempts).toBeLessThanOrEqual(5);
    expect(await svc().verify(SA, code)).toBe(false);
  });
});
