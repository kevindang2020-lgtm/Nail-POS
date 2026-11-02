import { describe, it, expect, beforeEach } from 'vitest';
import { TechService, TechError } from './tech.service';
import type { TechContext, TechDataPort, TechTicketView, TechDashboardRaw } from './tech.repository';
import type { TechnicianStatus, LineSnapshot } from './tech-dashboard.dto';

const ctx: TechContext = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'TECHNICIAN', permissions: [] };
const started = '2026-06-07T05:00:00.000Z';

class FakePort implements TechDataPort {
  technicianAppFlag = true;
  async technicianAppEnabled() { return this.technicianAppFlag; }
  async listNotifications() { return []; }
  async markNotificationsRead() { return 0; }
  technicianId: string | null = 'tech1';
  tickets = new Map<string, TechTicketView>();
  status: TechnicianStatus = 'available';
  hasActiveService = false;
  lines: LineSnapshot[] = [{ lineTotalCents: 4000, commissionType: 'percent', commissionValue: 50, tipCents: 600 }];
  calls: string[] = [];

  async resolveTechnicianId() { return this.technicianId; }
  async myPayroll() { return { paidCents: 12000, unpaidCents: 3400, totalCents: 15400, periods: [] }; }
  async dashboardRaw(_c: TechContext, technicianId: string): Promise<TechDashboardRaw> {
    return {
      technician: { technicianId, fullName: 'Ana Lopez', initials: 'AL', roleLabel: 'Tech', status: this.status },
      todayLines: this.lines, bookings: 3, completed: 1, inService: this.hasActiveService ? 1 : 0, salesTrendPercent: 5,
      currentService: this.hasActiveService ? { ticketId: 'k1', queueItemId: 'q1', serviceLineId: 'l1', customerId: 'c1', customerName: 'Joe Lee', serviceName: 'Mani', startedAt: started, status: 'serving' } : undefined,
      hasAssignedUnacceptedTicket: [...this.tickets.values()].some((t) => t.technicianId === technicianId && t.status === 'assigned'),
      hasAcceptedNotStarted: [...this.tickets.values()].some((t) => t.technicianId === technicianId && t.status === 'accepted'),
    };
  }
  async getTicket(_c: TechContext, id: string) { return this.tickets.get(id) ?? null; }
  async accept(_c: TechContext, id: string, expectedVersion?: number) { const t = this.tickets.get(id)!; if (typeof expectedVersion === 'number' && (t.version ?? 0) !== expectedVersion) return false; this.calls.push('accept:' + id); t.status = 'accepted'; t.version = (t.version ?? 0) + 1; return true; }
  async decline(_c: TechContext, id: string, body: { reason: string }) { this.calls.push('decline:' + id + ':' + body.reason); const t = this.tickets.get(id)!; t.status = 'cancelled'; }
  async start(_c: TechContext, id: string) { this.calls.push('start:' + id); const t = this.tickets.get(id)!; t.status = 'serving'; return true; }
  async pause(_c: TechContext, id: string) { this.calls.push('pause:' + id); const t = this.tickets.get(id)!; t.status = 'paused'; }
  async resume(_c: TechContext, id: string) { this.calls.push('resume:' + id); const t = this.tickets.get(id)!; t.status = 'serving'; }
  async complete(_c: TechContext, id: string) { this.calls.push('complete:' + id); const t = this.tickets.get(id)!; t.status = 'done'; }
  async recordAudit() { this.calls.push('audit'); }
  async earningsTips() { return 600; }
  async skills() { return { specialties: [], services: [] }; }
  async workingHours() { return []; }
  async requestableServices() { return []; }
  async createSkillChangeRequest() { return { id: 'r1', serviceId: 's1', serviceName: 'S', requestType: 'add' as const, note: null, status: 'pending' as const, createdAt: '', decidedAt: null }; }
  async listSkillChangeRequests() { return []; }
  async listPendingSkillChangeRequests() { return []; }
  async decideSkillChangeRequest() { return { id: 'r1', serviceId: 's1', serviceName: 'S', requestType: 'add' as const, note: null, status: 'approved' as const, createdAt: '', decidedAt: '', technicianId: 't1', technicianName: 'T' }; } // per-tech tips now come from here (proportional/explicit), not line snapshots
  async breakContext() { return { status: this.status, hasActiveService: this.hasActiveService }; }
  async setBreak(_c: TechContext, _id: string, on: boolean) { this.calls.push('setBreak:' + on); this.status = on ? 'on_break' : 'available'; return this.status; }
}

let port: FakePort; let svc: TechService;
beforeEach(() => { port = new FakePort(); svc = new TechService(port); });

