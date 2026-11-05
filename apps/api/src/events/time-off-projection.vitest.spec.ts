// time-off-projection.vitest.spec — merge Oct 12 2026 (BK): technician.time_off_changed reaches the screens ONLY through the
// realtime projection (the time-off service never emits realtime itself): technician_schedule_updated in the branch room
// and in the technician's own room, ids + status only (no reason / note / dates cross).
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

const T = 'c8c8c8c8-0000-4000-8000-000000000001', B = 'c8c8c8c8-0000-4000-8000-000000000002', R = 'c8c8c8c8-0000-4000-8000-0000000000aa', TECH = 'c8c8c8c8-0000-4000-8000-0000000000bb';

describe('technician.time_off_changed → realtime projection', () => {
  it('is subscribed, and fans out to the branch room + the technician room with ids + status only', async () => {
    const sent: any[] = [];
    const c = new RealtimeProjectionConsumer({
      toTenant: (ctx: any, ev: string, pl: any) => sent.push(['tenant', ctx.branchId, ev, pl]),
      toTechnician: (id: string, ev: string, pl: any) => sent.push(['technician', id, ev, pl]),
    } as any);
    expect(c.eventTypes).toContain(DOMAIN_EVENTS.TECHNICIAN_TIME_OFF_CHANGED);
    await c.handle({ eventType: DOMAIN_EVENTS.TECHNICIAN_TIME_OFF_CHANGED, tenantId: T, branchId: B, aggregateId: R, payload: { technicianId: TECH, timeOffId: R, status: 'approved', action: 'approved', reason: 'secret', note: 'x' } } as any);
    const payload = { technicianId: TECH, timeOffId: R, status: 'approved' };
    expect(sent).toEqual([['tenant', B, EVENTS.technicianScheduleUpdated, payload], ['technician', TECH, EVENTS.technicianScheduleUpdated, payload]]);
  });
});
