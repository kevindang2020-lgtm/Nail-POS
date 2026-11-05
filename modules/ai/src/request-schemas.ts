// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the AI module's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). Written from each handler (the keys it reads) and the service / validator it hands the
// body to (validateAiSettings, validateFeedback, validateAudienceDefinition, validateDraftRequest, validateSubmit,
// validateRuleSetting, the queue-assignment settings / auto-config / thresholds parsers, normalizeAgentConfig,
// validatePatch, the scheduling engine's request types in api-contracts tenant/ai-scheduling.ts …) and from the clients
// (pos-web posAiApi / posAIMarketingApi / posAIMoneyProtectionApi / posAiReviewReputationApi /
// posAiSchedulingOptimizerApi / posAIVoiceTranscriptionApi / posAiCustomerProfileApi / posAiGovernanceApi, customer-web
// customerScheduleProposalsApi, admin-web superAdminAiQueueAssignmentApi) and the voice integration (Retell tool / call
// webhooks, the Twilio DTMF callback).
//
// Rules: unknown fields are stripped — which ends the handlers that spread a whole body into a write (revenue
// attributions, call-intelligence events, workflow runs, call outcomes, feedback); the services keep their own domain
// rules and messages, so types stay as loose as the services accept (numbers the services Number() may arrive as
// strings). Where a validator REFUSES an unknown key today (audience definitions, receptionist settings, the queue
// settings patch), the schema keeps extra keys so it still can. A body never carries authority: undeclared tenantId /
// permissions are refused (DANGEROUS_UNKNOWN), and a `status` on a money row is refused.
import { S, type BodySchema } from '@aipowersalon/permissions';

const text = (max: number): BodySchema => S.nullable(S.text(max));
const id: BodySchema = text(64);
const ids = (max = 200): BodySchema => S.nullable(S.array(S.text(64), { maxItems: max }));
const bool: BodySchema = S.nullable(S.boolean());
const num: BodySchema = S.nullable(S.number());
/** a number the service coerces with Number() / + — a client may send it as a string */
const numish: BodySchema = { type: ['number', 'string', 'null'], maxLength: 32 };
/** a scalar the service String()s (ids, phone numbers, names) */
const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
/** a flag the voice tools send as true / "true" */
const flag: BodySchema = { type: ['boolean', 'string', 'null'], maxLength: 8 };
const MONEY: BodySchema['x-forbidden'] = ['status', 'state', 'paymentStatus'];

// ── AI assistant / packages / dashboard (pos-web posAiApi, posAiGovernanceApi) ─────────────────────────────────────
export const AI_INVOKE_BODY: BodySchema = S.object({ action: text(64), prompt: scalar(20000) });
/** imageBase64 ≤ 12,000,000 characters is the handler's own 413 limit */
export const AI_SCAN_RECEIPT_BODY: BodySchema = S.object({ imageBase64: text(12_500_000), mimeType: text(100) });
const SETTINGS_FIELDS: Record<string, BodySchema> = {
  automation: S.nullable(S.freeObject()), autoActionsDisabled: bool, disabledTools: ids(500), disabledTasks: ids(500), allowPiiInText: ids(100),
};
/** POST /ai/dashboard/settings — `{ settings }` (pos-web) or the settings object itself (validateAiSettings reads either) */
export const AI_DASHBOARD_SETTINGS_BODY: BodySchema = S.object({ settings: S.nullable(S.object(SETTINGS_FIELDS)), ...SETTINGS_FIELDS });
/** validateFeedback refuses the content fields (§129: what changed and why, never the text) — kept refused here */
export const AI_DASHBOARD_FEEDBACK_BODY: BodySchema = S.object({
  branchId: id, requestId: text(200), taskKey: text(200), promptKey: text(200), promptVersion: num, provider: text(64), model: text(200),
  outcome: text(32), reasonCode: text(64), note: text(2000), retainedRatio: num,
}, [], { 'x-forbidden': ['draft', 'draftText', 'originalText', 'editedText', 'output', 'prompt', 'reviewText', 'customerMessage', 'transcript', 'actorUserId'] });