describe('TechService authorization', () => {
  it('throws not_technician when no technician profile is linked', async () => {
    port.technicianId = null;
    await expect(svc.getDashboard(ctx)).rejects.toMatchObject({ code: 'not_technician' });
  });

  it('forbids acting on a ticket owned by another technician', async () => {
    port.tickets.set('k9', { ticketId: 'k9', technicianId: 'someone-else', status: 'assigned' });
    await expect(svc.accept(ctx, 'k9')).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.calls).toEqual([]);
  });

  it('404s on a missing ticket', async () => {
    await expect(svc.startService(ctx, 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('TechService state guards + transitions', () => {
  it('accept only from assigned, then accepted', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'assigned' });
    const t = await svc.accept(ctx, 'k1');
    expect(t.status).toBe('accepted');
    expect(port.calls).toContain('accept:k1');
    await expect(svc.accept(ctx, 'k1')).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('rejects a stale-version accept as a conflict (§13 optimistic concurrency)', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'assigned', version: 3 });
    // someone else already advanced the row to version 3; the client still holds version 2
    await expect(svc.accept(ctx, 'k1', 2)).rejects.toMatchObject({ code: 'conflict' });
    expect((port.tickets.get('k1'))!.status).toBe('assigned'); // unchanged
    // the up-to-date version succeeds and bumps
    expect((await svc.accept(ctx, 'k1', 3)).status).toBe('accepted');
  });

  it('decline from assigned with a reason → cancelled + audited', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'assigned' });
    const r = await svc.decline(ctx, 'k1', { reason: 'Running late' });
    expect(r).toEqual({ ok: true });
    expect(port.calls).toContain('decline:k1:Running late');
    expect(port.calls).toContain('audit');
    // a second decline must fail: the offer is no longer pending (no double-decline / late-decline)
    await expect(svc.decline(ctx, 'k1', { reason: 'again' })).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('decline requires a reason', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'assigned' });
    await expect(svc.decline(ctx, 'k1', { reason: '   ' })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(port.calls).not.toContain('decline:k1:   ');
  });

  it('decline only from a pending offer (not an accepted ticket)', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'accepted' });
    await expect(svc.decline(ctx, 'k1', { reason: 'too late' })).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('cannot decline another technician’s ticket', async () => {
    port.tickets.set('k9', { ticketId: 'k9', technicianId: 'someone-else', status: 'assigned' });
    await expect(svc.decline(ctx, 'k9', { reason: 'nope' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.calls).toEqual([]);
  });

  it('pause from serving → paused, resume from paused → serving', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'serving' });
    expect((await svc.pauseService(ctx, 'k1')).status).toBe('paused');
    expect(port.calls).toContain('pause:k1');
    expect((await svc.resumeService(ctx, 'k1')).status).toBe('serving');
    expect(port.calls).toContain('resume:k1');
  });

  it('cannot pause a ticket that is not in service', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'accepted' });
    await expect(svc.pauseService(ctx, 'k1')).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('cannot resume a ticket that is not paused', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'serving' });
    await expect(svc.resumeService(ctx, 'k1')).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('cannot pause another technician’s ticket', async () => {
    port.tickets.set('k9', { ticketId: 'k9', technicianId: 'someone-else', status: 'serving' });
    await expect(svc.pauseService(ctx, 'k9')).rejects.toMatchObject({ code: 'forbidden' });
    expect(port.calls).toEqual([]);
  });

  it('start from accepted → serving; done from serving → done', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'accepted' });
    expect((await svc.startService(ctx, 'k1')).status).toBe('serving');
    expect((await svc.serviceDone(ctx, 'k1', { notes: 'ok' })).status).toBe('done');
  });

  it('start that lost the race (repo refuses the transition) surfaces as a conflict, not a silent success', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'accepted' });
    port.start = (async () => false) as any; // ticket was cancelled/declined/already-started underneath → 0 rows updated
    await expect(svc.startService(ctx, 'k1')).rejects.toMatchObject({ code: 'conflict' });
  });

  it('cannot mark done a ticket that is not in service', async () => {
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'accepted' });
    await expect(svc.serviceDone(ctx, 'k1')).rejects.toMatchObject({ code: 'invalid_state' });
  });
});

