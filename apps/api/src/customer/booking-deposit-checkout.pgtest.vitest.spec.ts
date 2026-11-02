// booking-deposit-checkout.pgtest — D11 (Oct 21 2026), the deposit's whole path on the real schema: the guest's deposit is
// captured at booking → she checks in (queue item names the appointment) → her ticket owes less: at the POS the deposit is
// a 'deposit' payment on the ticket, taken off BEFORE the cashier's own tender, once; a deposit larger than the bill pays
// the bill in full (ticket paid, no second tender) and the rest goes back to her card; the customer app's cancel refunds
// or forfeits by the window; the POS's cancel always refunds. The checkout domain never reads booking tables itself — it
// goes through the port the API binds (BOOKING_DEPOSITS).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { BookingDepositService } from '@aipowersalon/booking';
import { CheckoutService, KyselyCheckoutRepository } from '@aipowersalon/checkout';

const T = 'd1200000-0000-4000-8000-000000000001', B = 'd1200000-0000-4000-8000-000000000002', C = 'd1200000-0000-4000-8000-0000000000c1', TECH = 'd1200000-0000-4000-8000-0000000000e1';
const CAT = 'd1200000-0000-4000-8000-0000000000a1', SVC = 'd1200000-0000-4000-8000-0000000000a2';
const posCtx: any = { tenantId: T, branchId: B, userId: 'd1200000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.cash_payment', 'pos.checkout.card_payment'] };
let db: any; let day = 0; const refunds: any[] = [];
const processor: any = {
  name: 'fake',
  async authorizeAndCapture(i: any) { return { approved: true, declined: false, retref: 'RR-' + i.orderId, respstat: 'A', respText: 'Approval', profileId: 'PROF' }; },
  async refund(i: any) { refunds.push(i); return { ok: true, retref: 'RF-' + i.retref }; },
};
let deposits: BookingDepositService;
const checkout = () => new CheckoutService(new KyselyCheckoutRepository(db, new OutboxWriter())).useDeposits(deposits);

async function bookedAndPaid(priceCents: number, startsAt = '2026-11-20T15:00:00Z') {
  day++;
  const d = new Date(startsAt); const slotDay = new Date(Date.UTC(2027, 2, 1 + day));
  const a: any = (await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, status, duration_minutes)
    values (${T}, ${B}, ${TECH}, ${C}, 'Ana Lee', 'customer_app', ${JSON.stringify([{ serviceId: SVC, serviceName: 'Gel', priceCents, durationMinutes: 60 }])}::jsonb, ${slotDay.toISOString().slice(0, 10)}, '15:00', '16:00', 'booked', 60) returning id`.execute(db)).rows[0];
  const dep = (await deposits.createForAppointment({ tenantId: T, branchId: B, userId: C }, { appointmentId: String(a.id), customerId: C, priceCents, startsAt: d }))!;
  await deposits.pay({ tenantId: T, branchId: B, userId: C }, dep.depositId, { token: '9418594164541111', expiry: '1229' });
  return { appointmentId: String(a.id), depositId: dep.depositId, amountCents: dep.amountCents };
}
/** she checks in: a queue item naming the appointment, and the visit's ticket on that queue item */
async function ticketFor(appointmentId: string, totalCents: number): Promise<string> {
  const q: any = (await sql`insert into pos_queue_items (tenant_id, branch_id, customer_id, customer_name, status, source, priority, appointment_id) values (${T}, ${B}, ${C}, 'Ana Lee', 'in_service', 'appointment', 'normal', ${appointmentId}) returning id`.execute(db)).rows[0];
  const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, queue_item_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, ${q.id}, 'ready_checkout', ${totalCents}, 0, 0, ${totalCents}) returning id`.execute(db)).rows[0];
  await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk.id}, ${SVC}, 'Gel', ${totalCents}, 60, ${totalCents})`.execute(db);
  return String(tk.id);
}
const payments = async (ticketId: string) => (await sql`select method, amount_cents::int as amount, status from payments where ticket_id = ${ticketId} order by created_at`.execute(db)).rows as any[];
const deposit = async (id: string) => (await sql`select status, applied_cents::int as applied, refunded_cents::int as refunded, ended_reason from booking_deposits where id = ${id}`.execute(db)).rows[0] as any;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'D', 'D Salon', 'd-depc', 'DDEPC', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'UTC')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active')`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Tina', 'Tech', 'Tina Tech')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 60, 10000)`.execute(db);
  await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'booking-appointments', ${JSON.stringify({ depositRequired: true, depositPercent: 25, cancellationWindowHours: 24, noShowPolicy: 'charge_fee' })}::jsonb)`.execute(db);
  await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'tax', ${JSON.stringify({ enabled: false })}::jsonb)`.execute(db);   // round numbers: no tax in this file
  deposits = new BookingDepositService(db, { resolve: async () => ({ configured: true, processorType: 'fiserv', processor }) }, new OutboxWriter());
}, 120_000);

