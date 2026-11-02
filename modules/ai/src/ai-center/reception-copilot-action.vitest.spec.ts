// reception-copilot-action.vitest.spec.ts — the mutation spine. Proves: (1) nothing mutates without explicit
// confirmation (HUMAN_CONFIRMATION_REQUIRED, no domain call), (2) on confirmation it routes through the authorized
// BookingService with server-derived scope and records a RECEPTION_COPILOT audit event, (3) a domain permission error
// maps to INSUFFICIENT_PERMISSION, (4) a spoofed body cannot change the tenant the action runs against.
import { describe, it, expect, vi } from 'vitest';
import { ReceptionCopilotActionService, InMemoryActionLedgerRepo } from './reception-copilot-action.service';

const ctx = { tenantId: 'ten_1', branchId: 'br_1', userId: 'u_1', role: 'MANAGER', permissions: ['pos.booking.cancel','reception_copilot.create_appointment','reception_copilot.reschedule_appointment','reception_copilot.cancel_appointment','reception_copilot.send_message'] };

function make(cancelImpl: any = async () => ({ appointmentId: 'appt_1', status: 'cancelled' }), rescheduleImpl: any = async () => ({ appointmentId: 'appt_1', status: 'booked', startTime: '11:15' }), createImpl: any = async () => ({ appointmentId: 'appt_new', status: 'booked' }), sendImpl: any = async () => ({ sent: true, status: 'sent', id: 'notif_1', providerId: 'SMxxxx' })) {
  const booking = { cancel: vi.fn(cancelImpl), reschedule: vi.fn(rescheduleImpl), create: vi.fn(createImpl) };
  const audit = { record: vi.fn(async () => ({ id: 'ev' })) };
  const notifications = { send: vi.fn(sendImpl) };
  return { s: new ReceptionCopilotActionService(booking as any, audit as any, undefined, notifications as any), booking, audit, notifications };
}

describe('ReceptionCopilotActionService — mutation spine', () => {
  it('does NOT mutate without explicit confirmation', async () => {
    const { s, booking } = make();
    const r = await s.execute(ctx as any, { type: 'cancel_appointment', appointmentId: 'appt_1', reason: 'customer request' });
    expect(r.requiresConfirmation).toBe(true);
    expect(r.errorCode).toBe('HUMAN_CONFIRMATION_REQUIRED');
    expect(booking.cancel).not.toHaveBeenCalled();     // no domain write attempted
  });

  it('on confirmation, routes through BookingService with server scope and audits', async () => {
    const { s, booking, audit } = make();
    const r = await s.execute(ctx as any, { type: 'cancel_appointment', appointmentId: 'appt_1', reason: 'customer request', confirm: true });
    expect(r.ok).toBe(true);
    expect(booking.cancel).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', branchId: 'br_1' }), 'appt_1', { reason: 'customer request' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), expect.objectContaining({ module: 'reception_copilot', action: 'appointment.cancelled' }));
  });

  it('maps a domain permission error to INSUFFICIENT_PERMISSION (no audit of a non-action)', async () => {
    const { s, audit } = make(async () => { const e: any = new Error('Missing pos.booking.cancel'); e.name = 'ForbiddenError'; throw e; });
    const r = await s.execute(ctx as any, { type: 'cancel_appointment', appointmentId: 'appt_1', reason: 'x', confirm: true });
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('INSUFFICIENT_PERMISSION');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('requires a reason and a branch', async () => {
    const { s } = make();
    const noReason = await s.execute(ctx as any, { type: 'cancel_appointment', appointmentId: 'appt_1', reason: '  ', confirm: true });
    expect(noReason.ok).toBe(false);
    const noBranch = await s.execute({ ...ctx, branchId: null } as any, { type: 'cancel_appointment', appointmentId: 'appt_1', reason: 'x', confirm: true });
    expect(noBranch.ok).toBe(false);
  });

  it('runs against the server tenant even if the body carries a different one', async () => {
    const { s, booking } = make();
    await s.execute(ctx as any, { type: 'cancel_appointment', appointmentId: 'appt_1', reason: 'x', confirm: true, ...( { tenantId: 'attacker' } as any) });
    expect(booking.cancel).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), 'appt_1', expect.anything());
  });
});

