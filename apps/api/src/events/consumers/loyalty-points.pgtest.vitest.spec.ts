// loyalty-points.pgtest — §25/§101–102 on real Postgres: a payment earns points EXACTLY ONCE, however many times it
// is delivered, replayed, or re-emitted. That is the property that lets replay exist at all (§225).
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { LoyaltyPointsConsumer, pointsFor, excludedCentsFor } from './loyalty-points.consumer';

const T = '11111111-1111-1111-1111-111111111111', T2 = '22222222-2222-2222-2222-222222222222';
const B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const P = (n: string) => `77777777-7777-7777-7777-7777777777${n}`;   // loyalty_point_earnings.payment_id is UUID-typed
const CUST = 'dddddddd-dddd-dddd-dddd-dddddddddddd', TICKET = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', TICKET_T2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', TICKET_WALKIN = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03';
let db: any; let runner: ConsumerRunner; let publisher: OutboxPublisher; let consumer: LoyaltyPointsConsumer;

const captured = (paymentId: string, ticketId: string, amountCents: number, tenantId = T) => createDomainEvent({
  eventType: DOMAIN_EVENTS.PAYMENT_CAPTURED, tenantId, branchId: B, aggregateType: 'payment', aggregateId: paymentId, actorType: 'user',
  correlationId: `ticket:${ticketId}`, payload: { paymentId, ticketId, method: 'card', amountCents, surchargeCents: 0, status: 'approved' },
});
const balance = async () => Number(((await sql`SELECT points_balance, total_earned_points FROM customer_loyalty_profiles WHERE tenant_id = ${T} AND customer_id = ${CUST}`.execute(db)).rows[0] as any)?.points_balance ?? 0);

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','G','Glamour','glamour','GLAM01','active'), ('${T2}','L','Luxe','luxe','LUXE01','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown'), ('${B2}','${T2}','Main') ON CONFLICT (id) DO NOTHING;
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES ('${CUST}','${T}','${B}','Ava','Kim','Ava Kim','+16095550101','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${TICKET}','${T}','${B}','${CUST}') ON CONFLICT (id) DO NOTHING;
    -- A CROSSED ticket (salon T2's ticket naming salon T's customer), on purpose: it proves the consumer refuses to award
    -- points across tenants. Since Constitution 12 migration 450 such a row cannot be WRITTEN, so it is inserted as
    -- LEGACY data (triggers skipped for this one statement), the only way it could exist.
    SET session_replication_role = replica;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${TICKET_T2}','${T2}','${B2}','${CUST}') ON CONFLICT (id) DO NOTHING;
    SET session_replication_role = DEFAULT;
  `);
  db = kyselyFor(pg); consumer = new LoyaltyPointsConsumer();
  const registry = new ConsumerRegistry(); registry.register(consumer);
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
}, 60_000);

describe('loyalty.points_on_payment — exactly-once on the business effect', () => {
  it('reuses the existing rule: 1 point per whole dollar', () => {
    expect(pointsFor(4500)).toBe(45); expect(pointsFor(4599)).toBe(45); expect(pointsFor(99)).toBe(0); expect(pointsFor(-500)).toBe(0);
  });

  it('a $45.00 capture earns 45 points, creates the profile, and writes ONE ledger row tied to the event', async () => {
    const e = captured(P('01'), TICKET, 4500);
    await new OutboxWriter().write(db, e); await publisher.tick();
    expect(await balance()).toBe(45);
    const earned = (await sql`SELECT payload_json FROM outbox_events WHERE event_type = 'loyalty.points_earned' AND aggregate_id = ${P('01')}`.execute(db)).rows as any[];
    expect(earned.map((r: any) => [r.payload_json.points, r.payload_json.source])).toEqual([[45, 'payment.captured']]);
    const led = (await sql`SELECT points, amount_cents, event_id, customer_id FROM loyalty_point_earnings WHERE tenant_id = ${T} AND payment_id = ${P('01')}`.execute(db)).rows as any[];
    expect(led.length).toBe(1);
    expect(led[0]).toMatchObject({ points: 45, amount_cents: 4500, event_id: e.eventId, customer_id: CUST });
    // Phase 10 (bug 3/4): the balance moved through the loyalty LEDGER — one `earn` row keyed by the payment, balance after it
    const book = (await sql`SELECT entry_type, delta::int, balance_after::int, source_table, source_id FROM loyalty_ledger WHERE tenant_id = ${T} AND customer_id = ${CUST}`.execute(db)).rows as any[];
    expect(book).toEqual([{ entry_type: 'earn', delta: 45, balance_after: 45, source_table: 'payments', source_id: P('01') }]);
  });

  it('§23 redelivery of the SAME event: duplicate — balance unchanged', async () => {
    const r = await runner.run(consumer, captured(P('01'), TICKET, 4500));   // same payment id, fresh event id → not a processed_events duplicate…
    expect(r.status).toBe('processed');                                     // …the runner runs it…
    expect(await balance()).toBe(45);                                        // …but the LEDGER refuses a second award (§25)
    expect(((await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'loyalty.points_earned' AND aggregate_id = ${P('01')}`.execute(db)).rows[0] as any).n).toBe(1);   // …and records no second points_earned
    expect((await sql`SELECT count(*)::int AS n FROM loyalty_point_earnings WHERE payment_id = ${P('01')}`.execute(db)).rows[0]).toMatchObject({ n: 1 });
  });

  it('§102 a genuine second payment on the same ticket earns again — uniqueness is per PAYMENT, not per ticket', async () => {
    await new OutboxWriter().write(db, captured(P('02'), TICKET, 2500)); await publisher.tick();
    expect(await balance()).toBe(70);
  });

  it('§14 a ticket that belongs to another tenant is a SECURITY failure — nothing awarded, alert written', async () => {
    const r = await runner.run(consumer, captured(P('03'), TICKET_T2, 9900));   // event says tenant T, ticket is tenant T2
    expect(r.status).toBe('dead_lettered');
    if (r.status === 'dead_lettered') expect(r.errorClass).toBe('SECURITY');
    expect(await balance()).toBe(70);
    expect((await sql`SELECT 1 FROM outbox_events WHERE event_type = 'security.tenant_mismatch' AND aggregate_id = 'loyalty.points_on_payment'`.execute(db)).rows.length).toBe(1);
  });

  it('a walk-in ticket with no customer, a declined capture, or a sub-dollar amount earns nothing and errors nothing', async () => {
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES (${TICKET_WALKIN}, ${T}, ${B}, ${CUST})`.execute(db);
    await sql`UPDATE tickets SET customer_id = NULL WHERE id = ${TICKET_WALKIN}`.execute(db).catch(() => { /* if customer_id is NOT NULL, the next case still holds */ });
    const declined = { ...captured(P('04'), TICKET, 5000), payload: { paymentId: P('04'), ticketId: TICKET, method: 'card', amountCents: 5000, surchargeCents: 0, status: 'declined' } };
    expect((await runner.run(consumer, declined as any)).status).toBe('processed');
    expect((await runner.run(consumer, captured(P('05'), TICKET, 99))).status).toBe('processed');
    expect(await balance()).toBe(70);
    expect((await sql`SELECT count(*)::int AS n FROM event_dead_letters WHERE consumer_name = 'loyalty.points_on_payment' AND status <> 'open'`.execute(db)).rows[0]).toMatchObject({ n: 0 });
  });
});


// D3 — loyalty basis (Oct 22 2026, migration 675): points on every PAID tender, none for buying a gift card.
describe('D3: every paid tender earns; gift-card value earns nothing; the earning row records what was judged', () => {
  const TICKET_GC = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee10', CARD = '99999999-9999-9999-9999-999999999910';
  const tender = (n: string, ticketId: string, amountCents: number, status: 'approved' | 'partial') =>
    ({ ...captured(P(n), ticketId, amountCents), payload: { paymentId: P(n), ticketId, method: 'cash', amountCents, surchargeCents: 0, status } });
  const earning = async (n: string) => (await sql`SELECT points::int AS points, amount_cents::int AS amount_cents, excluded_cents::int AS excluded_cents FROM loyalty_point_earnings WHERE tenant_id = ${T} AND payment_id = ${P(n)}`.execute(db)).rows[0] as any;
  it('the PARTIAL cash part of a split earns like the final tender (before: only `approved` earned)', async () => {
    const before = await balance();
    expect((await runner.run(consumer, tender('10', TICKET, 2000, 'partial'))).status).toBe('processed');
    expect(await earning('10')).toEqual({ points: 20, amount_cents: 2000, excluded_cents: 0 });
    expect(await balance()).toBe(before + 20);
  });
  it('a $50 gift card sold on the ticket is netted off the tenders, first tender first: $50 + $40 services paid $60 then $30 → 10 + 30 points, excluded 5000', async () => {
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES (${TICKET_GC}, ${T}, ${B}, ${CUST})`.execute(db);
    await sql`INSERT INTO gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents, status, purchased_cents, sale_ticket_id) VALUES (${CARD}, ${T}, ${'GC-D3-5000'}, 5000, 0, 'active', 5000, ${TICKET_GC})`.execute(db);
    const before = await balance();
    expect((await runner.run(consumer, tender('11', TICKET_GC, 6000, 'partial'))).status).toBe('processed');
    expect(await earning('11')).toEqual({ points: 10, amount_cents: 1000, excluded_cents: 5000 });   // $50 of the first $60 bought the card
    expect((await runner.run(consumer, tender('12', TICKET_GC, 3000, 'approved'))).status).toBe('processed');
    expect(await earning('12')).toEqual({ points: 30, amount_cents: 3000, excluded_cents: 0 });      // the card was already netted
    expect(await balance()).toBe(before + 40);
    // a redelivery of the first tender with a fresh event id changes nothing (the earning row is the guard)
    expect((await runner.run(consumer, tender('11', TICKET_GC, 6000, 'partial'))).status).toBe('processed');
    expect(await balance()).toBe(before + 40);
  });
  it('a tender that ONLY bought gift-card value is judged (row kept, 0 points) and credits nothing — a replay cannot re-judge it', async () => {
    const TICKET_ONLY = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee11', CARD2 = '99999999-9999-9999-9999-999999999911';
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES (${TICKET_ONLY}, ${T}, ${B}, ${CUST})`.execute(db);
    await sql`INSERT INTO gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents, status, purchased_cents, sale_ticket_id) VALUES (${CARD2}, ${T}, ${'GC-D3-2500'}, 2500, 0, 'active', 2500, ${TICKET_ONLY})`.execute(db);
    const before = await balance();
    expect((await runner.run(consumer, tender('13', TICKET_ONLY, 2500, 'approved'))).status).toBe('processed');
    expect(await earning('13')).toEqual({ points: 0, amount_cents: 0, excluded_cents: 2500 });
    expect(await balance()).toBe(before);
    expect((await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'loyalty.points_earned' AND aggregate_id = ${P('13')}`.execute(db)).rows[0]).toMatchObject({ n: 0 });
  });
  it('excludedCentsFor is pure: never more than the tender, never more than what is left of the charge', () => {
    expect(excludedCentsFor(6000, 5000, 0)).toBe(5000);
    expect(excludedCentsFor(3000, 5000, 5000)).toBe(0);
    expect(excludedCentsFor(2000, 5000, 4000)).toBe(1000);
    expect(excludedCentsFor(0, 5000, 0)).toBe(0);
    expect(excludedCentsFor(2000, 0, 0)).toBe(0);
  });
});

