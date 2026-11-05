// deals-release.pgtest — BUILD_PLAN Phase 5, bug 12 on the real schema, through the real outbox → consumer runner:
// appointment.canceled / appointment.no_show give a deal's place back (a capped deal becomes bookable again), a deal
// already used on a ticket keeps its place, a replay changes nothing, and another salon's appointment id releases nothing.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { DealsReleaseConsumer } from './deals-release.consumer';
import { KyselyCustomerRepository } from '../../customer/customer.kysely.repository';

const T = 'd1200000-0000-4000-8000-000000000001', T2 = 'd1200000-0000-4000-8000-000000000002', B = 'd1200000-0000-4000-8000-0000000000b1';
const DEAL = 'd1200000-0000-4000-8000-0000000000d1', CUST = 'd1200000-0000-4000-8000-0000000000c1';
const A1 = 'd1200000-0000-4000-8000-0000000000a1', A2 = 'd1200000-0000-4000-8000-0000000000a2', A3 = 'd1200000-0000-4000-8000-0000000000a3';
let db: any; let publisher: OutboxPublisher;
const outbox = new OutboxWriter();
const emit = async (type: any, appointmentId: string, tenantId = T) => {
  await outbox.write(db, createDomainEvent({ eventType: type, tenantId, branchId: B, aggregateType: 'appointment', aggregateId: appointmentId, actorType: 'user', payload: { appointmentId } }));
  await publisher.tick();
};
const holdStatus = async (appt: string) => ((await sql`select status from deal_redemption_holds where appointment_id = ${appt}`.execute(db)).rows[0] as any)?.status;

beforeAll(async () => {
  const pg = await migratedPglite();
  db = kyselyFor(pg);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'R', 'R', 'rel', 'REL01', 'active'), (${T2}, 'O', 'O', 'oth', 'OTH01', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`.execute(db);
  await sql`insert into deals (id, tenant_id, owner_type, title, discount_type, discount_percent, status, max_redemptions) values (${DEAL}, ${T}, 'salon', 'Capped', 'percent', 20, 'active', 3)`.execute(db);
  for (const a of [A1, A2, A3]) await sql`insert into deal_redemption_holds (deal_id, tenant_id, customer_id, idempotency_key, status, expires_at, appointment_id) values (${DEAL}, ${T}, ${CUST}, ${'k-' + a}, 'consumed', now(), ${a})`.execute(db);
  // A3's deal is already on a ticket (applied) — its place stays
  const h3 = ((await sql`select id from deal_redemption_holds where appointment_id = ${A3}`.execute(db)).rows[0] as any).id;
  await sql`insert into deal_redemptions (deal_id, tenant_id, customer_id, appointment_id, ticket_id, amount_discounted_cents, deal_version, status, hold_id) values (${DEAL}, ${T}, ${CUST}, ${A3}, ${'d1200000-0000-4000-8000-0000000000e3'}, 500, 1, 'applied', ${h3})`.execute(db);
  const registry = new ConsumerRegistry(); registry.register(new DealsReleaseConsumer());
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db, { rand: () => 0 })));
}, 60_000);

describe('deals.release_on_cancel', () => {
  it('appointment.canceled releases the place and records deal.reservation_released', async () => {
    await emit(DOMAIN_EVENTS.APPOINTMENT_CANCELED, A1);
    expect(await holdStatus(A1)).toBe('released');
    const ev = (await sql`select count(*)::int as n from outbox_events where event_type = 'deal.reservation_released' and tenant_id = ${T}`.execute(db)).rows[0] as any;
    expect(ev.n).toBe(1);
  });
  it('appointment.no_show releases too', async () => {
    await emit(DOMAIN_EVENTS.APPOINTMENT_NO_SHOW, A2);
    expect(await holdStatus(A2)).toBe('released');
  });
  it('a deal already on a ticket keeps its place', async () => {
    await emit(DOMAIN_EVENTS.APPOINTMENT_CANCELED, A3);
    expect(await holdStatus(A3)).toBe('consumed');
  });
  it('another salon’s event for the same appointment id releases nothing', async () => {
    await sql`update deal_redemption_holds set status = 'consumed' where appointment_id = ${A1}`.execute(db);
    await emit(DOMAIN_EVENTS.APPOINTMENT_CANCELED, A1, T2);
    expect(await holdStatus(A1)).toBe('consumed');
  });
});

describe('the customer app\'s cancel reaches it (it emitted no event before Phase 5)', () => {
  it('a customer cancelling in the app gives the deal\'s place back at once', async () => {
    const A4 = 'd1200000-0000-4000-8000-0000000000a4', C4 = 'd1200000-0000-4000-8000-0000000000c4', TECH = 'd1200000-0000-4000-8000-0000000000f4';
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C4}, ${T}, ${B}, 'Can', 'Cel', 'Can Cel')`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'T', 'Four', 'T Four')`.execute(db);
    await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, services, status)
              values (${A4}, ${T}, ${B}, ${TECH}, ${C4}, 'Can Cel', '2030-01-07', '10:00', '10:45', '[]'::jsonb, 'booked')`.execute(db);
    await sql`insert into deal_redemption_holds (deal_id, tenant_id, customer_id, idempotency_key, status, expires_at, appointment_id) values (${DEAL}, ${T}, ${C4}, 'k-a4', 'consumed', now(), ${A4})`.execute(db);
    const repo = new KyselyCustomerRepository(db, outbox);
    expect(await repo.cancelAppointment({ tenantId: T, branchId: B, userId: 'u-c4' } as any, C4, A4)).toBe(true);
    const ev = (await sql`select count(*)::int as n from outbox_events where event_type = 'appointment.canceled' and aggregate_id::text = ${A4}`.execute(db)).rows[0] as any;
    expect(ev.n).toBe(1);
    await publisher.tick();
    expect(await holdStatus(A4)).toBe('released');
    expect(await repo.cancelAppointment({ tenantId: T, branchId: B, userId: 'u-c4' } as any, C4, A4)).toBe(false);   // already cancelled: no second event
    expect(((await sql`select count(*)::int as n from outbox_events where event_type = 'appointment.canceled' and aggregate_id::text = ${A4}`.execute(db)).rows[0] as any).n).toBe(1);
  });
});
