// shift-override-projection.vitest.spec — F4 (Finish the Five, 30 Oct 2026): a saved / restored one-date shift override
// (technician.shift_override_changed, written in the save transaction) reaches Staff Schedule, Booking and Tech Queue (the
// branch room) and the Technician App (the technician's room) as technician_schedule_updated — ids, date, type, version only.
import { describe, it, expect } from 'vitest';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS } from '@aipowersalon/realtime-contracts';
import { RealtimeProjectionConsumer } from './consumers/realtime-projection.consumer';

const T = 'c9c9c9c9-0000-4000-8000-000000000001', B = 'c9c9c9c9-0000-4000-8000-000000000002', TECH = 'c9c9c9c9-0000-4000-8000-0000000000bb';

describe('technician.shift_override_changed → realtime projection', () => {
  it('fans out to the branch room and the technician room', async () => {
    const sent: any[] = [];
    const c = new RealtimeProjectionConsumer({
      toTenant: (ctx: any, ev: string, pl: any) => sent.push(['tenant', ctx.branchId, ev, pl]),
      toTechnician: (id: string, ev: string, pl: any) => sent.push(['technician', id, ev, pl]),
    } as any);
    expect(c.eventTypes).toContain(DOMAIN_EVENTS.TECHNICIAN_SHIFT_OVERRIDE_CHANGED);
    await c.handle({ eventType: DOMAIN_EVENTS.TECHNICIAN_SHIFT_OVERRIDE_CHANGED, tenantId: T, branchId: B, aggregateId: TECH, payload: { technicianId: TECH, date: '2026-11-06', overrideType: 'CUSTOM_SHIFT', version: 2, note: 'secret' } } as any);
    const payload = { technicianId: TECH, date: '2026-11-06', overrideType: 'CUSTOM_SHIFT', version: 2 };
    expect(sent.map((s) => [s[0], s[1], s[2]])).toEqual([['tenant', B, EVENTS.technicianScheduleUpdated], ['technician', TECH, EVENTS.technicianScheduleUpdated]]);
    expect(sent[0][3]).toMatchObject(payload); expect(JSON.stringify(sent)).not.toContain('secret');
  });
});
