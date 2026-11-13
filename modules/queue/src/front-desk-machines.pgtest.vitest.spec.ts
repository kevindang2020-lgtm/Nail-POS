// front-desk-machines.pgtest — BUILD_PLAN Phase 12 round 2 (#27): the appointment / queue item / technician-ticket machines
// (@aipowersalon/appointments front-desk-lifecycles) on the real schema, through the queue module's own writers:
//   • the tables keep today's moves (every active state moves freely; a finished visit re-opens into service) and every
//     state is in its column's Phase 10 CHECK;
//   • the dangerous moves the unconditional writes allowed are refused — cancelling a COMPLETED queue item (whose cascade
//     cancelled the paid ticket) answers 409 and changes nothing; calling a cancelled guest back is 409; a cascade never
//     revives a cancelled appointment; a technician cannot complete a cancelled ticket; the desk cannot decline a ticket
//     already in service;
//   (the stale-read / concurrent-writer 409 is proved on real Postgres: front-desk-machines.postgres-race.vitest.spec.ts)
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { InvalidStateTransitionError } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET } from '@aipowersalon/appointments';
import { QUEUE_SERVICE_ASSIGNMENT, GO_CHECKIN_DEVICE, GO_CHECKIN_SESSION, TICKET_CHANGE_REQUEST, SKILL_CHANGE_REQUEST, MANAGER_MESSAGE, WALKIN_SERVICE_REQUEST } from './queue-lifecycles';
import { KyselyQueueRepository } from './queue/queue.kysely.repository';
import { KyselyCheckInRepository } from './check-in/check-in.kysely.repository';
import { KyselyTechRepository } from './tech/tech.kysely.repository';
import { KyselyTechQueueRepository } from './tech-queue/tech-queue.kysely.repository';

const T = 'a6400000-0000-4000-8000-000000000001';
const B = 'a6400000-0000-4000-8000-000000000002';
const TA = 'a6400000-0000-4000-8000-0000000000a1';
const MGR = 'a6400000-0000-4000-8000-0000000000e2';
const ctx = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: [] as string[] };
let pg: any; let db: any; let seq = 0;
const one = async (q: string) => (await pg.query(q)).rows[0];
const statusOf = async (table: string, id: string) => (await one(`SELECT status FROM ${table} WHERE id = '${id}'`))?.status;

async function appt(status: string): Promise<string> {
  return (await one(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, services, appt_date, start_time, end_time, duration_minutes, status, source)
    VALUES ('${T}', '${B}', '${TA}', 'Guest ${++seq}', '[]', '2026-10-08', '10:00', '10:45', 45, '${status}', 'phone') RETURNING id`)).id;
}
async function qi(status: string, apptId?: string): Promise<string> {
  return (await one(`INSERT INTO pos_queue_items (tenant_id, branch_id, customer_name, status, source, priority, requested_services${apptId ? ', appointment_id' : ''})
    VALUES ('${T}', '${B}', 'Guest ${++seq}', '${status}', 'walk_in', 'normal', '[]'${apptId ? `, '${apptId}'` : ''}) RETURNING id`)).id;
}
async function tq(status: string, extra: { appointmentId?: string; queueItemId?: string } = {}): Promise<string> {
  return (await one(`INSERT INTO pos_tech_queue_tickets (tenant_id, branch_id, customer_name, status, source, priority, requested_services, assigned_technician_id${extra.appointmentId ? ', appointment_id' : ''}${extra.queueItemId ? ', queue_item_id' : ''})
    VALUES ('${T}', '${B}', 'Guest ${++seq}', '${status}', 'walk_in', 'normal', '[]', '${TA}'${extra.appointmentId ? `, '${extra.appointmentId}'` : ''}${extra.queueItemId ? `, '${extra.queueItemId}'` : ''}) RETURNING id`)).id;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'FD Salon', 'FD Salon', 'fd-salon', 'FDSALON', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'Main', 'active');
    INSERT INTO users (id, tenant_id, full_name, status, role) VALUES ('${MGR}', '${T}', 'Manager', 'active', 'MANAGER');
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TA}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active');
  `);
}, 120000);

