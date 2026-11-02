import { TechService, type TechDataPort, type TechContext, type TechTicketView, type TechTicketStatus } from '@aipowersalon/queue';
import { describe, it, expect, beforeEach } from 'vitest';
import { InProcessEmitter } from '../realtime/realtime.gateway';
import { rooms, EVENTS } from '@aipowersalon/realtime-contracts';

// Verifies the realtime SLICE that does NOT need a live socket: that tech-initiated actions publish the right event to
// (a) the technician's own room and (b) the tenant+branch room, and that one technician's events never land in another
// technician's room. The SSE transport itself (EventSource streaming) is validated against a running server.
const ctx: TechContext = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'TECHNICIAN' as any, permissions: [] };

function fakePort(initial: TechTicketStatus): TechDataPort {
  let status: TechTicketStatus = initial;
  const view = (): TechTicketView => ({ ticketId: 'tk1', technicianId: 'tech1', status });
  return {
    technicianAppEnabled: async () => true, listNotifications: async () => [], markNotificationsRead: async () => 0,
    resolveTechnicianId: async () => 'tech1',
    getTicket: async () => view(),
    accept: async () => { status = 'accepted'; return true; },
    start: async () => { status = 'serving'; return true; },
    complete: async () => { status = 'done'; },
    breakContext: async () => ({ status: 'available', hasActiveService: false }),
    setBreak: async (_c, _id, on) => (on ? 'on_break' : 'available'),
    // unused by these tests:
    todaySchedule: async () => [],
    dashboardRaw: async () => ({ technician: { technicianId: 'tech1', fullName: '', initials: '?', roleLabel: '', status: 'available' }, todayLines: [], bookings: 0, completed: 0, inService: 0, salesTrendPercent: 0, hasAssignedUnacceptedTicket: false, hasAcceptedNotStarted: false }),
    listTickets: async () => [], queueState: async () => ({ turnPosition: null, status: 'available', onBreak: false }),
    moreState: async () => ({ technician: { technicianId: 'tech1', fullName: '', initials: '?', roleLabel: '', status: 'available' }, workingHoursLabel: null, skillsLabel: null }),
    addNote: async () => {}, requestCancel: async () => {}, recordAudit: async () => {}, earningsTips: async () => 0, skills: async () => ({ specialties: [], services: [] }), workingHours: async () => [], requestableServices: async () => [], createSkillChangeRequest: async () => ({ id: 'r1', serviceId: 's1', serviceName: 'S', requestType: 'add' as const, note: null, status: 'pending' as const, createdAt: '', decidedAt: null }), listSkillChangeRequests: async () => [], listPendingSkillChangeRequests: async () => [], decideSkillChangeRequest: async () => ({ id: 'r1', serviceId: 's1', serviceName: 'S', requestType: 'add' as const, note: null, status: 'approved' as const, createdAt: '', decidedAt: '', technicianId: 't1', technicianName: 'T' }),
  } as unknown as TechDataPort;
}

describe('tech realtime emissions', () => {
  let bus: InProcessEmitter;
  beforeEach(() => { bus = new InProcessEmitter(); });
  const eventsFor = (room: string) => bus.log.filter((e) => e.room === room).map((e) => e.event);

  it('accept → queue_updated to the technician room AND the branch room', async () => {
    const svc = new TechService(fakePort('assigned'), bus);
    await svc.accept(ctx, 'tk1');
    expect(eventsFor(rooms.technician('tech1'))).toContain(EVENTS.queueUpdated);
    expect(eventsFor(rooms.tenantBranch('T', 'B'))).toContain(EVENTS.queueUpdated);
  });

  it('start → service_started; service-done → service_done (both rooms)', async () => {
    const startSvc = new TechService(fakePort('accepted'), bus);
    await startSvc.startService(ctx, 'tk1');
    expect(eventsFor(rooms.technician('tech1'))).toContain(EVENTS.serviceStarted);
    expect(eventsFor(rooms.tenantBranch('T', 'B'))).toContain(EVENTS.serviceStarted);

    bus = new InProcessEmitter();
    const doneSvc = new TechService(fakePort('serving'), bus);
    await doneSvc.serviceDone(ctx, 'tk1', {});
    expect(eventsFor(rooms.technician('tech1'))).toContain(EVENTS.serviceDone);
    expect(eventsFor(rooms.tenantBranch('T', 'B'))).toContain(EVENTS.serviceDone);
  });

  it('break start/stop publishes queue_updated', async () => {
    const svc = new TechService(fakePort('assigned'), bus);
    await svc.setBreakState(ctx, true);
    expect(eventsFor(rooms.technician('tech1'))).toContain(EVENTS.queueUpdated);
  });

  it('isolation: one technician’s event never lands in another technician’s room', async () => {
    let receivedByOther = 0;
    const off = bus.subscribe(rooms.technician('tech2'), () => { receivedByOther++; });
    const svc = new TechService(fakePort('assigned'), bus);
    await svc.accept(ctx, 'tk1'); // tech1 acts
    off();
    expect(receivedByOther).toBe(0);
  });

  it('no emitter wired → action still succeeds (emit is a no-op)', async () => {
    const svc = new TechService(fakePort('assigned')); // no bus
    const v = await svc.accept(ctx, 'tk1');
    expect(v.status).toBe('accepted');
  });
});