describe('reschedule_appointment (spine generalizes)', () => {
  const resched = { tenantId: 'ten_1', branchId: 'br_1', userId: 'u_1', role: 'MANAGER', permissions: ['pos.booking.reschedule','reception_copilot.create_appointment','reception_copilot.reschedule_appointment','reception_copilot.cancel_appointment','reception_copilot.send_message'] };
  it('no write without confirmation', async () => {
    const { s, booking } = make();
    const r = await s.execute(resched as any, { type: 'reschedule_appointment', appointmentId: 'appt_1', startTime: '11:15', date: '2026-07-11' });
    expect(r.errorCode).toBe('HUMAN_CONFIRMATION_REQUIRED');
    expect(booking.reschedule).not.toHaveBeenCalled();
  });
  it('on confirm routes to BookingService.reschedule + audits', async () => {
    const { s, booking, audit } = make();
    const r = await s.execute(resched as any, { type: 'reschedule_appointment', appointmentId: 'appt_1', startTime: '11:15', date: '2026-07-11', confirm: true });
    expect(r.ok).toBe(true);
    expect(booking.reschedule).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', branchId: 'br_1' }), 'appt_1', { startTime: '11:15', date: '2026-07-11', technicianId: undefined, holdSessionId: null });   // Round 3 H2: no desk hold presented
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), expect.objectContaining({ action: 'appointment.rescheduled' }));
  });
  it('maps a conflict error to APPOINTMENT_CONFLICT', async () => {
    const { s } = make(undefined, async () => { throw new Error('New time conflict with an existing appointment'); });
    const r = await s.execute(resched as any, { type: 'reschedule_appointment', appointmentId: 'appt_1', startTime: '11:15', confirm: true });
    expect(r.errorCode).toBe('APPOINTMENT_CONFLICT');
  });
  it('the REAL booking conflict (ConflictError, code APPOINTMENT_CONFLICT, the §12 sentence) maps to APPOINTMENT_CONFLICT on reschedule', async () => {
    const real = Object.assign(new Error('This time was just booked or changed on another device. The schedule has been refreshed.'), { name: 'ConflictError', code: 'APPOINTMENT_CONFLICT' });
    const { s } = make(undefined, async () => { throw real; });
    const r = await s.execute(resched as any, { type: 'reschedule_appointment', appointmentId: 'appt_1', startTime: '11:15', confirm: true });
    expect(r.errorCode).toBe('APPOINTMENT_CONFLICT');
  });
  it('requires a new start time', async () => {
    const { s } = make();
    const r = await s.execute(resched as any, { type: 'reschedule_appointment', appointmentId: 'appt_1', startTime: '  ', confirm: true });
    expect(r.ok).toBe(false);
  });
});

describe('create_appointment (spine, third action)', () => {
  const book = { tenantId: 'ten_1', branchId: 'br_1', userId: 'u_1', role: 'MANAGER', permissions: ['pos.booking.create','reception_copilot.create_appointment','reception_copilot.reschedule_appointment','reception_copilot.cancel_appointment','reception_copilot.send_message'] };
  const valid = { type: 'create_appointment' as const, customerName: 'Ann', serviceIds: ['svc1'], date: '2026-07-11', startTime: '10:00' };
  it('no write without confirmation', async () => {
    const { s, booking } = make();
    const r = await s.execute(book as any, valid);
    expect(r.errorCode).toBe('HUMAN_CONFIRMATION_REQUIRED');
    expect(booking.create).not.toHaveBeenCalled();
  });
  it('on confirm routes to BookingService.create + audits', async () => {
    const { s, booking, audit } = make();
    const r = await s.execute(book as any, { ...valid, confirm: true });
    expect(r.ok).toBe(true);
    expect(booking.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', branchId: 'br_1' }), expect.objectContaining({ customerName: 'Ann', serviceIds: ['svc1'], date: '2026-07-11', startTime: '10:00' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), expect.objectContaining({ action: 'appointment.created' }));
  });
  it('the REAL booking conflict (ConflictError, code APPOINTMENT_CONFLICT, the §12 sentence) maps to APPOINTMENT_CONFLICT on create', async () => {
    // Regression pin (Sep 30 2026): the §12 sentence has neither 'conflict' nor 'already'; word-matching mislabelled it.
    const real = () => Object.assign(new Error('This time was just booked or changed on another device. The schedule has been refreshed.'), { name: 'ConflictError', code: 'APPOINTMENT_CONFLICT' });
    const r2 = await make(undefined, undefined, async () => { throw real(); }).s.execute(book as any, { ...valid, confirm: true });
    expect(r2.errorCode).toBe('APPOINTMENT_CONFLICT');
  });

  it('a taken slot maps to APPOINTMENT_CONFLICT', async () => {
    const { s } = make(undefined, undefined, async () => { throw new Error('slot already booked'); });
    const r = await s.execute(book as any, { ...valid, confirm: true });
    expect(r.errorCode).toBe('APPOINTMENT_CONFLICT');
  });
  it('requires customer, service, date, time', async () => {
    const { s } = make();
    expect((await s.execute(book as any, { ...valid, customerName: '', confirm: true })).ok).toBe(false);
    expect((await s.execute(book as any, { ...valid, serviceIds: [], confirm: true })).ok).toBe(false);
  });
});

describe('send_message (Twilio-backed, via NotificationsService)', () => {
  const msgCtx = { tenantId: 'ten_1', branchId: 'br_1', userId: 'u_1', role: 'RECEPTION', permissions: ['reception_copilot.create_appointment','reception_copilot.reschedule_appointment','reception_copilot.cancel_appointment','reception_copilot.send_message'] };
  const msg = { type: 'send_message' as const, to: '+18565551234', body: 'See you at 2pm!' };
  it('no send without confirmation', async () => {
    const { s, notifications } = make();
    const r = await s.execute(msgCtx as any, msg);
    expect(r.errorCode).toBe('HUMAN_CONFIRMATION_REQUIRED');
    expect(notifications.send).not.toHaveBeenCalled();
  });
  it('on confirm routes through NotificationsService (Twilio path) + audits', async () => {
    const { s, notifications, audit } = make();
    const r = await s.execute(msgCtx as any, { ...msg, confirm: true });
    expect(r.ok).toBe(true);
    expect(notifications.send).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), expect.objectContaining({ channel: 'sms', to: '+18565551234' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), expect.objectContaining({ action: 'message.sent' }));
  });
  it('flags degraded when the mock sender answered (no real Twilio configured)', async () => {
    const { s } = make(undefined, undefined, undefined, async () => ({ sent: true, status: 'sent', id: 'n', providerId: 'SM-MOCK-1' }));
    const r = await s.execute(msgCtx as any, { ...msg, confirm: true });
    expect((r.result as any).degraded).toBe(true);
  });
  it('maps opt-out and over-limit to honest error codes', async () => {
    const optOut = make(undefined, undefined, undefined, async () => ({ sent: false, status: 'blocked', reason: 'opted_out' }));
    expect((await optOut.s.execute(msgCtx as any, { ...msg, confirm: true })).errorCode).toBe('MESSAGE_OPTED_OUT');
    const overLimit = make(undefined, undefined, undefined, async () => ({ sent: false, status: 'blocked', reason: 'over_limit' }));
    expect((await overLimit.s.execute(msgCtx as any, { ...msg, confirm: true })).errorCode).toBe('NO_MESSAGE_CREDITS');
  });
  it('requires recipient and body', async () => {
    const { s } = make();
    expect((await s.execute(msgCtx as any, { type: 'send_message', to: '', body: 'x', confirm: true })).ok).toBe(false);
    expect((await s.execute(msgCtx as any, { type: 'send_message', to: '+1', body: '  ', confirm: true })).ok).toBe(false);
  });
});

