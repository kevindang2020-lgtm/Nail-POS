// customer-phone-core.ts — the rules for changing a customer's phone number.
//
// PURE. No DB, no Twilio, no clock of its own. Every decision here is reproducible and testable, and the same
// functions answer for the receptionist at the POS and the customer in the app — because the spec's first rule is
// the right one:
//
//     "Do not allow each frontend to update customer phone numbers independently using separate business logic."
//
// Two frontends with two rule sets is two rule sets that drift, and the fraud moves to whichever drifted.
//
// ══ THE ARCHITECTURAL FACT THAT SHAPES EVERYTHING ═════════════════════════════════════════════════════════
//
// The audit found that `customer_identities.normalized_phone` is **NOT NULL UNIQUE** — and it is the LOGIN
// CREDENTIAL (`select * from customer_identities where normalized_phone = $1` is how a customer signs in).
// Meanwhile `customers.normalized_phone` is NOT unique.
//
// That looks like a contradiction with the spec's "support shared family phone numbers" — and it is not. It is the
// resolution:
//
//   IDENTITY phone  = a CREDENTIAL. Unique, because two accounts on one login is an ambiguous login. Changing it
//                     changes how somebody signs in, so it demands verify-first, reauthentication, and token
//                     rotation.
//   CUSTOMER phone  = a CONTACT NUMBER. Not unique, and must not be. A mother and daughter at one salon share a
//                     number; only one of them has an app login on it.
//
// Every rule below keeps those two things apart. Conflating them would either break family bookings or hand an
// attacker somebody else's login.

// ── phone status model ───────────────────────────────────────────────────────────────────────────────────
//
// The spec is explicit that a boolean is not enough, and it is right: "verified" and "we have not asked yet" and
// "we asked and it failed" require completely different behaviour, and a boolean collapses all three into false.
export type PhoneStatus =
  | 'active_verified'          // proven by SMS. The only status that may receive booking OTPs.
  | 'active_unverified'        // in use, never proven (e.g. imported, or staff-entered under a permissive policy)
  | 'pending_verification'     // a NEW number, saved but not yet proven. Does NOT replace the active one.
  | 'verification_failed'
  | 'verification_expired'
  | 'replaced'                 // superseded by a newer number. Kept for audit; never messaged again.
  | 'inactive'
  | 'disputed'
  | 'locked'
  | 'manual_review_required';

/** Statuses that may receive an SMS. Everything else is silence. */
const MESSAGEABLE: PhoneStatus[] = ['active_verified', 'active_unverified'];
export const canReceiveSms = (s: PhoneStatus) => MESSAGEABLE.includes(s);

/**
 * May this number complete a BOOKING verification?
 *
 * Only a verified one. This is narrower than `canReceiveSms` on purpose: an unverified number may still get a
 * transactional message (that is how it gets verified in the first place), but it must never satisfy the booking
 * gate — otherwise the phone-change flow becomes a way to route around the verification module entirely.
 */
export const canCompleteBookingVerification = (s: PhoneStatus) => s === 'active_verified';

/**
 * A MANUALLY confirmed number is not an SMS-verified one, and the spec is right to insist they stay
 * distinguishable. `active_unverified` is what a manual confirmation produces — it is usable, and it is honest
 * about never having been proven. Labelling it `active_verified` would launder a manager's judgement into
 * cryptographic evidence.
 */
export const MANUAL_CONFIRMATION_STATUS: PhoneStatus = 'active_unverified';
export const MANUAL_CONFIRMATION_LABEL = 'Manually confirmed — OTP not completed';

// ── the update state machine ─────────────────────────────────────────────────────────────────────────────
export type UpdateState =
  | 'phone_update_started'
  | 'phone_validated'
  | 'duplicate_check_completed'
  | 'pending_phone_saved'
  | 'verification_sent'
  | 'verification_pending'
  | 'phone_verified'
  | 'phone_activated'
  | 'customer_records_synchronized'
  // terminal / error
  | 'invalid_phone'
  | 'duplicate_conflict'
  | 'manager_review_required'
  | 'twilio_not_configured'
  | 'verification_send_failed'
  | 'verification_failed'
  | 'verification_expired'
  | 'update_canceled'
  | 'synchronization_failed'
  | 'rolled_back';

