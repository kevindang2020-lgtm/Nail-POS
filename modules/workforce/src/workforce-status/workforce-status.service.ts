// workforce-status.service.ts — the ONE authoritative technician operational state (migration 579).
//
// Read API for every other module (queue / tech-queue / serving / booking / roster readers):
//   getTechnicianState(tenantId, technicianId) → { employment, clock, shift, queue, service, presence, … } | null
//   listBranchStates(tenantId, branchId)       → the same for every technician at the branch
//   isAssignable(tenantId, technicianId)       → queue === AVAILABLE (employment active, clocked in, not on break,
//                                                service IDLE, no held ticket, not manually unavailable)
//
// Transitions (each ONE compare-and-set UPDATE guarded by `version`): clockIn / clockOut / breakStart / breakEnd /
// assigned / unassigned / serviceStarted / servicePaused / serviceResumed / serviceCompleted / setUnavailable /
// setAvailable. An illegal move throws WorkforceStateError('CLOCK_STATE_CONFLICT'); a lost race throws
// WorkforceStateError('VERSION_CONFLICT') when the caller pinned a version, otherwise the service re-reads once and
// re-applies (the transition rules decide whether the move is still legal on the fresh row).
//
// A technician with no row yet is backfilled on first touch from technicians + the open punch + the latest legacy
// technician_statuses value. Every successful transition emits `technician_status_updated` to the branch.
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import {
  applyTransition, deriveWorkforceState, factsFromLegacy, legacyStatusFor, isAssignableState, WorkforceStateError,
  type Transition, type WorkforceState, type WorkforceFacts, type EmploymentStatus,
} from './workforce-status-core';
import type { WorkforceStateStore, WorkforceRow } from './workforce-status.repository';
import { turnWorkforceMove } from '../turn-queue/turn-ledger';
import type { OutboxWriter } from '@aipowersalon/events';

/** The workforce moves the technician turn queue follows (Fair Turn Engine §27–34, §177). */
const TURN_MOVES = new Set<Transition>(['clockIn', 'clockOut', 'breakStart', 'breakEnd', 'setUnavailable', 'setAvailable']);

export { WorkforceStateError } from './workforce-status-core';
export type { WorkforceState } from './workforce-status-core';

export interface TechnicianOperationalState extends WorkforceState {
  tenantId: string; branchId: string | null; technicianId: string;
  openShiftId: string | null; breakStartedAt: string | null; updatedAt: string; version: number;
}

export interface TransitionOptions {
  /** Pin the version the caller read; a mismatch throws VERSION_CONFLICT instead of a silent retry. */
  expectedVersion?: number;
  ticketId?: string | null;
  openShiftId?: string | null;
  breakStartedAt?: string | null;
  branchId?: string | null;
}

function project(r: WorkforceRow): TechnicianOperationalState {
  return { ...deriveWorkforceState(r), tenantId: r.tenantId, branchId: r.branchId, technicianId: r.technicianId, openShiftId: r.openShiftId, breakStartedAt: r.breakStartedAt, updatedAt: r.updatedAt, version: r.version };
}

export class WorkforceStatusService {
  constructor(private readonly store: WorkforceStateStore, private readonly rt?: RealtimeEmitter | null, private readonly turnOutbox?: OutboxWriter | null) {}

  // ---- reads ----
  async getTechnicianState(tenantId: string, technicianId: string): Promise<TechnicianOperationalState | null> {
    const row = await this.ensure(tenantId, technicianId);
    return row ? project(row) : null;
  }
  async listBranchStates(tenantId: string, branchId: string | null): Promise<TechnicianOperationalState[]> {
    return (await this.store.listBranch(tenantId, branchId)).map(project);
  }
  async isAssignable(tenantId: string, technicianId: string): Promise<boolean> {
    const row = await this.ensure(tenantId, technicianId);
    return !!row && isAssignableState(row);
  }
  /**
   * The legacy `technician_statuses.status` vocabulary ('available' | 'assigned' | 'in_service' | 'on_break' |
   * 'unavailable' | 'inactive' | 'off_shift') for a set of technicians, derived from the ONE authoritative state —
   * what the queue / tech-queue / serving / check-in / checkout / service-done / tech-appointments / roster readers
   * used to SELECT from the compat table. One listBranchStates read; a technician with no row yet is backfilled on
   * first touch (getTechnicianState), exactly like every other read. Never throws: a missing technician is simply
   * absent from the map so the reader keeps its own default.
   */
  async legacyStatusMap(tenantId: string, branchId: string | null, technicianIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const want = [...new Set(technicianIds.filter(Boolean).map(String))];
    if (!want.length) return out;
    const states = await this.listBranchStates(tenantId, branchId).catch(() => [] as TechnicianOperationalState[]);
    const byId = new Map(states.map((s) => [s.technicianId, s] as const));
    for (const id of want) {
      let s = byId.get(id) ?? null;
      if (!s) s = await this.getTechnicianState(tenantId, id).catch(() => null);
      if (s) out[id] = legacyStatusFor(s);
    }
    return out;
  }

