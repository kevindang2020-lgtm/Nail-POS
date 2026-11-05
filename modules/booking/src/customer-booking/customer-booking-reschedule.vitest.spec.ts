import { PushService, InMemoryPushRepository, MockPushProvider } from '@aipowersalon/communications';
import { describe, it, expect } from 'vitest';
import { CustomerBookingService, BookingConflictError, BookingValidationError } from './customer-booking.service';
import type { CustomerBookingDataPort } from './customer-booking.repository';

const ctx = { tenantId: 'T', branchId: 'B', userId: 'U' } as any;
const base = {
  resolveCustomerId: async () => ({ id: 'c1', fullName: 'Casey' }),
  getAppointmentForReschedule: async () => ({ technicianId: 't1', durationMinutes: 60, status: 'confirmed' }),
  existingForDate: async () => [],
  rescheduleAtomic: async () => ({ ok: true }),
};
const make = (over: Record<string, any> = {}) => new CustomerBookingService({ ...base, ...over } as unknown as CustomerBookingDataPort);

describe('CustomerBookingService.reschedule', () => {
  it('moves an appointment and auto-computes the end time', async () => {
    const r = await make().reschedule(ctx, 'ap1', { date: '2999-01-01', startTime: '12:00' });
    expect(r).toMatchObject({ appointmentId: 'ap1', date: '2999-01-01', startTime: '12:00', endTime: '13:00' });
  });
  it('rejects a malformed time', async () => {
    await expect(make().reschedule(ctx, 'ap1', { date: '2999-01-01', startTime: '99:99' })).rejects.toBeInstanceOf(BookingValidationError);
  });
  it('rejects a past date', async () => {
    await expect(make().reschedule(ctx, 'ap1', { date: '2000-01-01', startTime: '12:00' })).rejects.toBeInstanceOf(BookingValidationError);
  });
  it('rejects an unknown appointment', async () => {
    await expect(make({ getAppointmentForReschedule: async () => null }).reschedule(ctx, 'ap1', { date: '2999-01-01', startTime: '12:00' })).rejects.toBeInstanceOf(BookingValidationError);
  });
  it('surfaces a conflict from the atomic re-check as a conflict error', async () => {
    await expect(make({ rescheduleAtomic: async () => ({ ok: false, conflictingAppointmentId: 'b2' }) }).reschedule(ctx, 'ap1', { date: '2999-01-01', startTime: '12:00' })).rejects.toBeInstanceOf(BookingConflictError);
  });
});


describe('CustomerBookingService — push notifications', () => {
  const bookBase = {
    ...base,
    getService: async () => ({ id: 's1', name: 'Gel Mani', durationMinutes: 30, priceCents: 5000 }),
    getTechnician: async () => ({ id: 't1', fullName: 'Tay' }),
    insertBookingAtomic: async () => ({ ok: true, id: 'appt-1' }),
  };
  const withPush = (push: PushService, over: Record<string, any> = {}) =>
    new CustomerBookingService({ ...bookBase, ...over } as unknown as CustomerBookingDataPort, push);

  it('pushes a confirmation to the customer when a booking succeeds', async () => {
    const repo = new InMemoryPushRepository();
    const push = new PushService(repo, new MockPushProvider());
    await push.register({ tenantId: 'T', userId: 'U' }, 'ios', 'cust-device-token-1');
    const svc = withPush(push);
    const r = await svc.book(ctx, { serviceId: 's1', technicianId: 't1', date: '2999-01-01', startTime: '12:00' } as any);
    expect(r.appointmentId).toBe('appt-1');
    expect(repo.logs.length).toBe(1);
    expect(repo.logs[0].channel).toBe('push');
    expect(repo.logs[0].template).toBe('appt-1'); // reference = appointment id
    expect(repo.logs[0].status).toBe('sent');
  });

  it('pushes on a successful reschedule', async () => {
    const repo = new InMemoryPushRepository();
    const push = new PushService(repo, new MockPushProvider());
    await push.register({ tenantId: 'T', userId: 'U' }, 'android', 'cust-device-token-2');
    const svc = new CustomerBookingService({ ...base } as unknown as CustomerBookingDataPort, push);
    await svc.reschedule(ctx, 'appt-1', { date: '2999-01-01', startTime: '13:30' } as any);
    expect(repo.logs.length).toBe(1);
    expect(repo.logs[0].template).toBe('appt-1');
    expect(repo.logs[0].status).toBe('sent');
  });

  it('books fine with no push service and no device (no throw, nothing sent)', async () => {
    const repo = new InMemoryPushRepository();
    const push = new PushService(repo, new MockPushProvider()); // no device registered
    const svc = withPush(push);
    const r = await svc.book(ctx, { serviceId: 's1', technicianId: 't1', date: '2999-01-01', startTime: '12:00' } as any);
    expect(r.appointmentId).toBe('appt-1');
    expect(repo.logs.length).toBe(0);
  });

  it('threads the Book-This-Look inspiration note + photo id into the appointment (sanitized)', async () => {
    let captured: any = null;
    const push = new PushService(new InMemoryPushRepository(), new MockPushProvider());
    const svc = withPush(push, { insertBookingAtomic: async (input: any) => { captured = input; return { ok: true, id: 'appt-9' }; } });
    await svc.book(ctx, { serviceId: 's1', technicianId: 't1', date: '2999-01-01', startTime: '12:00', inspirationNote: '  Wants this look: "Chrome French"\n\n  ', inspirationPhotoId: 'photo-42' } as any);
    expect(captured.notes).toBe('Wants this look: "Chrome French"');   // control chars collapsed + trimmed
    expect(captured.inspirationPhotoId).toBe('photo-42');
  });

  it('stores no note/photo when the booking carries no inspiration', async () => {
    let captured: any = null;
    const push = new PushService(new InMemoryPushRepository(), new MockPushProvider());
    const svc = withPush(push, { insertBookingAtomic: async (input: any) => { captured = input; return { ok: true, id: 'appt-0' }; } });
    await svc.book(ctx, { serviceId: 's1', technicianId: 't1', date: '2999-01-01', startTime: '12:00' } as any);
    expect(captured.notes).toBeNull();
    expect(captured.inspirationPhotoId).toBeNull();
  });
});