describe('settings gate (spec §47)', () => {
  const book = { tenantId: 'ten_1', branchId: 'br_1', userId: 'u_1', role: 'MANAGER', permissions: ['pos.booking.cancel','reception_copilot.create_appointment','reception_copilot.reschedule_appointment','reception_copilot.cancel_appointment','reception_copilot.send_message'] };
  function withGate(gate: any) {
    const booking = { cancel: vi.fn(async () => ({})), reschedule: vi.fn(async () => ({})), create: vi.fn(async () => ({ appointmentId: 'a' })) };
    const audit = { record: vi.fn(async () => ({})) };
    const settings = { get: vi.fn(async () => gate) };
    return { s: new ReceptionCopilotActionService(booking as any, audit as any, undefined, undefined, settings as any), booking };
  }
  const full = { enabled: true, actionsEnabled: true, allowCreate: true, allowReschedule: true, allowCancel: true, allowSendMessage: true };
  it('master switch off → ACTION_DISABLED, no domain call', async () => {
    const { s, booking } = withGate({ ...full, enabled: false });
    const r = await s.execute(book as any, { type: 'cancel_appointment', appointmentId: 'a', reason: 'x', confirm: true });
    expect(r.errorCode).toBe('ACTION_DISABLED');
    expect(booking.cancel).not.toHaveBeenCalled();
  });
  it('a per-action toggle off blocks just that action', async () => {
    const { s, booking } = withGate({ ...full, allowCancel: false });
    const r = await s.execute(book as any, { type: 'cancel_appointment', appointmentId: 'a', reason: 'x', confirm: true });
    expect(r.errorCode).toBe('ACTION_DISABLED');
    expect(booking.cancel).not.toHaveBeenCalled();
  });
  it('all enabled → the action runs', async () => {
    const { s, booking } = withGate(full);
    const r = await s.execute(book as any, { type: 'cancel_appointment', appointmentId: 'a', reason: 'x', confirm: true });
    expect(r.ok).toBe(true);
    expect(booking.cancel).toHaveBeenCalled();
  });
});

