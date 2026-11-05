// booking-first-available.pgtest — Phase 15 (PROGRAMME_DOD_STATUS §6 item 4): a booking with NO technician ("first
// available" — the public signed booking link, the AI receptionist, the POS "First Available" chip) used to reach the
// staff engine with technician_id NULL and die on the NOT NULL column (an INTERNAL_ERROR to the guest). The engine now
// assigns one by the platform's "any technician" rule — the customer app's: technicians in name order, the first one
// free for the whole visit (and, here, skilled for it and inside their working windows — the same gates an explicit
// technician must pass). Real schema (PGlite, all migrations). Fixed dates only — nothing depends on today.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBookingRepository } from './booking.kysely.repository';
import { BookingService, ConflictError } from './booking.service';

const T = 'a6510000-0000-4000-8000-000000000001';
const B = 'a6510000-0000-4000-8000-000000000002';
const CAT = 'a6510000-0000-4000-8000-0000000000c1';
const CAT2 = 'a6510000-0000-4000-8000-0000000000c2';
const SVC = 'a6510000-0000-4000-8000-000000000051';
const SVC2 = 'a6510000-0000-4000-8000-000000000052';
const AVA = 'a6510000-0000-4000-8000-0000000000a1';    // "Ava" — first by name
const BEA = 'a6510000-0000-4000-8000-0000000000b1';    // "Bea"
const CY = 'a6510000-0000-4000-8000-0000000000d1';     // "Cy" — not skilled for manicures (pedicure only)
const DAY = '2026-11-02';                                // a Monday, fixed
const ctx = { tenantId: T, branchId: B, userId: 'u-front-desk', role: 'MANAGER', permissions: ['pos.booking.view', 'pos.booking.create'] };
let pg: any; let svc: BookingService;
const one = async (q: string) => (await pg.query(q)).rows[0];
const techOf = async (id: string) => (await one(`SELECT technician_id FROM pos_tech_appointments WHERE id = '${id}'`)).technician_id;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'FA Salon', 'FA Salon', 'fa-salon', 'FASALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures'), ('${CAT2}', '${T}', '${B}', 'Pedicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES
      ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 60, 4500, 'active'), ('${SVC2}', '${T}', '${B}', '${CAT2}', 'Spa Pedicure', 60, 5000, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${CY}', '${T}', '${B}', 'Cy', 'C', 'Cy C', 'active', true),
      ('${BEA}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active', true),
      ('${AVA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active', true);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES
      ('${T}', '${B}', '${AVA}', '${SVC}'), ('${T}', '${B}', '${BEA}', '${SVC}'), ('${T}', '${B}', '${CY}', '${SVC2}');
  `);
  svc = new BookingService(new KyselyBookingRepository(kyselyFor(pg) as never));
}, 120000);

describe('first available — a booking without a technician is assigned by the "any technician" rule', () => {
  it('books, and lands on the first technician by name who is free and skilled', async () => {
    const row = await svc.create(ctx as never, { customerName: 'Guest One', serviceIds: [SVC], date: DAY, startTime: '10:00', source: 'online' } as never);
    expect(row.appointmentId).toBeTruthy();
    expect(row.technicianId).toBe(AVA);
    expect(await techOf(row.appointmentId)).toBe(AVA);
  });
  it('the same time again goes to the next free technician (Ava is now busy) — never to the unskilled one', async () => {
    const row = await svc.create(ctx as never, { customerName: 'Guest Two', serviceIds: [SVC], date: DAY, startTime: '10:00', source: 'online' } as never);
    expect(await techOf(row.appointmentId)).toBe(BEA);
  });
  it('nobody skilled is free → an honest conflict (APPOINTMENT_CONFLICT), not a database error; nothing is written', async () => {
    const before = Number((await one(`SELECT count(*)::int AS n FROM pos_tech_appointments WHERE tenant_id = '${T}'`)).n);
    await expect(svc.create(ctx as never, { customerName: 'Guest Three', serviceIds: [SVC], date: DAY, startTime: '10:30', source: 'online' } as never))
      .rejects.toBeInstanceOf(ConflictError);
    expect(Number((await one(`SELECT count(*)::int AS n FROM pos_tech_appointments WHERE tenant_id = '${T}'`)).n)).toBe(before);
  });
  it('a technician off schedule that day is skipped (working windows are respected)', async () => {
    // Monday = day_of_week 1: Ava does not work Mondays; Bea works 09:00–19:00.
    await pg.exec(`INSERT INTO technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) VALUES
      ('${T}', '${B}', '${AVA}', 1, '09:00', '19:00', false), ('${T}', '${B}', '${BEA}', 1, '09:00', '19:00', true)`);
    const row = await svc.create(ctx as never, { customerName: 'Guest Four', serviceIds: [SVC], date: DAY, startTime: '14:00', source: 'online' } as never);
    expect(await techOf(row.appointmentId)).toBe(BEA);
    await pg.exec(`DELETE FROM technician_schedules WHERE tenant_id = '${T}'`);
  });
  it('an explicit technician is untouched by the rule', async () => {
    const row = await svc.create(ctx as never, { customerName: 'Guest Five', serviceIds: [SVC], date: DAY, startTime: '16:00', technicianId: BEA, source: 'manual' } as never);
    expect(await techOf(row.appointmentId)).toBe(BEA);
  });
  it('Fair Turn §19: a first-available booking is marked any_technician (counts under COUNT_ANY_TECH_APPOINTMENTS); a chosen technician is not', async () => {
    const any = (await one(`SELECT bool_and(any_technician) AS a FROM pos_tech_appointments WHERE tenant_id = '${T}' AND customer_name IN ('Guest One', 'Guest Two', 'Guest Four')`)).a;
    const chosen = (await one(`SELECT any_technician AS a FROM pos_tech_appointments WHERE tenant_id = '${T}' AND customer_name = 'Guest Five'`)).a;
    expect(any).toBe(true);
    expect(chosen).not.toBe(true);   // null (not marked) — only a first-available booking is flagged
  });
});
