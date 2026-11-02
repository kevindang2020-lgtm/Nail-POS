// queue-lifecycles.ts — BUILD_PLAN Phase 12 (#27): the queue module's own lifecycles as state machines (the appointment,
// queue item and technician-ticket machines live in @aipowersalon/appointments — every front-desk module depends on it).
// Each table is exactly the moves the code makes today; a terminal state is never revived.
import { defineStateMachine } from '@aipowersalon/database';

/** queue_service_assignments.status — the per-service plan of a multi-technician visit (re-planned while not started). */
export const QUEUE_SERVICE_ASSIGNMENT = defineStateMachine({
  name: 'queue_service_assignment', table: 'queue_service_assignments', column: 'status',
  states: ['pending', 'assigned', 'in_service', 'done', 'cancelled'],
  // multi-technician routing (569): a service taken off the visit and put back re-plans its line (cancelled → pending / assigned)
  transitions: { pending: ['pending', 'assigned', 'in_service', 'cancelled'], assigned: ['assigned', 'pending', 'in_service', 'cancelled'], in_service: ['in_service', 'done', 'cancelled'], cancelled: ['cancelled', 'pending', 'assigned'] },
  initial: ['pending', 'assigned'],
});

/** go_checkin_devices.status — an admin flag (active / inactive / disabled), the token sweep's expired (a regenerated token
 *  re-activates it), and revoked — terminal: a revoked kiosk's pairing is never revived. */
export const GO_CHECKIN_DEVICE = defineStateMachine({
  name: 'go_checkin_device', table: 'go_checkin_devices', column: 'status',
  states: ['active', 'inactive', 'disabled', 'expired', 'revoked'],
  transitions: {
    active: ['active', 'inactive', 'disabled', 'expired', 'revoked'],
    inactive: ['inactive', 'active', 'disabled', 'expired', 'revoked'],
    disabled: ['disabled', 'active', 'inactive', 'expired', 'revoked'],
    expired: ['expired', 'active', 'inactive', 'disabled', 'revoked'],
    revoked: ['revoked'],
  },
  initial: ['active'],
});

/** go_checkin_sessions.status — a kiosk session ends completed or expired (or failed / revoked); an ended session is not reopened. */
export const GO_CHECKIN_SESSION = defineStateMachine({
  name: 'go_checkin_session', table: 'go_checkin_sessions', column: 'status',
  states: ['active', 'inactive', 'completed', 'expired', 'failed', 'revoked'],
  transitions: {
    active: ['active', 'inactive', 'completed', 'expired', 'failed', 'revoked'],
    inactive: ['inactive', 'active', 'completed', 'expired', 'revoked'],
    completed: ['completed'], expired: ['expired'],
  },
  initial: ['active'],
});

/** ticket_change_requests.status — a technician's change to a serving line: applied at once, or pending until a manager
 *  approves (applied) or rejects it. A decided request is final. */
export const TICKET_CHANGE_REQUEST = defineStateMachine({
  name: 'ticket_change_request', table: 'ticket_change_requests', column: 'status',
  states: ['pending', 'approved', 'applied', 'rejected', 'cancelled'],
  transitions: { pending: ['approved', 'applied', 'rejected', 'cancelled'], approved: ['applied'] },
  initial: ['pending'],
});

/** technician_skill_change_requests.status — the technician edits a draft / more-info request (and submits it); the
 *  manager reviews it (SKILL_REVIEW_MOVES in tech.repository.ts — the same table). */
export const SKILL_CHANGE_REQUEST = defineStateMachine({
  name: 'skill_change_request', table: 'technician_skill_change_requests', column: 'status',
  // 'pending' (053's default) is gone: migration 583 folded legacy pending rows into submitted and its CHECK no longer allows it
  states: ['draft', 'submitted', 'under_review', 'more_information_required', 'approved', 'rejected'],
  transitions: {
    draft: ['draft', 'submitted'],
    more_information_required: ['draft', 'submitted', 'approved', 'rejected'],
    submitted: ['under_review', 'more_information_required', 'approved', 'rejected'],
    under_review: ['more_information_required', 'approved', 'rejected'],
  },
  initial: ['draft', 'submitted'],
});

/** technician_manager_messages.status — unread → read → resolved (resolving is idempotent). */
export const MANAGER_MESSAGE = defineStateMachine({
  name: 'technician_manager_message', table: 'technician_manager_messages', column: 'status',
  states: ['unread', 'read', 'resolved'],
  transitions: { unread: ['read', 'resolved'], read: ['resolved'], resolved: ['resolved'] },
  initial: ['unread'],
});