  // ---- transitions ----
  clockIn(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'clockIn', { ...o, breakStartedAt: null }); }
  clockOut(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'clockOut', { ...o, openShiftId: null, breakStartedAt: null }); }
  breakStart(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'breakStart', { breakStartedAt: new Date().toISOString(), ...o }); }
  breakEnd(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'breakEnd', { ...o, breakStartedAt: null }); }
  assigned(t: string, id: string, ticketId: string, o: TransitionOptions = {}) { return this.transition(t, id, 'assigned', { ...o, ticketId }); }
  unassigned(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'unassigned', o); }
  serviceStarted(t: string, id: string, ticketId: string, o: TransitionOptions = {}) { return this.transition(t, id, 'serviceStarted', { ...o, ticketId }); }
  servicePaused(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'servicePaused', o); }
  serviceResumed(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'serviceResumed', o); }
  serviceCompleted(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'serviceCompleted', o); }
  setUnavailable(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'setUnavailable', o); }
  setAvailable(t: string, id: string, o: TransitionOptions = {}) { return this.transition(t, id, 'setAvailable', o); }

  /** Employment mirror: called by the lifecycle writers (suspend/archive/reactivate) so queue flips to UNAVAILABLE. */
  async setEmployment(tenantId: string, technicianId: string, employment: EmploymentStatus): Promise<TechnicianOperationalState | null> {
    const row = await this.ensure(tenantId, technicianId);
    if (!row) return null;
    if (row.employment === employment) return project(row);
    const next: WorkforceFacts = { ...row, employment };
    const saved = await this.store.cas(tenantId, technicianId, row.version, next, {}, legacyStatusFor(next));
    if (!saved) throw new WorkforceStateError('VERSION_CONFLICT', 'Technician state changed concurrently');
    this.emit(saved);
    return project(saved);
  }

  async transition(tenantId: string, technicianId: string, t: Transition, o: TransitionOptions = {}): Promise<TechnicianOperationalState> {
    const row = await this.ensure(tenantId, technicianId);
    if (!row) throw new WorkforceStateError('NOT_FOUND', 'Technician not found');
    if (o.expectedVersion !== undefined && o.expectedVersion !== row.version) throw new WorkforceStateError('VERSION_CONFLICT', 'Technician state changed concurrently');
    const attempt = async (cur: WorkforceRow): Promise<WorkforceRow | null> => {
      const next = applyTransition(cur, t, { ticketId: o.ticketId });   // throws CLOCK_STATE_CONFLICT on an illegal move
      const extra: { openShiftId?: string | null; breakStartedAt?: string | null; branchId?: string | null } = {};
      if (o.openShiftId !== undefined) extra.openShiftId = o.openShiftId;
      if (o.breakStartedAt !== undefined) extra.breakStartedAt = o.breakStartedAt;
      if (o.branchId !== undefined) extra.branchId = o.branchId;
      const hook = TURN_MOVES.has(t) ? (trx: any, saved: WorkforceRow) => turnWorkforceMove(trx, t, { tenantId, branchId: saved.branchId, technicianId }, { outbox: this.turnOutbox ?? null }) : undefined;
      return this.store.cas(tenantId, technicianId, cur.version, next, extra, legacyStatusFor(next), hook);
    };
    let saved = await attempt(row);
    if (!saved) {
      if (o.expectedVersion !== undefined) throw new WorkforceStateError('VERSION_CONFLICT', 'Technician state changed concurrently');
      const fresh = await this.store.get(tenantId, technicianId);   // one re-read; the rules decide if still legal
      saved = fresh ? await attempt(fresh) : null;
      if (!saved) throw new WorkforceStateError('VERSION_CONFLICT', 'Technician state changed concurrently');
    }
    this.emit(saved);
    return project(saved);
  }

  // ---- internals ----
  /**
   * Fair Turn: bring the turn queue in line with a clock state that was ALREADY right — the first touch seeded the row
   * from the open punch (so the clock-in move itself was a no-op), or an idempotent re-sync. The ledger commands are
   * idempotent (a technician already in the rotation is left alone), so this is safe to call any number of times.
   */
  async syncTurnQueue(tenantId: string, technicianId: string, move: 'clockIn' | 'clockOut' | 'breakStart' | 'breakEnd'): Promise<void> {
    if (!this.store.turnSync) return;
    const row = await this.store.get(tenantId, technicianId);
    if (!row) return;
    await this.store.turnSync(row, (trx: any, saved: WorkforceRow) => turnWorkforceMove(trx, move, { tenantId, branchId: saved.branchId, technicianId }, { outbox: this.turnOutbox ?? null }));
  }

  private async ensure(tenantId: string, technicianId: string): Promise<WorkforceRow | null> {
    if (!tenantId || !technicianId) return null;
    const existing = await this.store.get(tenantId, technicianId);
    if (existing) return existing;
    const seed = await this.store.seedFacts(tenantId, technicianId);
    if (!seed) return null;
    const facts = factsFromLegacy(seed.employment, seed.legacyStatus, !!seed.openShiftId);
    return this.store.create({ ...facts, tenantId, technicianId, branchId: seed.branchId, openShiftId: seed.openShiftId, breakStartedAt: facts.clock === 'ON_BREAK' ? new Date().toISOString() : null });
  }

  // §343 dual path: with the outbox + publisher on, the store recorded technician.status_changed in the CAS transaction
  // and the realtime projection delivers technician_status_updated; the direct push is the fallback when it is off.
  private emit(r: WorkforceRow) {
    if (!this.rt) return;
    const s = deriveWorkforceState(r);
    const payload = { technicianId: r.technicianId, branchId: r.branchId, employment: s.employment, clock: s.clock, shift: s.shift, queue: s.queue, service: s.service, presence: s.presence, version: r.version };
    if (!this.store.emitsDomainEvents?.()) {
      try {
        if (r.branchId) this.rt.toTenant({ tenantId: r.tenantId, branchId: r.branchId }, EVENTS.technicianStatusUpdated, payload);
        this.rt.toTechnician(r.technicianId, EVENTS.technicianStatusUpdated, payload);
      } catch { /* realtime is best-effort */ }
    }
  }
}
