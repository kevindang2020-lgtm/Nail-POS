// voice-first-available.pgtest — Phase 15 (PROGRAMME_DOD_STATUS §6 item 4): a caller who tells the AI receptionist
// "anyone is fine" (no technician) used to be told the booking could not be completed — the staff engine wrote
// technician_id NULL into a NOT NULL column. Through the real VoiceBookingWriteService and the real BookingService on the
// real schema: the booking succeeds, is assigned by the engine's "any technician" rule, and a fully booked time is
// relayed as "slot unavailable" (offer another time), never as a failure. Fixed dates only.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BookingService, KyselyBookingRepository } from '@aipowersalon/booking';
import { VoiceBookingWriteService } from './voice-booking-write.service';

const T = 'a6530000-0000-4000-8000-000000000001';
const B = 'a6530000-0000-4000-8000-000000000002';
const CAT = 'a6530000-0000-4000-8000-0000000000c1';
const SVC = 'a6530000-0000-4000-8000-000000000051';
const AVA = 'a6530000-0000-4000-8000-0000000000a1';
const BEA = 'a6530000-0000-4000-8000-0000000000b1';
const DAY = '2026-11-04';
const v = { tenantId: T, branchId: B };
let pg: any; let svc: VoiceBookingWriteService;
const one = async (q: string) => (await pg.query(q)).rows[0];

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'FA3 Salon', 'FA3 Salon', 'fa3-salon', 'FA3SALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 60, 4500, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${BEA}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active', true), ('${AVA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active', true);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${AVA}', '${SVC}'), ('${T}', '${B}', '${BEA}', '${SVC}');
  `);
  svc = new VoiceBookingWriteService(new BookingService(new KyselyBookingRepository(kyselyFor(pg) as never)));
}, 120000);

describe('AI receptionist — "first available"', () => {
  it('books without a technician; assigned the first free technician by name, source ai', async () => {
    const r = await svc.createAppointment(v, { serviceId: SVC, date: DAY, startTime: '11:00', customerName: 'Caller One', customerPhone: '+18565550121', confirmed: true });
    expect(r).toMatchObject({ ok: true, technicianName: 'Ava A' });
    const row = await one(`SELECT technician_id, source FROM pos_tech_appointments WHERE id = '${r.appointmentId}'`);
    expect(row).toMatchObject({ technician_id: AVA, source: 'ai' });
    const r2 = await svc.createAppointment(v, { serviceId: SVC, date: DAY, startTime: '11:00', customerName: 'Caller Two', customerPhone: '+18565550122', confirmed: true });
    expect(r2).toMatchObject({ ok: true, technicianName: 'Bea B' });
  });
  it('nobody free → slotUnavailable (offer another time)', async () => {
    const r = await svc.createAppointment(v, { serviceId: SVC, date: DAY, startTime: '11:30', customerName: 'Caller Three', customerPhone: '+18565550123', confirmed: true });
    expect(r).toMatchObject({ ok: false, slotUnavailable: true });
  });
});
