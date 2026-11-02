// split-tender-lost-card.postgres-race.vitest.spec.ts — Remaining Production §60 / §22 (Oct 27 2026) on REAL PostgreSQL: a POS
// card (straight, or the card segment of a split) loses its processor answer. While it is mid-air, other employees on
// other connections try — at the same moment — CASH, a GIFT CARD, ANOTHER CARD and a cash + gift SPLIT on the same ticket:
// every one is refused PAYMENT_STATUS_UNKNOWN before any money moves (no gift debit, no second processor call, no payment
// row). Then the stranded sweep settles the lost attempt from the processor's own record and exactly one tender completes
// the ticket. The services run WITHOUT the checkout lock, so the unsettled-tender guard alone (assertNoUnsettledCard →
// unsettled-tenders.ts) is what refuses them. Opt-in: PG_RACE_URL=postgres://… (migrated).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';
import { PaymentAttemptSweep } from './payment-attempt-sweep';
import { KyselyPaymentAttemptSweepStore } from './payment-attempt-sweep.kysely';

const url = process.env.PG_RACE_URL;
const T = 'a6600000-0000-4000-8000-0000000000aa', B = 'b6600000-0000-4000-8000-0000000000bb', C = 'c6600000-0000-4000-8000-0000000000cc';
const U = 'e6600000-0000-4000-8000-0000000000ee';
const PERMS = ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.card_payment', 'pos.checkout.gift_card_payment', 'pos.checkout.split_payment'];
const ctx: any = { tenantId: T, branchId: B, userId: U, role: 'FRONT_DESK', permissions: PERMS };
const MIN = 60_000;
let db: Kysely<any>; let pool: pg.Pool; let n = 0;

async function ticket(): Promise<string> {
  const id = `f6600000-0000-4000-8000-0000000002${String(++n).padStart(2, '0')}`;
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, tip_cents, tax_cents, discount_cents) values (${id}, ${T}, ${B}, ${C}, 'ready_checkout', 0, 0, 0)`.execute(db);
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${id}, '00000000-0000-0000-0000-000000000000', 'Gel Manicure', 4500, 45, 4500)`.execute(db);
  return id;
}
/** The salon's processor: `charge` = what an authorize does (lost = the socket dies after the processor took it); the
 *  inquiry replays `record` (the processor's own book). Counts every call. */
function processor(charge: 'lost' | 'approve', record: () => any[]) {
  const calls = { charge: 0, inquire: 0 };
  return { calls, p: {
    name: 'cardpointe',
    async authorizeAndCapture(i: any) { calls.charge++; await new Promise((r) => setTimeout(r, 30)); if (charge === 'lost') throw new Error('socket hang up'); return { approved: true, declined: false, retref: 'RT-OK-' + calls.charge, respstat: 'A', amountCents: i.amountCents }; },
    async inquireByOrderId() { calls.inquire++; return { transactions: record() }; },
  } };
}
/** Each "employee" is its own service + repository (its own pool connection per query) — four POS stations. */
const station = (p: any) => new CheckoutService(new KyselyCheckoutRepository(db as any), undefined, undefined, undefined, { resolve: async () => ({ processor: p }) } as any);
const balance = async (code: string) => Number(((await sql<any>`select balance_cents b from gift_cards where tenant_id = ${T} and code = ${code}`.execute(db)).rows[0] as any).b);
const pays = async (tk: string) => (await sql<any>`select method, status from payments where tenant_id = ${T} and ticket_id = ${tk} order by created_at`.execute(db)).rows as any[];
const reason = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? String((r.reason as any)?.message ?? r.reason) : 'fulfilled');

