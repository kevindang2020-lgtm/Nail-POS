// check-in-appointment-event.pgtest — B-14 (Oct 20 2026): an appointment checked in at the front desk or the Go Check-In
// kiosk moved the appointment to checked_in WITHOUT a domain event — the kiosk told the other screens with a direct
// realtime push only (customer_checked_in + appointment_updated from GoCheckInService). The Booking board's own
// check-in and the Technician app already record checkin.customer_checked_in on the appointment; now the check-in
// repository does too, in the same transaction as the status write and the queue item (queue.customer_joined).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyCheckInRepository } from './check-in.kysely.repository';

const T = 'a7210000-0000-4000-8000-0000000000a1', B = 'b7210000-0000-4000-8000-0000000000b1', TECH = 'c7210000-0000-4000-8000-0000000000c1';
const C = 'd7210000-0000-4000-8000-0000000000d1';
const ctx = { tenantId: T, branchId: B, userId: 'u', role: 'FRONT_DESK', permissions: [] } as any;
let pg: any; let repo: KyselyCheckInRepository;
const rows = async (q: string) => (await pg.query(q)).rows;
let seq = 0;
async function appt(): Promise<string> {
  return (await rows(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
    values ('${T}', '${B}', '${TECH}', '${C}', 'Guest', 'manual', '[]'::jsonb, current_date, '${10 + seq}:00', '${11 + seq++}:00', 60, 'booked', 'not_required') returning id`))[0].id;
}
const events = async (apptId: string) => (await rows(`select event_type, aggregate_type, payload_json from outbox_events where tenant_id = '${T}' and aggregate_id = '${apptId}' order by created_at`))
  .map((e: any) => ({ type: e.event_type, agg: e.aggregate_type, status: e.payload_json?.status, prev: e.payload_json?.previousStatus, customerId: e.payload_json?.customerId }));

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ('${T}', 'CI', 'CI', 'ci-ev-salon', 'CIEV', 'active');
    insert into branches (id, tenant_id, name, status) values ('${B}', '${T}', 'Main', 'active');
    insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ('${TECH}', '${T}', '${B}', 'Mia', 'Tran', 'Mia Tran');
    insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ('${C}', '${T}', '${B}', 'Guest', 'One', 'Guest One', '+18565550101');
  `);
  repo = new KyselyCheckInRepository(kyselyFor(pg) as any, new OutboxWriter());
}, 120000);

describe('B-14: a check-in of an appointment is a recorded domain event', () => {
  it('createVisitRecords: queue.customer_joined on the queue item AND checkin.customer_checked_in on the appointment, one transaction', async () => {
    const a = await appt();
    const out = await repo.createVisitRecords(ctx, [{ checkInId: 'ci_1', customerId: C, customerName: 'Guest One', isVip: false, appointmentId: a, services: [], source: 'appointment', checkedInAtMs: Date.now() } as any]);
    expect(out).toHaveLength(1);
    expect((await rows(`select status from pos_tech_appointments where id = '${a}'`))[0].status).toBe('checked_in');
    expect(await events(a)).toEqual([{ type: 'checkin.customer_checked_in', agg: 'appointment', status: 'checked_in', prev: 'booked', customerId: C }]);
    const joined = await rows(`select event_type from outbox_events where tenant_id = '${T}' and aggregate_id = '${out[0].checkInId}'`);
    expect(joined.map((e: any) => e.event_type)).toEqual(['queue.customer_joined']);
  });
  it('markAppointmentCheckedIn (the single-appointment path) records the same event; a repeat (already checked in) records nothing', async () => {
    const a = await appt();
    await repo.markAppointmentCheckedIn(ctx, a);
    expect(await events(a)).toEqual([{ type: 'checkin.customer_checked_in', agg: 'appointment', status: 'checked_in', prev: 'booked', customerId: C }]);
    await repo.markAppointmentCheckedIn(ctx, a);
    expect(await events(a)).toHaveLength(1);
  });
});
