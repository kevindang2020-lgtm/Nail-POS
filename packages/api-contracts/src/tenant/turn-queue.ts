// turn-queue.ts — the technician TURN QUEUE wire contract (Fair Turn Engine mandate, wave 2 Oct 12 2026). Served by
// modules/workforce/src/turn-queue (turn-queue.controller.ts) and the fair-turn simulation of modules/ai. Units on the
// wire are hundredths of a turn (`*Units`: 100 = 1.00 turn) unless the field says `turns`. Money is integer cents and only
// present when the caller holds a payroll / pay permission (manager) — or is the technician herself (her own).

import type { CodedText } from '../text/coded-text';

export type TurnAssignmentMode = 'AUTOMATIC' | 'RECOMMEND_AND_CONFIRM' | 'MANUAL';
export type TurnFairnessMode = 'traditional_weighted_rotation' | 'lowest_turn_units' | 'workload_balanced' | 'hybrid_fairness' | 'manual_order';
export type TurnBoardStatus = 'CLOCKED_IN' | 'READY' | 'ASSIGNED' | 'SERVING' | 'BREAK' | 'HOLD' | 'UNAVAILABLE' | 'CLOCKED_OUT' | 'NEXT_UP' | 'APPOINTMENT_SOON' | 'ASSIGNMENT_OFFERED' | 'OFF_SHIFT';
export type TurnBoardColumn = 'NEXT_READY' | 'SERVING' | 'APPOINTMENT_SOON' | 'BREAK_HOLD' | 'OFF_SHIFT';

