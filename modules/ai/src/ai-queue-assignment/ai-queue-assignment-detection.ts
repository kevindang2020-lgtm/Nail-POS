// ai-queue-assignment-detection.ts — BUILD_PLAN Phase 6: THE queue detection core. PURE (no I/O, no clock: callers pass
// `nowMs`), every threshold comes from the ONE settings source (`effective()` of ai-queue-assignment-settings.ts).
//
// One core for every detector the spec asks for — wait levels, unassigned guests, congestion, stuck records, late
// appointments, long services, overloaded technicians — used by the POS alert scan, the per-minute background scan
// AND the Super Admin live-queue monitor (modules/super-admin/.../live-queue-core.ts delegates here). Before Phase 6
// there were two engines with different numbers (Super Admin 30/45/60 min vs the AI module 10/20/30/45, audit
// "parallel implementations" 2) and the stuck detector looked for statuses the queue never uses (audit bug 3).
//
// Status vocabulary = pos_queue_items.status (migrations 026 + 480): waiting, called, assigned, ready_for_tech,
// moved_to_tech_queue, in_service, completed, done, cancelled, removed.
import type { QueueAssignmentSettings } from './ai-queue-assignment-settings';
import { SETTINGS_DEFAULTS } from './ai-queue-assignment-settings';

export const PRE_SERVICE_STATUSES = ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue'] as const;
export const IN_SERVICE_STATUSES = ['in_service'] as const;
export const FINISHED_STATUSES = ['completed', 'done', 'cancelled', 'removed'] as const;
export const isPreService = (s: string): boolean => (PRE_SERVICE_STATUSES as readonly string[]).includes(s);
export const isInService = (s: string): boolean => (IN_SERVICE_STATUSES as readonly string[]).includes(s);
export const isFinished = (s: string): boolean => (FINISHED_STATUSES as readonly string[]).includes(s);

/** The thresholds the detectors read — a subset of the effective settings. */
export type DetectionThresholds = Pick<QueueAssignmentSettings,
  'waitApproachingMin' | 'waitExceededMin' | 'waitSevereMin' | 'waitCriticalMin' | 'stuckMinutes' | 'longServiceFactor' | 'congestionWaitingPerTech' | 'lateGraceMin'>;
export const DEFAULT_DETECTION_THRESHOLDS: DetectionThresholds = {
  waitApproachingMin: SETTINGS_DEFAULTS.waitApproachingMin, waitExceededMin: SETTINGS_DEFAULTS.waitExceededMin,
  waitSevereMin: SETTINGS_DEFAULTS.waitSevereMin, waitCriticalMin: SETTINGS_DEFAULTS.waitCriticalMin,
  stuckMinutes: SETTINGS_DEFAULTS.stuckMinutes, longServiceFactor: SETTINGS_DEFAULTS.longServiceFactor,
  congestionWaitingPerTech: SETTINGS_DEFAULTS.congestionWaitingPerTech, lateGraceMin: SETTINGS_DEFAULTS.lateGraceMin,
};
export function thresholdsOf(s: Partial<DetectionThresholds> | null | undefined): DetectionThresholds {
  const o: any = { ...DEFAULT_DETECTION_THRESHOLDS };
  for (const k of Object.keys(DEFAULT_DETECTION_THRESHOLDS)) if (s && typeof (s as any)[k] === 'number' && Number.isFinite((s as any)[k])) o[k] = (s as any)[k];
  return o;
}

export type AlertType = 'waiting_too_long' | 'unassigned' | 'congestion' | 'stuck_record' | 'late_appointment' | 'long_service' | 'overloaded_technician';
export const ALERT_TYPES: readonly AlertType[] = ['waiting_too_long', 'unassigned', 'congestion', 'stuck_record', 'late_appointment', 'long_service', 'overloaded_technician'];
export type AlertSeverity = 'info' | 'warning' | 'high' | 'critical';
export const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, high: 2, critical: 3 };

/** Repairs the alert offers (each runs through the queue domain's own action). */
export type RepairAction = 'unassign' | 'reassign' | 'call' | 'start_service' | 'move_to_tech_queue' | 'cancel' | 'dismiss';

