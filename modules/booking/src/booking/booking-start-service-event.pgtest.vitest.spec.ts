// booking-start-service-event.pgtest — B-14 (Oct 20 2026): "Start service" from the Booking board used to be delivered to
// other screens ONLY by a direct realtime push (serviceStarted + queueUpdated + appointmentUpdated from the service) —
// no domain event, so with the publisher on it was the one board move that bypassed outbox → projection. Now the status
// write records appointment.updated { status: 'in_service' } in the same transaction (the queue item / tech ticket move
// with it, so the boards refetch on the projected serviceStarted / queueUpdated / appointmentUpdated).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyBookingRepository } from './booking.kysely.repository';

const T = 'a6510000-0000-4000-8000-000000000001';
const B = 'a6510000-0000-4000-8000-000000000002';
const TA = 'a6510000-0000-4000-8000-0000000000a1';
const ctx = { tenantId: T, branchId: B, userId: '', role: 'MANAGER', permissions: [] };
let pg: any; let repo: KyselyBookingRepository;
const rows = async (q: string) => (await pg.query(q)).rows;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'SS Salon', 'SS Salon', 'ss-salon', 'SSSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active');
  `);
  repo = new KyselyBookingRepository(kyselyFor(pg) as never, new OutboxWriter());
}, 120000);

describe('B-14: starting service from the Booking board is a recorded domain event', () => {
  it('checked_in → in_service writes appointment.updated { status: in_service } with the status write', async () => {
    const [{ id }] = await rows(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
      VALUES ('${T}', '${B}', '${TA}', 'Guest', '[{"serviceId":"","serviceName":"Gel","durationMinutes":60,"priceCents":4500}]', current_date, '10:00', '11:00', 60, 'checked_in', 'phone') RETURNING id`);
    expect(await repo.setStatus(ctx as never, id, 'in_service')).toBe(true);
    const ev = await rows(`SELECT event_type, payload_json FROM outbox_events WHERE tenant_id = '${T}' AND aggregate_id = '${id}' ORDER BY created_at`);
    expect(ev.map((e: any) => [e.event_type, e.payload_json?.status])).toEqual([['appointment.updated', 'in_service']]);
    expect(ev[0].payload_json).toMatchObject({ appointmentId: id, previousStatus: 'checked_in', status: 'in_service' });
  });
});
