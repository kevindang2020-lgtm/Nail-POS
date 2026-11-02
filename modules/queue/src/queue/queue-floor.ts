// queue-floor.ts — the Customer Queue screen's server-side projection (Customer Queue mandate, Oct 28 2026).
// PURE (unit-tested in queue-floor.vitest.spec.ts) and shared by BOTH adapters (Postgres + in-memory), so the board, the
// priority panel, the technician panel and the insights are computed ONCE, on the server, from canonical state:
//   §14   KPIs are never computed from the rows React happened to load        → QUEUE_KPI_DEFINITIONS (documented below)
//   §20   the Guest Flow Board is the canonical queue status — no client-only stage (it derived "Arrived" / "Lounge" /
//         "Ready for Assignment" from wait minutes in the browser)            → flowCounts + flowTop
//   §22   Waiting Guests by Priority uses the EXISTING policy, rankQueue() (urgent > vip > high > normal when the salon's
//         vipPriorityEnabled is on, then the longest wait; ties by check-in time, then id — deterministic). The screen
//         ranked vip above urgent on its own                                  → priorityOrder + priorityCounts
//   §25–§29 Available Technicians come from the technician signals (clock-in, schedule, breaks, blocks, services in
//         progress — the inputs Fair Turn reads), not `active = true`; the Fair Turn order is the server's rotation
//         index, never re-derived in the browser; top N + a summary of the whole on-duty roster (200-technician scale)
//   §21   insights are advisory (they open a guest or a preview — never assign, reorder or start anything themselves),
//         at most five, in a fixed order; the fabricated "upsell for pedicure" regex insight is gone
import type { QueueInsight, QueuePriority, QueueRequestedService, QueueStaffRow } from './queue.dto';
import { rankQueue } from './queue.dto';

/** the board's columns — the canonical active queue statuses, in flow order (in_service lives on the Serving screen) */
export const QUEUE_FLOW_STAGES = ['waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue'] as const;
export type QueueFlowStage = (typeof QUEUE_FLOW_STAGES)[number];
export const QUEUE_FLOW_TOP = 3;            // §20: top records per column, then "+N more" / View Full Board
export const QUEUE_PRIORITY_SHOWN = 8;      // §22: the priority panel's fixed row budget
export const QUEUE_STAFF_SHOWN = 8;         // §29: top technicians, then View All
export const QUEUE_INSIGHTS_MAX = 5;        // §21
/** statuses still waiting for a technician to take them (the priority panel's population) */
const PRIORITY_POP = new Set(['waiting', 'called', 'assigned']);

export interface FloorItem {
  queueItemId: string; status: string; priority: QueuePriority; isVip: boolean; source: string; customerName: string;
  assignedTechId: string | null; checkedInAtMs: number; services: QueueRequestedService[];
}
export interface FloorTech {
  technicianId: string; name: string; avatarUrl?: string | null; skills: string[]; activeAssignments: number; rotationIndex: number | null;
  signals: { status: 'available' | 'in_service' | 'on_break' | 'blocked' | 'off_shift'; availableInMinutes: number | null; onBreak: boolean };
}
export type StaffStatus = 'Available' | 'Finishing Soon' | 'Busy' | 'Break';
export interface QueueStaffSummary { onDuty: number; available: number; finishing: number; busy: number; onBreak: number; shown: number; roster: number }
export interface QueueFloor {
  flowCounts: Record<QueueFlowStage, number>;
  flowTop: Record<QueueFlowStage, string[]>;
  priorityCounts: Record<QueuePriority, number>;
  priorityOrder: string[];
  staff: QueueStaffRow[];
  staffSummary: QueueStaffSummary;
  insights: QueueInsight[];
  /** per queue item: 'delayed' when the guest has waited longer than the average service time (the same rule as the
   *  Delayed KPI), else 'normal' — the row's wait colour comes from the server, not a browser threshold (§36) */
  waitLevel: Record<string, 'delayed' | 'normal'>;
}

/** a technician finishing within this many minutes is "Finishing Soon" (the Serving / Service Done screens' rule) */
export const FINISHING_SOON_MINUTES = 15;
const minutesSince = (ms: number, now: number) => Math.max(0, Math.floor((now - ms) / 60000));

export function staffStatusOf(s: FloorTech['signals']): StaffStatus | null {
  if (s.status === 'off_shift' || s.status === 'blocked') return null;   // not on duty — not offered for the queue
  if (s.status === 'on_break' || s.onBreak) return 'Break';
  if (s.status === 'available') return 'Available';
  return s.availableInMinutes != null && s.availableInMinutes <= FINISHING_SOON_MINUTES ? 'Finishing Soon' : 'Busy';
}
const STAFF_ORDER: Record<StaffStatus, number> = { Available: 0, 'Finishing Soon': 1, Busy: 2, Break: 3 };

