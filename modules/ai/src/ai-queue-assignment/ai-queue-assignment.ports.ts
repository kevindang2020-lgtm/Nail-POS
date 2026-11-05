// ai-queue-assignment.ports.ts — the seams between the AI layer and the rest of the platform. The AI module never
// queries queue/technician tables directly; it asks the queue domain for assignment inputs (QueueDataPort), acts only
// through the queue's own assign (AssignExecutionPort) and emits realtime events through the existing bus
// (AssignmentEmitterPort). Every port has an in-memory fake for tests.
//
// BUILD_PLAN Phase 6: the inputs carry what the audit found missing — the guest's version, requested / previous
// technician (bug 1), appointment start as an ISO instant in the branch zone (bug 2), the lock, the group; every
// candidate its REAL branch, break / blocked / max concurrent, availability and shift end. Auto config and rotation
// moved to the ONE settings source (ai-queue-assignment-settings.ts); the two private ports for them are gone.
import type { QueueAssignmentContext } from './ai-queue-assignment.dto';
import type { AssignPlanResult, PlanLineTiming } from '@aipowersalon/api-contracts/tenant';
import type { PlanServiceLine } from './ai-queue-assignment-plan';

export interface QueueLockInput { technicianId: string | null; reason: string | null }

export interface QueueCandidateInput {
  technicianId: string; name: string;
  /** the technician's REAL branch (null = unknown → fails closed) */
  branchId: string | null;
  available: boolean; skills: string[];
  /** every active assignment of this technician (no page cap — audit bug 4) */
  activeAssignments: number;
  isPrevious: boolean;
  rotationIndex?: number | null; assignedMinutes?: number | null; availableInMinutes?: number | null;
  shiftEndsInMinutes?: number | null; nextAppointmentInMinutes?: number | null;
  onBreak?: boolean; blocked?: boolean; reservedForAppointment?: boolean; stationAvailable?: boolean; manualLock?: boolean;
  maxConcurrent?: number | null;
  /** when this technician last got a guest (ISO) — the queue knows every assignment, manual ones included */
  lastServedAt?: string | null;
  /** REAL clock state from the workforce port (queue.assignmentInputs), when the queue domain carries it. Absent = legacy: derived from `available`. */
  clockedIn?: boolean;
}
export interface QueueEntryInput {
  queueEntryId: string; branchId: string | null;
  /** the guest's version when read — a decision assigns only if it still holds */
  version: number | null;
  requiredCategories: string[]; serviceDurationMinutes: number;
  requestedTechnicianId: string | null; previousTechnicianId?: string | null;
  isVip?: boolean; isAppointment?: boolean;
  /** ISO instant (branch zone resolved by the queue) — null for a walk-in */
  appointmentStartAt?: string | null; lateMinutes?: number | null;
  groupId?: string | null; groupSize?: number | null;
  lock?: QueueLockInput | null;
  serviceIds?: string[];
  /** the technician on the guest now, when the queue says (null = unassigned; undefined = not reported) */
  assignedTechnicianId?: string | null;
  status?: string | null;
  /** multi-technician routing: every line of the visit (category, minutes, add-on parent, the technician on it now) */
  services?: PlanServiceLine[];
  customerName?: string | null;
}
export interface QueueEntryInputs { entry: QueueEntryInput; candidates: QueueCandidateInput[] }

export interface QueueGroupInput { groupId: string; label: string; together: boolean; members: { queueItemId: string; customerName: string; status: string }[] }
export interface QueueDataPort {
  getInputs(ctx: QueueAssignmentContext, queueEntryId: string, opts?: { system?: boolean }): Promise<QueueEntryInputs | null>;
  /** a party (members in check-in order); absent / null = not found */
  getGroup?(ctx: QueueAssignmentContext, groupId: string): Promise<QueueGroupInput | null>;
}