export interface TurnMoneyToday { serviceSalesCents: number; commissionCents: number; tipsCents: number; retailCommissionCents: number; estimatedEarningsCents: number }
export interface TurnBoardTechnician {
  technicianId: string; name: string; avatarUrl: string | null; rank: number | null; status: TurnBoardStatus; column: TurnBoardColumn; inRotation: boolean; holdReason: string | null;
  turnUnitsToday: number; inProgressUnits: number; fullTurns: number; partialTurns: number; walkInsToday: number; appointmentsToday: number;
  nextAppointmentAt: string | null; nextAppointmentInMinutes: number | null; currentService: { queueItemId: string; label: string } | null;
  readySince: string | null; readyMinutes: number | null; clockedMinutes: number; onBreakSince: string | null; skipsToday: number; basis: string | null;
  /** `basis` as a code + vars (srv.TURN_BASIS.*) — Vietnamese POS §21; `basis` stays the English sentence */
  basisText?: CodedText | null;
  money?: TurnMoneyToday | null;
}
export interface TurnBoardResponse {
  businessDate: string; timeZone: string; mode: TurnFairnessMode; modeLabel: string; rotationPolicy: string; assignmentMode: TurnAssignmentMode; policyVersion: string;
  nextUpTechnicianId: string | null; technicians: TurnBoardTechnician[]; moneyVisible: boolean; serverTime: string;
}
export interface TurnHealthResponse {
  businessDate: string; waitingCustomers: number; readyTechnicians: number; longestCustomerWaitMinutes: number; longestTechnicianReadyMinutes: number;
  techniciansServing: number; techniciansOnBreak: number; upcomingAppointmentsNextHour: number;
  exceptions: { code: string; severity: 'info' | 'warning'; text: string; /** the numbers / names in `text` (the POS words `code` itself) */ vars?: Record<string, string | number>; technicianId?: string; businessDate?: string }[];
}
export interface TurnHistoryEvent {
  id: string; businessDate: string; sequenceNumber: number; technicianId: string; technicianName: string | null; eventType: string; statusBefore: string | null; statusAfter: string | null;
  queueItemId: string | null; appointmentId: string | null; serviceId: string | null; turnUnits: number; turnUnitsDelta: number; turnRuleId: string | null; turnRuleVersion: number | null;
  reasonCode: string | null; reasonText: string | null; assignmentSource: string | null; assignmentKind: string | null; recommendedTechnicianId: string | null;
  positionBefore: number | null; positionAfter: number | null; policyVersion: string | null; actorType: string; actorId: string | null; occurredAt: string;
  orderBefore: string[] | null; orderAfter: string[] | null; text: string;
  /** `text` as a code + vars (srv.TURN_EVENT.*); `kind` / `reason` vars are codes */
  textCoded?: CodedText | null;
}
export interface TurnHistoryResponse { from: string; to: string; events: TurnHistoryEvent[] }
export interface TurnFairnessRow {
  technicianId: string; name: string | null; readyMinutes: number; eligibleWorkingMinutes: number; eligibleHours: number;
  actualUnits: number; expectedUnits: number; gapUnits: number; indicator: 'WITHIN_FAIR_RANGE' | 'BELOW_EXPECTED_OPPORTUNITY' | 'ABOVE_EXPECTED_OPPORTUNITY'; indicatorLabel: string;
  creditedUnits: number; adjustmentUnits: number; walkIns: number; requestedWalkIns: number; firstAvailableWalkIns: number; appointments: number;
  automaticAssignments: number; manualAssignments: number; overrides: number; skips: number; skipsByReason: Record<string, number>; voluntaryDeclines: number;
  averageReadyWaitMinutes: number | null; opportunityRatePerReadyHour: number | null;
}
export interface TurnFairnessResponse {
  from: string; to: string; timeZone: string; rows: TurnFairnessRow[]; methodology: string; /** srv.TURN_METHODOLOGY.<code> */ methodologyCode?: string; operationalDiagnosticNotPayroll: true;
  team: { opportunities: number; opportunityUnits: number; automaticRecommendations: number; automaticAssignments: number; confirmedRecommendations: number; manualAssignments: number; overrides: number; overrideRate: number | null; skipsByReason: Record<string, number> };
}
export interface TurnTimeSummary { clockedMinutes: number; paidBreakMinutes: number; unpaidBreakMinutes: number; interruptedBreaks: number; eligibleWorkedMinutes: number; serviceMinutes: number; readyMinutes: number; holdMinutes: number; idleMinutes: number; utilization: number | null }
export interface TurnPeriodSummary {
  period: 'day' | 'week' | 'month'; from: string; to: string; time: TurnTimeSummary;
  walkIns: { assigned: number; completed: number; requested: number; firstAvailable: number };
  appointments: { scheduled: number; completed: number; canceled: number; noShow: number; rescheduled: number; requestedTechnician: number; anyTechnician: number };
  turns: { turnUnits: number; fullTurns: number; partialTurns: number; automaticAssignments: number; manualAssignments: number; eligibleSkips: number; voluntaryDeclines: number; managerOverrides: number; averageReadyWaitMinutes: number | null; queueOpportunityRate: number | null };
  branches: string[];
  money: null | { serviceSalesCents: number; commissionCents: number; tipsCents: number; cardTipsCents: number; cashTipsCents: number; retailCommissionCents: number; adjustmentsCents: number | null; estimatedEarningsCents: number; approvedCents: number | null; paidCents: number | null; source: 'payroll_snapshot'; status: string };
}
export interface TurnTechnicianSummaryResponse extends TurnPeriodSummary { technicianId: string; name: string; previous?: TurnPeriodSummary; trend?: Record<string, number | null> }
export interface TurnTeamReportResponse {
  period: 'day' | 'week' | 'month'; from: string; to: string; timeZone: string; moneyVisible: boolean;
  rows: (TurnPeriodSummary & { technicianId: string; name: string; fairnessGapUnits: number | null; fairnessIndicator: string | null; /** the indicator's code (WITHIN_FAIR_RANGE …) — the POS labels it in the cashier's language */ fairnessIndicatorCode?: TurnFairnessResponse['rows'][number]['indicator'] | null; turnUnitsPerEligibleHour: number | null })[];
  totals: Record<string, number | null>;
  methodology: Record<string, string>;
}
export interface TurnSettingsInfo {
  effective: { assignmentMode: TurnAssignmentMode; fairnessMode: string; turnPolicy: Record<string, unknown>; policyVersion: string };
  recommended: { assignmentMode: TurnAssignmentMode; fairnessMode: TurnFairnessMode; turnPolicy: Record<string, unknown> };
  vocabulary: { assignmentModes: readonly string[]; fairnessModes: { value: string; label: string }[]; overrideReasons: readonly string[]; declineReasons: readonly string[]; skipReasons: { value: string; label: string }[] };
  canManage: boolean;
}
export interface TurnSettingsPreview { changes: { key: string; current: unknown; next: unknown; outcome: string }[] }
export interface TurnUnitRuleView { id: string; ruleKey: string; version: number; scope: 'service' | 'category' | 'duration'; serviceId: string | null; serviceName: string | null; category: string | null; maxDurationMinutes: number | null; turnUnits: number; turns: number; specialRotation: boolean; active: boolean; reason: string | null; createdBy: string | null; createdAt: string | null; supersededAt: string | null }
export interface TurnRulesResponse { defaultTurnUnits: number; rules: TurnUnitRuleView[] }
export interface TurnRuleSaveRequest { ruleKey?: string; scope: 'service' | 'category' | 'duration'; serviceId?: string; category?: string; maxDurationMinutes?: number; turns: number | string; specialRotation?: boolean; reason?: string }
export interface TurnCommandResult { businessDate: string; technicianIds: string[]; events: string[]; order?: string[] }
/** POST /pos/turn-queue/day/close — only a finished business day closes (DAY_CLOSE per technician row). */
export interface TurnDayCloseResult { closed: number }
/** POST /pos/turn-queue/rules — the new version of the rule (the previous one is superseded, kept in history). */
export interface TurnRuleSaveResult { id: string; ruleKey: string; version: number }
export interface TurnRuleRetireResult { retired: boolean }
export interface TurnSimulationRequest {
  mode?: TurnFairnessMode; turnPolicy?: Record<string, unknown>; serviceMinutes?: number; requestedName?: string | null; serviceLabel?: string | null;
  technicians: { name: string; turns?: number; readyMinutes?: number; serviceMinutes?: number; skillEligible?: boolean; onBreak?: boolean; onHold?: boolean; appointmentInMinutes?: number | null; clockedIn?: boolean; position?: number }[];
}
export interface TurnSimulationResponse {
  mode: TurnFairnessMode; recommended: string | null; why: string[]; skipped: { name: string; reason: string; text: string; /** `text` as code + vars */ textCoded?: CodedText }[];
  /** `why` line by line as code + vars (same length and order) */
  whyCoded?: CodedText[];
  ranking: { name: string; turnRank: number | null; eligible: boolean; reasons: string[]; effectiveTurns: number | null; readyMinutes: number | null }[]; productionStateChanged: false;
}
/** GET /tech/turn-queue — the Technician App (§94–96). `team` is only what the salon's visibility allows; never money. */
export interface TechTurnQueueView {
  businessDate: string; visibility: 'FULL_TEAM_QUEUE' | 'POSITION_ONLY' | 'NEXT_FEW' | 'PRIVATE_POSITION';
  myRank: number | null; queueLength: number | null; myStatus: TurnBoardStatus | null;
  team: { name: string | null; rank: number; status: TurnBoardStatus; isMe: boolean }[];
  me: null | { status: TurnBoardStatus; rank: number | null; turnsToday: number; inProgressTurns: number; walkInsToday: number; appointmentsToday: number; nextAppointmentAt: string | null; currentCustomer: { queueItemId: string; label: string } | null; readySince: string | null; onBreakSince: string | null; holdReason: string | null };
  myEarningsToday: TurnPeriodSummary['money'];
  fetchedAt: string;
}
