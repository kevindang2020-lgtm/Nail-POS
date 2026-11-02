// checkout-card-paid-atomic.pgtest — Phase 15 round 3: a live POS card approval (claim → charge → complete) recorded the
// payment and the paid ticket in TWO separate writes, each of whose errors was swallowed:
//   • finalizePayment('approved') in one statement, then setStatus('paid') in its own transaction;
//   • if the paid write failed (database blip, an outbox refusal), the card was charged, the payment said 'approved', and
//     the ticket stayed OPEN — "due" read 0 so it could not be charged again, but it sat in the checkout queue unpaid,
//     no checkout.completed / visit.completed, nobody told; the stranded-attempt sweep never looks at it (it only looks at
//     'processing' payments) so nothing ever repaired it;
//   • and the live card path wrote NO payment.captured at all (only recordPayment does): no loyalty points, no analytics.
// Now the approved payment, payment.captured and the paid ticket (checkout.completed, visit.completed) commit in ONE
// transaction. A failure rolls all of it back: the payment stays 'processing' — Functional Decision 22's lost-answer state
// that "Verify with processor" and the stranded-attempt sweep settle — and it is logged, never swallowed.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { CheckoutService } from './checkout.service';

const T = '11111111-1111-4111-8111-1111111111b8', B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab8', C = 'dddddddd-dddd-4ddd-8ddd-ddddddddddb8';
const CAT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeb1', SVC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeb2';
const ctx: any = { tenantId: T, branchId: B, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] };
let db: any;

async function ticket(): Promise<string> {
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'open', 5000, 0, 0, 5000) returning id`.execute(db)).rows[0];
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk.id}, ${SVC}, 'Gel Manicure', 5000, 45, 5000)`.execute(db);
  return String(tk.id);
}
const types = async (ticketId: string) => (await sql`select event_type from outbox_events where tenant_id = ${T} and (aggregate_id = ${ticketId} or payload_json->>'ticketId' = ${ticketId}) order by event_type`.execute(db)).rows.map((r: any) => r.event_type);
const payments = async (ticketId: string) => (await sql`select status, processor_transaction_id from payments where ticket_id = ${ticketId}`.execute(db)).rows as any[];
const status = async (ticketId: string) => ((await sql`select status from tickets where id = ${ticketId}`.execute(db)).rows[0] as any).status;
/** an outbox that refuses one event type (the paid-state write fails after the card was charged) */
const refusing = (type: string) => { const w = new OutboxWriter(); const real = w.write.bind(w); w.write = async (trx: any, e: any) => { if (e.eventType === type) throw new Error('outbox down'); await real(trx, e); }; return w; };
const processor = (retref: string): any => ({
  name: 'spy',
  async authorizeAndCapture() { return { approved: true, retref, authCode: 'A1', respstat: 'A' }; },
  async inquireByOrderId() { return { transactions: [{ retref, approved: true, declined: false, authCode: 'A1' }] }; },
});
let logged: string[];
const svc = (outbox: OutboxWriter, p: any) => {
  const s = new CheckoutService(new KyselyCheckoutRepository(db, outbox), undefined, undefined, undefined, { resolve: async () => ({ processor: p }) } as any);
  (s as any).useMoneyPathLog?.({ error: (m: string) => { logged.push(m); } });
  return s;
};

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'H', 'H Salon', 'h-card', 'HCARD8', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 5000)`.execute(db);
}, 120_000);
beforeEach(() => { logged = []; });

describe('POS live card approval — the approved payment and the paid ticket commit together', () => {
  it('records ONE payment.captured with the paid ticket\'s checkout.completed and visit.completed', async () => {
    const id = await ticket();
    expect(await svc(new OutboxWriter(), processor('RR-1')).payCard(ctx, id, { cardToken: 'tok' } as any)).toMatchObject({ status: 'approved', processorTransactionId: 'RR-1' });
    expect(await payments(id)).toEqual([{ status: 'approved', processor_transaction_id: 'RR-1' }]);
    expect(await status(id)).toBe('paid');
    expect(await types(id)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
    expect(logged).toEqual([]);
    // a second completion of the same charge (a verification that raced the live answer) writes nothing at all
    const [{ id: paymentId }] = (await sql`select id from payments where ticket_id = ${id}`.execute(db)).rows as any[];
    expect(await new KyselyCheckoutRepository(db, new OutboxWriter()).completeCardPayment(ctx, id, String(paymentId), 'RR-1')).toMatchObject({ completed: false, payment: { status: 'approved' } });
    expect(await types(id)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
  });

  it('a failure writing the paid state leaves NO charged-but-open ticket: the payment stays \'processing\', it is logged, and Verify completes it once', async () => {
    const id = await ticket();
    const r: any = await svc(refusing('checkout.completed'), processor('RR-2')).payCard(ctx, id, { cardToken: 'tok' } as any);
    expect(r.status).toBe('processing');                                      // honest: charged, not yet recorded — verify
    expect(await payments(id)).toEqual([{ status: 'processing', processor_transaction_id: null }]);
    expect(await status(id)).toBe('open');
    expect(await types(id)).toEqual([]);                                      // nothing half-recorded
    expect(logged.length).toBe(1);
    expect(logged[0]).toContain(id);
    expect(logged[0]).toMatch(/RR-2/);
    // the Decision-22 path settles it: Verify asks the processor, which says approved
    const v: any = await svc(new OutboxWriter(), processor('RR-2')).verifyCardPayment(ctx, id);
    expect(v).toMatchObject({ status: 'approved', processorTransactionId: 'RR-2' });
    expect(await payments(id)).toEqual([{ status: 'approved', processor_transaction_id: 'RR-2' }]);
    expect(await status(id)).toBe('paid');
    expect(await types(id)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
    // and a second Verify finds nothing waiting — no second event
    expect((await svc(new OutboxWriter(), processor('RR-2')).verifyCardPayment(ctx, id)).status).toBe('none');
    expect(await types(id)).toEqual(['checkout.completed', 'payment.captured', 'visit.completed']);
  });
});
