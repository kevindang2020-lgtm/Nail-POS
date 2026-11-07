// consumers.pgtest — Constitution 8 Phases 13–14 through the REAL loop on real Postgres.
// A domain event written to the outbox is published; the realtime projection turns it into the existing client
// event (§112–113); the push consumer notifies the technician (§57, §105). Both exactly once, even when the
// same event is delivered again (§22–23).
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { RealtimeProjectionConsumer, projectToClient } from './realtime-projection.consumer';
import { PushNotificationConsumer } from './push-notification.consumer';
import { EVENTS } from '@aipowersalon/realtime-contracts';

const T = '11111111-1111-1111-1111-111111111111';
const B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
let db: any; let publisher: OutboxPublisher; let runner: ConsumerRunner; let registry: ConsumerRegistry;
const emitted: { ctx: any; event: string; payload: any }[] = [];
const pushed: { userId: string; msg: any }[] = [];
let pushShouldFail = false;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                 VALUES ('${T}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg);
  registry = new ConsumerRegistry();
  registry.register(new RealtimeProjectionConsumer({ toTenant: (ctx, event, payload) => { emitted.push({ ctx, event, payload }); } }));
  registry.register(new PushNotificationConsumer(
    { async dispatchToUser(_t, userId, msg) { if (pushShouldFail) throw new Error('provider unavailable'); pushed.push({ userId, msg }); return {}; } },
    { async technicianUserId(_ctx, technicianId) { return technicianId === 'tech-with-app' ? 'user-42' : null; } },
  ));
  runner = new ConsumerRunner(db, { rand: () => 0 });
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, runner));
}, 60_000);

const assigned = (id: string, technicianId = 'tech-with-app') => createDomainEvent({
  eventType: DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED, tenantId: T, branchId: B, aggregateType: 'queue_item', aggregateId: id, actorType: 'user',
  payload: { queueItemId: id, technicianId, previousStatus: 'waiting', status: 'assigned' },
});

describe('Phase 14 — realtime projection (§112–113)', () => {
  it('maps domain events to the EXISTING client vocabulary, ids only', () => {
    const p = projectToClient(createDomainEvent({ eventType: DOMAIN_EVENTS.APPOINTMENT_CANCELED, tenantId: T, aggregateType: 'appointment', aggregateId: 'a-1', payload: { appointmentId: 'a-1', customerName: 'leak?' } }));
    expect(p).toEqual([{ event: EVENTS.appointmentCancelled, payload: { appointmentId: 'a-1' } }]);   // nothing but the id crosses
    expect(JSON.stringify(p)).not.toMatch(/leak/);
    expect(projectToClient(createDomainEvent({ eventType: DOMAIN_EVENTS.SMS_SENT, tenantId: T, aggregateType: 'sms', aggregateId: 's', payload: {} }))).toEqual([]);   // no client screen cares → no projection
    // Smooth Refresh spec §3/§17: a check-in is a 0–1 s change — it reaches Check-In/Queue/Tech Queue (customer_checked_in)
    // AND the Booking board (appointment_updated). Before Sep 30 2026 a POS check-in emitted nothing.
    const ci = projectToClient(createDomainEvent({ eventType: DOMAIN_EVENTS.CUSTOMER_CHECKED_IN, tenantId: T, aggregateType: 'appointment', aggregateId: 'a-2', payload: { appointmentId: 'a-2', customerId: 'c-9' } }));
    expect(ci.map((c) => c.event).sort()).toEqual(['appointment_updated', 'customer_checked_in']);
    expect(ci.find((c) => c.event === 'customer_checked_in')!.payload).toEqual({ appointmentId: 'a-2', customerId: 'c-9' });
    // §31 fan-out: one checkout.completed refreshes the ticket AND the reports screen — the two pushes checkout.service used to make by hand
    const paid = projectToClient(createDomainEvent({ eventType: DOMAIN_EVENTS.CHECKOUT_COMPLETED, tenantId: T, aggregateType: 'ticket', aggregateId: 'tk-1', payload: { ticketId: 'tk-1', status: 'paid' } }));
    expect(paid.map((x) => x.event)).toEqual([EVENTS.ticketPaid, EVENTS.reportsUpdated]);
  });

  it('a queue assignment in the outbox becomes ONE queue_updated on the realtime bus', async () => {
    await new OutboxWriter().write(db, assigned('q-1'));
    await publisher.tick();
    const mine = emitted.filter((x) => x.payload?.queueItemId === 'q-1');
    expect(mine.length).toBe(1);
    expect(mine[0].event).toBe(EVENTS.queueUpdated);
    expect(mine[0].ctx).toEqual({ tenantId: T, branchId: B });
  });
});

