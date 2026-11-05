// customer-booking-skills-guard.vitest.spec.ts — mandate §51/§78: customer booking enforces exact service eligibility.
import { describe, it, expect } from 'vitest';
import { CustomerBookingService, BookingValidationError } from './customer-booking.service';
import { InMemoryCustomerBookingRepository, type CustomerBookingContext } from './customer-booking.repository';

const ctx: CustomerBookingContext = { tenantId: 't1', branchId: 'b1', userId: 'u1' };

class SkillsTestRepo extends InMemoryCustomerBookingRepository {
  override async salonAcceptsBookings() { return true; }
  override async branchBelongsToTenant() { return true; }
  override async resolveCustomerId() { return { id: 'cust1', fullName: 'Jane Doe' }; }
  override async getService(_c: any, sid: string) {
    return { id: sid, name: 'Specialty Lash', durationMinutes: 60, priceCents: 8000 };
  }
  override async getTechnician(_c: any, tid: string) {
    return { id: tid, fullName: 'Tech One', branchId: 'b1' };
  }
  override async listTechnicians() {
    return [{ id: 'tech1', fullName: 'Tech One' }, { id: 'tech2', fullName: 'Tech Two' }];
  }
  override async technicianWindows() {
    return [{ start: 9 * 60, end: 18 * 60 }];
  }
  override async existingForDate() { return []; }
  override async isTechnicianEligibleForServices(_c: any, tid: string, sids: string[]) {
    // Only tech1 is certified for lash; tech2 is not
    if (tid === 'tech1' && sids.includes('svc_lash')) return true;
    return false;
  }
}

describe('Mandate §51/§78 Customer booking skills guard', () => {
  const repo = new SkillsTestRepo();
  const svc = new CustomerBookingService(repo as any);

  it('availability rejects a technician not certified for the requested service', async () => {
    await expect(
      svc.availability(ctx, { serviceId: 'svc_lash', date: '2026-11-01', technicianId: 'tech2' }),
    ).rejects.toThrow(BookingValidationError);
  });

  it('availability filters out uncertified technicians when listing all technicians', async () => {
    const res = await svc.availability(ctx, { serviceId: 'svc_lash', date: '2026-11-01' });
    const allTechs = new Set(res.slots.flatMap((s) => s.technicianIds));
    expect(allTechs.has('tech1')).toBe(true);
    expect(allTechs.has('tech2')).toBe(false);
  });

  it('book() rejects booking with a technician who is not eligible for the service', async () => {
    await expect(
      svc.book(ctx, {
        serviceId: 'svc_lash',
        technicianId: 'tech2',
        date: '2026-11-01',
        startTime: '10:00',
        customerName: 'Jane Doe',
        customerPhone: '+18565550123',
      }),
    ).rejects.toThrow(BookingValidationError);
  });
});
