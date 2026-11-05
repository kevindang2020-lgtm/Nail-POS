// modules/workforce — the workforce domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { TechCashHandoffModule } from './tech-cash-handoff/tech-cash-handoff.module';
export { TechnicianClockPinModule } from './technician-clock-pin/technician-clock-pin.module';
export { TimeClockModule } from './time-clock/time-clock.module';
// Technician Profile merge (Oct 12 2026): the ONE authoritative technician operational state (579) + the port seam the
// assignment paths (queue / tech-queue / serving / booking / check-in / tech app) code against.
export { WorkforceStatusModule } from './workforce-status/workforce-status.module';
export { WorkforceStatusService, WorkforceStateError, type TechnicianOperationalState, type TransitionOptions } from './workforce-status/workforce-status.service';
export { type WorkforceState, type WorkforceFacts, type QueueStatus, type ClockStatus, type EmploymentStatus, deriveQueue, legacyStatusFor } from './workforce-status/workforce-status-core';
export { WORKFORCE_STATE_PORT, FailClosedWorkforceStatePort, PermissiveWorkforceStatePort, NoAvailabilityPort, FakeAvailabilityPort, type WorkforceStatePort, type WorkforceSnapshot, type AssignabilityVerdict, type AvailabilityPort, type AvailabilityQuery, type AvailabilityVerdict } from './workforce-status/workforce-ports';
export { WorkforceStatePortAdapter } from './workforce-status/workforce-state-port.adapter';
export { InMemoryWorkforceStateStore, type WorkforceStateStore } from './workforce-status/workforce-status.repository';
export { KyselyWorkforceStateStore } from './workforce-status/workforce-status.kysely.repository';
// The ONE technician access revocation / restoration chain (mandate §63/§137) — used by modules/super-admin (global tech admin)
// and modules/identity (login refusal); and the ONE eligibility writer (technician_services) the tech-app skill review uses.
export { revokeTechnicianAccess, restoreTechnicianAccess, restorePlatformTechnicianAccess, type RevokeTechnicianAccessInput, type RevokeTechnicianAccessResult, type RevokeRealtimeHook } from './technicians/revoke-technician-access';
export { grantEligibility, revokeEligibility, setTechnicianServices, normalizeProficiency, PROFICIENCIES, type Proficiency } from './technicians/technician-skills';
export { MediaAccessService } from './tech-profile/media-access.service';
export { signMediaUrl, verifyMediaSignature, mediaSignKey, classifyMediaKey, mediaKeyFromStored, validateSkillDocumentUpload, sniffDocumentType, isPubliclyServable, viewerMayRead, MEDIA_CONTENT_TYPES, type MediaObjectFacts, type MediaViewer } from './tech-profile/media-access-core';
// Technician Profile merge (Oct 12 2026, AUTH agent): THE ONE eligibility function (exact-service skills, certification,
// branch, employment; schedule/assignability through the ports). The ONE technician_services writer is
// ./technicians/technician-skills (WF agent) — exported above.
export { TechnicianEligibilityModule, AVAILABILITY_PORT } from './eligibility/technician-eligibility.module';
export { TechnicianEligibilityService, TechnicianEligibilityError, assertTechnicianEligible, certificationBlocks, KyselyEligibilityReader, InMemoryEligibilityReader, type EligibilityInput, type EligibilityActor, type EligibilityErrorCode, type EligibilityReader, type EligibilityDeps, type TechnicianEligibilityRecord } from './eligibility/technician-eligibility';
export * from './tech-cash-handoff/tech-cash-handoff.dto';
export * from './time-clock/time-clock.dto';
export { tchCtx, tchRun } from './tech-cash-handoff/tech-cash-handoff.http';   // used by the API today
export { TechCashHandoffService } from './tech-cash-handoff/tech-cash-handoff.service';   // used by the API today
export { recommendTechnician, scoreTechnician, skillMatch } from './tech-recommendation/tech-recommendation';   // used by the API today
export { loadTechUtilization } from './tech-utilization/tech-utilization';   // used by the API today
export { InMemoryClockPinRepository } from './technician-clock-pin/technician-clock-pin.repository';   // used by the API today
export { TechnicianClockPinService, KioskPinLockedError } from './technician-clock-pin/technician-clock-pin.service';   // used by the API today; the kiosk lockout error by go-check-in
export { InMemoryTimeClockRepository } from './time-clock/time-clock.repository';   // used by the API today
export { TimeClockService, TimeClockValidationError, TimeClockForbiddenError, TimeClockConflictError } from './time-clock/time-clock.service';   // used by the API today; the errors by the Technician App clock (Decision 9)
// joined by --into (pos-team, team-permissions):
export { PosTeamModule } from './pos-team/pos-team.module';
export { TeamPermissionsModule } from './team-permissions/team-permissions.module';
export { AccessGovernanceModule } from './access-governance/access-governance.module';   // BUILD_PLAN Phase 9: /pos/security (access reviews, high-risk, dormant, denials) + the dormant-account job
export * from './team-permissions/team-permissions.dto';
// joined by --into (compensation, payroll):
export { CompensationModule } from './compensation/compensation.module';
export { PayrollModule } from './payroll/payroll.module';
export * from './payroll/payroll.dto';
export { EarningsSnapshotRow, TechEarningsSummary, TechTicketReceipt, technicianEarningsSummary, ticketEarningsReceipt } from './compensation/compensation-earnings';   // used by the API today
export { computeTicketCompensation } from './compensation/compensation-engine';   // used by the API today
export { SnapshotSums } from './compensation/compensation-payroll';   // used by the API today
export { CompensationPreviewService } from './compensation/compensation-preview.service';   // used by the API today
export { CompensationReportsService } from './compensation/compensation-reports.service';   // used by the API today
export { loadEffectiveRules, resolveFromRules, resolveLineCommission } from './compensation/compensation-rule-loader';   // used by the API today
// Payroll merge (Oct 12 2026): the ONE commission precedence (rule → service rate → tenant default), the stamp-a-line
// routine the Service Done transition calls, the commission basis, per-line allocations and the earnings window resolver.
export { defaultCommissionForTenant, pickLineCommission, resolveLineCommissionWithDefault, stampCommissionOnLine, RULE_SOURCE_SERVICE_DEFAULT, RULE_SOURCE_TENANT_DEFAULT, type PickedLineCommission } from './compensation/compensation-rule-loader';
export { commissionableBaseCents, lineCommissionCents, PLATFORM_FALLBACK_COMMISSION_PERCENT } from './compensation/commission-basis';
export { allocateHelperOnLine, loadTicketAllocations, primaryHelperSplit, validateAllocations, writeLineAllocations, type LineAllocation } from './compensation/compensation-line-allocations';
export { resolveEarningsWindow, inWindow, MAX_CUSTOM_RANGE_DAYS, type EarningsWindow, type EarningsWindowPeriod } from './compensation/earnings-period';
export { TipAllocationService, TipAllocationError, validateTipAllocation } from './compensation/compensation-tip-allocation.service';
export { COUNTED_ADJUSTMENT_STATUSES } from './compensation/compensation-adjustments';
export { splitTipByPaymentMethod } from './compensation/compensation.kysely.ports';
export { CompensationSnapshotRepository } from './compensation/compensation-snapshot.repository';   // used by the API today
export { CompensationTipPolicyService } from './compensation/compensation-tip-policy.service';   // used by the API today
export { CompensationController } from './compensation/compensation.controller';   // used by the API today
export { KyselyCompensationPorts } from './compensation/compensation.kysely.ports';   // used by the API today
export { CompensationService } from './compensation/compensation.service';   // used by the API today
export { TicketCompensationInput } from './compensation/compensation.types';   // used by the API today
export { PayrollContext } from './payroll/payroll.repository';   // used by the API today
export { PayrollService } from './payroll/payroll.service';   // used by the API today
// Payroll mandate wave 2 (Oct 12 2026): the review / approval / payout workflow, the technician's own payroll reads,
// the recovery worker, and the pure pieces the API scripts / tests use
export { PayrollWorkflowService } from './payroll/payroll-workflow.service';
export { PayrollSelfService, type TechPayoutView, type TechInquiryView } from './payroll/payroll-self.service';
export { PayrollError, canonicalLineHash, evaluateValidation, lineNetAndPayable, payoutHeadroom, PAYROLL_CALCULATION_VERSION } from './payroll/payroll-workflow';
export { buildPayrollExport, centsToDecimalString } from './payroll/payroll-export';
export { NotConfiguredPayrollProvider, type PayrollProviderPort } from './payroll/payroll-provider.port';
export { CompensationRecoveryWorker } from './compensation/compensation-recovery';
// joined by --into (tech-profile, technicians, nail-showcase):
export { NailShowcaseModule } from './nail-showcase/nail-showcase.module';
export { TechProfileModule } from './tech-profile/tech-profile.module';
export { TechniciansModule } from './technicians/technicians.module';
export * from './nail-showcase/nail-showcase-social.dto';
export * from './nail-showcase/nail-showcase.dto';
export * from './technicians/technicians.dto';
export { CustomerTechController } from './tech-profile/customer-tech.controller';   // used by the API today
export { GlobalTechDirectory } from './tech-profile/global-tech-directory.kysely';   // used by the API today
export { GlobalTechIdentityService } from './tech-profile/global-tech-identity.service';   // used by the API today
export { validateImageUpload } from './tech-profile/tech-profile-core';   // used by the API today
export { branchRoleForLabel, isEndedMembership, ENDED_MEMBERSHIP_STATUSES, identityKeys } from './tech-profile/global-tech-identity-core';   // pure — modules/super-admin branch transfer
export { TechWorkplacesService } from './tech-profile/tech-workplaces.service';   // used by the API today
export { TechnicianAppAccessMiddleware } from './technicians/tech-app-access.middleware';   // used by the API today
export { TechniciansRepositoryPort } from './technicians/technicians.repository';   // used by the API today
// joined by --into (commission-report):
export { CommissionReportModule } from './commission-report/commission-report.module';
export * from './commission-report/commission-report.dto';
export { invalidateTechAppAccess, resetTechAppAccessCache, TECH_APP_DISABLED } from './technicians/tech-app-access.middleware';   // used by the API's tech-app-access wiring spec
export { KyselyNailShowcaseRepository } from './nail-showcase/nail-showcase.kysely.repository';   // used by the API's row-level-security cross-salon test
export { KyselyNailShowcaseSocialRepository } from './nail-showcase/nail-showcase-social.kysely.repository';   // used by the API's row-level-security cross-salon test
export { TechCashHandoffRepository } from './tech-cash-handoff/tech-cash-handoff.repository';   // used by the API's cash-handoff producer pgtest
export { KyselyTimeClockRepository } from './time-clock/time-clock.kysely.repository';   // used by the API's time-clock producer pgtest
export { KyselyPayrollRepository } from './payroll/payroll.kysely.repository';   // used by the API's payroll producer pgtest
export { MEDIA_STORAGE } from './tech-profile/tech-profile.service';   // merge Sep 2026: owner avatar upload injects the storage port
export { CommissionSecurityService, hashCommissionAuthCode, newCommissionAuthCode } from './technicians/commission-security.service';   // developer merge Sep 2026
// BUILD_PLAN Phase 9 (agent D): the salon's one approvals engine (pos/approvals + owner/approvals/requests; @Global token TENANT_APPROVALS)
export { TenantApprovalsModule, runApprovalExpiry } from './approvals/approvals.module';
export { TenantApprovalsService, TENANT_APPROVALS } from './approvals/approvals.service';   // used by the API's approvals wiring pgtest
export { KyselyTechniciansRepository } from './technicians/technicians.kysely.repository';   // used by the API's Phase 10 schedule-version pgtest
export { TECH_CASH_HANDOFF } from './tech-cash-handoff/tech-cash-handoff.repository';   // BUILD_PLAN Phase 12 (#27): this module's lifecycle state machines
export * from './workforce-lifecycles';   // BUILD_PLAN Phase 12 (#27): the workforce status machines (super-admin's Global Technician writers import TECH_SALON_MEMBERSHIP / TECH_PORTFOLIO_PHOTO)
// merge Oct 12 2026 (BK): the schedule engine behind the eligibility AvailabilityPort + the time-off request workflow
export { isTechnicianAvailableAt, workingWindows, type ScheduleFacts, type UnavailableReason, type AvailabilityResult } from './availability/availability-core';
export { KyselyAvailabilityPort, loadScheduleFacts } from './availability/availability-port.adapter';
export { TechnicianTimeOffModule } from './time-off/technician-time-off.module';
export { TechnicianTimeOffService, TimeOffError, validateTimeOff, type TimeOffCtx, type TimeOffInput } from './time-off/technician-time-off.service';
export { listTimeOff, type TimeOffRow, type TimeOffStatus, type TimeOffKind } from './time-off/time-off.store';
// Fair Turn Engine mandate (wave 2, Oct 12 2026): the technician TURN QUEUE — pure rules (turn-core), fairness analytics
// (turn-fairness) and THE ONE writer of technician_turn_state / technician_turn_events (turn-ledger), called inside the
// queue / workforce / Service Done transactions; the manager surface is TurnQueueModule.
export * from './turn-queue/turn-core';
export { computeFairness, explainTimeline, indicatorLabel, type FairnessReport, type FairnessRow, type TurnEventLike } from './turn-queue/turn-fairness';
export {
  turnClockIn, turnClockOut, turnBreakStart, turnBreakEnd, turnHold, turnRelease, turnReorder, turnAdjust, turnJoin, turnAssign, turnUnassign, turnDecline,
  turnOfferTimeout, turnCustomerDeclined, declinedTechniciansFor, turnServiceStart, turnServiceComplete, turnCloseDay, unclosedPastDays, readTurnDay, readTurnEvents,
  loadTurnContext, loadTurnRules, openAssignments, fairnessModeOf,
  type TurnDb, type TurnActor, type TurnLedgerOptions, type TurnContext, type TurnStateRow, type TurnEventRow, type TurnAssignInput, type TurnAssignResult, type TurnCommandResult,
} from './turn-queue/turn-ledger';
export { TurnQueueModule } from './turn-queue/turn-queue.module';
export { TurnQueueService, TurnQueueForbiddenError, periodRange, type TurnQueueContext, type BoardTechnician } from './turn-queue/turn-queue.service';
export { classifyBreak, mergeBreakPolicy, validateBreakPolicy, dailyHours, DEFAULT_BREAK_POLICY, type BreakPolicy, type BreakClassification } from './time-clock/break-policy';
