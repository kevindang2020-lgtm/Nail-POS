// BUILD_PLAN Phase 12 (#17): the AI module's body validation, route by route on the real controllers — the bodies the
// clients send today (pos-web posAiApi / posAIMarketingApi / posAIMoneyProtectionApi / posAiReviewReputationApi /
// posAiSchedulingOptimizerApi / posAIVoiceTranscriptionApi / posAiCustomerProfileApi / posAiGovernanceApi, customer-web,
// admin-web, the voice integration) pass intact, unknown fields are stripped (kept where the service refuses them
// itself), a bad body is a 400 VALIDATION_FAILED naming the field, an undeclared tenantId is refused.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { bodyPipeOf } from '@aipowersalon/permissions/guards';
import { routeBodyFailures, type RouteBodyCase } from '@aipowersalon/testing';
import { validateBody } from '@aipowersalon/permissions';
import { AiAssistantController as Ast } from './ai/ai-assistant.controller';
import { TenantAiDashboardController as Dash } from './ai/ai-control-plane.controller';
import { AiSubscriptionBillingController as Bill } from './ai/ai-subscription-billing.service';
import { AiCenterController as Ctr } from './ai-center/ai-center.controller';
import { AiCustomerProfileController as Prof } from './ai-customer-profile/ai-customer-profile.controller';
import { CustomerAiSettingsCenterController as Cas } from './ai-customer-profile/customer-ai-settings-center.controller';
import { AiGovernanceController as Gov } from './ai-governance/ai-governance.controller';
import { AiInventoryController as Inv } from './ai-inventory/ai-inventory.controller';
import { AiMarketingController as Mkt } from './ai-marketing/ai-marketing.controller';
import { MoneyProtectionController as Mp } from './ai-money-protection/ai-money-protection.controller';
import { QueueAssignmentOpsController as AqOps } from './ai-queue-assignment/ai-queue-assignment-ops.controller';
import { QueueSuperAdminController as AqSa } from './ai-queue-assignment/ai-queue-assignment-superadmin.controller';
import { QueueAssignmentController as Aq } from './ai-queue-assignment/ai-queue-assignment.controller';
import { AiRevenueController as Rev } from './ai-revenue/ai-revenue.controller';
import { AiReviewReputationController as Rr } from './ai-review-reputation/ai-review-reputation.controller';
import { AiSchedulingOpsController as SchOps } from './ai-scheduling-optimizer/ai-scheduling-ops.controller';
import { CustomerScheduleProposalsController as SchCust } from './ai-scheduling-optimizer/ai-scheduling-proposals.customer.controller';
import { AiSchedulingController as Sch } from './ai-scheduling-optimizer/ai-scheduling.controller';
import { VoiceTranscriptionController as Vt, VoiceTranscriptionSuperAdminController as VtSa, VoiceTranscriptionWebhookController as VtWh } from './ai-voice-transcription/ai-voice-transcription.controller';
import { CallIntelligenceController as Ci } from './call-intelligence/call-intelligence.controller';
import { AiReceptionistGatewayController as Gw } from './voice-booking/ai-receptionist-gateway.controller';
import { AiReceptionistVerificationController as GwV } from './voice-booking/ai-receptionist-verification.controller';
import { TenantReceptionistController as Rcp } from './voice-booking/tenant-receptionist.controller';
import { AiFollowUpCenterController as Fuc } from './ai-center/ai-follow-up-center.controller';
import { VoiceBookingController as Vb } from './voice-booking/voice-booking.controller';
import { WorkflowRunsController as Wf } from './workflow-runs/workflow-runs.controller';
import { AI_DASHBOARD_FEEDBACK_BODY, AI_MARKETING_AUDIENCE_BODY, MONEY_INVESTIGATION_RESOLVE_BODY, RECEPTIONIST_SETTINGS_BODY } from './request-schemas';

