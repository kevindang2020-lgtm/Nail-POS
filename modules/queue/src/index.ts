// modules/queue — the queue domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { ServiceDoneModule } from './service-done/service-done.module';
export { ServingModule } from './serving/serving.module';
export { TechQueueModule } from './tech-queue/tech-queue.module';
export * from './tech-queue/tech-queue.dto';
export { KyselyServiceDoneRepository } from './service-done/service-done.kysely.repository';   // used by the API today
export { KyselyServingRepository } from './serving/serving.kysely.repository';   // used by the API today
export { ServingService } from './serving/serving.service';   // used by the API today
export { ForbiddenError as ServingForbiddenError, ValidationError as ServingValidationError, ConflictError as ServingConflictError } from './serving/serving.service';   // §74: mobile checkout maps the serving engine's refusals (they were 500s)
export { STAFF_BRANCH_ACCESS, type StaffBranchAccessPort } from './serving/manager-pin.kysely';   // Oct 28 2026: the API's composition root provides the location rule
export { TechQueueService } from './tech-queue/tech-queue.service';   // used by the API today
// joined by --into (queue, check-in):
export { CheckInModule } from './check-in/check-in.module';
export { QueueModule } from './queue/queue.module';
export { estimateWaitMinutes } from './check-in/check-in.dto';   // used by the API today
export { KyselyQueueRepository } from './queue/queue.kysely.repository';   // used by the API today
export { QueueContext } from './queue/queue.repository';   // used by the API today
export { QueueService } from './queue/queue.service';   // used by the API today
export { type QueuePriority } from './queue/queue.dto';   // used by the API today (entry audit)
export { rankQueue } from './queue/queue.dto';   // used by the API today (entry audit)
// BUILD_PLAN Phase 6 (ai_queue_assignment → complete): the recommender seam (the AI layer binds it) + the queue state model
export { QUEUE_RECOMMENDER, type QueueRecommenderPort, type QueueSuggestion, type QueueBalanceProposal, type QueueBalanceResult, type QueueTurnAdvice } from './queue/queue-recommender';
export { QueueAssignmentConflict, QueueAssignmentLocked, QueueRuleError, ForbiddenError as QueueForbiddenError, ValidationError as QueueValidationError } from './queue/queue.service';
export type {
  AssignTechnicianRequest, QueueAssignSource, QueueWriteSource, QueueItemLock, LockQueueItemRequest, UnlockQueueItemRequest, ReorderQueueRequest, QueueHistoryRow,
  CreateQueueGroupRequest, QueueGroupView, ServiceAssignmentsRequest, QueueServiceAssignmentView, TechnicianAvailabilityRow,
  QueueAssignmentEntryInput, QueueAssignmentCandidateInput, QueueAssignmentInputs, QueueScanEntry, AcceptAlternateRequest, CustomerAlternatesView,
  AutoBalancePreview, AutoBalanceProposal, POSQueueItemDetail, POSQueueItemRow,
} from './queue/queue.dto';
export { FINISHED_QUEUE_STATUSES, isActiveQueueStatus } from './queue/queue-signals';
export { nextTicketNumber } from './queue/ticket-number';   // Gift Cards mandate (Oct 29 2026): a gift-card-only sale opens its own numbered ticket
// joined by --into (go-check-in):
export { GoCheckInModule } from './go-check-in/go-check-in.module';
export * from './go-check-in/go-check-in.dto';
export { GoCheckInService, GoCheckInError } from './go-check-in/go-check-in.service';   // used by the API today (the error: the display's check-in session route, Unit 7)
// joined by --into (tech):
export { TechModule } from './tech/tech.module';
export * from './tech/tech-dashboard.dto';
export { TechContext, TechDataPort, TechTicketStatus, TechTicketView } from './tech/tech.repository';   // used by the API today
export { TechService } from './tech/tech.service';   // used by the API today
// joined by --into (live-technician-schedule, technician-help):
export { LiveTechnicianScheduleModule } from './live-technician-schedule/live-technician-schedule.module';
export { TechnicianHelpModule } from './technician-help/technician-help.module';
export * from './live-technician-schedule/live-technician-schedule.dto';
export { KyselyTechRepository } from './tech/tech.kysely.repository';   // used by the API's service-pause producer pgtest
export { KyselyHelpRepository } from './technician-help/technician-help.kysely.repository';   // used by the API's technician-help producer pgtest
export { KyselyTechQueueRepository } from './tech-queue/tech-queue.kysely.repository';   // used by the API's offer-expiry producer pgtest