export type UpdateEvent =
  | 'validate_ok' | 'validate_fail'
  | 'dup_none' | 'dup_conflict' | 'dup_needs_review' | 'dup_resolved'
  | 'save_pending'
  | 'send_ok' | 'send_fail' | 'no_provider'
  | 'code_ok' | 'code_fail' | 'code_expired'
  | 'activate'
  | 'sync_ok' | 'sync_fail'
  | 'cancel'
  | 'approve';

const TRANSITIONS: Record<UpdateState, Partial<Record<UpdateEvent, UpdateState>>> = {
  phone_update_started: { validate_ok: 'phone_validated', validate_fail: 'invalid_phone', cancel: 'update_canceled' },
  phone_validated: {
    dup_none: 'duplicate_check_completed',
    dup_conflict: 'duplicate_conflict',
    dup_needs_review: 'manager_review_required',
    cancel: 'update_canceled',
  },
  duplicate_conflict: { dup_resolved: 'duplicate_check_completed', cancel: 'update_canceled' },
  // Tenant setting require_manager_approval: a receptionist's change waits here until a MANAGER approves it. No code
  // can be sent from here — `send_ok` is not a transition out of review.
  manager_review_required: { dup_resolved: 'duplicate_check_completed', approve: 'pending_phone_saved', cancel: 'update_canceled' },
  duplicate_check_completed: { save_pending: 'pending_phone_saved', cancel: 'update_canceled' },
  pending_phone_saved: {
    send_ok: 'verification_sent',
    send_fail: 'verification_send_failed',
    no_provider: 'twilio_not_configured',
    cancel: 'update_canceled',
  },
  // A failed send is RETRYABLE, and Twilio-not-configured is too — the tenant may connect it and the pending
  // number is still there. Neither is terminal: throwing the update away would make the customer start over for a
  // problem that was never theirs.
  verification_send_failed: { send_ok: 'verification_sent', cancel: 'update_canceled' },
  twilio_not_configured: { send_ok: 'verification_sent', cancel: 'update_canceled' },
  verification_sent: {
    code_ok: 'phone_verified',
    code_fail: 'verification_failed',
    code_expired: 'verification_expired',
    cancel: 'update_canceled',
  },
  verification_pending: {
    code_ok: 'phone_verified',
    code_fail: 'verification_failed',
    code_expired: 'verification_expired',
    cancel: 'update_canceled',
  },
  // A wrong code does not destroy the update — the customer gets another go (the attempt limit lives in the OTP
  // core). An EXPIRED one can be resent.
  verification_failed: { send_ok: 'verification_sent', code_ok: 'phone_verified', cancel: 'update_canceled' },
  verification_expired: { send_ok: 'verification_sent', cancel: 'update_canceled' },

  phone_verified: { activate: 'phone_activated' },
  // Sync failing AFTER activation must NOT lose the verified change. The customer proved the number; that fact is
  // banked. It goes to a retryable failure state, not back to the start.
  phone_activated: { sync_ok: 'customer_records_synchronized', sync_fail: 'synchronization_failed' },
  synchronization_failed: { sync_ok: 'customer_records_synchronized' },

  customer_records_synchronized: {},
  invalid_phone: { validate_ok: 'phone_validated', cancel: 'update_canceled' },
  update_canceled: {},
  rolled_back: {},
};

export type TransitionResult =
  | { ok: true; state: UpdateState }
  | { ok: false; error: string };

export function transition(from: UpdateState, event: UpdateEvent): TransitionResult {
  const to = TRANSITIONS[from]?.[event];
  if (!to) return { ok: false, error: `Cannot ${event} from ${from}.` };
  return { ok: true, state: to };
}

/** Terminal — nothing further can happen. */
export const isTerminal = (s: UpdateState) =>
  s === 'customer_records_synchronized' || s === 'update_canceled' || s === 'rolled_back';

/**
 * Has the customer PROVEN the new number?
 *
 * Anything from `phone_verified` onward is banked: the SMS was answered correctly, and no later failure (a sync
 * error, a crashed job) may un-prove it. This is the line the recovery logic keys off.
 */
export const isProven = (s: UpdateState) =>
  s === 'phone_verified' || s === 'phone_activated' ||
  s === 'synchronization_failed' || s === 'customer_records_synchronized';

