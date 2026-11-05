// skip-line-producer.pgtest — a skip-line (customer-app / cash-to-tech) payment records the SAME facts a POS checkout does,
// and earns loyalty EXACTLY ONCE whether the inline award or the loyalty consumer gets there first.
//
// Before: skip-line payments recorded no domain event (the analytics rollup and platform live-ops never counted them), and
// the inline loyalty award had no ledger row (call it twice, award twice).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { SkipLineCheckoutRepository } from '@aipowersalon/checkout';
import { ConsumerRegistry, InProcessTransport } from './event-transport';
import { OutboxPublisher } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';
import { LoyaltyPointsConsumer } from './consumers/loyalty-points.consumer';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

const T = '11111111-1111-1111-1111-1111111111a1', B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const TECH = 'cccccccc-cccc-cccc-cccc-ccccccccccc1', TICKET3 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3', CUST = 'dddddddd-dddd-dddd-dddd-ddddddddddd1', TICKET = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', TICKET2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2';
const ctx = { tenantId: T, branchId: B, userId: 'ffffffff-ffff-ffff-ffff-fffffffffff1' } as any;
let db: any; let repo: SkipLineCheckoutRepository; let publisher: OutboxPublisher;
const outbox = async (type: string) => (await sql`SELECT aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at`.execute(db)).rows as any[];
const balance = async () => Number(((await sql`SELECT points_balance FROM customer_loyalty_profiles WHERE tenant_id = ${T} AND customer_id = ${CUST}`.execute(db)).rows[0] as any)?.points_balance ?? 0);

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}','S','Skip Salon','skip','SKIP01','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Main') ON CONFLICT (id) DO NOTHING;
    INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) VALUES ('${CUST}','${T}','${B}','Ava','Kim','Ava Kim','+16095550199','active') ON CONFLICT (id) DO NOTHING;
    INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES ('${TICKET}','${T}','${B}','${CUST}'), ('${TICKET2}','${T}','${B}','${CUST}'), ('${TICKET3}','${T}','${B}','${CUST}') ON CONFLICT (id) DO NOTHING;
  `);
  db = kyselyFor(pg);
  repo = new SkipLineCheckoutRepository(db, new OutboxWriter());
  const registry = new ConsumerRegistry(); registry.register(new LoyaltyPointsConsumer());
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db, { rand: () => 0 })));
}, 60_000);

describe('skip-line payments record the POS facts and earn loyalty exactly once', () => {
  it('a paid skip-line ticket records payment.captured AND checkout.completed in its transaction', async () => {
    const { paymentId } = await repo.recordPaymentAndCloseTicket(ctx, TICKET, 'card', 4500, 500, { idempotencyKey: 'skip-1' });
    const [cap] = await outbox('payment.captured');
    expect(cap.aggregate_id).toBe(paymentId);
    expect(cap.payload_json).toMatchObject({ ticketId: TICKET, method: 'card', amountCents: 4500, tipCents: 500, status: 'approved', channel: 'skip_line' });
    expect((await outbox('checkout.completed')).map((r) => r.aggregate_id)).toEqual([TICKET]);
  });
  it('a retried charge with the same idempotency key records nothing new', async () => {
    await repo.recordPaymentAndCloseTicket(ctx, TICKET, 'card', 4500, 500, { idempotencyKey: 'skip-1' });
    expect((await outbox('payment.captured')).length).toBe(1);
  });
  it('a decline records payment.failed', async () => {
    await repo.recordDeclinedPayment(ctx, TICKET2, 'card', 3000, 0, null, 'skip-2');
    const [f] = await outbox('payment.failed');
    expect(f.payload_json).toMatchObject({ ticketId: TICKET2, status: 'declined', channel: 'skip_line' });
  });
  it('loyalty: the inline award, a second inline call, and the consumer together earn 45 points ONCE', async () => {
    const [cap] = await outbox('payment.captured');
    const first = await repo.awardLoyaltyForPayment(ctx, CUST, 4500, cap.aggregate_id, TICKET);
    expect(first).toEqual({ awarded: 45, balance: 45 });
    expect(await repo.awardLoyaltyForPayment(ctx, CUST, 4500, cap.aggregate_id, TICKET)).toBeNull();   // a retry: nothing
    await publisher.tick();                                                                            // the consumer handles payment.captured
    expect(await balance()).toBe(45);
    const rows = (await sql`SELECT source FROM loyalty_point_earnings WHERE tenant_id = ${T} AND payment_id = ${cap.aggregate_id}`.execute(db)).rows as any[];
    expect(rows.map((r) => r.source)).toEqual(['skip_line.payment']);
    // loyalty.points_earned is recorded exactly once too — by whichever path's ledger insert landed (here, the inline award)
    const earned = await outbox('loyalty.points_earned');
    expect(earned.map((e) => e.payload_json.source)).toEqual(['skip_line.payment']);
    expect(earned[0].payload_json).toMatchObject({ customerId: CUST, paymentId: cap.aggregate_id, points: 45 });
  });
  it('the projection produces the skip-line client events the service used to push — front desk AND the customer\'s own app', async () => {
    const project = async (type: string) => {
      const [row] = (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at LIMIT 1`.execute(db)).rows as any[];
      const sent: string[] = [];
      await new RealtimeProjectionConsumer({ toTenant: (_s: any, ev: string) => sent.push('tenant:' + ev), toCustomer: (id: string, ev: string) => sent.push(`customer(${id === CUST ? 'CUST' : id}):` + ev), toTechnician: () => {} } as any)
        .handle({ eventType: row.event_type, tenantId: row.tenant_id, branchId: row.branch_id, aggregateId: row.aggregate_id, payload: row.payload_json } as any);
      return sent;
    };
    expect(await project('payment.captured')).toEqual(['tenant:payment_approved', 'tenant:customer_payment_succeeded', 'customer(CUST):customer_payment_succeeded']);
    expect(await project('checkout.completed')).toEqual(['tenant:ticket_paid', 'tenant:reports_updated', 'tenant:ticket_closed']);
    expect(await project('payment.failed')).toEqual(['tenant:payment_failed']);                  // this decline was recorded without a customer
    // a decline recorded WITH the customer and the processor's reason reaches the customer's own app too
    await repo.recordDeclinedPayment(ctx, TICKET2, 'card', 1116, 0, null, 'skip-3', 'Not sufficient funds', CUST);
    const [d] = (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = 'payment.failed' ORDER BY occurred_at DESC LIMIT 1`.execute(db)).rows as any[];
    expect(d.payload_json).toMatchObject({ customerId: CUST, reason: 'Not sufficient funds', channel: 'skip_line' });
    const sent: any[] = [];
    await new RealtimeProjectionConsumer({ toTenant: (_s: any, ev: string) => sent.push(['tenant', ev]), toCustomer: (id: string, ev: string, pl: any) => sent.push(['customer', ev, pl.reason]) } as any)
      .handle({ eventType: d.event_type, tenantId: d.tenant_id, branchId: d.branch_id, aggregateId: d.aggregate_id, payload: d.payload_json } as any);
    expect(sent).toEqual([['tenant', 'payment_failed'], ['customer', 'customer_payment_failed', 'Not sufficient funds']]);
    expect(await project('loyalty.points_earned')).toEqual(['tenant:loyalty_points_added', 'customer(CUST):loyalty_points_added']);
  });
  it('cash to the technician: the request records skip_line.cash_to_tech_requested (desk: selected + pending; the technician: asked to confirm); "customer did not pay" records not_paid once', async () => {
    const conf: any = await repo.createCashConfirmation(ctx, { ticketId: TICKET3, paymentIntentId: '11111111-2222-4333-8444-555555555555', customerId: CUST, technicianId: TECH, amountCents: 4200 });
    const [req] = (await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = 'skip_line.cash_to_tech_requested'`.execute(db)).rows as any[];
    expect(req.aggregate_id).toBe(String(conf.id));
    expect(req.payload_json).toMatchObject({ ticketId: TICKET3, technicianId: TECH, amountCents: 4200 });
    const sent: string[] = [];
    await new RealtimeProjectionConsumer({ toTenant: (_s: any, ev: string) => sent.push('tenant:' + ev), toTechnician: (id: string, ev: string) => sent.push(`tech(${id === TECH ? 'TECH' : id}):` + ev) } as any)
      .handle({ eventType: req.event_type, tenantId: req.tenant_id, branchId: req.branch_id, aggregateId: req.aggregate_id, payload: req.payload_json } as any);
    expect(sent).toEqual(['tenant:cash_to_technician_selected', 'tenant:cash_pending_tech_confirmation', 'tech(TECH):cash_pending_tech_confirmation']);
    await repo.setCashConfirmationStatus(ctx, String(conf.id), 'customer_did_not_pay' as any, null, 'walked out');
    await repo.setCashConfirmationStatus(ctx, String(conf.id), 'customer_did_not_pay' as any, null, 'again');
    const np = (await sql`SELECT payload_json FROM outbox_events WHERE event_type = 'skip_line.cash_to_tech_not_paid'`.execute(db)).rows as any[];
    expect(np.map((r) => r.payload_json)).toEqual([{ confirmationId: String(conf.id), ticketId: TICKET3, technicianId: TECH, amountCents: 4200 }]);
    expect(JSON.stringify(np)).not.toContain('walked out');                 // the notes stay in the row
  });
});
