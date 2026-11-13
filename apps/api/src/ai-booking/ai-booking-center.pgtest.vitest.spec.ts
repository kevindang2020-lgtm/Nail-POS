// ai-booking-center.pgtest — A7 AI Booking Assistant guide (Nov 4 2026): the operations center reads the EXISTING records.
// A request = one assistant session (correlation id); its status comes from the funnel AND the authoritative appointment
// ("AI said booked", "pending appointment exists" and "confirmed appointment exists" are different facts, §6).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { AiBookingCenter } from './ai-booking-center';
import { TenantApprovalsService } from '@aipowersalon/workforce';
import { OutboxWriter } from '@aipowersalon/events';

const T = 'a7b40000-0000-4000-8000-000000000001', B = 'a7b40000-0000-4000-8000-000000000002', B2 = 'a7b40000-0000-4000-8000-000000000003';
const C1 = 'a7b40000-0000-4000-8000-0000000000c1', TE = 'a7b40000-0000-4000-8000-0000000000e1';
const A1 = 'a7b40000-0000-4000-8000-0000000000a1', A2 = 'a7b40000-0000-4000-8000-0000000000a2';
const ctx: any = { tenantId: T, branchId: B, userId: 'a7b40000-0000-4000-8000-0000000000f1', role: 'OWNER', permissions: ['ai_booking.view'] };
const audited: Array<Record<string, unknown>> = [];
// Nov 10 2026: the events were fixed at Nov 3 2026 while the recovery view looks back 7 days from NOW — the tests broke
// one week after they were written. Anchored to a day ago (top of the hour) so they hold on any date.
const BASE = Math.floor((Date.now() - 86_400_000) / 3_600_000) * 3_600_000;
let pg: any; let center: AiBookingCenter;
const ev = (cid: string, stage: string, minute: number, extra: { outcome?: string; failure?: string; appt?: string; branch?: string } = {}) =>
  pg.query(`insert into ai_booking_conversion_events (tenant_id, branch_id, source, stage, outcome, failure_reason, appointment_id, correlation_id, created_at) values ($1,$2,'AI_PHONE_RECEPTIONIST',$3,$4,$5,$6,$7,$8)`,
    [T, extra.branch ?? B, stage, extra.outcome ?? null, extra.failure ?? null, extra.appt ?? null, cid, new Date(BASE + minute * 60_000).toISOString()]);

beforeAll(async () => {
  pg = await migratedPglite(); await pg.exec(`SET TIME ZONE 'UTC'`);
  await pg.exec(`
    insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ('${T}','B','B','aib-c','AIBC1','active');
    insert into branches (id, tenant_id, name, timezone) values ('${B}','${T}','Main','America/New_York'), ('${B2}','${T}','Second','America/New_York');
    insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email) values ('${C1}','${T}','${B}','Thảo','Nguyễn','Thảo Nguyễn','+18565551234','thao@example.com');
    insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ('${TE}','${T}','${B}','Lan','Tran','Lan Tran');
    insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, status) values
      ('${A1}','${T}','${B}','${TE}','${C1}','Thảo Nguyễn','(856) 555-1234','ai','[{"name":"Gel Manicure","priceCents":4500,"durationMinutes":45}]','2026-11-05','10:00','10:45','confirmed'),
      ('${A2}','${T}','${B}','${TE}','${C1}','Thảo Nguyễn','(856) 555-1234','ai','[{"name":"Pedicure"}]','2026-11-06','11:00','12:00','booked');
  `);
  // r1: booked + confirmed in POS Booking → confirmed;  r2: appointment created, not confirmed → pending confirmation
  await ev('r1', 'BOOKING_INTENT_DETECTED', 0); await ev('r1', 'OPTIONS_PRESENTED', 1); await ev('r1', 'BOOKING_SUCCEEDED', 2, { appt: A1, outcome: 'succeeded' });
  await ev('r2', 'BOOKING_INTENT_DETECTED', 3); await ev('r2', 'BOOKING_SUCCEEDED', 4, { appt: A2, outcome: 'succeeded' });
  // r3: two failed attempts (the AI may have said "booked" — no appointment exists) → failed;  r4: waiting for the code;  r5: other location
  await ev('r3', 'BOOKING_INTENT_DETECTED', 5); await ev('r3', 'BOOKING_ATTEMPTED', 6); await ev('r3', 'BOOKING_ATTEMPTED', 7); await ev('r3', 'BOOKING_FAILED', 8, { outcome: 'failed', failure: 'APPOINTMENT_CONFLICT' });
  await ev('r4', 'BOOKING_INTENT_DETECTED', 9); await ev('r4', 'OPTIONS_PRESENTED', 10); await ev('r4', 'CONFIRMATION_REQUESTED', 11);
  await ev('r5', 'BOOKING_INTENT_DETECTED', 12, { branch: B2 });
  center = new AiBookingCenter(kyselyFor(pg) as any, {}, () => Date.UTC(2026, 10, 4, 15, 0), async (c, i) => { audited.push({ ...c, ...i }); });
}, 180_000);

