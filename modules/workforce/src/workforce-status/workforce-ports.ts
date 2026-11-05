// workforce-ports.ts — merged from the Oct 2026 Technician Profile package (their tech/workforce-ports.ts).
// The SEAMS between the technician assignment paths (queue / tech-queue / serving / booking /
// customer booking / live schedule) and the authoritative workforce state + availability engines.
//
// The authoritative state lives in modules/workforce/src/workforce-status/** ({ employment, clock, shift, queue, service, presence },
// `isAssignable`, transition methods — bound through workforce-status/workforce-state-port.adapter.ts) and the
// schedule engine in `live-technician-schedule/availability-core.ts` (`isTechnicianAvailableAt`, bound through
// live-technician-schedule/availability-port.adapter.ts — BK merge). Every consumer codes against THESE ports; the
// WorkforceStatusModule binds WORKFORCE_STATE_PORT to the real adapter (workforce-state-port.adapter.ts).
//
// FAIL-CLOSED RULE: a technician whose state cannot be established (no state row, port unbound) is NOT assignable —
// she is never handed a guest. Tests inject the permissive fake.

/** Snapshot of the six separated technician statuses (workforce audit P2 #25). */
export interface WorkforceSnapshot {
  employment: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE' | 'ARCHIVED' | string;
  clock: 'CLOCKED_IN' | 'CLOCKED_OUT' | string;
  shift: 'ON_SHIFT' | 'OFF_SHIFT' | string;
  queue: 'AVAILABLE' | 'ASSIGNED' | 'UNAVAILABLE' | string;
  service: 'IDLE' | 'SERVING' | 'PAUSED' | string;
  presence: 'PRESENT' | 'BREAK' | 'LUNCH' | 'AWAY' | string;
}
export interface AssignabilityVerdict { assignable: boolean; reason?: string; snapshot?: WorkforceSnapshot | null }

export interface WorkforceStatePort {
  /** The authoritative snapshot, or null when the technician has no state row (treated as NOT assignable). */
  get(tenantId: string, technicianId: string): Promise<WorkforceSnapshot | null>;
  /** The one question assignment asks. Defaults to NOT assignable when no row exists. */
  isAssignable(tenantId: string, technicianId: string): Promise<AssignabilityVerdict>;
  // Transitions (optional on the port so a read-only binding is valid; the real module implements all of them).
  assigned?(tenantId: string, technicianId: string, ref: { ticketId?: string | null; queueItemId?: string | null }): Promise<void>;
  serviceStarted?(tenantId: string, technicianId: string, ref: { ticketId: string }): Promise<void>;
  servicePaused?(tenantId: string, technicianId: string, ref: { ticketId: string }): Promise<void>;
  serviceCompleted?(tenantId: string, technicianId: string, ref: { ticketId: string }): Promise<void>;
  unassigned?(tenantId: string, technicianId: string, ref: { ticketId?: string | null; queueItemId?: string | null }): Promise<void>;
}

export interface AvailabilityQuery { tenantId: string; branchId: string | null; technicianId: string; dateIso: string; startTime: string; durationMin: number; ignoreAppointmentId?: string | null }
export interface AvailabilityVerdict { available: boolean; reason?: 'OFF_SCHEDULE' | 'LUNCH' | 'BLOCKED' | 'TIME_OFF' | 'CONFLICT' | 'NOT_CLOCKED_IN' | string; conflictingAppointmentId?: string | null }
export interface AvailabilityPort {
  isTechnicianAvailableAt(q: AvailabilityQuery): Promise<AvailabilityVerdict>;
}

/** FAIL-CLOSED stub: every assignability question is answered NO. Used when nothing real is bound (never in the
 *  Nest module — technician-eligibility.module.ts binds the real adapter) and by tests that prove fail-closed. */
export class FailClosedWorkforceStatePort implements WorkforceStatePort {
  async get(): Promise<WorkforceSnapshot | null> { return null; }
  async isAssignable(): Promise<AssignabilityVerdict> { return { assignable: false, reason: 'WORKFORCE_STATE_UNAVAILABLE', snapshot: null }; }
}

/** TEST FAKE — every technician assignable unless explicitly marked otherwise. Never bind in production. */
export class PermissiveWorkforceStatePort implements WorkforceStatePort {
  readonly transitions: { kind: string; tenantId: string; technicianId: string; ref: unknown }[] = [];
  constructor(private readonly overrides: Record<string, Partial<WorkforceSnapshot> & { assignable?: boolean; reason?: string }> = {}) {}
  set(technicianId: string, o: Partial<WorkforceSnapshot> & { assignable?: boolean; reason?: string }) { this.overrides[technicianId] = o; }
  async get(_t: string, technicianId: string): Promise<WorkforceSnapshot | null> {
    const o = this.overrides[technicianId] ?? {};
    return { employment: o.employment ?? 'ACTIVE', clock: o.clock ?? 'CLOCKED_IN', shift: o.shift ?? 'ON_SHIFT', queue: o.queue ?? 'AVAILABLE', service: o.service ?? 'IDLE', presence: o.presence ?? 'PRESENT' };
  }
  async isAssignable(t: string, technicianId: string): Promise<AssignabilityVerdict> {
    const o = this.overrides[technicianId];
    const snapshot = await this.get(t, technicianId);
    if (o && o.assignable === false) return { assignable: false, reason: o.reason ?? 'NOT_ASSIGNABLE', snapshot };
    return { assignable: true, snapshot };
  }
  async assigned(tenantId: string, technicianId: string, ref: unknown) { this.transitions.push({ kind: 'assigned', tenantId, technicianId, ref }); }
  async serviceStarted(tenantId: string, technicianId: string, ref: unknown) { this.transitions.push({ kind: 'serviceStarted', tenantId, technicianId, ref }); }
  async servicePaused(tenantId: string, technicianId: string, ref: unknown) { this.transitions.push({ kind: 'servicePaused', tenantId, technicianId, ref }); }
  async serviceCompleted(tenantId: string, technicianId: string, ref: unknown) { this.transitions.push({ kind: 'serviceCompleted', tenantId, technicianId, ref }); }
  async unassigned(tenantId: string, technicianId: string, ref: unknown) { this.transitions.push({ kind: 'unassigned', tenantId, technicianId, ref }); }
}

/** No schedule engine bound: the eligibility function skips the `at` check (schedule conflicts remain the booking
 *  modules' own pure checks). The REAL binding is availability-core.isTechnicianAvailableAt. */
export class NoAvailabilityPort implements AvailabilityPort {
  async isTechnicianAvailableAt(): Promise<AvailabilityVerdict> { return { available: true, reason: 'NO_AVAILABILITY_ENGINE' }; }
}
/** TEST FAKE — scripted answers per technician. */
export class FakeAvailabilityPort implements AvailabilityPort {
  readonly calls: AvailabilityQuery[] = [];
  constructor(private readonly answers: Record<string, AvailabilityVerdict> = {}, private readonly fallback: AvailabilityVerdict = { available: true }) {}
  set(technicianId: string, v: AvailabilityVerdict) { this.answers[technicianId] = v; }
  async isTechnicianAvailableAt(q: AvailabilityQuery): Promise<AvailabilityVerdict> { this.calls.push(q); return this.answers[q.technicianId] ?? this.fallback; }
}
/** DI token for the bound WorkforceStatePort (WorkforceStatusModule is @Global). */
export const WORKFORCE_STATE_PORT = 'WorkforceStatePort';
