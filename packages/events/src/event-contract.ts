// event-contract.ts — Constitution 8, Phases 4–5: the ONE domain-event envelope and the ONE typed registry.
//
// §7: one authoritative registry; do not scatter raw event strings. §8: one standard envelope. §6: names are
// domain.entity.action, past tense. §13: tenant context is mandatory for tenant-scoped events. §16/§94/§225:
// payloads carry ids + minimal facts, never PII, OTPs, secrets, or documents.
//
// Location note: §7 suggests /packages/events "or equivalent". The API is CommonJS and every producer and
// consumer lives in it, so the contract lives here; realtime-core's FORBIDDEN_PAYLOAD_KEYS is reused rather
// than duplicated (§ preamble: eliminate duplicate event systems).
import { randomUUID } from 'node:crypto';
import { getContext, currentTraceparent } from '@aipowersalon/observability';
import { FORBIDDEN_PAYLOAD_KEYS } from '@aipowersalon/realtime-contracts';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §7 Registry. Past-tense facts only. Commands (assignTechnician, book, finalize) are NOT events (§5).
// Grouped by the constitution's own sections. Phase 12 wires the first four domains; the rest are declared so
// producers written later cannot invent names.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const DOMAIN_EVENTS = {
  // §59–60 booking / appointments
  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_CONFIRMED: 'appointment.confirmed',
  APPOINTMENT_RESCHEDULED: 'appointment.rescheduled',
  APPOINTMENT_CANCELED: 'appointment.canceled',
  APPOINTMENT_COMPLETED: 'appointment.completed',
  APPOINTMENT_NO_SHOW: 'appointment.no_show',
  APPOINTMENT_UPDATED: 'appointment.updated',           // details edited (name / phone / notes / VIP / services) — which fields, never their values
  // §61–62 check-in / visit. A visit begins at check-in (+ service.started); it is COMPLETED when its ticket is paid —
  // the moment the platform counts it (VISIT_TICKET_STATUSES). BUILD_PLAN Phase 15 retired three names declared ahead of
  // producers that never came (zero importers; apps/api/scripts/audit-event-producers.mjs RETIRED keeps them out).
  CUSTOMER_CHECKED_IN: 'checkin.customer_checked_in',
  VISIT_COMPLETED: 'visit.completed',
  // §63 queue
  QUEUE_CUSTOMER_JOINED: 'queue.customer_joined',
  QUEUE_CUSTOMER_CALLED: 'queue.customer_called',
  QUEUE_CUSTOMER_ASSIGNED: 'queue.customer_assigned',
  QUEUE_CUSTOMER_REMOVED: 'queue.customer_removed',
  QUEUE_ITEM_UPDATED: 'queue.item_updated',           // Sep 2026 merge: details / services / priority / technician cleared / called — the boards refetch
  // multi-technician routing (migration 569): a split visit / party plan put technicians on the visit's service lines —
  // written by the ONE plan writer (QueueService.assignPlan) with queue.customer_assigned (the lead) in its transaction
  QUEUE_SERVICE_LINES_ASSIGNED: 'queue.service_lines_assigned',
  // §67 service session
  SERVICE_STARTED: 'service.started',
  SERVICE_PAUSED: 'service.paused',
  SERVICE_RESUMED: 'service.resumed',
  SERVICE_COMPLETED: 'service.completed',
  // §67 service lines — what the guest is actually being charged for changed
  TICKET_SERVICE_LINE_ADDED: 'ticket.service_line_added',
  TICKET_SERVICE_LINE_UPDATED: 'ticket.service_line_updated',
  TICKET_SERVICE_LINE_REMOVED: 'ticket.service_line_removed',
  // §67 service-line change requests (a technician asks, a manager decides — the decision is the fact)
  TICKET_CHANGE_REQUEST_CREATED: 'ticket.change_request_created',
  TICKET_CHANGE_REQUEST_APPROVED: 'ticket.change_request_approved',
  TICKET_CHANGE_REQUEST_REJECTED: 'ticket.change_request_rejected',
  // §67: the ticket left the service floor and is waiting to be paid — the handoff the checkout screen watches
  TICKET_READY_FOR_CHECKOUT: 'ticket.ready_for_checkout',
  // §68–69 checkout / payment
  CHECKOUT_COMPLETED: 'checkout.completed',
  PAYMENT_CAPTURED: 'payment.captured',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_VOIDED: 'payment.voided',
  // Owner & Manager Payment App mandate §174–§175 (Oct 13 2026, wave 3 / TTP). Ids + integer cents + §190 codes only.
  CHECKOUT_PAYMENT_CLAIMED: 'checkout.payment_claimed',                // a payment claim (checkout lock) was taken / taken over on a ticket
  PAYMENT_INTENT_CREATED: 'payment.intent_created',                    // a Tap to Pay PaymentIntent (payment_attempts row) was created
  PAYMENT_UNKNOWN: 'payment.unknown',                                  // a result was lost after the card was presented — verifying, never retried blind
  PAYMENT_RECOVERED: 'payment.recovered',                              // the recovery worker / a reconcile resolved an unknown result
  RECEIPT_REQUESTED: 'receipt.requested',                              // a receipt was asked for — delivered asynchronously by the receipt consumer (§102)
  MOBILE_PAYMENT_DEVICE_REGISTERED: 'mobile_payment.device_registered',
  MOBILE_PAYMENT_DEVICE_REVOKED: 'mobile_payment.device_revoked',      // a payment phone lost its authority (revoke / compromised / termination)
  // §65 workforce
  TECHNICIAN_ASSIGNED: 'technician.assigned',
  TECHNICIAN_CLOCKED_IN: 'technician.clocked_in',
  TECHNICIAN_CLOCKED_OUT: 'technician.clocked_out',
  TECHNICIAN_STATUS_CHANGED: 'technician.status_changed',   // merge Oct 12 2026 (WF): the ONE workforce state moved (579 CAS) — clock / break / queue / service facts, no PII
  TECHNICIAN_TURN_QUEUE_CHANGED: 'technician.turn_queue_changed',   // Fair Turn Engine (wave 2, Oct 12 2026): the branch's technician turn queue moved (602) — ids + event types only
  PAYROLL_PERIOD_PAID: 'payroll.period_paid',
  TECHNICIAN_PROFILE_UPDATED: 'technician.profile_updated',
  TECHNICIAN_TIME_OFF_CHANGED: 'technician.time_off_changed',   // merge Oct 12 2026: a time-off request was made / decided / withdrawn / entered (ids + status only)
  TECHNICIAN_MEMBERSHIP_APPROVED: 'technician.membership_approved',
  TECHNICIAN_MEMBERSHIP_REJECTED: 'technician.membership_rejected',
  // §78 customers
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_MERGED: 'customer.merged',
  CUSTOMER_PHONE_VERIFIED: 'customer.phone_verified',
  // BUILD_PLAN Phase 3 (customer_phone_number_management): the phone-change lifecycle. Safe identifiers only — the
  // customer, the session, the source, MASKED numbers, the method; never a full number, never a code.
  CUSTOMER_PHONE_UPDATE_REQUESTED: 'customer.phone_update_requested',
  CUSTOMER_PHONE_VERIFICATION_FAILED: 'customer.phone_verification_failed',
  CUSTOMER_PHONE_ACTIVATED: 'customer.phone_activated',          // the new number is the customer's; the old one is replaced
  CUSTOMER_PHONE_SYNC_FAILED: 'customer.phone_sync_failed',
  CUSTOMER_PHONE_SYNC_COMPLETED: 'customer.phone_sync_completed',
  // BUILD_PLAN Phase 4: booking phone verification. Masked number, channel and session only — never a number or a code.
  BOOKING_PHONE_VERIFICATION_REQUESTED: 'booking.phone_verification_requested',   // a booking was held, waiting for its code
  BOOKING_PHONE_VERIFICATION_SENT: 'booking.phone_verification_sent',
  BOOKING_PHONE_VERIFIED: 'booking.phone_verified',
  BOOKING_PHONE_VERIFICATION_FAILED: 'booking.phone_verification_failed',         // a send failed, or the attempts ran out (locked)
  BOOKING_PHONE_VERIFICATION_EXPIRED: 'booking.phone_verification_expired',
  BOOKING_PHONE_VERIFICATION_OVERRIDDEN: 'booking.phone_verification_overridden', // a manager allowed one booking without a code
  // §72–76 growth
  DEAL_REDEEMED: 'deal.redeemed',                        // BUILD_PLAN Phase 5: recorded when the ticket is PAID (not when applied)
  COUPON_REDEEMED: 'coupon.redeemed',
  // BUILD_PLAN Phase 5 (deals_engine): the deal lifecycle and its money facts. Ids, statuses and cents only — never a
  // coupon code, never customer contact details.
  DEAL_CREATED: 'deal.created',
  DEAL_UPDATED: 'deal.updated',                          // the terms changed — a new version
  DEAL_SUBMITTED: 'deal.submitted',
  DEAL_APPROVED: 'deal.approved',
  DEAL_REJECTED: 'deal.rejected',
  DEAL_PUBLISHED: 'deal.published',                      // live (or scheduled to go live)
  DEAL_PAUSED: 'deal.paused',
  DEAL_RESUMED: 'deal.resumed',
  DEAL_EXPIRED: 'deal.expired',
  DEAL_SOLD_OUT: 'deal.sold_out',
  DEAL_SUSPENDED: 'deal.suspended',                      // a Super Admin took it down, with a reason
  DEAL_RESERVED: 'deal.reserved',                        // a booking holds a place
  DEAL_RESERVATION_RELEASED: 'deal.reservation_released',   // the place came back (cancel, no-show, removed, expired)
  DEAL_APPLIED: 'deal.applied',                          // on a ticket, not yet paid
  DEAL_REDEMPTION_REVERSED: 'deal.redemption_reversed',  // void / refund gave it back (fully or partly)
  COUPON_CODES_GENERATED: 'coupon.codes_generated',
  // BUILD_PLAN Phase 6 — AI queue assignment (the engine suggests; staff or the opted-in auto-run act through the queue)
  QUEUE_ASSIGNMENT_RECOMMENDED: 'queue.assignment_recommended',
  QUEUE_ASSIGNMENT_DECIDED: 'queue.assignment_decided',          // accepted / rejected / overridden / kept unassigned
  QUEUE_AUTO_ASSIGNED: 'queue.auto_assigned',
  QUEUE_AUTO_ASSIGNMENT_DISABLED: 'queue.auto_assignment_disabled',   // kill switch (branch or salon) or the platform's
  QUEUE_ASSIGNMENT_LOCKED: 'queue.assignment_locked',
  QUEUE_ASSIGNMENT_UNLOCKED: 'queue.assignment_unlocked',
  QUEUE_REORDERED: 'queue.reordered',
  QUEUE_ALERT_RAISED: 'queue.alert_raised',
  QUEUE_ALERT_RESOLVED: 'queue.alert_resolved',
  QUEUE_ASSIGNMENT_SETTINGS_CHANGED: 'queue.assignment_settings_changed',
  QUEUE_GROUP_CREATED: 'queue.group_created',
  // BUILD_PLAN Phase 7 — AI scheduling optimizer (advisory; every schedule change still goes through the booking service)
  SCHEDULE_RUN_COMPLETED: 'schedule.optimization_run_completed',          // also a failed run (payload.status)
  SCHEDULE_RECOMMENDATION_GENERATED: 'schedule.recommendation_generated',
  SCHEDULE_RECOMMENDATION_DECIDED: 'schedule.recommendation_decided',      // accept / reject / return (payload.action, .status)
  SCHEDULE_RECOMMENDATION_EXPIRED: 'schedule.recommendation_expired',
  SCHEDULE_CUSTOMER_APPROVAL_REQUESTED: 'schedule.customer_approval_requested',
  SCHEDULE_CUSTOMER_DECIDED: 'schedule.customer_decided',                  // payload.approved
  SCHEDULE_CHANGE_APPLIED: 'schedule.change_applied',
  SCHEDULE_CHANGE_FAILED: 'schedule.change_failed',                        // failed or stale (payload.reason)
  SCHEDULE_CHANGE_ROLLED_BACK: 'schedule.change_rolled_back',
  SCHEDULE_INSIGHT_GENERATED: 'schedule.insight_generated',                // duration / staffing / availability (payload.kind)
  SCHEDULE_INSIGHT_DECIDED: 'schedule.insight_decided',
  SCHEDULE_SETTINGS_CHANGED: 'schedule.settings_changed',
  SCHEDULE_AUTOMATION_DISABLED: 'schedule.automation_disabled',            // a kill switch (location, salon or platform)
  // BUILD_PLAN Phase 8 — Safety Community. Cross-tenant by design: a published advisory reaches OTHER salons only as one
  // COMMUNITY_ALERT_DELIVERED per recipient salon (tenantId = the recipient), never by putting another salon's id on it.
  COMMUNITY_ADVISORY_SUBMITTED: 'community.advisory_submitted',        // payload.status (manager_approval | sensitive_data_detected | moderation_review)
  COMMUNITY_ADVISORY_APPROVED: 'community.advisory_approved',          // by the salon's approver (published or held for moderation)
  COMMUNITY_ADVISORY_PUBLISHED: 'community.advisory_published',
  COMMUNITY_ADVISORY_UPDATED: 'community.advisory_updated',            // edit / added update / label / resolution (payload.change)
  COMMUNITY_ADVISORY_REMOVED: 'community.advisory_removed',
  COMMUNITY_ADVISORY_RETURNED: 'community.advisory_returned',          // returned for correction / rejected / evidence or changes requested
  COMMUNITY_COMMENT_ADDED: 'community.comment_added',
  COMMUNITY_COMMENT_REMOVED: 'community.comment_removed',
  COMMUNITY_ALERT_DELIVERED: 'community.alert_delivered',              // one per recipient salon
  COMMUNITY_MODERATION_CASE_OPENED: 'community.moderation_case_opened',
  COMMUNITY_MODERATION_ACTION_TAKEN: 'community.moderation_action_taken',
  COMMUNITY_TENANT_RESTRICTED: 'community.tenant_restricted',
  COMMUNITY_SETTINGS_CHANGED: 'community.settings_changed',
  COMMUNITY_EVIDENCE_SCANNED: 'community.evidence_scanned',
  // BUILD_PLAN Phase 9 — Constitution 2: what someone may do changed (role / template / override / branch access /
  // status / ownership) — payload { userId, change, version }; and the salon's one approvals engine.
  AUTHORIZATION_CHANGED: 'authorization.changed',
  APPROVAL_REQUESTED: 'approval.requested',
  APPROVAL_DECIDED: 'approval.decided',          // approved / rejected / cancelled / expired (payload.status)
  APPROVAL_EXECUTED: 'approval.executed',        // the approved action ran (or failed: payload.ok)
  LOYALTY_POINTS_EARNED: 'loyalty.points_earned',
  LOYALTY_POINTS_REDEEMED: 'loyalty.points_redeemed',
  MEMBERSHIP_ACTIVATED: 'membership.activated',
  MEMBERSHIP_CANCELED: 'membership.canceled',
  GIFT_CARD_ISSUED: 'gift_card.issued',
  GIFT_CARD_REDEEMED: 'gift_card.redeemed',
  // §77 inventory
  INVENTORY_ADJUSTED: 'inventory.adjusted',
  INVENTORY_LOW_STOCK: 'inventory.low_stock',
  // §79 communication (facts about sends — never the message body)
  SMS_SENT: 'communication.sms_sent',
  SMS_DELIVERY_FAILED: 'communication.sms_delivery_failed',
  PUSH_SENT: 'communication.push_sent',
  // §80 end-of-day follow-ups (a technician's post-visit task queue)
  FOLLOWUP_TASKS_GENERATED: 'followup.tasks_generated',
  FOLLOWUP_TASK_SENT: 'followup.task_sent',
  FOLLOWUP_TASK_STATUS_CHANGED: 'followup.task_status_changed',
  FOLLOWUP_CUSTOMER_REPLIED: 'followup.customer_replied',
  // §83 AI operational events. Facts ABOUT AI work — never the prompt or the response (§83, §225).
  AI_JOB_REQUESTED: 'ai.job_requested',
  // Constitution 10 §161 names seven AI events; Constitution 8 registered five. These two were missing, and a
  // registered-but-unemitted event is the defect class the realtime contract gate exists to catch — so all
  // seven now have a producer in AiPlatform.execute() rather than sitting in the vocabulary unused.
  AI_JOB_STARTED: 'ai.job_started',
  AI_APPROVAL_REQUIRED: 'ai.approval_required',
  AI_JOB_COMPLETED: 'ai.job_completed',
  AI_JOB_FAILED: 'ai.job_failed',
  AI_USAGE_RECORDED: 'ai.usage_recorded',
  AI_SAFETY_EVENT_DETECTED: 'ai.safety_event_detected',
  // Constitution 13 §343: the register cash drawer — each fact recorded in the SAME transaction as the drawer row, so
  // the realtime projection (not a direct push from the service) tells the other POS screens. Amounts only, no notes.
  CASH_DRAWER_OPENED: 'cash_drawer.opened',
  CASH_DRAWER_MOVEMENT_RECORDED: 'cash_drawer.movement_recorded',
  CASH_DRAWER_MOVEMENT_VOIDED: 'cash_drawer.movement_voided',
  CASH_DRAWER_RECONCILED: 'cash_drawer.reconciled',
  // a technician hands the day's cash to the front desk, which counts and reconciles it
  CASH_HANDOFF_SUBMITTED: 'cash_handoff.submitted',
  CASH_HANDOFF_RECONCILED: 'cash_handoff.reconciled',
  // skip-line: the customer chose to hand cash to their technician (a confirmation awaits the technician), or the
  // technician reported that the customer did not pay
  CASH_TO_TECH_REQUESTED: 'skip_line.cash_to_tech_requested',
  CASH_TO_TECH_NOT_PAID: 'skip_line.cash_to_tech_not_paid',
  // a technician asks a qualified colleague to take one service line; the helper accepts (and takes the line) or declines
  TECH_HELP_REQUESTED: 'tech_help.requested',
  TECH_HELP_ACCEPTED: 'tech_help.accepted',
  TECH_HELP_DECLINED: 'tech_help.declined',
  // owner alerts: acknowledged / resolved / dismissed (the row's status changed)
  OWNER_ALERT_STATUS_CHANGED: 'owner_alert.status_changed',
  // payroll period transitions besides paid (approve = finalized, reopen = draft)
  PAYROLL_PERIOD_FINALIZED: 'payroll.period_finalized',
  PAYROLL_PERIOD_REOPENED: 'payroll.period_reopened',
  // Payroll mandate wave 2 (§113): a period was prepared for review (lines built, validated, preview hash frozen), and a
  // payout to technicians was recorded (§78–§80; ids + counts only, never per-person amounts)
  PAYROLL_PERIOD_PREPARED: 'payroll.period_prepared',
  PAYROLL_PAYOUT_RECORDED: 'payroll.payout_recorded',
  // an offer to a technician was not answered before its acceptance deadline (the platform sweep expires it)
  TECH_OFFER_EXPIRED: 'tech_queue.offer_expired',
  TECH_OFFER_ACCEPTED: 'tech_queue.offer_accepted',
  TECH_OFFER_DECLINED: 'tech_queue.offer_declined',
  // §81 reviews — a technician rating IS a review of that visit; one event, not two vocabularies
  REVIEW_SUBMITTED: 'review.submitted',
  // §85–87 security / platform / super admin
  SECURITY_TENANT_MISMATCH: 'security.tenant_mismatch',
  TENANT_SUSPENDED: 'platform.tenant_suspended',
  TENANT_ACTIVATED: 'platform.tenant_activated',
} as const;

