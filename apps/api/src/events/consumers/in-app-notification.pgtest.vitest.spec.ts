// in-app-notification.pgtest — developer merge (Oct 6 2026) on the real schema, through the real outbox → consumer
// runner: the in-app feeds are written ONCE per fact for every path that records it — a cancelled appointment tells
// its customer (by whom), a check-in tells the customer and the technician, a queue assignment tells the technician,
// a paid ticket tells the owner (every method) and each tipped technician, a refund / void warns the owner. Another
// tenant's event for the same ids writes nothing and is a SECURITY failure; a redelivery writes nothing twice.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { InAppNotificationConsumer, apptDay } from './in-app-notification.consumer';

const T = 'ea100000-0000-4000-8000-000000000001', T2 = 'ea100000-0000-4000-8000-000000000002', B = 'ea100000-0000-4000-8000-0000000000b1';
const CUST = 'ea100000-0000-4000-8000-0000000000c1', TECH = 'ea100000-0000-4000-8000-0000000000d1', TECH2 = 'ea100000-0000-4000-8000-0000000000d2';
const A1 = 'ea100000-0000-4000-8000-0000000000a1', A2 = 'ea100000-0000-4000-8000-0000000000a2';
let db: any; let publisher: OutboxPublisher; let Q1: string; let TK: string; let PAY: string; let TQ: string;
const outbox = new OutboxWriter();
const emit = async (type: any, aggregate: { type: string; id: string }, payload: Record<string, unknown>, tenantId = T) => {
  await outbox.write(db, createDomainEvent({ eventType: type, tenantId, branchId: B, aggregateType: aggregate.type, aggregateId: aggregate.id, actorType: 'user', payload }));
  await publisher.tick();
};
const rows = async (table: string, where: string) => (await sql.raw(`select * from ${table} where ${where} order by created_at`).execute(db)).rows as any[];