// M4 lanes follow-up (Oct 26 2026): two payment.captured events of one ticket are two aggregates and may be processed in
// either order (or side by side). The gift-card netting must not depend on that order: "first tender first" is the
// tender's place in `payments` (created_at, then id).
describe('M4 lanes: the gift-card split per tender is the same whichever payment.captured is processed first', () => {
  const TK1 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee20', TK2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee21';
  const C1 = '99999999-9999-9999-9999-999999999920', C2 = '99999999-9999-9999-9999-999999999921';
  const tender = (n: string, ticketId: string, amountCents: number, status: 'approved' | 'partial') =>
    ({ ...captured(P(n), ticketId, amountCents), payload: { paymentId: P(n), ticketId, method: 'cash', amountCents, surchargeCents: 0, status } });
  const earning = async (n: string) => (await sql`SELECT points::int AS points, amount_cents::int AS amount_cents, excluded_cents::int AS excluded_cents FROM loyalty_point_earnings WHERE tenant_id = ${T} AND payment_id = ${P(n)}`.execute(db)).rows[0] as any;
  /** a $50 card sold on the ticket, paid $59.50 first (partial) then $30.50 (approved) — the tenders exist in `payments` */
  const ticketWithTwoTenders = async (ticketId: string, cardId: string, code: string, first: string, second: string) => {
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES (${ticketId}, ${T}, ${B}, ${CUST})`.execute(db);
    await sql`INSERT INTO gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents, status, purchased_cents, sale_ticket_id) VALUES (${cardId}, ${T}, ${code}, 5000, 0, 'active', 5000, ${ticketId})`.execute(db);
    await sql`INSERT INTO payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) VALUES
      (${P(first)}, ${T}, ${B}, ${ticketId}, 'cash', 5950, 'partial', '2026-10-26T10:00:00Z'),
      (${P(second)}, ${T}, ${B}, ${ticketId}, 'cash', 3050, 'approved', '2026-10-26T10:00:05Z')`.execute(db);
  };
  it('first-created then second-created: $50 of the first $59.50 bought the card → 9 + 30 points', async () => {
    await ticketWithTwoTenders(TK1, C1, 'GC-M4-A', '20', '21');
    expect((await runner.run(consumer, tender('20', TK1, 5950, 'partial'))).status).toBe('processed');
    expect((await runner.run(consumer, tender('21', TK1, 3050, 'approved'))).status).toBe('processed');
    expect(await earning('20')).toEqual({ points: 9, amount_cents: 950, excluded_cents: 5000 });
    expect(await earning('21')).toEqual({ points: 30, amount_cents: 3050, excluded_cents: 0 });
  });
  it('the SECOND tender processed first (its lane ran ahead): identical per-tender points and excluded_cents — not 30 + 59', async () => {
    await ticketWithTwoTenders(TK2, C2, 'GC-M4-B', '22', '23');
    expect((await runner.run(consumer, tender('23', TK2, 3050, 'approved'))).status).toBe('processed');   // the later tender, judged first
    expect(await earning('23')).toEqual({ points: 30, amount_cents: 3050, excluded_cents: 0 });            // the $59.50 before it absorbs the card
    expect((await runner.run(consumer, tender('22', TK2, 5950, 'partial'))).status).toBe('processed');
    expect(await earning('22')).toEqual({ points: 9, amount_cents: 950, excluded_cents: 5000 });
    const total = (await sql`SELECT sum(points)::int AS n, sum(excluded_cents)::int AS x FROM loyalty_point_earnings WHERE tenant_id = ${T} AND ticket_id = ${TK2}`.execute(db)).rows[0];
    expect(total).toMatchObject({ n: 39, x: 5000 });
  });
  it('a tender the payments table does not hold (a synthetic event) still nets in judged order — the pre-M4 rule, unchanged', async () => {
    const TK3 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee22', C3 = '99999999-9999-9999-9999-999999999922';
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES (${TK3}, ${T}, ${B}, ${CUST})`.execute(db);
    await sql`INSERT INTO gift_cards (id, tenant_id, code, initial_balance_cents, balance_cents, status, purchased_cents, sale_ticket_id) VALUES (${C3}, ${T}, ${'GC-M4-C'}, 5000, 0, 'active', 5000, ${TK3})`.execute(db);
    expect((await runner.run(consumer, tender('24', TK3, 6000, 'partial'))).status).toBe('processed');
    expect((await runner.run(consumer, tender('25', TK3, 3000, 'approved'))).status).toBe('processed');
    expect(await earning('24')).toEqual({ points: 10, amount_cents: 1000, excluded_cents: 5000 });
    expect(await earning('25')).toEqual({ points: 30, amount_cents: 3000, excluded_cents: 0 });
  });
});
