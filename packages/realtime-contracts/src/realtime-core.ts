// realtime-core.ts — pure, tested core for WebSocket/SSE. The transport can't run here (no WS server),
// but the room keys + event→refetch routing are verifiable, so the client/gateway are thin shells over this.

export const EVENTS = {
  appointmentCreated: "appointment_created", appointmentUpdated: "appointment_updated", appointmentCancelled: "appointment_cancelled",
  customerCheckedIn: "customer_checked_in", queueUpdated: "queue_updated", ticketAssigned: "ticket_assigned",
  serviceStarted: "service_started", serviceDone: "service_done", ticketReadyCheckout: "ticket_ready_checkout",
  servicePaused: "service_paused", serviceResumed: "service_resumed",
  checkoutTotalRecalculated: "checkout_total_recalculated", customerDisplayTipSelected: "customer_display_tip_selected",
  customerDisplayPaymentRequested: "customer_display_payment_requested",
  customerDisplayMethodSelected: "customer_display_method_selected",
  customerDisplaySignatureCaptured: "customer_display_signature_captured",
  // 23-inch dual-screen spec §99–§100: the display's OWN channel (rooms.customerDisplayDevice). A checkout attached to
  // or detached from the device, and any change to the ticket it is showing, reach it in under a second. Ids only —
  // the display refetches its customer-safe state through the device route.
  customerDisplaySessionStarted: "customer_display_session_started", customerDisplayCheckoutUpdated: "customer_display_checkout_updated",
  customerDisplayCompleted: "customer_display_completed", customerDisplayCanceled: "customer_display_canceled",
  // 23-inch dual-screen spec §73–§74: the salon's advertising playlist changed (published, paused, archived, edited,
  // settings) — ids only; the display refetches GET /customer-display/device/ads and POS advertising screens refresh.
  customerDisplayAdsUpdated: "customer_display_ads_updated",
  // 23-inch dual-screen spec §81–§86: a display was paired, renamed, moved to another register, put in or out of
  // maintenance, revoked — or came online / went quiet. Ids only: POS screens refresh their display list and status
  // card; the display itself refetches its state (maintenance shows on it).
  customerDisplayDeviceUpdated: "customer_display_device_updated",
  // §82 "Refresh Display": the receptionist asked this display to reload itself (a stuck or stale screen). Ids only.
  customerDisplayRefreshRequested: "customer_display_refresh_requested",
  paymentProcessingStarted: "payment_processing_started", paymentApproved: "payment_approved", paymentFailed: "payment_failed",
  ticketPaid: "ticket_paid", receiptSent: "receipt_sent", reportsUpdated: "reports_updated",
  // Owner & Manager Payment App mandate §39/§45/§74/§149/§174 (wave 3 / TTP). Ids only: a payment claim was taken on a
  // ticket (source pos|mobile|display, the device label) or released — the POS shows "Payment in progress — Manager …
  // / Device …" and disables a second card start; a mobile result is being verified / was recovered; a registered
  // payment phone changed (approved, revoked, online, offline); the front desk sent a checkout to a phone.
  checkoutPaymentClaimed: "checkout_payment_claimed", checkoutPaymentClaimReleased: "checkout_payment_claim_released",
  paymentVerifying: "payment_verifying", paymentRecovered: "payment_recovered",
  mobilePayDeviceUpdated: "mobile_pay_device_updated", checkoutSentToMobile: "checkout_sent_to_mobile",
  technicianEarningsUpdated: "technician_earnings_updated", settingsUpdated: "settings_updated", tenantStatusUpdated: "tenant_status_updated",
  platformOpsSnapshot: "platform_ops_snapshot",   // Constitution 9 §60: the ONE aggregate event the Super Admin Live Ops stream receives
  // Constitution 9 §25/§26 — names three modules (cash-drawer, tech-cash-handoff, skip-line-checkout) had been emitting
  // OUTSIDE the registry through `event as any` wrappers: the POS cash screens subscribed to routing that never existed.
  cashDrawerOpened: "cash_drawer_opened", cashDrawerMovement: "cash_drawer_movement", cashDrawerReconciled: "cash_drawer_reconciled",
  cashDrawerDiscrepancy: "cash_drawer_discrepancy", cashHandoffSubmitted: "cash_handoff_submitted", cashHandoffReconciled: "cash_handoff_reconciled",
  cashHandoffDiscrepancy: "cash_handoff_discrepancy", customerBillOpened: "customer_bill_opened", customerPaymentStarted: "customer_payment_started",
  customerPaymentProcessing: "customer_payment_processing", customerPaymentSucceeded: "customer_payment_succeeded", customerPaymentFailed: "customer_payment_failed",
  skipLinePaymentPromptSent: "skip_line_payment_prompt_sent", cashToTechnicianSelected: "cash_to_technician_selected", cashPendingTechConfirmation: "cash_pending_tech_confirmation",
  cashConfirmedByTech: "cash_confirmed_by_tech", cashIssueNeedsFrontDesk: "cash_issue_needs_front_desk", loyaltyPointsAdded: "loyalty_points_added",
  receiptCreated: "receipt_created", ticketClosed: "ticket_closed",
  timeClockUpdated: "time_clock_updated",
  // Technician Profile merge (Oct 12 2026, workforce-status): the ONE authoritative technician operational state changed
  // (payload: technicianId, branchId, the six statuses, version — ids and states only); a clock punch / break moved;
  // a technician's weekly schedule was replaced (payload: technicianId, version).
  technicianStatusUpdated: "technician_status_updated", technicianClockUpdated: "technician_clock_updated",
  technicianScheduleUpdated: "technician_schedule_updated",
  // Fair Turn Engine (wave 2): the branch's technician TURN QUEUE moved (join / assign / credit / hold / reorder / …) — ids and
  // event types only (never turn money); boards refetch the board, the Technician App refetches its own position.
  turnQueueUpdated: "turn_queue_updated",
  // Constitution 10 §164: the realtime layer MAY tell an authorized client that an AI job moved on. Ids only —
  // the final AI result stays server-side and the client fetches it through the normal guarded route.
  aiJobProgress: "ai_job_progress", aiJobCompleted: "ai_job_completed",
  customerProfileUpdated: "customer_profile_updated",
  ownerAlertCreated: "owner_alert_created", ownerAlertUpdated: "owner_alert_updated", ownerPayrollUpdated: "owner_payroll_updated",
  ticketServiceLineAdded: "ticket_service_line_added", ticketServiceLineUpdated: "ticket_service_line_updated",
  ticketServiceLineRemoved: "ticket_service_line_removed", ticketTotalRecalculated: "ticket_total_recalculated",
  ticketChangeRequestCreated: "ticket_change_request_created", ticketChangeRequestApproved: "ticket_change_request_approved",
  ticketChangeRequestRejected: "ticket_change_request_rejected",
  techProfileUpdated: "technician_profile_updated", techMembershipRequested: "tech_salon_membership_requested",
  techMembershipApproved: "tech_salon_membership_approved", techMembershipRejected: "tech_salon_membership_rejected",
  techRatingSubmitted: "technician_rating_submitted",
  dailyFollowUpsCreated: "daily_follow_up_tasks_created", followUpTaskUpdated: "follow_up_task_updated",
  customerFollowUpReceived: "customer_follow_up_received",
  technicianHelpRequested: "technician_help_requested", technicianHelpAccepted: "technician_help_accepted",
  technicianHelpDeclined: "technician_help_declined", ticketLineTechnicianAssigned: "ticket_line_technician_assigned",
  // AI queue assignment — the port emitted dotted domain-style names ('queue.alert_raised') that no client could route:
  queueAlertRaised: "queue_alert_raised", queueAlertAcknowledged: "queue_alert_acknowledged", queueAlertResolved: "queue_alert_resolved",
  queueAssignmentRecommended: "queue_assignment_recommended", queueAutoAssigned: "queue_auto_assigned", queueAutoAssignmentKilled: "queue_auto_assignment_killed",
  queueRecordRepaired: "queue_record_repaired",
  // BUILD_PLAN Phase 6: decisions (they were dropped — no wire name), locks, reorder, settings, groups
  queueAssignmentDecided: "queue_assignment_decided", queueAssignmentLocked: "queue_assignment_locked", queueAssignmentUnlocked: "queue_assignment_unlocked",
  queueReordered: "queue_reordered", queueAssignmentSettingsChanged: "queue_assignment_settings_changed", queueGroupCreated: "queue_group_created",
  // BUILD_PLAN Phase 7: the scheduling optimizer (projected from the schedule.* domain events; the screens refetch)
  scheduleRecommendationUpdated: "schedule_recommendation_updated", scheduleRunCompleted: "schedule_run_completed",
  scheduleSettingsChanged: "schedule_settings_changed", scheduleProposalUpdated: "schedule_proposal_updated",
  // BUILD_PLAN Phase 8: Safety Community (projected from community.* domain events; screens refetch)
  communityPostUpdated: "community_post_updated", communityCommentAdded: "community_comment_added", communityAlert: "community_alert",
  communitySettingsChanged: "community_settings_changed",
  // BUILD_PLAN Phase 9: approvals inbox + "your access changed" (the client refetches its session / navigation)
  approvalUpdated: "approval_updated", authorizationChanged: "authorization_changed",
  // Receipt/Expense/OCR/Accounting mandate (Oct 21 2026, §150): one refetch signal for receipts, expenses, bills and
  // reimbursements (projected from expense_receipt.* / expense.* / bill.*) — ids + status only, never amounts or text
  expenseUpdated: "expense_updated",
  // Super Admin POS Top-Bar Announcement mandate (Oct 22 2026, §64–§73): a Platform Announcement that concerns THIS salon
  // was published / edited / paused / resumed / archived — ids + version only; the POS refetches its own snapshot
  platformAnnouncementUpdated: "platform_announcement_updated",
  // Communications / SMS Inbox guide (Oct 30 2026, §10.3): a conversation changed AFTER the change committed — a customer
  // text arrived, a staff reply was submitted, a provider status moved, read / unread, assigned, closed / reopened, snoozed,
  // customer linked. Ids + kind + thread version only (never a phone, a name or message text); the inbox refetches.
  conversationUpdated: "conversation_updated",
  // C2 gap (Nov 5 2026): a provider delivery report moved a sent text / e-mail (reminder, campaign, win-back, notification) —
  // ids + status only; the reminder / campaign / notification screens refetch (they polled before)
  messageDeliveryUpdated: "message_delivery_updated",
  // Team Management TM-05 (gap sweep, Oct 30 2026): a team member was added — Team screens refetch (ids only)
  teamMemberCreated: "team_member_created",
  // Global Loyalty & Rewards Network (Oct 30 2026): the salon's earning rule / wallet / a token purchase changed — refetch (ids only)
  loyaltyNetworkUpdated: "loyalty_network_updated",
} as const;
export type EventName = typeof EVENTS[keyof typeof EVENTS];
/**
 * Constitution 9 §27 — every client event carries a version. Bump a version ONLY when a frame's meaning or
 * payload shape changes incompatibly; additive fields never need a bump (§245). The CI contract
 * (`check:realtime-contract`) fails on any event without a version, and the shared client carries this block
 * byte-identical.
 */
