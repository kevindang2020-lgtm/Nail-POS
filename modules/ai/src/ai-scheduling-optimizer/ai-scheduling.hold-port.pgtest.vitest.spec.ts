// ai-scheduling.hold-port.pgtest — Round 3 H2 (Oct 12 2026): the optimizer's hold port acquires under the booking
// engine's hold lock and re-checks appointments: a hold on a time the technician is already booked for is refused
// (SLOT_HELD — findOptions answers "just reserved"), a free time is held. Real schema (PGlite); fixed dates.
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { localDateTimeToEpochMs } from '@aipowersalon/date-time';
import { schedHoldPort } from './ai-scheduling.hold-port';

const T = 'a6760000-0000-4000-8000-000000000001';
const B = 'a6760000-0000-4000-8000-000000000002';
const ANA = 'a6760000-0000-4000-8000-0000000000a1';
const DAY = '2030-11-08';
const ms = (hhmm: string) => localDateTimeToEpochMs(DAY, hhmm, 'America/New_York');
let pg: any; let port: ReturnType<typeof schedHoldPort>;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Port Salon', 'Port Salon', 'port-salon', 'PORTSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) VALUES ('${ANA}', '${T}', '${B}', 'Ana', 'A', 'Ana A', 'active', true);
    INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
      VALUES ('${T}', '${B}', '${ANA}', 'Booked', 'manual', '[]', '${DAY}', '10:00', '11:00', 60, 'booked', 'not_required');
  `);
  port = schedHoldPort(kyselyFor(pg) as never);
}, 120000);

describe('optimizer hold port', () => {
  it('refuses a hold over a booked time (SLOT_HELD); holds a free time', async () => {
    const req = (from: string, to: string) => ({ tenantId: T, branchId: B, technicianId: ANA, startsAt: ms(from), endsAt: ms(to), bookingSessionId: randomUUID(), channel: 'ai_receptionist' });
    await expect(port.acquire(req('10:30', '11:30'))).rejects.toMatchObject({ code: 'SLOT_HELD' });
    const h = await port.acquire(req('12:00', '13:00'));
    expect(h.holdId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await pg.query(`SELECT count(*)::int AS n FROM booking_holds WHERE tenant_id = '${T}' AND released_at IS NULL`)).rows[0].n).toBe(1);
  });
});
