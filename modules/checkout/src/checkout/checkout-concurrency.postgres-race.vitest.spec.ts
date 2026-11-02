// checkout-concurrency.postgres-race.vitest.spec.ts — Smooth Refresh spec §76/§107: two POS stations completing the
// same visit must never create two payments. TRUE concurrency needs real Postgres (PGlite is single-session).
// Opt-in: PG_RACE_URL=postgres://... (a migrated database).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutInProgressError, type PaymentRecord } from './checkout.dto';

const url = process.env.PG_RACE_URL;
const T = 'a3000000-0000-4000-8000-0000000000aa';
const B = 'b3000000-0000-4000-8000-0000000000bb';
const C = 'd3000000-0000-4000-8000-0000000000dd';
const TK = 'f3000000-0000-4000-8000-0000000000ff';
const ctx = { tenantId: T, branchId: B, userId: 'e3000000-0000-4000-8000-0000000000ee', role: 'FRONT_DESK', permissions: [] } as any;
const cash = (i: number): PaymentRecord => ({ paymentId: `p${i}`, ticketId: TK, method: 'cash', amountCents: 5000, tipCents: 0, status: 'approved', changeDueCents: 0, createdAt: new Date().toISOString() } as any);

let db: Kysely<any>; let pool: pg.Pool; let repo: KyselyCheckoutRepository;
const paymentRows = async () => Number((await sql<{ n: number }>`select count(*)::int as n from payments where tenant_id = ${T} and ticket_id = ${TK}`.execute(db)).rows[0].n);

describe.skipIf(!url)('real-Postgres checkout races (Smooth Refresh spec §76, §107)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 24 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    repo = new KyselyCheckoutRepository(db as any);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Race Salon K', 'Race Salon K', 'race-salon-k', 'RACEK', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Kim', 'Vo', 'Kim Vo') on conflict (id) do nothing`.execute(db);
    await sql`insert into tickets (id, tenant_id, branch_id, customer_id) values (${TK}, ${T}, ${B}, ${C}) on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    await sql`delete from payments where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from gift_card_transactions where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`delete from gift_cards where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('ten stations take cash for the same visit at once — ONE payment row, nine CHECKOUT_ALREADY_IN_PROGRESS', async () => {
    await sql`delete from payments where tenant_id = ${T}`.execute(db);
    // A DETERMINISTIC race (a plain Promise.all is not one: each transaction finishes before the next pool connection
    // opens, so a missing lock went unnoticed — the first mutation check of this test survived). Hold SHARE on payments:
    // every station can still READ paid-so-far, but every INSERT blocks until we release. Without the ticket row lock
    // all ten read 0 and all ten insert; with it, nine wait at the lock and then see the first payment.
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('lock table payments in share mode');
    const pending = Promise.allSettled(Array.from({ length: 10 }, (_, i) => repo.recordPaymentIfUnchanged(ctx, cash(i), 0)));
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    const results = await pending;
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const losers = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(losers).toHaveLength(9);
    expect(losers.every((r) => r.reason instanceof CheckoutInProgressError && r.reason.code === 'CHECKOUT_ALREADY_IN_PROGRESS')).toBe(true);
    expect(await paymentRows()).toBe(1);
  });

  // Oct 4 2026 — gift card and split had no visit lock / paid-amount check: two simultaneous taps on a card that could
  // cover the bill twice debited it twice and recorded two payments; a double-tapped split recorded every segment twice
  // (reproduced live through the API). Same deterministic gate as above: every station reads paid-so-far, none can
  // insert a payment until the gate opens. Without the lock, all ten debit the card and all ten insert.
  const holdPaymentsThen = async <T,>(run: () => Promise<T>[]) => {
    const gate = await pool.connect();
    await gate.query('begin'); await gate.query('lock table payments in share mode');
    const pending = Promise.allSettled(run());
    await new Promise((r) => setTimeout(r, 400));
    await gate.query('commit'); gate.release();
    return pending;
  };
  const balance = async (code: string) => Number((await sql<{ b: number }>`select balance_cents as b from gift_cards where tenant_id = ${T} and code = ${code}`.execute(db)).rows[0].b);
  const redeems = async (code: string) => Number((await sql<{ n: number }>`select count(*)::int as n from gift_card_transactions t join gift_cards g on g.id = t.gift_card_id where g.tenant_id = ${T} and g.code = ${code} and t.type = 'redeem'`.execute(db)).rows[0].n);

  it('ten simultaneous gift-card taps on a card that covers the bill ten times — ONE debit, ONE payment', async () => {
    await sql`delete from payments where tenant_id = ${T}`.execute(db);
    const code = 'GC-RACE-' + Date.now();
    await repo.issueGiftCard(ctx, { code, amountCents: 100000 } as any);
    const gift = (i: number): PaymentRecord => ({ paymentId: `g${i}`, ticketId: TK, method: 'gift_card', amountCents: 5388, tipCents: 0, status: 'approved', createdAt: new Date().toISOString() } as any);
    const results = await holdPaymentsThen(() => Array.from({ length: 10 }, (_, i) => repo.redeemGiftAndRecordIfUnchanged(ctx, code, 5388, undefined, gift(i), 0)));
    expect(results.filter((r) => r.status === 'fulfilled' && r.value)).toHaveLength(1);
    expect((results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]).every((r) => r.reason instanceof CheckoutInProgressError)).toBe(true);
    expect(await paymentRows()).toBe(1);
    expect(await redeems(code)).toBe(1);
    expect(await balance(code)).toBe(100000 - 5388);
  });

  it('ten simultaneous identical splits (gift + cash) — ONE settlement, the card debited once', async () => {
    await sql`delete from payments where tenant_id = ${T}`.execute(db);
    const code = 'GC-SPLIT-' + Date.now();
    await repo.issueGiftCard(ctx, { code, amountCents: 100000 } as any);
    const segs = [{ method: 'gift_card' as any, amountCents: 2000, giftCardCode: code }, { method: 'cash' as any, amountCents: 3388 }];
    const results = await holdPaymentsThen(() => Array.from({ length: 10 }, () => repo.recordSplitAtomic(ctx, TK, segs, { expectedPaidCents: 0 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await paymentRows()).toBe(2);                  // the one settlement's two segments
    expect(await redeems(code)).toBe(1);
    expect(await balance(code)).toBe(100000 - 2000);
  });

  it('after a void the visit is payable again (the guard reads paid-so-far, not a sticky key)', async () => {
    await sql`delete from payments where tenant_id = ${T}`.execute(db);
    const first = await repo.recordPaymentIfUnchanged(ctx, cash(1), 0);
    await sql`update payments set status = 'voided' where id = ${first.paymentId}`.execute(db);
    const again = await repo.recordPaymentIfUnchanged(ctx, cash(2), 0);
    expect(again.paymentId).not.toBe(first.paymentId);
  });
});
