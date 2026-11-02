// request-schemas.ts — BUILD_PLAN Phase 12 (#17): the booking board's request-body schemas, applied with
// @Body(ValidatedBody(SCHEMA)). Written from BookingService (create / createInner / overrideAllowed / overbookDecision /
// update / reschedule / assignTechnician / cancel / noShow / checkConflict / addBlockedTime — the fields read) and from
// pos-web (POSNewBookingScreen buildPayload, POSBookingScreen create / reschedule / assign / cancel / no-show / block
// time, MoveAppointmentModal) — every body sent today passes. Unknown fields are stripped; a `status` is refused (an
// appointment's status moves only through its own routes).
import { S, type BodySchema } from '@aipowersalon/permissions';

const str = (max = 200): BodySchema => S.nullable(S.text(max));
const scalar = (max = 200): BodySchema => ({ type: ['string', 'number', 'null'], maxLength: max });
const bool: BodySchema = S.nullable(S.boolean());
const num: BodySchema = S.nullable(S.number());
const version: BodySchema = S.nullable(S.integer({ minimum: 0 }));
const NO_STATUS = { 'x-forbidden': ['status', 'appointmentStatus', 'paymentStatus'] } as const;
const overbook = { managerOverride: bool, overbookConfirmed: bool, overbookReason: str(500), reason: str(1000) };

export const CREATE_APPOINTMENT_BODY: BodySchema = S.object({
  technicianId: str(64), customerId: str(64), customerName: str(200), customerPhone: str(40),
  serviceIds: S.nullable(S.array(S.text(64), { maxItems: 50 })),
  serviceLines: S.nullable(S.array(S.object({ serviceId: str(64), name: str(200), durationMinutes: num, priceCents: num, overrideReason: str(500), isAddon: bool, parentServiceId: str(64) }), { maxItems: 100 })),
  priceOverrides: S.nullable(S.object({}, [], { additionalProperties: S.object({ priceCents: num, reason: str(500) }) })),
  partySize: S.nullable(S.integer({ minimum: 0, maximum: 100 })), date: str(32), startTime: str(16), source: str(32), notes: str(5000), isVip: bool, ...overbook,
}, [], NO_STATUS);
export const UPDATE_APPOINTMENT_BODY: BodySchema = S.object({
  customerName: str(200), customerPhone: str(40), serviceIds: S.nullable(S.array(S.text(64), { maxItems: 50 })), notes: str(5000), isVip: bool, expectedVersion: version, ...overbook,
}, [], NO_STATUS);
export const RESCHEDULE_BODY: BodySchema = S.object({ technicianId: str(64), startTime: str(16), date: str(32), notifyCustomer: bool, expectedVersion: version, ...overbook }, [], NO_STATUS);
export const ASSIGN_TECHNICIAN_BODY: BodySchema = S.object({ technicianId: scalar(64), expectedVersion: version, ...overbook }, [], NO_STATUS);   // merge Oct 12 2026: a reassign is a slot write (version + overbook policy)
export const CANCEL_APPOINTMENT_BODY: BodySchema = S.object({ reason: scalar(1000), notifyCustomer: bool }, [], NO_STATUS);
export const NO_SHOW_BODY: BodySchema = S.object({ reason: scalar(1000) }, [], NO_STATUS);
export const CONFLICT_CHECK_BODY: BodySchema = S.object({ technicianId: scalar(64), startTime: str(16), endTime: str(16), date: str(32), appointmentId: str(64) });
export const BLOCKED_TIME_BODY: BodySchema = S.object({ technicianId: scalar(64), date: str(32), startTime: str(16), endTime: str(16), reason: str(500), note: str(2000), managerOverride: bool });

// ── the customer's own booking (customer-web customerApi; the legacy booking-html page was removed in Phase 15) ──────────────────────────────
export const CUSTOMER_BOOK_BODY: BodySchema = S.object({
  salonId: str(64), serviceId: str(64), serviceIds: S.nullable(S.array(S.text(64), { maxItems: 20 })), technicianId: str(64),
  addOnIds: S.nullable(S.array(S.text(64), { maxItems: 20 })), date: str(32), startTime: str(16),
  inspirationNote: str(2000), inspirationPhotoId: str(64), dealId: str(64), dealIdempotencyKey: str(128), bookingSessionId: str(512), deviceId: str(200),
}, [], NO_STATUS);
export const CUSTOMER_RESCHEDULE_BODY: BodySchema = S.object({ date: str(32), startTime: str(16) }, [], NO_STATUS);
/** D11: POST /customer/booking/appointments/:id/deposit — the hosted tokenizer's token, never a card number (x-forbidden) */
export const CUSTOMER_DEPOSIT_PAY_BODY: BodySchema = S.object({ cardToken: str(64), expiry: str(8), cvv: str(8), cardholderName: str(120) }, ['cardToken'], { 'x-forbidden': ['account', 'cardNumber', 'pan', 'number'] });
/** POST /customer/booking/verification/send — { bookingSessionId, captchaToken }; the phone is NEVER the client's */
export const VERIFICATION_SEND_BODY: BodySchema = S.object({ bookingSessionId: str(512), captchaToken: str(4096) }, [], { 'x-forbidden': ['phone', 'phoneNumber'] });
export const VERIFICATION_CHECK_BODY: BodySchema = S.object({ bookingSessionId: str(512), code: scalar(16) }, [], { 'x-forbidden': ['phone', 'phoneNumber'] });
// ── customer account activation (customer-web ActivateAccountScreen) ─────────────────────────────────────────────
export const ACTIVATION_REQUEST_BODY: BodySchema = S.object({ phone: scalar(40), deviceId: str(200) });
export const ACTIVATION_VERIFY_BODY: BodySchema = S.object({ phone: scalar(40), code: scalar(16) });
export const ACTIVATION_SELECT_SALON_BODY: BodySchema = S.object({ ticket: scalar(2048), choiceId: scalar(64) });