// Realtime emit is fire-and-forget; a null emitter (tests / not wired) is a silent no-op.
export interface AssignmentEmitterPort {
  emit(ctx: QueueAssignmentContext, event: string, payload: Record<string, unknown>): void;
}

// Upcoming confirmed appointments per technician (for reservation + run-into-next-appointment warnings).
export interface UpcomingAppointment { technicianId: string; nextAppointmentInMinutes: number | null; appointmentId: string | null; }
export interface AppointmentDataPort {
  getUpcoming(ctx: QueueAssignmentContext): Promise<Record<string, UpcomingAppointment>>;
}
export class InMemoryAppointmentAdapter implements AppointmentDataPort {
  constructor(private readonly data: Record<string, UpcomingAppointment> = {}) {}
  async getUpcoming(): Promise<Record<string, UpcomingAppointment>> { return this.data; }
}

// Current queue snapshot for detection and the auto-run. Delegates to the queue domain — never re-queried. The fields
// after updatedAt are passed through from QueueService.scanEntries when it reports them (Phase 6).
export interface ScanEntryData {
  queueEntryId: string; waitMinutes: number; status: string; assignedTechnicianId: string | null; isAppointment: boolean; updatedAt: string;
  version?: number | null; requestedTechnicianId?: string | null; appointmentStartAt?: string | null; lateMinutes?: number | null;
  isVip?: boolean; groupId?: string | null; serviceIds?: string[]; startedAt?: string | null; expectedDurationMinutes?: number | null;
  lock?: QueueLockInput | null;
}
export interface QueueScanPort {
  getScanEntries(ctx: QueueAssignmentContext, opts?: { system?: boolean }): Promise<ScanEntryData[]>;
}
export class InMemoryQueueScanAdapter implements QueueScanPort {
  constructor(private readonly entries: ScanEntryData[] = []) {}
  async getScanEntries(): Promise<ScanEntryData[]> { return this.entries; }
}

// Executes a real assignment through the queue's own action (its guards, version check, lock check, history, audit).
// The AI layer never assigns directly. A stale guest comes back as { ok: false, conflict: true } — never overwritten.
export type AssignSource = 'staff' | 'ai_suggestion' | 'auto_assign' | 'repair';
/** Fair Turn Engine: what the turn ledger records with the assignment (the queue's QueueTurnDecision). */
export interface AssignTurnDecision { recommendedTechnicianId?: string | null; overrideReasonCode?: string | null; skips?: { technicianId: string; reason: string }[] | null; eligiblePool?: string[] | null }
/** Fair Turn Engine: today's technician turn queue at the branch + the guest's customer declines (read-only). */
export interface TurnReadPort {
  day(ctx: QueueAssignmentContext): Promise<{ rows: import('@aipowersalon/workforce').TurnStateLike[] }>;
  declined(ctx: QueueAssignmentContext, queueEntryId: string): Promise<string[]>;
  /** services whose active turn rule is a special-rotation job (§74) */
  specialServiceIds?(ctx: QueueAssignmentContext): Promise<string[]>;
  /** §158 (Oct 13 2026): the guest's preferred language (short code) for this queue entry, null when unknown */
  guestLanguage?(ctx: QueueAssignmentContext, queueEntryId: string): Promise<string | null>;
  /** §158: the languages each technician is known to speak (short codes); a technician with no data is absent (unknown) */
  technicianLanguages?(ctx: QueueAssignmentContext, technicianIds: string[]): Promise<Map<string, Set<string>>>;
}
export interface AssignOptions {
  technicianId: string;
  turn?: AssignTurnDecision | null;
  /** the technician the caller saw on the guest (null = unassigned) — refused when it changed (audit bug 5) */
  expectedTechnicianId: string | null;
  /** the guest's version the suggestion was made on — refused when it moved */
  expectedVersion?: number | null;
  managerOverride?: boolean;
  source: AssignSource;
  idempotencyKey?: string | null;
  reason?: string | null;
  system?: boolean;
}
export interface AssignResult {
  ok: boolean;
  conflict?: boolean;
  currentTechnicianId?: string | null;
  error?: string;
  /** the queue item after the change (the queue's detail shape) */
  item?: Record<string, unknown> | null;
}
export interface QueueItemSnapshot { queueEntryId: string; status: string | null; assignedTechnicianId: string | null; version: number | null; item: Record<string, unknown> }
/** Multi-technician routing: one plan through the queue's ONE multi-line writer (QueueService.assignPlan), all or none. */
export interface PlanAssignLine { serviceId: string; technicianId: string; expectedTechnicianId: string | null; timing?: PlanLineTiming; afterServiceId?: string | null; plannedStartOffsetMin?: number | null }
export interface PlanAssignOptions {
  items: { queueItemId: string; expectedVersion: number; expectedTechnicianId: string | null; leadTechnicianId?: string; lines: PlanAssignLine[] }[];
  groupId?: string | null; idempotencyKey: string; managerOverride?: boolean; reason?: string | null; source: AssignSource; system?: boolean;
}
export interface PlanAssignResult { ok: boolean; conflict?: boolean; currentTechnicianId?: string | null; queueItemId?: string; serviceId?: string; error?: string; result?: AssignPlanResult | null }
export interface AssignExecutionPort {
  assign(ctx: QueueAssignmentContext, queueEntryId: string, opts: AssignOptions): Promise<AssignResult>;
  /** the whole plan or nothing (absent on an older queue build → the plan cannot be applied) */
  assignPlan?(ctx: QueueAssignmentContext, opts: PlanAssignOptions): Promise<PlanAssignResult>;
  /** the guest as the queue shows it now (null = not found) */
  current(ctx: QueueAssignmentContext, queueEntryId: string, opts?: { system?: boolean }): Promise<QueueItemSnapshot | null>;
}

