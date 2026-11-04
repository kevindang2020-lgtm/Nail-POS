// producers.pgtest — Constitution 8 Phase 12: the first two core-domain producers, proven against real Postgres.
// Appointment creation (booking) and payment recording (checkout) now write their domain events INSIDE the
// business transaction. Each test proves the §18 rule both ways: the event lands with the row, and a failed
// business write takes the event down with it.
import { KyselyServingRepository, KyselyServiceDoneRepository, KyselyQueueRepository } from '@aipowersalon/queue';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { KyselyBookingRepository } from '@aipowersalon/booking';

const T = '11111111-1111-1111-1111-111111111111';
const B = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TECH = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
let db: any; let booking: KyselyBookingRepository;
const USER = 'ffffffff-ffff-ffff-ffff-ffffffffffff';   // payments.created_by_user_id is UUID-typed (surfaced by this test)
const ctx: any = { tenantId: T, branchId: B, userId: USER, role: 'OWNER', permissions: [] };
const item = (over: Record<string, any> = {}) => ({
  technicianId: TECH, customerId: null, customerName: 'Olivia Brown', customerPhone: null, isVip: false, source: 'manual',
  services: [{ serviceId: 's-1', serviceName: 'Gel Manicure', durationMinutes: 45, priceCents: 4500 }],
  date: '2026-09-19', startTime: '10:00', endTime: '10:45', status: 'booked', depositStatus: 'not_required', notes: '', ...over,
});

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                 VALUES ('${T}','Glamour Studio LLC','Glamour Studio','glamour','GLAM01','active') ON CONFLICT (id) DO NOTHING;
                 INSERT INTO branches (id, tenant_id, name) VALUES ('${B}','${T}','Downtown') ON CONFLICT (id) DO NOTHING;
                 -- pos_tech_appointments.technician_id is NOT NULL in the real schema (surfaced by this test)
                 INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name) VALUES ('${TECH}','${T}','${B}','Mia','Nguyen','Mia Nguyen') ON CONFLICT (id) DO NOTHING;`);
  db = kyselyFor(pg);
  booking = new KyselyBookingRepository(db, new OutboxWriter());
}, 60_000);

describe('Phase 12 — appointment.created is written with the appointment', () => {
  it('creating an appointment writes exactly one appointment.created in the outbox, tenant-scoped, ids only', async () => {
    const row: any = await booking.create(ctx, item() as any);
    const out = await sql`SELECT event_type, tenant_id, branch_id, aggregate_id, actor_id, payload_json, publish_status FROM outbox_events WHERE aggregate_id = ${row.appointmentId ?? row.id}`.execute(db);
    expect(out.rows.length).toBe(1);
    const e: any = out.rows[0];
    expect(e.event_type).toBe('appointment.created');
    expect(e.tenant_id).toBe(T);
    expect(e.branch_id).toBe(B);
    expect(e.actor_id).toBe(USER);
    expect(e.publish_status).toBe('pending');
    const p = typeof e.payload_json === 'string' ? JSON.parse(e.payload_json) : e.payload_json;
    expect(p).toMatchObject({ technicianId: TECH, date: '2026-09-19', startTime: '10:00', endTime: '10:45', source: 'manual', status: 'booked', serviceCount: 1 });
    expect(p.customerName).toBeUndefined();     // §95 PII minimisation
    expect(p.customerPhone).toBeUndefined();
  });

  it('editing an appointment records appointment.updated with WHICH fields changed, never their values; an empty edit records nothing', async () => {
    const row: any = await booking.create(ctx, item({ startTime: '06:15', endTime: '07:00' }) as any);   // a slot no other case in this file books
    const id = row.appointmentId ?? row.id;
    expect(await booking.update(ctx, id, { customerName: 'Renamed Person', notes: 'gel only', isVip: true } as any)).toBe(true);
    expect(await booking.update(ctx, id, {} as any)).toBe(true);
    const out = (await sql`SELECT payload_json FROM outbox_events WHERE event_type = 'appointment.updated' AND aggregate_id = ${id}`.execute(db)).rows as any[];
    expect(out.length).toBe(1);
    const p = typeof out[0].payload_json === 'string' ? JSON.parse(out[0].payload_json) : out[0].payload_json;
    expect([...p.changedFields].sort()).toEqual(['customerName', 'isVip', 'notes'].sort());
    expect(JSON.stringify(p)).not.toMatch(/Renamed Person|gel only/);
  });

  it('§18 both ways: a create that fails inside the transaction leaves NO event behind', async () => {
    // Force the INSERT to fail with a real constraint (customer_name NOT NULL) — the event must not survive it.
    const before = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'appointment.created'`.execute(db)).rows[0] as any;
    await expect(booking.create(ctx, item({ customerName: null }) as any)).rejects.toBeTruthy();
    const after = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'appointment.created'`.execute(db)).rows[0] as any;
    expect(after.n).toBe(before.n);
  });

  it('a repository constructed WITHOUT an outbox still works and writes no event (never a fake one)', async () => {
    const plain = new KyselyBookingRepository(db);
    const row: any = await plain.create(ctx, item({ startTime: '13:00', endTime: '13:45' }) as any);
    const out = await sql`SELECT 1 FROM outbox_events WHERE aggregate_id = ${row.appointmentId ?? row.id}`.execute(db);
    expect(out.rows.length).toBe(0);
  });
});

// ── checkout: payment.captured per recorded segment, in the payment transaction ──────────────────────────────
import { KyselyCheckoutRepository } from '@aipowersalon/checkout';

describe('Phase 12 — payment.captured is written with the payment (§69, §102)', () => {
  const CUST = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const TICKET = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  let checkout: KyselyCheckoutRepository;

  beforeAll(async () => {
    await sql`INSERT INTO customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status)
              VALUES (${CUST}, ${T}, ${B}, 'Olivia', 'Brown', 'Olivia Brown', '+16095550123', 'active') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id) VALUES (${TICKET}, ${T}, ${B}, ${CUST}) ON CONFLICT (id) DO NOTHING`.execute(db);
    checkout = new KyselyCheckoutRepository(db, new OutboxWriter());
  });

  it('recording a cash + card split writes one payment.captured per segment, correlated by ticket, integer cents, no card data', async () => {
    const recs: any[] = await checkout.recordSplitAtomic(ctx, TICKET, [{ method: 'cash', amountCents: 2000 }, { method: 'card', amountCents: 2500 }] as any, { cardRetref: 'RETREF-1', cardSurchargeCents: 0 } as any);
    expect(recs.length).toBe(2);
    const out = await sql`SELECT aggregate_id, correlation_id, payload_json FROM outbox_events WHERE event_type = 'payment.captured' AND correlation_id = ${'ticket:' + TICKET} ORDER BY occurred_at`.execute(db);
    expect(out.rows.length).toBe(2);
    const payloads = (out.rows as any[]).map((r) => (typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : r.payload_json));
    expect(payloads.map((p) => p.method).sort()).toEqual(['card', 'cash']);
    expect(payloads.map((p) => p.amountCents).sort((a, b) => a - b)).toEqual([2000, 2500]);   // integer cents (§102)
    expect((out.rows as any[]).every((r) => r.correlation_id === `ticket:${TICKET}`)).toBe(true);   // §11 one flow
    expect(JSON.stringify(payloads)).not.toMatch(/pan|cvv|cardNumber/i);                          // §225
    expect(new Set((out.rows as any[]).map((r) => r.aggregate_id)).size).toBe(2);                 // one event per payment id
  });
});

// ── customers, queue, appointment status — the rest of Phase 12's core domains ────────────────────────────────
import { KyselyCustomersRepository } from '@aipowersalon/customers';

describe('Phase 12 — customer.created is written with the customer (§78, §95)', () => {
  it('creating a customer writes customer.created with FACTS only — no name, phone, email or birthday', async () => {
    const customers = new KyselyCustomersRepository(db, new OutboxWriter());
    const row: any = await customers.create(ctx, { firstName: 'Priya', lastName: 'Sharma', phone: '+16095550999', email: 'priya@example.com', birthday: '1990-04-02', smsOptIn: true, emailOptIn: false } as any);
    const out = await sql`SELECT tenant_id, payload_json FROM outbox_events WHERE event_type = 'customer.created' AND aggregate_id = ${row.id ?? row.customerId}`.execute(db);
    expect(out.rows.length).toBe(1);
    const p = typeof (out.rows[0] as any).payload_json === 'string' ? JSON.parse((out.rows[0] as any).payload_json) : (out.rows[0] as any).payload_json;
    expect(p).toMatchObject({ source: 'pos', smsOptIn: true, emailOptIn: false, hasPhone: true, hasEmail: true });
    for (const k of ['firstName', 'lastName', 'phone', 'email', 'birthday', 'fullName', 'normalizedPhone']) expect(p[k]).toBeUndefined();
    expect(JSON.stringify(p)).not.toMatch(/Priya|Sharma|0999|priya@/);
  });
});

describe('Phase 12 — queue.customer_assigned is written with the assignment (§63)', () => {
  it('assigning a waiting guest writes queue.customer_assigned with previous/new status', async () => {
    const queue = new KyselyQueueRepository(db, new OutboxWriter());
    const QI = '99999999-9999-9999-9999-999999999999';
    await sql`INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_name, status, requested_services)
              VALUES (${QI}, ${T}, ${B}, 'Walk In Guest', 'waiting', '[]'::jsonb)`.execute(db);
    const ok = await queue.assign(ctx, QI, TECH);
    expect(ok).toBe(true);
    const out = await sql`SELECT payload_json FROM outbox_events WHERE event_type = 'queue.customer_assigned' AND aggregate_id = ${QI}`.execute(db);
    expect(out.rows.length).toBe(1);
    const p = typeof (out.rows[0] as any).payload_json === 'string' ? JSON.parse((out.rows[0] as any).payload_json) : (out.rows[0] as any).payload_json;
    expect(p).toMatchObject({ queueItemId: QI, technicianId: TECH, previousStatus: 'waiting', status: 'assigned' });
    const st = await sql`SELECT status, assigned_technician_id FROM pos_queue_items WHERE id = ${QI}`.execute(db);
    expect(st.rows[0]).toMatchObject({ status: 'assigned', assigned_technician_id: TECH });   // the row moved too
  });

  it('moving the assigned guest to the tech queue records technician.assigned ONCE (ids only); a repeated move records nothing; the technician is told', async () => {
    const queue = new KyselyQueueRepository(db, new OutboxWriter());
    const QI = '99999999-9999-9999-9999-999999999999';
    const first = await queue.projectToTechQueue(ctx, QI);
    const again = await queue.projectToTechQueue(ctx, QI);
    expect(first.created).toBe(true);
    expect(again).toMatchObject({ created: false, techQueueTicketId: first.techQueueTicketId });
    const out = (await sql`SELECT aggregate_id, payload_json FROM outbox_events WHERE event_type = 'technician.assigned'`.execute(db)).rows as any[];
    expect(out.map((r) => r.aggregate_id)).toEqual([first.techQueueTicketId]);
    const p = typeof out[0].payload_json === 'string' ? JSON.parse(out[0].payload_json) : out[0].payload_json;
    expect(p).toMatchObject({ techQueueTicketId: first.techQueueTicketId, queueItemId: QI, technicianId: TECH });
    expect(JSON.stringify(p)).not.toMatch(/Walk In Guest/);                      // no customer name in the event
    const sent: any[] = [];
    await new RealtimeProjectionConsumer({ toTenant: () => {}, toTechnician: (id: string, ev: any) => sent.push([id, ev]) } as any)
      .handle({ eventType: 'technician.assigned', tenantId: T, branchId: B, aggregateId: out[0].aggregate_id, payload: p } as any);
    expect(sent).toEqual([[TECH, 'queue_updated']]);
  });

  it('assigning to a technician that does not exist writes nothing — no event without the fact', async () => {
    const queue = new KyselyQueueRepository(db, new OutboxWriter());
    const before = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'queue.customer_assigned'`.execute(db)).rows[0] as any;
    expect(await queue.assign(ctx, '99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000')).toBe(false);
    const after = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'queue.customer_assigned'`.execute(db)).rows[0] as any;
    expect(after.n).toBe(before.n);
  });
});

describe('Phase 12 — appointment status changes emit the matching past-tense event (§60)', () => {
  it('checked_in → checkin.customer_checked_in; completed → appointment.completed; cancelled → appointment.canceled; booked → no event', async () => {
    const created: any = await booking.create(ctx, item({ startTime: '15:00', endTime: '15:45' }) as any);
    const id = created.appointmentId ?? created.id;
    expect(await booking.setStatus(ctx, id, 'checked_in' as any)).toBe(true);   // Smooth Refresh spec §3: POS check-in must emit (it did not before Sep 30 2026)
    expect(await booking.setStatus(ctx, id, 'completed' as any)).toBe(true);
    // Phase 12 (#27): a COMPLETED visit can no longer be cancelled (the cascade used to cancel its paid ticket too) — the
    // APPOINTMENT machine refuses it; cancel → re-book is exercised on a second appointment
    await expect(booking.setStatus(ctx, id, 'cancelled' as any)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    const out = await sql`SELECT event_type, payload_json FROM outbox_events WHERE aggregate_id = ${id} AND event_type <> 'appointment.created' ORDER BY occurred_at`.execute(db);
    expect((out.rows as any[]).map((r) => r.event_type)).toEqual(['checkin.customer_checked_in', 'appointment.completed']);
    const second: any = await booking.create(ctx, item({ startTime: '16:00', endTime: '16:45' }) as any);
    const id2 = second.appointmentId ?? second.id;
    expect(await booking.setStatus(ctx, id2, 'cancelled' as any)).toBe(true);
    expect(await booking.setStatus(ctx, id2, 'booked' as any)).toBe(true);
    const out2 = await sql`SELECT event_type FROM outbox_events WHERE aggregate_id = ${id2} AND event_type <> 'appointment.created' ORDER BY occurred_at`.execute(db);
    expect((out2.rows as any[]).map((r) => r.event_type)).toEqual(['appointment.canceled']);
    const p0 = typeof (out.rows[0] as any).payload_json === 'string' ? JSON.parse((out.rows[0] as any).payload_json) : (out.rows[0] as any).payload_json;
    expect(p0).toMatchObject({ appointmentId: id, previousStatus: 'booked', status: 'checked_in' });
  });
});

// ── serving: service.started on start(), service.completed on setStatus(completed) — and the projection replaces the push ──
import { ConsumerRegistry, InProcessTransport } from './event-transport';
import { OutboxPublisher } from './outbox-publisher';
import { ConsumerRunner } from './consumer-runner';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

describe('Phase 12 — serving: service.started / service.completed inside the ticket transaction (§67)', () => {
  const TK = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee77';
  let serving: KyselyServingRepository;
  beforeAll(async () => {
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES (${TK}, ${T}, ${B}, ${'dddddddd-dddd-dddd-dddd-dddddddddddd'}, 'accepted') ON CONFLICT (id) DO NOTHING`.execute(db);
    serving = new KyselyServingRepository(db, new OutboxWriter());
  });

  it('start() commits the status change and service.started together; pause/resume record service.paused / service.resumed (the §33 marker made them durable)', async () => {
    expect(await serving.start(ctx, TK)).toBe(true);
    const out = (await sql`SELECT event_type FROM outbox_events WHERE aggregate_id = ${TK} ORDER BY occurred_at`.execute(db)).rows.map((r: any) => r.event_type);
    expect(out).toEqual(['service.started']);
    expect((await sql`SELECT status FROM tickets WHERE id = ${TK}`.execute(db)).rows[0]).toMatchObject({ status: 'serving' });
    // When this test was written pause/resume only touched an in-memory overlay (no fact, so no event — §3). §33 Phase A
    // since persists tickets.serving_paused_at, so a pause IS a durable fact now, recorded with the marker; a second pause
    // (marker already set) records nothing.
    await serving.pause(ctx, TK); await serving.pause(ctx, TK);
    // a SECOND node (fresh in-memory overlay) pausing the same ticket: only the durable marker's guard keeps this from
    // recording a second pause
    await new KyselyServingRepository(db, new OutboxWriter()).pause(ctx, TK);
    await serving.resume(ctx, TK);
    const types = (await sql`SELECT event_type, payload_json FROM outbox_events WHERE aggregate_id = ${TK} ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(types.map((r) => r.event_type)).toEqual(['service.started', 'service.paused', 'service.resumed']);
    expect(types[1].payload_json).toMatchObject({ ticketId: TK, source: 'pos' });
  });

  it('setStatus(completed) writes service.completed, and the PROJECTION turns it into the client\'s service_done (the retired push)', async () => {
    const emitted: any[] = [];
    const registry = new ConsumerRegistry();
    registry.register(new RealtimeProjectionConsumer({ toTenant: (c, ev, p) => emitted.push({ c, ev, p }) }));
    const publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db, { rand: () => 0 })));
    while ((await publisher.tick()).claimed > 0) { /* drain earlier events */ }
    emitted.length = 0;
    expect(await serving.setStatus(ctx, TK, 'completed' as any)).toBe(true);
    await publisher.tick();
    expect(emitted.filter((x) => x.p?.ticketId === TK).map((x) => x.ev)).toEqual(['service_done']);   // realtime-core's name, unchanged
    expect(emitted[0].c).toEqual({ tenantId: T, branchId: B });
    // the projection only delivers when the publisher is ON (projectionDeliversRealtime); an outbox alone is not enough
    { const was = process.env.EVENT_PUBLISHER_ENABLED; delete process.env.EVENT_PUBLISHER_ENABLED;
      expect(serving.emitsDomainEvents()).toBe(false);   // publisher off → the service pushes directly, no screen waits
      process.env.EVENT_PUBLISHER_ENABLED = '1'; expect(serving.emitsDomainEvents()).toBe(true);
      if (was === undefined) delete process.env.EVENT_PUBLISHER_ENABLED; else process.env.EVENT_PUBLISHER_ENABLED = was; }
    expect(new KyselyServingRepository(db).emitsDomainEvents()).toBe(false);   // no outbox → the service keeps its legacy inline push
  });
});

// ── checkout single-payment path (payCash / payCard go through recordPayment directly, NOT the split path) ────
describe('Phase 12 — checkout: recordPayment and setStatus(paid) are producers on the single-payment path', () => {
  const TK2 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee88';
  let checkout2: KyselyCheckoutRepository;
  beforeAll(async () => {
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES (${TK2}, ${T}, ${B}, ${'dddddddd-dddd-dddd-dddd-dddddddddddd'}, 'serving') ON CONFLICT (id) DO NOTHING`.execute(db);
    checkout2 = new KyselyCheckoutRepository(db, new OutboxWriter());
  });

  it('a standalone cash recordPayment emits exactly ONE payment.captured, in its own transaction', async () => {
    const rec: any = { paymentId: '', ticketId: TK2, method: 'cash', amountCents: 3000, tipCents: 500, surchargeCents: 0, status: 'approved', changeDueCents: 0, createdAt: new Date().toISOString() };
    const saved: any = await checkout2.recordPayment(ctx, rec);
    expect(saved.paymentId).toMatch(/^[0-9a-f-]{36}$/);
    const out = (await sql`SELECT event_type, correlation_id, payload_json FROM outbox_events WHERE aggregate_id = ${saved.paymentId}`.execute(db)).rows as any[];
    expect(out.length).toBe(1);
    expect(out[0].event_type).toBe('payment.captured');
    expect(out[0].correlation_id).toBe(`ticket:${TK2}`);
    const p = typeof out[0].payload_json === 'string' ? JSON.parse(out[0].payload_json) : out[0].payload_json;
    expect(p).toMatchObject({ method: 'cash', amountCents: 3000, tipCents: 500, status: 'approved' });
  });

  it('§23 an idempotent RETRY of a card charge returns the existing row and emits NOTHING new', async () => {
    const key = 'idem-' + Date.now();
    const rec: any = { paymentId: '', ticketId: TK2, method: 'card', amountCents: 1200, tipCents: 0, surchargeCents: 0, status: 'approved', changeDueCents: 0, idempotencyKey: key, createdAt: new Date().toISOString() };
    const a: any = await checkout2.recordPayment(ctx, rec);
    const b: any = await checkout2.recordPayment(ctx, rec);        // retry with the same key
    expect(b.paymentId).toBe(a.paymentId);
    const n: any = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ${a.paymentId}`.execute(db)).rows[0];
    expect(n.n).toBe(1);                                            // one fact, one event
  });

  it('a declined record emits payment.failed, never payment.captured', async () => {
    const rec: any = { paymentId: '', ticketId: TK2, method: 'card', amountCents: 999, tipCents: 0, surchargeCents: 0, status: 'declined', changeDueCents: 0, createdAt: new Date().toISOString() };
    const d: any = await checkout2.recordPayment(ctx, rec);
    expect((await sql`SELECT event_type FROM outbox_events WHERE aggregate_id = ${d.paymentId}`.execute(db)).rows.map((r: any) => r.event_type)).toEqual(['payment.failed']);
  });

  it('setStatus(paid) emits checkout.completed, which the projection fans out to ticket_paid + reports_updated (the retired pushes)', async () => {
    const emitted: any[] = [];
    const registry = new ConsumerRegistry();
    registry.register(new RealtimeProjectionConsumer({ toTenant: (c, ev, p) => emitted.push({ c, ev, p }) }));
    const publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db, { rand: () => 0 })));
    while ((await publisher.tick()).claimed > 0) { /* drain */ }
    emitted.length = 0;
    expect(await checkout2.setStatus(ctx, TK2, 'paid' as any)).toBe(true);
    await publisher.tick();
    expect(emitted.map((x) => x.ev)).toEqual(['ticket_paid', 'reports_updated']);
    expect((await sql`SELECT status FROM tickets WHERE id = ${TK2}`.execute(db)).rows[0]).toMatchObject({ status: 'paid' });
  });
});

// ── queue lifecycle: joined / called / removed, all inside their transactions (§63) ──────────────────────────
describe('Phase 12 — queue lifecycle producers', () => {
  it('create() → queue.customer_joined with ids and queue facts only; setStatus(in_service) → called; setStatus(cancelled) → removed', async () => {
    const queue = new KyselyQueueRepository(db, new OutboxWriter());
    const row: any = await queue.create(ctx, { queueItemId: '', customerId: null, customerName: 'Walk In Guest', customerPhone: '+16095551234', isVip: false, source: 'walk_in', appointmentId: null, ticketId: null,
      services: [{ serviceId: 's-1', serviceName: 'Gel', durationMinutes: 30, priceCents: 3000 }], priority: 'normal', status: 'waiting', assignedTechId: null, assignedTechName: null, checkedInAtMs: Date.now(), calledAtMs: null, startedAtMs: null, notes: '', customerNotifiedAt: null, createdAtMs: Date.now(), updatedAt: new Date().toISOString() } as any);
    const id = row.queueItemId;
    expect(await queue.setStatus(ctx, id, 'in_service' as any)).toBe(true);
    expect(await queue.setStatus(ctx, id, 'cancelled' as any)).toBe(true);
    const out = (await sql`SELECT event_type, payload_json FROM outbox_events WHERE aggregate_id = ${id} ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(out.map((r) => r.event_type)).toEqual(['queue.customer_joined', 'queue.customer_called', 'queue.customer_removed']);
    const joined = typeof out[0].payload_json === 'string' ? JSON.parse(out[0].payload_json) : out[0].payload_json;
    expect(joined).toMatchObject({ queueItemId: id, source: 'walk_in', priority: 'normal', status: 'waiting', serviceCount: 1 });
    expect(JSON.stringify(joined)).not.toMatch(/Walk In Guest|1234/);          // §95
    const removed = typeof out[2].payload_json === 'string' ? JSON.parse(out[2].payload_json) : out[2].payload_json;
    expect(removed).toMatchObject({ status: 'cancelled', reason: 'cancelled' });
  });

  it('setStatus(waiting) — a status with no past-tense fact — updates the row and emits nothing', async () => {
    const queue = new KyselyQueueRepository(db, new OutboxWriter());
    const QI = '99999999-9999-9999-9999-999999999999';                            // seeded earlier in this file
    const before: any = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ${QI}`.execute(db)).rows[0];
    expect(await queue.setStatus(ctx, QI, 'waiting' as any)).toBe(true);
    const after: any = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ${QI}`.execute(db)).rows[0];
    expect(after.n).toBe(before.n);
  });
});