describe('A7 activity: one row per request, status from the authoritative appointment', () => {
  it('derives each status; newest first; never another location', async () => {
    const r = await center.activity(ctx, {});
    expect(r.items.map((x) => [x.requestId, x.status])).toEqual([['r4', 'pending_verification'], ['r3', 'failed'], ['r2', 'pending_confirmation'], ['r1', 'confirmed']]);
    expect(r.items.find((x) => x.requestId === 'r3')).toMatchObject({ attempts: 2, failureReason: 'APPOINTMENT_CONFLICT', appointmentId: null });
    expect(r.items.find((x) => x.requestId === 'r1')).toMatchObject({ appointmentDate: '2026-11-05', services: ['Gel Manicure'], technicianName: 'Lan Tran', maskedPhone: '••• 1234' });
  });
  it('searches the server over every row: accent-free name, phone digits, email, service, technician, appointment id; filters + pages', async () => {
    expect((await center.activity(ctx, { q: 'thao nguyen' })).totalItems).toBe(2);
    expect((await center.activity(ctx, { q: '856-555-1234' })).totalItems).toBe(2);
    expect((await center.activity(ctx, { q: 'thao@example' })).totalItems).toBe(2);
    expect((await center.activity(ctx, { q: 'pedicure' })).items.map((x) => x.requestId)).toEqual(['r2']);
    expect((await center.activity(ctx, { q: A1 })).items.map((x) => x.requestId)).toEqual(['r1']);
    expect((await center.activity(ctx, { status: 'failed' })).totalItems).toBe(1);
    const p = await center.activity(ctx, { pageSize: 10 });
    expect(p).toMatchObject({ pageSize: 10, totalPages: 1, totalItems: 4 });
    expect((await center.activity(ctx, { basis: 'appointment', preset: 'custom', from: '2026-11-06', to: '2026-11-06' })).items.map((x) => x.requestId)).toEqual(['r2']);
    await expect(center.activity(ctx, { preset: 'custom', from: '2026-11-09', to: '2026-11-01' })).rejects.toThrow(/before/);
  });
  it('the owner without a location sees every location', async () => {
    expect((await center.activity({ ...ctx, branchId: null }, {})).totalItems).toBe(5);
  });
});

describe('A7 overview counts', () => {
  it('counts by the same derived status, for the period', async () => {
    const o = await center.overview(ctx, { preset: 'month' });
    expect(o).toMatchObject({ requests: 4, confirmed: 1, pendingConfirmation: 1, pendingVerification: 1, failed: 1, prepared: 3 });
    expect(o.period.tz).toBe('America/New_York');
  });
});

describe('A7 request detail', () => {
  it('timeline, service lines and the customer — never a verification code', async () => {
    const d = await center.detail(ctx, 'r1');
    expect(d.timeline.map((x) => x.stage)).toEqual(['BOOKING_INTENT_DETECTED', 'OPTIONS_PRESENTED', 'BOOKING_SUCCEEDED']);
    expect(d.serviceLines[0]).toMatchObject({ name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 });
    expect(d.customer.appointments.length).toBe(2);
    await expect(center.detail(ctx, 'r5')).rejects.toThrow(/could not be found/);   // another location
  });
});