/**
 * The on-duty technicians from their REAL signals (clock, schedule, break, block, service in progress), in the order the
 * front desk offers them: Available (Fair Turn rotation order), then Finishing Soon, Busy and Break (soonest free first).
 * Off shift / blocked technicians are not on duty and are not listed. `loadBy` = guests assigned and not yet in service.
 * Shared by the Customer Queue (buildQueueFloor) and Check-In's Available Technicians (Check-In mandate §42, Oct 28 2026).
 */
export function projectOnDutyStaff(techs: FloorTech[], loadBy: Record<string, number>, limit: number): { staff: QueueStaffRow[]; staffSummary: QueueStaffSummary; onDuty: { t: FloorTech; st: StaffStatus }[] } {
  const onDuty = techs.map((t) => ({ t, st: staffStatusOf(t.signals) })).filter((x): x is { t: FloorTech; st: StaffStatus } => x.st != null);
  onDuty.sort((a, b) => STAFF_ORDER[a.st] - STAFF_ORDER[b.st]
    || (a.st === 'Available' ? (a.t.rotationIndex ?? 1e9) - (b.t.rotationIndex ?? 1e9) : (a.t.signals.availableInMinutes ?? 1e9) - (b.t.signals.availableInMinutes ?? 1e9))
    || a.t.name.localeCompare(b.t.name));
  const staff: QueueStaffRow[] = onDuty.slice(0, Math.max(0, limit)).map(({ t, st }) => ({
    technicianId: t.technicianId, name: t.name, avatarUrl: t.avatarUrl ?? null, specialty: t.skills.slice(0, 2).join(', ') || undefined,
    currentLoad: loadBy[t.technicianId] ?? 0, status: st,
    nextAvailable: st === 'Available' ? 'Now' : st === 'Break' ? '—' : t.signals.availableInMinutes != null ? String(t.signals.availableInMinutes) : 'Soon',
  }));
  const n = (s: StaffStatus) => onDuty.filter((x) => x.st === s).length;
  const staffSummary: QueueStaffSummary = { onDuty: onDuty.length, available: n('Available'), finishing: n('Finishing Soon'), busy: n('Busy'), onBreak: n('Break'), shown: staff.length, roster: techs.length };
  return { staff, staffSummary, onDuty };
}

