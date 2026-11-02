// ai-booking-first-available.pgtest — Phase 15 (PROGRAMME_DOD_STATUS §6 item 4): a guest on the public signed booking
// link who picks "first available" (no technician) used to get INTERNAL_ERROR — the staff engine wrote technician_id
// NULL into a NOT NULL column. End to end through the public controller (real signed link, real resolver, real
// AiBookingMutationService, real BookingService on the real schema): the booking succeeds and is assigned by the
// engine's "any technician" rule. Fixed dates only.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { BookingService, KyselyBookingRepository } from '@aipowersalon/booking';
import { AiBookingPublicController } from './ai-booking-public.controller';
import { AiBookingPublicResolver } from './ai-booking-public.resolver';
import { AiBookingMutationService } from './ai-booking-mutation.service';
import { signBookingContext } from './ai-booking-signed-context';

const SECRET = 'fa-secret-0123456789abcdef';
const T = 'a6520000-0000-4000-8000-000000000001';
const B = 'a6520000-0000-4000-8000-000000000002';
const CAT = 'a6520000-0000-4000-8000-0000000000c1';
const SVC = 'a6520000-0000-4000-8000-000000000051';
const AVA = 'a6520000-0000-4000-8000-0000000000a1';
const BEA = 'a6520000-0000-4000-8000-0000000000b1';
const DAY = '2026-11-03';
const req = { headers: {}, ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' } };
let pg: any; let ctl: AiBookingPublicController;
const one = async (q: string) => (await pg.query(q)).rows[0];
const link = () => signBookingContext({ tenantId: T, branchId: B, source: 'ONLINE_BOOKING' }, { secret: SECRET, jti: 'fa-link-1' });

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'FA2 Salon', 'FA2 Salon', 'fa2-salon', 'FA2SALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 60, 4500, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES
      ('${BEA}', '${T}', '${B}', 'Bea', 'B', 'Bea B', 'active', true), ('${AVA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active', true);
    INSERT INTO technician_services (tenant_id, branch_id, technician_id, service_id) VALUES ('${T}', '${B}', '${AVA}', '${SVC}'), ('${T}', '${B}', '${BEA}', '${SVC}');
  `);
  const booking = new BookingService(new KyselyBookingRepository(kyselyFor(pg) as never));
  const conversion = { record: async () => undefined } as any;
  const mutation = new AiBookingMutationService(booking, conversion);
  ctl = new AiBookingPublicController({} as any, mutation, new AiBookingPublicResolver(), { enabled: false } as any, { isRevoked: async () => false } as any);
}, 120000);
beforeEach(() => { process.env.AI_BOOKING_LINK_SECRET = SECRET; });

describe('public signed booking link — "first available"', () => {
  it('books without a technician; the engine assigns the first free technician by name', async () => {
    const r: any = await ctl.create(req, { token: link(), customerName: 'Link Guest', customerPhone: '+18565550111', serviceIds: [SVC], date: DAY, startTime: '10:00', confirm: true, idempotencyKey: 'fa-1' });
    expect(r).toMatchObject({ ok: true });
    expect(r.appointmentId).toBeTruthy();
    const row = await one(`SELECT technician_id, source FROM pos_tech_appointments WHERE id = '${r.appointmentId}'`);
    expect(row.technician_id).toBe(AVA);
    const again: any = await ctl.create(req, { token: link(), customerName: 'Link Guest 2', customerPhone: '+18565550112', serviceIds: [SVC], date: DAY, startTime: '10:00', confirm: true, idempotencyKey: 'fa-2' });
    expect(again.ok).toBe(true);
    expect((await one(`SELECT technician_id FROM pos_tech_appointments WHERE id = '${again.appointmentId}'`)).technician_id).toBe(BEA);
  });
  it('nobody free → APPOINTMENT_CONFLICT (choose another time), not INTERNAL_ERROR', async () => {
    const r: any = await ctl.create(req, { token: link(), customerName: 'Link Guest 3', customerPhone: '+18565550113', serviceIds: [SVC], date: DAY, startTime: '10:30', confirm: true, idempotencyKey: 'fa-3' });
    expect(r).toMatchObject({ ok: false, errorCode: 'APPOINTMENT_CONFLICT' });
  });
});