export interface AlertFinding {
  /** the alert's key: the queue item id; the technician id (overloaded_technician); the branch id (congestion) */
  queueEntryId: string;
  type: AlertType;
  severity: AlertSeverity;
  reason: string;            // plain words, NEVER a customer's name (it is shown on boards and in push bodies)
  ageMinutes: number;
  technicianId?: string | null;
  repairs?: RepairAction[];
}
export const findingKey = (f: { type: string; queueEntryId: string }): string => `${f.type}:${f.queueEntryId}`;

// ── wait levels ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type WaitLevel = 'none' | 'approaching' | 'exceeded' | 'severe' | 'critical';
export function classifyWait(waitMinutes: number, t: DetectionThresholds): WaitLevel {
  if (waitMinutes >= t.waitCriticalMin) return 'critical';
  if (waitMinutes >= t.waitSevereMin) return 'severe';
  if (waitMinutes >= t.waitExceededMin) return 'exceeded';
  if (waitMinutes >= t.waitApproachingMin) return 'approaching';
  return 'none';
}
const WAIT_SEVERITY: Record<WaitLevel, AlertSeverity | null> = { none: null, approaching: 'info', exceeded: 'warning', severe: 'high', critical: 'critical' };
export const waitSeverity = (l: WaitLevel): AlertSeverity | null => WAIT_SEVERITY[l];

// ── congestion ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type CongestionLevel = 'normal' | 'elevated' | 'high' | 'severe' | 'critical';
export interface CongestionSignals { waitingCount: number; longestWaitMinutes: number; availableTechnicians: number }
export interface CongestionResult { level: CongestionLevel; ratio: number; reasons: string[]; recommendedActions: string[] }
const CONGESTION_SEVERITY: Record<CongestionLevel, AlertSeverity | null> = { normal: null, elevated: 'info', high: 'warning', severe: 'high', critical: 'critical' };
export const congestionSeverity = (l: CongestionLevel): AlertSeverity | null => CONGESTION_SEVERITY[l];

/**
 * Waiting guests per AVAILABLE technician against the salon's "waiting per technician" setting (P), plus the longest
 * wait against the wait ladder: elevated ≥ 0.625·P or approaching, high ≥ P or exceeded, severe ≥ 1.5·P or severe,
 * critical ≥ 2·P or critical, or nobody free. With the defaults (P = 2) these are exactly the old fixed numbers.
 * The wait ladder counts only with two or more guests waiting: ONE long wait is the waiting-too-long alert's job, not
 * a backed-up branch (it used to raise both, and notify the managers twice for one guest).
 */
export function classifyCongestion(s: CongestionSignals, t: DetectionThresholds): CongestionResult {
  const P = t.congestionWaitingPerTech;
  if (s.waitingCount <= 0) return { level: 'normal', ratio: 0, reasons: ['No customers waiting'], recommendedActions: [] };
  const ratio = s.availableTechnicians > 0 ? s.waitingCount / s.availableTechnicians : Infinity;
  const w = s.waitingCount >= 2 ? s.longestWaitMinutes : 0;
  let level: CongestionLevel = 'normal';
  const reasons: string[] = [];
  if (s.availableTechnicians <= 0) { level = 'critical'; reasons.push('No technician is free'); }
  else if (ratio >= 2 * P || w >= t.waitCriticalMin) level = 'critical';
  else if (ratio >= 1.5 * P || w >= t.waitSevereMin) level = 'severe';
  else if (ratio >= P || w >= t.waitExceededMin) level = 'high';
  else if (ratio >= 0.625 * P || w >= t.waitApproachingMin) level = 'elevated';
  if (level !== 'normal') {
    reasons.push(`${s.waitingCount} waiting, ${s.availableTechnicians} free (${Number.isFinite(ratio) ? ratio.toFixed(1) : 'no one free'} per technician)`);
    if (w > 0) reasons.push(`longest wait ${w} min`);
  }
  return { level, ratio, reasons, recommendedActions: congestionActions(level) };
}
// Permitted, non-destructive actions only (spec: never auto-reject customers or cancel appointments).
function congestionActions(level: CongestionLevel): string[] {
  if (level === 'normal') return [];
  const a = ['Reassign free technicians', 'Update estimated wait times', 'Ask waiting guests whether another technician is fine'];
  if (level !== 'elevated') a.push('Review break timing', 'Contact appointment guests who will be delayed');
  if (level === 'severe' || level === 'critical') a.push('Add manager support', 'Open more stations', 'Consider pausing walk-ins');
  return a;
}

