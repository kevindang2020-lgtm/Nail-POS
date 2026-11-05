// modules/booking — the booking domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { BookingModule } from './booking/booking.module';
export * from './booking/booking.dto';
export { KyselyBookingRepository } from './booking/booking.kysely.repository';   // used by the API today
export { BookingContext, BookingRepositoryPort, InMemoryBookingRepository } from './booking/booking.repository';   // used by the API today
export { BookingService, ConflictError, ForbiddenError, ValidationError } from './booking/booking.service';   // used by the API today
// joined by --into (customer-booking):
export { CustomerBookingModule } from './customer-booking/customer-booking.module';
export * from './customer-booking/customer-booking.dto';
export { ExistingForConflict, computeAvailableSlots, resolveWindow } from './customer-booking/availability';   // used by the API today
export { BookingPhoneInvalidError, BookingPhoneNotVerifiedError, BookingVerificationGuard, BookingVerificationUnavailableError } from './customer-booking/booking-verification-guard';   // used by the API today
export { dtmfGather, redactVerificationTurns, safeDtmfLog } from './customer-booking/booking-verification-voice';   // used by the API today
export { BookingVerificationService } from './customer-booking/booking-verification.service';   // used by the API today
export { KyselyCustomerBookingRepository } from './customer-booking/customer-booking.kysely.repository';   // used by the API today
export { CustomerBookingContext, CustomerBookingDataPort } from './customer-booking/customer-booking.repository';   // used by the API today
export { CustomerBookingService } from './customer-booking/customer-booking.service';   // used by the API today
// joined by --into (customer-activation, customer-phone):
export { CustomerActivationModule } from './customer-activation/customer-activation.controller';
export { CustomerPhoneModule } from './customer-phone/customer-phone.module';
export { CustomerPhoneUpdateService } from './customer-phone/customer-phone-update.service';   // Phase 3: the API's legacy /customer/verify/phone delegates to it
export { KyselyActivationRepo } from './customer-activation/customer-activation.repository';   // used by the API today
export { CustomerActivationService, GrantTicketStore } from './customer-activation/customer-activation.service';   // used by the API today
export { KyselyPhoneStore } from './customer-phone/customer-phone.kysely';   // used by the API today
export { InMemoryTicketStore } from './customer-activation/customer-activation.service';   // used by the API's otp-race guard (dynamic import)
export { KyselyHoldRepository, BookingHoldService } from './customer-booking/booking-hold.kysely';   // Smooth Refresh spec §35: the API's 20 s sync reconciliation reuses the ONE expiry sweep
export { KyselyVerificationStore } from './customer-booking/booking-verification.kysely';   // BUILD_PLAN Phase 4: the reconciliation's verification-expiry sweep
export { RemoteBookingAdmission, RemoteVerificationRequiredError } from './customer-booking/booking-verification-remote';   // Phase 4: public link, AI receptionist, kiosk
export { HoldSlotTakenError } from './customer-booking/booking-hold.kysely';
export { SlotHoldService, SlotHoldInvalidError, type BookingHoldGate, type PlacedHold } from './customer-booking/booking-slot-hold';   // Round 2 H: copilot + AI receptionist holds
export { sealBookingSession, openBookingSession } from './customer-booking/booking-session-token';   // Round 2 H: hold tokens
export { screenVerificationSend } from './customer-booking/booking-verification.controller';   // Phase 4: the public link's code send is screened like the app's
export { captchaClientConfig } from './customer-booking/booking-verification-fraud.adapters';
export { sealVoiceCallback, openVoiceCallback } from './customer-booking/booking-session-token';   // Phase 4: the keypad callback's own credential
export { BOOKING_HOLD, BOOKING_VERIFICATION_SESSION } from './customer-booking/booking-hold-machine';   // BUILD_PLAN Phase 12 (#27): this module's lifecycle state machines
