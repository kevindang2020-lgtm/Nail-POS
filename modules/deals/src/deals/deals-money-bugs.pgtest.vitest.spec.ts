// deals-money-bugs.pgtest — BUILD_PLAN Phase 5, "money bugs first", each one pinned on the real schema:
//   1  oversell: a booked (consumed) reservation stopped counting — a deal capped at N sold N+k
//   4  a deal counted as redeemed the moment it was put on a ticket — before (and whether or not) anyone paid
//   5  eligibility: new-customers-only / members-only / max-per-customer were stored and never checked
//   6  the date window: an "active" deal past its end (or before its start) still reserved
//   7  a deal could be written against ANOTHER salon's branch or services (both came from the request body)
//   8  the deal's "original price" was whatever the client sent, not the catalog
//  12  a cancelled / no-show appointment kept its deal reservation forever
//  17  Super Admin suspend: no reason, no audit, and a booked deal still applied at checkout
//  18  an auto-approved technician deal sat at "approved" and never reached customers
//  21  12.5 % / 0 % / 101 % reached the database (500) instead of a clean refusal
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyDealsRepository } from './deals.kysely.repository';
import { DealsService } from './deals.service';

const T = 'd5000000-0000-4000-8000-000000000001';
const T2 = 'd5000000-0000-4000-8000-000000000002';
const B = 'd5000000-0000-4000-8000-0000000000b1';
const B2 = 'd5000000-0000-4000-8000-0000000000b2';
const CAT = 'd5000000-0000-4000-8000-0000000000c1';
const CAT2 = 'd5000000-0000-4000-8000-0000000000c2';
const SVC = 'd5000000-0000-4000-8000-0000000000a1';
const SVC_OTHER = 'd5000000-0000-4000-8000-0000000000a2';
const TECH = 'd5000000-0000-4000-8000-0000000000e1';
const mgr: any = { tenantId: T, branchId: B, userId: 'd5000000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: [] };
let db: any; let svc: DealsService;

async function activeDeal(over: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  const o: any = { max_redemptions: null, new_customers_only: false, member_only: false, max_per_customer: null, starts_at: null, ends_at: null, ...over };
  await sql`insert into deals (id, tenant_id, branch_id, owner_type, title, discount_type, discount_percent, original_price_cents, final_price_cents, status,
             max_redemptions, new_customers_only, member_only, max_per_customer, starts_at, ends_at)
            values (${id}, ${T}, ${B}, 'salon', 'Bug deal', 'percent', 20, 5000, 4000, 'active', ${o.max_redemptions}, ${o.new_customers_only}, ${o.member_only},
             ${o.max_per_customer}, ${o.starts_at}, ${o.ends_at})`.execute(db);
  await sql`insert into deal_services (deal_id, service_id, tenant_id) values (${id}, ${SVC}, ${T})`.execute(db);
  return id;
}
async function customer(): Promise<string> {
  const id = randomUUID();
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, phone_display) values (${id}, ${T}, ${B}, 'Cust', 'Omer', 'Cust', ${'+1856555' + String(Math.floor(Math.random() * 9000) + 1000)})`.execute(db);
  return id;
}
let slot = 0;
async function appointment(customerId: string): Promise<string> {
  const id = randomUUID();
  const day = new Date(Date.UTC(2027, 2, 1) + (slot++) * 86_400_000).toISOString().slice(0, 10);   // one slot per day: never overlaps
  await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, services, status)
            values (${id}, ${T}, ${B}, ${TECH}, ${customerId}, 'Cust', ${day}, '10:00', '11:00', ${JSON.stringify([{ serviceId: SVC, name: 'Gel', priceCents: 5000 }])}::jsonb, 'booked')`.execute(db);
  return id;
}
async function paidTicket(customerId: string): Promise<string> {
  const id = randomUUID();
  await sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, payment_status, paid_at) values (${id}, ${T}, ${B}, ${customerId}, 'paid', 'paid', now())`.execute(db);
  return id;
}
const facts = { serviceIds: [SVC], channel: 'customer_app' as const };   // what the booking flow passes
const book = async (dealId: string, customerId: string) => {
  const r = await svc.reserveDeal(mgr, dealId, customerId, 'k-' + randomUUID(), facts);
  if (r.soldOut) return { soldOut: true as const };
  const appt = await appointment(customerId);
  await svc.consumeReservation(mgr, r.holdId!, appt);
  return { soldOut: false as const, appt, holdId: r.holdId! };
};

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  for (const [t, code] of [[T, 'BUGS1'], [T2, 'BUGS2']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${t}, 'L', 'D', ${code.toLowerCase()}, ${code}, 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York'), (${B2}, ${T2}, 'Other salon', 'active', 'America/New_York')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, name) values (${CAT}, ${T}, 'Nails'), (${CAT2}, ${T2}, 'Nails')`.execute(db).catch(async () => {
    await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails'), (${CAT2}, ${T2}, ${B2}, 'Nails')`.execute(db);
  });
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 45, 5000), (${SVC_OTHER}, ${T2}, ${B2}, ${CAT2}, 'Theirs', 45, 9000)`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Ana', 'B', 'Ana B')`.execute(db);
  svc = new DealsService(new KyselyDealsRepository(db, new OutboxWriter()));
});

