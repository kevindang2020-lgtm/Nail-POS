// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the queue module's request-body schemas (Check-In, Queue, Tech Queue,
// Serving, Service Done, the Technician app, technician help, the live schedule, Go Check-In), applied with
// @Body(ValidatedBody(SCHEMA)). Written from each service method (the fields it reads) and from every client that calls
// the route today — pos-web (posCheckInApi, posQueueApi, posTechQueueApi, posServingApi, posServiceDoneApi,
// posLiveTechnicianScheduleApi, posDashboardApi, QuickCheckInPanel), tech-web (techApi), customer-web, the Go Check-In
// kiosk (go-check-in-kiosk/index.html) and the customer display (goCheckInApi) — so every body sent today passes.
// Unknown fields are stripped (e.g. the walk-in's source / idempotencyKey, which the service never read); tenantId /
// permissions sent where undeclared are refused (a stray `status` is stripped — no queue body carries money).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const id: BodySchema = str(64);
const ids = (max = 100): BodySchema => S.nullable(S.array(S.text(64), { maxItems: max }));
const flag: BodySchema = S.nullable(S.boolean());
/** a count / minutes / version a handler Number()-coerces — a number, or a numeric string a form sends */
const num: BodySchema = { type: ['number', 'string', 'null'], maxLength: 16 };
const cents: BodySchema = S.nullable(S.integer({ minimum: 0 }));
const reason: BodySchema = str(1000);
const notes: BodySchema = str(4000);
const obj = (props: Record<string, BodySchema>): BodySchema => S.object(props);

/** a catalog line a walk-in / visit carries (resolveCatalogLines re-prices it from the catalog) */
const serviceLine: BodySchema = S.object({
  serviceId: id, name: str(200), serviceName: str(200), durationMinutes: num, priceCents: cents, priceOverrideCents: cents,
  overrideReason: str(500), isAddon: flag, parentServiceId: id,
});
const priceOverrides: BodySchema = S.nullable({ type: 'object', additionalProperties: S.object({ priceCents: cents, reason: str(500) }) });

// ── Check-In (pos-web posCheckInApi / QuickCheckInPanel / POSWalkInScreen / POSNewBookingScreen) ─────────────────────
export const CI_WALK_IN_BODY: BodySchema = obj({
  customerId: id, customerName: str(200), customerPhone: str(40), isNewCustomer: flag, serviceIds: ids(),
  // Check-In mandate §25 (Oct 28 2026): the New Customer tab's optional email and SMS consent reach the customer record
  customerEmail: str(254), smsOptIn: flag,
  serviceLines: S.nullable(S.array(serviceLine, { maxItems: 100 })), priceOverrides, technicianId: id, notes, isVip: flag,
  // pos-web QuickCheckInPanel / POSWalkInScreen send both on every walk-in (the key also rides the Idempotency-Key header) —
  // strict since 327d2ddb without them, every POS walk-in was a 400; found by the §40 type proof (Oct 27 2026)
  source: str(40), idempotencyKey: str(200),
});
export const CI_CREATE_CUSTOMER_BODY: BodySchema = S.object({ fullName: str(200), phone: str(40), email: str(254), smsOptIn: flag });
export const CI_UPDATE_SERVICES_BODY: BodySchema = obj({ serviceIds: ids(), serviceLines: S.nullable(S.array(serviceLine, { maxItems: 100 })), priceOverrides });
export const CI_ASSIGN_BODY: BodySchema = obj({ technicianId: id, managerOverride: flag });
export const CI_WAIT_BODY: BodySchema = obj({ quotedWaitMinutes: num });
export const CI_CANCEL_BODY: BodySchema = obj({ reason, cancelAppointment: flag });