// ── duplicate classification ─────────────────────────────────────────────────────────────────────────────
//
//     "Do not automatically merge customers only because they share a phone number.
//      Support shared family phone numbers."
//
// Both halves matter. A salon's customer list is full of shared numbers — a mother books for her daughter, a
// husband's number is on his wife's record. Auto-merging them destroys real people's histories. Refusing the
// update outright is almost as bad: it makes the salon unable to record the truth.
//
// So we CLASSIFY and let a human decide, and we make the safe choice the easy one.
export type DuplicateOutcome =
  | 'no_conflict'
  | 'same_customer'            // the number already belongs to THIS customer. A no-op, not a conflict.
  | 'probable_duplicate'       // same tenant, similar name — probably one person recorded twice
  | 'multiple_matches'
  | 'phone_in_use'             // another customer at this tenant has it, and they look like a different person
  | 'shared_family_phone'      // staff asserted it, or the names differ enough that a family is the likely story
  | 'manual_review_required'
  | 'manager_resolved';        // a manager reviewed the conflict and let the change proceed (recorded, with a reason)

export interface PhoneMatch {
  customerId: string;
  /** SAME TENANT ONLY. A match at another salon is never returned — see the tenant-isolation note below. */
  tenantId: string;
  fullName: string | null;
  /** Whether this match is the customer being edited. */
  isSameCustomer: boolean;
  /** Has this match's number been proven? An unverified duplicate is weaker evidence. */
  status: PhoneStatus;
}

export interface DuplicateInput {
  /** Matches WITHIN THE REQUESTING TENANT. The caller must never pass a cross-tenant match. */
  matches: PhoneMatch[];
  /** The customer whose number is being changed. */
  customerId: string;
  /** Their name, for the similarity heuristic. */
  customerName: string | null;
  /** Staff explicitly said "this is a shared family phone". */
  staffAssertsSharedPhone?: boolean;
  /** May the actor resolve a conflict themselves (a manager)? Reception may assert a shared phone over ONE match only. */
  actorCanResolve?: boolean;
}

export interface DuplicateResult {
  outcome: DuplicateOutcome;
  /** Blocks the update until a human resolves it. */
  requiresResolution: boolean;
  /** Needs a MANAGER, not just any staff member. */
  requiresManager: boolean;
  /** Safe to show staff. Never another tenant's customer, never a full phone number. */
  matches: { customerId: string; maskedName: string; status: PhoneStatus }[];
  message: string;
}

/** "Sarah Chen" and "S. Chen" and "Sarah Chen-Smith" are plausibly one person. "Sarah Chen" and "Bob Diaz" are not. */
function namesLookRelated(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const A = norm(a), B = norm(b);
  if (!A.length || !B.length) return false;
  // A shared SURNAME is the family signal; a shared FIRST name plus surname is the duplicate signal.
  const sameLast = A[A.length - 1] === B[B.length - 1];
  const sameFirst = A[0] === B[0];
  return sameLast && sameFirst;
}

