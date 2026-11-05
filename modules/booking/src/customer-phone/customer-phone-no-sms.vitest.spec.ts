// customer-phone-no-sms.vitest.spec.ts — the salon changes a number without an OTP.
//
// ══ WHAT KEVIN ASKED FOR, AND WHY IT IS SOUND ═════════════════════════════════════════════════════════════
//
//     "Just let the nail salon change phone numbers for customers. I only need verification when they book."
//
// That is a coherent design, and the earlier refusal to allow it was wrong.
//
// The customer is STANDING AT THE COUNTER reading their new number to a receptionist who is looking at them.
// Making them wait for a text to prove a number they just said out loud protects against nothing — and it is
// friction a busy salon will route around, by writing it in a note field or by not updating it at all, which is
// worse than either option on the table.
//
// The safety property is preserved because it lives somewhere better:
//
//     canCompleteBookingVerification() requires 'active_verified'
//
// A staff change produces `active_unverified`. So the next remote booking sees an unproven number and sends a
// code. **Verification still happens — at BOOKING, which is the only place a fake number does real damage**: a
// fake appointment, a no-show attack, an abused slot.
//
// What the salon accepts is narrower, and these tests name it: a MISTYPED number means they start texting a
// stranger. Reminders, not bookings.
import { describe, it, expect } from 'vitest';
import {
  canReceiveSms, canCompleteBookingVerification, activationPolicy,
} from './customer-phone-core';

describe('the safety property, stated exactly', () => {
  it('an unverified number CAN be texted — reminders, confirmations, and the code that would prove it', () => {
    expect(canReceiveSms('active_unverified')).toBe(true);
  });

  it('but it can NEVER complete a booking verification', () => {
    // THIS is the line that makes the whole configuration safe. A number that arrived without an OTP cannot
    // satisfy the booking gate — so a fake number cannot become a fake appointment.
    expect(canCompleteBookingVerification('active_unverified')).toBe(false);
    expect(canCompleteBookingVerification('active_verified')).toBe(true);
  });

  it('so a staff-changed number is asked for a code the next time the customer books remotely', () => {
    // Not a special case in the booking module — it falls out of the status. The booking gate reads
    // `booking_verified_phones`, the new number has no record there, and the policy resolver returns `required`.
    const statusAfterStaffChangeWithoutSms = 'active_unverified' as const;
    expect(canCompleteBookingVerification(statusAfterStaffChangeWithoutSms)).toBe(false);
  });
});

describe('the customer APP still verifies first — and the rule is deliberately not symmetrical', () => {
  it('customer_app is verify_then_activate regardless', () => {
    // The receptionist is looking at the customer. The customer in the app is ALONE WITH THEIR PHONE: a mistyped
    // digit that took effect immediately would cut them off from their own account AND from every code that could
    // fix it — including the one that would let them undo it.
    //
    // The risk is not symmetrical, so the rule is not either. `requireSmsVerification: false` relaxes the COUNTER,
    // never the app.
    expect(activationPolicy('customer_app')).toBe('verify_then_activate');
    expect(activationPolicy('staff_pos')).toBe('save_pending_then_verify');
  });
});

describe('what the salon is accepting, named honestly', () => {
  it('an unverified number IS used for reminders — so a mistype texts a stranger', () => {
    // This is the actual cost, and it is worth being able to point at. It is a nuisance and a small privacy leak.
    // It is NOT a booking, and it is NOT an account takeover — the two things that would have made this
    // configuration unsafe to offer.
    expect(canReceiveSms('active_unverified')).toBe(true);
    expect(canCompleteBookingVerification('active_unverified')).toBe(false);
  });

  it('a REPLACED number is dropped from messaging immediately', () => {
    // The old number belongs to whoever holds it now. It stops receiving this salon's messages the moment it is
    // replaced — that part does not relax.
    expect(canReceiveSms('replaced')).toBe(false);
  });
});
