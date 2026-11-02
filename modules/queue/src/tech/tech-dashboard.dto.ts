import type { TechMe, TechTodayOverview, TechCurrentService, TechNextAppointment, TechScheduleItem, TechEarningsSnapshot, TechEarningsLine, TechEarningsDetail, TechAvailableActions, TechDashboardState, TechnicianStatus, EarningsPeriod } from '@aipowersalon/api-contracts/tenant';
export type { TechMe, TechTodayOverview, TechCurrentService, TechNextAppointment, TechScheduleItem, TechEarningsSnapshot, TechEarningsLine, TechEarningsDetail, TechAvailableActions, TechDashboardState, TechnicianStatus, EarningsPeriod };   // owned by packages/api-contracts (Constitution 13 §13)
// tech-dashboard.dto.ts — AIPowerSalon Technician Mobile Dashboard contracts.
// Tenant- and technician-scoped: every endpoint derives tenant/branch/technician from the session.
// A tenantId or technicianId in the request body is ignored/rejected (spec §19).









// Pure, testable calendar range for an earnings period, using LOCAL-time boundaries (consistent with the existing
// start-of-today logic). Week starts Monday. Returns a half-open interval [fromIso, toIso).
export interface EarningsRange { period: EarningsPeriod; fromMs: number; toMs: number; fromIso: string; toIso: string }
export function earningsRange(period: EarningsPeriod, anchorMs: number = Date.now()): EarningsRange {
  const a = new Date(anchorMs);
  let from: Date;
  if (period === 'week') { const dow = (a.getDay() + 6) % 7; from = new Date(a.getFullYear(), a.getMonth(), a.getDate() - dow, 0, 0, 0, 0); }
  else if (period === 'month') { from = new Date(a.getFullYear(), a.getMonth(), 1, 0, 0, 0, 0); }
  else { from = new Date(a.getFullYear(), a.getMonth(), a.getDate(), 0, 0, 0, 0); }
  let to: Date;
  if (period === 'week') to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7, 0, 0, 0, 0);
  else if (period === 'month') to = new Date(from.getFullYear(), from.getMonth() + 1, 1, 0, 0, 0, 0);
  else to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 0);
  return { period, fromMs: from.getTime(), toMs: to.getTime(), fromIso: from.toISOString(), toIso: to.toISOString() };
}



// ---- request bodies (most actions are param-only: /tech/tickets/:id/{accept,start-service,service-done}) ----
export interface ToggleBreakRequest { managerOverride?: boolean; managerPin?: string; }

// ---- §10 elapsed seconds from startedAt (pure) ----
export function elapsedSecondsFrom(startedAtIso: string, nowMs: number = Date.now()): number {
  const started = Date.parse(startedAtIso);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((nowMs - started) / 1000));
}

// ---- §13 Break guard: cannot break during active service unless manager override ----
export function canStartBreak(status: TechnicianStatus, hasActiveService: boolean, managerOverride: boolean): boolean {
  if (status === "in_service" || hasActiveService) return managerOverride;
  return status === "available" || status === "assigned";
}

// ---- §15 derive availableActions from current state (pure) ----
export function deriveAvailableActions(
  status: TechnicianStatus,
  hasAssignedUnacceptedTicket: boolean,
  hasAcceptedNotStarted: boolean,
  hasActiveService: boolean,
): TechAvailableActions {
  return {
    canAcceptTicket: hasAssignedUnacceptedTicket,
    canStartService: hasAcceptedNotStarted,
    canMarkServiceDone: hasActiveService,
    canToggleBreak: status === "on_break" || status === "lunch" || (!hasActiveService && (status === "available" || status === "assigned")),
  };
}

// ---- §12/§20 today's paid lines: SALES only. ONE-PAY (Oct 13 2026): the commission / tips on the Tech App come from the
// compensation snapshot (TechService.todayFromSnapshot) — the line-rate formula that used to live here (commissionForLine /
// earningsSnapshot) is gone; without the authority the money is null + a note, never an estimate.
export interface LineSnapshot {
  lineTotalCents: number;
}
export const EARNINGS_UNAVAILABLE_NOTE = 'Commission and tips come from payroll (the compensation snapshot), which is not available right now.';
export function salesOnlySnapshot(lines: LineSnapshot[]): TechEarningsSnapshot {
  return { todaySalesCents: lines.reduce((a, l) => a + (Number(l.lineTotalCents) || 0), 0), tipsCents: null, estimatedCommissionCents: null, note: EARNINGS_UNAVAILABLE_NOTE };
}