export function buildQueueFloor(input: { items: FloorItem[]; techs: FloorTech[]; vipPriorityEnabled: boolean; avgServiceMinutes: number; peakHour?: number | null; nowMs: number }): QueueFloor {
  const { items, techs, nowMs } = input; const avg = Math.max(1, input.avgServiceMinutes);
  const flowCounts = Object.fromEntries(QUEUE_FLOW_STAGES.map((s) => [s, 0])) as Record<QueueFlowStage, number>;
  const flowTop = Object.fromEntries(QUEUE_FLOW_STAGES.map((s) => [s, [] as string[]])) as Record<QueueFlowStage, string[]>;
  const byArrival = items.slice().sort((a, b) => a.checkedInAtMs - b.checkedInAtMs || a.queueItemId.localeCompare(b.queueItemId));
  for (const it of byArrival) { const st = it.status as QueueFlowStage; if (!(st in flowCounts)) continue; flowCounts[st]++; if (flowTop[st].length < QUEUE_FLOW_TOP) flowTop[st].push(it.queueItemId); }

  const pop = items.filter((it) => PRIORITY_POP.has(it.status));
  const priorityCounts: Record<QueuePriority, number> = { urgent: 0, vip: 0, high: 0, normal: 0 };
  for (const it of pop) priorityCounts[it.priority] = (priorityCounts[it.priority] ?? 0) + 1;
  // rankQueue keeps the input order on ties → feed it arrival order (then id) so the result is deterministic
  const ranked = rankQueue(pop.slice().sort((a, b) => a.checkedInAtMs - b.checkedInAtMs || a.queueItemId.localeCompare(b.queueItemId)).map((it) => ({ queueItemId: it.queueItemId, waitedMinutes: minutesSince(it.checkedInAtMs, nowMs), priority: it.priority })), input.vipPriorityEnabled);
  const priorityOrder = ranked.slice(0, QUEUE_PRIORITY_SHOWN).map((r) => r.queueItemId);

  const loadBy: Record<string, number> = {}; for (const it of items) if (it.assignedTechId && it.status !== 'in_service') loadBy[it.assignedTechId] = (loadBy[it.assignedTechId] ?? 0) + 1;
  const { staff, staffSummary, onDuty } = projectOnDutyStaff(techs, loadBy, QUEUE_STAFF_SHOWN);
  const n = (s: StaffStatus) => onDuty.filter((x) => x.st === s).length;

  const waitLevel: Record<string, 'delayed' | 'normal'> = {};
  for (const it of items) waitLevel[it.queueItemId] = PRIORITY_POP.has(it.status) && minutesSince(it.checkedInAtMs, nowMs) > avg ? 'delayed' : 'normal';

  // ---- advisory insights, fixed order: longest delayed guest, VIP waiting, guests without a technician while some are
  //      free, appointments at no-show risk, the peak arrival hour ----
  const insights: QueueInsight[] = [];
  const waitingPop = pop.filter((it) => it.status !== 'assigned');
  const longest = pop.slice().sort((a, b) => a.checkedInAtMs - b.checkedInAtMs)[0];
  if (longest && minutesSince(longest.checkedInAtMs, nowMs) > avg) { const m = minutesSince(longest.checkedInAtMs, nowMs); insights.push({ id: 'longWait', text: `${longest.customerName} has waited ${m} min`, action: 'Open', route: `guest:${longest.queueItemId}`, severity: 'danger', vars: { name: longest.customerName, minutes: m } }); }
  const vip = pop.filter((it) => (it.isVip || it.priority === 'vip') && !it.assignedTechId).sort((a, b) => a.checkedInAtMs - b.checkedInAtMs)[0];
  if (vip && vip.queueItemId !== longest?.queueItemId) { const m = minutesSince(vip.checkedInAtMs, nowMs); insights.push({ id: 'vip', text: `${vip.customerName} has waited ${m} min`, sub: 'VIP guest. Recommend priority assignment.', action: 'Assign VIP Now', route: `assign:${vip.queueItemId}`, severity: 'warn', vars: { name: vip.customerName, minutes: m } }); }
  const unassigned = waitingPop.filter((it) => !it.assignedTechId).length; const free = n('Available');
  if (unassigned > 0 && free > 0) insights.push({ id: 'unassigned', text: `${unassigned} guests waiting for a technician · ${free} available`, action: 'Auto Balance Queue', route: 'balance', severity: 'info', vars: { count: unassigned, free } });
  const risk = pop.filter((it) => it.source === 'appointment' && minutesSince(it.checkedInAtMs, nowMs) > Math.max(15, avg)).length;
  if (risk > 0) insights.push({ id: 'noShow', text: `${risk} appointment guests waiting longer than expected`, severity: 'warn', vars: { count: risk } });
  if (input.peakHour != null) insights.push({ id: 'peak', text: `Peak arrival window: ${input.peakHour}:00 - ${(input.peakHour + 2) % 24}:00`, sub: 'High volume detected. Consider adding staff.', severity: 'info', vars: { fromHour: input.peakHour, toHour: (input.peakHour + 2) % 24 } });
  return { flowCounts, flowTop, priorityCounts, priorityOrder, staff, staffSummary, insights: insights.slice(0, QUEUE_INSIGHTS_MAX), waitLevel };
}

/** Projected revenue of a visit (§42): the approved price override when one exists, else the catalog price. Cancelled /
 *  removed visits never reach here (the caller passes active entries only). Integer cents. */
export const projectedServiceCents = (s: { priceCents?: number; priceOverrideCents?: number }) => Math.round(Number(s.priceOverrideCents ?? s.priceCents ?? 0)) || 0;

/** §15: every queue KPI's business definition — population, window and state criteria (also in the status report). */
export const QUEUE_KPI_DEFINITIONS: Record<string, string> = {
  waitingGuests: 'Active queue entries of this branch in waiting / called / assigned / ready_for_tech (now; in service, finished, cancelled and removed excluded).',
  walkInsWaiting: 'Of those, entries whose source is walk_in.',
  vipWaiting: 'Of those, entries marked VIP or with priority vip.',
  readyForAssignment: 'Of those, waiting or called entries with no assigned technician.',
  averageWaitMinutes: 'Mean of (now − checked_in_at) over the waiting population, whole minutes; null (—) when nobody is waiting.',
  estQueueRevenueCents: 'Projected (not earned): sum over the waiting population of each requested service line — approved price override, else catalog price; cancelled / removed visits excluded.',
  readyForService: 'Entries in assigned or ready_for_tech (a technician is set and the guest can be started).',
  noShowRisk: 'Appointment entries in the waiting population that have waited longer than max(15 min, average service minutes).',
  returnRatePercent: 'Of the distinct identified customers in the waiting population, the share with ≥1 prior paid visit; null (—) when no identified customer is waiting.',
};