describe('bug 1 — oversell: a booked reservation keeps its place', () => {
  it('a deal capped at 2: two bookings, the third is sold out', async () => {
    const d = await activeDeal({ max_redemptions: 2 });
    expect((await book(d, await customer())).soldOut).toBe(false);
    expect((await book(d, await customer())).soldOut).toBe(false);
    expect((await book(d, await customer())).soldOut).toBe(true);
  });
});

describe('bug 4 — a deal is redeemed when the ticket is PAID, not when it is put on the ticket', () => {
  it('applying the booked deal at checkout leaves the redemption count alone', async () => {
    const d = await activeDeal();
    const c = await customer();
    const b = await book(d, c);
    const r = await svc.redeemDealAtCheckout(mgr, (b as any).appt, 5000, { customerId: c, branchId: B, ticketId: randomUUID() });
    expect(r.applied).toBe(true);
    const row = (await sql`select redemption_count from deals where id = ${d}`.execute(db)).rows[0] as any;
    expect(Number(row.redemption_count)).toBe(0);
  });
});

describe('bug 5 — eligibility is enforced when the deal is reserved', () => {
  it('new customers only: a customer with a paid visit is refused', async () => {
    const d = await activeDeal({ new_customers_only: true });
    const c = await customer(); await paidTicket(c);
    await expect(svc.reserveDeal(mgr, d, c, 'k-' + randomUUID(), facts)).rejects.toThrow(/new customers/i);
  });
  it('members only: a customer without an active membership is refused', async () => {
    const d = await activeDeal({ member_only: true });
    await expect(svc.reserveDeal(mgr, d, await customer(), 'k-' + randomUUID(), facts)).rejects.toThrow(/member/i);
  });
  it('one per customer: the same customer cannot book it twice', async () => {
    const d = await activeDeal({ max_per_customer: 1 });
    const c = await customer();
    expect((await book(d, c)).soldOut).toBe(false);
    await expect(svc.reserveDeal(mgr, d, c, 'k-' + randomUUID(), facts)).rejects.toThrow(/already used/i);
  });
});

describe('bug 6 — the date window', () => {
  it('a deal past its end, or before its start, cannot be reserved', async () => {
    const ended = await activeDeal({ ends_at: new Date(Date.now() - 3_600_000).toISOString() });
    await expect(svc.reserveDeal(mgr, ended, await customer(), 'k-' + randomUUID(), facts)).rejects.toThrow(/ended/i);
    const future = await activeDeal({ starts_at: new Date(Date.now() + 86_400_000).toISOString() });
    await expect(svc.reserveDeal(mgr, future, await customer(), 'k-' + randomUUID(), facts)).rejects.toThrow(/not started/i);
  });
});