export const EVENT_VERSIONS: Record<EventName, number> = {
  ai_job_progress: 1,   ai_job_completed: 1,
  appointment_created: 1,   appointment_updated: 1,   appointment_cancelled: 1,
  customer_checked_in: 1,   queue_updated: 1,   ticket_assigned: 1,
  service_started: 1,   service_done: 1,   ticket_ready_checkout: 1,
  service_paused: 1,   service_resumed: 1,   checkout_total_recalculated: 1,
  customer_display_tip_selected: 1,   customer_display_payment_requested: 1,   customer_display_method_selected: 1,
  customer_display_signature_captured: 1,   payment_processing_started: 1,   payment_approved: 1,
  customer_display_session_started: 1,   customer_display_checkout_updated: 1,   customer_display_completed: 1,
  customer_display_canceled: 1,   customer_display_ads_updated: 1,   customer_display_device_updated: 1,
  customer_display_refresh_requested: 1,
  payment_failed: 1,   ticket_paid: 1,   receipt_sent: 1,
  checkout_payment_claimed: 1,   checkout_payment_claim_released: 1,   payment_verifying: 1,   payment_recovered: 1,
  mobile_pay_device_updated: 1,   checkout_sent_to_mobile: 1,
  reports_updated: 1,   technician_earnings_updated: 1,   settings_updated: 1,
  tenant_status_updated: 1,   platform_ops_snapshot: 1,   time_clock_updated: 1,
  technician_status_updated: 1,   technician_clock_updated: 1,   technician_schedule_updated: 1,
  turn_queue_updated: 1,
  customer_profile_updated: 1,   owner_alert_created: 1,   owner_alert_updated: 1,
  owner_payroll_updated: 1,   ticket_service_line_added: 1,   ticket_service_line_updated: 1,
  ticket_service_line_removed: 1,   ticket_total_recalculated: 1,   ticket_change_request_created: 1,
  ticket_change_request_approved: 1,   ticket_change_request_rejected: 1,   technician_profile_updated: 1,
  tech_salon_membership_requested: 1,   tech_salon_membership_approved: 1,   tech_salon_membership_rejected: 1,
  technician_rating_submitted: 1,   daily_follow_up_tasks_created: 1,   follow_up_task_updated: 1,
  customer_follow_up_received: 1,   technician_help_requested: 1,   technician_help_accepted: 1,
  technician_help_declined: 1,   ticket_line_technician_assigned: 1,
  cash_drawer_opened: 1, cash_drawer_movement: 1, cash_drawer_reconciled: 1,
  cash_drawer_discrepancy: 1, cash_handoff_submitted: 1, cash_handoff_reconciled: 1,
  cash_handoff_discrepancy: 1, customer_bill_opened: 1, customer_payment_started: 1,
  customer_payment_processing: 1, customer_payment_succeeded: 1, customer_payment_failed: 1,
  skip_line_payment_prompt_sent: 1, cash_to_technician_selected: 1, cash_pending_tech_confirmation: 1,
  cash_confirmed_by_tech: 1, cash_issue_needs_front_desk: 1, loyalty_points_added: 1,
  receipt_created: 1, ticket_closed: 1,
  queue_alert_raised: 1, queue_alert_acknowledged: 1, queue_alert_resolved: 1,
  queue_assignment_recommended: 1, queue_auto_assigned: 1, queue_auto_assignment_killed: 1,
  queue_record_repaired: 1,
  queue_assignment_decided: 1, queue_assignment_locked: 1, queue_assignment_unlocked: 1, queue_reordered: 1,
  queue_assignment_settings_changed: 1, queue_group_created: 1,
  schedule_recommendation_updated: 1, schedule_run_completed: 1, schedule_settings_changed: 1, schedule_proposal_updated: 1,
  community_post_updated: 1, community_comment_added: 1, community_alert: 1, community_settings_changed: 1,
  approval_updated: 1, authorization_changed: 1,
  expense_updated: 1,
  platform_announcement_updated: 1,
  conversation_updated: 1,
  message_delivery_updated: 1,
  team_member_created: 1,
  loyalty_network_updated: 1,
};
export function eventVersion(event: string): number { return (EVENT_VERSIONS as Record<string, number>)[event] ?? 1; }