// ── AI subscription billing (internal: the billing worker, x-ai-billing-secret) ────────────────────────────────────
/** a service caller names the tenant the event is for — declared here (a tenant session never reaches this route) */
export const AI_BILLING_EVENT_BODY: BodySchema = S.object({
  eventId: scalar(200), tenantId: scalar(64), packageCode: scalar(64), eventType: scalar(64), provider: text(64),
  paymentSubscriptionId: scalar(200), paymentCustomerId: scalar(200), paymentStatus: text(64), raw: S.any(),
});
export const AI_BILLING_CARDPOINTE_BODY: BodySchema = S.object({ charge: S.nullable(S.freeObject()), tenantId: scalar(64), packageCode: scalar(64), kind: text(16) });

// ── AI Center / Reception Copilot (pos-web posAiApi) ──────────────────────────────────────────────────────────────
export const COPILOT_PROMPT_BODY: BodySchema = S.object({ action: text(64), prompt: scalar(20000) });
export const COPILOT_CONTEXT_BODY: BodySchema = S.object({ phone: scalar(40), customerId: id });
export const COPILOT_AVAILABILITY_BODY: BodySchema = S.object({ date: text(32), serviceIds: ids(), technicianId: id, hold: bool });
// Round 2 H: the Reception Copilot's "Hold this time" (an exact slot) and its release; holdToken = the sealed desk session.
export const COPILOT_HOLD_BODY: BodySchema = S.object({ date: text(32), startTime: text(40), serviceIds: ids(), technicianId: id, customerId: id, holdToken: text(512) }, ['date', 'startTime', 'serviceIds']);
export const COPILOT_HOLD_RELEASE_BODY: BodySchema = S.object({ holdToken: text(512) }, ['holdToken']);
export const COPILOT_CONFLICT_BODY: BodySchema = S.object({ technicianId: id, startTime: text(40), endTime: text(40), date: text(32), appointmentId: id });
export const COPILOT_TECHNICIANS_BODY: BodySchema = S.object({ serviceIds: ids(), date: text(32), preferredTechnicianName: text(200) });
export const COPILOT_DRAFT_MESSAGE_BODY: BodySchema = S.object({ kind: text(64), customerId: id, phone: scalar(40) });
export const COPILOT_INTENT_BODY: BodySchema = S.object({ text: text(8000) });
export const COPILOT_EXPLAIN_SERVICE_BODY: BodySchema = S.object({ serviceId: id });
export const COPILOT_NEXT_ACTIONS_BODY: BodySchema = S.object({ intent: text(64), hasAvailability: bool, duplicateFound: bool, customerKnown: bool });
export const COPILOT_SESSION_START_BODY: BodySchema = S.object({ channel: text(32) });
export const COPILOT_SESSION_END_BODY: BodySchema = S.object({ sessionId: scalar(64) });
export const COPILOT_RECOMMENDATION_BODY: BodySchema = S.object({ sessionId: id, kind: text(64), payload: S.nullable(S.freeObject()) });
export const COPILOT_FEEDBACK_BODY: BodySchema = S.object({ recommendationId: id, sessionId: id, rating: { type: ['string', 'number', 'null'], maxLength: 16 }, reason: text(2000) });
export const COPILOT_LEARNING_APPROVE_BODY: BodySchema = S.object({ suggestionId: scalar(64), content: text(8000) });
export const COPILOT_LEARNING_DISMISS_BODY: BodySchema = S.object({ suggestionId: scalar(64) });
export const COPILOT_TAKE_OVER_BODY: BodySchema = S.object({ providerCallId: text(200), destination: text(200), destinationType: text(32) });
/** the four confirmable actions (reception-copilot-action.service CopilotAction): type decides which fields apply */
export const COPILOT_ACTION_BODY: BodySchema = S.object({
  type: text(64), appointmentId: id, reason: text(2000), confirm: bool, idempotencyKey: text(200),
  startTime: text(40), date: text(32), technicianId: id, customerName: text(200), customerId: id, customerPhone: scalar(40), serviceIds: ids(),
  to: scalar(320), body: text(2000), holdToken: text(512),
}, [], { 'x-forbidden': ['status'] });
export const COPILOT_SETTINGS_BODY: BodySchema = S.object({
  level: text(16), enabled: bool, actionsEnabled: bool, allowCreate: bool, allowReschedule: bool, allowCancel: bool, allowSendMessage: bool,
  allowDrafting: bool, showCustomerHistory: bool, allowAiPhoneActivity: bool, allowExplainServices: bool, allowWaitlist: bool,
});