describe('bugs 7 + 8 — the deal is written against THIS salon, at catalog prices', () => {
  it('another salon’s branch is refused', async () => {
    await expect(svc.createDeal(mgr, { ownerType: 'salon', title: 'X', discountType: 'percent', discountPercent: 10, branchId: B2, serviceIds: [SVC] })).rejects.toMatchObject({ name: 'DealValidationError' });
    // …also with no services named (so no other check can be what refuses it)
    await expect(svc.createDeal(mgr, { ownerType: 'salon', title: 'X', discountType: 'percent', discountPercent: 10, branchId: B2, serviceIds: [] })).rejects.toThrow('That location is not part of this salon.');
  });
  it('another salon’s service is refused', async () => {
    await expect(svc.createDeal(mgr, { ownerType: 'salon', title: 'X', discountType: 'percent', discountPercent: 10, serviceIds: [SVC_OTHER] })).rejects.toMatchObject({ name: 'DealValidationError' });
  });
  it('the original price comes from the catalog, never the request', async () => {
    const d = await svc.createDeal(mgr, { ownerType: 'salon', title: 'Cheap?', discountType: 'percent', discountPercent: 20, originalPriceCents: 1, serviceIds: [SVC] });
    expect(d.originalPriceCents).toBe(5000);
    expect(d.finalPriceCents).toBe(4000);
  });
});

describe('bug 12 — cancel / no-show give the deal back', () => {
  it('a cancelled appointment releases its reservation, and the place is bookable again', async () => {
    const d = await activeDeal({ max_redemptions: 1 });
    const b: any = await book(d, await customer());
    expect((await book(d, await customer())).soldOut).toBe(true);
    await sql`update pos_tech_appointments set status = 'cancelled' where id = ${b.appt}`.execute(db);
    await svc.releaseDealForAppointment(mgr, b.appt);
    expect((await book(d, await customer())).soldOut).toBe(false);
  });
});

describe('bug 17 — Super Admin suspend', () => {
  it('needs a reason, is audited, and a deal already booked no longer applies at checkout', async () => {
    const d = await activeDeal();
    const c = await customer();
    const b: any = await book(d, c);
    await expect((svc as any).superSuspendDeal(d, '')).rejects.toThrow(/reason/i);
    await (svc as any).superSuspendDeal(d, 'Misleading price claim', { userId: 'sa-1' });
    const r = await svc.redeemDealAtCheckout(mgr, b.appt, 5000, { customerId: c, branchId: B, ticketId: randomUUID() });
    expect(r.applied).toBe(false);
  });
});

describe('bug 18 — technician deals on auto-approve reach customers', () => {
  it('on_auto → active (not parked at approved)', async () => {
    await svc.updateSettings(mgr, { allowTechnicianDeals: 'on_auto' } as any);
    const d = await svc.createDeal({ ...mgr, technicianId: TECH }, { ownerType: 'technician', technicianId: TECH, title: 'Mine', discountType: 'percent', discountPercent: 10, serviceIds: [SVC] });
    expect(d.status).toBe('active');
  });
});

describe('bug 21 — bad input is a clean refusal', () => {
  it.each([12.5, 0, 101, -5])('percent %s → DealValidationError', async (p) => {
    await expect(svc.createDeal(mgr, { ownerType: 'salon', title: 'Bad', discountType: 'percent', discountPercent: p, serviceIds: [SVC] })).rejects.toMatchObject({ name: 'DealValidationError' });
  });
  it('a fixed discount of 0 or a fraction of a cent → DealValidationError', async () => {
    await expect(svc.createDeal(mgr, { ownerType: 'salon', title: 'Bad', discountType: 'fixed', discountCents: 0, serviceIds: [SVC] })).rejects.toMatchObject({ name: 'DealValidationError' });
    await expect(svc.createDeal(mgr, { ownerType: 'salon', title: 'Bad', discountType: 'fixed', discountCents: 10.5, serviceIds: [SVC] })).rejects.toMatchObject({ name: 'DealValidationError' });
  });
});