// room key builders — every tenant subscription is scoped to tenant+branch.
export const rooms = {
  tenantBranch: (t: string, b: string) => `tenant:${t}:branch:${b}`,
  technician: (id: string) => `technician:${id}`,
  customer: (id: string) => `customer:${id}`,
  ticket: (id: string) => `ticket:${id}`,
  appointment: (id: string) => `appointment:${id}`,
  customerDisplay: (id: string) => `customer_display:${id}`,
  /** 23-inch dual-screen spec §100: ONE physical display's channel (session start / end reach an idle display here).
   *  Never a tenant-wide room — only the device holding that device's credential is subscribed. */
  customerDisplayDevice: (deviceId: string) => `customer_display:device:${deviceId}`,
  /** Secure Tap to Pay §16 / §38 (M6-6): ONE payment phone's channel — "send checkout to this phone", its own revocation.
   *  Tenant-scoped; only a stream whose AUTHENTICATED SESSION was opened on that registered device is subscribed. */
  paymentDevice: (tenantId: string, deviceId: string) => `tenant:${tenantId}:payment_device:${deviceId}`,
  superAdmin: () => `super_admin`,
  ownerTenant: (t: string) => `tenant:${t}:owner`,
  /** Constitution 9 §59/§146: the platform room carries AGGREGATES only — never a tenant's raw stream. */
  platform: () => 'platform:live-ops',
};