// ── stuck records ───────────────────────────────────────────────────────────────────────────────────────────────────
export type StuckReason = 'assigned_not_started' | 'called_not_progressed' | 'handoff_stale' | 'waiting_no_change' | 'technician_clocked_out';
export interface StuckEvaluation { stuck: boolean; reason: StuckReason | null; minutes: number; severity: AlertSeverity | null; repairs: RepairAction[]; text: string | null }
export interface StuckInput { status: string; assignedTechnicianId: string | null; startedAt?: string | null; updatedAt: string | null }

const minsSince = (iso: string | null | undefined, nowMs: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((nowMs - t) / 60_000)) : null;
};

/**
 * A record that has not moved in its state for too long. Time-in-state = minutes since the row's REAL updated_at (audit
 * bug 3: the scan used to stamp "now", so nothing was ever stuck). S = stuckMinutes: called / assigned without a start,
 * a hand-off to the tech queue not picked up → S; a waiting guest nobody touched → 3·S (likely left); twice the window
 * → high. A guest assigned to a technician who clocked out is stuck at once.
 */
export function evaluateStuck(e: StuckInput, nowMs: number, t: Pick<DetectionThresholds, 'stuckMinutes'>, opts: { clockedOutTechIds?: ReadonlySet<string> } = {}): StuckEvaluation {
  const none: StuckEvaluation = { stuck: false, reason: null, minutes: 0, severity: null, repairs: [], text: null };
  const S = t.stuckMinutes;
  const age = minsSince(e.updatedAt, nowMs);
  if (e.assignedTechnicianId && opts.clockedOutTechIds?.has(e.assignedTechnicianId) && (isPreService(e.status) || isInService(e.status)) && e.status !== 'waiting') {
    return { stuck: true, reason: 'technician_clocked_out', minutes: age ?? 0, severity: 'high', repairs: ['unassign', 'reassign'], text: 'The assigned technician has clocked out — reassign this guest' };
  }
  if (age === null) return none;
  const sev = (limit: number): AlertSeverity => (age >= 2 * limit ? 'high' : 'warning');
  switch (e.status) {
    case 'assigned':
      if (!e.startedAt && age >= S) return { stuck: true, reason: 'assigned_not_started', minutes: age, severity: sev(S), repairs: ['start_service', 'call', 'unassign', 'reassign'], text: `Assigned ${age} min ago but the service has not started` };
      return none;
    case 'called':
      if (age >= S) return { stuck: true, reason: 'called_not_progressed', minutes: age, severity: sev(S), repairs: ['start_service', 'unassign', 'cancel'], text: `Called ${age} min ago and nothing has happened since` };
      return none;
    case 'ready_for_tech':
    case 'moved_to_tech_queue':
      if (age >= S) return { stuck: true, reason: 'handoff_stale', minutes: age, severity: sev(S), repairs: ['move_to_tech_queue', 'start_service', 'unassign'], text: `Sent to the technician ${age} min ago and not picked up` };
      return none;
    case 'waiting':
      if (age >= 3 * S) return { stuck: true, reason: 'waiting_no_change', minutes: age, severity: age >= 6 * S ? 'high' : 'warning', repairs: ['call', 'cancel'], text: `No change for ${age} min — the guest may have left` };
      return none;
    default:
      return none;   // in service → long_service; finished → nothing to watch
  }
}