// ── serving change requests: a technician asks, a manager decides — three facts, three events (§67) ──────────
describe('Phase 12 — ticket change requests', () => {
  it('insertChangeRequest emits created (ids + type, never the value snapshots); a rejection emits rejected', async () => {
    const serving2 = new KyselyServingRepository(db, new OutboxWriter());
    const TK3 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee99';
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES (${TK3}, ${T}, ${B}, ${'dddddddd-dddd-dddd-dddd-dddddddddddd'}, 'serving') ON CONFLICT (id) DO NOTHING`.execute(db);
    const reqId = await serving2.insertChangeRequest(ctx, { ticketId: TK3, lineId: null, requestType: 'change_service',
      oldValue: { serviceName: 'Gel Manicure', priceCents: 4500 }, newValue: { serviceName: 'Deluxe Pedicure', priceCents: 7500 }, reason: 'customer asked', requestedByTechnicianId: TECH } as any);
    const created = (await sql`SELECT event_type, correlation_id, payload_json FROM outbox_events WHERE aggregate_id = ${reqId}`.execute(db)).rows as any[];
    expect(created.length).toBe(1);
    expect(created[0].event_type).toBe('ticket.change_request_created');
    expect(created[0].correlation_id).toBe(`ticket:${TK3}`);
    const p = typeof created[0].payload_json === 'string' ? JSON.parse(created[0].payload_json) : created[0].payload_json;
    expect(p).toMatchObject({ requestId: reqId, ticketId: TK3, requestType: 'change_service', requestedByTechnicianId: TECH, hasReason: true });
    expect(JSON.stringify(p)).not.toMatch(/Gel Manicure|Deluxe Pedicure|7500|customer asked/);   // §95: snapshots stay in the row

    await serving2.updateChangeRequest(ctx, reqId, { status: 'rejected', rejectedByUserId: USER, rejectedAt: new Date().toISOString() });
    const all = (await sql`SELECT event_type FROM outbox_events WHERE aggregate_id = ${reqId} ORDER BY occurred_at`.execute(db)).rows.map((r: any) => r.event_type);
    expect(all).toEqual(['ticket.change_request_created', 'ticket.change_request_rejected']);
  });

  it('a patch that changes no status (timestamps only) emits nothing', async () => {
    const serving2 = new KyselyServingRepository(db, new OutboxWriter());
    const reqId = await serving2.insertChangeRequest(ctx, { ticketId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee99', lineId: null, requestType: 'change_service', oldValue: null, newValue: null, requestedByTechnicianId: TECH } as any);
    await serving2.updateChangeRequest(ctx, reqId, { approvedAt: new Date().toISOString() });
    const all = (await sql`SELECT event_type FROM outbox_events WHERE aggregate_id = ${reqId}`.execute(db)).rows.map((r: any) => r.event_type);
    expect(all).toEqual(['ticket.change_request_created']);
  });
});

describe('Phase 12 — customer.updated names the changed FIELDS, never their values (§78/§95)', () => {
  it('editing a name emits customer.updated with changedFields; an edit that changes no row emits nothing', async () => {
    const customers2 = new KyselyCustomersRepository(db, new OutboxWriter());
    const row: any = await customers2.create(ctx, { firstName: 'Nina', lastName: 'Patel', phone: '+16095550777' } as any);
    const id = row.id ?? row.customerId;
    await customers2.update(ctx, id, { firstName: 'Nina-Marie' } as any);
    const out = (await sql`SELECT event_type, payload_json FROM outbox_events WHERE aggregate_id = ${id} ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(out.map((r) => r.event_type)).toEqual(['customer.created', 'customer.updated']);
    const p = typeof out[1].payload_json === 'string' ? JSON.parse(out[1].payload_json) : out[1].payload_json;
    expect(p.changedFields).toEqual(expect.arrayContaining(['first_name', 'full_name']));
    // the id is a random UUID and can contain '0777' by chance (it did, Oct 1) — check everything except the id
    const { customerId: _id, ...rest } = p;
    expect(_id).toBe(id);
    expect(JSON.stringify(rest)).not.toMatch(/Nina-Marie|Patel|0777/);
    await customers2.update(ctx, '00000000-0000-0000-0000-0000000000ff', { firstName: 'Ghost' } as any);   // no such customer
    const after = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'customer.updated'`.execute(db)).rows[0] as any;
    expect(after.n).toBe(1);
  });
});

describe('Phase 12 — appointment.rescheduled carries the FROM and TO slot (§60)', () => {
  it('moving an appointment writes one rescheduled event with both slots, and the change history in the same transaction', async () => {
    const created: any = await booking.create(ctx, item({ startTime: '09:00', endTime: '09:45' }) as any);
    const id = created.appointmentId ?? created.id;
    expect(await booking.reschedule(ctx, id, TECH, '16:30', '2026-09-20')).toBe(true);
    const out = (await sql`SELECT event_type, payload_json FROM outbox_events WHERE aggregate_id = ${id} ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(out.map((r) => r.event_type)).toEqual(['appointment.created', 'appointment.rescheduled']);
    const p = typeof out[1].payload_json === 'string' ? JSON.parse(out[1].payload_json) : out[1].payload_json;
    expect(p).toMatchObject({ appointmentId: id, fromDate: '2026-09-19', fromStartTime: '09:00', toDate: '2026-09-20', toStartTime: '16:30', toTechnicianId: TECH });
    expect(JSON.stringify(p)).not.toMatch(/Olivia|Brown/);
    const row = (await sql`SELECT appt_date, start_time FROM pos_tech_appointments WHERE id = ${id}`.execute(db)).rows[0] as any;
    expect(new Date(row.appt_date).toISOString().slice(0, 10)).toBe('2026-09-20');   // the driver returns a Date, not a string
    expect(String(row.start_time).slice(0, 5)).toBe('16:30');
  });
});

