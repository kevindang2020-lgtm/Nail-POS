// branch-service-price.pgtest — Oct 14 build plan §140 ("branch price / duration / availability"), checked Oct 21 2026.
// Services are per BRANCH in this schema (services.branch_id NOT NULL, migration 006): each location owns its own price,
// duration and status for a service, so no parallel "override" table is needed — ONE authority. What was missing:
// the customer app's getService read the service by id with NO branch scope, so a booking at Cherry Hill could name the
// Main branch's row and book Cherry Hill's technician at Main's price and duration. Now a service is bookable only at
// its own branch, and each branch's list shows its own numbers.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomerBookingRepository } from './customer-booking.kysely.repository';

const T = 'd1400000-0000-4000-8000-000000000001', MAIN = 'd1400000-0000-4000-8000-000000000002', CH = 'd1400000-0000-4000-8000-000000000003';
const CAT = 'd1400000-0000-4000-8000-0000000000a1', S_MAIN = 'd1400000-0000-4000-8000-0000000000a2', S_CH = 'd1400000-0000-4000-8000-0000000000a3', S_CH_OFF = 'd1400000-0000-4000-8000-0000000000a4';
let db: any; let repo: KyselyCustomerBookingRepository;
const ctx = (branchId: string) => ({ tenantId: T, branchId, userId: 'u' });

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  repo = new KyselyCustomerBookingRepository(db);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'B', 'B Salon', 'b-br', 'BBR1', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${MAIN}, ${T}, 'Main'), (${CH}, ${T}, 'Cherry Hill')`.execute(db);
  await sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${MAIN}, 'Nails')`.execute(db);
  await sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values
    (${S_MAIN}, ${T}, ${MAIN}, ${CAT}, 'Gel Manicure', 45, 4500, 'active'),
    (${S_CH}, ${T}, ${CH}, ${CAT}, 'Gel Manicure', 60, 5500, 'active'),
    (${S_CH_OFF}, ${T}, ${CH}, ${CAT}, 'Acrylic Full Set', 90, 8000, 'inactive')`.execute(db);
}, 120_000);

describe('each branch owns its own price, duration and availability', () => {
  it('the list at each branch shows that branch\'s numbers; an inactive service is not offered there', async () => {
    expect((await repo.listServices(ctx(MAIN))).map((s) => [s.name, s.priceCents, s.durationMinutes])).toEqual([['Gel Manicure', 4500, 45]]);
    expect((await repo.listServices(ctx(CH))).map((s) => [s.name, s.priceCents, s.durationMinutes])).toEqual([['Gel Manicure', 5500, 60]]);
  });
  it('a service is bookable only at its own branch: Cherry Hill cannot book Main\'s row (Main\'s price) and vice versa', async () => {
    expect(await repo.getService(ctx(CH), S_CH)).toMatchObject({ priceCents: 5500, durationMinutes: 60 });
    expect(await repo.getService(ctx(CH), S_MAIN)).toBeNull();
    expect(await repo.getService(ctx(MAIN), S_CH)).toBeNull();
    expect(await repo.getService(ctx(CH), S_CH_OFF)).toBeNull();   // switched off at that branch
  });
});

// Oct 21 2026 ("one appointment writer"): the customer app's booking used to write NO appointment.created — the POS
// booking board heard of an online booking only from the 15-second sync, analytics never. Now every appointment row is
// born in AppointmentWriter with its event.
import { OutboxWriter } from '@aipowersalon/events';
describe('an online booking announces itself', () => {
  it('insertBookingAtomic writes the row AND appointment.created in one transaction', async () => {
    const TECH = 'd1400000-0000-4000-8000-0000000000e1', CUST = 'd1400000-0000-4000-8000-0000000000c1';
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${CH}, 'Tina', 'Tech', 'Tina Tech')`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${CUST}, ${T}, ${CH}, 'Ana', 'Lee', 'Ana Lee', 'active')`.execute(db);
    const r2 = new KyselyCustomerBookingRepository(db, new OutboxWriter());
    const res: any = await r2.insertBookingAtomic({ tenantId: T, branchId: CH, technicianId: TECH, customerId: CUST, customerName: 'Ana', serviceId: S_CH, serviceName: 'Gel Manicure', durationMinutes: 60, priceCents: 5500, date: '2027-05-05', startTime: '10:00', endTime: '11:00', bufferMinutes: 0 } as any);
    expect(res.ok).toBe(true);
    const ev = (await sql`select event_type, payload_json from outbox_events where tenant_id = ${T} and aggregate_id = ${res.id}`.execute(db)).rows as any[];
    expect(ev.map((e) => e.event_type)).toEqual(['appointment.created']);
    expect(ev[0].payload_json).toMatchObject({ appointmentId: res.id, technicianId: TECH, source: 'customer_app', serviceCount: 1 });
    expect(JSON.stringify(ev[0].payload_json)).not.toContain('Ana');   // §95: never the customer's name
  });
});

// Oct 21 2026 (check:silent-catch): a guard READ fails CLOSED. The POS booking engine's conflict re-check answered "no
// appointments today" on a database error (`.catch(() => [])`) — a double-booking could pass every buffer rule and
// reach the overlap constraint, which knows nothing of buffers. Now the read's error is the caller's error.
import { KyselyBookingRepository } from '../booking/booking.kysely.repository';
describe('a guard read fails closed', () => {
  it('existingForConflict throws on a database error instead of answering "nothing in the way"', async () => {
    const posRepo = new KyselyBookingRepository(db);
    const posCtx: any = { tenantId: T, branchId: CH, userId: 'u', role: 'OWNER', permissions: [] };
    expect(Array.isArray(await posRepo.existingForConflict(posCtx, '2027-05-05'))).toBe(true);
    await sql`alter table pos_tech_appointments rename to pos_tech_appointments_gone`.execute(db);
    try { await expect(posRepo.existingForConflict(posCtx, '2027-05-05')).rejects.toThrow(); }
    finally { await sql`alter table pos_tech_appointments_gone rename to pos_tech_appointments`.execute(db); }
  });
});

// §43 (Oct 21 2026): the appointment's row version rides on its events (outbox aggregate_version) — a new row is 1, a
// status change carries the bumped version — so the realtime projection can hand clients a resourceVersion.
describe('appointment events carry the row version', () => {
  it('created = 1; a status change = the bumped version', async () => {
    const TECH2 = 'd1400000-0000-4000-8000-0000000000e2';
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH2}, ${T}, ${CH}, 'Tess', 'Tech', 'Tess Tech')`.execute(db);
    const r2 = new KyselyCustomerBookingRepository(db, new OutboxWriter());
    const res: any = await r2.insertBookingAtomic({ tenantId: T, branchId: CH, technicianId: TECH2, customerId: 'd1400000-0000-4000-8000-0000000000c1', customerName: 'Ana', serviceId: S_CH, serviceName: 'Gel Manicure', durationMinutes: 60, priceCents: 5500, date: '2027-06-06', startTime: '10:00', endTime: '11:00', bufferMinutes: 0 } as any);
    const pos = new KyselyBookingRepository(db, new OutboxWriter());
    await pos.setStatus({ tenantId: T, branchId: CH, userId: 'd1400000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: [] } as any, res.id, 'confirmed');
    const ev = (await sql`select event_type, aggregate_version from outbox_events where tenant_id = ${T} and aggregate_id = ${res.id} order by created_at`.execute(db)).rows as any[];
    expect(ev.map((e) => [e.event_type, Number(e.aggregate_version)])).toEqual([['appointment.created', 1], ['appointment.confirmed', 2]]);
  });
});