describe('Phase 13 — push notification consumer (§57, §105)', () => {
  it('notifies the technician exactly once, with an idempotency reference tied to the event id', async () => {
    const e = assigned('q-2');
    await new OutboxWriter().write(db, e);
    await publisher.tick();
    const mine = pushed.filter((p) => p.msg.data?.queueItemId === 'q-2');
    expect(mine.length).toBe(1);
    expect(mine[0].userId).toBe('user-42');
    expect(mine[0].msg.reference).toBe(`queue_assignment:${e.eventId}`);
    expect(mine[0].msg.body).not.toMatch(/Olivia|Brown/);                                     // §95
    // §22–23: redelivering the same event does NOT push again
    const again = await runner.run(registry.get('notifications.push')!, e);
    expect(again.status).toBe('duplicate');
    expect(pushed.filter((p) => p.msg.data?.queueItemId === 'q-2').length).toBe(1);
  });

  it('a technician without an app account is not an error — nothing sent, nothing dead-lettered', async () => {
    await new OutboxWriter().write(db, assigned('q-3', 'tech-no-app'));
    await publisher.tick();
    expect(pushed.some((p) => p.msg.data?.queueItemId === 'q-3')).toBe(false);
    const dl = await sql`SELECT 1 FROM event_dead_letters WHERE consumer_name = 'notifications.push'`.execute(db);
    expect(dl.rows.length).toBe(0);
  });

  it('§50: a provider outage is TRANSIENT — retried, not dead-lettered; the projection consumer is unaffected (§30)', async () => {
    pushShouldFail = true;
    const e = assigned('q-4');
    await new OutboxWriter().write(db, e);
    const r = await publisher.tick();
    expect(r.published).toBe(1);                                                              // event published regardless
    expect(emitted.some((x) => x.payload?.queueItemId === 'q-4')).toBe(true);                // realtime still projected
    const dl = await sql`SELECT status, error_class, attempts FROM event_dead_letters WHERE consumer_name = 'notifications.push'`.execute(db);
    expect(dl.rows[0]).toMatchObject({ status: 'retrying', error_class: 'TRANSIENT', attempts: 1 });
    pushShouldFail = false;
    const retry = await runner.run(registry.get('notifications.push')!, e);                  // the retry worker's job
    expect(retry.status).toBe('processed');
    expect(pushed.filter((p) => p.msg.data?.queueItemId === 'q-4').length).toBe(1);
  });
});

// ── multi-technician routing: queue.service_lines_assigned (contract §3) ───────────────────────────────────────────
const linesAssigned = (id: string, lead: string, lines: { technicianId: string }[]) => createDomainEvent({
  eventType: DOMAIN_EVENTS.QUEUE_SERVICE_LINES_ASSIGNED, tenantId: T, branchId: B, aggregateType: 'queue_item', aggregateId: id, actorType: 'user',
  payload: { queueItemId: id, leadTechnicianId: lead, groupId: null, source: 'staff', version: 2,
    lines: lines.map((l, i) => ({ serviceId: 's' + i, technicianId: l.technicianId, previousTechnicianId: null, timing: 'parallel' })) },
});
describe('multi-technician routing — queue.service_lines_assigned', () => {
  it('projects to the EXISTING queue_updated (reason service_lines) — no new realtime name', () => {
    expect(projectToClient(linesAssigned('q-ml-0', 'lead', [{ technicianId: 'lead' }]))).toEqual([{ event: EVENTS.queueUpdated, payload: { queueItemId: 'q-ml-0', reason: 'service_lines' } }]);
  });
  it('pushes each LINE technician who is not the lead, once, keyed per (event, technician), never the guest name', async () => {
    const e = linesAssigned('q-ml-1', 'lead-tech', [{ technicianId: 'lead-tech' }, { technicianId: 'tech-with-app' }, { technicianId: 'tech-with-app' }, { technicianId: 'tech-no-app' }]);
    await new OutboxWriter().write(db, e);
    await publisher.tick();
    const mine = pushed.filter((p) => p.msg.data?.queueItemId === 'q-ml-1');
    expect(mine).toHaveLength(1);                                      // the lead got queue.customer_assigned; no-app tech skipped
    expect(mine[0].userId).toBe('user-42');
    expect(mine[0].msg.reference).toBe(`queue_lines:${e.eventId}:tech-with-app`);
    expect(JSON.stringify(mine[0].msg)).not.toMatch(/Guest|customerName/);
    expect((await runner.run(registry.get('notifications.push')!, e)).status).toBe('duplicate');
    expect(pushed.filter((p) => p.msg.data?.queueItemId === 'q-ml-1')).toHaveLength(1);
  });
  it('a plan where the lead holds every line pushes nobody extra', async () => {
    await new OutboxWriter().write(db, linesAssigned('q-ml-2', 'tech-with-app', [{ technicianId: 'tech-with-app' }]));
    await publisher.tick();
    expect(pushed.filter((p) => p.msg.data?.queueItemId === 'q-ml-2')).toHaveLength(0);
  });
});

