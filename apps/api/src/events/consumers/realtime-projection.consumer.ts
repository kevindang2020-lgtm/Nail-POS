// realtime-projection.consumer.ts — Constitution 8, Phase 14: domain events → the EXISTING client vocabulary.
//
// §112–113: realtime events are a PROJECTION of domain events, never the domain events themselves. The 44 names
// in realtime-core.ts are the client contract (screens refetch on them) and stay exactly as they are; this
// consumer is the only place that maps domain → client. §225: internal domain events are never broadcast to
// clients directly — the mapping below sends ids, and the client refetches.
//
// Idempotency (§23) is the runner's processed_events; a redelivered domain event never re-emits.
// This consumer is deliberately NOT critical: a missed screen refresh is recoverable by the next fetch; a
// missed payment is not. It also has no external dependency — the bus is in-process/Redis pub-sub.
import { type EventConsumer, type DomainEvent, DOMAIN_EVENTS } from '@aipowersalon/events';
import { EVENTS, type EventName } from '@aipowersalon/realtime-contracts';

export interface RealtimeEmitterLike {
  toTenant(ctx: { tenantId: string; branchId: string }, event: EventName, payload?: unknown): void;
  /** §113: some client events belong to ONE ticket's room (the Customer App), not the whole tenant. Optional so a
   *  bus without ticket rooms still works — the tenant projection is unaffected. */
  toTicket?(ticketId: string, event: EventName, payload?: unknown): void;
  /** §113: a technician's own room (the tech app). Optional for the same reason as toTicket. */
  toTechnician?(technicianId: string, event: EventName, payload?: unknown): void;
  /** §113: a single customer's room (the Customer App). */
  toCustomer?(customerId: string, event: EventName, payload?: unknown): void;
  toOwner?(tenantId: string, event: EventName, payload?: unknown): void;
}

/** domain event type → (client event, payload builder). Only ids cross this boundary. */
/** scope: where this client event is delivered. 'tenant' (default) = the tenant+branch room; 'ticket' = that
 *  ticket's own room, which only the guest watching that ticket is in. */
type Client = { event: EventName; payload: Record<string, unknown>; scope?: 'tenant' | 'ticket' | 'technician' | 'customer' | 'owner' | 'salon'; ticketId?: string; technicianId?: string; customerId?: string;
  /** for a PLATFORM event (no tenant on the envelope, §168): the salon it concerns, from its payload */ tenantId?: string;
  /** scope 'salon': the salon's branch rooms to reach as well (the event payload names its OWN salon's branches) */ branchIds?: string[] };
/** BUILD_PLAN Phase 8 — the Safety Community. A community event concerns a whole SALON, not one branch: a POS user is
 *  subscribed only to tenant:<t>:branch:<their branch>, so a branch-less toTenant would reach almost nobody. scope 'salon'
 *  = the owner room (Owner app) + the branch-less room (staff with no home branch) + every branch room the payload names
 *  (`branchIds`: the salon's OWN active branches, written by the producer) + the envelope's own branch. Only ids, a status /
 *  severity / category cross; the screens refetch (key "community"). */
/** The technician (only when the domain event states it — absent stays absent, so a client never guesses) and the date of
 *  an appointment change. `technicianId: null` = first available: every column may change. */