// which screens/queries should refetch when an event arrives (fallback when no granular patch).
const AFFECTS: Record<string, string[]> = {
  // Every event → the POS screens that refetch on it (Constitution 9 §246: no event reaches the POS with an empty list).
  // Merged Sep 2026 with the developer's routing: a screen listed by either side stays listed.
  technician_help_requested: ["serving", "tech-queue"],
  technician_help_accepted: ["serving", "tech-queue", "overview"],
  technician_help_declined: ["serving", "tech-queue"],
  ticket_line_technician_assigned: ["serving", "checkout", "overview"],
  appointment_created: ["booking", "tech-appointments", "dashboard", "overview"],
  appointment_updated: ["booking", "tech-appointments", "dashboard", "overview"],
  appointment_cancelled: ["booking", "tech-appointments", "dashboard", "overview"],
  customer_checked_in: ["check-in", "queue", "tech-queue", "dashboard", "overview"],
  queue_updated: ["queue", "tech-queue", "dashboard", "overview", "check-in", "booking"],
  ticket_assigned: ["queue", "tech-queue", "serving", "booking", "tech-appointments", "overview"],
  service_started: ["serving", "tech-queue", "booking", "tech-appointments", "queue", "dashboard", "overview", "check-in"],
  service_paused: ["serving", "tech-queue", "booking", "tech-appointments", "queue", "dashboard", "overview"],
  service_resumed: ["serving", "tech-queue", "booking", "tech-appointments", "queue", "dashboard", "overview"],
  service_done: ["service-done", "checkout", "serving", "tech-queue", "booking", "tech-appointments", "queue", "dashboard", "overview", "check-in"],
  ticket_ready_checkout: ["checkout", "service-done", "dashboard", "overview"],
  checkout_total_recalculated: ["checkout"],
  ticket_service_line_added: ["serving", "checkout", "service-done"],
  ticket_service_line_updated: ["serving", "checkout", "service-done"],
  ticket_service_line_removed: ["serving", "checkout", "service-done"],
  ticket_total_recalculated: ["checkout", "serving"],
  ticket_change_request_created: ["serving", "tech-queue"],
  ticket_change_request_approved: ["serving", "checkout", "tech-queue"],
  ticket_change_request_rejected: ["serving", "tech-queue"],
  customer_display_signature_captured: ["checkout"],
  customer_display_session_started: ["checkout"],
  customer_display_checkout_updated: ["checkout"],
  customer_display_completed: ["checkout"],
  customer_display_canceled: ["checkout"],
  customer_display_ads_updated: ["display-ads"],
  customer_display_device_updated: ["checkout", "devices"],
  customer_display_refresh_requested: [],
  tenant_status_updated: ["dashboard", "overview"],
  technician_profile_updated: ["technicians"],
  tech_salon_membership_requested: ["technicians"],
  tech_salon_membership_approved: ["technicians"],
  tech_salon_membership_rejected: ["technicians"],
  technician_rating_submitted: ["technicians", "reports"],
  customer_display_tip_selected: ["checkout"],
  customer_display_payment_requested: ["checkout"],
  customer_display_method_selected: ["checkout"],
  payment_processing_started: ["checkout"],
  checkout_payment_claimed: ["checkout"],
  checkout_payment_claim_released: ["checkout"],
  payment_verifying: ["checkout"],
  payment_recovered: ["checkout", "reports"],
  mobile_pay_device_updated: ["checkout", "devices"],
  checkout_sent_to_mobile: ["checkout"],
  payment_approved: ["checkout", "reports", "dashboard", "overview"],
  payment_failed: ["checkout"],
  ticket_paid: ["checkout", "reports", "technicians", "customers", "dashboard", "overview"],
  receipt_sent: ["checkout"],
  reports_updated: ["reports", "dashboard", "overview"],
  time_clock_updated: ["overview", "dashboard", "technicians"],
  technician_status_updated: ["technicians", "queue", "tech-queue", "serving", "overview", "dashboard", "live-schedule", "check-in"],
  technician_clock_updated: ["technicians", "overview", "dashboard", "live-schedule", "time-clock"],
  technician_schedule_updated: ["technicians", "booking", "live-schedule", "tech-schedule"],
  turn_queue_updated: ["turn-queue", "queue", "tech-queue", "tech-turn-queue"],
  customer_profile_updated: ["customers", "check-in", "booking"],
  technician_earnings_updated: ["technicians", "reports"],
  settings_updated: ["settings"],
  owner_alert_created: ["alerts", "dashboard"],
  owner_alert_updated: ["alerts", "dashboard"],
  owner_payroll_updated: ["approvals", "payroll", "dashboard"],
  expense_updated: ["expenses", "finance-reports", "dashboard"],
  platform_announcement_updated: ["platform-announcements"],
  conversation_updated: ["communications"],
  message_delivery_updated: ["communications", "notifications", "campaigns", "reminders", "retention"],
  team_member_created: ["technicians", "team-permissions"],
  loyalty_network_updated: ["loyalty"],
  daily_follow_up_tasks_created: ["follow-ups"],
  follow_up_task_updated: ["follow-ups"],
  customer_follow_up_received: ["customer-follow-ups"],
  cash_drawer_opened: ["cash-drawer", "dashboard"],
  cash_drawer_movement: ["cash-drawer", "dashboard"],
  cash_drawer_reconciled: ["cash-drawer", "dashboard", "reports"],
  cash_drawer_discrepancy: ["cash-drawer", "dashboard", "reports"],
  cash_handoff_submitted: ["cash-handoffs", "cash-drawer", "dashboard"],
  cash_handoff_reconciled: ["cash-handoffs", "cash-drawer", "dashboard", "reports"],
  cash_handoff_discrepancy: ["cash-handoffs", "cash-drawer", "dashboard", "reports"],
  customer_bill_opened: ["checkout"],
  customer_payment_started: ["checkout"],
  customer_payment_processing: ["checkout"],
  customer_payment_succeeded: ["checkout", "dashboard", "overview"],
  customer_payment_failed: ["checkout"],
  skip_line_payment_prompt_sent: ["checkout"],
  cash_to_technician_selected: ["checkout", "cash-drawer"],
  cash_pending_tech_confirmation: ["checkout", "cash-drawer", "tech-queue"],
  cash_confirmed_by_tech: ["checkout", "cash-drawer", "cash-handoffs"],
  cash_issue_needs_front_desk: ["checkout", "cash-drawer", "queue"],
  loyalty_points_added: ["checkout", "customers"],
  receipt_created: ["checkout"],
  ticket_closed: ["checkout", "serving", "dashboard", "overview"],
  queue_alert_raised: ["queue", "ai-queue-assignment", "dashboard"],
  queue_alert_acknowledged: ["ai-queue-assignment"],
  queue_alert_resolved: ["ai-queue-assignment", "queue"],
  queue_assignment_recommended: ["ai-queue-assignment", "queue", "tech-queue"],
  queue_auto_assigned: ["queue", "tech-queue", "ai-queue-assignment", "serving"],
  queue_auto_assignment_killed: ["ai-queue-assignment", "queue"],
  queue_record_repaired: ["queue", "ai-queue-assignment"],
  queue_assignment_decided: ["ai-queue-assignment", "queue", "tech-queue"],
  queue_assignment_locked: ["queue", "tech-queue", "ai-queue-assignment"],
  queue_assignment_unlocked: ["queue", "tech-queue", "ai-queue-assignment"],
  queue_reordered: ["queue", "tech-queue", "check-in"],
  queue_assignment_settings_changed: ["ai-queue-assignment"],
  queue_group_created: ["queue", "tech-queue", "check-in"],
  schedule_recommendation_updated: ["ai-scheduling-optimizer", "booking"],
  schedule_run_completed: ["ai-scheduling-optimizer"],
  schedule_settings_changed: ["ai-scheduling-optimizer"],
  schedule_proposal_updated: ["ai-scheduling-optimizer", "booking"],
  community_post_updated: ["community"],
  community_comment_added: ["community"],
  community_alert: ["community", "dashboard"],
  community_settings_changed: ["community"],
  approval_updated: ["approvals"],
  authorization_changed: ["session", "navigation", "team-permissions"],
};
export function screensToRefetch(event: string): string[] { return AFFECTS[event] || []; }