describe('TechService break guard', () => {
  it('blocks starting a break during active service without override', async () => {
    port.status = 'in_service'; port.hasActiveService = true;
    await expect(svc.toggleBreak(ctx, false)).rejects.toMatchObject({ code: 'invalid_state' });
    expect(port.calls).toEqual([]);
  });
  // Re-pinned Oct 12 2026 (merge, workforce audit P0 #7): the technician app no longer honours a client `managerOverride` —
  // a technician could approve their own break mid-service. A manager starts the break from the POS under their own session.
  it('a client "manager override" is NOT honoured during active service', async () => {
    port.status = 'in_service'; port.hasActiveService = true;
    await expect((svc.toggleBreak as any)(ctx, true)).rejects.toMatchObject({ code: 'invalid_state' });
    await expect((svc.setBreakState as any)(ctx, true, true)).rejects.toMatchObject({ code: 'invalid_state' });
    expect(port.calls).toEqual([]);
  });
  it('ending an existing break is always allowed', async () => {
    port.status = 'on_break';
    expect((await svc.toggleBreak(ctx)).status).toBe('available');
  });
});

describe('TechService dashboard/earnings', () => {
  it('assembles the dashboard via the pure core', async () => {
    port.hasActiveService = true; port.status = 'in_service';
    const s = await svc.getDashboard(ctx, Date.parse(started) + 90_000);
    expect(s.currentService?.elapsedSeconds).toBe(90);
    expect(s.overview.totalSalesCents).toBe(4000);
    expect(s.availableActions.canMarkServiceDone).toBe(true);
  });
  it('earnings without the compensation authority: sales from the lines, commission + tips unknown (ONE-PAY: no estimate)', async () => {
    expect(await svc.getEarnings(ctx)).toMatchObject({ todaySalesCents: 4000, tipsCents: null, estimatedCommissionCents: null });
  });
});

