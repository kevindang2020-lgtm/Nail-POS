// booking-realtime.vitest.spec.ts — §3 BOOKING triggers publish targeted, minimal, PII-free events (Jul 27, 2026).
import { describe, it, expect } from 'vitest';
import { BookingService } from './booking.service';
import { InMemoryBookingRepository } from './booking.repository';
import { payloadViolations } from '@aipowersalon/realtime-contracts';

// The in-memory repo pre-seeds its service catalog for the demo tenant — use it, like booking-core.spec does.
const ctx = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u1', role: 'OWNER', permissions: ['pos.booking.view', 'pos.booking.create', 'pos.booking.edit', 'pos.booking.reschedule', 'pos.booking.cancel'] } as any;

function harness() {
  const emitted: { room: { tenantId: string; branchId: string }; event: string; payload: any }[] = [];
  const emitter = { toTenant: (room: any, event: string, payload: any) => emitted.push({ room, event, payload }) } as any;
  const svc = new BookingService(new InMemoryBookingRepository() as any, undefined, undefined, undefined, emitter);
  return { svc, emitted };
}

describe('booking → realtime', () => {
  it('create publishes appointment_created to the tenant+branch room with an id-only envelope', async () => {
    const { svc, emitted } = harness();
    const row = await svc.create(ctx, { customerName: 'Walk In', date: '2026-07-28', startTime: '10:00', serviceIds: ['svc_mani'] } as any);
    const e = emitted.find((x) => x.event === 'appointment_created')!;
    expect(e).toBeTruthy();
    expect(e.room).toEqual({ tenantId: 'luxe001', branchId: 'br_cherryhill' });
    expect(e.payload.resourceType).toBe('appointment');
    expect(e.payload.resourceId).toBe(row.appointmentId);
    expect(e.payload.eventId).toBeTruthy();
    expect(e.payload.updatedAt).toMatch(/^\d{4}-/);
    // §12: no customer name/phone in the event — the envelope + data must be clean.
    expect(payloadViolations(e.payload.data)).toEqual([]);
    expect(JSON.stringify(e.payload)).not.toContain('Walk In');
  });

  it('update and cancel publish appointment_updated / appointment_cancelled', async () => {
    const { svc, emitted } = harness();
    const row = await svc.create(ctx, { customerName: 'A B', date: '2026-07-28', startTime: '11:00', serviceIds: ['svc_mani'] } as any);
    emitted.length = 0;
    await svc.update(ctx, row.appointmentId, { notes: 'bring polish' } as any);
    await svc.cancel(ctx, row.appointmentId, { reason: 'sick' } as any);
    expect(emitted.map((e) => e.event)).toEqual(['appointment_updated', 'appointment_cancelled']);
    expect(JSON.stringify(emitted)).not.toContain('bring polish');   // notes never ride events
  });

  it('a broken realtime bus never fails the booking itself', async () => {
    const svc = new BookingService(new InMemoryBookingRepository() as any, undefined, undefined, undefined,
      { toTenant: () => { throw new Error('bus down'); } } as any);
    const row = await svc.create(ctx, { customerName: 'C D', date: '2026-07-28', startTime: '12:00', serviceIds: ['svc_mani'] } as any);
    expect(row.appointmentId).toBeTruthy();
  });
});