// ── Queue (pos-web posQueueApi / POSQueueScreen / QueueItemInner / posDashboardApi) ──────────────────────────────────
const expectation = { expectedTechnicianId: id, expectedVersion: num };
export const Q_REORDER_BODY: BodySchema = obj({ order: S.nullable(S.array(S.object({ queueItemId: id, expectedVersion: num }), { maxItems: 500 })) });
export const Q_GROUP_BODY: BodySchema = obj({ label: str(200), queueItemIds: ids(50), together: flag });
export const Q_CREATE_BODY: BodySchema = obj({
  customerId: id, customerName: str(200), customerPhone: str(40), source: str(32), serviceIds: ids(), priority: str(32), notes,
  appointmentId: id, requestedTechnicianId: id,
});
export const Q_UPDATE_BODY: BodySchema = obj({ customerName: str(200), customerPhone: str(40), notes, station: str(100) });
export const Q_CALL_NEXT_BODY: BodySchema = obj({ notify: flag });
export const Q_ASSIGN_BODY: BodySchema = obj({ technicianId: id, ...expectation, idempotencyKey: str(200), managerOverride: flag, reason, source: str(32), overrideReasonCode: str(40) });
export const Q_UNASSIGN_BODY: BodySchema = obj({ ...expectation, reason, source: str(32) });
export const Q_AUTO_BALANCE_BODY: BodySchema = obj({ proposals: S.nullable(S.array(S.object({ queueItemId: id, technicianId: id, ...expectation }), { maxItems: 500 })) });
export const Q_REQUESTED_TECH_BODY: BodySchema = obj({ technicianId: id, reason });
export const Q_SERVICES_BODY: BodySchema = obj({ serviceIds: ids() });
export const Q_PRIORITY_BODY: BodySchema = obj({ priority: str(32), reason });
export const NOTIFY_BODY: BodySchema = obj({ channel: str(20) });
export const Q_CANCEL_BODY: BodySchema = obj({ reason });
export const Q_LOCK_BODY: BodySchema = obj({ technicianId: id, reason, expiresInMinutes: num });
export const Q_UNLOCK_BODY: BodySchema = obj({ reason });
export const Q_SERVICE_ASSIGNMENTS_BODY: BodySchema = obj({ assignments: S.nullable(S.array(S.object({ serviceId: id, technicianId: id }), { maxItems: 100 })) });
export const Q_REMOVE_BODY: BodySchema = obj({ reason });
/** POST pos/queue/plans/assign — the ONE writer of a multi-line (split visit / party) assignment, all or none. */
export const Q_ASSIGN_PLAN_BODY: BodySchema = obj({
  items: S.nullable(S.array(S.object({
    queueItemId: id, expectedVersion: num, expectedTechnicianId: id, leadTechnicianId: id,
    lines: S.nullable(S.array(S.object({ serviceId: id, technicianId: id, expectedTechnicianId: id }), { maxItems: 20 })),
  }), { maxItems: 20 })),
  groupId: id, idempotencyKey: str(200), managerOverride: flag, reason, source: str(32),
});
export const ACCEPT_ALTERNATE_BODY: BodySchema = obj({ technicianId: id, queueItemId: id });

// ── Tech Queue (pos-web posTechQueueApi / POSTechQueueScreen) ─────────────────────────────────────────────────────────
export const TQ_ACCEPT_BODY: BodySchema = obj({ expectedVersion: num });
export const TQ_DECLINE_BODY: BodySchema = obj({ reason, expectedVersion: num, reasonCode: str(40) });   // Fair Turn §64: the structured decline reason decides the turn consequence   // merge Oct 12 2026: a stale decline is a no-op
export const TQ_REASSIGN_BODY: BodySchema = obj({ technicianId: id, reason, managerOverride: flag });
export const TQ_SERVICES_BODY: BodySchema = obj({ serviceIds: ids() });
export const TQ_PRIORITY_BODY: BodySchema = obj({ priority: str(32), reason });
export const DELAY_BODY: BodySchema = obj({ reason, extraMinutes: num, customerNotified: flag, managerReviewNeeded: flag });
export const CLEAR_DELAY_BODY: BodySchema = obj({ note: reason });
export const OVERRIDE_BODY: BodySchema = obj({ managerOverride: flag });
export const TQ_CANCEL_BODY: BodySchema = obj({ reason });