/** In-memory queue for tests: compare-and-set on technician + version, idempotency keys replay. */
export class InMemoryAssignExecution implements AssignExecutionPort {
  public calls: { queueEntryId: string; technicianId: string; opts: AssignOptions }[] = [];
  private items = new Map<string, { status: string; technicianId: string | null; version: number }>();
  private keys = new Map<string, AssignResult>();
  constructor(private readonly fail = false) {}
  seed(id: string, v: { status?: string; technicianId?: string | null; version?: number } = {}) {
    this.items.set(id, { status: v.status ?? 'waiting', technicianId: v.technicianId ?? null, version: v.version ?? 1 }); return this;
  }
  /** simulate another device changing the guest */
  touch(id: string, technicianId: string | null) { const i = this.items.get(id); if (i) { i.technicianId = technicianId; i.version += 1; if (technicianId) i.status = 'assigned'; } }
  async current(_ctx: QueueAssignmentContext, id: string): Promise<QueueItemSnapshot | null> {
    const i = this.items.get(id); if (!i) return null;
    return { queueEntryId: id, status: i.status, assignedTechnicianId: i.technicianId, version: i.version, item: { queueItemId: id, status: i.status, assignedTechnicianId: i.technicianId, version: i.version } };
  }
  async assign(ctx: QueueAssignmentContext, queueEntryId: string, opts: AssignOptions): Promise<AssignResult> {
    if (this.fail) return { ok: false, error: 'assign_failed' };
    if (opts.idempotencyKey && this.keys.has(opts.idempotencyKey)) return this.keys.get(opts.idempotencyKey)!;
    let i = this.items.get(queueEntryId);
    if (!i) { i = { status: 'waiting', technicianId: null, version: 1 }; this.items.set(queueEntryId, i); }
    if ((opts.expectedTechnicianId ?? null) !== i.technicianId || (opts.expectedVersion != null && opts.expectedVersion !== i.version)) {
      return { ok: false, conflict: true, currentTechnicianId: i.technicianId, error: 'This guest was just assigned or changed on another device.' };
    }
    i.technicianId = opts.technicianId; i.status = 'assigned'; i.version += 1;
    this.calls.push({ queueEntryId, technicianId: opts.technicianId, opts });
    const res: AssignResult = { ok: true, item: (await this.current(ctx, queueEntryId))!.item };
    if (opts.idempotencyKey) this.keys.set(opts.idempotencyKey, res);
    return res;
  }
  /** plan calls applied (tests read them) and each guest's lines */
  public planCalls: PlanAssignOptions[] = [];
  public lines = new Map<string, Map<string, string>>();
  private planKeys = new Map<string, PlanAssignResult>();
  async assignPlan(_ctx: QueueAssignmentContext, opts: PlanAssignOptions): Promise<PlanAssignResult> {
    if (this.fail) return { ok: false, error: 'assign_failed' };
    if (this.planKeys.has(opts.idempotencyKey)) return { ...this.planKeys.get(opts.idempotencyKey)!, result: { ...this.planKeys.get(opts.idempotencyKey)!.result!, replayed: true } };
    for (const it of opts.items) {   // all or none: check every guest + line first (compare-and-set)
      let i = this.items.get(it.queueItemId);
      if (!i) { i = { status: 'waiting', technicianId: null, version: 1 }; this.items.set(it.queueItemId, i); }
      if ((it.expectedTechnicianId ?? null) !== i.technicianId || it.expectedVersion !== i.version) return { ok: false, conflict: true, currentTechnicianId: i.technicianId, queueItemId: it.queueItemId };
      const cur = this.lines.get(it.queueItemId) ?? new Map();
      for (const l of it.lines) if ((l.expectedTechnicianId ?? null) !== (cur.get(l.serviceId) ?? null)) return { ok: false, conflict: true, currentTechnicianId: cur.get(l.serviceId) ?? null, queueItemId: it.queueItemId, serviceId: l.serviceId };
    }
    const items: AssignPlanResult['items'] = [];
    for (const it of opts.items) {
      const i = this.items.get(it.queueItemId)!;
      const lead = it.leadTechnicianId ?? it.lines[0].technicianId;
      i.technicianId = lead; i.status = 'assigned'; i.version += 1;
      this.lines.set(it.queueItemId, new Map(it.lines.map((l) => [l.serviceId, l.technicianId])));
      items.push({ queueItemId: it.queueItemId, version: i.version, assignedTechnicianId: lead, serviceAssignments: it.lines.map((l, k) => ({ serviceId: l.serviceId, serviceName: '', technicianId: l.technicianId, technicianName: null, status: 'assigned', sequence: k })) });
    }
    this.planCalls.push(opts);
    const res: PlanAssignResult = { ok: true, result: { applied: true, replayed: false, items } };
    this.planKeys.set(opts.idempotencyKey, res);
    return res;
  }
}

export class InMemoryQueueDataAdapter implements QueueDataPort {
  constructor(private readonly data: Record<string, QueueEntryInputs | (Omit<QueueEntryInputs, 'entry'> & { entry: Omit<QueueEntryInput, 'version'> & { version?: number | null } })> = {}) {}
  set(entryId: string, inputs: QueueEntryInputs) { this.data[entryId] = inputs; }
  async getInputs(_ctx: QueueAssignmentContext, queueEntryId: string): Promise<QueueEntryInputs | null> {
    const d = this.data[queueEntryId];
    if (!d) return null;
    return { entry: { ...d.entry, version: d.entry.version ?? null }, candidates: d.candidates };
  }
  private groupsById = new Map<string, QueueGroupInput>();
  setGroup(g: QueueGroupInput) { this.groupsById.set(g.groupId, g); return this; }
  async getGroup(_ctx: QueueAssignmentContext, groupId: string): Promise<QueueGroupInput | null> { return this.groupsById.get(groupId) ?? null; }
}
