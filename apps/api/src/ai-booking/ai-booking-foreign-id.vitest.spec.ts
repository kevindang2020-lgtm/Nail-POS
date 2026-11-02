// ai-booking-foreign-id — BUILD_PLAN Phase 14 live IDOR run (scripts/live-phase14-idor.mjs): salon B asking for salon
// A's appointment through GET /api/ai-booking/v1/appointments/:appointmentId got a 500. BookingService refused it
// correctly (tenant-filtered → "Booking not found"), but the AI booking controller passed the domain error through
// unmapped. Another salon's id must be a 404, never a crash.
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ValidationError } from '@aipowersalon/booking';
import { AiBookingController } from './ai-booking.controller';

describe('GET /api/ai-booking/v1/appointments/:appointmentId with another salon\'s appointment id', () => {
  it('answers 404, not a 500', async () => {
    const svc: any = { getAppointment: async () => { throw new ValidationError('Booking not found'); } };
    const c = new AiBookingController(svc, {} as any, {} as any);
    const req = { ctx: { tenantId: 'tenant-b', branchId: 'branch-b', userId: 'u', role: 'OWNER', permissions: [] }, query: {} };
    const err = await Promise.resolve().then(() => c.getAppointment(req, 'salon-a-appointment')).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(404);
  });
  it('any other failure still propagates unchanged (only "not found" is mapped)', async () => {
    const boom = new Error('db down');
    const svc: any = { getAppointment: async () => { throw boom; } };
    const c = new AiBookingController(svc, {} as any, {} as any);
    const err = await Promise.resolve().then(() => c.getAppointment({ ctx: { tenantId: 't', branchId: 'b', userId: 'u', role: 'OWNER', permissions: [] }, query: {} }, 'x')).catch((e) => e);
    expect(err).toBe(boom);
  });
});