describe.skipIf(!url)('§60 / §22 — a lost POS / split card blocks concurrent cash, gift card, card and split (real Postgres)', () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    for (const t of ['payment_attempts', 'payments', 'gift_card_transactions', 'gift_cards', 'ticket_service_lines', 'receipts', 'tickets']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Split Race Salon', 'Split Race Salon', 'split-race-660', 'SPR660', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'Hoa', 'Pham', 'Hoa Pham') on conflict (id) do nothing`.execute(db);
  });
  afterAll(async () => {
    for (const t of ['payment_attempts', 'payments', 'gift_card_transactions', 'gift_cards', 'ticket_service_lines', 'receipts', 'tickets']) await sql`delete from ${sql.table(t)} where tenant_id = ${T}`.execute(db).catch(() => undefined);
    await db?.destroy();
  });

  it('straight POS card lost → cash, gift card, another card and a cash+gift split at once: all PAYMENT_STATUS_UNKNOWN, nothing moves; the sweep finds it approved → ONE approved payment, the ticket paid', async () => {
    const tk = await ticket();
    const code = 'GC-SPR-A-' + Date.now();
    await new KyselyCheckoutRepository(db as any).issueGiftCard(ctx, { code, amountCents: 20000 });
    let amount = 0;
    const live = processor('lost', () => [{ retref: 'RT-LOST-1', approved: true, declined: false, amountCents: amount }]);
    await expect(station(live.p).payCard(ctx, tk, { idempotencyKey: 'pos-card-1', cardToken: '9418594164541111', expiry: '1230' } as any)).rejects.toThrow(/PAYMENT_STATUS_UNKNOWN/);
    const lost = (await sql<any>`select id, status, amount_cents from payments where tenant_id = ${T} and ticket_id = ${tk}`.execute(db)).rows[0] as any;
    expect(lost.status).toBe('processing'); amount = Number(lost.amount_cents);

    const other = processor('approve', () => []);
    const out = await Promise.allSettled([
      station(other.p).payCash(ctx, tk, { amountReceivedCents: 10000 } as any),                                                     // employee 1: cash
      station(other.p).payGiftCard(ctx, tk, { giftCardCode: code } as any),                                                          // employee 2: gift card
      station(other.p).payCard(ctx, tk, { idempotencyKey: 'pos-card-2', cardToken: '9418594164542222', expiry: '1230' } as any),    // employee 3: another card
      station(other.p).paySplit(ctx, tk, { segments: [{ method: 'cash', amountCents: 2500 }, { method: 'gift_card', amountCents: 2000, giftCardCode: code }] } as any),   // employee 4: split
    ]);
    expect(out.map(reason)).toEqual(Array(4).fill('PAYMENT_STATUS_UNKNOWN'));
    expect(other.calls.charge).toBe(0);
    expect(live.calls.charge).toBe(1);
    expect(await balance(code)).toBe(20000);
    expect((await pays(tk)).map((p) => `${p.method}:${p.status}`)).toEqual(['card:processing']);

    // the stranded sweep's way in (reconcileStrandedCard = the cashier's Verify under the ticket's lock, as a system actor)
    await sql`update payments set created_at = now() - interval '30 minutes' where id = ${lost.id}`.execute(db);
    const sweepRuns = await Promise.all([station(live.p).reconcileStrandedCard(T, B, tk), station(live.p).reconcileStrandedCard(T, B, tk)]);
    expect(sweepRuns.map((r) => r.status).sort()).toContain('approved');
    expect((await pays(tk)).map((p) => `${p.method}:${p.status}`)).toEqual(['card:approved']);
    expect(((await sql<any>`select status from tickets where id = ${tk}`.execute(db)).rows[0] as any).status).toBe('paid');
    // and the cash a colleague tries afterwards is refused as "already paid", never a second payment
    await expect(station(other.p).payCash(ctx, tk, { amountReceivedCents: 10000 } as any)).rejects.toThrow(/already paid/i);
    expect(live.calls.charge + other.calls.charge).toBe(1);
  });

  it('split card segment lost → cash, gift card and another card at once: all refused; the sweep releases it (no record at the processor) → then cash and gift race: exactly ONE settles the ticket', async () => {
    const tk = await ticket();
    const code = 'GC-SPR-B-' + Date.now();
    await new KyselyCheckoutRepository(db as any).issueGiftCard(ctx, { code, amountCents: 20000 });
    const live = processor('lost', () => []);
    const due = (await new KyselyCheckoutRepository(db as any).totalsFor(ctx, tk, 'split'))!.totalDueCents;
    const giftDue = (await new KyselyCheckoutRepository(db as any).totalsFor(ctx, tk, 'gift_card'))!.totalDueCents;
    await expect(station(live.p).paySplit(ctx, tk, { segments: [{ method: 'card', amountCents: 2500 }, { method: 'cash', amountCents: due - 2500 }], cardToken: '9418594164541111', expiry: '1230' } as any)).rejects.toThrow(/PAYMENT_STATUS_UNKNOWN/);
    const att = (await sql<any>`select id, status from payment_attempts where tenant_id = ${T} and ticket_id = ${tk}`.execute(db)).rows[0] as any;
    expect(att.status).toBe('processing');

    const other = processor('approve', () => []);
    const out = await Promise.allSettled([
      station(other.p).payCash(ctx, tk, { amountReceivedCents: 10000 } as any),
      station(other.p).payGiftCard(ctx, tk, { giftCardCode: code } as any),
      station(other.p).payCard(ctx, tk, { idempotencyKey: 'pos-card-3', cardToken: '9418594164542222', expiry: '1230' } as any),
    ]);
    expect(out.map(reason)).toEqual(Array(3).fill('PAYMENT_STATUS_UNKNOWN'));
    expect(other.calls.charge).toBe(0);
    expect(await balance(code)).toBe(20000);
    expect(await pays(tk)).toEqual([]);

    // the sweep: the processor has no record of the split's card → released (nothing was charged)
    await sql`update payment_attempts set created_at = now() - interval '30 minutes' where id = ${att.id}`.execute(db);
    const inquire = async () => ({ kind: 'answer' as const, processor: 'cardpointe', transactions: [] });
    const reports = await Promise.all([0, 1].map(() => new PaymentAttemptSweep(new KyselyPaymentAttemptSweepStore(db as any), { inquire, reconcileCard: async () => 'none' as const }, { strandedMs: 15 * MIN }).run()));
    expect(reports.reduce((s, r) => s + r.splitsReleased, 0)).toBe(1);
    expect(((await sql<any>`select status from payment_attempts where id = ${att.id}`.execute(db)).rows[0] as any).status).not.toBe('processing');

    // now two colleagues tender at once: ONE wins, the other is refused (in progress / already paid) — never two payments
    const race = await Promise.allSettled([
      station(other.p).payCash(ctx, tk, { amountReceivedCents: 10000 } as any),
      station(other.p).payGiftCard(ctx, tk, { giftCardCode: code } as any),
    ]);
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const approved = (await pays(tk)).filter((p) => p.status === 'approved');
    expect(approved).toHaveLength(1);
    const giftDebited = 20000 - (await balance(code));
    expect(giftDebited).toBe(approved[0].method === 'gift_card' ? giftDue : 0);   // the losing gift tap debited nothing
    expect(live.calls.charge).toBe(1);
  });
});