// ── customer profile, governance, inventory ───────────────────────────────────────────────────────────────────────
export const AI_CUSTOMER_MERGE_BODY: BodySchema = S.object({ primaryCustomerId: scalar(64), confirm: bool });
export const AI_CUSTOMER_PROFILE_SETTINGS_BODY: BodySchema = S.object({ enabled: bool, tunables: S.nullable(S.freeObject()) });
export const AI_CONTROL_MODE_BODY: BodySchema = S.object({ mode: text(64) });
export const AI_INVENTORY_RECIPE_BODY: BodySchema = S.object({
  serviceId: id, branchId: id, source: text(32), effectiveDate: text(32), notes: text(4000),
  lines: S.nullable(S.array(S.object({ productId: id, expectedQuantity: num, consumptionUnit: text(32), wasteAllowancePct: num, required: bool, sortOrder: num }), { maxItems: 200 })),
}, [], { 'x-forbidden': ['status'] });

// ── AI marketing (pos-web posAIMarketingApi) ──────────────────────────────────────────────────────────────────────
const AUDIENCE: Record<string, BodySchema> = {
  channel: text(16), minDaysSinceLastCompletedVisit: numish, excludeWithFutureAppointment: bool, birthdayMonth: { type: ['number', 'string', 'null'], maxLength: 16 }, requireActiveStatus: bool,
};
/** validateAudienceDefinition refuses an unknown dimension itself — extra keys are kept so it still does */
export const AI_MARKETING_AUDIENCE_BODY: BodySchema = S.object(AUDIENCE, [], { additionalProperties: true });
const offer: BodySchema = S.nullable(S.object({ name: text(500), endDateLabel: text(200) }));
export const AI_MARKETING_DRAFT_BODY: BodySchema = S.object({
  channel: text(16), tone: text(32), salonName: text(500), campaignType: text(200), language: text(32), branchName: text(500), serviceName: text(500), offer,
});
export const AI_MARKETING_SUBMIT_BODY: BodySchema = S.object({
  name: scalar(500), channel: text(16), draftText: text(20000), audienceLabel: scalar(500), audienceSize: numish, offer, estimatedCostCents: numish,
  audienceDefinition: S.nullable(S.object(AUDIENCE, [], { additionalProperties: true })), messageVersion: numish,
}, [], { 'x-forbidden': ['status', 'approvedBy', 'scheduledAt'] });
export const AI_MARKETING_APPROVE_BODY: BodySchema = S.object({ scheduledAt: text(64) });

// ── AI money protection (pos-web posAIMoneyProtectionApi) ─────────────────────────────────────────────────────────
export const MONEY_RULE_SETTING_BODY: BodySchema = S.object({ enabled: bool, severityOverride: text(32), thresholds: S.nullable(S.freeObject()) });
export const MONEY_INVESTIGATION_CREATE_BODY: BodySchema = S.object({ title: text(500), category: text(64), severity: text(32), branchId: id, alertIds: ids() }, [], { 'x-forbidden': MONEY });
export const MONEY_INVESTIGATION_NOTE_BODY: BodySchema = S.object({ body: text(8000) });
export const MONEY_INVESTIGATION_ASSIGN_BODY: BodySchema = S.object({ assigneeUserId: id });
export const MONEY_INVESTIGATION_STATUS_BODY: BodySchema = S.object({ status: text(32) });
export const MONEY_INVESTIGATION_RESOLVE_BODY: BodySchema = S.object({ resolution: text(64), recoveryAmountCents: numish }, [], { 'x-forbidden': MONEY });