describe('Extras · AI Booking Assistant 10 — contextual service breakdown', () => {
  it('each line beside the CURRENT catalog: add-on marked, manual override kept apart with its reason, totals; nothing re-priced', async () => {
    const CAT = 'a7b40000-0000-4000-8000-0000000000d1', S1 = 'a7b40000-0000-4000-8000-0000000000d2', S2 = 'a7b40000-0000-4000-8000-0000000000d3', GONE = 'a7b40000-0000-4000-8000-0000000000d4', A9 = 'a7b40000-0000-4000-8000-0000000000a9';
    await pg.query(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails')`, [CAT, T, B]);
    await pg.query(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values ($1,$3,$4,$5,'Gel Manicure',45,5000), ($2,$3,$4,$5,'Nail Art',15,1500)`, [S1, S2, T, B, CAT]);
    const lines = [{ serviceId: S1, serviceName: 'Gel Manicure', priceCents: 4000, priceOverrideCents: 4000, overrideReason: 'Loyal guest', durationMinutes: 45 },
      { serviceId: S2, serviceName: 'Nail Art', priceCents: 1500, durationMinutes: 15, isAddon: true, parentServiceId: S1 },
      { serviceId: GONE, serviceName: 'Old Service', priceCents: 900, durationMinutes: 10 }];
    await pg.query(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, source, services, appt_date, start_time, end_time, status) values ($1,$2,$3,$4,$5,'Thảo Nguyễn','(856) 555-1234','ai',$6::jsonb,'2026-11-07','10:00','11:10','booked')`, [A9, T, B, TE, C1, JSON.stringify(lines)]);
    await ev('r9', 'BOOKING_INTENT_DETECTED', 20); await ev('r9', 'BOOKING_SUCCEEDED', 21, { appt: A9, outcome: 'succeeded' });
    const d = await center.detail(ctx, 'r9');
    expect(d.serviceLines[0]).toMatchObject({ name: 'Gel Manicure', priceCents: 4000, manualOverride: true, overrideReason: 'Loyal guest', catalogPriceCents: 5000, catalogDurationMinutes: 45, inCatalog: true, isAddon: false });
    expect(d.serviceLines[1]).toMatchObject({ name: 'Nail Art', priceCents: 1500, manualOverride: false, overrideReason: null, catalogPriceCents: 1500, isAddon: true, parentServiceId: S1 });
    expect(d.serviceLines[2]).toMatchObject({ name: 'Old Service', inCatalog: false, catalogPriceCents: null });
    expect(d.serviceSummary).toEqual({ lines: 3, addOns: 1, totalPriceCents: 6400, totalDurationMinutes: 70, catalogTotalCents: null, overrides: 1, notInCatalog: 1 });
    // the stored appointment lines are untouched
    expect((await pg.query(`select services from pos_tech_appointments where id = $1`, [A9])).rows[0].services).toEqual(lines);
    // an older free-form line (no service id) still reads, never claims a catalog price
    const old = await center.detail(ctx, 'r1');
    expect(old.serviceLines[0]).toMatchObject({ name: 'Gel Manicure', priceCents: 4500, inCatalog: false, catalogPriceCents: null, manualOverride: false });
    expect(old.serviceSummary).toMatchObject({ lines: 1, totalPriceCents: 4500, totalDurationMinutes: 45, catalogTotalCents: null });
  });
});

describe('A7 recovery', () => {
  it('lists failed requests and AI appointments not yet confirmed; Dismiss needs a reason and is audited', async () => {
    const r = await center.recovery(ctx);
    expect(r.cases.map((c) => c.type)).toEqual(expect.arrayContaining(['repeated_attempts']));
    const key = r.cases.find((c) => c.requestId === 'r3')!.key;
    await expect(center.dismissRecovery(ctx, key, '')).rejects.toThrow(/why/);
    await center.dismissRecovery(ctx, key, 'Called the guest back and booked by phone');
    expect((await center.recovery(ctx)).cases.find((c) => c.key === key)).toBeUndefined();
    expect(audited.filter((a) => a.action === 'ai_booking_recovery_dismissed')).toHaveLength(1);   // through the audit module
  });
});

// guide §10 "Review Alternative" / "Request Manager Approval": alternatives are POS Booking's own open times (never invented,
// nothing held); approval goes to the salon's ONE approvals engine, one live request per case, shown on the case
describe('A7 recovery: alternatives and manager approval', () => {
  it('alternatives come from the availability engine for the case day; past starts today are dropped; suggestions only', async () => {
    await ev('r6', 'BOOKING_INTENT_DETECTED', 20); await ev('r6', 'BOOKING_ATTEMPTED', 21); await ev('r6', 'BOOKING_FAILED', 22, { outcome: 'failed', failure: 'TECHNICIAN_UNAVAILABLE' });
    const asked: any[] = [];
    center.availability = async (c, q) => { asked.push({ branch: c.branchId, ...q }); return [{ technicianId: TE, name: 'Lan Tran', slots: ['09:00', '10:30', '15:00'] }, { technicianId: 'x', name: 'Mai', slots: ['10:00'] }]; };
    const key = (await center.recovery(ctx)).cases.find((c) => c.requestId === 'r6')!.key;
    const a = await center.alternatives(ctx, key);
    // the clock is Nov 4 15:00 UTC = 10:00 New York: 09:00 and 10:00 have passed, 10:30 and 15:00 remain
    expect(asked).toEqual([{ branch: B, date: '2026-11-04', serviceIds: undefined }]);
    expect(a.alternatives.map((x) => [x.technicianName, x.start])).toEqual([['Lan Tran', '10:30'], ['Lan Tran', '15:00']]);
    expect(a.safety).toMatch(/nothing is held, booked or sent/);
    expect(a.note).toMatch(/default service length/);
    await expect(center.alternatives(ctx, 'failed:not-a-case')).rejects.toThrow(/no longer open/);
    await expect(center.alternatives({ ...ctx, branchId: null }, key)).rejects.toThrow(/Choose a location/);
  });
  it('Request Manager Approval: reason required, one live request per case, visible on the case and in Approvals', async () => {
    center.approvals = new TenantApprovalsService(kyselyFor(pg) as any, new OutboxWriter()) as any;
    const key = (await center.recovery(ctx)).cases.find((c) => c.requestId === 'r6')!.key;
    await expect(center.requestApproval(ctx, key, 'no')).rejects.toThrow(/at least 3/);
    const first: any = await center.requestApproval(ctx, key, 'Offer the guest a 15% courtesy discount for the failed booking');
    const again: any = await center.requestApproval(ctx, key, 'asking twice');
    expect(first.approval.created).toBe(true); expect(again.approval.created).toBe(false);
    expect(again.approval.request.id).toBe(first.approval.request.id);
    const row = (await pg.query(`select kind, subject_type, subject_id, status, title from tenant_approval_requests where tenant_id = $1 and subject_id = $2`, [T, key])).rows;
    expect(row).toEqual([{ kind: 'other', subject_type: 'ai_booking_recovery_case', subject_id: key, status: 'pending', title: expect.stringContaining('AI booking recovery: failed request') }]);
    expect((await center.recovery(ctx)).cases.find((c) => c.key === key)?.approval).toMatchObject({ status: 'pending' });
    expect(audited.filter((x) => x.action === 'ai_booking_recovery_approval_requested')).toHaveLength(2);
    await expect(center.requestApproval(ctx, 'hold:00000000-0000-4000-8000-000000000000', 'not a real case')).rejects.toThrow(/no longer open/);
  });
});

describe('A7 Check AI Booking System', () => {
  it('every part reports; read-only (no appointment, no hold, no message); recorded and read back', async () => {
    const before = (await pg.query(`select (select count(*) from pos_tech_appointments)::int a, (select count(*) from booking_holds)::int h`)).rows[0];
    const run = await center.health(ctx);
    for (const k of ['entitlement', 'permissions', 'provider', 'catalog', 'technicians', 'availability', 'booking_api', 'verification', 'communications', 'sync', 'usage', 'observability']) expect(run.checks.map((c) => c.key)).toContain(k);
    expect(run.checks.find((c) => c.key === 'entitlement')?.status).toBe('NOT_CONFIGURED');   // no subscription row
    expect(run.checks.find((c) => c.key === 'provider')?.status).toBe('NOT_CONFIGURED');      // no key in this env
    expect(run.checks.find((c) => c.key === 'technicians')?.status).toBe('READY');
    expect((await pg.query(`select (select count(*) from pos_tech_appointments)::int a, (select count(*) from booking_holds)::int h`)).rows[0]).toEqual(before);
    expect((await center.lastHealth(ctx)).run).toMatchObject({ runId: run.runId });
  });
  it('without ai_booking.view nothing is read', async () => {
    await expect(center.activity({ ...ctx, permissions: [], role: 'TECHNICIAN' }, {})).rejects.toThrow(/permission/);
  });
});

describe('round 10 (AI Booking 14): the Support report download is audited on the server', () => {
  it('records who / which request / what the file holds; another location\'s or an unknown request is refused; without the audit trail it refuses (never an unaudited download)', async () => {
    const before = audited.length;
    const r = await center.recordSupportReport(ctx, 'r1');
    expect(r).toMatchObject({ recorded: true, requestId: 'r1' });
    expect(audited.length).toBe(before + 1);
    expect(audited[audited.length - 1]).toMatchObject({ tenantId: T, branchId: B, module: 'ai_booking', action: 'ai_booking_support_report_exported', resourceType: 'ai_booking_request', resourceId: 'r1', metadata: { format: 'text', redacted: true, screenshots: false } });
    await expect(center.recordSupportReport(ctx, 'r5')).rejects.toMatchObject({ code: 'NOT_FOUND' });   // r5 is the other location's request
    await expect(center.recordSupportReport(ctx, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(center.recordSupportReport({ ...ctx, permissions: [] }, 'r1')).rejects.toBeTruthy();
    expect(audited.length).toBe(before + 1);
    const noAudit = new AiBookingCenter(kyselyFor(pg) as any, {}, () => Date.UTC(2026, 10, 4, 15, 0));
    await expect(noAudit.recordSupportReport(ctx, 'r1')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

