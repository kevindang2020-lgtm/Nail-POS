// booking-lifecycles.ts — BUILD_PLAN Phase 12 (#27): booking-owned lifecycles (customer phone numbers, the SMS usage
// ledger's delivery status) as state machines; the appointment / queue machines live in @aipowersalon/appointments and
// the hold / verification-session machines in customer-booking/booking-hold-machine.ts.
import { defineStateMachine } from '@aipowersalon/database';

/** customer_phones.status — a new number waits for verification, then is promoted (verified by SMS, or confirmed by staff
 *  as active_unverified) or closed (expired / failed / inactive); a live number is replaced by its successor. A REPLACED
 *  number is history and never comes back. */
export const CUSTOMER_PHONE = defineStateMachine({
  name: 'customer_phone', table: 'customer_phones', column: 'status',
  states: ['pending_verification', 'active_verified', 'active_unverified', 'manual_review_required', 'disputed', 'locked', 'inactive', 'verification_expired', 'verification_failed', 'replaced'],
  transitions: {
    pending_verification: ['active_verified', 'active_unverified', 'manual_review_required', 'inactive', 'verification_expired', 'verification_failed'],
    manual_review_required: ['active_verified', 'active_unverified', 'inactive', 'verification_failed'],
    active_verified: ['active_verified', 'replaced', 'inactive', 'disputed', 'locked'],
    active_unverified: ['active_unverified', 'active_verified', 'replaced', 'inactive', 'disputed', 'locked'],
    disputed: ['active_verified', 'active_unverified', 'replaced', 'inactive'],
    locked: ['active_verified', 'active_unverified', 'replaced', 'inactive'],
    inactive: ['inactive', 'replaced'],
    replaced: ['replaced'],
  },
  initial: ['pending_verification', 'active_verified', 'active_unverified'],
});

/** sms_usage_records.status — the provider's delivery callbacks, forward only; DELIVERED / UNDELIVERED / FAILED are final
 *  (a late or repeated callback never rewrites them). */
export const SMS_USAGE_RECORD = defineStateMachine({
  name: 'sms_usage_record', table: 'sms_usage_records', column: 'status',
  states: ['REQUESTED', 'SUBMITTED', 'ACCEPTED', 'DELIVERED', 'UNDELIVERED', 'FAILED'],
  transitions: {
    REQUESTED: ['SUBMITTED', 'ACCEPTED', 'DELIVERED', 'UNDELIVERED', 'FAILED'],
    SUBMITTED: ['ACCEPTED', 'DELIVERED', 'UNDELIVERED', 'FAILED'],
    ACCEPTED: ['DELIVERED', 'UNDELIVERED', 'FAILED'],
  },
  initial: ['REQUESTED', 'SUBMITTED', 'ACCEPTED'],
});
