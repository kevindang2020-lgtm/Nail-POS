// workforce-status-core.ts — PURE derivation + transition rules for the ONE authoritative technician operational
// state (migration 579 — merged from the Oct 2026 Technician Profile package, their 462). No I/O. Unit-tested in workforce-status-core.vitest.spec.ts.
//
// Six separated statuses the Technician Profile page shows:
//   employment  — mirror of the technicians lifecycle (active | inactive | suspended | archived)
//   clock       — CLOCKED_OUT | CLOCKED_IN | ON_BREAK            (the time clock)
//   shift       — OFF_SHIFT | ON_SHIFT                            (has an open punch)
//   queue       — AVAILABLE | ASSIGNED | SERVING | BREAK | UNAVAILABLE | OFF_SHIFT   (DERIVED, never written directly)
//   service     — IDLE | SERVING | PAUSED                         (the serving engine)
//   presence    — online | offline (derived from clock for now; realtime presence can refine it later)
//
// queue is a pure function of the other facts, in this precedence:
//   employment not active → UNAVAILABLE;  clocked out → OFF_SHIFT;  service SERVING → SERVING;  on break → BREAK;
//   manually unavailable → UNAVAILABLE;  service PAUSED or a ticket is held → ASSIGNED;  else → AVAILABLE.
// So AVAILABLE is true ONLY when employment is active AND clocked in AND not on break AND service IDLE AND no ticket.

export type EmploymentStatus = 'active' | 'inactive' | 'suspended' | 'archived';
export type ClockStatus = 'CLOCKED_OUT' | 'CLOCKED_IN' | 'ON_BREAK';
export type ShiftStatus = 'OFF_SHIFT' | 'ON_SHIFT';
export type QueueStatus = 'AVAILABLE' | 'ASSIGNED' | 'SERVING' | 'BREAK' | 'UNAVAILABLE' | 'OFF_SHIFT';
export type ServiceState = 'IDLE' | 'SERVING' | 'PAUSED';
export type PresenceStatus = 'online' | 'offline';

/** The stored facts (everything except the derived queue status). */
export interface WorkforceFacts {
  employment: EmploymentStatus;
  clock: ClockStatus;
  service: ServiceState;
  currentTicketId: string | null;
  manualUnavailable: boolean;
}

/** The full derived state a reader receives. */
export interface WorkforceState extends WorkforceFacts {
  shift: ShiftStatus;
  queue: QueueStatus;
  presence: PresenceStatus;
}

export function normalizeEmployment(raw: string | null | undefined, isActive?: boolean | null, archivedAt?: unknown): EmploymentStatus {
  const s = String(raw || '').toLowerCase();
  if (s === 'active' || s === 'inactive' || s === 'suspended' || s === 'archived') return s;
  if (archivedAt) return 'archived';
  return isActive === false ? 'inactive' : 'active';
}

export function deriveShift(clock: ClockStatus): ShiftStatus { return clock === 'CLOCKED_OUT' ? 'OFF_SHIFT' : 'ON_SHIFT'; }

export function deriveQueue(f: WorkforceFacts): QueueStatus {
  if (f.employment !== 'active') return 'UNAVAILABLE';
  if (f.clock === 'CLOCKED_OUT') return 'OFF_SHIFT';
  if (f.service === 'SERVING') return 'SERVING';
  if (f.clock === 'ON_BREAK') return 'BREAK';
  if (f.manualUnavailable) return 'UNAVAILABLE';
  if (f.service === 'PAUSED' || f.currentTicketId) return 'ASSIGNED';
  return 'AVAILABLE';
}

export function deriveWorkforceState(f: WorkforceFacts): WorkforceState {
  return { ...f, shift: deriveShift(f.clock), queue: deriveQueue(f), presence: f.clock === 'CLOCKED_OUT' ? 'offline' : 'online' };
}

/** Can this technician be handed a new customer right now? Exactly "queue === AVAILABLE". */
export function isAssignableState(s: WorkforceFacts): boolean { return deriveQueue(s) === 'AVAILABLE'; }

// ── transitions ───────────────────────────────────────────────────────────────────────────────────────────────
export type Transition =
  | 'clockIn' | 'clockOut' | 'breakStart' | 'breakEnd'
  | 'assigned' | 'unassigned' | 'serviceStarted' | 'servicePaused' | 'serviceResumed' | 'serviceCompleted'
  | 'setUnavailable' | 'setAvailable';

export class WorkforceStateError extends Error {
  constructor(public readonly code: 'VERSION_CONFLICT' | 'CLOCK_STATE_CONFLICT' | 'NOT_FOUND', message: string) { super(message); this.name = 'WorkforceStateError'; }
}