describe('the deposit at checkout', () => {
  it('comes off the ticket first as a "deposit" payment; the cashier\'s cash covers the rest; the ticket is paid; the deposit is applied once', async () => {
    const { appointmentId, depositId } = await bookedAndPaid(10000);            // deposit 2500
    const ticketId = await ticketFor(appointmentId, 10000);
    const s = checkout();
    const r = await s.payCash(posCtx, ticketId, { amountReceivedCents: 7500 } as any);
    expect(r.payment).toMatchObject({ method: 'cash', amountCents: 7500 });
    expect(await payments(ticketId)).toEqual([{ method: 'deposit', amount: 2500, status: 'approved' }, { method: 'cash', amount: 7500, status: 'approved' }]);
    expect(await deposit(depositId)).toMatchObject({ status: 'applied', applied: 2500, refunded: null, ended_reason: 'checkout' });
    expect(((await sql`select status from tickets where id = ${ticketId}`.execute(db)).rows[0] as any).status).toBe('paid');
    // a second apply (another pay path, a retry) records nothing more
    expect(await s.applyBookingDeposit(posCtx, ticketId)).toEqual({ applied: false });
    expect((await payments(ticketId)).length).toBe(2);
  });
  it('a deposit larger than the bill pays it in full: the ticket is paid, nothing more is asked, the rest goes back to the card', async () => {
    const { appointmentId, depositId, amountCents } = await bookedAndPaid(10000);   // 2500 captured
    const ticketId = await ticketFor(appointmentId, 2000);                            // she had less done
    refunds.length = 0;
    const r = await checkout().applyBookingDeposit(posCtx, ticketId);
    expect(r).toEqual({ applied: true, appliedCents: 2000, refundedCents: 500 });
    expect(await payments(ticketId)).toEqual([{ method: 'deposit', amount: 2000, status: 'approved' }]);
    expect(((await sql`select status from tickets where id = ${ticketId}`.execute(db)).rows[0] as any).status).toBe('paid');
    expect(await deposit(depositId)).toMatchObject({ status: 'applied', applied: 2000, refunded: 500 });
    expect(refunds).toEqual([{ retref: 'RR-dep:' + depositId, amountCents: amountCents - 2000 }]);
  });
  it('a ticket with no appointment behind it (walk-in) is untouched', async () => {
    const tk: any = (await sql`insert into tickets (tenant_id, branch_id, customer_id, status, subtotal_cents, tax_cents, discount_cents, total_cents) values (${T}, ${B}, ${C}, 'ready_checkout', 3000, 0, 0, 3000) returning id`.execute(db)).rows[0];
    expect(await checkout().applyBookingDeposit(posCtx, String(tk.id))).toEqual({ applied: false });
    expect(await payments(String(tk.id))).toEqual([]);
  });
  it('the checkout domain without the port bound (no booking module) applies nothing and pays as before', async () => {
    const { appointmentId } = await bookedAndPaid(10000);
    const ticketId = await ticketFor(appointmentId, 10000);
    const s = new CheckoutService(new KyselyCheckoutRepository(db, new OutboxWriter()));
    expect(await s.applyBookingDeposit(posCtx, ticketId)).toEqual({ applied: false });
  });
});
