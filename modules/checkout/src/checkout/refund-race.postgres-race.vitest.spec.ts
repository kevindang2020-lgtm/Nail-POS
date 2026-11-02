// refund-race.postgres-race — Constitution 12 L6 + mandate P0 §228/§223 (Oct 20 2026): the refund cap, the
// manager-approval rule and the LOST-ANSWER refund under REAL concurrency.
//
// Until Oct 20 2026 this file was `refund-race.realpg.vitest.spec.ts`, opted in by REALPG_MODULES — which nothing ever
// set, so it had never run. It is now part of the race lane (`*.postgres-race.vitest.spec.ts`, PG_RACE_URL, tooling/ci/
// run-race-tests.mjs), which refuses to pass on a skipped test.
//
// Two refund reservations for the same payment, on two real connections, at the same moment. PGlite could not run
// this (one session; the advisory lock never blocks itself) — the pre-existing over-refund cap let both pass there
// too. Real PostgreSQL serializes them on pg_advisory_xact_lock, so the second re-sums after the first commits.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';
import { PaymentAttemptSweep } from './payment-attempt-sweep';
import { KyselyPaymentAttemptSweepStore } from './payment-attempt-sweep.kysely';

const url = process.env.PG_RACE_URL;
const T = 'f1f1f1f1-0000-4000-8000-00000000000a', B = 'f2f2f2f2-0000-4000-8000-00000000000a', U = 'f3f3f3f3-0000-4000-8000-00000000000a';
let pool: pg.Pool; let db: Kysely<any>; let repo: KyselyCheckoutRepository;
const real = { get pool() { return pool; }, get db() { return db; } };
beforeAll(async () => {
  if (!url) return;
  pool = new pg.Pool({ connectionString: url, max: 12 }); db = new Kysely({ dialect: new PostgresDialect({ pool }) });
  await pool.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1, 'R', 'R', 'race-t', 'RACE1', 'active') ON CONFLICT DO NOTHING`, [T]);
  await pool.query(`INSERT INTO branches (id, tenant_id, name) VALUES ($1, $2, 'Main') ON CONFLICT DO NOTHING`, [B, T]);
  repo = new KyselyCheckoutRepository(db as any);
}, 120_000);
afterAll(async () => {
  if (!url) return;
  for (const t of ['payment_refunds', 'payments', 'tickets', 'customers', 'outbox_events', 'audit_logs']) await sql`DELETE FROM ${sql.table(t)} WHERE tenant_id = ${T}`.execute(db).catch(() => undefined);
  await sql`DELETE FROM super_admin_login_otp WHERE user_id = ${'f4f4f4f4-0000-4000-8000-00000000000a'}`.execute(db).catch(() => undefined);
  await sql`DELETE FROM users WHERE id = ${'f4f4f4f4-0000-4000-8000-00000000000a'}`.execute(db).catch(() => undefined);
  await sql`DELETE FROM branches WHERE id = ${B}`.execute(db).catch(() => undefined);
  await sql`DELETE FROM tenants WHERE id = ${T}`.execute(db).catch(() => undefined);
  await db.destroy();
});

const ctx = (role: string) => ({ tenantId: T, branchId: B, userId: U, role, permissions: ['*'] }) as any;
const CUST = 'f6f6f6f6-0000-4000-8000-00000000000a', TK = 'f5f5f5f5-0000-4000-8000-00000000000a';
const uuid = () => `e0e0e0e0-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
/** A REAL approved card payment (customer → ticket → payment): payment_refunds has had a foreign key to payments since
 *  migration 538 — the old random-id fixtures of this file would have failed on it, had the file ever run. */
async function pay(amount = 10_000): Promise<string> {
  const id = uuid();
  await pool.query(`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ($1, $2, $3, 'Race', 'Refund', 'Race Refund') ON CONFLICT DO NOTHING`, [CUST, T, B]);
  await pool.query(`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status, total_cents, payment_status) VALUES ($1, $2, $3, $4, 'paid', $5, 'paid') ON CONFLICT DO NOTHING`, [TK, T, B, CUST, amount]);
  await pool.query(`INSERT INTO payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, processor_transaction_id) VALUES ($1, $2, $3, $4, 'card', $5, 0, 'approved', 'RET-ORIG-RACE')`, [id, T, B, TK, amount]);
  return id;
}
const skip = () => !url;

describe.skipIf(!url)('L6 — real PostgreSQL, real concurrency', () => {
  it('two $30 refunds of a $50 payment, at once, on two connections: exactly ONE passes the over-refund cap', async () => {
    const id = await pay(5_000);
    const [a, b] = await Promise.all([
      repo.reserveRefundAtomic(ctx('OWNER'), { paymentId: id, capturedCents: 5_000, amountCents: 3_000, method: 'card', canApprove: true }),
      repo.reserveRefundAtomic(ctx('OWNER'), { paymentId: id, capturedCents: 5_000, amountCents: 3_000, method: 'card', canApprove: true }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = [a, b].find((r) => !r.ok) as any;
    expect(loser.refundable).toBe(2_000);                       // the loser saw the winner's $30 already reserved
  });
  it('two $30 CASH refunds by front desk, at once: exactly ONE passes the manager-approval rule (M9), the other is told to get a manager', async () => {
    const id = await pay(10_000);
    const [a, b] = await Promise.all([
      repo.reserveRefundAtomic(ctx('FRONT_DESK'), { paymentId: id, capturedCents: 10_000, amountCents: 3_000, method: 'cash' }),
      repo.reserveRefundAtomic(ctx('FRONT_DESK'), { paymentId: id, capturedCents: 10_000, amountCents: 3_000, method: 'cash' }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect([a, b].find((r) => !r.ok)).toMatchObject({ ok: false, approvalRequired: true });
  });
  it('ten refunds fired at once against one payment never exceed what was captured', async () => {
    const id = await pay(10_000);
    const rs = await Promise.all(Array.from({ length: 10 }, () => repo.reserveRefundAtomic(ctx('OWNER'), { paymentId: id, capturedCents: 10_000, amountCents: 3_000, method: 'card', canApprove: true })));
    expect(rs.filter((r) => r.ok)).toHaveLength(3);            // 3 × $30 = $90 ≤ $100; a 4th would exceed it
    const total = (await real.pool.query(`SELECT coalesce(sum(amount_cents), 0)::int s FROM payment_refunds WHERE payment_id = $1`, [id])).rows[0].s;
    expect(total).toBeLessThanOrEqual(10_000);
  });
});

describe.skipIf(!url)('H8 on real PostgreSQL — one-time codes under real concurrent connections', () => {
  const SA = 'f4f4f4f4-0000-4000-8000-00000000000a';
  it('the same correct Super Admin code on two connections at once: exactly ONE login; twenty parallel wrong guesses cannot outrun the limit', async () => {
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

describe.skipIf(!url)('mandate P0 §228 — a card refund whose processor answer was lost, on real PostgreSQL', () => {
  const ctxU = { ...ctx('OWNER'), permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment', 'pos.checkout.refund', 'pos.checkout.approve_refund'] };
  const settings = async () => ({ ...(await repo.settings(ctxU)), fiservStatus: 'connected' });
  class Connected extends KyselyCheckoutRepository { async settings(c: any) { return settings() as any; } }
  const timeoutProcessor = (n: { refunds: number }) => ({ name: 'spy', async refund() { n.refunds++; const e: any = new Error('ETIMEDOUT'); throw e; }, async authorizeAndCapture() { return { approved: true, retref: 'RET-ORIG-RACE' }; }, async voidTransaction() { return { approved: true }; } }) as any;
  const rows = async (paymentId: string) => (await pool.query(`SELECT status, amount_cents FROM payment_refunds WHERE payment_id = $1 ORDER BY created_at`, [paymentId])).rows;

  it('timeout: the reservation stays as processing; ten retries at once reach the processor ZERO more times', async () => {
    const n = { refunds: 0 }; const svc = new CheckoutService(new Connected(db as any), undefined, undefined, timeoutProcessor(n));
    const id = await pay(5_000);
    await expect(svc.refund(ctxU, id, { reason: 'lost', amountCents: 1_500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    expect(n.refunds).toBe(1);
    expect(await rows(id)).toEqual([{ status: 'processing', amount_cents: 1500 }]);
    const retries = await Promise.allSettled(Array.from({ length: 10 }, () => svc.refund(ctxU, id, { reason: 'lost', amountCents: 1_500 })));
    for (const r of retries) { expect(r.status).toBe('rejected'); expect((r as any).reason.message).toBe('REFUND_PENDING_VERIFICATION'); }
    expect(n.refunds).toBe(1);                                                   // before: 11 refunds sent
    expect(await rows(id)).toEqual([{ status: 'processing', amount_cents: 1500 }]);
    // another amount on the same payment is refused too, until the first is settled
    await expect(svc.refund(ctxU, id, { reason: 'other', amountCents: 500 })).rejects.toMatchObject({ message: 'REFUND_PENDING_VERIFICATION' });
  });

  it('the sweep settles it from the processor record: found → refunded exactly once under ten concurrent sweepers; not found → released', async () => {
    const n = { refunds: 0 }; const svc = new CheckoutService(new Connected(db as any), undefined, undefined, timeoutProcessor(n));
    const id = await pay(5_000);
    await expect(svc.refund(ctxU, id, { reason: 'lost', amountCents: 1_500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    const refundId = (await pool.query(`SELECT id FROM payment_refunds WHERE payment_id = $1`, [id])).rows[0].id;
    await pool.query(`UPDATE payment_refunds SET created_at = now() - interval '1 hour' WHERE id = $1`, [refundId]);   // past the stranded window
    const answer = { kind: 'answer' as const, processor: 'cardpointe', transactions: [{ retref: 'RET-ORIG-RACE', approved: true, declined: false, amountCents: 5_000 }, { retref: 'RET-RFND-RACE', approved: true, declined: false, amountCents: 1_500 }] };
    const sweep = () => new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db as any), { inquire: async () => answer, reconcileCard: async () => 'none', settleRefund: (t, b, rid, outcome, note) => svc.settleUnknownRefundFromSweep(t, b, rid, outcome, note) });
    const logs: string[] = [];
    const sweepL = () => new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db as any), { inquire: async () => answer, reconcileCard: async () => 'none', settleRefund: (t, b, rid, outcome, note) => svc.settleUnknownRefundFromSweep(t, b, rid, outcome, note) }, { log: (m) => logs.push(m) });
    const reports = await Promise.all(Array.from({ length: 10 }, () => sweepL().run()));
    expect(reports.reduce((a, r) => a + r.refundsSettled, 0), JSON.stringify({ reports: reports.map((r) => [r.refundsChecked, r.refundsSettled, r.refundsWaiting, r.refundsNeedReview, r.errors]), logs })).toBe(1);
    expect(await rows(id)).toEqual([{ status: 'refunded', amount_cents: 1500 }]);
    const refunded = (await pool.query(`SELECT amount_cents, processor_transaction_id FROM payments WHERE ticket_id = $1 AND status = 'refunded'`, [TK])).rows;
    expect(refunded).toEqual([{ amount_cents: 1500, processor_transaction_id: 'RET-RFND-RACE' }]);
    expect(n.refunds).toBe(1);                                                   // the sweep never sends a refund
    await pool.query(`DELETE FROM payments WHERE ticket_id = $1 AND status = 'refunded'`, [TK]);

    // not found at the processor → released; the cashier may refund again
    const id2 = await pay(5_000);
    await expect(svc.refund(ctxU, id2, { reason: 'lost', amountCents: 1_500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    await pool.query(`UPDATE payment_refunds SET created_at = now() - interval '1 hour' WHERE payment_id = $1`, [id2]);
    const onlyOriginal = { kind: 'answer' as const, processor: 'cardpointe', transactions: [{ retref: 'RET-ORIG-RACE', approved: true, declined: false, amountCents: 5_000 }] };
    const r2 = await new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db as any), { inquire: async () => onlyOriginal, reconcileCard: async () => 'none', settleRefund: (t, b, rid, outcome, note) => svc.settleUnknownRefundFromSweep(t, b, rid, outcome, note) }, { refundReleaseTrusted: true }).run();   // the confirmed-listing case (Oct 28: held for a person otherwise)
    expect(r2.refundsReleased).toBe(1);
    expect(await rows(id2)).toEqual([]);
    const ok = new CheckoutService(new Connected(db as any), undefined, undefined, { name: 'spy', async refund() { return { ok: true, respstat: 'A', retref: 'RET-RFND-2' }; }, async authorizeAndCapture() { return { approved: true }; }, async voidTransaction() { return { approved: true }; } } as any);
    expect((await ok.refund(ctxU, id2, { reason: 'again', amountCents: 1_500 }) as any).status).toBe('refunded');
  });

  it('an undecidable one is handed to a person ONCE (one review mark, one alert) by ten concurrent sweepers', async () => {
    const n = { refunds: 0 }; const svc = new CheckoutService(new Connected(db as any), undefined, undefined, timeoutProcessor(n));
    const id = await pay(5_000);
    await expect(svc.refund(ctxU, id, { reason: 'lost', amountCents: 1_500 })).rejects.toMatchObject({ message: 'REFUND_STATUS_UNKNOWN' });
    await pool.query(`UPDATE payment_refunds SET created_at = now() - interval '1 hour' WHERE payment_id = $1`, [id]);
    const alerts: any[] = [];
    class AlertStore extends KyselyPaymentAttemptSweepStore { async raiseAlert(a: any) { alerts.push(a); } }
    const sweep = () => new PaymentAttemptSweep(new AlertStore(db as any), { inquire: async () => ({ kind: 'not_connected' }), reconcileCard: async () => 'none', settleRefund: async () => ({ settled: false }) });
    await Promise.all(Array.from({ length: 10 }, () => sweep().run()));
    expect(alerts).toHaveLength(1);
    expect((await pool.query(`SELECT status, review_reason IS NOT NULL AS flagged FROM payment_refunds WHERE payment_id = $1`, [id])).rows).toEqual([{ status: 'processing', flagged: true }]);
  });
});