beforeAll(async () => {

  const pg = await migratedPglite();
  db = kyselyFor(pg);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'N', 'N', 'nin', 'NIN01', 'active'), (${T2}, 'O', 'O', 'oth', 'OTH02', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${CUST}, ${T}, ${B}, 'Sophia', 'Davis', 'Sophia Davis')`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Lisa', 'One', 'Lisa One'), (${TECH2}, ${T}, ${B}, 'Anna', 'Two', 'Anna Two')`.execute(db);
  await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, services, status)
    values (${A1}, ${T}, ${B}, ${TECH}, ${CUST}, 'Sophia Davis', '2026-10-20', '14:30', '15:30', '[]', 'booked'), (${A2}, ${T}, ${B}, ${TECH}, null, 'Walk In', '2026-10-21', '09:00', '10:00', '[]', 'booked')`.execute(db);
  Q1 = ((await sql`insert into pos_queue_items (tenant_id, branch_id, customer_id, customer_name, status, source, priority, requested_services) values (${T}, ${B}, ${CUST}, 'Sophia Davis', 'waiting', 'walk_in', 'normal', '[]') returning id`.execute(db)).rows[0] as any).id;
  TK = ((await sql`insert into tickets (tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, ticket_number) values (${T}, ${B}, ${CUST}, ${TECH}, 'paid', 5000, 0, 0, 5000, 1000, 'T-1045') returning id`.execute(db)).rows[0] as any).id;
  PAY = ((await sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${T}, ${B}, ${TK}, 'cash', 6000, 1000, 'approved') returning id`.execute(db)).rows[0] as any).id;
  await sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${T}, ${B}, ${TK}, 'card', 100, 0, 'declined')`.execute(db);
  TQ = ((await sql`insert into pos_tech_queue_tickets (tenant_id, branch_id, queue_item_id, ticket_id, customer_name, source, requested_services, priority, status, assigned_technician_id) values (${T}, ${B}, ${Q1}, ${TK}, 'Sophia Davis', 'walk_in', '[]', 'normal', 'assigned', ${TECH}) returning id`.execute(db)).rows[0] as any).id;
  await sql`insert into ticket_tip_allocations (tenant_id, branch_id, ticket_id, technician_id, tip_cents) values (${T}, ${B}, ${TK}, ${TECH}, 600), (${T}, ${B}, ${TK}, ${TECH2}, 400)`.execute(db);
  const registry = new ConsumerRegistry(); registry.register(new InAppNotificationConsumer());
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db, { rand: () => 0 })));
}, 120_000);

describe('notifications.in_app', () => {
  it('appointment.canceled from the salon tells the customer it was the salon; from the customer app, not', async () => {
    await emit(DOMAIN_EVENTS.APPOINTMENT_CANCELED, { type: 'appointment', id: A1 }, { appointmentId: A1, status: 'cancelled' });
    const n = await rows('customer_notifications', `customer_id = '${CUST}' and type = 'warning'`);
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('Appointment cancelled');
    expect(n[0].body).toBe('Your appointment on Oct 20, 2026 at 2:30 PM was cancelled by the salon.');
    expect(n[0].reference).toBe(A1);
    await emit(DOMAIN_EVENTS.APPOINTMENT_CANCELED, { type: 'appointment', id: A1 }, { appointmentId: A1, status: 'cancelled', source: 'customer_app' });
    const again = await rows('customer_notifications', `customer_id = '${CUST}' and type = 'warning'`);
    expect(again[1].body).toBe('Your appointment on Oct 20, 2026 at 2:30 PM was cancelled.');
  });
  it('a walk-in appointment without a customer account writes nothing', async () => {
    await emit(DOMAIN_EVENTS.APPOINTMENT_CANCELED, { type: 'appointment', id: A2 }, { appointmentId: A2 });
    expect(await rows('customer_notifications', `reference = '${A2}'`)).toHaveLength(0);
  });
  it('appointment.created tells the technician and creates an owner alert', async () => {
    await emit(DOMAIN_EVENTS.APPOINTMENT_CREATED, { type: 'appointment', id: A1 }, { appointmentId: A1, status: 'booked' });
    const t = await rows('technician_notifications', `technician_id = '${TECH}' and type = 'booking'`);
    expect(t).toHaveLength(1);
    expect(t[0].title).toBe('New appointment booked');
    expect(t[0].body).toMatch(/Sophia Davis booked an appointment/);
    const o = await rows('owner_alerts', `title = 'New appointment booked'`);
    expect(o).toHaveLength(1);
    expect(o[0].severity).toBe('info');
  });
  it('a check-in tells the customer and the appointment’s technician (who may see the guest’s name in-app)', async () => {
    await emit(DOMAIN_EVENTS.CUSTOMER_CHECKED_IN, { type: 'appointment', id: A1 }, { appointmentId: A1, status: 'checked_in' });
    const c = await rows('customer_notifications', `reference = '${A1}' and type = 'arrival'`);
    expect(c).toHaveLength(1); expect(c[0].title).toBe('Checked in successfully');
    const t = await rows('technician_notifications', `technician_id = '${TECH}' and type = 'arrival'`);
    expect(t).toHaveLength(1); expect(t[0].body).toMatch(/^Sophia Davis checked in/);
    expect(t[0].reference).toBeNull();   // no tech-queue ticket for this appointment yet → nothing to open (never the appointment id: the app would 404)
  });
  it('queue.customer_assigned tells the technician; the line technicians hear about their service', async () => {
    await emit(DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED, { type: 'queue_item', id: Q1 }, { queueItemId: Q1, technicianId: TECH });
    await emit(DOMAIN_EVENTS.QUEUE_SERVICE_LINES_ASSIGNED, { type: 'queue_item', id: Q1 }, { queueItemId: Q1, leadTechnicianId: TECH, lines: [{ technicianId: TECH }, { technicianId: TECH2 }] });
    const n = await rows('technician_notifications', `type = 'assignment'`);
    expect(n.map((x) => [x.technician_id, x.body, x.reference])).toEqual([[TECH, 'Sophia Davis is waiting for you.', TQ], [TECH2, 'Sophia Davis has a service with you.', null]]);   // the tap opens the technician's OWN tech-queue ticket
  });
  it('checkout.completed: the owner hears every payment; each tipped technician hears their share', async () => {
    await emit(DOMAIN_EVENTS.CHECKOUT_COMPLETED, { type: 'ticket', id: TK }, { ticketId: TK, status: 'paid' });
    const o = await rows('owner_alerts', `tenant_id = '${T}' and category = 'payment'`);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ severity: 'info', status: 'new', title: 'Payment received', body: 'Sophia Davis paid $60.00 via cash on ticket #T-1045.', branch_id: B });
    expect((typeof o[0].metadata === 'string' ? JSON.parse(o[0].metadata) : o[0].metadata)).toMatchObject({ ticketId: TK, amountCents: 6000 });
    const tips = await rows('technician_notifications', `type = 'tip'`);
    expect(tips.map((x) => [x.technician_id, x.body, x.reference]).sort()).toEqual([[TECH, 'You received a $6.00 tip on ticket #T-1045.', TQ], [TECH2, 'You received a $4.00 tip on ticket #T-1045.', null]].sort());
  });
  // ONE-PAY F12 (Oct 13 2026): the tip a technician is told about is HER share from the one tip split — never the whole
  // ticket tip credited to the primary technician because the split has not landed yet.
  it('a paid ticket whose tip split has not landed yet tells nobody an invented amount — the event is retried (TRANSIENT)', async () => {
    const tk2 = ((await sql`insert into tickets (tenant_id, branch_id, customer_id, primary_technician_id, status, subtotal_cents, tax_cents, discount_cents, total_cents, tip_cents, ticket_number) values (${T}, ${B}, ${CUST}, ${TECH}, 'paid', 5000, 0, 0, 5000, 800, 'T-2001') returning id`.execute(db)).rows[0] as any).id;
    await sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values (${T}, ${B}, ${tk2}, 'card', 5800, 800, 'approved')`.execute(db);
    await sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values (${T}, ${B}, ${tk2}, '00000000-0000-0000-0000-000000000000', ${TECH2}, 'Gel', 5000, 45, 5000)`.execute(db);
    await emit(DOMAIN_EVENTS.CHECKOUT_COMPLETED, { type: 'ticket', id: tk2 }, { ticketId: tk2, status: 'paid' });
    expect(await rows('technician_notifications', `type = 'tip' and body like '%T-2001%'`)).toHaveLength(0);
    const dead = (await sql`select error_class, last_error_code from event_dead_letters where consumer_name = 'notifications.in_app' and last_error_code = 'tip_allocation_pending'`.execute(db)).rows as any[];
    expect(dead).toHaveLength(1);
    expect(dead[0].error_class).toBe('TRANSIENT');
  });
  it('a refund and a void warn the owner', async () => {
    await emit(DOMAIN_EVENTS.PAYMENT_REFUNDED, { type: 'payment_refund', id: 'ea100000-0000-4000-8000-0000000000e1' }, { refundId: 'ea100000-0000-4000-8000-0000000000e1', paymentId: PAY, amountCents: 1500 });
    await emit(DOMAIN_EVENTS.PAYMENT_VOIDED, { type: 'payment', id: PAY }, { paymentId: PAY, ticketId: TK, method: 'cash', amountCents: 6000 });
    const o = await rows('owner_alerts', `tenant_id = '${T}' and severity = 'warning'`);
    expect(o.map((x) => [x.title, x.body])).toEqual([['Payment refunded', 'A refund of $15.00 was issued on ticket #T-1045.'], ['Payment voided', 'A $60.00 cash payment was voided on ticket #T-1045.']]);
  });
  it('another tenant’s event for the same appointment writes nothing (tenant mismatch is a SECURITY failure)', async () => {
    const before = (await rows('customer_notifications', `reference = '${A1}'`)).length;
    await emit(DOMAIN_EVENTS.APPOINTMENT_CANCELED, { type: 'appointment', id: A1 }, { appointmentId: A1 }, T2);
    expect((await rows('customer_notifications', `reference = '${A1}'`)).length).toBe(before);
    const dead = (await sql`select error_class from event_dead_letters where consumer_name = 'notifications.in_app' order by last_failed_at desc limit 1`.execute(db)).rows[0] as any;
    expect(dead?.error_class).toBe('SECURITY');
  });
  it('a redelivered event writes nothing twice', async () => {
    const before = (await rows('technician_notifications', `type = 'tip'`)).length;
    await publisher.tick(); await publisher.tick();
    expect((await rows('technician_notifications', `type = 'tip'`)).length).toBe(before);
  });
  it('appointment.rescheduled notifies customer, technician, and owner', async () => {
    await emit(DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED, { type: 'appointment', id: A1 }, { appointmentId: A1, status: 'confirmed' });
    const c = await rows('customer_notifications', `reference = '${A1}' and title = 'Appointment rescheduled'`);
    expect(c).toHaveLength(1);
    expect(c[0].body).toMatch(/rescheduled to Oct 20, 2026 at 2:30 PM/);
    const t = await rows('technician_notifications', `technician_id = '${TECH}' and title = 'Appointment rescheduled'`);
    expect(t).toHaveLength(1);
    expect(t[0].body).toMatch(/rescheduled to Oct 20, 2026 at 2:30 PM/);
    const o = await rows('owner_alerts', `title = 'Appointment rescheduled'`);
    expect(o).toHaveLength(1);
  });
  it('apptDay formats a DATE whether it arrives as a string or a Date', () => {
    expect(apptDay('2026-10-20')).toBe('Oct 20, 2026');
    expect(apptDay(new Date('2026-10-20T00:00:00Z'))).toBe('Oct 20, 2026');
  });
  // finance mandate (Oct 21 2026): a bill coming due / overdue and a possible duplicate reach the owner's feed (category finance)
  it('bill.overdue and expense.duplicate_detected write a finance alert for the owner; another salon\'s event is refused', async () => {
    const EXP = ((await sql`insert into expenses (tenant_id, branch_id, category, amount_cents, incurred_on, vendor, kind, due_date, bill_status, status, invoice_number)
      values (${T}, ${B}, 'rent', 250000, '2026-10-01', 'Landlord LLC', 'bill', '2026-10-15', 'open', 'approved', 'R-10') returning id`.execute(db)).rows[0] as any).id as string;
    await emit(DOMAIN_EVENTS.BILL_OVERDUE, { type: 'expense', id: EXP }, { dueDate: '2026-10-15', dueState: 'overdue', openCents: 250000 });
    const a = await rows('owner_alerts', `tenant_id = '${T}' and category = 'finance'`);
    expect(a).toHaveLength(1);
    expect(a[0].title).toBe('Bill overdue'); expect(a[0].severity).toBe('warning');
    expect(a[0].body).toBe('Landlord LLC: $2500.00 was due Oct 15, 2026.');
    await emit(DOMAIN_EVENTS.EXPENSE_DUPLICATE_DETECTED, { type: 'expense', id: EXP }, { duplicateStatus: 'possible' });
    expect((await rows('owner_alerts', `tenant_id = '${T}' and category = 'finance'`)).map((x) => x.title)).toContain('Possible duplicate expense');
    await emit(DOMAIN_EVENTS.BILL_DUE_SOON, { type: 'expense', id: EXP }, { dueState: 'due_soon', openCents: 1 }, T2);
    expect(await rows('owner_alerts', `tenant_id = '${T2}' and category = 'finance'`)).toHaveLength(0);
  });

  // Receipt / Expense mandate §113 / §121 / §177–§179 (Oct 27 2026)
  it('a receipt ready for review, a receipt that could not be read, a reimbursement awaiting approval and the weekly / monthly summaries reach the owner; the owner\'s preferences switch each off', async () => {
    const DOC = ((await sql`insert into ocr_documents (tenant_id, branch_id, vendor, total_cents, pipeline_status) values (${T}, ${B}, 'Nail Supply Co', 12345, 'review_required') returning id`.execute(db)).rows[0] as any).id as string;
    const titles = async (t = T) => (await rows('owner_alerts', `tenant_id = '${t}' and category = 'finance'`)).map((x) => x.title);
    await emit(DOMAIN_EVENTS.EXPENSE_RECEIPT_REVIEW_REQUIRED, { type: 'ocr_document', id: DOC }, { documentId: DOC, pipelineState: 'review_required', duplicate: 'none', validation: 'valid' });
    expect(await titles()).toContain('Receipt ready to review');
    await emit(DOMAIN_EVENTS.EXPENSE_RECEIPT_PROCESSING_FAILED, { type: 'ocr_document', id: DOC }, { documentId: DOC, pipelineState: 'manual_entry_required', reason: 'no_provider', manualEntry: true });
    expect(await titles()).toContain('Receipt could not be read');
    const EXP = ((await sql`insert into expenses (tenant_id, branch_id, category, amount_cents, incurred_on, vendor, status, payment_method, reimbursement_status)
      values (${T}, ${B}, 'supplies', 4500, '2026-10-20', 'Sally Beauty', 'approved', 'personal_card', 'pending') returning id`.execute(db)).rows[0] as any).id as string;
    await emit(DOMAIN_EVENTS.EXPENSE_REIMBURSEMENT_CHANGED, { type: 'expense', id: EXP }, { reimbursementStatus: 'pending', amountCents: 4500 });
    expect(await titles()).toContain('Reimbursement awaiting approval');
    await emit(DOMAIN_EVENTS.EXPENSE_REIMBURSEMENT_CHANGED, { type: 'expense', id: EXP }, { reimbursementStatus: 'paid', amountCents: 4500 });
    expect((await titles()).filter((t) => t === 'Reimbursement awaiting approval')).toHaveLength(1);   // only "awaiting" is the owner's to act on
    await emit(DOMAIN_EVENTS.EXPENSE_SUMMARY_READY, { type: 'expense', id: T }, { period: 'week', from: '2026-10-12', to: '2026-10-18', totalCents: 482000, title: 'Weekly expense summary', body: 'Week of 2026-10-12: Expenses $4,820.00 · Receipts 23 · Needs review 2 · Bills due 3.' });
    await emit(DOMAIN_EVENTS.EXPENSE_SUMMARY_READY, { type: 'expense', id: T }, { period: 'month', from: '2026-09-01', to: '2026-09-30', totalCents: 3842000, title: 'September 2026 expense summary', body: 'Total expenses $38,420.00 · Up 6.2% from August · Largest category Payroll · Largest vendor ABC Nail Supply.' });
    expect(await titles()).toEqual(expect.arrayContaining(['Weekly expense summary', 'September 2026 expense summary']));
    const weekly = (await rows('owner_alerts', `tenant_id = '${T}' and title = 'Weekly expense summary'`))[0];
    expect(weekly.body).toContain('$4,820.00');
    expect(weekly.metadata?.kind ?? JSON.parse(weekly.metadata).kind).toBe('expense_weekly_summary');
    // §177: the owner turns needs-review, duplicate, bill-due and both summaries OFF — nothing more is written for this salon
    await sql`insert into expense_settings (tenant_id, notify_needs_review, notify_duplicate, notify_bill_due, notify_weekly_summary, notify_monthly_summary) values (${T}, false, false, false, false, false)
      on conflict (tenant_id) do update set notify_needs_review = false, notify_duplicate = false, notify_bill_due = false, notify_weekly_summary = false, notify_monthly_summary = false`.execute(db);
    const before = (await titles()).length;
    await emit(DOMAIN_EVENTS.EXPENSE_RECEIPT_REVIEW_REQUIRED, { type: 'ocr_document', id: DOC }, { documentId: DOC, pipelineState: 'review_required', duplicate: 'none' });
    await emit(DOMAIN_EVENTS.EXPENSE_DUPLICATE_DETECTED, { type: 'expense', id: EXP }, { duplicateStatus: 'possible' });
    await emit(DOMAIN_EVENTS.BILL_DUE_SOON, { type: 'expense', id: EXP }, { dueState: 'due_soon', openCents: 1 });
    await emit(DOMAIN_EVENTS.EXPENSE_SUMMARY_READY, { type: 'expense', id: T }, { period: 'week', title: 'Weekly expense summary', body: 'x' });
    await emit(DOMAIN_EVENTS.EXPENSE_SUMMARY_READY, { type: 'expense', id: T }, { period: 'month', title: 'Monthly', body: 'x' });
    expect((await titles()).length).toBe(before);
    // a failed reading is never silenced by a preference (the receipt needs a person either way)
    await emit(DOMAIN_EVENTS.EXPENSE_RECEIPT_PROCESSING_FAILED, { type: 'ocr_document', id: DOC }, { documentId: DOC, pipelineState: 'extraction_failed', reason: 'provider_failed' });
    expect((await titles()).length).toBe(before + 1);
    // another salon's event naming this document writes nothing (tenant mismatch is a SECURITY failure, swallowed by the runner as a failure)
    await emit(DOMAIN_EVENTS.EXPENSE_RECEIPT_REVIEW_REQUIRED, { type: 'ocr_document', id: DOC }, { documentId: DOC, pipelineState: 'review_required' }, T2);
    expect(await rows('owner_alerts', `tenant_id = '${T2}' and category = 'finance'`)).toHaveLength(0);
  });
});

// Kevin's ruling (Oct 28 2026): every customer message is English — a customer whose record says Vietnamese gets the same
// English feed rows as everyone else
describe('notifications.in_app — customers get English', () => {
  const CVI = 'ea100000-0000-4000-8000-0000000000c9', AVI = 'ea100000-0000-4000-8000-0000000000a9';
  beforeAll(async () => {
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, preferred_language) values (${CVI}, ${T}, ${B}, 'Lan', 'Nguyễn', 'Nguyễn Lan', 'vi')`.execute(db);
    await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, services, status)
      values (${AVI}, ${T}, ${B}, ${TECH}, ${CVI}, 'Nguyễn Lan', '2026-10-20', '14:30', '15:30', '[]', 'booked')`.execute(db);
  });
  it('cancelled by the salon, rescheduled (once), checked in — each in English for a customer marked Vietnamese', async () => {
    await emit(DOMAIN_EVENTS.APPOINTMENT_CANCELED, { type: 'appointment', id: AVI }, { appointmentId: AVI, status: 'cancelled' });
    const c = await rows('customer_notifications', `customer_id = '${CVI}' and type = 'warning'`);
    expect(c.map((r) => [r.title, r.body])).toEqual([['Appointment cancelled', 'Your appointment on Oct 20, 2026 at 2:30 PM was cancelled by the salon.']]);
    await emit(DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED, { type: 'appointment', id: AVI }, { appointmentId: AVI });
    await emit(DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED, { type: 'appointment', id: AVI }, { appointmentId: AVI });
    const r = await rows('customer_notifications', `customer_id = '${CVI}' and type = 'booking'`);
    expect(r).toHaveLength(1);   // written once
    expect(r[0].title).toBe('Appointment rescheduled');
    await emit(DOMAIN_EVENTS.CUSTOMER_CHECKED_IN, { type: 'appointment', id: AVI }, { appointmentId: AVI });
    expect((await rows('customer_notifications', `customer_id = '${CVI}' and type = 'arrival'`))[0].title).toBe('Checked in successfully');
  });
});