// ---- Regression: queue-projection id → real tickets.id translation before the serving bridge ----
describe('Tech live-edit id translation (pos_tech_queue_tickets.id → tickets.id)', () => {
  it('addServiceLine passes the real ticket_id (not the URL queue id) to the serving bridge', async () => {
    const port = new FakePort();
    port.tickets.set('QUEUE_ID', { ticketId: 'QUEUE_ID', realTicketId: 'REAL_TICKET_ID', technicianId: 'tech1', status: 'serving' } as TechTicketView);
    const seen: string[] = [];
    const bridge: any = { techAddService: async (_c: any, ticketId: string) => { seen.push(ticketId); return { ok: true, serviceLineId: 'l9', serviceName: 'X', priceCents: 100, message: 'ok' }; } };
    const svc = new TechService(port, undefined, bridge);
    const editCtx: TechContext = { ...ctx, permissions: ['tech.ticket.edit_lines'] };
    const out = await svc.addServiceLine(editCtx, 'QUEUE_ID', { serviceId: 'svc1' });
    expect(out.ok).toBe(true);
    expect(seen).toEqual(['REAL_TICKET_ID']); // before the fix this was 'QUEUE_ID' → serving looked up a non-existent ticket
  });

  it('rejects the edit when the queue ticket has no linked tickets row yet', async () => {
    const port = new FakePort();
    port.tickets.set('QUEUE_ID', { ticketId: 'QUEUE_ID', realTicketId: null, technicianId: 'tech1', status: 'serving' } as TechTicketView);
    const bridge: any = { techAddService: async () => ({ ok: true }) };
    const svc = new TechService(port, undefined, bridge);
    const editCtx: TechContext = { ...ctx, permissions: ['tech.ticket.edit_lines'] };
    await expect(svc.addServiceLine(editCtx, 'QUEUE_ID', { serviceId: 'svc1' })).rejects.toThrow(/no active service/i);
  });

  it('getPayroll returns the technician own paid/unpaid/total roll-up', async () => {
    const svc = new TechService(new FakePort());
    await expect(svc.getPayroll(ctx)).resolves.toMatchObject({ paidCents: 12000, unpaidCents: 3400, totalCents: 15400 });
  });

  it('getPayroll rejects when no technician profile is linked', async () => {
    const port = new FakePort(); port.technicianId = null;
    await expect(new TechService(port).getPayroll(ctx)).rejects.toMatchObject({ code: 'not_technician' });
  });

  it('getPayroll enforces tech.payroll.view for a tech.*-aware session', async () => {
    const svc = new TechService(new FakePort());
    const noPerm: TechContext = { ...ctx, permissions: ['tech.schedule.view'] }; // tech.*-aware but missing payroll.view
    await expect(svc.getPayroll(noPerm)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

// Constitution 5 Step 8 audit (Oct 4 2026): the membership panel looked the customer up from whatever id it was given —
// no assignment check, and the app sends the QUEUE ticket id, which never matches a real ticket (so it always showed
// "no membership"). ownedRealTicketId is the one door: the caller's own queue ticket → its real ticket id.
describe('ownedRealTicketId — the membership panel only reaches the caller\'s own ticket', () => {
  it('maps the caller\'s queue ticket to its REAL ticket id (what the membership lookup needs)', async () => {
    port.tickets.set('q1', { ticketId: 'q1', realTicketId: 'real-1', technicianId: 'tech1', status: 'in_service' } as any);
    expect(await svc.ownedRealTicketId(ctx, 'q1')).toBe('real-1');
  });
  it('refuses another technician\'s ticket — 403 "not assigned to you"', async () => {
    port.tickets.set('q2', { ticketId: 'q2', realTicketId: 'real-2', technicianId: 'someone-else', status: 'in_service' } as any);
    await expect(svc.ownedRealTicketId(ctx, 'q2')).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('an unknown id (e.g. a REAL ticket id passed directly) is not found, not a membership lookup', async () => {
    await expect(svc.ownedRealTicketId(ctx, 'real-1')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('a queue ticket with no real ticket yet → null (the controller answers "no membership")', async () => {
    port.tickets.set('q3', { ticketId: 'q3', realTicketId: null, technicianId: 'tech1', status: 'assigned' } as any);
    expect(await svc.ownedRealTicketId(ctx, 'q3')).toBeNull();
  });
});

// Fix Oct 12 2026 (wave-2 regression, live-multitech-queue / live-phase13-offline): the Tech App's own start asks the
// eligibility engine "is she serving someone ELSE" — never "is she clocked in" (salons without the time clock) — and a
// pre-631 technician with no service mapping keeps accepting / starting exactly as before the deploy.
describe('TechService accept / start — eligibility backward compatibility', () => {
  const mk = async (rec: Record<string, unknown>, snapshot: any) => {
    const { TechnicianEligibilityService, InMemoryEligibilityReader } = await import('@aipowersalon/workforce');
    const reader = new InMemoryEligibilityReader({ tech1: { technicianId: 'tech1', fullName: 'Ana Lopez', employment: 'ACTIVE', rosterBranchId: 'b1', branchIds: ['b1'], approvedServiceIds: ['11111111-1111-4111-8111-111111111111'], certifications: [], ...rec } as any },
      { '11111111-1111-4111-8111-111111111111': { name: 'Manicure', requiredCertification: null } });
    const workforce: any = { get: async () => snapshot, isAssignable: async () => ({ assignable: false, reason: snapshot.service === 'IDLE' ? 'NOT_CLOCKED_IN' : 'IN_SERVICE', snapshot }) };
    return new TechService(port, undefined, undefined, undefined, undefined, new TechnicianEligibilityService({ reader, workforce }));
  };
  const line = { serviceId: '11111111-1111-4111-8111-111111111111', name: 'Manicure' } as any;
  it('a technician who is not clocked in accepts and starts her ticket', async () => {
    const s = await mk({}, { employment: 'ACTIVE', clock: 'CLOCKED_OUT', queue: 'OFF_SHIFT', service: 'IDLE' });
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'assigned', services: [line] } as any);
    expect((await s.accept(ctx, 'k1')).status).toBe('accepted');
    expect((await s.startService(ctx, 'k1')).status).toBe('serving');
  });
  it('a technician serving another guest cannot start a second ticket', async () => {
    const s = await mk({}, { employment: 'ACTIVE', clock: 'CLOCKED_IN', queue: 'SERVING', service: 'SERVING' });
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'accepted', services: [line] } as any);
    await expect(s.startService(ctx, 'k1')).rejects.toMatchObject({ code: 'conflict' });
  });
  it('§24: a pre-631 technician with no service mapping (legacy_unconfigured) is refused like any technician without services — accept and start', async () => {
    const s = await mk({ approvedServiceIds: [], legacySkillsUnconfigured: true }, { employment: 'ACTIVE', clock: 'CLOCKED_OUT', queue: 'OFF_SHIFT', service: 'IDLE' });
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'assigned', services: [line] } as any);
    await expect(s.accept(ctx, 'k1')).rejects.toMatchObject({ code: 'invalid_state' });
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'accepted', services: [line] } as any);
    await expect(s.startService(ctx, 'k1')).rejects.toBeTruthy();
  });
  it('a technician created after 631 with no grant is still refused (exact-service)', async () => {
    const s = await mk({ approvedServiceIds: [] }, { employment: 'ACTIVE', clock: 'CLOCKED_IN', queue: 'AVAILABLE', service: 'IDLE' });
    port.tickets.set('k1', { ticketId: 'k1', technicianId: 'tech1', status: 'assigned', services: [line] } as any);
    await expect(s.accept(ctx, 'k1')).rejects.toMatchObject({ code: 'invalid_state' });
  });
});