// ── AI queue assignment (pos-web posAIQueueAssignmentApi, owner-web, admin-web) ───────────────────────────────────
export const AQ_ALERT_NOTE_BODY: BodySchema = S.object({ note: text(2000) });
export const AQ_ALERT_REPAIR_BODY: BodySchema = S.object({ action: text(32), reason: text(2000), queueItemId: id, technicianId: id });
/** the settings patch is a map the service checks key by key (an unknown key is refused there) */
export const AQ_SETTINGS_BODY: BodySchema = S.object({ scope: text(16), patch: S.nullable(S.freeObject()), clear: S.nullable(S.array(S.text(64), { maxItems: 100 })), expectedVersion: numish, reason: text(2000) });
export const AQ_THRESHOLDS_BODY: BodySchema = S.object({ approachingMin: numish, exceededMin: numish, severeMin: numish, criticalMin: numish, expectedVersion: numish, reason: text(2000) });
export const AQ_SUPER_ADMIN_AUTO_KILL_BODY: BodySchema = S.object({ killed: bool, reason: scalar(2000) });
export const AQ_FAIR_TURN_SIMULATE_BODY: BodySchema = S.object({ mode: text(40), turnPolicy: S.nullable(S.freeObject()), serviceMinutes: numish, requestedName: text(120), serviceLabel: text(120),
  technicians: S.nullable(S.array(S.object({ name: text(120), turns: numish, readyMinutes: numish, serviceMinutes: numish, skillEligible: bool, onBreak: bool, onHold: bool, appointmentInMinutes: numish, clockedIn: bool, position: numish }), { maxItems: 30 })) });   // Fair Turn §168
export const AQ_DECISION_BODY: BodySchema = S.object({ decision: text(32), chosenTechnicianId: id, reason: text(2000), feedbackCode: text(64), idempotencyKey: text(200), overrideReasonCode: text(40) });
/** POST pos/ai-queue-assignment/plans/:recommendationId/decision — accepted / adjusted (the full line list) / rejected / kept_unassigned */
export const AQ_PLAN_DECISION_BODY: BodySchema = S.object({
  decision: text(32), lines: S.nullable(S.array(S.object({ queueItemId: id, serviceId: id, technicianId: id }), { maxItems: 400 })),
  reason: text(2000), feedbackCode: text(40), idempotencyKey: text(128),
});
export const AQ_KILL_BODY: BodySchema = S.object({ scope: text(16), reason: text(2000) });
export const AQ_ROTATION_POLICY_BODY: BodySchema = S.object({ policy: text(64), fixedOrder: S.nullable(S.array(S.text(64), { maxItems: 500 })), expectedVersion: numish, reason: text(2000) });
export const AQ_AUTO_CONFIG_BODY: BodySchema = S.object({
  enabled: bool, confidenceFloor: num, maxPerRun: num, delaySeconds: num,
  exclusions: S.nullable(S.object({ vip: bool, appointments: bool, requested: bool, groups: bool, technicianIds: ids(500), serviceIds: ids(500) })),
  expectedVersion: numish, reason: text(2000),
});

// ── AI revenue / call intelligence / workflow runs (the AI workers' own records) ──────────────────────────────────
export const AI_REVENUE_ATTRIBUTION_BODY: BodySchema = S.object({
  branchId: id, dedupeKey: text(500), source: text(64), kind: text(32), ticketId: id, ticketServiceLineId: id, customerId: id, amountCents: num, acceptedAt: text(40),
}, [], { 'x-forbidden': MONEY });
export const CALL_INTELLIGENCE_EVENT_BODY: BodySchema = S.object({
  branchId: id, providerCallId: text(200), customerId: id, callerPhone: scalar(40), direction: text(16), status: text(32), aiHandled: bool,
  intent: text(200), durationSeconds: num, outcome: text(64), recoveredAppointmentId: id, startedAt: text(40),
});
export const WORKFLOW_RUN_BODY: BodySchema = S.object({ branchId: id, workflowKey: text(200), dedupeKey: text(500), status: text(32), customerId: id, appointmentId: id, detail: text(4000), ranAt: text(40) });

// ── AI review & reputation (pos-web posAiReviewReputationApi) ─────────────────────────────────────────────────────
export const REVIEW_SYNC_BODY: BodySchema = S.object({ source: text(64), since: text(40) });
export const REVIEW_DRAFT_BODY: BodySchema = S.object({ directive: text(64), reviewText: text(20000) });
export const REVIEW_REJECT_BODY: BodySchema = S.object({ reason: text(2000) });
export const REVIEW_ASSIGN_BODY: BodySchema = S.object({ userId: scalar(64) });
export const REVIEW_RESOLVE_BODY: BodySchema = S.object({ reviewId: scalar(64) });
export const REVIEW_RECOVERY_BODY: BodySchema = S.object({ type: text(64) });
export const REVIEW_NOTE_BODY: BodySchema = S.object({ note: text(4000) });
export const REVIEW_SETTINGS_BODY: BodySchema = S.object({ level: text(16), branchId: id, enabled: bool, config: S.nullable(S.freeObject()) });