function apptScope(p: Record<string, unknown> | undefined): { technicianId?: string | null; date?: string | null } {
  const out: { technicianId?: string | null; date?: string | null } = {};
  if (p && 'technicianId' in p) out.technicianId = p.technicianId == null ? null : String(p.technicianId);
  if (p && typeof p.date === 'string') out.date = p.date;
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function communityClient(e: DomainEvent<any>, event: EventName, payload: Record<string, unknown>): Client {
  const ids = new Set<string>((Array.isArray(e.payload?.branchIds) ? e.payload.branchIds : []).map(String).filter((x: string) => UUID_RE.test(x)));
  if (e.branchId) ids.add(String(e.branchId));
  return { event, payload, scope: 'salon', branchIds: [...ids] };
}
const communityPost = (e: DomainEvent<any>): Client => communityClient(e, EVENTS.communityPostUpdated, { postId: e.payload?.postId ?? e.aggregateId, status: e.payload?.status ?? null });
const communityComment = (e: DomainEvent<any>): Client => communityClient(e, EVENTS.communityCommentAdded, { postId: e.payload?.postId ?? null, commentId: e.payload?.commentId ?? e.aggregateId });
function offerClients(e: DomainEvent<any>, reason: string): Client[] {
  return [{ event: EVENTS.queueUpdated, payload: { techQueueTicketId: e.aggregateId, reason } },
    ...(e.payload?.technicianId ? [{ event: EVENTS.queueUpdated, payload: { techQueueTicketId: e.aggregateId, reason }, scope: 'technician' as const, technicianId: String(e.payload.technicianId) }] : [])];
}
/** A payroll period transition: the owner's screens (Approvals tab, Home strip) and each technician on the period. */
function payrollClients(e: DomainEvent<any>, action: string): Client[] {
  const techs: string[] = Array.isArray(e.payload?.technicianIds) ? e.payload.technicianIds.map(String) : [];
  return [{ event: EVENTS.ownerPayrollUpdated, payload: { periodId: e.aggregateId, action }, scope: 'owner' },
    ...techs.map((technicianId) => ({ event: EVENTS.technicianEarningsUpdated, payload: { periodId: e.aggregateId, action }, scope: 'technician' as const, technicianId }))];
}
/** Weekly Paycheck (Oct 21 2026, §18): a week / statement / payout change — the owner's room, the salon's payroll screens
 *  (the POS manager), and each technician concerned in their own room. Only ids + the action cross; screens refetch (the
 *  realtime message is a refetch signal, never financial authority). */
function paycheckClients(e: DomainEvent<any>, action: string): Client[] {
  const p = e.payload ?? {};
  const periodId = p.periodId ?? (e.aggregateType === 'payroll_period' ? e.aggregateId : null);
  const techs: string[] = Array.isArray(p.technicianIds) ? p.technicianIds.map(String) : p.technicianId ? [String(p.technicianId)] : [];
  const payload = { periodId, action, statementId: p.statementId ?? null, payoutId: p.payoutId ?? null };
  // scope 'salon' = the owner room + the branch-less staff room (+ the event's branch room when the week is branch-scoped)
  return [{ event: EVENTS.ownerPayrollUpdated, payload, scope: 'salon', branchIds: e.branchId ? [String(e.branchId)] : [] },
    ...techs.map((technicianId) => ({ event: EVENTS.technicianEarningsUpdated, payload, scope: 'technician' as const, technicianId }))];
}
/** Platform Announcements (Oct 22 2026): the service writes ONE event per targeted salon (tenantId on the envelope, the
 *  salon's affected branch rooms in the payload) — so only that salon's owner room, branch-less room and those branch
 *  rooms are told; ids + version only, the POS refetches its server-targeted snapshot (§66–§70). */
function announcementClients(e: DomainEvent<any>): Client[] {
  const p = e.payload ?? {};
  return [{ event: EVENTS.platformAnnouncementUpdated, payload: { announcementId: p.announcementId ?? e.aggregateId, version: p.version ?? null, action: p.action ?? null },
    scope: 'salon', branchIds: Array.isArray(p.branchIds) ? p.branchIds.map(String) : [] }];
}
/** BUILD_PLAN Phase 7 — the scheduling optimizer. A branch-scoped schedule.* event goes to that branch's room; a salon-wide
 *  one (no branch on the envelope) to the owner's room. Only ids + status cross; the screens refetch. */
function schedClient(e: DomainEvent<any>, event: EventName, payload: Record<string, unknown>): Client {
  return e.branchId ? { event, payload } : { event, payload, scope: 'owner' };
}
const schedRec = (e: DomainEvent<any>): Client => schedClient(e, EVENTS.scheduleRecommendationUpdated, { recommendationId: e.payload?.recommendationId ?? e.aggregateId, status: e.payload?.status ?? null });
const schedProposal = (e: DomainEvent<any>): Client[] => [schedRec(e),
  schedClient(e, EVENTS.scheduleProposalUpdated, { recommendationId: e.payload?.recommendationId ?? e.aggregateId, proposalId: e.payload?.proposalId ?? null, status: e.payload?.status ?? null })];
const schedSettings = (status: string) => (e: DomainEvent<any>): Client => schedClient(e, EVENTS.scheduleSettingsChanged, { scope: e.payload?.level ?? e.payload?.scope ?? (e.branchId ? 'branch' : 'tenant'), version: e.payload?.version ?? null, status });
const schedInsight = (e: DomainEvent<any>): Client => schedClient(e, EVENTS.scheduleRecommendationUpdated, { insightId: e.payload?.insightId ?? e.aggregateId, kind: e.payload?.kind ?? null, status: e.payload?.status ?? null });
/** BUILD_PLAN Phase 9 — the salon approvals engine. An approval concerns the whole salon's deciders (the owner app, a
 *  branch-less owner / manager, and the request's own branch): scope 'salon' with the envelope's branch. Only the id, the
 *  kind and the status cross; the Approvals screens refetch (key "approvals"). */
const expenseClient = (e: DomainEvent<any>, action: string): Client => communityClient(e, EVENTS.expenseUpdated, {
  expenseId: e.aggregateType === 'expense' ? e.aggregateId : (e.payload?.expenseId ?? null), documentId: e.aggregateType === 'ocr_document' ? e.aggregateId : (e.payload?.documentId ?? null),
  action, status: e.payload?.status ?? e.payload?.pipelineState ?? null });
const approvalClient = (e: DomainEvent<any>): Client => communityClient(e, EVENTS.approvalUpdated, { approvalId: e.payload?.approvalId ?? e.aggregateId, kind: e.payload?.kind ?? null, status: e.payload?.status ?? null });
const MAP: Partial<Record<string, (e: DomainEvent<any>) => Client | Client[]>> = {
  // BUILD_PLAN Phase 9: approval.* (the engine never emits realtime itself — this projection is the only path)
  // Receipt/Expense mandate §150: one refetch signal for the Receipts & Expenses screens (POS + Owner App), salon scope
  // like approvals — an expense with no branch concerns the whole salon. Ids + status only; never amounts, vendor or text.
  [DOMAIN_EVENTS.EXPENSE_RECEIPT_UPLOADED]:        (e) => expenseClient(e, 'receipt_uploaded'),
  [DOMAIN_EVENTS.EXPENSE_RECEIPT_EXTRACTED]:       (e) => expenseClient(e, 'receipt_extracted'),
  [DOMAIN_EVENTS.EXPENSE_RECEIPT_REVIEW_REQUIRED]: (e) => expenseClient(e, 'receipt_review_required'),
  [DOMAIN_EVENTS.EXPENSE_RECEIPT_PROCESSING_FAILED]: (e) => expenseClient(e, 'receipt_processing_failed'),
  [DOMAIN_EVENTS.EXPENSE_CREATED]:                 (e) => expenseClient(e, 'created'),
  [DOMAIN_EVENTS.EXPENSE_UPDATED]:                 (e) => expenseClient(e, 'updated'),
  [DOMAIN_EVENTS.EXPENSE_APPROVED]:                (e) => expenseClient(e, 'approved'),
  [DOMAIN_EVENTS.EXPENSE_REJECTED]:                (e) => expenseClient(e, 'rejected'),
  [DOMAIN_EVENTS.EXPENSE_VOIDED]:                  (e) => expenseClient(e, 'voided'),
  [DOMAIN_EVENTS.EXPENSE_ARCHIVED]:                (e) => expenseClient(e, 'archived'),
  [DOMAIN_EVENTS.EXPENSE_DUPLICATE_DETECTED]:      (e) => expenseClient(e, 'duplicate_detected'),
  [DOMAIN_EVENTS.EXPENSE_REIMBURSEMENT_CHANGED]:   (e) => expenseClient(e, 'reimbursement_changed'),
  [DOMAIN_EVENTS.BILL_PAYMENT_RECORDED]:           (e) => expenseClient(e, 'bill_payment_recorded'),
  [DOMAIN_EVENTS.BILL_DUE_SOON]:                   (e) => expenseClient(e, 'bill_due_soon'),
  [DOMAIN_EVENTS.BILL_OVERDUE]:                    (e) => expenseClient(e, 'bill_overdue'),
  [DOMAIN_EVENTS.APPROVAL_REQUESTED]: approvalClient,
  [DOMAIN_EVENTS.APPROVAL_DECIDED]:   approvalClient,
  [DOMAIN_EVENTS.APPROVAL_EXECUTED]:  approvalClient,
  // BUILD_PLAN Phase 9 (agent A): what someone may do changed — the Roles & Permissions screens and the person's own
  // session / navigation refetch. Only the user id, the change kind and the version cross (the person's NEXT request is
  // re-authorized anyway and answers x-authorization-changed: 1).
  [DOMAIN_EVENTS.AUTHORIZATION_CHANGED]: (e) => communityClient(e, EVENTS.authorizationChanged, { userId: e.payload?.userId ?? null, change: e.payload?.change ?? null, version: e.payload?.version ?? null }),
  // BUILD_PLAN Phase 8: community.* (the Safety Community never emits realtime itself — this projection is the only path).
  // ADVISORY_* carry the ORIGIN salon; ALERT_DELIVERED one RECIPIENT salon each; COMMENT_* the post's origin salon.
  [DOMAIN_EVENTS.COMMUNITY_ADVISORY_SUBMITTED]: communityPost,
  [DOMAIN_EVENTS.COMMUNITY_ADVISORY_APPROVED]:  communityPost,
  [DOMAIN_EVENTS.COMMUNITY_ADVISORY_PUBLISHED]: communityPost,
  [DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED]:   communityPost,
  [DOMAIN_EVENTS.COMMUNITY_ADVISORY_REMOVED]:   communityPost,
  [DOMAIN_EVENTS.COMMUNITY_ADVISORY_RETURNED]:  communityPost,
  [DOMAIN_EVENTS.COMMUNITY_COMMENT_ADDED]:      communityComment,
  [DOMAIN_EVENTS.COMMUNITY_COMMENT_REMOVED]:    communityComment,
  [DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED]:    (e) => communityClient(e, EVENTS.communityAlert, { postId: e.payload?.postId ?? e.aggregateId, severity: e.payload?.severity ?? null, category: e.payload?.category ?? null }),
  [DOMAIN_EVENTS.COMMUNITY_SETTINGS_CHANGED]:   (e) => communityClient(e, EVENTS.communitySettingsChanged, { version: e.payload?.version ?? null }),
  // BUILD_PLAN Phase 7: schedule.* (the optimizer never emits realtime itself — this projection is the only path)
  [DOMAIN_EVENTS.SCHEDULE_RUN_COMPLETED]:               (e) => schedClient(e, EVENTS.scheduleRunCompleted, { runId: e.payload?.runId ?? e.aggregateId, status: e.payload?.status ?? null }),
  [DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_GENERATED]:    schedRec,
  [DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_DECIDED]:      schedRec,
  [DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_EXPIRED]:      schedRec,
  [DOMAIN_EVENTS.SCHEDULE_CUSTOMER_APPROVAL_REQUESTED]: schedProposal,
  [DOMAIN_EVENTS.SCHEDULE_CUSTOMER_DECIDED]:            schedProposal,
  [DOMAIN_EVENTS.SCHEDULE_CHANGE_APPLIED]:              schedRec,
  [DOMAIN_EVENTS.SCHEDULE_CHANGE_FAILED]:               schedRec,
  [DOMAIN_EVENTS.SCHEDULE_CHANGE_ROLLED_BACK]:          schedRec,
  [DOMAIN_EVENTS.SCHEDULE_INSIGHT_GENERATED]:           schedInsight,
  [DOMAIN_EVENTS.SCHEDULE_INSIGHT_DECIDED]:             schedInsight,
  [DOMAIN_EVENTS.SCHEDULE_SETTINGS_CHANGED]:            schedSettings('changed'),
  [DOMAIN_EVENTS.SCHEDULE_AUTOMATION_DISABLED]:         schedSettings('automation_disabled'),
  // 200-technician mandate §21/§22 (M5 pilot, Oct 24 2026): the board's technician and date ride along (ids and a date —
  // §95 scheduling facts, no customer data) so a board showing other technicians or another day can skip its grid reload
  [DOMAIN_EVENTS.APPOINTMENT_CREATED]:     (e) => ({ event: EVENTS.appointmentCreated,   payload: { appointmentId: e.aggregateId, ...apptScope(e.payload) } }),
  [DOMAIN_EVENTS.APPOINTMENT_CONFIRMED]:   (e) => ({ event: EVENTS.appointmentUpdated,   payload: { appointmentId: e.aggregateId, ...apptScope(e.payload) } }),
  // Smooth Refresh spec §3/§17: a check-in is a 0–1 s change. customer_checked_in refreshes Check-In, Queue, Tech Queue and
  // the dashboards; the appointment itself changed too, so the Booking board gets its update as well.
  [DOMAIN_EVENTS.CUSTOMER_CHECKED_IN]:     (e) => [
    { event: EVENTS.customerCheckedIn,  payload: { appointmentId: e.aggregateId, customerId: (e.payload as any)?.customerId ?? null } },
    { event: EVENTS.appointmentUpdated, payload: { appointmentId: e.aggregateId } },
  ],
  [DOMAIN_EVENTS.APPOINTMENT_COMPLETED]:   (e) => ({ event: EVENTS.appointmentUpdated,   payload: { appointmentId: e.aggregateId, ...apptScope(e.payload) } }),
  [DOMAIN_EVENTS.APPOINTMENT_NO_SHOW]:     (e) => ({ event: EVENTS.appointmentUpdated,   payload: { appointmentId: e.aggregateId, ...apptScope(e.payload) } }),
  // B-14 (Oct 20 2026): the Booking board's "Start service" is appointment.updated { status: 'in_service' } — the queue item
  // and tech ticket moved with it, so the Serving and Queue boards refetch too (what the direct push used to send).
  [DOMAIN_EVENTS.APPOINTMENT_UPDATED]:     (e) => (e.payload?.status === 'in_service'
    ? [{ event: EVENTS.appointmentUpdated, payload: { appointmentId: e.aggregateId, status: 'in_service' } },
       { event: EVENTS.serviceStarted,     payload: { appointmentId: e.aggregateId } },
       { event: EVENTS.queueUpdated,       payload: { appointmentId: e.aggregateId } }]
    : { event: EVENTS.appointmentUpdated,   payload: { appointmentId: e.aggregateId, ...apptScope(e.payload), date: e.payload?.date ?? null } }),
  [DOMAIN_EVENTS.APPOINTMENT_CANCELED]:    (e) => ({ event: EVENTS.appointmentCancelled, payload: { appointmentId: e.aggregateId, ...apptScope(e.payload) } }),
  // a move names BOTH technicians (the old column loses it, the new one gains it) and no single date (it may leave this day)
  [DOMAIN_EVENTS.APPOINTMENT_RESCHEDULED]: (e) => ({ event: EVENTS.appointmentUpdated,   payload: { appointmentId: e.aggregateId, toDate: e.payload?.toDate ?? null,
    ...('fromTechnicianId' in (e.payload ?? {}) && 'toTechnicianId' in (e.payload ?? {}) ? { technicianIds: [e.payload?.fromTechnicianId ?? null, e.payload?.toTechnicianId ?? null] } : {}) } }),
  [DOMAIN_EVENTS.QUEUE_CUSTOMER_ASSIGNED]: (e) => ({ event: EVENTS.queueUpdated,         payload: { queueItemId: e.aggregateId } }),
  [DOMAIN_EVENTS.QUEUE_CUSTOMER_CALLED]:   (e) => ({ event: EVENTS.queueUpdated,         payload: { queueItemId: e.aggregateId } }),
  [DOMAIN_EVENTS.QUEUE_CUSTOMER_JOINED]:   (e) => ({ event: EVENTS.queueUpdated,         payload: { queueItemId: e.aggregateId } }),
  [DOMAIN_EVENTS.QUEUE_CUSTOMER_REMOVED]:  (e) => ({ event: EVENTS.queueUpdated,         payload: { queueItemId: e.aggregateId } }),
  [DOMAIN_EVENTS.QUEUE_ITEM_UPDATED]:      (e) => ({ event: EVENTS.queueUpdated,         payload: { queueItemId: e.aggregateId, reason: e.payload?.reason ?? null } }),
  // multi-technician routing: no new realtime name — the boards refetch the guest (and its lines) on queue_updated
  [DOMAIN_EVENTS.QUEUE_SERVICE_LINES_ASSIGNED]: (e) => ({ event: EVENTS.queueUpdated, payload: { queueItemId: e.aggregateId, reason: 'service_lines' } }),
  // BUILD_PLAN Phase 6: the queue domain writes these in the transaction; the boards hear them here (and refetch)
  [DOMAIN_EVENTS.QUEUE_ASSIGNMENT_LOCKED]:   (e) => [{ event: EVENTS.queueAssignmentLocked, payload: { queueItemId: e.aggregateId, technicianId: e.payload?.technicianId ?? null } }, { event: EVENTS.queueUpdated, payload: { queueItemId: e.aggregateId, reason: 'locked' } }],
  [DOMAIN_EVENTS.QUEUE_ASSIGNMENT_UNLOCKED]: (e) => [{ event: EVENTS.queueAssignmentUnlocked, payload: { queueItemId: e.aggregateId } }, { event: EVENTS.queueUpdated, payload: { queueItemId: e.aggregateId, reason: 'unlocked' } }],
  [DOMAIN_EVENTS.QUEUE_REORDERED]:           (e) => ({ event: EVENTS.queueReordered, payload: { branchId: e.branchId ?? null } }),
  [DOMAIN_EVENTS.QUEUE_GROUP_CREATED]:       (e) => ({ event: EVENTS.queueGroupCreated, payload: { groupId: e.aggregateId } }),
  // Queue assignment (B-14 remainder, Oct 20 2026): every fact the AI layer used to push itself is delivered from here —
  // the same client names and id-only payloads, the branch's room. A SALON-WIDE change (no branch: the tenant kill switch,
  // salon-level settings) goes to the owner's room, as before; the AI layer's emitter is the publisher-off fallback only.
  [DOMAIN_EVENTS.QUEUE_ASSIGNMENT_SETTINGS_CHANGED]: (e) => (e.branchId
    ? [{ event: EVENTS.queueAssignmentSettingsChanged, payload: { scope: 'branch', version: e.payload?.version ?? null, change: e.payload?.change ?? null } }]
    : [{ event: EVENTS.queueAssignmentSettingsChanged, payload: { scope: 'salon', version: e.payload?.version ?? null, change: e.payload?.change ?? null }, scope: 'owner' as const }]),
  [DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNMENT_DISABLED]:   (e) => (e.branchId
    ? [{ event: EVENTS.queueAutoAssignmentKilled, payload: { scope: 'branch', reason: e.payload?.reason ?? null } }]
    : [{ event: EVENTS.queueAutoAssignmentKilled, payload: { scope: 'salon', killed: true }, scope: 'owner' as const }]),
  [DOMAIN_EVENTS.QUEUE_ASSIGNMENT_RECOMMENDED]: (e) => ({ event: EVENTS.queueAssignmentRecommended, payload: { queueEntryId: e.payload?.queueEntryId ?? null, recommendationId: e.payload?.recommendationId ?? e.aggregateId,
    recommended: e.payload?.recommended ?? null, requiredAction: e.payload?.requiredAction ?? null, confidence: e.payload?.confidence ?? null } }),
  [DOMAIN_EVENTS.QUEUE_ASSIGNMENT_DECIDED]: (e) => ({ event: EVENTS.queueAssignmentDecided, payload: { queueEntryId: e.payload?.queueItemId ?? e.aggregateId, recommendationId: e.payload?.recommendationId ?? null,
    decisionId: e.payload?.decisionId ?? null, decision: e.payload?.decision ?? null, technicianId: e.payload?.technicianId ?? null, applied: !!e.payload?.applied } }),
  [DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNED]: (e) => ({ event: EVENTS.queueAutoAssigned, payload: { queueEntryId: e.payload?.queueItemId ?? e.aggregateId, technicianId: e.payload?.technicianId ?? null,
    recommendationId: e.payload?.recommendationId ?? null, ...(Array.isArray(e.payload?.plan) ? { mode: 'split' } : {}) } }),
  [DOMAIN_EVENTS.QUEUE_ALERT_RAISED]: (e) => ({ event: EVENTS.queueAlertRaised, payload: { alertId: e.payload?.alertId ?? e.aggregateId, type: e.payload?.type ?? null, severity: e.payload?.severity ?? null,
    queueEntryId: e.payload?.queueEntryId ?? null, ...(e.payload?.escalated ? { escalated: true } : {}) } }),
  [DOMAIN_EVENTS.QUEUE_ALERT_ACKNOWLEDGED]: (e) => ({ event: EVENTS.queueAlertAcknowledged, payload: { alertId: e.payload?.alertId ?? e.aggregateId, type: e.payload?.type ?? null } }),
  [DOMAIN_EVENTS.QUEUE_ALERT_RESOLVED]: (e) => ({ event: EVENTS.queueAlertResolved, payload: { alertId: e.payload?.alertId ?? e.aggregateId, type: e.payload?.type ?? null, queueEntryId: e.payload?.queueEntryId ?? null,
    autoResolved: !!e.payload?.autoResolved, resolution: e.payload?.resolution ?? null } }),
  [DOMAIN_EVENTS.QUEUE_RECORD_REPAIRED]: (e) => ({ event: EVENTS.queueRecordRepaired, payload: { alertId: e.payload?.alertId ?? null, queueEntryId: e.payload?.queueEntryId ?? null, action: e.payload?.action ?? null } }),
  [DOMAIN_EVENTS.PAYMENT_CAPTURED]:        (e) => {
    const p = e.payload ?? {};
    const out: Client[] = [{ event: EVENTS.paymentApproved, payload: { ticketId: p.ticketId ?? null, paymentId: e.aggregateId, method: p.method ?? null, surface: p.paymentSurface ?? null } }];   // surface: Tap to Pay mandate §221 (an analytics dimension, same one sale)
    // skip-line (the customer paid from their phone, or cash handed to the technician): the front desk and the customer's
    // own app see the skip-line events the service used to push directly (72b15c4 made these payments record the fact)
    if (p.channel === 'skip_line') {
      const ev = p.method === 'cash' ? EVENTS.cashConfirmedByTech : EVENTS.customerPaymentSucceeded;
      out.push({ event: ev, payload: { ticketId: p.ticketId ?? null, paymentId: e.aggregateId, amountCents: p.amountCents ?? null } });
      if (p.customerId) out.push({ event: ev, payload: { ticketId: p.ticketId ?? null, paymentId: e.aggregateId, amountCents: p.amountCents ?? null }, scope: 'customer', customerId: String(p.customerId) });
    }
    return out;
  },
  // §31 fan-out: one domain fact, two client refreshes — the ticket screen and the reports screen
  [DOMAIN_EVENTS.CHECKOUT_COMPLETED]:      (e) => [{ event: EVENTS.ticketPaid, payload: { ticketId: e.aggregateId } }, { event: EVENTS.reportsUpdated, payload: {} },
    ...(e.payload?.channel === 'skip_line' ? [{ event: EVENTS.ticketClosed, payload: { ticketId: e.aggregateId } }] : [])],
  [DOMAIN_EVENTS.PAYMENT_FAILED]:          (e) => [{ event: EVENTS.paymentFailed, payload: { ticketId: e.payload?.ticketId ?? null } },
    // skip-line: the customer's own app hears the decline, with the processor's reason text (no card data)
    ...(e.payload?.channel === 'skip_line' && e.payload?.customerId ? [{ event: EVENTS.customerPaymentFailed, payload: { ticketId: e.payload?.ticketId ?? null, reason: e.payload?.reason ?? null }, scope: 'customer' as const, customerId: String(e.payload.customerId) }] : [])],
  [DOMAIN_EVENTS.SERVICE_STARTED]:         (e) => [{ event: EVENTS.serviceStarted, payload: { ticketId: e.aggregateId } },
    ...(e.payload?.technicianId ? [{ event: EVENTS.serviceStarted, payload: { ticketId: e.aggregateId }, scope: 'technician' as const, technicianId: String(e.payload.technicianId) }] : [])],
  [DOMAIN_EVENTS.TICKET_READY_FOR_CHECKOUT]: (e) => ({ event: EVENTS.ticketReadyCheckout, payload: { ticketId: e.aggregateId } }),
  [DOMAIN_EVENTS.SERVICE_COMPLETED]:       (e) => ({ event: EVENTS.serviceDone,           payload: { ticketId: e.aggregateId } }),

  // Constitution 10 §164. ONLY these two of the AI lifecycle reach a client. ai.job_requested and
  // ai.job_started are internal bookkeeping — a screen has nothing to do with them, and §225 says internal
  // domain events are not broadcast just because they exist.
  //
  // ids only, and deliberately no output, no prompt, no confidence: §164 keeps the final AI result
  // server-side, so the client learns that its job moved and fetches the result through the guarded route.
  // A FAILED job is a completion from the screen's point of view — a spinner that never resolves because the
  // job failed is the worst of the three outcomes, so the status rides along and the client stops waiting.
  [DOMAIN_EVENTS.AI_JOB_COMPLETED]: (e) => ({ event: EVENTS.aiJobCompleted, payload: { requestId: e.payload?.requestId ?? e.aggregateId, taskKey: e.payload?.taskKey ?? null, status: e.payload?.status ?? null } }),
  [DOMAIN_EVENTS.AI_JOB_FAILED]:    (e) => ({ event: EVENTS.aiJobCompleted, payload: { requestId: e.payload?.requestId ?? e.aggregateId, taskKey: e.payload?.taskKey ?? null, status: 'FAILED' } }),
  [DOMAIN_EVENTS.AI_JOB_STARTED]:   (e) => ({ event: EVENTS.aiJobProgress,  payload: { requestId: e.payload?.requestId ?? e.aggregateId, taskKey: e.payload?.taskKey ?? null, phase: 'started' } }),
  // merge Oct 12 2026: time off changes the technician's availability → the live board / booking / tech schedule refetch
  // (key "technicians"), in the branch room and the technician's own room. Ids + status only.
  [DOMAIN_EVENTS.TECHNICIAN_TIME_OFF_CHANGED]: (e) => {
    const technicianId = String(e.payload?.technicianId ?? ''); const payload = { technicianId, timeOffId: e.aggregateId, status: e.payload?.status ?? null };
    return [{ event: EVENTS.technicianScheduleUpdated, payload }, ...(technicianId ? [{ event: EVENTS.technicianScheduleUpdated, payload, scope: 'technician' as const, technicianId }] : [])];
  },
  // F4 (Oct 30 2026): a one-date shift override changed — the same technician_schedule_updated the weekly schedule and
  // time off send, to the branch room (Staff Schedule, Booking, Tech Queue) and the technician's own room (Technician App).
  [DOMAIN_EVENTS.TECHNICIAN_SHIFT_OVERRIDE_CHANGED]: (e) => {
    const technicianId = String(e.payload?.technicianId ?? ''); const payload = { technicianId, date: e.payload?.date ?? null, overrideType: e.payload?.overrideType ?? null, version: e.payload?.version ?? null };
    return [{ event: EVENTS.technicianScheduleUpdated, payload }, ...(technicianId ? [{ event: EVENTS.technicianScheduleUpdated, payload, scope: 'technician' as const, technicianId }] : [])];
  },
  [DOMAIN_EVENTS.TECHNICIAN_PROFILE_UPDATED]:     (e) => ({ event: EVENTS.techProfileUpdated,     payload: { technicianId: e.aggregateId, profileId: e.payload?.profileId ?? null } }),
  [DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_REJECTED]: (e) => ({ event: EVENTS.techMembershipRejected, payload: { requestId: e.aggregateId, profileId: e.payload?.profileId ?? null } }),
  // B-14 (Oct 20 2026): facts that concern a whole SALON (the one asked to approve) — every room of that salon, like the
  // Safety Community. tech-profile.service used to push these to each branch room by hand.
  [DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_REQUESTED]: (e) => communityClient(e, EVENTS.techMembershipRequested, { profileId: e.payload?.profileId ?? null, requestId: e.aggregateId, transfer: !!e.payload?.transfer }),
  [DOMAIN_EVENTS.TECHNICIAN_PROFILE_CHANGE_HELD]:  (e) => communityClient(e, EVENTS.techProfileUpdated, { profileId: e.payload?.profileId ?? null, requestId: e.aggregateId, held: true }),
  // §31 fan-out, mirroring what serving.emitLineEvents did by hand: the line event AND the recalculated total
  [DOMAIN_EVENTS.TICKET_SERVICE_LINE_ADDED]: (e) => [{ event: EVENTS.ticketServiceLineAdded, payload: { ticketId: e.aggregateId } },
    { event: EVENTS.ticketTotalRecalculated, payload: { ticketId: e.aggregateId } },
    { event: EVENTS.ticketServiceLineAdded, payload: { ticketId: e.aggregateId }, scope: 'ticket', ticketId: e.aggregateId }],
  [DOMAIN_EVENTS.TICKET_SERVICE_LINE_UPDATED]: (e) => [{ event: EVENTS.ticketServiceLineUpdated, payload: { ticketId: e.aggregateId } },
    { event: EVENTS.ticketTotalRecalculated, payload: { ticketId: e.aggregateId } },
    { event: EVENTS.ticketServiceLineUpdated, payload: { ticketId: e.aggregateId }, scope: 'ticket', ticketId: e.aggregateId }],
  [DOMAIN_EVENTS.TICKET_SERVICE_LINE_REMOVED]: (e) => [{ event: EVENTS.ticketServiceLineRemoved, payload: { ticketId: e.aggregateId } },
    { event: EVENTS.ticketTotalRecalculated, payload: { ticketId: e.aggregateId } },
    { event: EVENTS.ticketServiceLineRemoved, payload: { ticketId: e.aggregateId }, scope: 'ticket', ticketId: e.aggregateId }],
  [DOMAIN_EVENTS.TICKET_CHANGE_REQUEST_CREATED]:  (e) => ({ event: EVENTS.ticketChangeRequestCreated,  payload: { requestId: e.aggregateId, ticketId: e.payload?.ticketId ?? null } }),
  [DOMAIN_EVENTS.TICKET_CHANGE_REQUEST_APPROVED]: (e) => ({ event: EVENTS.ticketChangeRequestApproved, payload: { requestId: e.aggregateId, ticketId: e.payload?.ticketId ?? null } }),
  [DOMAIN_EVENTS.TICKET_CHANGE_REQUEST_REJECTED]: (e) => ({ event: EVENTS.ticketChangeRequestRejected, payload: { requestId: e.aggregateId, ticketId: e.payload?.ticketId ?? null } }),
  // §80: a task change refreshes the branch board AND the owning technician's app — what emitTask did by hand
  // Constitution 13 §343 — the register cash drawer (the same client events the service used to push directly)
  [DOMAIN_EVENTS.CASH_DRAWER_OPENED]:            (e) => ({ event: EVENTS.cashDrawerOpened,   payload: { branchId: e.payload?.branchId ?? null, businessDate: e.payload?.businessDate ?? null, openingFloatCents: e.payload?.openingFloatCents ?? null } }),
  [DOMAIN_EVENTS.CASH_DRAWER_MOVEMENT_RECORDED]: (e) => ({ event: EVENTS.cashDrawerMovement, payload: { branchId: e.payload?.branchId ?? null, businessDate: e.payload?.businessDate ?? null, direction: e.payload?.direction ?? null, amountCents: e.payload?.amountCents ?? null } }),
  [DOMAIN_EVENTS.CASH_DRAWER_MOVEMENT_VOIDED]:   (e) => ({ event: EVENTS.cashDrawerMovement, payload: { branchId: e.payload?.branchId ?? null, businessDate: e.payload?.businessDate ?? null, voidedMovementId: e.payload?.voidedMovementId ?? null } }),
  [DOMAIN_EVENTS.CASH_DRAWER_RECONCILED]:        (e) => ({ event: e.payload?.status === 'discrepancy' ? EVENTS.cashDrawerDiscrepancy : EVENTS.cashDrawerReconciled,
                                                            payload: { branchId: e.payload?.branchId ?? null, businessDate: e.payload?.businessDate ?? null, expectedCashCents: e.payload?.expectedCashCents ?? null, countedCents: e.payload?.countedCents ?? null, varianceCents: e.payload?.varianceCents ?? null } }),
  // Constitution 13 §343 — a technician's cash hand-off (the same client events the service used to push directly)
  [DOMAIN_EVENTS.CASH_HANDOFF_SUBMITTED]:        (e) => ({ event: EVENTS.cashHandoffSubmitted, payload: { technicianId: e.payload?.technicianId ?? null, businessDate: e.payload?.businessDate ?? null, expectedCents: e.payload?.expectedCents ?? null, paymentCount: e.payload?.paymentCount ?? null } }),
  [DOMAIN_EVENTS.CASH_HANDOFF_RECONCILED]:       (e) => {
    const p = e.payload ?? {};
    const out: Client[] = [{ event: p.status === 'discrepancy' ? EVENTS.cashHandoffDiscrepancy : EVENTS.cashHandoffReconciled,
      payload: { technicianId: p.technicianId ?? null, businessDate: p.businessDate ?? null, expectedCents: p.expectedCents ?? null, countedCents: p.countedCents ?? null, varianceCents: p.varianceCents ?? null } }];
    // the technician's own app hears it too — always as 'reconciled', with the status inside (as the service pushed it)
    if (p.technicianId) out.push({ event: EVENTS.cashHandoffReconciled, payload: { businessDate: p.businessDate ?? null, countedCents: p.countedCents ?? null, varianceCents: p.varianceCents ?? null, status: p.status ?? null }, scope: 'technician', technicianId: p.technicianId });
    return out;
  },
  // Super Admin changed a salon's status — every open POS / Owner App of THAT salon refetches (the authz revalidation
  // already ends their streams when it is no longer active; this reaches the ones still allowed in, e.g. a reactivation)
  [DOMAIN_EVENTS.TENANT_SUSPENDED]:              (e) => (e.payload?.tenantId ? { event: EVENTS.tenantStatusUpdated, payload: { status: e.payload?.status ?? 'suspended' }, tenantId: String(e.payload.tenantId) } : []),
  [DOMAIN_EVENTS.TENANT_ACTIVATED]:              (e) => (e.payload?.tenantId ? { event: EVENTS.tenantStatusUpdated, payload: { status: e.payload?.status ?? 'active' }, tenantId: String(e.payload.tenantId) } : []),
  // a technician clocked in / out (manager path or kiosk PIN) — the Staff-on-Duty and Live Operations boards refetch
  [DOMAIN_EVENTS.TECHNICIAN_CLOCKED_IN]:         (e) => ({ event: EVENTS.timeClockUpdated, payload: { technicianId: e.payload?.technicianId ?? null, state: 'clocked_in' } }),
  [DOMAIN_EVENTS.TECHNICIAN_CLOCKED_OUT]:        (e) => ({ event: EVENTS.timeClockUpdated, payload: { technicianId: e.payload?.technicianId ?? null, state: 'clocked_out' } }),
  // merge Oct 12 2026 (WF): the ONE workforce state moved (579 CAS — clock, break, queue, service). The boards and the
  // technician's own app refetch: technician_status_updated with the derived facts (no PII), and technician_clock_updated
  // so the time-clock views also see a break start / end. Branch room + the technician's room.
  [DOMAIN_EVENTS.TECHNICIAN_STATUS_CHANGED]: (e) => {
    const p = e.payload ?? {}; const technicianId = String(p.technicianId ?? e.aggregateId ?? '');
    const status = { technicianId, branchId: p.branchId ?? null, employment: p.employment ?? null, clock: p.clock ?? null, shift: p.shift ?? null, queue: p.queue ?? null, service: p.service ?? null, version: p.version ?? null };
    const clock = { technicianId, state: p.clock === 'ON_BREAK' ? 'on_break' : p.clock === 'CLOCKED_IN' ? 'clocked_in' : 'clocked_out', shiftId: null };
    return [{ event: EVENTS.technicianStatusUpdated, payload: status }, { event: EVENTS.technicianClockUpdated, payload: clock },
      ...(technicianId ? [{ event: EVENTS.technicianStatusUpdated, payload: status, scope: 'technician' as const, technicianId }] : [])];
  },
  // Fair Turn Engine (wave 2): the branch's technician turn queue moved — the boards refetch (branch room) and every
  // technician it touched refetches her own position (her room). Ids + event types only — never turn money (§95, §98).
  [DOMAIN_EVENTS.TECHNICIAN_TURN_QUEUE_CHANGED]: (e) => {
    const p = e.payload ?? {}; const techs: { technicianId: string; eventType: string }[] = Array.isArray(p.technicians) ? p.technicians : [];
    const payload = { branchId: p.branchId ?? null, businessDate: p.businessDate ?? null, kind: p.kind ?? null, technicianIds: techs.map((t) => t.technicianId) };
    return [{ event: EVENTS.turnQueueUpdated, payload },
      ...techs.filter((t) => t.technicianId).map((t) => ({ event: EVENTS.turnQueueUpdated, payload: { ...payload, eventType: t.eventType }, scope: 'technician' as const, technicianId: String(t.technicianId) }))];
  },
  // a service paused / resumed — from the POS Serving screen OR the tech app; both boards and the technician's own app refetch
  [DOMAIN_EVENTS.SERVICE_PAUSED]:                (e) => [{ event: EVENTS.servicePaused, payload: { ticketId: e.aggregateId } },
    ...(e.payload?.technicianId ? [{ event: EVENTS.servicePaused, payload: { ticketId: e.aggregateId }, scope: 'technician' as const, technicianId: String(e.payload.technicianId) }] : [])],
  [DOMAIN_EVENTS.SERVICE_RESUMED]:               (e) => [{ event: EVENTS.serviceResumed, payload: { ticketId: e.aggregateId } },
    ...(e.payload?.technicianId ? [{ event: EVENTS.serviceResumed, payload: { ticketId: e.aggregateId }, scope: 'technician' as const, technicianId: String(e.payload.technicianId) }] : [])],
  // a queue item was offered to a technician — their own app refetches its queue (queue_updated is what it listens for)
  [DOMAIN_EVENTS.TECHNICIAN_ASSIGNED]:           (e) => (e.payload?.technicianId ? [{ event: EVENTS.queueUpdated, payload: { techQueueTicketId: e.aggregateId, reason: 'assigned' }, scope: 'technician' as const, technicianId: String(e.payload.technicianId) }] : []),
  // loyalty points earned (the loyalty consumer for any captured payment, or skip-line's inline award): the front desk and the
  // customer's own app see loyalty_points_added — which, before this, only skip-line payments ever pushed
  [DOMAIN_EVENTS.LOYALTY_POINTS_EARNED]:         (e) => [{ event: EVENTS.loyaltyPointsAdded, payload: { ticketId: e.payload?.ticketId ?? null, customerId: e.payload?.customerId ?? null, points: e.payload?.points ?? null } },
    ...(e.payload?.customerId ? [{ event: EVENTS.loyaltyPointsAdded, payload: { points: e.payload?.points ?? null }, scope: 'customer' as const, customerId: String(e.payload.customerId) }] : [])],
  // skip-line cash to the technician: the front desk sees "selected" + "pending"; the technician's own app is asked to confirm
  [DOMAIN_EVENTS.CASH_TO_TECH_REQUESTED]:        (e) => { const p = e.payload ?? {}; return [
    { event: EVENTS.cashToTechnicianSelected, payload: { ticketId: p.ticketId ?? null, amountCents: p.amountCents ?? null } },
    { event: EVENTS.cashPendingTechConfirmation, payload: { ticketId: p.ticketId ?? null, technicianId: p.technicianId ?? null, amountCents: p.amountCents ?? null } },
    ...(p.technicianId ? [{ event: EVENTS.cashPendingTechConfirmation, payload: { ticketId: p.ticketId ?? null, confirmationId: e.aggregateId, amountCents: p.amountCents ?? null }, scope: 'technician' as const, technicianId: String(p.technicianId) }] : []),
  ]; },
  [DOMAIN_EVENTS.CASH_TO_TECH_NOT_PAID]:         (e) => ({ event: EVENTS.cashIssueNeedsFrontDesk, payload: { ticketId: e.payload?.ticketId ?? null } }),
  // technician help — the same audiences the service pushed to: the asked helper / the asking primary in their own rooms, the desk
  [DOMAIN_EVENTS.TECH_HELP_REQUESTED]:           (e) => { const p = e.payload ?? {}; return [
    ...(p.helperTechnicianId ? [{ event: EVENTS.technicianHelpRequested, payload: { requestId: e.aggregateId, ticketId: p.ticketId ?? null, serviceId: p.serviceId ?? null, from: p.primaryTechnicianId ?? null }, scope: 'technician' as const, technicianId: String(p.helperTechnicianId) }] : []),
    { event: EVENTS.technicianHelpRequested, payload: { requestId: e.aggregateId, ticketId: p.ticketId ?? null } },
  ]; },
  [DOMAIN_EVENTS.TECH_HELP_ACCEPTED]:            (e) => { const p = e.payload ?? {}; return [
    { event: EVENTS.technicianHelpAccepted, payload: { requestId: e.aggregateId, ticketId: p.ticketId ?? null, helper: p.helperTechnicianId ?? null } },
    { event: EVENTS.ticketLineTechnicianAssigned, payload: { ticketId: p.ticketId ?? null, serviceLineId: p.serviceLineId ?? null, technicianId: p.helperTechnicianId ?? null } },
    ...(p.primaryTechnicianId ? [{ event: EVENTS.technicianHelpAccepted, payload: { requestId: e.aggregateId, ticketId: p.ticketId ?? null, helper: p.helperTechnicianId ?? null }, scope: 'technician' as const, technicianId: String(p.primaryTechnicianId) }] : []),
  ]; },
  [DOMAIN_EVENTS.TECH_HELP_DECLINED]:            (e) => { const p = e.payload ?? {}; return [
    ...(p.primaryTechnicianId ? [{ event: EVENTS.technicianHelpDeclined, payload: { requestId: e.aggregateId, ticketId: p.ticketId ?? null, helper: p.helperTechnicianId ?? null }, scope: 'technician' as const, technicianId: String(p.primaryTechnicianId) }] : []),
    { event: EVENTS.technicianHelpDeclined, payload: { requestId: e.aggregateId, ticketId: p.ticketId ?? null } },
  ]; },
  // an unanswered offer expired: the desk's boards and the technician's own queue refetch (what the sweep used to push)
  [DOMAIN_EVENTS.TECH_OFFER_EXPIRED]:            (e) => [{ event: EVENTS.queueUpdated, payload: { reason: 'offer_expired', techQueueTicketId: e.aggregateId } },
    ...(e.payload?.technicianId ? [{ event: EVENTS.queueUpdated, payload: { reason: 'offer_expired', techQueueTicketId: e.aggregateId }, scope: 'technician' as const, technicianId: String(e.payload.technicianId) }] : [])],
  // owner alerts and payroll periods — the owner app's room, and (payroll) every technician on the period in their own room
  [DOMAIN_EVENTS.OWNER_ALERT_STATUS_CHANGED]:    (e) => ({ event: EVENTS.ownerAlertUpdated, payload: { alertId: e.aggregateId, status: e.payload?.status ?? null }, scope: 'owner' }),
  [DOMAIN_EVENTS.PAYROLL_PERIOD_FINALIZED]:      (e) => payrollClients(e, 'payroll_approved'),
  [DOMAIN_EVENTS.PAYROLL_PERIOD_PAID]:           (e) => payrollClients(e, 'payroll_locked'),
  [DOMAIN_EVENTS.PAYROLL_PERIOD_REOPENED]:       (e) => payrollClients(e, 'payroll_reopened'),
  // wave 2 (§116 realtime is a refetch signal, never financial authority): prepared for review / a payout recorded
  [DOMAIN_EVENTS.PAYROLL_PERIOD_PREPARED]:       (e) => payrollClients(e, 'payroll_prepared'),
  [DOMAIN_EVENTS.PAYROLL_PAYOUT_RECORDED]:       (e) => payrollClients(e, 'payroll_payout_recorded'),
  // Weekly Paycheck (Oct 21 2026): the week opened / calculated / submitted / returned / rejected; statements; payouts
  [DOMAIN_EVENTS.PAYROLL_PERIOD_OPENED]:         (e) => paycheckClients(e, 'payroll_week_opened'),
  [DOMAIN_EVENTS.PAYROLL_CALCULATED]:            (e) => paycheckClients(e, 'payroll_calculated'),
  [DOMAIN_EVENTS.PAYROLL_SUBMITTED_TO_OWNER]:    (e) => paycheckClients(e, 'payroll_submitted'),
  [DOMAIN_EVENTS.PAYROLL_RETURNED]:              (e) => paycheckClients(e, 'payroll_returned'),
  [DOMAIN_EVENTS.PAYROLL_REJECTED]:              (e) => paycheckClients(e, 'payroll_rejected'),
  [DOMAIN_EVENTS.PAYROLL_PARTIALLY_PAID]:        (e) => paycheckClients(e, 'payroll_partially_paid'),
  [DOMAIN_EVENTS.PAY_STATEMENT_CREATED]:         (e) => paycheckClients(e, 'statement_created'),
  [DOMAIN_EVENTS.PAYOUT_PLANNED]:                (e) => paycheckClients(e, 'statement_approved'),
  [DOMAIN_EVENTS.PAYOUT_CHECK_ISSUED]:           (e) => paycheckClients(e, 'check_issued'),
  [DOMAIN_EVENTS.PAYOUT_CHECK_DELIVERED]:        (e) => paycheckClients(e, 'check_delivered'),
  [DOMAIN_EVENTS.PAYOUT_CHECK_VOIDED]:           (e) => paycheckClients(e, 'check_voided'),
  [DOMAIN_EVENTS.PAYOUT_CASH_READY]:             (e) => paycheckClients(e, 'cash_ready'),
  [DOMAIN_EVENTS.PAYOUT_CASH_HANDED_OFF]:        (e) => paycheckClients(e, 'cash_handed_off'),
  [DOMAIN_EVENTS.PAYOUT_CASH_ACKNOWLEDGED]:      (e) => paycheckClients(e, 'cash_acknowledged'),
  [DOMAIN_EVENTS.PAYOUT_CASH_DISPUTED]:          (e) => paycheckClients(e, 'cash_disputed'),
  [DOMAIN_EVENTS.PAYOUT_CANCELED]:               (e) => paycheckClients(e, 'payout_canceled'),
  // Weekly Paycheck close-out (Oct 27 2026): the calculated period is with the manager; a draft period was canceled
  [DOMAIN_EVENTS.PAYROLL_MANAGER_REVIEW_STARTED]: (e) => paycheckClients(e, 'payroll_manager_review_started'),
  [DOMAIN_EVENTS.PAYROLL_PERIOD_CANCELED]:       (e) => paycheckClients(e, 'payroll_period_canceled'),
  // Platform Announcements on the POS top bar (Oct 22 2026)
  [DOMAIN_EVENTS.PLATFORM_ANNOUNCEMENT_PUBLISHED]: (e) => announcementClients(e),
  [DOMAIN_EVENTS.PLATFORM_ANNOUNCEMENT_CHANGED]:   (e) => announcementClients(e),
  // a technician accepted / declined an offer: the boards and the technician's own app refetch (what the tech app pushed)
  [DOMAIN_EVENTS.TECH_OFFER_ACCEPTED]:           (e) => offerClients(e, 'accepted'),
  [DOMAIN_EVENTS.TECH_OFFER_DECLINED]:           (e) => offerClients(e, 'declined'),
  [DOMAIN_EVENTS.FOLLOWUP_TASK_SENT]:           (e) => taskFanOut(e),
  [DOMAIN_EVENTS.FOLLOWUP_TASK_STATUS_CHANGED]: (e) => taskFanOut(e),
  [DOMAIN_EVENTS.FOLLOWUP_CUSTOMER_REPLIED]:    (e) => [...taskFanOut(e),
    // customer_follow_up_received refetches the customer-app screen 'customer-follow-ups' (realtime-core's
    // screensToRefetch), so it goes to THAT CUSTOMER's room — not the tenant room.
    ...(e.payload?.customerId ? [{ event: EVENTS.customerFollowUpReceived, payload: { taskId: e.aggregateId }, scope: 'customer' as const, customerId: e.payload.customerId as string }] : [])],
  [DOMAIN_EVENTS.FOLLOWUP_TASKS_GENERATED]:     (e) => ([{ event: EVENTS.dailyFollowUpsCreated, payload: { count: e.payload?.count ?? null } },
    ...((e.payload?.technicianIds as string[] | undefined) ?? []).map((id) => ({ event: EVENTS.dailyFollowUpsCreated, payload: {}, scope: 'technician' as const, technicianId: id }))]),
  [DOMAIN_EVENTS.REVIEW_SUBMITTED]:        (e) => ({ event: EVENTS.techRatingSubmitted, payload: { ticketId: e.aggregateId, technicianId: e.payload?.technicianId ?? null, rating: e.payload?.rating ?? null } }),
  [DOMAIN_EVENTS.TECHNICIAN_MEMBERSHIP_APPROVED]: (e) => ({ event: EVENTS.techMembershipApproved, payload: { requestId: e.aggregateId, technicianId: e.payload?.technicianId ?? null, profileId: e.payload?.profileId ?? null } }),
  [DOMAIN_EVENTS.CUSTOMER_CREATED]:        (e) => ({ event: EVENTS.customerProfileUpdated, payload: { customerId: e.aggregateId } }),
  [DOMAIN_EVENTS.CUSTOMER_UPDATED]:        (e) => ({ event: EVENTS.customerProfileUpdated, payload: { customerId: e.aggregateId } }),
  // Phase 3: a phone change moved the customer's number, or its records failed to follow — every open profile and the
  // customer list refetch (the POS shows the sync status).
  [DOMAIN_EVENTS.CUSTOMER_PHONE_ACTIVATED]:      (e) => ({ event: EVENTS.customerProfileUpdated, payload: { customerId: e.aggregateId } }),
  [DOMAIN_EVENTS.CUSTOMER_PHONE_SYNC_FAILED]:    (e) => ({ event: EVENTS.customerProfileUpdated, payload: { customerId: e.aggregateId } }),
  [DOMAIN_EVENTS.CUSTOMER_PHONE_SYNC_COMPLETED]: (e) => ({ event: EVENTS.customerProfileUpdated, payload: { customerId: e.aggregateId } }),
};

/** A follow-up task change goes to the branch board and to the technician who owns the task. */
function taskFanOut(e: DomainEvent<any>): Client[] {
  const out: Client[] = [{ event: EVENTS.followUpTaskUpdated, payload: { taskId: e.aggregateId } }];
  const tech = e.payload?.technicianId as string | undefined;
  if (tech) out.push({ event: EVENTS.followUpTaskUpdated, payload: { taskId: e.aggregateId }, scope: 'technician', technicianId: tech });
  return out;
}

export function projectToClient(e: DomainEvent<any>): Client[] {
  const fn = MAP[e.eventType]; if (!fn) return [];
  const r = fn(e); return Array.isArray(r) ? r : [r];
}

/** 200-technician §90: the realtime-first lane runs this consumer over each claimed batch before the batch's other
 *  consumers (InProcessTransport `first`, ConsumerRunner.runBatch). Its handler writes nothing — the lane relies on it. */
export const REALTIME_PROJECTION_CONSUMER = 'realtime.projection';

export class RealtimeProjectionConsumer implements EventConsumer {
  readonly name = REALTIME_PROJECTION_CONSUMER;
  readonly eventTypes = Object.keys(MAP) as any;
  readonly critical = false;
  // §43/§44: re-projecting only re-sends screen-refresh notifications; no state, no money, no external call.
  readonly replay = 'REPLAY_SAFE' as const;
  constructor(private readonly realtime: RealtimeEmitterLike | null) {}
  async handle(e: DomainEvent<any>): Promise<void> {
    if (!this.realtime) return;                                 // no bus (tests / DB-less) → nothing to project
    for (const p0 of projectToClient(e)) {
      // §43 (Oct 21 2026): every projected payload names its resource and version, for a client that applies frames as
      // state (it would drop a frame whose resourceVersion is below what it holds). Today's clients (useRealtime in
      // pos-web; the shared realtime-client) treat every frame as a REFETCH signal and never read resourceVersion — so
      // cross-aggregate order (PUBLISHER.lanes) cannot repaint an older state. Ids only.
      const resourceVersion = typeof e.aggregateVersion === 'number' ? e.aggregateVersion : (typeof e.payload?.version === 'number' ? e.payload.version : null);
      // Oct 28 2026: which counter it is — only the aggregate's own row version is comparable across every event of the resource,
      // so the shared realtime client drops a late frame only for 'aggregate' (a payload's `version` may be another counter)
      const resourceVersionSource = typeof e.aggregateVersion === 'number' ? 'aggregate' : resourceVersion != null ? 'payload' : null;
      const p = { ...p0, payload: { ...(p0.payload && typeof p0.payload === 'object' ? (p0.payload as Record<string, unknown>) : {}), resourceType: e.aggregateType ?? null, resourceId: e.aggregateId ?? null, resourceVersion, resourceVersionSource } };
      if (p.scope === 'ticket') { if (p.ticketId) this.realtime.toTicket?.(p.ticketId, p.event, p.payload); continue; }
      if (p.scope === 'technician') { if (p.technicianId) this.realtime.toTechnician?.(p.technicianId, p.event, p.payload); continue; }
      if (p.scope === 'customer') { if (p.customerId) this.realtime.toCustomer?.(p.customerId, p.event, p.payload); continue; }
      if (p.scope === 'owner') { if (e.tenantId) this.realtime.toOwner?.(String(e.tenantId), p.event, p.payload); continue; }   // the owner app's tenant room
      if (p.scope === 'salon') {                               // every user of THAT salon: owner room + branch-less room + each branch room
        if (!e.tenantId) continue;
        const t = String(e.tenantId);
        this.realtime.toOwner?.(t, p.event, p.payload);
        this.realtime.toTenant({ tenantId: t, branchId: '' }, p.event, p.payload);
        for (const b of p.branchIds ?? []) this.realtime.toTenant({ tenantId: t, branchId: b }, p.event, p.payload);
        continue;
      }
      const tenantId = e.tenantId || p.tenantId;               // a platform event names its salon explicitly; nothing else crosses tenants
      if (!tenantId) continue;
      this.realtime.toTenant({ tenantId, branchId: e.branchId ?? '' }, p.event, p.payload);
    }
  }
}