/** Show a name to staff without handing them a directory: "Sarah C." */
function maskName(n: string | null): string {
  if (!n) return 'Unnamed customer';
  const parts = n.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

export function classifyDuplicates(i: DuplicateInput): DuplicateResult {
  const safe = (m: PhoneMatch) => ({ customerId: m.customerId, maskedName: maskName(m.fullName), status: m.status });

  // Anything that is not this customer, at this tenant.
  const others = i.matches.filter((m) => !m.isSameCustomer && m.customerId !== i.customerId);

  if (i.matches.some((m) => m.isSameCustomer || m.customerId === i.customerId) && others.length === 0) {
    // The number already belongs to them. Changing a number to itself is a no-op, not a conflict — and treating it
    // as one would block a receptionist re-saving a profile they had not actually changed.
    return { outcome: 'same_customer', requiresResolution: false, requiresManager: false, matches: [], message: 'This is already this customer\u2019s number.' };
  }

  if (others.length === 0) {
    return { outcome: 'no_conflict', requiresResolution: false, requiresManager: false, matches: [], message: '' };
  }

  // Staff looked at the customer and said "it is a family phone". Believe them — but RECORD it, because it is a
  // human judgement and it is the thing an attacker would claim. Over SEVERAL matches the assertion is a manager's
  // to make (audit E6: reception's assertion used to skip the manager review that several matches require).
  if (i.staffAssertsSharedPhone && (others.length === 1 || i.actorCanResolve)) {
    return {
      outcome: 'shared_family_phone',
      requiresResolution: false,
      requiresManager: false,
      matches: others.map(safe),
      message: 'Recorded as a shared family phone number.',
    };
  }

  if (others.length > 1) {
    // Three people on one number is either a family or a mess, and a receptionist under time pressure should not
    // be the one deciding which.
    return {
      outcome: 'multiple_matches',
      requiresResolution: true,
      requiresManager: true,
      matches: others.map(safe),
      message: 'Several customers already use this number. A manager must review this.',
    };
  }

  const other = others[0];

  if (namesLookRelated(i.customerName, other.fullName)) {
    // Same first AND last name on one number: this is very likely the SAME PERSON recorded twice. Still not merged
    // automatically — the spec forbids it, and rightly: an automatic merge of the wrong two people is close to
    // impossible to undo, and it destroys two customers' histories at once.
    return {
      outcome: 'probable_duplicate',
      requiresResolution: true,
      requiresManager: false,
      matches: [safe(other)],
      message: 'This number belongs to a customer with a very similar name. They may be the same person.',
    };
  }

  return {
    outcome: 'phone_in_use',
    requiresResolution: true,
    requiresManager: false,
    matches: [safe(other)],
    message: 'Another customer already uses this number. Confirm whether this is a shared family phone.',
  };
}

// ── who may do what ──────────────────────────────────────────────────────────────────────────────────────
export type Actor = 'RECEPTION' | 'FRONT_DESK' | 'MANAGER' | 'OWNER' | 'SUPER_ADMIN' | 'CUSTOMER';

export interface Capability {
  update: boolean;
  sendCode: boolean;
  resolveDuplicate: boolean;
  /** Mark a number usable WITHOUT an SMS. Managers only, and never labelled "SMS verified". */
  manuallyConfirm: boolean;
  /** Merge two customer records. Not a phone-update action at all — it is a data-destroying one. */
  merge: boolean;
}

const CAPS: Record<Actor, Capability> = {
  //                       update  sendCode  resolveDup  manualConfirm  merge
  RECEPTION:   { update: true,  sendCode: true,  resolveDuplicate: false, manuallyConfirm: false, merge: false },
  FRONT_DESK:  { update: true,  sendCode: true,  resolveDuplicate: false, manuallyConfirm: false, merge: false },
  MANAGER:     { update: true,  sendCode: true,  resolveDuplicate: true,  manuallyConfirm: true,  merge: false },
  OWNER:       { update: true,  sendCode: true,  resolveDuplicate: true,  manuallyConfirm: true,  merge: true },
  // Platform support does NOT edit a tenant's customer data through a side door. Support goes through the audited
  // support workflow, which is where it can be seen.
  SUPER_ADMIN: { update: false, sendCode: false, resolveDuplicate: false, manuallyConfirm: false, merge: false },
  // The customer changes their OWN number, through the app, verify-first. They cannot resolve a duplicate or
  // confirm anything manually — those are judgements about somebody else's record.
  CUSTOMER:    { update: true,  sendCode: true,  resolveDuplicate: false, manuallyConfirm: false, merge: false },
};

export function can(actor: Actor, capability: keyof Capability): boolean {
  return !!CAPS[actor]?.[capability];
}

// ── the two flows differ, and the difference is the point ────────────────────────────────────────────────
export type UpdateSource = 'staff_pos' | 'customer_app' | 'kiosk' | 'ai_receptionist';

/**
 * Does the NEW number replace the active one immediately, or only after it is proven?
 *
 * CUSTOMER APP → verify FIRST, then activate. The customer is alone with their phone; if they mistype a digit and
 * we swap the number immediately, we have just cut them off from their own account and from every future code —
 * including the one that would let them fix it. The old number stays live until the new one answers.
 *
 * STAFF POS → the number may be saved as `pending_verification` and shown, clearly labelled. The customer is
 * standing there; a receptionist who mistypes can retype. And the salon needs to be able to record what the
 * customer just told them even if the SMS never arrives.
 *
 * In NEITHER case does an unproven number become `active_verified` — that is the line, and it does not move.
 */
export function activationPolicy(source: UpdateSource): 'verify_then_activate' | 'save_pending_then_verify' {
  return source === 'customer_app' ? 'verify_then_activate' : 'save_pending_then_verify';
}