// ── the snapshot the detectors read ─────────────────────────────────────────────────────────────────────────────────
export interface DetectionEntry {
  queueEntryId: string;
  status: string;
  waitMinutes: number;
  assignedTechnicianId: string | null;
  isAppointment: boolean;
  appointmentStartAt?: string | null;    // ISO, the branch's zone already resolved by the queue domain
  lateMinutes?: number | null;           // minutes late at check-in
  startedAt?: string | null;
  expectedDurationMinutes?: number | null;
  updatedAt: string | null;              // REAL updated_at
  lock?: { technicianId: string | null; reason?: string | null } | null;
}
export interface DetectionTechnician {
  technicianId: string;
  status: string;                          // available / busy / in_service / on_break / clocked_out / off …
  available?: boolean;
  onBreak?: boolean;
}
export const CLOCKED_OUT_STATUSES = ['clocked_out', 'off', 'off_today', 'off_shift', 'offline', 'scheduled_later'];
export const technicianIsFree = (t: DetectionTechnician): boolean =>
  !t.onBreak && !CLOCKED_OUT_STATUSES.includes(t.status) && t.status !== 'on_break' && (t.available ?? t.status === 'available');

export interface DetectionInput { branchId: string; entries: readonly DetectionEntry[]; technicians: readonly DetectionTechnician[] }

/** Every finding for one branch right now. The scan raises / updates these and auto-resolves every open alert NOT in it. */
export function detectQueueFindings(input: DetectionInput, thresholds: Partial<DetectionThresholds> | null | undefined, nowMs: number): AlertFinding[] {
  const t = thresholdsOf(thresholds);
  const out: AlertFinding[] = [];
  const pre = input.entries.filter((e) => isPreService(e.status));
  const clockedOut = new Set(input.technicians.filter((x) => CLOCKED_OUT_STATUSES.includes(x.status)).map((x) => x.technicianId));

  for (const e of pre) {
    const level = classifyWait(e.waitMinutes, t);
    // waiting too long: from "exceeded" up ("approaching" is a board colour, not an alert)
    if (level === 'exceeded' || level === 'severe' || level === 'critical') {
      out.push({ queueEntryId: e.queueEntryId, type: 'waiting_too_long', severity: waitSeverity(level)!, ageMinutes: e.waitMinutes, reason: `Waiting ${e.waitMinutes} min (${level})`, repairs: e.assignedTechnicianId ? ['call', 'reassign'] : ['reassign'] });
    }
    // unassigned: no technician once the wait reaches "approaching"; a guest a manager locked to "nobody yet" is deliberate
    const lockedToNobody = !!e.lock && e.lock.technicianId === null;
    if (!e.assignedTechnicianId && !lockedToNobody && level !== 'none') {
      out.push({ queueEntryId: e.queueEntryId, type: 'unassigned', severity: waitSeverity(level)!, ageMinutes: e.waitMinutes, reason: `No technician for ${e.waitMinutes} min`, repairs: ['reassign'] });
    }
    // late appointment: the booked time has passed by more than the grace and the service has not started
    if (e.isAppointment) {
      const overdue = e.appointmentStartAt ? minsSince(e.appointmentStartAt, nowMs) : null;
      const startMs = e.appointmentStartAt ? Date.parse(e.appointmentStartAt) : NaN;
      if (overdue !== null && Number.isFinite(startMs) && startMs <= nowMs && overdue > t.lateGraceMin) {
        out.push({ queueEntryId: e.queueEntryId, type: 'late_appointment', severity: overdue > 3 * t.lateGraceMin ? 'high' : 'warning', ageMinutes: overdue, reason: `Appointment time passed ${overdue} min ago and the service has not started`, repairs: e.assignedTechnicianId ? ['call', 'start_service', 'reassign'] : ['reassign'] });
      } else if (typeof e.lateMinutes === 'number' && e.lateMinutes > t.lateGraceMin) {
        out.push({ queueEntryId: e.queueEntryId, type: 'late_appointment', severity: 'info', ageMinutes: e.lateMinutes, reason: `Arrived ${e.lateMinutes} min after the appointment time — check the technician's next booking`, repairs: ['reassign'] });
      }
    }
  }

  // stuck records (pre-service; in service is the long-service check)
  for (const e of input.entries) {
    if (isFinished(e.status) || isInService(e.status)) continue;
    const s = evaluateStuck(e, nowMs, t, { clockedOutTechIds: clockedOut });
    if (s.stuck) out.push({ queueEntryId: e.queueEntryId, type: 'stuck_record', severity: s.severity!, ageMinutes: s.minutes, reason: s.text!, technicianId: e.assignedTechnicianId, repairs: s.repairs });
  }
  // in service: clocked-out technician (stuck) or running far past the expected duration (long service)
  for (const e of input.entries) {
    if (!isInService(e.status)) continue;
    if (e.assignedTechnicianId && clockedOut.has(e.assignedTechnicianId)) {
      out.push({ queueEntryId: e.queueEntryId, type: 'stuck_record', severity: 'high', ageMinutes: minsSince(e.updatedAt, nowMs) ?? 0, reason: 'The technician has clocked out during this service', technicianId: e.assignedTechnicianId, repairs: ['reassign'] });
      continue;
    }
    const elapsed = minsSince(e.startedAt, nowMs);
    const expected = e.expectedDurationMinutes ?? 0;
    if (elapsed !== null && expected > 0 && elapsed >= expected * t.longServiceFactor) {
      out.push({ queueEntryId: e.queueEntryId, type: 'long_service', severity: elapsed >= expected * t.longServiceFactor * 1.5 ? 'high' : 'warning', ageMinutes: elapsed,
        reason: `In service ${elapsed} min (expected about ${expected} min)`, technicianId: e.assignedTechnicianId, repairs: ['dismiss'] });
    }
  }

  // overloaded technician: more guests queued on one technician than the per-technician setting while someone else is free
  const backlog = new Map<string, number>();
  for (const e of pre) if (e.assignedTechnicianId) backlog.set(e.assignedTechnicianId, (backlog.get(e.assignedTechnicianId) ?? 0) + 1);
  const freeIdle = input.technicians.filter((x) => technicianIsFree(x) && !(backlog.get(x.technicianId) ?? 0)).length;
  for (const [techId, n] of backlog) {
    const heavy = n >= 2 * t.congestionWaitingPerTech + 1;
    if (n > t.congestionWaitingPerTech && (freeIdle > 0 || heavy)) {
      out.push({ queueEntryId: techId, type: 'overloaded_technician', severity: heavy ? 'high' : 'warning', ageMinutes: 0, technicianId: techId,
        reason: freeIdle > 0 ? `${n} guests are waiting for one technician while ${freeIdle} ${freeIdle === 1 ? 'technician is' : 'technicians are'} free` : `${n} guests are waiting for one technician`, repairs: ['reassign'] });
    }
  }

  // congestion (one per branch)
  const free = input.technicians.filter(technicianIsFree).length;
  const c = classifyCongestion({ waitingCount: pre.length, longestWaitMinutes: pre.reduce((m, e) => Math.max(m, e.waitMinutes), 0), availableTechnicians: free }, t);
  const cs = congestionSeverity(c.level);
  if (cs) out.push({ queueEntryId: input.branchId, type: 'congestion', severity: cs, ageMinutes: 0, reason: `Queue ${c.level}: ${c.reasons.join('; ')}`, repairs: ['dismiss'] });
  return out;
}

