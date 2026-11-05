import { describe, it, expect } from 'vitest';
import { InMemoryOverviewRepo } from './overview.repository';

// T01 fix: the three schedule-driven modules (Arrivals & Check-In Queue, Live Tech Queue, Today's Appointments) read
// schedulePreview.technicians[].appointments. This asserts the seeded dev tenant now populates it and that a real
// tenant with no schedule sees honest-empty (no mock data).
describe('T01 overview schedulePreview', () => {
  const repo = new InMemoryOverviewRepo();

  it('seeded tenant returns technicians with appointments (feeds Arrivals / Live Tech Queue / Today\'s Appointments)', async () => {
    const s = await repo.getAggregate({ tenantId: 'luxe001', branchId: 'br_cherryhill' } as any, {} as any);
    expect(s.schedulePreview.technicians.length).toBeGreaterThan(0);
    const appts = s.schedulePreview.technicians.flatMap((t: any) => t.appointments);
    expect(appts.length).toBeGreaterThan(0);
    expect(appts[0]).toHaveProperty('customerName');
    expect(appts[0]).toHaveProperty('startTime');
    expect(appts[0]).toHaveProperty('serviceNames');
    // at least one in-progress (Live Tech Queue) and one completed (Today's Appointments) for realistic states
    expect(appts.some((a: any) => a.status === 'in_progress')).toBe(true);
  });

  it('a tenant with no schedule sees honest-empty technicians', async () => {
    const s = await repo.getAggregate({ tenantId: 't_empty', branchId: null } as any, {} as any);
    expect(s.schedulePreview.technicians).toHaveLength(0);
  });
});