// ── tech-profile projections: a rating and a membership approval reach the client through the projection ──────
describe('Phase 14 — tech-profile events project to their existing client names', () => {
  it('review.submitted → technician_rating_submitted, carrying the score but never the review text', () => {
    const p = projectToClient(createDomainEvent({
      eventType: DOMAIN_EVENTS.REVIEW_SUBMITTED, tenantId: T, aggregateType: 'review', aggregateId: 'tk-9',
      payload: { ticketId: 'tk-9', technicianId: 'tech-3', customerId: 'c-1', rating: 5, isPublic: true, hasComment: true },
    }));
    expect(p).toEqual([{ event: EVENTS.techRatingSubmitted, payload: { ticketId: 'tk-9', technicianId: 'tech-3', rating: 5 } }]);
    expect(JSON.stringify(p)).not.toMatch(/comment|reviewText/);
  });

  it('technician.membership_approved → tech_salon_membership_approved with ids only', () => {
    const p = projectToClient(createDomainEvent({
      eventType: DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_APPROVED, tenantId: T, aggregateType: 'tech_salon_membership', aggregateId: 'req-1',
      payload: { requestId: 'req-1', technicianId: 'tech-3', profileId: 'gp-1', status: 'active' },
    }));
    expect(p).toEqual([{ event: EVENTS.techMembershipApproved, payload: { requestId: 'req-1', technicianId: 'tech-3', profileId: 'gp-1' } }]);
  });
});

describe('Phase 14 — the last tech-profile projections', () => {
  it('technician.profile_updated → technician_profile_updated (ids only; changedFields stay server-side)', () => {
    const p = projectToClient(createDomainEvent({
      eventType: DOMAIN_EVENTS.TECHNICIAN_PROFILE_UPDATED, tenantId: T, aggregateType: 'technician', aggregateId: 'tech-7',
      payload: { technicianId: 'tech-7', profileId: 'gp-7', changedFields: ['bio', 'title'], editedBy: 'manager' },
    }));
    expect(p).toEqual([{ event: EVENTS.techProfileUpdated, payload: { technicianId: 'tech-7', profileId: 'gp-7' } }]);
  });
  it('technician.membership_rejected → tech_salon_membership_rejected', () => {
    const p = projectToClient(createDomainEvent({
      eventType: DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_REJECTED, tenantId: T, aggregateType: 'tech_salon_membership', aggregateId: 'req-9',
      payload: { requestId: 'req-9', profileId: 'gp-7', status: 'rejected' },
    }));
    expect(p).toEqual([{ event: EVENTS.techMembershipRejected, payload: { requestId: 'req-9', profileId: 'gp-7' } }]);
  });
});

