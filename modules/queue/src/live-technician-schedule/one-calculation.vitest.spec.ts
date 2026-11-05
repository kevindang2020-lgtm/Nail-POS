// ONE-PAY F7 (Oct 13 2026): even the in-memory (no database) Live Technician Schedule never prices a technician's day
// itself — its "commission" is the compensation snapshot's figure it holds, verbatim (the old store kept a percent and
// multiplied today's sales by it).
import { describe, it, expect } from 'vitest';
import { InMemoryLiveScheduleRepository } from './live-technician-schedule.repository';

const ctx = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u', role: 'OWNER', permissions: [] } as any;

describe('live schedule (in-memory) commission = the snapshot figure it holds (ONE-PAY F7)', () => {
  it('a seeded snapshot of $33.33 on $120.00 of sales is shown as $33.33 — no rate applied', async () => {
    const repo = new InMemoryLiveScheduleRepository();
    repo.seedSnapshotDay('luxe001', 'tech_mia', { salesCents: 12000, tipsCents: 2500, commissionCents: 3333 });
    const d = await repo.detail(ctx, 'tech_mia', '');
    expect(d!.commissionPreviewCents).toBe(3333);
    expect(d!.tipsTodayCents).toBe(2500);
  });
});
