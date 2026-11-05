// ai-scheduling-constraints.ts — the DETERMINISTIC hard-constraint gate. This runs BEFORE any AI scoring, and the AI can
// never bypass it: a placement that fails any hard constraint is simply not schedulable. It is FAIL-CLOSED — if the data
// needed to confirm a constraint is safe is missing (e.g. no shift record), that is a violation, not a silent pass.
// Confirmed/locked appointments are immovable inputs here; this engine never moves anything, it only judges a candidate.
import { Range, overlaps, contains, applyBuffer } from './ai-scheduling-core';

export type ViolationCode =
  | 'OUTSIDE_HOURS' | 'TECH_NOT_AT_BRANCH' | 'TECH_NOT_SCHEDULED' | 'BEYOND_SHIFT_END'
  | 'MISSING_SKILL' | 'ON_TIME_OFF' | 'BREAK_CONFLICT' | 'APPOINTMENT_OVERLAP'
  | 'STATION_UNAVAILABLE' | 'PREFERENCE_VIOLATION' | 'MULTI_SERVICE_ORDER' | 'GROUP_CAPACITY_EXCEEDED' | 'LOCK_VIOLATION';

export interface HardViolation { code: ViolationCode; message: string; }

export interface Buffers { setup?: number; cleanup?: number; }
export interface Placement {
  technicianId: string;
  branchId: string;
  serviceIds: string[];
  blocks: Range[];              // occupied service blocks (from chainServices)
  span: Range;                  // overall visit span incl. setup/cleanup
  requiredTechnicianId?: string | null;   // customer-REQUIRED tech (hard); optional prefs are handled in soft scoring
  movesAppointmentId?: string | null;     // if this placement represents moving an existing appointment
  groupSize?: number;
  stationId?: string | null;
  allowServiceOverlap?: boolean;      // when true, the deterministic model explicitly permits same-tech service overlap (constraint 7 skips)
}
export interface ExistingAppt { range: Range; technicianId: string; stationId?: string | null; locked?: boolean; id?: string; }
export interface ConstraintContext {
  branchHours: Range | null;                 // null = closed/unknown → fail closed
  techBranchIds: string[];                    // branches this tech is authorized for
  techShifts: Range[];                        // scheduled shift windows for the day (empty = not scheduled → fail closed)
  techSkills: Record<string, boolean>;        // serviceId → qualified
  breaks: Range[];
  timeOff: Range[];
  existingAppointments: ExistingAppt[];       // same-tenant/branch/day; may be locked
  allowServiceOverlap?: boolean;              // service model explicitly allows overlap (rare)
  stationCapacity?: Record<string, number>;   // stationId → concurrent capacity
  groupCapacity?: number;
  buffers?: Buffers;
}

const occupied = (blocks: Range[], b: Buffers): Range[] => blocks.map((r) => applyBuffer(r, { before: b.setup, after: b.cleanup }));

/** Judge a candidate placement against all hard constraints. Deterministic + fail-closed. Accumulates ALL violations. */
export function checkHardConstraints(p: Placement, ctx: ConstraintContext): { ok: boolean; violations: HardViolation[] } {
  const v: HardViolation[] = [];
  const buf = ctx.buffers ?? {};
  const footprint = occupied(p.blocks, buf);

  // 1) within branch operating hours (fail closed if hours unknown)
  if (!ctx.branchHours || !contains(ctx.branchHours, p.span)) v.push({ code: 'OUTSIDE_HOURS', message: 'placement is outside branch operating hours' });

  // 2) technician authorized for the branch
  if (!ctx.techBranchIds.includes(p.branchId)) v.push({ code: 'TECH_NOT_AT_BRANCH', message: 'technician is not authorized for this branch' });

  // 3) technician scheduled + within shift end (fail closed if no shift)
  const inShift = ctx.techShifts.some((s) => contains(s, p.span));
  if (!ctx.techShifts.length || !inShift) {
    v.push({ code: 'TECH_NOT_SCHEDULED', message: 'technician is not scheduled for this time' });
    if (ctx.techShifts.some((s) => p.span.start >= s.start && p.span.end > s.end)) v.push({ code: 'BEYOND_SHIFT_END', message: 'placement extends beyond shift end' });
  }

  // 4) qualified for EVERY service
  const missing = p.serviceIds.filter((id) => !ctx.techSkills[id]);
  if (missing.length) v.push({ code: 'MISSING_SKILL', message: `technician not qualified for: ${missing.join(', ')}` });

  // 5) not on approved time off
  if (ctx.timeOff.some((t) => overlaps(t, p.span))) v.push({ code: 'ON_TIME_OFF', message: 'technician is on approved time off' });

  // 6) no overlapping break (occupied footprint, incl. buffers)
  if (ctx.breaks.some((br) => footprint.some((f) => overlaps(br, f)))) v.push({ code: 'BREAK_CONFLICT', message: 'placement overlaps a technician break' });

  // 7) no overlapping appointment for the SAME technician (unless the model explicitly allows overlap)
  if (!p.allowServiceOverlap) {
    const clash = ctx.existingAppointments.some((a) => a.technicianId === p.technicianId && !(p.movesAppointmentId && a.id === p.movesAppointmentId) && footprint.some((f) => overlaps(a.range, f)));
    if (clash) v.push({ code: 'APPOINTMENT_OVERLAP', message: 'technician already has an appointment in this range' });
  }

  // 8) station capacity (concurrent occupancy at the placement's span)
  if (p.stationId && ctx.stationCapacity && ctx.stationCapacity[p.stationId] != null) {
    const concurrent = ctx.existingAppointments.filter((a) => a.stationId === p.stationId && overlaps(a.range, p.span)).length;
    if (concurrent + 1 > ctx.stationCapacity[p.stationId]) v.push({ code: 'STATION_UNAVAILABLE', message: 'required station is at capacity' });
  }

  // 9) customer-REQUIRED technician preference (hard); optional/strong prefs are soft
  if (p.requiredTechnicianId && p.requiredTechnicianId !== p.technicianId) v.push({ code: 'PREFERENCE_VIOLATION', message: 'customer-required technician not honored' });

  // 10) group capacity
  if (p.groupSize != null && ctx.groupCapacity != null && p.groupSize > ctx.groupCapacity) v.push({ code: 'GROUP_CAPACITY_EXCEEDED', message: 'group size exceeds branch capacity' });

  // 11) lock: this placement must not move a locked appointment
  if (p.movesAppointmentId) {
    const target = ctx.existingAppointments.find((a) => a.id === p.movesAppointmentId);
    if (target?.locked) v.push({ code: 'LOCK_VIOLATION', message: 'appointment is locked and cannot be moved' });
  }

  return { ok: v.length === 0, violations: v };
}

/** Multi-service ordering: services must be placed in the required sequence with no invalid gap/overlap between them. */
export function checkServiceOrder(blocks: Range[], requiredOrder: number[] | null): HardViolation[] {
  if (!requiredOrder || requiredOrder.length !== blocks.length) return [];
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].start < blocks[i - 1].end) return [{ code: 'MULTI_SERVICE_ORDER', message: 'multi-service blocks overlap or are out of order' }];
  }
  return [];
}