export type DomainEventType = typeof DOMAIN_EVENTS[keyof typeof DOMAIN_EVENTS];
const EVENT_TYPE_SET: ReadonlySet<string> = new Set(Object.values(DOMAIN_EVENTS));

/** §34: the CURRENT version of each event type. Bump only for breaking changes; add fields freely (§35). */
export const EVENT_VERSIONS: Record<DomainEventType, number> = Object.fromEntries(
  Object.values(DOMAIN_EVENTS).map((t) => [t, 1]),
) as Record<DomainEventType, number>;

/** §168: platform events have no tenant; everything else MUST carry one (§13). */
export function isPlatformEvent(type: string): boolean {
  return type.startsWith('platform.') || type === DOMAIN_EVENTS.SECURITY_TENANT_MISMATCH;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §8 Envelope
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DomainEvent<TPayload = Record<string, unknown>> {
  eventId: string;
  eventType: DomainEventType;
  eventVersion: number;
  occurredAt: string;           // §53: when the fact happened (event time), not when it was processed
  tenantId?: string;
  branchId?: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion?: number;    // §40: only where an aggregate needs ordering
  actorId?: string;
  actorType?: 'user' | 'system' | 'ai' | 'worker' | 'webhook';   // §190
  requestId?: string;
  correlationId: string;        // §11: the business flow this belongs to
  causationId?: string;         // §12: the event that caused this one
  /** BUILD_PLAN Phase 11: W3C traceparent of the span that raised the event (outbox_events.traceparent, migration 548) —
   *  consumers continue that trace. An id, never data. */
  traceparent?: string;
  payload: TPayload;
}

export type CreateEventInput<T> = Omit<DomainEvent<T>, 'eventId' | 'eventVersion' | 'occurredAt' | 'correlationId'> & {
  correlationId?: string;
  occurredAt?: string;
};

/** Build a well-formed envelope. eventId is a UUID (§10); correlationId defaults to eventId for a new flow. */
export function createDomainEvent<T extends Record<string, unknown>>(input: CreateEventInput<T>): DomainEvent<T> {
  const eventId = randomUUID();
  const ambient = getContext();
  const traceparent = input.traceparent ?? currentTraceparent();
  return {
    eventId,
    eventType: input.eventType,
    eventVersion: EVENT_VERSIONS[input.eventType],
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    tenantId: input.tenantId,
    branchId: input.branchId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion,
    actorId: input.actorId,
    actorType: input.actorType,
    // Constitution 11 §8/§12: an event raised INSIDE an HTTP request or a job inherits that context's ids, so
    // booking → event → worker → Twilio is ONE chain. Before this, every event started a fresh correlation and
    // the chain was broken at its origin (OBSERVABILITY_AUDIT problem 2). An explicit input still wins.
    requestId: input.requestId ?? ambient?.requestId,
    correlationId: input.correlationId ?? ambient?.correlationId ?? eventId,
    causationId: input.causationId,
    ...(traceparent ? { traceparent } : {}),
    payload: input.payload,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// §37 Schema validation. Structural + policy. Returns reasons, never throws — the caller decides.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const NAME_RE = /^[a-z][a-z_]*(\.[a-z][a-z_]*){1,2}$/;   // domain.action or domain.entity.action, past tense by convention
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** §225: never OTPs, secrets, CVV, raw credentials. Extends realtime-core's list rather than duplicating it. */
export const FORBIDDEN_EVENT_PAYLOAD_KEYS: readonly string[] = [
  ...FORBIDDEN_PAYLOAD_KEYS, 'otp', 'code', 'verificationCode', 'secret', 'apiKey', 'api_key', 'accessToken', 'refreshToken',
  'authToken', 'privateKey', 'clientSecret', 'cardNumber', 'accountNumber', 'routingNumber',
];
/** §93: payloads carry ids and minimal facts. 32 KB is generous; documents/images/audio never belong here. */
export const MAX_PAYLOAD_BYTES = 32 * 1024;

export function validateDomainEvent(e: Partial<DomainEvent<any>> | null | undefined): string[] {
  const bad: string[] = [];
  if (!e || typeof e !== 'object') return ['envelope_missing'];
  if (!e.eventId || !UUID_RE.test(String(e.eventId))) bad.push('event_id_invalid');
  if (!e.eventType || !EVENT_TYPE_SET.has(String(e.eventType))) bad.push('event_type_unknown');
  else if (!NAME_RE.test(String(e.eventType))) bad.push('event_type_malformed');
  if (typeof e.eventVersion !== 'number' || e.eventVersion < 1) bad.push('event_version_invalid');
  else if (e.eventType && EVENT_TYPE_SET.has(String(e.eventType)) && e.eventVersion > EVENT_VERSIONS[e.eventType as DomainEventType]) bad.push('event_version_unsupported');
  if (!e.occurredAt || Number.isNaN(Date.parse(String(e.occurredAt)))) bad.push('occurred_at_invalid');
  if (!e.aggregateType) bad.push('aggregate_type_missing');
  if (!e.aggregateId) bad.push('aggregate_id_missing');
  if (!e.correlationId) bad.push('correlation_id_missing');
  if (e.eventType && !isPlatformEvent(String(e.eventType)) && !e.tenantId) bad.push('tenant_id_missing');  // §13
  if (!e.payload || typeof e.payload !== 'object') bad.push('payload_missing');
  else {
    const walk = (o: unknown, path: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (FORBIDDEN_EVENT_PAYLOAD_KEYS.includes(k)) bad.push(`forbidden_payload_key:${path}${k}`);
        if (v && typeof v === 'object') walk(v, `${path}${k}.`);
      }
    };
    walk(e.payload, '');
    if (Buffer.byteLength(JSON.stringify(e.payload)) > MAX_PAYLOAD_BYTES) bad.push('payload_too_large');
  }
  return bad;
}