describe('the transition tables', () => {
  const vocab = JSON.parse(readFileSync(join(__dirname, '../../../apps/api/db/state-vocabularies.generated.json'), 'utf8')).vocabularies;
  const all = [APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET, QUEUE_SERVICE_ASSIGNMENT, GO_CHECKIN_DEVICE, GO_CHECKIN_SESSION, TICKET_CHANGE_REQUEST, SKILL_CHANGE_REQUEST, MANAGER_MESSAGE, WALKIN_SERVICE_REQUEST];
  it('every state is in its column’s CHECK vocabulary', () => {
    for (const m of all) expect(m.states.filter((s) => !(vocab[`${m.table}.${m.column}`] ?? []).includes(s)), m.name).toEqual([]);
  });
  it('keep today’s moves: active states move freely, a finished visit re-opens into service, a cancelled / no-show visit is rescheduled to booked', () => {
    for (const [f, t] of [['booked', 'checked_in'], ['in_service', 'checked_in'], ['checked_in', 'in_service'], ['completed', 'in_service'], ['cancelled', 'booked'], ['no_show', 'booked'], ['completed', 'completed']]) expect(APPOINTMENT.can(f, t), `${f}>${t}`).toBe(true);
    for (const [f, t] of [['waiting', 'called'], ['assigned', 'waiting'], ['moved_to_tech_queue', 'in_service'], ['completed', 'in_service'], ['cancelled', 'removed']]) expect(QUEUE_ITEM.can(f, t), `${f}>${t}`).toBe(true);
    for (const [f, t] of [['assigned', 'accepted'], ['waiting_for_acceptance', 'expired'], ['accepted', 'in_service'], ['in_service', 'paused'], ['paused', 'in_service'], ['expired', 'assigned'], ['in_service', 'service_done']]) expect(TECH_QUEUE_TICKET.can(f, t), `${f}>${t}`).toBe(true);
  });
  it('refuse the dangerous moves the unconditional writers allowed', () => {
    for (const [f, t] of [['completed', 'cancelled'], ['completed', 'no_show'], ['cancelled', 'checked_in'], ['cancelled', 'in_service'], ['no_show', 'in_service']]) expect(APPOINTMENT.can(f, t), `${f}>${t}`).toBe(false);
    for (const [f, t] of [['completed', 'cancelled'], ['cancelled', 'called'], ['removed', 'waiting'], ['cancelled', 'in_service']]) expect(QUEUE_ITEM.can(f, t), `${f}>${t}`).toBe(false);
    for (const [f, t] of [['cancelled', 'service_done'], ['declined', 'service_done'], ['in_service', 'declined'], ['service_done', 'cancelled'], ['cancelled', 'in_service'], ['service_done', 'delayed']]) expect(TECH_QUEUE_TICKET.can(f, t), `${f}>${t}`).toBe(false);
    expect(GO_CHECKIN_DEVICE.can('revoked', 'active')).toBe(false);
    expect(MANAGER_MESSAGE.can('resolved', 'resolved')).toBe(true);
    expect(WALKIN_SERVICE_REQUEST.can('queued', 'pending')).toBe(false);   // migration 990: a queued walk-in request is final
    expect(WALKIN_SERVICE_REQUEST.can('failed', 'pending')).toBe(true);    // …a failed one is retried by the same request
  });
});

describe('the writers, on the real schema', () => {
  it('cancelling a COMPLETED queue item is 409 — nothing changes, the paid ticket is not cancelled', async () => {
    const id = await qi('completed');
    await expect(new KyselyQueueRepository(db).setStatus(ctx as never, id, 'cancelled')).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(await statusOf('pos_queue_items', id)).toBe('completed');
  });
  it('cancelling a waiting guest still works, and its cascade cancels the live tech ticket but never revives a finished appointment', async () => {
    const a = await appt('completed'); const id = await qi('waiting', a); const t = await tq('assigned', { queueItemId: id });
    expect(await new KyselyQueueRepository(db).setStatus(ctx as never, id, 'cancelled')).toBe(true);
    expect([await statusOf('pos_queue_items', id), await statusOf('pos_tech_queue_tickets', t), await statusOf('pos_tech_appointments', a)]).toEqual(['cancelled', 'cancelled', 'completed']);
  });
  it('calling a cancelled guest back into the queue is 409', async () => {
    const id = await qi('cancelled');
    await expect(new KyselyQueueRepository(db).markCalled(ctx as never, id)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', status: 409 });
    expect(await statusOf('pos_queue_items', id)).toBe('cancelled');
  });
  it('a check-in status cascade never revives a cancelled appointment', async () => {
    const a = await appt('cancelled'); const id = await qi('waiting', a);
    await new KyselyCheckInRepository(db).setStatus(ctx as never, id, 'in_service' as never);
    expect([await statusOf('pos_queue_items', id), await statusOf('pos_tech_appointments', a)]).toEqual(['in_service', 'cancelled']);
  });
  it('a technician cannot complete a cancelled ticket (409, before anything is written)', async () => {
    const id = await tq('cancelled');
    await expect(new KyselyTechRepository(db).complete(ctx as never, id, {} as never)).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(await statusOf('pos_tech_queue_tickets', id)).toBe('cancelled');
    expect((await one(`SELECT count(*)::int AS n FROM tickets WHERE tenant_id = '${T}'`)).n).toBe(0);
  });
  it('the desk cannot decline a ticket already in service; a pending offer still declines', async () => {
    const repo = new KyselyTechQueueRepository(db);
    const busy = await tq('in_service'); const pending = await tq('assigned');
    await expect(repo.setStatus(ctx as never, busy, 'declined')).rejects.toBeInstanceOf(InvalidStateTransitionError);
    expect(await repo.setStatus(ctx as never, pending, 'declined')).toBe(true);
    expect([await statusOf('pos_tech_queue_tickets', busy), await statusOf('pos_tech_queue_tickets', pending)]).toEqual(['in_service', 'declined']);
  });
});