// ── AI scheduling optimizer (pos-web posAiSchedulingOptimizerApi, customer-web) — api-contracts tenant/ai-scheduling ─
const versioned = { expectedVersion: numish };
export const SCHED_INSIGHT_DECISION_BODY: BodySchema = S.object({ ...versioned, reason: text(2000) }, [], { 'x-forbidden': ['status'] });
export const SCHED_CUSTOMER_PROPOSAL_DECISION_BODY: BodySchema = S.object(versioned, [], { 'x-forbidden': ['status'] });
export const SCHED_OPTIONS_BODY: BodySchema = S.object({
  date: text(32), serviceIds: ids(), preferredTime: text(16), technicianId: id, preferredTechnicianId: id, requiredTechnicianId: id,
  groupSize: num, excludeAppointmentId: id, limit: num,
  hold: S.nullable(S.object({ channel: text(32), customerId: id, bookingSessionId: text(512), seconds: num })),
});
export const SCHED_GENERATE_BODY: BodySchema = S.object({ appointmentId: id, target: S.nullable(S.object({ date: text(32), startTime: text(16), technicianId: id })) });
export const SCHED_DECISION_BODY: BodySchema = S.object({ ...versioned, reason: text(2000) }, [], { 'x-forbidden': ['status'] });
export const SCHED_APPLY_BODY: BodySchema = S.object(versioned, [], { 'x-forbidden': ['status'] });
export const SCHED_CUSTOMER_DECISION_BODY: BodySchema = S.object({ approved: bool, ...versioned }, [], { 'x-forbidden': ['status'] });
export const SCHED_RUN_BODY: BodySchema = S.object({ scope: text(32), date: text(32), technicianId: id, idempotencyKey: text(200) });
export const SCHED_TIME_OFF_BODY: BodySchema = S.object({ technicianId: id, branchId: id, startsAt: text(40), endsAt: text(40), reason: text(2000) }, [], { 'x-forbidden': ['status'] });
export const SCHED_SETTINGS_BODY: BodySchema = S.object({ level: text(16), ...versioned, enabled: bool, killSwitch: bool, config: S.nullable(S.freeObject()) });
export const SCHED_LOCK_BODY: BodySchema = S.object({ reason: text(2000) });
export const SCHED_SERVICE_PROFILE_BODY: BodySchema = S.object({ serviceId: id, setupMin: num, cleanupMin: num, maxGroupSize: num });

// ── AI voice transcription (pos-web posAIVoiceTranscriptionApi; the provider webhook) ─────────────────────────────
export const VT_CONSENT_BODY: BodySchema = S.object({
  branchId: id, provider: text(64), providerCallId: text(200), consentStatus: text(32), consentMethod: text(32), recordingEnabled: bool, transcriptionEnabled: bool,
  announcementVersion: text(64), jurisdiction: text(64), initiatedBy: text(64), consentAt: text(40),
});
export const VT_INGEST_BODY: BodySchema = S.object({ provider: text(64), providerCallId: text(200), customerId: id, recordingRef: text(2000), languageHint: text(32) }, [], { 'x-forbidden': ['status', 'redactionStatus'] });
export const VT_LEGAL_HOLD_BODY: BodySchema = S.object({ hold: { type: ['boolean', 'string', 'number', 'null'], maxLength: 8 } });
export const VT_SETTINGS_BODY: BodySchema = S.object({ transcriptionEnabled: bool, retentionDays: numish, retainRaw: bool, consentAnnouncementVersion: text(64) });
export const VT_DELETE_BODY: BodySchema = S.object({ reason: text(500) });
export const VT_RETENTION_SWEEP_BODY: BodySchema = S.object({ limit: numish });
/** the transcription provider's call webhook (integration-key authenticated): our consent block + the provider's call ids */
export const VT_WEBHOOK_BODY: BodySchema = S.object({
  provider: text(64), providerCallId: text(200), call_id: text(200), customerId: id, recordingRef: text(2000), languageHint: text(32),
  consent: S.nullable(S.object({ status: text(32), method: text(32), recordingEnabled: flag, transcriptionEnabled: flag, announcementVersion: text(64), jurisdiction: text(64), at: text(40) })),
});