// ── Serving / Service Done (pos-web posServingApi / posServiceDoneApi) ────────────────────────────────────────────────
export const SV_DECISION_BODY: BodySchema = obj({ decision: str(16) });
export const NOTES_BODY: BodySchema = obj({ notes, customerVisibleNotes: notes });
export const SV_ADD_SERVICE_BODY: BodySchema = obj({ serviceId: id, technicianId: id, priceOverrideCents: cents, managerOverride: flag, expectedVersion: num, clientRequestId: str(64) });   // clientRequestId: Serving mandate §103 (one logical add-on → one line)
/** Serving mandate §72 Send Update — a guest status update through the communications path (channel app | sms) */
export const SV_NOTIFY_BODY: BodySchema = obj({ channel: str(16), kind: str(32) });
/** Serving mandate §58 Send Staff Alert — an internal notice to ONE technician of this salon (technician_notifications) */
export const SV_STAFF_ALERT_BODY: BodySchema = obj({ technicianId: id, ticketId: id, message: str(500) });
export const SV_ADD_RETAIL_BODY: BodySchema = obj({ productId: id, quantity: num, technicianId: id, managerPin: { type: ['string', 'number', 'null'], maxLength: 32 } });
/** editing a line may set ITS status (a serving line, not the ticket) — declared, so it is not refused */
export const SV_EDIT_SERVICE_BODY: BodySchema = S.object({ technicianId: id, priceOverrideCents: cents, status: str(32), expectedVersion: num });
export const SV_REMOVE_SERVICE_BODY: BodySchema = obj({ serviceLineId: id, reason, expectedVersion: num });
export const TECH_ID_BODY: BodySchema = obj({ technicianId: id });
export const REOPEN_BODY: BodySchema = obj({ reason, managerPin: { type: ['string', 'number', 'null'], maxLength: 32 } });
export const SD_QUALITY_BODY: BodySchema = obj({ result: str(32), checklist: S.nullable({ anyOf: [S.array(S.freeObject(), { maxItems: 50 }), S.freeObject()] }), note: notes, expectedVersion: S.nullable(S.integer({ minimum: 0 })) });   // expectedVersion: Service Done mandate §108

// ── Technician app (tech-web techApi) ─────────────────────────────────────────────────────────────────────────────────
export const T_ACCEPT_BODY: BodySchema = obj({ expectedVersion: num });
export const T_DECLINE_BODY: BodySchema = obj({ reason, reasonCode: str(40) });   // Fair Turn §64
export const T_DONE_BODY: BodySchema = obj({ notes });
// Payroll wave 2 (§152): a technician's question about an earning — she can ask, never change the entry
/** Weekly Paycheck §11: the technician says the cash handed to her is wrong / not received (the owner is alerted). */
export const T_CASH_DISPUTE_BODY: BodySchema = S.object({ reason: S.text(500) }, ['reason']);
// Weekly Paycheck §11.5 (Oct 27 2026): the QR handoff code the manager's screen showed (optional — a plain confirmation stays valid)
export const T_CASH_ACK_BODY: BodySchema = S.object({ handoffCode: str(16) });
export const T_PAYROLL_INQUIRY_BODY: BodySchema = S.object({ message: S.text(1000), periodId: str(64), subjectType: str(16), subjectId: str(64) }, ['message']);
export const T_READ_BODY: BodySchema = obj({ ids: S.nullable(S.array({ type: ['string', 'number'], maxLength: 64 }, { maxItems: 500 })) });
export const T_ADD_LINE_BODY: BodySchema = obj({ serviceId: id, notes });
/** a technician's own line: notes and the line's progress status (the bridge clamps it) */
export const T_PATCH_LINE_BODY: BodySchema = S.object({ notes, status: str(32) });
export const T_REMOVE_LINE_BODY: BodySchema = obj({ reason });
export const T_CHANGE_REQUEST_BODY: BodySchema = obj({ type: str(32), lineId: id, newServiceId: id, reason });
export const T_ADD_ON_BODY: BodySchema = obj({ serviceId: id });
export const T_NOTE_BODY: BodySchema = obj({ note: notes, visibility: str(16) });
export const T_CANCEL_REQUEST_BODY: BodySchema = obj({ reason });
/** a skill request: draft or submit it (the request's own status, draft | submitted — the repository clamps it) */
export const T_SKILL_BODY: BodySchema = S.object({
  serviceId: id, requestType: str(16), note: str(500), proficiencyLevel: str(32), experienceYears: num,
  supportingPhotos: S.nullable(S.array(S.text(2048), { maxItems: 20 })), certificateEvidence: str(2048), status: str(32),
});
export const T_SKILL_DECISION_BODY: BodySchema = obj({ decision: str(32), reviewNotes: str(2000) });
export const T_MESSAGE_BODY: BodySchema = obj({ topic: str(200), message: str(4000) });
// Oct 12 2026 merge (Technician Profile, migration 584): certifications — the technician's own rows + a manager's verify/revoke.
export const T_CERT_BODY: BodySchema = obj({ name: str(160), issuer: str(160), issuedAt: str(10), expiresAt: str(10), documentKey: str(512) });
export const T_CERT_VERIFY_BODY: BodySchema = obj({ status: str(16), reason: str(500) });
export const HELP_CREATE_BODY: BodySchema = obj({ ticketId: id, serviceLineId: id, helperTechnicianId: id, reason, note: notes });
export const HELP_DECLINE_BODY: BodySchema = obj({ reason });

