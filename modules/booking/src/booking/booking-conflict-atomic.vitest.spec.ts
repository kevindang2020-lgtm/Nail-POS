import { describe, it, expect } from 'vitest';
import { InMemoryBookingRepository, type BkItem, type BookingContext } from './booking.repository';
import { BookingConflictRace } from './booking.dto';

// The repository's create is the atomic guard: it re-checks the technician conflict (against the committed/current set)
// and rejects an overlap unless skipConflict is set (the salon allows overbooking, or a manager overrode). On Postgres
// this re-check runs inside a transaction under a per-(tenant,tech,date) advisory lock; the in-memory repo mirrors the
// same decision so the behavior is unit-testable without a database (the lock/serialization itself is proven live).
const ctx: BookingContext = { tenantId: 'luxe001', branchId: '', userId: 'u1', role: 'OWNER', permissions: [] };
const item = (id: string, tech: string, start: string, end: string): BkItem => ({
  appointmentId: id, technicianId: tech, customerId: 'c1', customerName: 'Test', customerPhone: '+1', isVip: false,
  services: [{ serviceId: 'svc_mani', serviceName: 'Mani', durationMinutes: 45, priceCents: 5500 } as any],
  source: 'manual', date: '2099-01-01', startTime: start, endTime: end, status: 'booked', depositStatus: 'not_required',
  depositCents: 0, notes: '', createdAt: '', updatedAt: '',
});

describe('Booking atomic create — technician conflict re-check', () => {
  it('rejects an overlapping same-technician booking with BookingConflictRace', async () => {
    const repo = new InMemoryBookingRepository();
    await repo.create(ctx, item('a1', 'tech_test', '10:00', '10:45'));
    await expect(repo.create(ctx, item('a2', 'tech_test', '10:30', '11:00'))).rejects.toBeInstanceOf(BookingConflictRace);
  });

  it('allows the overlap when skipConflict is set (overbooking / manager override)', async () => {
    const repo = new InMemoryBookingRepository();
    await repo.create(ctx, item('a1', 'tech_test', '10:00', '10:45'));
    const row = await repo.create(ctx, item('a2', 'tech_test', '10:30', '11:00'), { skipConflict: true });
    expect(row.appointmentId).toBe('a2');
  });

  it('allows a non-overlapping booking for the same technician', async () => {
    const repo = new InMemoryBookingRepository();
    await repo.create(ctx, item('a1', 'tech_test', '10:00', '10:45'));
    const row = await repo.create(ctx, item('a3', 'tech_test', '11:00', '11:30'));
    expect(row.appointmentId).toBe('a3');
  });

  it('does not block a different technician at the same time', async () => {
    const repo = new InMemoryBookingRepository();
    await repo.create(ctx, item('a1', 'tech_test', '10:00', '10:45'));
    const row = await repo.create(ctx, item('a4', 'tech_other', '10:00', '10:45'));
    expect(row.appointmentId).toBe('a4');
  });
});
