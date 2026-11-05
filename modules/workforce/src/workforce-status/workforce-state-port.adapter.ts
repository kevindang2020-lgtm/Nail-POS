// workforce-state-port.adapter.ts — binds the REAL WorkforceStatusService to the `WorkforceStatePort` seam that the
// assignment paths (queue / tech-queue / serving / booking / check-in / tech app) code against
// (./workforce-ports.ts). Bound by WorkforceStatusModule as WORKFORCE_STATE_PORT:
//   { provide: WORKFORCE_STATE_PORT, useFactory: (svc: WorkforceStatusService) => new WorkforceStatePortAdapter(svc), inject: [WorkforceStatusService] }
// (WorkforceStatusModule is @Global, so no import is needed.) Vocabulary mapping: the port spells employment in
// UPPER CASE and presence as PRESENT | BREAK | AWAY; the service's six statuses carry the same facts.
import type { WorkforceStatePort, WorkforceSnapshot, AssignabilityVerdict } from './workforce-ports';
import { WorkforceStatusService, WorkforceStateError, type TechnicianOperationalState } from './workforce-status.service';

export function toSnapshot(s: TechnicianOperationalState): WorkforceSnapshot {
  return {
    employment: s.employment.toUpperCase(),
    clock: s.clock === 'CLOCKED_OUT' ? 'CLOCKED_OUT' : 'CLOCKED_IN',
    shift: s.shift,
    queue: s.queue,
    service: s.service,
    presence: s.clock === 'CLOCKED_OUT' ? 'AWAY' : s.clock === 'ON_BREAK' ? 'BREAK' : 'PRESENT',
  };
}

export function notAssignableReason(s: TechnicianOperationalState): string {
  if (s.employment !== 'active') return 'EMPLOYMENT_' + s.employment.toUpperCase();
  if (s.clock === 'CLOCKED_OUT') return 'NOT_CLOCKED_IN';
  if (s.service === 'SERVING') return 'IN_SERVICE';
  if (s.clock === 'ON_BREAK') return 'ON_BREAK';
  if (s.manualUnavailable) return 'MARKED_UNAVAILABLE';
  if (s.service === 'PAUSED' || s.currentTicketId) return 'ALREADY_ASSIGNED';
  return 'NOT_ASSIGNABLE';
}

export class WorkforceStatePortAdapter implements WorkforceStatePort {
  constructor(private readonly svc: WorkforceStatusService) {}
  async get(tenantId: string, technicianId: string): Promise<WorkforceSnapshot | null> {
    const s = await this.svc.getTechnicianState(tenantId, technicianId);
    return s ? toSnapshot(s) : null;
  }
  async isAssignable(tenantId: string, technicianId: string): Promise<AssignabilityVerdict> {
    const s = await this.svc.getTechnicianState(tenantId, technicianId);
    if (!s) return { assignable: false, reason: 'WORKFORCE_STATE_UNAVAILABLE', snapshot: null };
    const snapshot = toSnapshot(s);
    return s.queue === 'AVAILABLE' ? { assignable: true, snapshot } : { assignable: false, reason: notAssignableReason(s), snapshot };
  }
  // Transitions: an illegal move is surfaced as the port's error so the caller's compare-and-set path can refuse;
  // the assignment engines own their own idempotency, so "already in that state" is reported, never swallowed.
  private async move(fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); }
    catch (e) { if (e instanceof WorkforceStateError) { const err: any = new Error(e.message); err.code = e.code; throw err; } throw e; }
  }
  assigned(tenantId: string, technicianId: string, ref: { ticketId?: string | null; queueItemId?: string | null }) { return this.move(() => this.svc.assigned(tenantId, technicianId, ref.ticketId || ref.queueItemId || '')); }
  serviceStarted(tenantId: string, technicianId: string, ref: { ticketId: string }) { return this.move(() => this.svc.serviceStarted(tenantId, technicianId, ref.ticketId)); }
  servicePaused(tenantId: string, technicianId: string, _ref: { ticketId: string }) { return this.move(() => this.svc.servicePaused(tenantId, technicianId)); }
  serviceCompleted(tenantId: string, technicianId: string, _ref: { ticketId: string }) { return this.move(() => this.svc.serviceCompleted(tenantId, technicianId)); }
  unassigned(tenantId: string, technicianId: string, _ref: { ticketId?: string | null; queueItemId?: string | null }) { return this.move(() => this.svc.unassigned(tenantId, technicianId)); }
}