// ── Live technician schedule (pos-web posLiveTechnicianScheduleApi) ───────────────────────────────────────────────────
export const LS_BOOK_BODY: BodySchema = obj({ customerId: id, customerName: str(200), serviceIds: ids(), durationMinutes: num, serviceSummary: str(500) });
export const LS_BLOCK_BODY: BodySchema = obj({ date: str(10), startTime: str(40), endTime: str(40), reason, note: notes });
export const LS_BREAK_BODY: BodySchema = obj({ reason, managerOverride: flag });

// ── Go Check-In (Super Admin admin-web Check-In Devices, POS settings, the kiosk + the customer display) ───────────────────────
const settings = {
  appointmentCheckinEnabled: flag, walkinCheckinEnabled: flag, newCustomerEnabled: flag, serviceSelectionEnabled: flag,
  technicianPreferenceEnabled: flag, tenantPhoneLookupEnabled: flag, centralLookupEnabled: flag, customerLinkingEnabled: flag,
  showWaitEstimate: flag, autoSendToQueue: flag, requireFrontDeskApproval: flag, confirmationTimeoutSeconds: num,
  displayLanguages: S.nullable(S.array(str(8), { maxItems: 4 })),   // Dual-Screen §118–§119 (the service cleans + refuses)
};
/** Super Admin owns the master switch */
export const GO_ADMIN_SETTINGS_BODY: BodySchema = S.object({ enabled: flag, ...settings });
/** a tenant may send `enabled` (the handler drops it — Super Admin owns it), so it is declared, not refused */
export const GO_POS_SETTINGS_BODY: BodySchema = S.object({ enabled: flag, ...settings });
export const GO_DEVICE_CREATE_BODY: BodySchema = S.object({ deviceName: str(200), branchId: id, deviceType: str(32), baseUrl: str(500), allowedBranchIds: ids(50), welcomeMessage: str(500) });
/** a device's status IS what the admin edits here (through the GO_CHECKIN_DEVICE machine) */
export const GO_DEVICE_UPDATE_BODY: BodySchema = S.object({ status: str(16), branchId: id, allowedBranchIds: ids(50), welcomeMessage: str(500) });
export const GO_START_BODY: BodySchema = S.object({ branchId: id });
export const GO_PHONE_BODY: BodySchema = S.object({ phone: str(40) });
/** round 10 (Tablets 02): the heartbeat may carry what the device's browser exposes — its OS and battery (optional) */
export const GO_HEARTBEAT_BODY: BodySchema = S.object({ os: str(64), battery: S.nullable(S.object({ percent: S.nullable(S.number()), charging: S.nullable(S.boolean()) })) });
export const GO_CUSTOMER_BODY: BodySchema = S.object({ customerId: id });
export const GO_CREATE_CUSTOMER_BODY: BodySchema = S.object({ firstName: str(100), lastName: str(100), fullName: str(200), phone: str(40), email: str(254), smsConsent: flag });
export const GO_APPOINTMENT_BODY: BodySchema = S.object({ appointmentId: id });
export const GO_WALK_IN_BODY: BodySchema = S.object({ customerId: id, customerName: str(200), phone: str(40), serviceIds: ids(), addOnIds: ids(), technicianId: id, notes: str(1000) });
export const GO_PIN_BODY: BodySchema = S.object({ pin: { type: ['string', 'number', 'null'], maxLength: 16 }, idempotencyKey: str(200) });