describe('Phase 14 — ticket-room scope (§113): some client events belong to ONE ticket, not the tenant', () => {
  it('a service-line event projects three ways: line + total to the tenant, line to the ticket room', () => {
    const tenant: any[] = []; const ticket: any[] = [];
    const c = new RealtimeProjectionConsumer({
      toTenant: (_ctx, ev, p) => tenant.push({ ev, p }),
      toTicket: (id, ev, p) => ticket.push({ id, ev, p }),
    });
    const e = createDomainEvent({ eventType: DOMAIN_EVENTS.TICKET_SERVICE_LINE_ADDED, tenantId: T, branchId: 'b-1', aggregateType: 'ticket', aggregateId: 'tk-5', payload: { ticketId: 'tk-5', serviceId: 's-1' } });
    return c.handle(e, null as any).then(() => {
      expect(tenant.map((x) => x.ev)).toEqual([EVENTS.ticketServiceLineAdded, EVENTS.ticketTotalRecalculated]);
      expect(ticket).toEqual([{ id: 'tk-5', ev: EVENTS.ticketServiceLineAdded, p: expect.objectContaining({ ticketId: 'tk-5' }) }]);
    });
  });

  it('a bus without ticket rooms still delivers the tenant projection — the ticket delivery is simply skipped', async () => {
    const tenant: any[] = [];
    const c = new RealtimeProjectionConsumer({ toTenant: (_ctx, ev) => tenant.push(ev) });   // no toTicket
    await c.handle(createDomainEvent({ eventType: DOMAIN_EVENTS.TICKET_SERVICE_LINE_REMOVED, tenantId: T, aggregateType: 'ticket', aggregateId: 'tk-6', payload: { ticketId: 'tk-6' } }), null as any);
    expect(tenant).toEqual([EVENTS.ticketServiceLineRemoved, EVENTS.ticketTotalRecalculated]);
  });
});

describe('Phase 14 — follow-up tasks fan out to the branch board AND the owning technician (§80)', () => {
  const make = () => { const tenant: any[] = []; const tech: any[] = [];
    return { tenant, tech, c: new RealtimeProjectionConsumer({ toTenant: (_x, ev, p) => tenant.push({ ev, p }), toTechnician: (id, ev, p) => tech.push({ id, ev, p }) }) }; };

  it('task_sent reaches the branch room and the task owner, and never carries the message text', async () => {
    const { tenant, tech, c } = make();
    await c.handle(createDomainEvent({ eventType: DOMAIN_EVENTS.FOLLOWUP_TASK_SENT, tenantId: T, branchId: 'b-1', aggregateType: 'followup_task', aggregateId: 'task-1',
      payload: { taskId: 'task-1', technicianId: 'tech-2', status: 'sent', hasNotification: true } }), null as any);
    expect(tenant).toEqual([{ ev: EVENTS.followUpTaskUpdated, p: expect.objectContaining({ taskId: 'task-1' }) }]);
    expect(tech).toEqual([{ id: 'tech-2', ev: EVENTS.followUpTaskUpdated, p: expect.objectContaining({ taskId: 'task-1' }) }]);
    expect(JSON.stringify([tenant, tech])).not.toMatch(/message|sent_message/);
  });

  it('a customer reply refreshes the board and the tech, and reaches THAT CUSTOMER — not the tenant room', async () => {
    const tenant: any[] = []; const tech: any[] = []; const cust: any[] = [];
    const c = new RealtimeProjectionConsumer({ toTenant: (_x, ev) => tenant.push(ev), toTechnician: (id, ev) => tech.push({ id, ev }), toCustomer: (id, ev) => cust.push({ id, ev }) });
    await c.handle(createDomainEvent({ eventType: DOMAIN_EVENTS.FOLLOWUP_CUSTOMER_REPLIED, tenantId: T, aggregateType: 'followup_task', aggregateId: 'task-2', payload: { taskId: 'task-2', technicianId: 'tech-2', customerId: 'cust-9' } }), null as any);
    expect(tenant).toEqual([EVENTS.followUpTaskUpdated]);                       // the board, NOT customerFollowUpReceived
    expect(tech).toEqual([{ id: 'tech-2', ev: EVENTS.followUpTaskUpdated }]);
    expect(cust).toEqual([{ id: 'cust-9', ev: EVENTS.customerFollowUpReceived }]);
  });

  it('a task with no owning technician still refreshes the branch board', async () => {
    const { tenant, tech, c } = make();
    await c.handle(createDomainEvent({ eventType: DOMAIN_EVENTS.FOLLOWUP_TASK_STATUS_CHANGED, tenantId: T, aggregateType: 'followup_task', aggregateId: 'task-3', payload: { taskId: 'task-3', technicianId: null, status: 'expired' } }), null as any);
    expect(tenant.length).toBe(1); expect(tech.length).toBe(0);
  });
});