// ── §12 minimal event envelope + §19/§20 ordering & idempotency ────────────────────────────────────────────
//
// Every emission carries WHAT changed (eventType), WHERE (tenantId/branchId/resource), WHEN (updatedAt), and a
// monotonic-enough identity (eventId, version). Payloads stay minimal: identifiers and versions, never customer
// phone numbers, emails, notes, or payment data — the client refetches what it is authorized to see.

export interface EventEnvelope {
  eventId: string;
  eventType: EventName;
  tenantId?: string;
  branchId?: string;
  resourceType?: string;
  resourceId?: string;
  updatedAt: string;                     // ISO instant the server produced the event
  version?: number;                      // per-resource version when the domain tracks one
  data?: Record<string, unknown>;        // identifiers only — see FORBIDDEN_PAYLOAD_KEYS
}

let seq = 0;
export function makeEnvelope(input: { eventType: EventName; tenantId?: string; branchId?: string; resourceType?: string; resourceId?: string; version?: number; data?: Record<string, unknown>; now?: () => Date }): EventEnvelope {
  const now = (input.now ?? (() => new Date()))();
  // Unique without a UUID dependency: instant + per-process counter. Two nodes can never collide because the
  // envelope is created once, on the emitting node, and fanned out as-is.
  const eventId = `${now.getTime().toString(36)}-${(seq = (seq + 1) % 1_679_616).toString(36).padStart(4, '0')}-${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`;
  return { eventId, eventType: input.eventType, tenantId: input.tenantId, branchId: input.branchId, resourceType: input.resourceType, resourceId: input.resourceId, updatedAt: now.toISOString(), version: input.version, data: input.data };
}