describe('idempotency (spec §28)', () => {
  const book = { tenantId: 'ten_1', branchId: 'br_1', userId: 'u_1', role: 'MANAGER', permissions: ['pos.booking.create','reception_copilot.create_appointment','reception_copilot.reschedule_appointment','reception_copilot.cancel_appointment','reception_copilot.send_message'] };
  function withLedger() {
    const booking = { cancel: vi.fn(async () => ({})), reschedule: vi.fn(async () => ({})), create: vi.fn(async () => ({ appointmentId: 'appt_new' })) };
    const audit = { record: vi.fn(async () => ({})) };
    const ledger = new InMemoryActionLedgerRepo();
    return { s: new ReceptionCopilotActionService(booking as any, audit as any, ledger), booking };
  }
  it('a repeated idempotency key replays the outcome without executing twice', async () => {
    const { s, booking } = withLedger();
    const action = { type: 'create_appointment' as const, customerName: 'Ann', serviceIds: ['svc1'], date: '2026-07-11', startTime: '10:00', confirm: true, idempotencyKey: 'k1' };
    const first = await s.execute(book as any, action);
    const second = await s.execute(book as any, action);
    expect(first.ok).toBe(true);
    expect(booking.create).toHaveBeenCalledTimes(1);                 // NOT booked twice
    expect((second.result as any).duplicate).toBe(true);
  });
  it('different keys each execute', async () => {
    const { s, booking } = withLedger();
    const base = { type: 'create_appointment' as const, customerName: 'Ann', serviceIds: ['svc1'], date: '2026-07-11', startTime: '10:00', confirm: true };
    await s.execute(book as any, { ...base, idempotencyKey: 'a' });
    await s.execute(book as any, { ...base, idempotencyKey: 'b' });
    expect(booking.create).toHaveBeenCalledTimes(2);
  });
});

describe('shared conversion emission (front-desk → ai_booking funnel)', () => {
  const booking = { cancel: vi.fn(async () => ({ appointmentId: 'appt_1', status: 'cancelled' })), reschedule: vi.fn(), create: vi.fn(async () => ({ appointmentId: 'appt_new', status: 'booked' })) };
  it('emits FRONT_DESK_POS BOOKING_SUCCEEDED on a confirmed create', async () => {
    const emitter = { emit: vi.fn(async () => undefined) };
    const s = new ReceptionCopilotActionService(booking as any, { record: vi.fn() } as any, undefined, undefined, undefined, emitter as any);
    await s.execute(ctx as any, { type: 'create_appointment', confirm: true, customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00' } as any);
    expect(emitter.emit).toHaveBeenCalledWith(expect.objectContaining({ source: 'FRONT_DESK_POS', stage: 'BOOKING_SUCCEEDED', tenantId: 'ten_1' }));
  });
  it('emits BOOKING_FAILED with the error code when the engine rejects', async () => {
    const emitter = { emit: vi.fn(async () => undefined) };
    const failBooking = { create: vi.fn(async () => { const e: any = new Error('conflict'); e.name = 'ConflictError'; throw e; }), cancel: vi.fn(), reschedule: vi.fn() };
    const s = new ReceptionCopilotActionService(failBooking as any, { record: vi.fn() } as any, undefined, undefined, undefined, emitter as any);
    await s.execute(ctx as any, { type: 'create_appointment', confirm: true, customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00' } as any);
    expect(emitter.emit).toHaveBeenCalledWith(expect.objectContaining({ source: 'FRONT_DESK_POS', stage: 'BOOKING_FAILED', outcome: 'failed' }));
  });
  it('does NOT emit for non-booking actions (send_message)', async () => {
    const emitter = { emit: vi.fn(async () => undefined) };
    const notifications = { sendToCustomerPhone: vi.fn(async () => ({ sent: true, status: 'sent', id: 'n1', providerId: 'SM1' })) };
    const s = new ReceptionCopilotActionService(booking as any, { record: vi.fn() } as any, undefined, notifications as any, undefined, emitter as any);
    await s.execute(ctx as any, { type: 'send_message', confirm: true, to: '+18565551234', body: 'hi' } as any).catch(() => undefined);
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('Copilot permission matrix (§45)', () => {
  it('denies a booking action when the receptionist lacks the reception_copilot permission', async () => {
    const booking = { create: vi.fn(async () => ({ appointmentId: 'a1' })) };
    const svc = new ReceptionCopilotActionService(booking as any, { record: vi.fn() } as any);
    // has the domain perm but NOT the copilot perm
    const noCopilot = { tenantId: 'ten_1', branchId: 'br_1', userId: 'u1', role: 'RECEPTION', permissions: ['pos.booking.create'] };
    const r = await svc.execute(noCopilot as any, { type: 'create_appointment', confirm: true, customerName: 'A', serviceIds: ['s1'], date: '2026-07-11', startTime: '11:00' } as any);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PERMISSION_DENIED');
    expect(booking.create).not.toHaveBeenCalled();
  });
});
