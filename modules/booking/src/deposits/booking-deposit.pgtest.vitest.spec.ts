// booking-deposit.pgtest — D11 (Oct 21 2026): the life of a booking deposit on the real schema against a fake processor.
// Requirement from the salon's settings · pay (approved / declined / lost answer verified by order id, never charged twice)
// · refund inside the window, forfeit outside, the salon's own cancellation always refunds · no-show per policy · the
// state machine refuses every move out of an ended deposit · every money move leaves its domain event.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { BookingDepositService, DepositError } from './booking-deposit.service';

const T = 'd1100000-0000-4000-8000-000000000001', B = 'd1100000-0000-4000-8000-000000000002', C = 'd1100000-0000-4000-8000-0000000000c1', TECH = 'd1100000-0000-4000-8000-0000000000e1';
const ctx = { tenantId: T, branchId: B, userId: 'd1100000-0000-4000-8000-0000000000f1' };
let db: any; let clock = new Date('2026-11-02T10:00:00Z');
const svc = (proc: any, configured = true) => new BookingDepositService(db, { resolve: async () => ({ configured, processorType: 'fiserv', processor: configured ? (proc as any) : undefined }) }, new OutboxWriter(), () => clock);

/** a fake gateway: approve / decline / throw once; remembers what it was asked */
function processor(mode: 'approve' | 'decline' | 'lost' = 'approve') {
  const calls: any[] = []; let lost = mode === 'lost';
  return {
    calls,
    async authorizeAndCapture(i: any) { calls.push(['auth', i.amountCents, i.orderId, i.profile]); if (lost) { lost = false; throw new Error('gateway timeout'); } return mode === 'decline' ? { approved: false, declined: true, respstat: 'C', respText: 'Insufficient funds' } : { approved: true, retref: 'RR-' + i.orderId, respstat: 'A', profileId: 'PROF-1', last4: '4242' }; },
    async refund(i: any) { calls.push(['refund', i.retref, i.amountCents]); return { ok: true, retref: 'RF-' + i.retref }; },
    async inquireByOrderId(orderId: string) { calls.push(['inquire', orderId]); return { transactions: calls.some((c) => c[0] === 'auth' && c[2] === orderId && mode !== 'decline' && this.chargedAnyway) ? [{ retref: 'RR-FOUND', approved: true, profileId: 'PROF-F', last4: '1111' }] : [] }; },
    chargedAnyway: false,
  };
}
let day = 0;   // every appointment on its own day: the technician's no-overlap constraint is not what this file tests
async function appointment(startsAt = '2026-11-05T15:00:00Z', price = 10000): Promise<string> {
  const d = new Date(new Date(startsAt).getTime() + (day++) * 86_400_000 * 0);   // same calendar start for the policy maths …
  const slotDay = new Date(Date.UTC(2027, 0, 1 + day));                            // … but the stored row lands on a unique day
  const r: any = (await sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, source, services, appt_date, start_time, end_time, status, duration_minutes)
    values (${T}, ${B}, ${TECH}, ${C}, 'Ana Lee', 'customer_app', ${JSON.stringify([{ serviceId: 'svc', serviceName: 'Gel', priceCents: price, durationMinutes: 60 }])}::jsonb, ${slotDay.toISOString().slice(0, 10)}, ${d.toISOString().slice(11, 16)}, '16:00', 'booked', 60) returning id`.execute(db)).rows[0];
  return String(r.id);
}
const settings = async (v: Record<string, unknown>) => { await sql`delete from tenant_settings where tenant_id = ${T} and category = 'booking-appointments'`.execute(db); await sql`insert into tenant_settings (tenant_id, branch_id, category, settings_json) values (${T}, null, 'booking-appointments', ${JSON.stringify(v)}::jsonb)`.execute(db); };
const events = async (depositId: string) => (await sql`select event_type from outbox_events where tenant_id = ${T} and aggregate_id = ${depositId} order by created_at`.execute(db)).rows.map((r: any) => r.event_type);
const apptDeposit = async (id: string) => ((await sql`select deposit_status from pos_tech_appointments where id = ${id}`.execute(db)).rows[0] as any).deposit_status;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'D', 'D Salon', 'd-dep', 'DDEP1', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'UTC')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status) values (${C}, ${T}, ${B}, 'Ana', 'Lee', 'Ana Lee', 'active')`.execute(db);
  await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Tina', 'Tech', 'Tina Tech')`.execute(db);
}, 120_000);
beforeEach(async () => { clock = new Date('2026-11-02T10:00:00Z'); await settings({ depositRequired: true, depositPercent: 25, cancellationWindowHours: 24, noShowPolicy: 'charge_fee' }); });