// §12: keys that must never appear in a realtime payload. The check is a guard rail for future emit sites —
// events tell the client to refetch; they do not carry the data itself.
export const FORBIDDEN_PAYLOAD_KEYS = ['phone', 'phoneDisplay', 'normalizedPhone', 'email', 'notes', 'card', 'cardNumber', 'pan', 'cvv', 'token', 'password', 'ssn'] as const;
export function payloadViolations(data: Record<string, unknown> | undefined): string[] {
  if (!data) return [];
  const bad: string[] = [];
  const walk = (o: unknown, path: string) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if ((FORBIDDEN_PAYLOAD_KEYS as readonly string[]).some((f) => k.toLowerCase() === f.toLowerCase())) bad.push(path ? `${path}.${k}` : k);
      walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(data, '');
  return bad;
}

/** True when a payload is already a full envelope (built by an emit site via makeEnvelope). */
export function isEnvelope(p: unknown): p is EventEnvelope {
  return !!p && typeof p === 'object'
    && typeof (p as { eventId?: unknown }).eventId === 'string'
    && typeof (p as { eventType?: unknown }).eventType === 'string'
    && typeof (p as { updatedAt?: unknown }).updatedAt === 'string';
}

/** Deep-copy `data` with every FORBIDDEN key removed, counting removals. Arrays are walked; primitives pass. */
function stripForbidden(o: unknown, count: { n: number }): unknown {
  if (Array.isArray(o)) return o.map((v) => stripForbidden(v, count));
  if (!o || typeof o !== 'object') return o;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if ((FORBIDDEN_PAYLOAD_KEYS as readonly string[]).some((f) => k.toLowerCase() === f.toLowerCase())) { count.n++; continue; }
    out[k] = stripForbidden(v, count);
  }
  return out;
}

