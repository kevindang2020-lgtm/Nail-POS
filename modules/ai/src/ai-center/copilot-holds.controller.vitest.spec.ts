// copilot-holds.controller.vitest.spec.ts — Round 2 H (Oct 12 2026): the HTTP side of the Reception Copilot's holds.
// Permission decision: holding / releasing is a WRITE behind the booking-desk key `pos.booking.create` (no new key) —
// on the hold routes' decorators, and on `copilot/availability` when the body asks for `hold: true` (403 without it,
// never silently ignored). Reading availability stays behind the read key. Scope comes from the session, not the body.
import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { AiCenterController } from './ai-center.controller';

const perm = (h: string) => Reflect.getMetadata('perm', (AiCenterController.prototype as any)[h]);
const session = (permissions: string[]) => ({ ctx: { tenantId: 'ten_1', branchId: 'br_1', userId: 'u_1', role: 'FRONT_DESK', permissions } });
function make() {
  const copilot = {
    recommendAvailability: vi.fn(async () => ({ available: true, date: '2030-11-04', recommendations: [], byTechnician: [] })),
    holdSlot: vi.fn(async () => ({ held: true, holdToken: 'bs~x~y' })),
    releaseHold: vi.fn(async () => ({ released: true })),
  };
  const c = new AiCenterController({} as any, {} as any, copilot as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { c, copilot };
}

describe('Reception Copilot hold routes', () => {
  it('hold + release are behind pos.booking.create; reading availability stays a read', () => {
    expect(perm('copilotHold')).toBe('pos.booking.create');
    expect(perm('copilotHoldRelease')).toBe('pos.booking.create');
    expect(perm('copilotAvailability')).toBe('reception_copilot.view_recommendations');
  });

  it('availability {hold:true} without pos.booking.create → 403 and nothing is held; with it → the hold is passed through', async () => {
    const { c, copilot } = make();
    let err: any = null;
    try { c.copilotAvailability(session(['reception_copilot.view_recommendations']), { date: '2030-11-04', serviceIds: ['s1'], hold: true }); } catch (e) { err = e; }
    expect(err?.getStatus?.()).toBe(403);
    expect(copilot.recommendAvailability).not.toHaveBeenCalled();
    await c.copilotAvailability(session(['reception_copilot.view_recommendations']), { date: '2030-11-04' });
    expect((copilot.recommendAvailability.mock.calls[0] as any)[1]).toMatchObject({ hold: null });
    await c.copilotAvailability(session(['reception_copilot.view_recommendations', 'pos.booking.create']), { date: '2030-11-04', serviceIds: ['s1'], hold: true });
    expect((copilot.recommendAvailability.mock.calls[1] as any)[1]).toMatchObject({ date: '2030-11-04', serviceIds: ['s1'], hold: {} });
  });

  it('hold / release pass the slot and the token through with the SESSION scope (a body tenant is ignored)', async () => {
    const { c, copilot } = make();
    await c.copilotHold(session(['pos.booking.create']), { date: '2030-11-04', startTime: '10:00', serviceIds: ['s1'], technicianId: 't1', tenantId: 'evil' });
    expect(copilot.holdSlot).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1', userId: 'u_1' }), { date: '2030-11-04', startTime: '10:00', serviceIds: ['s1'], technicianId: 't1', customerId: null, holdToken: null });
    await c.copilotHoldRelease(session(['pos.booking.create']), { holdToken: 'bs~x~y' });
    expect(copilot.releaseHold).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_1' }), { holdToken: 'bs~x~y' });
  });
});