const ID = '22222222-2222-4222-8222-222222222222';
const c = (route: string, ctl: any, handler: string, today: Record<string, unknown>[], bad: [unknown, string], keepsUnknown = false): RouteBodyCase => ({ route, ctl, handler, today, bad, keepsUnknown });
const CASES: RouteBodyCase[] = [
  // assistant / dashboard / billing
  c('POST /ai/ocr/scan-receipt', Ast, 'scanReceipt', [{ imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png' }], [{ imageBase64: 5, mimeType: 'image/png' }, 'imageBase64']),
  c('POST /ai/:packageCode', Ast, 'invoke', [{ prompt: 'Write a thank-you text' }, { action: 'summarize', prompt: 'x' }], [{ action: ['x'] }, 'action']),
  c('POST /ai/dashboard/settings', Dash, 'putSettings', [{ settings: { automation: { 'review.response_draft': 'SUGGEST_ONLY' }, autoActionsDisabled: true, disabledTools: ['send_sms'] } },
    // N-4: exactly what POSAiSettingsEditor sends — killSwitch is declared, so the route is strict
    { settings: { automation: { 'review.response_draft': 'DRAFT' }, killSwitch: true } }], [{ settings: { disabledTools: 'send_sms' } }, 'settings.disabledTools']),
  c('POST /ai/dashboard/feedback', Dash, 'submitFeedback', [{ requestId: 'req-1', taskKey: 'review.response_draft', promptKey: 'review.draft', promptVersion: 3, outcome: 'edited', retainedRatio: 0.6, reasonCode: 'tone', note: 'too formal' }], [{ requestId: 'r', draftText: 'the customer said…' }, 'draftText']),
  // AI Center / Reception Copilot
  c('POST /tenant/ai/center/copilot', Ctr, 'copilot', [{ prompt: 'Who is booked at 3?' }], [{ prompt: [] }, 'prompt']),
  c('POST /tenant/ai/center/copilot/context', Ctr, 'copilotCtx', [{ phone: '6095551234' }, { customerId: ID }], [{ phone: {} }, 'phone']),
  c('POST /tenant/ai/center/copilot/availability', Ctr, 'copilotAvailability', [{ date: '2026-10-08' }, { date: '2026-10-08', serviceIds: [ID], technicianId: ID }], [{ serviceIds: ID }, 'serviceIds']),
  c('POST /tenant/ai/center/copilot/conflict', Ctr, 'copilotConflict', [{ technicianId: ID, startTime: '14:00', endTime: '15:00', date: '2026-10-08' }], [{ technicianId: 5 }, 'technicianId']),
  c('POST /tenant/ai/center/copilot/technicians', Ctr, 'copilotTechnicians', [{ date: '2026-10-08' }], [{ date: 20261008 }, 'date']),
  c('POST /tenant/ai/center/copilot/draft-message', Ctr, 'copilotDraft', [{ kind: 'reminder', phone: '6095551234' }], [{ kind: ['reminder'] }, 'kind']),
  c('POST /tenant/ai/center/copilot/intent', Ctr, 'copilotIntent', [{ text: 'I want to move my 3pm' }], [{ text: 7 }, 'text']),
  c('POST /tenant/ai/center/copilot/explain-service', Ctr, 'copilotExplainService', [{ serviceId: ID }], [{ serviceId: {} }, 'serviceId']),
  c('POST /tenant/ai/center/copilot/next-actions', Ctr, 'copilotNextActions', [{ intent: 'book', hasAvailability: true, customerKnown: false }], [{ hasAvailability: 'yes' }, 'hasAvailability']),
  c('POST /tenant/ai/center/copilot/session/start', Ctr, 'copilotSessionStart', [{ channel: 'phone' }, {}], [{ channel: 1 }, 'channel']),
  c('POST /tenant/ai/center/copilot/session/end', Ctr, 'copilotSessionEnd', [{ sessionId: ID }], [{ sessionId: [] }, 'sessionId']),
  c('POST /tenant/ai/center/copilot/recommendation', Ctr, 'copilotRecordReco', [{ sessionId: ID, kind: 'technician', payload: { technicianId: ID } }], [{ payload: 'x' }, 'payload']),
  c('POST /tenant/ai/center/copilot/feedback', Ctr, 'copilotFeedbackRecord', [{ recommendationId: ID, sessionId: ID, rating: 'up', reason: 'helpful' }], [{ rating: {} }, 'rating']),
  c('POST /tenant/ai/center/copilot/learning/approve', Ctr, 'copilotLearnApprove', [{ suggestionId: ID, content: 'We close at 7 on Fridays' }], [{ suggestionId: {} }, 'suggestionId']),
  c('POST /tenant/ai/center/copilot/learning/dismiss', Ctr, 'copilotLearnDismiss', [{ suggestionId: ID }], [{ suggestionId: [] }, 'suggestionId']),
  c('POST /tenant/ai/center/copilot/take-over-call', Ctr, 'copilotTakeOver', [{ providerCallId: 'call_1', destination: '+16095551234', destinationType: 'phone' }], [{ providerCallId: 1 }, 'providerCallId']),
  c('PATCH /tenant/ai/center/copilot/settings', Ctr, 'copilotPatchSettings', [{ allowCancel: false }, { level: 'branch', enabled: true }], [{ allowCancel: 'false' }, 'allowCancel']),
  // customer profile / governance / inventory
  c('POST /pos/ai-customer-profile/duplicates/:groupId/merge', Prof, 'merge', [{ primaryCustomerId: ID, confirm: true }], [{ primaryCustomerId: ID, confirm: 'yes' }, 'confirm']),
  // PUT /pos/ai-customer-profile/settings/:level is retired; the settings writes are the Customer AI Settings routes
  c('POST /pos/customer-ai-settings/assistant', Cas, 'assistant', [{ enabled: false, expectedVersion: 0, reason: 'closing for renovation' }], [{ enabled: 'no', expectedVersion: 0 }, 'enabled']),
  c('POST /pos/customer-ai-settings/thresholds', Cas, 'thresholds', [{ values: { inactiveDays: 60 }, expectedVersion: 1 }, { reset: true, expectedVersion: 2 }], [{ values: { inactiveDays: 60 }, expectedVersion: 'x' }, 'expectedVersion']),
  c('PATCH /tenant/ai/control-modes/:assistantKey', Gov, 'set', [{ mode: 'suggest_only' }], [{ mode: 1 }, 'mode']),
  c('POST /pos/ai-inventory/recipes', Inv, 'createRecipe', [{ serviceId: ID, notes: 'gel set', lines: [{ productId: ID, expectedQuantity: 2, consumptionUnit: 'ml', wasteAllowancePct: 5 }] }], [{ serviceId: ID, lines: [{ productId: ID, expectedQuantity: '2' }] }, 'lines[0].expectedQuantity']),
  // marketing
  c('POST /pos/ai-marketing/audience/preview', Mkt, 'previewAudience', [{ channel: 'sms', minDaysSinceLastCompletedVisit: 60, birthdayMonth: 'current' }], [{ channel: 'sms', excludeWithFutureAppointment: 'no' }, 'excludeWithFutureAppointment'], true),
  c('POST /pos/ai-marketing/content/draft', Mkt, 'generateDraft', [{ channel: 'sms', tone: 'friendly', salonName: 'Bella Nails', campaignType: 'win_back', offer: { name: '10% off', endDateLabel: 'Oct 31' } }], [{ channel: 'sms', offer: 'x' }, 'offer']),
  c('POST /pos/ai-marketing/campaigns', Mkt, 'submitCampaign', [{ name: 'Win back', channel: 'sms', draftText: 'We miss you {{first_name}}!', audienceLabel: '60+ days', audienceSize: 42, estimatedCostCents: 84, audienceDefinition: { channel: 'sms', minDaysSinceLastCompletedVisit: 60 } }], [{ name: 'x', status: 'approved' }, 'status']),
  c('POST /pos/ai-marketing/campaigns/:id/approve', Mkt, 'approveCampaign', [{ scheduledAt: '2026-10-10T15:00:00Z' }], [{ scheduledAt: 5 }, 'scheduledAt']),
  // money protection
  c('POST /pos/ai-money-protection/settings/:ruleId', Mp, 'updateSetting', [{ enabled: true, severityOverride: 'high', thresholds: { voidsPerShift: 4 } }], [{ enabled: 'on' }, 'enabled']),
  c('POST /pos/ai-money-protection/investigations', Mp, 'createInvestigation', [{ title: 'Voids on register 2', category: 'voids', severity: 'high', alertIds: [ID] }], [{ title: 'x', alertIds: ID }, 'alertIds']),
  c('POST /pos/ai-money-protection/investigations/:id/notes', Mp, 'addNote', [{ body: 'Reviewed the camera' }], [{ body: [] }, 'body']),
  c('POST /pos/ai-money-protection/investigations/:id/assign', Mp, 'assign', [{ assigneeUserId: ID }], [{ assigneeUserId: 1 }, 'assigneeUserId']),
  c('POST /pos/ai-money-protection/investigations/:id/status', Mp, 'updateStatus', [{ status: 'in_review' }], [{ status: ['x'] }, 'status']),
  c('POST /pos/ai-money-protection/investigations/:id/resolve', Mp, 'resolve', [{ resolution: 'confirmed_loss', recoveryAmountCents: 2500 }, { resolution: 'no_issue' }], [{ resolution: 'x', paymentStatus: 'refunded' }, 'paymentStatus']),
  // queue assignment
  c('POST /pos/ai-queue-assignment/alerts/:id/acknowledge', AqOps, 'acknowledge', [{ note: 'on it' }, {}], [{ note: 5 }, 'note']),
  c('POST /pos/ai-queue-assignment/alerts/:id/resolve', AqOps, 'resolve', [{ note: 'done' }], [{ note: {} }, 'note']),
  c('POST /pos/ai-queue-assignment/alerts/:id/repair', AqOps, 'repair', [{ action: 'reassign', reason: 'tech left', queueItemId: ID, technicianId: ID }], [{ action: 1 }, 'action']),
  c('PUT /pos/ai-queue-assignment/settings', AqOps, 'putSettings', [{ scope: 'branch', patch: { rotationPolicy: 'round_robin' }, expectedVersion: 3, reason: 'busy season' }, { clear: ['rotationPolicy'] }], [{ patch: 'x' }, 'patch']),
  c('PUT /pos/ai-queue-assignment/wait-thresholds', AqOps, 'setThresholds', [{ approachingMin: 10, exceededMin: 15, severeMin: 25, criticalMin: 40, expectedVersion: 2 }], [{ approachingMin: [10] }, 'approachingMin']),
  c('POST /super-admin/ai-queue-assignment/tenants/:tenantId/auto-kill', AqSa, 'autoKill', [{ killed: true, reason: 'bad recommendations' }], [{ killed: 'yes' }, 'killed']),
  c('POST /pos/ai-queue-assignment/recommendations/:id/decision', Aq, 'decide', [{ decision: 'accept' }, { decision: 'override', chosenTechnicianId: ID, reason: 'requested', feedbackCode: 'customer_request', idempotencyKey: 'k' }], [{ decision: 1 }, 'decision']),
  c('POST /pos/ai-queue-assignment/plans/:recommendationId/decision', Aq, 'decidePlan', [{ decision: 'accepted', idempotencyKey: 'click-1' }, { decision: 'adjusted', lines: [{ queueItemId: ID, serviceId: ID, technicianId: ID }], reason: 'regular', feedbackCode: 'customer_request', idempotencyKey: 'k' }, { decision: 'rejected', reason: 'guest wants one person' }], [{ decision: 'adjusted', lines: [{ queueItemId: ID, serviceId: ID, technicianId: [ID] }] }, 'lines[0].technicianId']),
  c('POST /pos/ai-queue-assignment/auto/kill', Aq, 'killAuto', [{ scope: 'branch', reason: 'testing' }], [{ scope: 5 }, 'scope']),
  c('POST /pos/ai-queue-assignment/auto/unkill', Aq, 'unkillAuto', [{ scope: 'salon' }], [{ reason: [] }, 'reason']),
  c('PUT /pos/ai-queue-assignment/rotation-policy', Aq, 'setPolicy', [{ policy: 'fixed_order', fixedOrder: [ID], expectedVersion: 4, reason: null }], [{ policy: 'fixed_order', fixedOrder: ID }, 'fixedOrder']),
  c('PUT /pos/ai-queue-assignment/auto-config', Aq, 'setAutoConfig', [{ enabled: true, confidenceFloor: 0.8, maxPerRun: 3, delaySeconds: 30, exclusions: { vip: true, technicianIds: [ID] }, expectedVersion: 5 }], [{ exclusions: { vip: 'yes' } }, 'exclusions.vip']),
  // revenue / call intelligence / workflow runs
  c('POST /tenant/ai/revenue/attributions', Rev, 'record', [{ dedupeKey: 'upsell:1', source: 'checkout_upsell', kind: 'upsell', ticketId: ID, amountCents: 1500 }], [{ dedupeKey: 'k', amountCents: '15' }, 'amountCents']),
  c('POST /tenant/ai/call-intelligence/events', Ci, 'ingest', [{ providerCallId: 'call_1', status: 'completed', aiHandled: true, durationSeconds: 95, outcome: 'booked', direction: 'inbound' }], [{ providerCallId: 'c', durationSeconds: '95' }, 'durationSeconds']),
  c('POST /tenant/ai/workflows/runs', Wf, 'record', [{ workflowKey: 'rebook_reminder', dedupeKey: 'rr:1', status: 'sent', customerId: ID }], [{ workflowKey: 1 }, 'workflowKey']),
  // review & reputation
  c('POST /pos/ai-review-reputation/sync', Rr, 'sync', [{ source: 'google', since: null }], [{ source: 1 }, 'source']),
  c('POST /pos/ai-review-reputation/:id/draft', Rr, 'draft', [{ directive: 'generate', reviewText: null }, { directive: 'shorter', reviewText: 'Great service' }], [{ directive: {} }, 'directive']),
  c('POST /pos/ai-review-reputation/:id/reject', Rr, 'reject', [{ reason: 'off tone' }], [{ reason: 1 }, 'reason']),
  c('POST /pos/ai-review-reputation/escalations/:id/assign', Rr, 'assign', [{ userId: ID }], [{ userId: {} }, 'userId']),
  c('POST /pos/ai-review-reputation/escalations/:id/resolve', Rr, 'resolve', [{ reviewId: ID }], [{ reviewId: [] }, 'reviewId']),
  c('POST /pos/ai-review-reputation/:id/recovery', Rr, 'recordRecovery', [{ type: 'free_fix' }], [{ type: 2 }, 'type']),
  c('POST /pos/ai-review-reputation/:id/notes', Rr, 'addNote', [{ note: 'called the guest' }], [{ note: {} }, 'note']),
  c('PUT /pos/ai-review-reputation/settings', Rr, 'updateSettings', [{ level: 'tenant', enabled: true, config: { autoRespond: false } }], [{ config: 'x' }, 'config']),
  // scheduling optimizer
  c('POST /pos/ai-scheduling-optimizer/insights/:kind/:id/approve', SchOps, 'approveInsight', [{ expectedVersion: 2 }, { expectedVersion: 2, reason: 'fits' }], [{ expectedVersion: [2] }, 'expectedVersion']),
  c('POST /pos/ai-scheduling-optimizer/insights/:kind/:id/reject', SchOps, 'rejectInsight', [{ expectedVersion: 2, reason: 'no' }], [{ expectedVersion: 2, status: 'approved' }, 'status']),
  c('POST /customer/schedule-proposals/:id/approve', SchCust, 'approve', [{ expectedVersion: 1 }], [{ expectedVersion: {} }, 'expectedVersion']),
  c('POST /customer/schedule-proposals/:id/reject', SchCust, 'reject', [{ expectedVersion: 1 }], [{ expectedVersion: 1, status: 'approved' }, 'status']),
  c('POST /pos/ai-scheduling-optimizer/options', Sch, 'options', [{ date: '2026-10-09', serviceIds: [ID], preferredTime: '10:00', limit: 5, hold: { channel: 'pos', seconds: 120 } }], [{ date: '2026-10-09', serviceIds: [1] }, 'serviceIds[0]']),
  c('POST /pos/ai-scheduling-optimizer/recommendations/generate', Sch, 'generate', [{ appointmentId: ID }, { appointmentId: ID, target: { date: '2026-10-09', startTime: '11:00', technicianId: ID } }], [{ appointmentId: ID, target: 'x' }, 'target']),
  c('POST /pos/ai-scheduling-optimizer/recommendations/:id/accept', Sch, 'accept', [{ expectedVersion: 1 }], [{ expectedVersion: [] }, 'expectedVersion']),
  c('POST /pos/ai-scheduling-optimizer/recommendations/:id/reject', Sch, 'reject', [{ expectedVersion: 1, reason: 'customer prefers mornings' }], [{ expectedVersion: 1, reason: 5 }, 'reason']),
  c('POST /pos/ai-scheduling-optimizer/recommendations/:id/return', Sch, 'returnRec', [{ expectedVersion: 1 }], [{ expectedVersion: 1, status: 'applied' }, 'status']),
  c('POST /pos/ai-scheduling-optimizer/recommendations/:id/apply', Sch, 'apply', [{ expectedVersion: 2 }], [{ expectedVersion: {} }, 'expectedVersion']),
  c('POST /pos/ai-scheduling-optimizer/recommendations/:id/retry', Sch, 'retry', [{ expectedVersion: 3 }], [{ expectedVersion: [3] }, 'expectedVersion']),
  c('POST /pos/ai-scheduling-optimizer/recommendations/:id/rollback', Sch, 'rollback', [{ expectedVersion: 4 }], [{ expectedVersion: 4, status: 'rolled_back' }, 'status']),
  c('POST /pos/ai-scheduling-optimizer/recommendations/:id/customer-decision', Sch, 'customerDecision', [{ approved: true, expectedVersion: 2 }], [{ approved: 'yes', expectedVersion: 2 }, 'approved']),
  c('POST /pos/ai-scheduling-optimizer/runs', Sch, 'runDay', [{ scope: 'branch_day', date: '2026-10-09' }, { scope: 'technician_day', date: '2026-10-09', technicianId: ID, idempotencyKey: 'k' }], [{ scope: 1 }, 'scope']),
  c('POST /pos/ai-scheduling-optimizer/time-off', Sch, 'addTimeOff', [{ technicianId: ID, startsAt: '2026-10-10T09:00:00Z', endsAt: '2026-10-10T17:00:00Z', reason: 'dentist' }], [{ technicianId: ID, status: 'approved' }, 'status']),
  c('PUT /pos/ai-scheduling-optimizer/settings', Sch, 'saveSettings', [{ level: 'tenant', expectedVersion: 0, enabled: true, killSwitch: false, config: { maxShiftMinutes: 30 } }], [{ level: 'tenant', config: [] }, 'config']),
  c('PUT /pos/ai-scheduling-optimizer/locks/:appointmentId', Sch, 'lock', [{ reason: 'VIP' }, { reason: null }], [{ reason: 7 }, 'reason']),
  c('PUT /pos/ai-scheduling-optimizer/service-profiles/:serviceId', Sch, 'putProfile', [{ setupMin: 5, cleanupMin: 10, maxGroupSize: null }], [{ setupMin: '5' }, 'setupMin']),
  // voice transcription
  c('POST /pos/ai-voice-transcription/consent', Vt, 'consent', [{ provider: 'retell', providerCallId: 'call_1', consentStatus: 'granted', consentMethod: 'verbal', recordingEnabled: true, transcriptionEnabled: true, announcementVersion: 'v2' }], [{ providerCallId: 'c', recordingEnabled: 'yes' }, 'recordingEnabled']),
  c('POST /pos/ai-voice-transcription/ingest', Vt, 'ingest', [{ provider: 'retell', providerCallId: 'call_1', recordingRef: 's3://x', languageHint: 'en' }], [{ providerCallId: 'c', status: 'completed' }, 'status']),
  c('POST /pos/ai-voice-transcription/transcripts/:id/legal-hold', Vt, 'legalHold', [{ hold: true }, { hold: false }], [{ hold: {} }, 'hold']),
  c('PUT /pos/ai-voice-transcription/settings', Vt, 'putSettings', [{ transcriptionEnabled: true, retentionDays: 30, retainRaw: false }, { consentAnnouncementVersion: 'v3' }], [{ retainRaw: 'no' }, 'retainRaw']),
  c('DELETE /pos/ai-voice-transcription/transcripts/:id', Vt, 'remove', [{}, { reason: 'customer request' }], [{ reason: 1 }, 'reason']),
  c('POST /super-admin/voice-transcription/retention-sweep', VtSa, 'retentionSweep', [{}, { limit: 500 }], [{ limit: {} }, 'limit']),
  c('POST /voice-transcription/webhook', VtWh, 'webhook', [{ provider: 'retell', providerCallId: 'call_1', consent: { status: 'granted', method: 'verbal', recordingEnabled: true, transcriptionEnabled: true } }, { call_id: 'call_2' }], [{ call_id: 'c', consent: 'yes' }, 'consent']),
  // voice tool gateway (Retell custom functions) + verification
  c('POST /api/ai-receptionist/v1/customers/lookup-or-create', Gw, 'lookupOrCreateCustomer', [{ phone: '+16095551234', firstName: 'Mai', lastName: 'Tran', consent: true, requestId: 'r1' }], [{ phone: { p: 1 } }, 'phone']),
  c('POST /api/ai-receptionist/v1/appointments', Gw, 'book', [{ serviceId: ID, date: '2026-10-09', startTime: '10:00', technicianId: ID, customerName: 'Mai', customerPhone: '+16095551234', callerConfirmed: true, requestId: 'r2' }], [{ serviceId: ID, status: 'confirmed' }, 'status']),
  c('POST /api/ai-receptionist/v1/appointments/:appointmentId/reschedule', Gw, 'reschedule', [{ date: '2026-10-10', startTime: '11:00', phone: '+16095551234', confirmed: true }, { newStartTime: '12:00', phone: '+16095551234', callerConfirmed: 'true' }], [{ startTime: ['11:00'] }, 'startTime']),
  c('POST /api/ai-receptionist/v1/appointments/:appointmentId/cancel', Gw, 'cancel', [{ phone: '+16095551234', name: 'Mai', reason: 'sick', callerConfirmed: true }], [{ reason: {} }, 'reason']),
  c('POST /api/ai-receptionist/v1/handoff', Gw, 'handoff', [{ reason: 'COMPLAINT', callId: 'call_1', summary: 'wants a manager' }], [{ reason: 9, callId: [] }, 'callId']),
  c('POST /api/ai-receptionist/v1/verification/send', GwV, 'send', [{ bookingSessionId: 'bs_1', customerPhone: '+16095551234' }], [{ customerPhone: {} }, 'customerPhone']),
  c('POST /api/ai-receptionist/v1/verification/dtmf', GwV, 'dtmf', [{ Digits: '482913' }, { digits: '482913', vc: 'sealed.token' }], [{ Digits: ['4'] }, 'Digits']),
  // tenant receptionist management
  // AI Follow-Ups guide (Oct 31 2026): the four tenant/ai/receptionist/follow-ups routes are retired → /pos/ai/follow-ups-center
  c('POST /pos/ai/follow-ups-center/tasks', Fuc, 'create', [{ reason: 'CALLBACK', description: 'asked about gel-x', callerPhone: '+16095551234', idempotencyKey: 'req-key-0001' }], [{ reason: 'CALLBACK', description: 'x x', idempotencyKey: 'req-key-0002', status: 'closed' }, 'status']),
  c('POST /pos/ai/follow-ups-center/tasks/:id/assign', Fuc, 'assign', [{ assignedUserId: ID, version: 1 }, { assignedUserId: null }], [{ assignedUserId: 4 }, 'assignedUserId']),
  c('POST /pos/ai/follow-ups-center/tasks/:id/note', Fuc, 'note', [{ note: 'left voicemail', version: 2 }], [{ note: {} }, 'note']),
  c('POST /pos/ai/follow-ups-center/tasks/:id/status', Fuc, 'status', [{ to: 'resolved', resolutionCategory: 'booked', version: 3 }, { to: 'in_progress' }], [{ to: 'done' }, 'to']),
  c('PATCH /tenant/ai/receptionist/settings', Rcp, 'updateSettings', [{ enabled: true, silenceTimeoutSeconds: 8, afterHoursBehavior: 'take_message' }], [{ enabled: 'true' }, 'enabled'], true),
  c('POST /voice/calls/:callId/outcome', Vb, 'recordOutcome', [{ durationSeconds: 120, language: 'en', intents: ['BOOK'], toolCalls: [{ name: 'book' }], bookingOutcome: 'booked', abandoned: false, summary: 'Booked gel for Friday' }], [{ summary: { s: 1 } }, 'summary']),
];

// the billing worker is a SERVICE caller (x-ai-billing-secret): it names the tenant the event is for, so tenantId is a
// declared field there — still validated, and `permissions` / `platformRole` are still refused
const SERVICE_CASES = [
  { ctl: Bill, handler: 'event', today: { eventId: 'ev-1', tenantId: ID, packageCode: 'ai_reception_copilot', eventType: 'payment_succeeded', provider: 'cardpointe', paymentStatus: 'paid', raw: { id: 'x' } }, bad: [{ eventId: { e: 1 } }, 'eventId'] },
  { ctl: Bill, handler: 'cardpointe', today: { charge: { retref: '123', amount: '29.00' }, tenantId: ID, packageCode: 'ai_reception_copilot', kind: 'charge' }, bad: [{ kind: 5 }, 'kind'] },
] as const;

describe('ai — validated bodies, route by route', () => {
  for (const x of SERVICE_CASES) it(`POST /internal/ai-billing/${x.handler === 'event' ? 'event' : 'cardpointe'} (service caller)`, () => {
    const pipe = bodyPipeOf(x.ctl as any, x.handler)!;
    expect(pipe.transform(x.today)).toEqual(x.today);
    // §40 (Oct 27 2026): strict — an undeclared field is refused, not stripped
    expect(() => pipe.transform({ ...x.today, extra: 1 })).toThrow(/extra is not an allowed field/);
    const e: any = (() => { try { pipe.transform(x.bad[0]); } catch (err) { return err; } })();
    expect(e?.getResponse?.()).toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: [expect.objectContaining({ path: x.bad[1] })] } });
    expect(() => pipe.transform({ ...x.today, permissions: ['*'] })).toThrow();
  });
  for (const x of CASES) it(x.route, () => expect(routeBodyFailures(x, bodyPipeOf as any)).toEqual([]));
  // AI Business Setup (guide 20) moved FAQs to the versioned draft → review → approved workflow and AI Front Desk (guide 23)
  // retired the plain agent writes (activation only through the owner-approved path): these routes stay gone.
  it('retired receptionist agent / FAQ write routes stay retired: POST /tenant/ai/receptionist/agents, PATCH /tenant/ai/receptionist/agents/:id, POST /tenant/ai/receptionist/agents/:id/status, POST /tenant/ai/receptionist/faqs, PATCH /tenant/ai/receptionist/faqs/:id', () => {
    for (const h of ['createAgent', 'updateAgent', 'setStatus', 'createFaq', 'updateFaq']) expect((Rcp.prototype as any)[h]).toBeUndefined();
  });
  it('the refusals the services make themselves still happen: unknown audience / receptionist-setting keys reach the service; content fields on feedback and a payment status on a resolution are refused here', () => {
    expect(validateBody(AI_MARKETING_AUDIENCE_BODY, { channel: 'sms', zip: '08109' })).toMatchObject({ ok: true, value: { zip: '08109' } });
    expect(validateBody(RECEPTIONIST_SETTINGS_BODY, { voice: 'x' })).toMatchObject({ ok: true, value: { voice: 'x' } });
    expect(validateBody(AI_DASHBOARD_FEEDBACK_BODY, { requestId: 'r', transcript: 'hello' }).ok).toBe(false);
    expect(validateBody(MONEY_INVESTIGATION_RESOLVE_BODY, { resolution: 'x', status: 'closed' }).ok).toBe(false);
  });
});