describe('requirement', () => {
  it('comes from the salon\'s booking settings: 25 % of the price, the cancellation window, the no-show policy — snapshotted on the row', async () => {
    const id = await appointment('2026-11-05T15:00:00Z', 10000);
    const d = await svc(processor()).createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date('2026-11-05T15:00:00Z') });
    expect(d).toMatchObject({ status: 'pending', amountCents: 2500, refundableUntil: '2026-11-04T15:00:00.000Z', forfeitOnNoShow: true });
    expect(await apptDeposit(id)).toBe('required');
    // a later settings change does not move this guest's deadline
    await settings({ depositRequired: true, depositPercent: 50, cancellationWindowHours: 48 });
    expect(await svc(processor()).forAppointment(ctx, id)).toMatchObject({ amountCents: 2500, refundableUntil: '2026-11-04T15:00:00.000Z' });
  });
  it('a salon that takes no deposit: nothing is created, the appointment stays not_required', async () => {
    await settings({ depositRequired: false, depositPercent: 25 });
    const id = await appointment();
    expect(await svc(processor()).createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date() })).toBeNull();
    expect(await apptDeposit(id)).toBe('not_required');
  });
});

describe('pay', () => {
  it('approved: captured with the processor reference, the stored profile and the last four; the appointment says paid; one event', async () => {
    const id = await appointment(); const p = processor(); const s = svc(p);
    const d = (await s.createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date('2026-11-05T15:00:00Z') }))!;
    const paid = await s.pay(ctx, d.depositId, { token: '9418594164541111', expiry: '1229' });
    expect(paid).toMatchObject({ status: 'captured', amountCents: 2500, cardLast4: '1111' });   // the token's own last four
    expect(p.calls).toEqual([['auth', 2500, 'dep:' + d.depositId, 'Y']]);       // card-not-present, stored profile asked for
    expect(await apptDeposit(id)).toBe('paid');
    expect(await events(d.depositId)).toEqual(['booking.deposit_captured']);
    // paying again charges nothing
    expect(await s.pay(ctx, d.depositId, { token: '9418594164541111' })).toMatchObject({ status: 'captured' });
    expect(p.calls.length).toBe(1);
  });
  it('declined: failed with the processor\'s words, the appointment says failed, and the guest may try another card', async () => {
    const id = await appointment(); const s = svc(processor('decline'));
    const d = (await s.createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date('2026-11-05T15:00:00Z') }))!;
    await expect(s.pay(ctx, d.depositId, { token: '9418594164541111' })).rejects.toMatchObject({ code: 'DEPOSIT_DECLINED', status: 402 });
    expect(await s.byId(ctx, d.depositId)).toMatchObject({ status: 'failed', failureReason: 'Insufficient funds' });
    expect(await apptDeposit(id)).toBe('failed');
    const ok = await svc(processor()).pay(ctx, d.depositId, { token: '9418594164544242' });
    expect(ok.status).toBe('captured');
  });
  it('a lost answer is not a decline and never a blind second charge: the next attempt asks the gateway by order id first', async () => {
    const id = await appointment(); const p = processor('lost'); const s = svc(p);
    const d = (await s.createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date('2026-11-05T15:00:00Z') }))!;
    await expect(s.pay(ctx, d.depositId, { token: '9418594164541111' })).rejects.toMatchObject({ code: 'DEPOSIT_STATUS_UNKNOWN', status: 409 });
    expect(await s.byId(ctx, d.depositId)).toMatchObject({ status: 'pending', failureReason: expect.stringMatching(/answer lost/) });
    p.chargedAnyway = true;                                                       // the gateway did charge before the timeout
    const r = await s.pay(ctx, d.depositId, { token: '9418594164541111' });
    expect(r).toMatchObject({ status: 'captured' });
    expect(p.calls.map((c) => c[0])).toEqual(['auth', 'inquire']);               // no second auth
  });
  it('without card payments set up the deposit stays pending and the answer says so (the salon takes it in person)', async () => {
    const id = await appointment(); const s = svc(processor(), false);
    const d = (await s.createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date('2026-11-05T15:00:00Z') }))!;
    await expect(s.pay(ctx, d.depositId, { token: '9418594164541111' })).rejects.toMatchObject({ code: 'PAYMENTS_NOT_CONFIGURED' });
    expect((await s.byId(ctx, d.depositId))!.status).toBe('pending');
  });
});