/**
 * Apply a transition to the stored facts. Throws CLOCK_STATE_CONFLICT on an illegal move (e.g. breakStart while
 * clocked out, clockOut while clocked out, serviceStarted while clocked out). Returns the NEW facts (never mutates).
 */
export function applyTransition(cur: WorkforceFacts, t: Transition, arg: { ticketId?: string | null } = {}): WorkforceFacts {
  const conflict = (m: string) => new WorkforceStateError('CLOCK_STATE_CONFLICT', m);
  switch (t) {
    case 'clockIn':
      if (cur.clock !== 'CLOCKED_OUT') throw conflict('Technician is already clocked in');
      return { ...cur, clock: 'CLOCKED_IN' };
    case 'clockOut':
      if (cur.clock === 'CLOCKED_OUT') throw conflict('Technician is not clocked in');
      if (cur.service === 'SERVING') throw conflict('Technician is still on an active service');
      return { ...cur, clock: 'CLOCKED_OUT', service: 'IDLE', currentTicketId: null };
    case 'breakStart':
      if (cur.clock === 'CLOCKED_OUT') throw conflict('Technician must be clocked in to start a break');
      if (cur.clock === 'ON_BREAK') throw conflict('Technician is already on break');
      if (cur.service === 'SERVING') throw conflict('Technician is on an active service');
      return { ...cur, clock: 'ON_BREAK' };
    case 'breakEnd':
      if (cur.clock !== 'ON_BREAK') throw conflict('Technician is not on break');
      return { ...cur, clock: 'CLOCKED_IN' };
    case 'assigned':
      if (cur.clock === 'CLOCKED_OUT') throw conflict('Technician is not clocked in');
      if (cur.service === 'SERVING' && cur.currentTicketId && arg.ticketId && cur.currentTicketId !== arg.ticketId) throw conflict('Technician is already serving another ticket');
      return { ...cur, currentTicketId: arg.ticketId ?? cur.currentTicketId };
    case 'unassigned':
      if (cur.service === 'SERVING') throw conflict('Cannot unassign an active service');
      return { ...cur, service: 'IDLE', currentTicketId: null };
    case 'serviceStarted':
      if (cur.clock === 'CLOCKED_OUT') throw conflict('Technician is not clocked in');
      if (cur.service === 'SERVING' && cur.currentTicketId && arg.ticketId && cur.currentTicketId !== arg.ticketId) throw conflict('Technician is already serving another ticket');
      return { ...cur, clock: cur.clock === 'ON_BREAK' ? 'CLOCKED_IN' : cur.clock, service: 'SERVING', currentTicketId: arg.ticketId ?? cur.currentTicketId };
    case 'servicePaused':
      if (cur.service !== 'SERVING') throw conflict('No active service to pause');
      return { ...cur, service: 'PAUSED' };
    case 'serviceResumed':
      if (cur.service !== 'PAUSED') throw conflict('No paused service to resume');
      return { ...cur, service: 'SERVING' };
    case 'serviceCompleted':
      if (cur.service === 'IDLE' && !cur.currentTicketId) throw conflict('No service to complete');
      return { ...cur, service: 'IDLE', currentTicketId: null };
    case 'setUnavailable':
      return { ...cur, manualUnavailable: true };
    case 'setAvailable':
      return { ...cur, manualUnavailable: false };
    default:
      throw conflict('Unknown transition');
  }
}

/** Legacy `technician_statuses.status` compatibility value for the seven remaining readers. */
export function legacyStatusFor(s: WorkforceFacts): string {
  const q = deriveQueue(s);
  switch (q) {
    case 'AVAILABLE': return 'available';
    case 'ASSIGNED': return 'assigned';
    case 'SERVING': return 'in_service';
    case 'BREAK': return 'on_break';
    case 'UNAVAILABLE': return s.employment === 'active' ? 'unavailable' : 'inactive';
    case 'OFF_SHIFT': default: return 'off_shift';
  }
}

/** Facts from a legacy technician_statuses value (backfill when no workforce row exists yet). */
export function factsFromLegacy(employment: EmploymentStatus, legacy: string | null | undefined, hasOpenShift: boolean): WorkforceFacts {
  const l = String(legacy || '').toLowerCase();
  const onBreak = l === 'on_break' || l === 'break' || l === 'lunch';
  const serving = l === 'in_service' || l === 'busy' || l === 'serving';
  return {
    employment,
    clock: !hasOpenShift ? 'CLOCKED_OUT' : onBreak ? 'ON_BREAK' : 'CLOCKED_IN',
    service: hasOpenShift && serving ? 'SERVING' : 'IDLE',
    currentTicketId: null,
    manualUnavailable: false,
  };
}