// ── developer merge (Oct 6 2026): the customer's cancel / check-in pushes and the technician's "customer arrived" ──
describe('push consumer — appointment facts (customer + technician)', () => {
  const TECH = '11111111-1111-4111-8111-0000000000d1', CUST = '11111111-1111-4111-8111-0000000000c1', U = '11111111-1111-4111-8111-0000000000f1';
  const A1 = '11111111-1111-4111-8111-0000000000a1', A2 = '11111111-1111-4111-8111-0000000000a2';
  const apptEvent = (type: any, id: string, tenantId = T) => createDomainEvent({ eventType: type, tenantId, branchId: B, aggregateType: 'appointment', aggregateId: id, actorType: 'user', payload: { appointmentId: id } });
  beforeAll(async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ('22222222-2222-4222-8222-222222222222', 'Other', 'Other', 'other-push', 'OTHP01', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main') on conflict (id) do nothing`.execute(db);
    await sql`insert into users (id, tenant_id, first_name, last_name, full_name, email, status, role) values (${U}, ${T}, 'Sophia', 'Davis', 'Sophia Davis', 'sophia@push.test', 'active', 'CUSTOMER')`.execute(db);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, user_id) values (${CUST}, ${T}, ${B}, 'Sophia', 'Davis', 'Sophia Davis', ${U})`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Lisa', 'One', 'Lisa One')`.execute(db);
    await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, services, status)
      values (${A1}, ${T}, ${B}, ${TECH}, ${CUST}, 'Sophia Davis', '2026-10-20', '14:30', '15:30', '[]', 'booked'), (${A2}, ${T}, ${B}, ${TECH}, null, 'Walk In', '2026-10-21', '09:00', '10:00', '[]', 'booked')`.execute(db);
    // the technician lookup fake knows this roster row
    (registry.get('notifications.push') as any).users = { async technicianUserId(_c: any, technicianId: string) { return technicianId === TECH ? 'tech-user-1' : null; } };
  });
  it('appointment.canceled pushes the customer — once, and never the salon/time on the lock screen — and the booked technician once', async () => {
    const e = apptEvent(DOMAIN_EVENTS.APPOINTMENT_CANCELED, A1);
    await new OutboxWriter().write(db, e); await publisher.tick();
    const all = pushed.filter((p) => p.msg.data?.appointmentId === A1 && p.msg.data?.kind === 'appointment_cancelled');
    // Oct 23 2026 merge (developer tree): the technician whose appointment it was hears too (her own day changed), on its
    // own reference so neither push dedupes the other
    const mine = all.filter((p) => p.userId === U), tech = all.filter((p) => p.userId === 'tech-user-1');
    expect(all).toHaveLength(2);
    expect(mine).toHaveLength(1);                                          // the customer: exactly once
    expect(tech).toHaveLength(1);                                          // and the appointment's technician, once
    expect(tech[0].msg.reference).toMatch(/^tech_cancelled:/);
    for (const p of all) expect(p.msg.body).not.toMatch(/Sophia|2:30|Oct/);
    expect(mine[0]).toMatchObject({ userId: U, msg: { title: 'Appointment cancelled', category: 'BOOKING_CHANGE', reference: `appointment_cancelled:${e.eventId}` } });
    expect(mine[0].msg.body).not.toMatch(/Sophia|2:30|Oct/);
    expect((await runner.run(registry.get('notifications.push')!, e)).status).toBe('duplicate');
  });
  it('checkin.customer_checked_in pushes the customer AND the appointment’s technician', async () => {
    await new OutboxWriter().write(db, apptEvent(DOMAIN_EVENTS.CUSTOMER_CHECKED_IN, A1)); await publisher.tick();
    const mine = pushed.filter((p) => p.msg.data?.appointmentId === A1 && p.msg.data?.kind !== 'appointment_cancelled');
    expect(mine.map((p) => [p.userId, p.msg.title, p.msg.category])).toEqual([[U, 'Checked in successfully', 'CHECK_IN_READY'], ['tech-user-1', 'Customer arrived', 'NEW_CUSTOMER']]);
  });
  it('a walk-in without an account: only the technician hears', async () => {
    await new OutboxWriter().write(db, apptEvent(DOMAIN_EVENTS.CUSTOMER_CHECKED_IN, A2)); await publisher.tick();
    expect(pushed.filter((p) => p.msg.data?.appointmentId === A2).map((p) => p.userId)).toEqual(['tech-user-1']);
  });
  it('another tenant’s event for the appointment pushes nobody (SECURITY)', async () => {
    const n = pushed.length;
    await new OutboxWriter().write(db, apptEvent(DOMAIN_EVENTS.APPOINTMENT_CANCELED, A1, '22222222-2222-4222-8222-222222222222')); await publisher.tick();
    expect(pushed.length).toBe(n);
  });
});