describe('Phase 12 — ticket service lines: add / edit / remove are facts (§67)', () => {
  const TK4 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee44';
  let serv: KyselyServingRepository;
  beforeAll(async () => {
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES (${TK4}, ${T}, ${B}, ${'dddddddd-dddd-dddd-dddd-dddddddddddd'}, 'serving') ON CONFLICT (id) DO NOTHING`.execute(db);
    await sql`INSERT INTO services (id, tenant_id, branch_id, name, price_cents, duration_minutes) VALUES ('11111111-2222-3333-4444-555555555555', ${T}, ${B}, 'Gel Manicure', 4500, 45) ON CONFLICT (id) DO NOTHING`.execute(db).catch(() => {});
    serv = new KyselyServingRepository(db, new OutboxWriter());
  });

  it('adding, editing and removing a line each write one event, correlated by ticket', async () => {
    expect(await serv.addService(ctx, TK4, { serviceLineId: '', serviceId: '11111111-2222-3333-4444-555555555555', serviceName: 'Gel Manicure', priceCents: 4500, estDurationMin: 45, technicianId: TECH, status: 'serving' } as any)).toBe(true);
    const lineRow: any = (await sql`SELECT id FROM ticket_service_lines WHERE ticket_id = ${TK4} LIMIT 1`.execute(db)).rows[0];
    expect(await serv.editService(ctx, TK4, lineRow.id, { priceCents: 5000 } as any)).toBe(true);
    expect(await serv.removeService(ctx, TK4, lineRow.id)).toBe(true);
    const out = (await sql`SELECT event_type, correlation_id, payload_json FROM outbox_events WHERE aggregate_id = ${TK4} ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(out.map((r) => r.event_type)).toEqual(['ticket.service_line_added', 'ticket.service_line_updated', 'ticket.service_line_removed']);
    expect(out.every((r) => r.correlation_id === `ticket:${TK4}`)).toBe(true);
    const upd = typeof out[1].payload_json === 'string' ? JSON.parse(out[1].payload_json) : out[1].payload_json;
    expect(upd.changedFields.length).toBeGreaterThan(0);
    expect(JSON.stringify(upd)).not.toMatch(/5000/);                         // field NAMES, not values (§95)
  });

  it('removing a line that does not exist emits nothing', async () => {
    const before: any = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ${TK4}`.execute(db)).rows[0];
    expect(await serv.removeService(ctx, TK4, '99999999-8888-7777-6666-555555555555')).toBe(false);
    const after: any = (await sql`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = ${TK4}`.execute(db)).rows[0];
    expect(after.n).toBe(before.n);
  });
});

// ── the two single-push modules: service-done and tech-appointments ──────────────────────────────────────────
import { KyselyTechApptRepository } from '@aipowersalon/appointments';

describe('Phase 12 — service-done: the checkout handoff is a fact (§67)', () => {
  it('sending a ticket to checkout emits ticket.ready_for_checkout; reopening it emits nothing', async () => {
    const TK5 = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee55';
    await sql`INSERT INTO tickets (id, tenant_id, branch_id, customer_id, status) VALUES (${TK5}, ${T}, ${B}, ${'dddddddd-dddd-dddd-dddd-dddddddddddd'}, 'serving') ON CONFLICT (id) DO NOTHING`.execute(db);
    const sd = new KyselyServiceDoneRepository(db, new OutboxWriter());
    expect(await sd.setCheckoutStatus(ctx, TK5, 'sent_to_checkout' as any, 'sent_to_checkout' as any)).toBe(true);
    await sd.setCheckoutStatus(ctx, TK5, 'reopened' as any, 'reopened' as any);   // what the reopen path writes ('none' was never a valid checkout status)
    const out = (await sql`SELECT event_type, correlation_id FROM outbox_events WHERE aggregate_id = ${TK5}`.execute(db)).rows as any[];
    expect(out.map((r) => r.event_type)).toEqual(['ticket.ready_for_checkout']);
    expect(out[0].correlation_id).toBe(`ticket:${TK5}`);
  });
});

describe('Phase 12 — tech-appointments writes the SAME appointment.* vocabulary as booking (§6)', () => {
  it('creating and cancelling through the technician screen emits the same events the booking screen does', async () => {
    const ta = new KyselyTechApptRepository(db, new OutboxWriter());
    const created: any = await ta.create(ctx, { technicianId: TECH, customerId: null, customerName: 'Rae Lin', customerPhone: '+16095550444', isVip: false,
      source: 'manual', services: [{ serviceId: 's-1', serviceName: 'Gel', durationMinutes: 30, priceCents: 3000 }],
      date: '2026-09-21', startTime: '10:00', endTime: '10:30', status: 'booked', notes: '' } as any);
    const id = created.appointmentId ?? created.id;
    expect(await ta.setStatus(ctx, id, 'cancelled' as any)).toBe(true);
    const out = (await sql`SELECT event_type, payload_json FROM outbox_events WHERE aggregate_id = ${id} ORDER BY occurred_at`.execute(db)).rows as any[];
    expect(out.map((r) => r.event_type)).toEqual(['appointment.created', 'appointment.canceled']);
    const p = typeof out[0].payload_json === 'string' ? JSON.parse(out[0].payload_json) : out[0].payload_json;
    expect(p).toMatchObject({ technicianId: TECH, date: '2026-09-21', startTime: '10:00', source: 'manual', serviceCount: 1 });   // source vocabulary is CHECK-constrained: walk_in/phone/online/google/ai/customer_app/manual
    expect(JSON.stringify(p)).not.toMatch(/Rae Lin|0444/);                 // §95
  });
});