// ── AI receptionist: the voice tool gateway (Retell custom functions; integration-key authenticated) ──────────────
const gw = { requestId: text(200), confirmed: flag, callerConfirmed: flag };
export const GW_CUSTOMER_BODY: BodySchema = S.object({ ...gw, phone: scalar(40), name: text(200), firstName: text(200), lastName: text(200), consent: flag });
export const GW_BOOK_BODY: BodySchema = S.object({
  ...gw, serviceId: scalar(64), date: text(32), startTime: text(40), technicianId: scalar(64), customerId: scalar(64), customerName: text(200), customerPhone: scalar(40),
  customerNotes: text(2000), bookingSessionId: text(512),
}, [], { 'x-forbidden': ['status'] });
export const GW_RESCHEDULE_BODY: BodySchema = S.object({ ...gw, date: text(32), startTime: text(40), newStartTime: text(40), phone: scalar(40), name: text(200) }, [], { 'x-forbidden': ['status'] });
export const GW_CANCEL_BODY: BodySchema = S.object({ ...gw, phone: scalar(40), name: text(200), reason: text(2000) }, [], { 'x-forbidden': ['status'] });
export const GW_HANDOFF_BODY: BodySchema = S.object({ ...gw, reason: text(200), callId: text(200), callerPhone: scalar(40), summary: text(4000) });
export const GW_VERIFICATION_SEND_BODY: BodySchema = S.object({ bookingSessionId: text(512), customerPhone: scalar(40) });
/** the telephony provider's gather callback (form-encoded): the digits and the sealed callback token */
export const GW_VERIFICATION_DTMF_BODY: BodySchema = S.object({ Digits: scalar(32), digits: scalar(32), vc: text(4000) });

// ── AI receptionist: tenant management (pos-web posAiApi) ─────────────────────────────────────────────────────────
const AGENT: Record<string, BodySchema> = { name: text(200), branchId: id, callType: text(32), language: text(32), useCase: text(1000), greeting: text(4000), behavior: text(20000) };
export const RECEPTIONIST_AGENT_BODY: BodySchema = S.object(AGENT, [], { 'x-forbidden': ['status', 'providerAgentId'] });
export const RECEPTIONIST_AGENT_STATUS_BODY: BodySchema = S.object({ status: text(32) });
export const RECEPTIONIST_FOLLOW_UP_BODY: BodySchema = S.object({ reason: text(500), priority: text(16), customerId: id, callerPhone: scalar(40), providerCallId: text(200), appointmentId: id, notes: text(4000) }, [], { 'x-forbidden': ['status'] });
export const RECEPTIONIST_FOLLOW_UP_ASSIGN_BODY: BodySchema = S.object({ assignedUserId: id });
export const RECEPTIONIST_FOLLOW_UP_NOTE_BODY: BodySchema = S.object({ note: scalar(4000) });
export const RECEPTIONIST_FOLLOW_UP_STATUS_BODY: BodySchema = S.object({ status: text(32), resolution: text(2000) });
export const RECEPTIONIST_FAQ_BODY: BodySchema = S.object({ question: text(2000), answer: text(8000), category: text(200), language: text(32), isActive: bool });
/** validatePatch refuses an unknown setting itself — extra keys are kept so it still does */
export const RECEPTIONIST_SETTINGS_BODY: BodySchema = S.object({
  enabled: bool, allowInterruptions: bool, recordingEnabled: bool, defaultLanguage: text(32), afterHoursBehavior: text(64),
  silenceTimeoutSeconds: numish, maxCallDurationSeconds: numish, recordingConsentMessage: text(2000),
}, [], { additionalProperties: true });
/** POST /voice/calls/:callId/outcome — the call-outcome report from the voice agent (voice-call-outcome-core) */
export const VOICE_CALL_OUTCOME_BODY: BodySchema = S.object({
  promptVersion: text(64), startedAt: text(40), endedAt: text(40), durationSeconds: numish, language: text(32), intents: S.any(), toolCalls: S.any(),
  bookingOutcome: text(64), handoffOutcome: text(64), sentiment: text(32), errorCategory: text(64), interruptionCount: numish, repeatedQuestionCount: numish,
  abandoned: flag, followUpRequired: flag, summary: text(4000),
});