/** technician_certifications.verification_status (migration 584, Oct 12 2026 merge): a technician's entry is UNVERIFIED; a
 *  manager VERIFIES or REVOKES it; the sweep marks a past-date row EXPIRED; editing the evidence (or extending an expired
 *  date) sends it back to UNVERIFIED. REVOKED is terminal — a revoked certification is never verified again (add a new one). */
export const TECHNICIAN_CERTIFICATION = defineStateMachine({
  name: 'technician_certification', table: 'technician_certifications', column: 'verification_status',
  states: ['UNVERIFIED', 'VERIFIED', 'EXPIRED', 'REVOKED'],
  transitions: {
    UNVERIFIED: ['UNVERIFIED', 'VERIFIED', 'EXPIRED', 'REVOKED'],
    VERIFIED: ['VERIFIED', 'UNVERIFIED', 'EXPIRED', 'REVOKED'],
    EXPIRED: ['EXPIRED', 'UNVERIFIED', 'VERIFIED', 'REVOKED'],
    REVOKED: ['REVOKED'],
  },
  initial: ['UNVERIFIED'],
});

/** ticket_service_sessions.status (586, PAY merge Oct 12 2026) — a durable Serving session: STARTED ⇄ PAUSED, either
 *  completes at Service Done; a COMPLETED primary session re-opens to STARTED only when Service Done is reopened. A session
 *  may be born STARTED (start) or COMPLETED (the ONE Service Done records a completion that had no live session). */
export const TICKET_SERVICE_SESSION = defineStateMachine({
  name: 'ticket_service_session', table: 'ticket_service_sessions', column: 'status',
  states: ['STARTED', 'PAUSED', 'COMPLETED'],
  transitions: { STARTED: ['PAUSED', 'COMPLETED'], PAUSED: ['STARTED', 'COMPLETED'], COMPLETED: ['STARTED'] },
  initial: ['STARTED', 'COMPLETED'],
});

/** tickets.serving_delay_status (586) — the Serving delay level; re-reported or cleared freely (every level ↔ every level). */
export const SERVING_DELAY = defineStateMachine({
  name: 'serving_delay', table: 'tickets', column: 'serving_delay_status',
  states: ['none', 'warning', 'late', 'critical'],
  transitions: {
    none: ['none', 'warning', 'late', 'critical'], warning: ['none', 'warning', 'late', 'critical'],
    late: ['none', 'warning', 'late', 'critical'], critical: ['none', 'warning', 'late', 'critical'],
  },
  initial: ['none'],
});

/** tickets.service_done_checkout_status — the Service Done handoff (Service Done mandate, Oct 28 2026, §22–§37). A completed
 *  visit is not_ready; it becomes ready_for_checkout (quality / notes rule passed) and then sent_to_checkout (the front
 *  desk has it) — or goes straight to sent. Any of them may be reopened (an explicit, reasoned correction). A reopened
 *  visit, or one Serving reopened and completed again, starts over at not_ready (service-done-transition.ts). Before this
 *  the column was never written — the workflow lived in the API process's memory. */
export const SERVICE_DONE_CHECKOUT = defineStateMachine({
  name: 'service_done_checkout', table: 'tickets', column: 'service_done_checkout_status',
  states: ['not_ready', 'ready_for_checkout', 'sent_to_checkout', 'reopened'],
  transitions: {
    not_ready: ['not_ready', 'ready_for_checkout', 'sent_to_checkout', 'reopened'],
    ready_for_checkout: ['ready_for_checkout', 'sent_to_checkout', 'reopened', 'not_ready'],
    sent_to_checkout: ['sent_to_checkout', 'reopened', 'not_ready'],
    reopened: ['reopened', 'not_ready'],
  },
  initial: ['not_ready'],
});

/** tickets.service_done_quality_status — the quality check / guest confirmation (§28–§31). A review decision may move it
 *  either way while the visit is at Service Done (the service refuses a change after the handoff — Reopen first); a
 *  re-completion after a reopen resets it to pending (reconfirm after rework, §30). */
export const SERVICE_DONE_QUALITY = defineStateMachine({
  name: 'service_done_quality', table: 'tickets', column: 'service_done_quality_status',
  states: ['pending', 'approved', 'issue_found', 'needs_review'],
  transitions: {
    pending: ['pending', 'approved', 'issue_found', 'needs_review'],
    approved: ['approved', 'pending', 'issue_found', 'needs_review'],
    issue_found: ['issue_found', 'pending', 'approved', 'needs_review'],
    needs_review: ['needs_review', 'pending', 'approved', 'issue_found'],
  },
  initial: ['pending'],
});