/** The live numbers the overview shows, from the same snapshot. */
export interface QueueSummary { waiting: number; unassigned: number; inService: number; avgWaitMinutes: number; longestWaitMinutes: number; byWaitLevel: Record<WaitLevel, number>; congestion: CongestionLevel; freeTechnicians: number }
export function summarizeQueue(input: DetectionInput, thresholds: Partial<DetectionThresholds> | null | undefined): QueueSummary {
  const t = thresholdsOf(thresholds);
  const pre = input.entries.filter((e) => isPreService(e.status));
  const byWaitLevel: Record<WaitLevel, number> = { none: 0, approaching: 0, exceeded: 0, severe: 0, critical: 0 };
  for (const e of pre) byWaitLevel[classifyWait(e.waitMinutes, t)]++;
  const waits = pre.map((e) => e.waitMinutes);
  const free = input.technicians.filter(technicianIsFree).length;
  return {
    waiting: pre.length, unassigned: pre.filter((e) => !e.assignedTechnicianId).length, inService: input.entries.filter((e) => isInService(e.status)).length,
    avgWaitMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0, longestWaitMinutes: waits.length ? Math.max(...waits) : 0,
    byWaitLevel, congestion: classifyCongestion({ waitingCount: pre.length, longestWaitMinutes: waits.length ? Math.max(...waits) : 0, availableTechnicians: free }, t).level, freeTechnicians: free,
  };
}
