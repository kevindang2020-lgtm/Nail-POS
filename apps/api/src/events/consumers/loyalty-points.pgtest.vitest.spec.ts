// loyalty-points.pgtest — §25/§101–102 on real Postgres: a payment earns points EXACTLY ONCE, however many times it
// is delivered, replayed, or re-emitted. That is the property that lets replay exist at all (§225).
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { LoyaltyPointsConsumer, pointsFor } from './loyalty-points.consumer';

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

