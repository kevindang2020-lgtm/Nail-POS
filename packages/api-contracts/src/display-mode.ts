// display-mode.ts — Dual-Screen mandate §11–§12 (Oct 12 2026): the ONE authoritative state model of a customer display,
// and its priority. Every screen the display renders, and the mode its heartbeat reports to the POS (§83, §85), comes
// from customerDisplayMode() — never from competing booleans (showCheckout / isAd / showKiosk / paymentDone).
//
//   1. ACTIVE CHECKOUT ............ CHECKOUT
//   2. PAYMENT .................... PAYMENT_PROCESSING · PAYMENT_VERIFYING · PAYMENT_COMPLETE
//   3. A CUSTOMER AT THE SCREEN ... CHECK_IN · CHECK_IN_LOOKUP · APPOINTMENT_FOUND · WALK_IN · CHECK_IN_SUCCESS
//   (PHONE_VERIFICATION: the front desk asked the customer AT CHECKOUT to type a phone-change code — part of that
//    customer's own checkout, so it may sit on top of CHECKOUT; never on top of a payment)
//   4. SYSTEM ..................... MAINTENANCE (the owner's switch) · OFFLINE (the server cannot be reached)
//   5. ADVERTISEMENT .............. the salon's check-in + advertising, resting
//
// An advertisement never interrupts a checkout (§12, §49). There is no check-in without the server (§81: no authoritative
// offline check-in), so a guest mid-check-in when the network drops sees OFFLINE ("please see the receptionist"); and the
// server ends a display's check-in session the moment the owner switches maintenance on, so a check-in in progress
// yields to MAINTENANCE (a staff-requested phone code does not).
// Realm-neutral: the display (customer realm) and the POS (tenant realm) both read it.
import type { DisplayReportedMode } from './display-device-rules';

export const CUSTOMER_DISPLAY_MODES = [
  'ADVERTISEMENT', 'CHECK_IN', 'CHECK_IN_LOOKUP', 'APPOINTMENT_FOUND', 'WALK_IN', 'CHECK_IN_SUCCESS', 'PHONE_VERIFICATION',
  'CHECKOUT', 'PAYMENT_PROCESSING', 'PAYMENT_VERIFYING', 'PAYMENT_COMPLETE', 'OFFLINE', 'MAINTENANCE',
] as const;
export type CustomerDisplayMode = (typeof CUSTOMER_DISPLAY_MODES)[number];

/** Where the guest at the check-in is: nobody · typing a phone · looking it up · their appointment shown · walk-in details · confirmed. */
export type DisplayCheckInStep = 'none' | 'phone' | 'lookup' | 'appointment' | 'walk_in' | 'success';

export interface DisplayModeFacts {
  /** The server's CustomerDisplayState.state (null before the first answer). */
  checkoutState: string | null;
  checkInStep: DisplayCheckInStep;
  /** A phone-change code is waiting for this guest (BUILD_PLAN Phase 3). */
  phoneCode: boolean;
  /** The owner put this display in maintenance (§85). */
  maintenance: boolean;
  /** The server answered the display's last request (false: it cannot be reached right now). */
  online: boolean;
}

const CHECKOUT_MODE: Record<string, CustomerDisplayMode> = {
  ticket_review: 'CHECKOUT', tip_selected: 'CHECKOUT', payment_failed: 'CHECKOUT', expired: 'CHECKOUT',
  payment_processing: 'PAYMENT_PROCESSING', payment_verifying: 'PAYMENT_VERIFYING', payment_success: 'PAYMENT_COMPLETE',
};
const CHECK_IN_MODE: Record<Exclude<DisplayCheckInStep, 'none'>, CustomerDisplayMode> = {
  phone: 'CHECK_IN', lookup: 'CHECK_IN_LOOKUP', appointment: 'APPOINTMENT_FOUND', walk_in: 'WALK_IN', success: 'CHECK_IN_SUCCESS',
};

/** §11–§12: the display's mode. Pure; the priority is the order of the checks. */
export function customerDisplayMode(f: DisplayModeFacts): CustomerDisplayMode {
  const checkout = f.checkoutState ? CHECKOUT_MODE[f.checkoutState] : undefined;
  // 1–2: a checkout, whatever else is going on. The one step that may sit on top of it is THAT customer's own
  // phone-change code (the server only asks for it with the customer's checkout attached) — never during a payment.
  if (checkout) return checkout === 'CHECKOUT' && f.phoneCode && f.online ? 'PHONE_VERIFICATION' : checkout;
  if (f.online) {                                                        // 3: a customer — only with the server (§81)
    if (f.phoneCode) return 'PHONE_VERIFICATION';
    // a check-in SESSION exists only while the server allows one: maintenance ends the display's check-in session on
    // its very next request (go-check-in resolveSession), so a guest is never left typing into a refused session
    if (f.checkInStep !== 'none' && !f.maintenance) return CHECK_IN_MODE[f.checkInStep];
  }
  if (f.maintenance) return 'MAINTENANCE';                               // 4: system
  if (!f.online) return 'OFFLINE';
  return 'ADVERTISEMENT';                                                // 5
}

/** The heartbeat's coarser vocabulary (§85; customer_display_devices.reported_mode). `hasAds`: pictures are playing —
 *  without them the resting screen is the branded welcome, reported as idle. */
export function reportedModeFor(m: CustomerDisplayMode, hasAds: boolean): DisplayReportedMode {
  switch (m) {
    case 'CHECKOUT': case 'PAYMENT_PROCESSING': case 'PAYMENT_VERIFYING': case 'PAYMENT_COMPLETE': return 'checkout';
    case 'CHECK_IN': case 'CHECK_IN_LOOKUP': case 'APPOINTMENT_FOUND': case 'WALK_IN': case 'CHECK_IN_SUCCESS': case 'PHONE_VERIFICATION': return 'check_in';
    case 'ADVERTISEMENT': return hasAds ? 'advertisement' : 'idle';
    default: return 'idle';
  }
}

/** A customer owns the screen (a checkout or a payment): nothing of the salon's advertising may render (§12, §49). */
export const isCheckoutMode = (m: CustomerDisplayMode): boolean => m === 'CHECKOUT' || m === 'PAYMENT_PROCESSING' || m === 'PAYMENT_VERIFYING' || m === 'PAYMENT_COMPLETE';
