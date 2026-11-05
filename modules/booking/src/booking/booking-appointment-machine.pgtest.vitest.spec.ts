// booking-appointment-machine.pgtest — BUILD_PLAN Phase 12 round 2 (#27): the Booking board's status writes run through the
// APPOINTMENT machine on the real schema. Cancelling or no-showing a COMPLETED visit used to succeed (and its cascade
// cancelled the linked queue item / tech ticket / paid ticket); now it is 409 and nothing moves. The moves the board has
// always made still land, and a cancelled visit rescheduled is booked again (the one revival the machine lists).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InvalidStateTransitionError } from '@aipowersalon/database';
import { KyselyBookingRepository } from './booking.kysely.repository';

const T = 'a6500000-0000-4000-8000-000000000001';
const B = 'a6500000-0000-4000-8000-000000000002';
const TA = 'a6500000-0000-4000-8000-0000000000a1';
const ctx = { tenantId: T, branchId: B, userId: '', role: 'MANAGER', permissions: [] };
let pg: any; let repo: KyselyBookingRepository; let seq = 0;
const one = async (q: string) => (await pg.query(q)).rows[0];
async function appt(status: string, start = '10:00'): Promise<string> {
  return (await one(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
    VALUES ('${T}', '${B}', '${TA}', 'Guest ${++seq}', '[{"serviceId":"","serviceName":"Gel","durationMinutes":60,"priceCents":4500}]', '2026-10-0${(seq % 8) + 1}', '${start}', '${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00', 60, '${status}', 'phone') RETURNING id`)).id;
}
const statusOf = async (id: string) => (await one(`SELECT status FROM pos_tech_appointments WHERE id = '${id}'`)).status;

beforeAll(async () => {
  pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'BK Salon', 'BK Salon', 'bk-salon', 'BKSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active');
  `);
  repo = new KyselyBookingRepository(kyselyFor(pg) as never);
}, 120000);

describe('Booking board — appointment status through the APPOINTMENT machine', () => {
  it('cancelling a COMPLETED visit is 409; its queue item is not cancelled', async () => {
    const id = await appt('completed');
    const q = (await one(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, status, source, priority, requested_services, appointment_id) VALUES ('${T}', '${B}', 'G', 'completed', 'walk_in', 'normal', '[]', '${id}') RETURNING id`)).id;
    await expect(repo.setStatus(ctx as never, id, 'cancelled')).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(await statusOf(id)).toBe('completed');
    expect((await one(`SELECT status FROM pos_queue_items WHERE id = '${q}'`)).status).toBe('completed');
  });
  it('no-showing a completed visit is 409', async () => {
    const id = await appt('completed');
    await expect(repo.setStatus(ctx as never, id, 'no_show')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409 });
  });
  it('today’s moves still land: booked → confirmed → arrived → checked_in → in_service → completed; a booked visit cancels', async () => {
    const id = await appt('booked');
    for (const st of ['confirmed', 'arrived', 'checked_in', 'in_service', 'completed'] as const) { expect(await repo.setStatus(ctx as never, id, st)).toBe(true); expect(await statusOf(id)).toBe(st); }
    const c = await appt('booked');
    expect(await repo.setStatus(ctx as never, c, 'cancelled')).toBe(true);
  });
  it('a cancelled visit rescheduled is booked again; a confirmed one keeps its status', async () => {
    const c = await appt('cancelled', '13:00');
    expect(await repo.reschedule(ctx as never, c, undefined, '14:00', undefined)).toBe(true);
    expect(await statusOf(c)).toBe('booked');
    const k = await appt('confirmed', '15:00');
    expect(await repo.reschedule(ctx as never, k, undefined, '16:00', undefined)).toBe(true);
    expect(await statusOf(k)).toBe('confirmed');
  });
});
