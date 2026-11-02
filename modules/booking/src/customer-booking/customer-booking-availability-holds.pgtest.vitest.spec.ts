// customer-booking-availability-holds.pgtest — Round 3 H2 (Oct 12 2026), gap 3: CustomerBookingService.availability
// (the customer app, and the AI receptionist's fallback when the scheduling optimizer is absent) does not offer a slot
// another session holds — and DOES still offer the asking session's own hold (the caller on the phone who was just
// promised 13:00 must hear 13:00 again, not "nothing free"). Real schema (PGlite), the real admission adapter
// (customerAppAdmission → heldSlots over booking_holds). Fixed dates; hold expiry relative to the database's now().
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerBookingService } from './customer-booking.service';
import { KyselyCustomerBookingRepository } from './customer-booking.kysely.repository';
import { customerAppAdmission } from './customer-booking.module';
import { KyselyHoldRepository } from './booking-hold.kysely';

const T = 'a6750000-0000-4000-8000-000000000001';
const B = 'a6750000-0000-4000-8000-000000000002';
const CAT = 'a6750000-0000-4000-8000-0000000000c1';
const SVC = 'a6750000-0000-4000-8000-000000000051';
const ANA = 'a6750000-0000-4000-8000-0000000000a1';
const DAY = '2030-11-07';
const ctx = { tenantId: T, branchId: B, userId: 'voice-receptionist' } as any;
let pg: any; let svc: CustomerBookingService;
const at = (hhmm: string) => `('${DAY} ${hhmm}'::timestamp AT TIME ZONE 'America/New_York')`;
async function hold(from: string, to: string, session = randomUUID()) {
  await pg.query(`INSERT INTO booking_holds (tenant_id, branch_id, technician_id, start_time, end_time, expires_at, status, booking_session_id, channel)
    VALUES ('${T}', '${B}', '${ANA}', ${at(from)}, ${at(to)}, now() + interval '10 minutes', 'held', '${session}', 'ai_receptionist')`);
  return session;
}
const techsAt = (r: any, t: string): string[] => r.slots.find((s: any) => s.startTime === t)?.technicianIds ?? [];

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Avail Salon', 'Avail Salon', 'avail-salon', 'AVAILSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO service_categories (id, tenant_id, branch_id, name) VALUES ('${CAT}', '${T}', '${B}', 'Manicures');
    INSERT INTO services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) VALUES ('${SVC}', '${T}', '${B}', '${CAT}', 'Gel Manicure', 60, 4500, 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES ('${ANA}', '${T}', '${B}', 'Ana', 'A', 'Ana A', 'active', true);
  `);
  const db = kyselyFor(pg) as never;
  const unused = new Proxy({}, { get: () => () => { throw new Error('not used by availability'); } }) as any;
  svc = new CustomerBookingService(new KyselyCustomerBookingRepository(db), undefined, customerAppAdmission(unused, unused, db, new KyselyHoldRepository(db)));
}, 120000);

describe('customer / voice availability and live holds', () => {
  it('a slot another session holds is not offered; the asking session\'s own hold stays offered', async () => {
    const free = await svc.availability(ctx, { serviceId: SVC, date: DAY });
    expect(techsAt(free, '10:00')).toEqual([ANA]);
    expect(techsAt(free, '13:00')).toEqual([ANA]);

    await hold('10:00', '11:00');                              // somebody else's caller
    const mine = await hold('13:00', '14:00');                 // this caller's own hold

    const asOther = await svc.availability(ctx, { serviceId: SVC, date: DAY });
    expect(techsAt(asOther, '10:00')).toEqual([]);
    expect(techsAt(asOther, '13:00')).toEqual([]);             // to everyone else, 13:00 is held

    const asMe = await svc.availability(ctx, { serviceId: SVC, date: DAY, bookingSessionId: mine } as any);
    expect(techsAt(asMe, '10:00')).toEqual([]);               // still somebody else's
    expect(techsAt(asMe, '13:00')).toEqual([ANA]);            // mine — offered again
    expect(techsAt(asMe, '16:00')).toEqual([ANA]);
  });
});