// ── Phase 12 round 2: verification override / oversight / settings, the Twilio status callback, customer phone ──────
// From the controllers (the fields each String()-coerces) and pos-web (POSBookingVerificationScreen,
// POSCustomerPhoneSettingsScreen, posCustomersApi), admin-web (superAdminBookingVerificationApi, KillSwitchesPanel,
// superAdminCustomerPhoneApi) and customer-web (customerApi phone flow).
const phone: BodySchema = scalar(40);
const code: BodySchema = scalar(16);
const secretField: BodySchema = { type: ['string', 'null'], maxLength: 1024 };
const seconds: BodySchema = { type: ['number', 'string', 'null'], maxLength: 12 };
export const VERIFICATION_OVERRIDE_BODY: BodySchema = S.object({ verificationId: scalar(64), reason: scalar(1000), contactMethod: str(32) });
export const VERIFICATION_EMERGENCY_BODY: BodySchema = S.object({ disabled: bool, reason: scalar(1000) });
export const VERIFICATION_MODULE_BODY: BodySchema = S.object({ enabled: bool, reason: scalar(1000) });
export const VERIFICATION_TENANT_POLICY_BODY: BodySchema = S.object({ required: bool, blocked: bool, bypassBlocked: bool, reason: str(1000) });
export const VERIFICATION_SETTINGS_BODY: BodySchema = S.object({
  branchId: str(64), enabled: bool,
  channels: S.nullable(S.object({ online: bool, customerApp: bool, aiReceptionist: bool, kiosk: bool, frontDesk: bool, walkIn: bool })),
  verifyEveryBooking: bool, reverifyAfterSeconds: seconds, reverifyOnGroupBooking: bool, reverifyOnDeposit: bool, reverifyOnHighValue: bool, holdSeconds: seconds,
  highValueThresholdCents: { type: ['integer', 'null'], minimum: 100, maximum: 10000000 },
});
/** Twilio's status callback (form-encoded): the provider's own field names, every one a scalar — kept whole (the
 *  handler copies every key into the signed parameter map, so nothing may be stripped); a nested value is refused. */
/** Booking Phone Verification center: a staff resend carries nothing — the record id is the path, the number is the customer's record. */
export const BVC_RESEND_BODY: BodySchema = S.object({});
export const TWILIO_STATUS_CALLBACK_BODY: BodySchema = S.object({}, [], { additionalProperties: { type: ['string', 'number', 'boolean', 'null'], maxLength: 4096 } });
export const PHONE_SETTINGS_BODY: BodySchema = S.object({
  allowReceptionistUpdates: bool, requireSmsVerification: bool, allowPendingUnverified: bool, allowSharedFamilyPhones: bool,
  customerAppSelfService: bool, notifyOldNumber: bool, allowManualConfirmation: bool, requireManagerApproval: bool, requireReauthentication: bool,
});
export const PHONE_SWEEP_BODY: BodySchema = S.object({ reason: scalar(1000) });
export const PHONE_START_BODY: BodySchema = S.object({ phone, reason: str(1000), expectedVersion: { type: ['number', 'string', 'null'], maxLength: 12 }, idempotencyKey: str(200), sharedFamilyPhone: bool, currentPassword: secretField });
/** `sharedFamilyPhone`: POSCustomerPhoneEditor sends the start form's flag along with `resolution` — accepted, ignored (`resolution` decides) */
export const PHONE_RESOLVE_BODY: BodySchema = S.object({ phone, resolution: str(40), reason: str(1000), expectedVersion: { type: ['number', 'string', 'null'], maxLength: 12 }, idempotencyKey: str(200), sharedFamilyPhone: bool });
export const PHONE_SEND_BODY: BodySchema = S.object({ sessionId: str(64), phone });
export const PHONE_VERIFY_BODY: BodySchema = S.object({ sessionId: str(64), phone, code });
export const PHONE_SESSION_BODY: BodySchema = S.object({ sessionId: str(64) });
export const PHONE_MANUAL_CONFIRM_BODY: BodySchema = S.object({ phone, reason: scalar(1000) });
export const PHONE_CODE_BODY: BodySchema = S.object({ code });
export const LOGIN_NUMBER_BODY: BodySchema = S.object({ phone, currentPassword: secretField });

// B-22 (Oct 22 2026): a POS booking draft carries the New Booking form as-is (the create body, nothing required yet)
export const SAVE_DRAFT_BODY: BodySchema = S.object({ payload: CREATE_APPOINTMENT_BODY }, ['payload']);