describe('cancellation and no-show', () => {
  async function captured() {
    const id = await appointment('2026-11-05T15:00:00Z'); const p = processor(); const s = svc(p);
    const d = (await s.createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date('2026-11-05T15:00:00Z') }))!;
    await s.pay(ctx, d.depositId, { token: '9418594164541111' });
    return { id, p, s, d };
  }
  it('the guest cancels inside the window (more than 24 h before) → refunded through the processor', async () => {
    const { id, p, s, d } = await captured();
    clock = new Date('2026-11-04T14:00:00Z');                                      // 25 h before
    expect(await s.onCancelled(ctx, id, 'customer')).toMatchObject({ status: 'refunded', refundedCents: 2500, endedReason: 'customer_cancelled' });
    expect(p.calls.at(-1)).toEqual(['refund', 'RR-dep:' + d.depositId, 2500]);
    expect(await events(d.depositId)).toEqual(['booking.deposit_captured', 'booking.deposit_refunded']);
  });
  it('the guest cancels late (inside 24 h) → forfeited, nothing sent to the processor', async () => {
    const { id, p, s, d } = await captured();
    clock = new Date('2026-11-04T16:00:00Z');                                      // 23 h before
    expect(await s.onCancelled(ctx, id, 'customer')).toMatchObject({ status: 'forfeited', endedReason: 'late_cancellation' });
    expect(p.calls.filter((c) => c[0] === 'refund')).toEqual([]);
    expect(await events(d.depositId)).toEqual(['booking.deposit_captured', 'booking.deposit_forfeited']);
  });
  it('the SALON cancels, however late → always refunded', async () => {
    const { id, s } = await captured();
    clock = new Date('2026-11-05T14:59:00Z');
    expect(await s.onCancelled(ctx, id, 'salon')).toMatchObject({ status: 'refunded', endedReason: 'salon_cancelled' });
  });
  it('a no-show forfeits per the policy snapshot; with the policy "none" it is refunded instead', async () => {
    const a = await captured();
    expect(await a.s.onNoShow(ctx, a.id)).toMatchObject({ status: 'forfeited', endedReason: 'no_show' });
    await settings({ depositRequired: true, depositPercent: 25, cancellationWindowHours: 24, noShowPolicy: 'none' });
    const b = await captured();
    expect(await b.s.onNoShow(ctx, b.id)).toMatchObject({ status: 'refunded', endedReason: 'no_show' });
  });
  it('an ended deposit never moves again: a second cancellation / no-show is a no-op (idempotent), and the machine refuses by SQL', async () => {
    const { id, s, p } = await captured();
    clock = new Date('2026-11-04T16:00:00Z');
    await s.onCancelled(ctx, id, 'customer');
    expect(await s.onNoShow(ctx, id)).toMatchObject({ status: 'forfeited' });
    expect(await s.onCancelled(ctx, id, 'salon')).toMatchObject({ status: 'forfeited' });
    expect(p.calls.filter((c) => c[0] === 'refund')).toEqual([]);
  });
  it('a pending (never paid) deposit on a cancelled booking just ends — nothing to refund, nothing sent', async () => {
    const id = await appointment(); const p = processor(); const s = svc(p);
    await s.createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date('2026-11-05T15:00:00Z') });
    expect(await s.onCancelled(ctx, id, 'customer')).toMatchObject({ status: 'pending' });
    expect(p.calls).toEqual([]);
  });
  it('the same-salon guard: a deposit naming another salon\'s appointment is refused by the database', async () => {
    const T2 = 'd1100000-0000-4000-8000-000000000099';
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T2}, 'X', 'X', 'x-dep', 'XDEP9', 'active')`.execute(db);
    const id = await appointment();
    await expect(sql`insert into booking_deposits (tenant_id, branch_id, appointment_id, amount_cents) values (${T2}, ${B}, ${id}, 100)`.execute(db)).rejects.toThrow(/tenant/i);
  });
});

describe('errors', () => {
  it('an unknown deposit is 404; a token too short is 400', async () => {
    const s = svc(processor());
    await expect(s.pay(ctx, 'd1100000-0000-4000-8000-00000000dead', { token: 'x' })).rejects.toBeInstanceOf(DepositError);
    const id = await appointment();
    const d = (await s.createForAppointment(ctx, { appointmentId: id, customerId: C, priceCents: 10000, startsAt: new Date('2026-11-05T15:00:00Z') }))!;
    await expect(s.pay(ctx, d.depositId, { token: 'x' })).rejects.toMatchObject({ code: 'DEPOSIT_INVALID', status: 400 });
  });
});