/**
 * §12/§19/§20 AT THE PORT (Jul 28, 2026). 68 emit sites predate the envelope and publish ad-hoc payloads — so
 * eventId dedupe, ordering, and the PII guard applied only to the handful of migrated sites. Instead of editing all
 * 68, every emitter port method now runs its payload through here: an existing envelope passes through UNTOUCHED
 * (same eventId — created once, on the origin node, so the Redis fan-out carries one identity across nodes and
 * wrapping is idempotent where the bus delegates to the local emitter); anything else is wrapped in a real envelope
 * with forbidden keys STRIPPED and counted, never thrown — realtime must never become load-bearing. Rich sites
 * should still call makeEnvelope themselves to attach resourceType/resourceId/version; this is the floor, not the
 * ceiling.
 */
export function ensureEnvelope(event: EventName, payload: unknown, scope?: { tenantId?: string; branchId?: string }): { envelope: EventEnvelope; piiStripped: number } {
  if (isEnvelope(payload)) return { envelope: payload, piiStripped: 0 };
  const count = { n: 0 };
  let data: Record<string, unknown> | undefined;
  if (payload == null) data = undefined;
  else if (typeof payload === 'object' && !Array.isArray(payload)) data = stripForbidden(payload, count) as Record<string, unknown>;
  else data = { value: payload };
  return { envelope: makeEnvelope({ eventType: event, tenantId: scope?.tenantId, branchId: scope?.branchId, data }), piiStripped: count.n };
}

/**
 * 23-inch dual-screen spec §36–§37: a POS change to the ticket a customer display is showing must reach that display in
 * under a second, whichever code path made it (the outbox projection or a direct emit). Every tenant event that names
 * ONE ticket is therefore mirrored, as an ids-only `customer_display_checkout_updated`, into that ticket's room — the
 * room a display showing the ticket subscribes to. Returns the ticket id to nudge, or null (no ticket named, or the
 * event is already a customer-display event, so a nudge never re-triggers itself).
 */
export function displayNudgeTicketId(event: string, payload: unknown): string | null {
  if (typeof event !== 'string' || event.startsWith('customer_display_')) return null;
  const id = payload && typeof payload === 'object' ? (payload as { ticketId?: unknown }).ticketId : undefined;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
