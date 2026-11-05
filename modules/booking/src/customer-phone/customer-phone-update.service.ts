// customer-phone-update.service.ts — THE canonical phone-update service.
//
// ══ THE SPEC'S FIRST RULE, AND IT IS THE RIGHT ONE ════════════════════════════════════════════════════════
//
//     "Do not allow each frontend to update customer phone numbers independently using separate business logic."
//
// Two frontends with two rule sets is two rule sets that drift, and the fraud moves to whichever drifted. So the
// receptionist at the POS and the customer in the app call the SAME service, and the difference between them is
// ONE parameter (`source`) that the PURE core turns into a policy — not a second implementation.
//
// ══ WHAT IS REUSED, NOT REWRITTEN ═════════════════════════════════════════════════════════════════════════
//
//   normalization / masking / hashing  ← customer-activation-core   (E.164, not US-assumed)
//   the six-digit code, tenant Twilio  ← BookingVerificationService (Twilio Verify; we never hold the code)
//   the rules                          ← customer-phone-core        (pure; 32 tests)
//
// A second OTP implementation would be a second place to leak a code from. A second set of rules would be a second
// thing to get wrong.
import type { AuditSink } from '@aipowersalon/audit';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import type { PhoneNotifier } from './customer-phone-notify';
import {
  normalizePhone, maskPhone, phoneKey, displayPhone, callingCode,
} from '@aipowersalon/customers';
import {
  transition, classifyDuplicates, can, isProven,
  MANUAL_CONFIRMATION_STATUS, MANUAL_CONFIRMATION_LABEL,
  type Actor, type PhoneStatus, type UpdateState, type UpdateSource,
  type PhoneMatch, type DuplicateResult,
} from './customer-phone-core';
import { isCustomerPrincipal } from '@aipowersalon/permissions';

export class PhoneUpdateError extends Error {
  constructor(msg: string, readonly code: PhoneUpdateErrorCode, readonly extra?: Record<string, unknown>) { super(msg); }
}
export type PhoneUpdateErrorCode =
  | 'forbidden' | 'invalid_phone' | 'duplicate_conflict' | 'stale_record'
  | 'no_provider' | 'not_found' | 'invalid_state' | 'disabled' | 'reauth_required' | 'rate_limited';

/** Limits on STARTING changes (the code itself is limited by booking verification: attempts, cooldown, sends). */
export const START_LIMITS = { perCustomerPerHour: 6, perActorPerHour: 40 } as const;

export interface PhoneUpdateCtx {
  tenantId: string;
  branchId: string | null;
  userId: string;
  role: Actor;
  source: UpdateSource;
}

export interface PhoneSettings {
  allowReceptionistUpdates: boolean;
  requireSmsVerification: boolean;
  allowPendingUnverified: boolean;
  allowSharedFamilyPhones: boolean;
  allowManualConfirmation: boolean;
  customerAppSelfService: boolean;
  notifyOldNumber: boolean;
  /** A receptionist's change waits for a manager's approval before any code is sent or anything activates. */
  requireManagerApproval: boolean;
  /** The customer app asks for the password again before a self-service change. */
  requireReauthentication: boolean;
}

/** Everything the service persists. A port — the decisions above are what matter, and they must be testable. */
export interface PhoneStore {
  /** The policy for this branch (no branch in the context: the customer's home branch, then the salon default). */
  settings(tenantId: string, branchId: string | null, customerId?: string): Promise<PhoneSettings>;
  /** The customer, with their record_version for optimistic locking. */
  customer(tenantId: string, customerId: string): Promise<{ id: string; fullName: string | null; recordVersion: number } | null>;
  /** Everyone at THIS TENANT whose phone hashes to this. Never cross-tenant — see the isolation note in start(). */
  /**
   * Everyone at THIS TENANT on this number.
   *
   * Takes BOTH the hash and the plaintext E.164, and that is not redundancy. `customer_phones` stores a hash;
   * the LEGACY `customers.normalized_phone` stores plaintext — and on day one every existing customer's number
   * lives only there. A lookup that could only match the hash would find nothing at all for the entire existing
   * customer base, and the duplicate check would silently pass on every single edit.
   */
  matchesByHash(tenantId: string, phoneHash: string, excludeCustomerId: string, normalizedPhone: string): Promise<PhoneMatch[]>;
  /** The customer's current active phone, if any. */
  activePhone(tenantId: string, customerId: string): Promise<{ id: string; mask: string; status: PhoneStatus } | null>;

  createSession(input: {
    tenantId: string; branchId: string | null; customerId: string;
    newPhoneHash: string; newPhoneMask: string; oldPhoneId: string | null;
    source: string; userId: string; role: string; reason: string | null;
    customerVersion: number; idempotencyKey: string | null; state: UpdateState;
    duplicateOutcome: string | null;
    /** The customer_phones row this session proposes (audit E1: the session must know WHICH row it activates). */
    newPhoneId: string; ttlMinutes?: number;
    /** Written in the same transaction as the session (Constitution 8). */
    event?: PhoneEventInput;
  }): Promise<{ id: string }>;
  session(tenantId: string, sessionId: string): Promise<PhoneSession | null>;
  /** The customer's open change, if any (at most one). */
  openSession(tenantId: string, customerId: string): Promise<PhoneSession | null>;
  /** The session a replayed request (same idempotency key) already opened. */
  sessionByIdempotencyKey(tenantId: string, key: string): Promise<PhoneSession | null>;
  setSessionState(sessionId: string, state: UpdateState, patch?: Record<string, unknown>): Promise<void>;
  /** End a session that will not complete and retire its pending number (audit E2/E11). */
  closeSession(tenantId: string, sessionId: string, state: UpdateState, phoneStatus?: 'inactive' | 'verification_expired'): Promise<void>;
  markDisplayRequested?(tenantId: string, sessionId: string): Promise<boolean>;
  displayPromptSession?(tenantId: string, customerId: string): Promise<{ sessionId: string; maskedPhone: string; requestedBy: string | null } | null>;
  /** The customer's current number (E.164), or null. */
  currentPhone?(tenantId: string, customerId: string): Promise<string | null>;
  /** Changes started in the last hour for this customer, and by this actor. */
  recentStarts?(tenantId: string, customerId: string, userId: string): Promise<{ customer: number; actor: number }>;
  /** What a screen shows (status route). */
  phoneStatus?(tenantId: string, customerId: string): Promise<import('./customer-phone.kysely').PhoneStatusView | null>;
  /** Run one session's synchronisation now. */
  runSync?(tenantId: string, sessionId: string, sync: SyncPort): Promise<boolean>;
  /** The E.164 number a session proposes (from its pending row — the session itself keeps only a hash and a mask). */
  proposedPhone?(tenantId: string, sessionId: string): Promise<string | null>;
  /** Queue a retry for a session whose records failed to synchronise (optional: the store may not have a queue). */
  scheduleSyncRetry?(tenantId: string, sessionId: string): Promise<void>;
  /** The pre-status-model number on the customer record, adopted as an active row so it can be retired properly. */
  adoptLegacyPhone(tenantId: string, customerId: string, derive: (e164: string) => DerivedPhone | null): Promise<{ id: string; mask: string; status: PhoneStatus } | null>;

  /** Save the proposed number as pending. Returns its id. */
  savePendingPhone(input: {
    tenantId: string; branchId: string | null; customerId: string;
    normalizedPhone: string; phoneHash: string; phoneMask: string; phoneDisplay?: string; countryCode?: string | null;
    userId: string; source: string; reason: string | null;
  }): Promise<{ id: string }>;

  /**
   * Activate the proven number and retire the old one — in ONE transaction, guarded by `record_version`.
   * Returns false when the version has moved (somebody else changed this customer while we were verifying).
   */
  activate(input: {
    tenantId: string; customerId: string; newPhoneId: string; oldPhoneId: string | null;
    normalizedPhone: string; phoneMask: string; status: PhoneStatus; method: string;
    expectedVersion: number; phoneDisplay?: string; phoneHash?: string;
    event?: PhoneEventInput;
  }): Promise<boolean>;
}

/** A domain event for the store to write with its fact. Safe identifiers only — masked numbers, never a code. */
export interface PhoneEventInput { type: (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS]; tenantId: string; branchId?: string | null; customerId: string; sessionId?: string | null; actorId?: string | null; payload: Record<string, unknown> }

export interface PhoneSession {
  id: string; customerId: string; state: UpdateState; newPhoneHash: string; newPhoneMask: string;
  oldPhoneId: string | null; source: UpdateSource; customerVersion: number;
  newPhoneId: string | null;
  /** The location the change happens at (a customer's own change: their home branch). */
  branchId?: string | null;
  /** Past its deadline (expires_at). */
  expired?: boolean;
  /** completed_at is set: the session has ended one way or another. */
  closed?: boolean;
  duplicateOutcome?: string | null;
  requestedBy?: string | null;
  approved?: boolean;
}

export interface DerivedPhone { e164: string; hash: string; mask: string; display: string; country: string | null }
/** Every representation of one number, from one place. */
export function derivePhone(raw: string): DerivedPhone | null {
  const e164 = normalizePhone(String(raw ?? ''));
  if (!e164) return null;
  return { e164, hash: phoneKey(e164), mask: maskPhone(e164), display: displayPhone(e164), country: callingCode(e164) };
}

/** The booking-verification module. We do NOT reimplement the OTP — this is the same service the booking gate uses. */
export interface VerificationPort {
  send(ctx: { tenantId: string; branchId: string; bookingSessionId: string; customerId: string | null }, phone: string):
    Promise<{ status: string; maskedPhone?: string; message: string }>;
  check(ctx: { tenantId: string; branchId: string; bookingSessionId: string; customerId: string | null }, phone: string, code: string):
    Promise<{ status: string; message: string }>;
}

export interface SyncPort {
  /** Propagate a VERIFIED number to the linked records. Returns false to mean "retry me". */
  synchronize(input: { tenantId: string; customerId: string; normalizedPhone: string; phoneHash: string }): Promise<boolean>;
}

/** §9/§10 bridge to the GLOBAL customer identity (sync spec). Structural, so this module keeps its own shape.
 *  `applyVerifiedPhone` is deliberately narrow: it may only be called with a number that has been PROVEN by SMS. */
export interface GlobalIdentityPort {
  applyVerifiedPhone(input: { tenantId: string; customerId: string; e164: string }): Promise<{ outcome: string }>;
}

function replayedDuplicates(outcome: string | null | undefined): DuplicateResult {
  return { outcome: (outcome ?? 'no_conflict') as DuplicateResult['outcome'], requiresResolution: false, requiresManager: false, matches: [], message: '' };
}

export class CustomerPhoneUpdateService {
  constructor(
    private readonly store: PhoneStore,
    private readonly verification: VerificationPort,
    private readonly sync: SyncPort,
    private readonly audit?: AuditSink,
    private readonly notify?: PhoneNotifier,
    private readonly identity?: GlobalIdentityPort,
  ) {}

  /**
   * Start a change. Validates, de-dupes, and saves the number as PENDING.
   *
   * It does NOT touch the customer's active number. Nothing here can — that is `activate()`, and it is
   * unreachable without a proven verification.
   */
  async start(
    ctx: PhoneUpdateCtx,
    input: {
      customerId: string; newPhone: string; reason?: string; expectedVersion?: number; idempotencyKey?: string; staffAssertsSharedPhone?: boolean;
      /** Customer app: the result of the password check the controller ran (`no_password`: the account has none to check). */
      reauth?: 'ok' | 'failed' | 'no_password';
      /** A manager resolving a duplicate conflict: let the change proceed, with the reason recorded. */
      managerResolution?: { resolution: 'shared_family_phone' | 'different_people' | 'same_person_keep_separate'; reason: string };
    },
  ): Promise<{ sessionId: string; state: UpdateState; maskedPhone: string; duplicates: DuplicateResult }> {
    // ── who ──
    if (!can(ctx.role, 'update')) {
      throw new PhoneUpdateError('You cannot change a customer\u2019s phone number.', 'forbidden');
    }
    const settings = await this.store.settings(ctx.tenantId, ctx.branchId, input.customerId);
    if (ctx.source === 'staff_pos' && ctx.role === 'RECEPTION' && !settings.allowReceptionistUpdates) {
      throw new PhoneUpdateError('Phone updates by reception are turned off for this salon.', 'disabled');
    }
    if (ctx.source === 'customer_app' && !settings.customerAppSelfService) {
      throw new PhoneUpdateError('Changing your number in the app is not available for this salon.', 'disabled');
    }
    if (input.managerResolution) {
      if (!can(ctx.role, 'resolveDuplicate')) throw new PhoneUpdateError('Only a manager can resolve a duplicate-number conflict.', 'forbidden');
      if (String(input.managerResolution.reason ?? '').trim().length < 12) throw new PhoneUpdateError('A specific reason is required to resolve a duplicate.', 'invalid_state');
    }

    // ── a replayed request (flaky connection, double tap) gets the session it already opened — not a 500 ──
    if (input.idempotencyKey) {
      const prior = await this.store.sessionByIdempotencyKey(ctx.tenantId, input.idempotencyKey);
      if (prior) {
        if (prior.customerId !== input.customerId) throw new PhoneUpdateError('That request was already used for another customer.', 'invalid_state');
        return { sessionId: prior.id, state: prior.state, maskedPhone: prior.newPhoneMask, duplicates: replayedDuplicates(prior.duplicateOutcome) };
      }
    }

    // ── rate limits: a script cycling numbers through one customer, or one account through many customers ──
    const recent = await this.store.recentStarts?.(ctx.tenantId, input.customerId, ctx.userId);
    if (recent && (recent.customer >= START_LIMITS.perCustomerPerHour || recent.actor >= START_LIMITS.perActorPerHour)) {
      throw new PhoneUpdateError('Too many phone changes in a short time. Please wait and try again.', 'rate_limited');
    }

    // ── the customer, and their VERSION ──
    //
    // TENANT-SCOPED read. A customer id alone must never be enough to reach into another salon's records — which
    // is the whole of the spec's "Tenant A cannot update Tenant B's private customer record."
    const customer = await this.store.customer(ctx.tenantId, input.customerId);
    if (!customer) throw new PhoneUpdateError('Customer not found.', 'not_found');

    // Optimistic lock. Two receptionists on two tills, one looking at a screen from five minutes ago: the stale
    // one must be REFUSED, not allowed to clobber the newer number.
    if (input.expectedVersion != null && input.expectedVersion !== customer.recordVersion) {
      throw new PhoneUpdateError(
        'This customer was updated by someone else. Refresh and try again.',
        'stale_record',
        { currentVersion: customer.recordVersion },
      );
    }

    // ── the number ──
    const d = derivePhone(String(input.newPhone ?? ''));
    if (!d) throw new PhoneUpdateError('That phone number does not look valid.', 'invalid_phone');
    const { e164, hash, mask } = d;

    // Tenant setting require_reauthentication (default ON) — stored since migration 373, read by nothing until Phase 3.
    // A stolen session can change where reminders and booking codes go; a password it does not carry. Re-verifying the
    // number the customer ALREADY has moves nothing, so it needs no password.
    if (ctx.source === 'customer_app' && settings.requireReauthentication && input.reauth !== 'ok' && input.reauth !== 'no_password') {
      const current = await this.store.currentPhone?.(ctx.tenantId, input.customerId);
      if (current !== e164) throw new PhoneUpdateError('Enter your password to change your phone number.', 'reauth_required');
    }

    // ── duplicates ──
    //
    // `matchesByHash` is TENANT-SCOPED. A match at another salon is never fetched and never returned — showing a
    // receptionist that "this number belongs to someone at a different salon" would leak another tenant's customer
    // through a warning dialog.
    const matches = await this.store.matchesByHash(ctx.tenantId, hash, input.customerId, e164);
    const dup = classifyDuplicates({
      matches,
      customerId: input.customerId,
      customerName: customer.fullName,
      staffAssertsSharedPhone: !!input.staffAssertsSharedPhone && settings.allowSharedFamilyPhones,
      actorCanResolve: can(ctx.role, 'resolveDuplicate'),
    });

    if (dup.requiresResolution && input.managerResolution) {
      // The manager looked at the conflict and decided. Proceeds — and the decision is on the record (audit + session).
      await this.audit?.record({
        tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role,
        module: 'customer_phone', action: 'duplicate_resolved_by_manager',
        summary: 'Manager resolved a duplicate phone-number conflict',
        metadata: { customerId: input.customerId, outcome: dup.outcome, resolution: input.managerResolution.resolution, reason: input.managerResolution.reason, newPhoneMasked: mask, matches: dup.matches.length },
      }).catch(() => undefined);
      Object.assign(dup, { outcome: 'manager_resolved', requiresResolution: false, requiresManager: false, message: 'Resolved by a manager.' });
    }
    if (dup.requiresResolution) {
      if (dup.requiresManager && !can(ctx.role, 'resolveDuplicate')) {
        // Three people on one number: a receptionist under time pressure should not be deciding whether that is a
        // family or a mess. The managers are told there is one to look at.
        await this.notify?.staffAlert?.({ tenantId: ctx.tenantId, branchId: ctx.branchId, severity: 'info',
          title: 'A phone number is shared by several customers',
          body: `Reception tried to give a customer the number ${mask}, which several customers already use. A manager can review it from the customer's profile.`,
          metadata: { customerId: input.customerId, matches: dup.matches.length } }).catch(() => undefined);
        throw new PhoneUpdateError(dup.message, 'duplicate_conflict', { duplicates: dup, requiresManager: true });
      }
      throw new PhoneUpdateError(dup.message, 'duplicate_conflict', { duplicates: dup });
    }

    // ── an open change for this customer ──
    //
    // Audit E2: a session that was never finished blocked every later change for this customer (one open session per
    // customer), and nothing ever closed it. The SAME proposal resumes; a different one supersedes the open session —
    // unless that one is already proven, which nobody may throw away.
    const open = await this.store.openSession(ctx.tenantId, input.customerId);
    if (open) {
      if (isProven(open.state) && open.state !== 'synchronization_failed') {
        throw new PhoneUpdateError('A verified change for this customer is being applied. Try again in a moment.', 'invalid_state', { sessionId: open.id });
      }
      if (!open.expired && !isProven(open.state) && open.newPhoneHash === hash && open.source === ctx.source) {
        return { sessionId: open.id, state: open.state, maskedPhone: open.newPhoneMask, duplicates: dup };
      }
      // synchronization_failed: the earlier number is already active — its sync retry continues on the queue; the
      // session just stops blocking. Anything else unproven is superseded and its pending number retired.
      await this.store.closeSession(ctx.tenantId, open.id, open.state === 'synchronization_failed' ? 'synchronization_failed' : 'update_canceled');
    }

    // ── save as PENDING ──
    // The number on the record before the status model existed is adopted as an active row first, so this change
    // RETIRES it (and revokes its booking verification) instead of leaving it as an invisible second number.
    const active = await this.store.activePhone(ctx.tenantId, input.customerId)
      ?? await this.store.adoptLegacyPhone(ctx.tenantId, input.customerId, derivePhone);

    // ── SMS NOT REQUIRED: the staff change takes effect NOW ─────────────────────────────────────────────
    //
    // The tenant turned `requireSmsVerification` off. That is a supported, deliberate configuration, and it means
    // exactly one thing: a counter correction does not need an OTP.
    //
    // The customer is STANDING THERE reading their new number to a receptionist who is looking at them. Making
    // them wait for a text to prove a number they just said out loud protects against nothing, and it is friction a
    // busy salon will route around — by writing the number in a note field, or by not updating it at all, which is
    // worse than either option on the table.
    //
    // The number becomes `active_unverified`: usable for calls, texts and reminders, and HONESTLY LABELLED as never
    // having been proved. It is NOT `active_verified`, and that distinction is the entire safety argument here,
    // because:
    //
    //     canCompleteBookingVerification() requires 'active_verified'
    //
    // So the next time this customer books remotely, the booking gate sees an unproven number and sends a code.
    // **Verification still happens — it happens at BOOKING, which is the only place a fake number does real
    // damage**: a fake appointment, a no-show attack, an abused slot.
    //
    // What the salon accepts is narrower and worth saying plainly: a MISTYPED number means they start texting a
    // stranger. Reminders, not bookings. That is a real cost and it is theirs to weigh.
    const smsRequired = settings.requireSmsVerification;

    // ── require_manager_approval: a receptionist's change WAITS for a manager ────────────────────────────
    // Saved as pending and parked in `manager_review_required`; no code is sent and nothing activates until a manager
    // approves (approve()). A manager's own change needs no approval.
    if (settings.requireManagerApproval && ctx.source === 'staff_pos' && !can(ctx.role, 'resolveDuplicate')) {
      const pendingRow = await this.store.savePendingPhone({
        tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId,
        normalizedPhone: e164, phoneHash: hash, phoneMask: mask, phoneDisplay: d.display, countryCode: d.country,
        userId: ctx.userId, source: ctx.source, reason: input.reason ?? null,
      });
      const review = await this.store.createSession({
        tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId,
        newPhoneHash: hash, newPhoneMask: mask, oldPhoneId: active?.id ?? null,
        source: ctx.source, userId: ctx.userId, role: ctx.role, reason: input.reason ?? null,
        customerVersion: customer.recordVersion, idempotencyKey: input.idempotencyKey ?? null,
        state: 'manager_review_required', duplicateOutcome: dup.outcome, newPhoneId: pendingRow.id,
        event: { type: DOMAIN_EVENTS.CUSTOMER_PHONE_UPDATE_REQUESTED, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId, actorId: ctx.userId,
          payload: { source: ctx.source, state: 'manager_review_required', newPhoneMasked: mask, oldPhoneMasked: active?.mask ?? null, duplicateOutcome: dup.outcome } },
        ttlMinutes: 24 * 60,                                   // a manager may not be on shift for hours
      });
      await this.audit?.record({
        tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role,
        module: 'customer_phone', action: 'phone_update_awaiting_approval',
        summary: 'Customer phone change awaiting manager approval',
        metadata: { customerId: input.customerId, sessionId: review.id, newPhoneMasked: mask, oldPhoneMasked: active?.mask ?? null },
      }).catch(() => undefined);
      await this.notify?.staffAlert?.({ tenantId: ctx.tenantId, branchId: ctx.branchId, severity: 'info',
        title: 'A customer phone change is waiting for your approval',
        body: `Reception asked to change a customer's number to ${mask}. Approve it from the customer's profile (Change phone number).`,
        metadata: { customerId: input.customerId, sessionId: review.id } }).catch(() => undefined);
      return { sessionId: review.id, state: 'manager_review_required', maskedPhone: mask, duplicates: dup };
    }

    if (!smsRequired && ctx.source !== 'customer_app') {
      // NOT for the customer app. There, the customer is ALONE with their phone: a mistyped digit that takes effect
      // immediately would cut them off from their own account AND from every code that could fix it. The app always
      // verifies first, whatever this setting says — the risk is not symmetrical, so the rule is not either.
      const phoneRow = await this.store.savePendingPhone({
        tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId,
        normalizedPhone: e164, phoneHash: hash, phoneMask: mask, phoneDisplay: d.display, countryCode: d.country,
        userId: ctx.userId, source: ctx.source, reason: input.reason ?? null,
      });

      const ok = await this.store.activate({
        tenantId: ctx.tenantId, customerId: input.customerId,
        newPhoneId: phoneRow.id, oldPhoneId: active?.id ?? null,
        normalizedPhone: e164, phoneMask: mask, phoneDisplay: d.display, phoneHash: hash,
        // active_unverified — usable, and honest about never having been proved.
        status: 'active_unverified',
        method: 'manual_confirmation',
        // The optimistic lock still applies. A stale screen must not overwrite a NEWER number just because the
        // salon turned an OTP off.
        expectedVersion: customer.recordVersion,
        event: { type: DOMAIN_EVENTS.CUSTOMER_PHONE_ACTIVATED, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId, actorId: ctx.userId,
          payload: { source: ctx.source, method: 'none_tenant_policy', status: 'active_unverified', newPhoneMasked: mask, oldPhoneMasked: active?.mask ?? null } },
      });

      if (!ok) {
        throw new PhoneUpdateError(
          'This customer was changed by someone else while you were editing. Review the current details and try again.',
          'stale_record',
          { currentVersion: customer.recordVersion },
        );
      }

      await this.sync.synchronize({
        tenantId: ctx.tenantId, customerId: input.customerId, normalizedPhone: e164, phoneHash: hash,
      }).catch(() => false);

      await this.audit?.record({
        tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role,
        module: 'customer_phone', action: 'phone_changed_without_sms',
        summary: 'Customer phone changed by staff (SMS verification not required by tenant policy)',
        metadata: {
          customerId: input.customerId, source: ctx.source,
          oldPhoneMasked: active?.mask ?? null, newPhoneMasked: mask,
          reason: input.reason ?? null,
          // Recorded explicitly. A number that entered the system without an SMS is exactly the thing somebody
          // will want to trace later — and "nobody wrote it down" is not an answer.
          verificationMethod: 'none_tenant_policy',
        },
      }).catch(() => undefined);

      // Told like any other change: the old number (salon policy), and the managers (a number nobody proved).
      await this.notify?.phoneChanged({ tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId, newPhoneMasked: mask, newPhoneHash: d.hash, method: 'manual_confirmation', oldPhoneId: active?.id ?? null }).catch(() => undefined);

      return {
        sessionId: '',
        state: 'phone_activated' as UpdateState,
        maskedPhone: mask,
        duplicates: dup,
      };
    }

    const pending = await this.store.savePendingPhone({
      tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId,
      normalizedPhone: e164, phoneHash: hash, phoneMask: mask, phoneDisplay: d.display, countryCode: d.country,
      userId: ctx.userId, source: ctx.source, reason: input.reason ?? null,
    });

    const session = await this.store.createSession({
      tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId,
      newPhoneHash: hash, newPhoneMask: mask, oldPhoneId: active?.id ?? null,
      source: ctx.source, userId: ctx.userId, role: ctx.role, reason: input.reason ?? null,
      customerVersion: customer.recordVersion, idempotencyKey: input.idempotencyKey ?? null,
      state: 'pending_phone_saved', duplicateOutcome: dup.outcome,
      newPhoneId: pending.id,
      event: { type: DOMAIN_EVENTS.CUSTOMER_PHONE_UPDATE_REQUESTED, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: input.customerId, actorId: ctx.userId,
        payload: { source: ctx.source, state: 'pending_phone_saved', newPhoneMasked: mask, oldPhoneMasked: active?.mask ?? null, duplicateOutcome: dup.outcome } },
    });

    // MASKED in the audit record, always. A full phone number in an ordinary audit message is a phone number in a
    // log aggregator, a slow-query trace, and a support ticket.
    await this.audit?.record({
      tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role,
      module: 'customer_phone', action: 'phone_update_started',
      summary: 'Customer phone update started',
      metadata: {
        customerId: input.customerId, sessionId: session.id, source: ctx.source,
        oldPhoneMasked: active?.mask ?? null, newPhoneMasked: mask,
        reason: input.reason ?? null, duplicateOutcome: dup.outcome,
      },
    }).catch(() => undefined);

    return { sessionId: session.id, state: 'pending_phone_saved', maskedPhone: mask, duplicates: dup };
  }

  /**
   * Send the six-digit code — through the EXISTING booking-verification module, on the TENANT'S OWN Twilio.
   *
   * `newPhoneId` is bound to the session, so a code sent for one change cannot complete a different one.
   */
  /**
   * The session — only if it belongs to THIS customer (audit E15: neither controller checked, so any customer id in
   * the path, or any signed-in customer, could drive somebody else's session) — and only while it is open.
   */
  private async owned(ctx: PhoneUpdateCtx, sessionId: string, customerId: string, opts: { allowClosed?: boolean } = {}): Promise<PhoneSession> {
    const s = await this.store.session(ctx.tenantId, sessionId);
    if (!s || !customerId || s.customerId !== customerId) throw new PhoneUpdateError('That phone update was not found.', 'not_found');
    if (!opts.allowClosed && s.closed) throw new PhoneUpdateError('This phone update has ended. Start again.', 'invalid_state', { state: s.state });
    if (!opts.allowClosed && s.expired && !isProven(s.state)) {
      await this.store.closeSession(ctx.tenantId, s.id, 'verification_expired', 'verification_expired');
      throw new PhoneUpdateError('This phone update expired. Start again.', 'invalid_state', { state: 'verification_expired' });
    }
    return s;
  }

  async sendCode(ctx: PhoneUpdateCtx, sessionId: string, newPhone: string, customerId: string): Promise<{ state: UpdateState; message: string }> {
    if (!can(ctx.role, 'sendCode')) throw new PhoneUpdateError('You cannot send a verification code.', 'forbidden');

    const s = await this.owned(ctx, sessionId, customerId);
    // Only from a state that may send — checked BEFORE the provider is called. (A change waiting for a manager's
    // approval must not text anybody; neither may a proven or ended one.)
    if (!transition(s.state, 'send_ok').ok) {
      throw new PhoneUpdateError(s.state === 'manager_review_required' ? 'This change is waiting for a manager\u2019s approval.' : 'A code cannot be sent for this change now.', 'invalid_state', { state: s.state });
    }

    // The code goes to the number the SESSION proposed, not to whatever the caller passes now. Otherwise a caller
    // could open a session for one number and have the code sent to another.
    const e164 = normalizePhone(String(newPhone ?? ''));
    if (!e164 || phoneKey(e164) !== s.newPhoneHash) {
      throw new PhoneUpdateError('That number does not match this update.', 'invalid_phone');
    }

    const out = await this.verification.send(
      { tenantId: ctx.tenantId, branchId: ctx.branchId || s.branchId || '', bookingSessionId: sessionId, customerId: s.customerId },
      e164,
    );

    // Twilio not configured is NOT the end of the update. The pending number is saved; the tenant can connect
    // Twilio and resend. Throwing it away would make the customer start over for a problem that was never theirs.
    const ev = out.status === 'code_sent' ? 'send_ok'
      : out.status === 'twilio_not_configured' ? 'no_provider'
      : 'send_fail';

    const t = transition(s.state, ev as any);
    const next = t.ok ? t.state : s.state;
    await this.store.setSessionState(sessionId, next);

    if (ev === 'no_provider') {
      throw new PhoneUpdateError(
        'Phone saved, but verification could not be sent because Twilio is not configured.',
        'no_provider',
        { state: next, sessionId },
      );
    }
    return { state: next, message: out.message };
  }

  /**
   * Check the code. On success the number is proven — and only then may it be activated.
   */
  async verify(ctx: PhoneUpdateCtx, sessionId: string, newPhone: string, code: string, customerId: string): Promise<{ state: UpdateState; activated: boolean; message: string }> {
    const s = await this.owned(ctx, sessionId, customerId);

    const e164 = normalizePhone(String(newPhone ?? ''));
    // The code proves THIS number. A code checked against a different number would verify something nobody texted.
    if (!e164 || phoneKey(e164) !== s.newPhoneHash) {
      throw new PhoneUpdateError('That number does not match this update.', 'invalid_phone');
    }

    const out = await this.verification.check(
      { tenantId: ctx.tenantId, branchId: ctx.branchId || s.branchId || '', bookingSessionId: sessionId, customerId: s.customerId },
      e164, code,
    );

    if (out.status !== 'phone_verified') {
      const ev = out.status === 'code_expired' ? 'code_expired' : 'code_fail';
      const t = transition(s.state, ev as any);
      if (t.ok) await this.store.setSessionState(sessionId, t.state, { event: { type: DOMAIN_EVENTS.CUSTOMER_PHONE_VERIFICATION_FAILED, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: s.customerId, sessionId, actorId: ctx.userId,
        payload: { source: s.source, reason: ev, newPhoneMasked: s.newPhoneMask } } });
      return { state: t.ok ? t.state : s.state, activated: false, message: out.message };
    }

    const proven = transition(s.state, 'code_ok');
    if (!proven.ok) throw new PhoneUpdateError('This update cannot be verified now.', 'invalid_state');
    await this.store.setSessionState(sessionId, proven.state, { event: { type: DOMAIN_EVENTS.CUSTOMER_PHONE_VERIFIED, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: s.customerId, sessionId, actorId: ctx.userId,
      payload: { source: s.source, method: 'sms_otp', newPhoneMasked: s.newPhoneMask } } });

    // ── activate ──
    return this.activate(ctx, sessionId, e164, 'sms_otp');
  }

  /**
   * Turn a PROVEN number into the active one, retire the old one, and synchronise.
   *
   * Private in spirit: the only ways in are `verify()` (SMS proof) and `manuallyConfirm()` (a manager's judgement,
   * which produces a DIFFERENT status). There is no path from an unproven session to here.
   */
  private async activate(ctx: PhoneUpdateCtx, sessionId: string, e164: string, method: 'sms_otp' | 'manual_confirmation'):
    Promise<{ state: UpdateState; activated: boolean; message: string }> {
    const s = await this.store.session(ctx.tenantId, sessionId);
    if (!s || !isProven(s.state)) throw new PhoneUpdateError('This number has not been verified.', 'invalid_state');
    if (!s.newPhoneId) throw new PhoneUpdateError('This phone update has no proposed number on record. Start again.', 'invalid_state');

    const d = derivePhone(e164)!;
    const hash = d.hash;
    const mask = d.mask;

    // `sms_otp` → active_verified. `manual_confirmation` → active_unverified, ALWAYS. A manager's judgement is not
    // cryptographic evidence and must never be recorded as if it were.
    const status: PhoneStatus = method === 'sms_otp' ? 'active_verified' : MANUAL_CONFIRMATION_STATUS;

    // Audit E1: the row being activated is the one the SESSION proposed. It used to be `(s as any).newPhoneId ?? ''`
    // — never set — so every SMS-verified change failed here as a false VERSION_CONFLICT.
    const ok = await this.store.activate({
      tenantId: ctx.tenantId, customerId: s.customerId,
      newPhoneId: s.newPhoneId, oldPhoneId: s.oldPhoneId,
      normalizedPhone: e164, phoneMask: mask, phoneDisplay: d.display, phoneHash: hash, status, method,
      expectedVersion: s.customerVersion,
      event: { type: DOMAIN_EVENTS.CUSTOMER_PHONE_ACTIVATED, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: s.customerId, sessionId, actorId: ctx.userId,
        payload: { source: s.source, method, status, newPhoneMasked: mask } },
    });

    if (!ok) {
      // The customer's record moved while we were verifying. We do NOT clobber it — the newer write wins, and the
      // human is asked to look. The verification itself is NOT lost: the session stays proven and can be retried
      // against the current version.
      throw new PhoneUpdateError(
        'This customer was updated by someone else while we were verifying. Please review and try again.',
        'stale_record',
        { sessionId, state: 'phone_verified' },
      );
    }

    const activated = transition('phone_verified', 'activate');
    await this.store.setSessionState(sessionId, (activated as any).state);

    // ── synchronise, and never lose the change if it fails ──
    let synced = false;
    try {
      synced = await this.sync.synchronize({ tenantId: ctx.tenantId, customerId: s.customerId, normalizedPhone: e164, phoneHash: hash });
    } catch {
      synced = false;
    }

    const finalState = transition('phone_activated', synced ? 'sync_ok' : 'sync_fail');
    await this.store.setSessionState(sessionId, (finalState as any).state, { event: {
      type: synced ? DOMAIN_EVENTS.CUSTOMER_PHONE_SYNC_COMPLETED : DOMAIN_EVENTS.CUSTOMER_PHONE_SYNC_FAILED,
      tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: s.customerId, sessionId, actorId: ctx.userId, payload: { attempt: 1 } } });
    // Not lost: a failed synchronisation is a job on the queue — retried with backoff, dead-lettered (and visible on
    // Super Admin → Jobs) if it never succeeds.
    if (!synced) await this.store.scheduleSyncRetry?.(ctx.tenantId, sessionId).catch(() => undefined);

    await this.audit?.record({
      tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role,
      module: 'customer_phone',
      action: method === 'sms_otp' ? 'phone_verified_and_activated' : 'phone_manually_confirmed',
      summary: method === 'sms_otp' ? 'Phone verified by SMS and activated' : MANUAL_CONFIRMATION_LABEL,
      metadata: { customerId: s.customerId, sessionId, newPhoneMasked: mask, verificationMethod: method, synchronized: synced },
    }).catch(() => undefined);

    // §9: propagate to the GLOBAL identity — but ONLY for sms_otp. A manager's manual confirmation is explicitly
    // NOT cryptographic proof (it produces active_unverified above), and §12 forbids a verified global value being
    // replaced by an unverified one. Best-effort: the 7 PM reconciliation is the safety net if this fails, and a
    // collision with another global identity becomes a conflict there rather than a silent overwrite here.
    if (method === 'sms_otp' && this.identity) {
      try { await this.identity.applyVerifiedPhone({ tenantId: ctx.tenantId, customerId: s.customerId, e164 }); }
      catch { /* never unwinds a completed, verified phone change */ }
    }

    // The customer is told their number changed. Notifying the OLD number is what turns a silent account takeover
    // into one the victim can see — so it is the tenant's setting, and it defaults to ON.
    await this.notify?.phoneChanged({
      tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: s.customerId, newPhoneMasked: mask, newPhoneHash: hash, method, oldPhoneId: s.oldPhoneId,
    }).catch(() => undefined);

    return {
      state: (finalState as any).state,
      activated: true,
      message: synced ? 'Phone number updated.' : 'Phone number updated. Some records will finish syncing shortly.',
    };
  }

  /**
   * A manager marks the number usable WITHOUT an SMS.
   *
   * OFF by default, managers only, and it produces `active_unverified` — never `active_verified`. The label says
   * so. A number confirmed by a manager's judgement must stay distinguishable from one proven by a code, because
   * the moment they look the same, the manual path becomes the normal path.
   */
  async manuallyConfirm(ctx: PhoneUpdateCtx, sessionId: string, newPhone: string, reason: string, customerId: string):
    Promise<{ state: UpdateState; label: string }> {
    const settings = await this.store.settings(ctx.tenantId, ctx.branchId, customerId);
    if (!settings.allowManualConfirmation) {
      throw new PhoneUpdateError('Manual confirmation is turned off for this salon.', 'disabled');
    }
    if (!can(ctx.role, 'manuallyConfirm')) {
      // A receptionist is exactly who a social engineer calls.
      throw new PhoneUpdateError('Only a manager can confirm a number without SMS verification.', 'forbidden');
    }
    if (String(reason ?? '').trim().length < 12) {
      throw new PhoneUpdateError('A specific reason is required.', 'invalid_state');
    }

    const s = await this.owned(ctx, sessionId, customerId);

    const e164 = normalizePhone(String(newPhone ?? ''));
    if (!e164 || phoneKey(e164) !== s.newPhoneHash) {
      throw new PhoneUpdateError('That number does not match this update.', 'invalid_phone');
    }

    // Force the session to proven so activate() will run — but with `manual_confirmation`, which produces
    // active_unverified. This is the ONLY way to reach activate() without an SMS, and it cannot produce
    // active_verified even if someone later changes this line, because activate() derives the status from the
    // METHOD.
    await this.store.setSessionState(sessionId, 'phone_verified');
    const r = await this.activate({ ...ctx }, sessionId, e164, 'manual_confirmation');

    await this.audit?.record({
      tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role,
      module: 'customer_phone', action: 'manual_confirmation_used',
      summary: MANUAL_CONFIRMATION_LABEL,
      metadata: { customerId: s.customerId, sessionId, reason, newPhoneMasked: s.newPhoneMask },
    }).catch(() => undefined);

    return { state: r.state, label: MANUAL_CONFIRMATION_LABEL };
  }

  /**
   * A manager approves a receptionist's change (tenant setting require_manager_approval). With SMS required the change
   * continues to verification (pending_phone_saved → send code); without, it activates now as active_unverified — the
   * manager's approval is a judgement, never recorded as proof.
   */
  async approve(ctx: PhoneUpdateCtx, sessionId: string, customerId: string): Promise<{ state: UpdateState; activated: boolean }> {
    if (!can(ctx.role, 'resolveDuplicate')) throw new PhoneUpdateError('Only a manager can approve a phone change.', 'forbidden');
    const s = await this.owned(ctx, sessionId, customerId);
    const t = transition(s.state, 'approve');
    if (!t.ok) throw new PhoneUpdateError('This phone change is not waiting for approval.', 'invalid_state', { state: s.state });
    await this.store.setSessionState(sessionId, t.state, { approvedBy: ctx.userId });
    await this.audit?.record({
      tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role,
      module: 'customer_phone', action: 'phone_update_approved', summary: 'Manager approved a customer phone change',
      metadata: { customerId, sessionId, newPhoneMasked: s.newPhoneMask },
    }).catch(() => undefined);
    const settings = await this.store.settings(ctx.tenantId, ctx.branchId, customerId);
    if (settings.requireSmsVerification) return { state: t.state, activated: false };
    const phone = await this.store.proposedPhone?.(ctx.tenantId, sessionId);
    if (!phone) throw new PhoneUpdateError('The proposed number could not be read. Start again.', 'invalid_state');
    await this.store.setSessionState(sessionId, 'phone_verified');
    const r = await this.activate(ctx, sessionId, phone, 'manual_confirmation');
    return { state: r.state, activated: r.activated };
  }

  /**
   * "Verify my phone number" — the customer proves the number ALREADY on their profile. This is the old
   * /customer/verify/phone flow, merged in (audit: it was a second OTP implementation on the platform's own Twilio,
   * writing a third notion of "verified"). It is a change to the same number through the one canonical path: the code
   * goes out on the salon's Twilio, the number becomes active_verified, customer.phone_verified is recorded.
   */
  async requestCurrentVerification(ctx: PhoneUpdateCtx, customerId: string): Promise<{ ok: boolean; verified?: boolean; message?: string; sessionId?: string }> {
    const current = await this.store.currentPhone?.(ctx.tenantId, customerId);
    if (!current) return { ok: false, message: 'Add a phone number to your profile first.' };
    const st = await this.store.phoneStatus?.(ctx.tenantId, customerId);
    if (st?.phone?.verified) return { ok: true, verified: true };
    const started = await this.start(ctx, { customerId, newPhone: current });
    try {
      await this.sendCode(ctx, started.sessionId, current, customerId);
    } catch (e) {
      if (e instanceof PhoneUpdateError && e.code === 'no_provider') return { ok: false, message: 'Verification codes are not available at this salon right now.', sessionId: started.sessionId };
      throw e;
    }
    return { ok: true, sessionId: started.sessionId };
  }

  async confirmCurrentVerification(ctx: PhoneUpdateCtx, customerId: string, code: string): Promise<{ ok: boolean; verified?: boolean; message?: string }> {
    const current = await this.store.currentPhone?.(ctx.tenantId, customerId);
    const open = await this.store.openSession(ctx.tenantId, customerId);
    if (!current || !open || open.newPhoneHash !== phoneKey(current)) return { ok: false, message: 'Request a new code.' };
    const r = await this.verify(ctx, open.id, current, String(code ?? '').trim(), customerId);
    return r.activated ? { ok: true, verified: true } : { ok: false, message: r.state === 'verification_expired' ? 'That code has expired. Request a new one.' : 'That code is incorrect.' };
  }

  // ── the code on the CUSTOMER DISPLAY ────────────────────────────────────────────────────────────────────────────
  // The customer types the code on the display in front of them instead of reading it aloud at a busy counter. Staff
  // ask for it (the code must already have gone out); the display shows a pad (masked number only); what the customer
  // types is checked against THIS customer's open change, with the same attempt limits as any code.

  /** Staff: show the code pad on the customer display for this change. */
  async requestOnDisplay(ctx: PhoneUpdateCtx, sessionId: string, customerId: string): Promise<{ ok: true }> {
    await this.owned(ctx, sessionId, customerId);
    if (!(await this.store.markDisplayRequested?.(ctx.tenantId, sessionId))) {
      throw new PhoneUpdateError('Send the code first — the display can only ask for a code that went out.', 'invalid_state');
    }
    return { ok: true };
  }

  /** The display: is there a code for this customer to type? (masked number only) */
  async displayPrompt(tenantId: string, customerId: string): Promise<{ maskedPhone: string } | null> {
    const p = await this.store.displayPromptSession?.(tenantId, customerId);
    return p ? { maskedPhone: p.maskedPhone } : null;
  }

  /** The display: the customer typed the code. Checked against THIS customer's prompted change only. */
  async verifyFromDisplay(tenantId: string, branchId: string | null, customerId: string, code: string): Promise<{ ok: boolean; message: string }> {
    const p = await this.store.displayPromptSession?.(tenantId, customerId);
    if (!p) return { ok: false, message: 'There is no code to enter right now.' };
    const phone = await this.store.proposedPhone?.(tenantId, p.sessionId);
    if (!phone) return { ok: false, message: 'There is no code to enter right now.' };
    const ctx: PhoneUpdateCtx = { tenantId, branchId, userId: p.requestedBy ?? '', role: 'RECEPTION', source: 'kiosk' };
    const r = await this.verify(ctx, p.sessionId, phone, String(code ?? '').replace(/\D/g, '').slice(0, 6), customerId);
    return r.activated ? { ok: true, message: 'Thank you — your new number is confirmed.' } : { ok: false, message: r.message || 'That code is incorrect.' };
  }

  /** The customer's phone as a screen should show it — and any change in flight. */
  async status(ctx: PhoneUpdateCtx, customerId: string) {
    const v = await this.store.phoneStatus?.(ctx.tenantId, customerId);
    if (!v) throw new PhoneUpdateError('Customer not found.', 'not_found');
    // The customer app sees its own number masked; staff see the readable number they need to call.
    if (isCustomerPrincipal(ctx) && v.phone) v.phone.display = null;
    return v;
  }

  /** A manager re-runs a failed synchronisation now (the queue keeps retrying it otherwise). */
  async retrySync(ctx: PhoneUpdateCtx, sessionId: string, customerId: string): Promise<{ state: UpdateState }> {
    if (!can(ctx.role, 'resolveDuplicate')) throw new PhoneUpdateError('Only a manager can retry a synchronisation.', 'forbidden');
    const s = await this.owned(ctx, sessionId, customerId, { allowClosed: true });
    if (s.state !== 'synchronization_failed') throw new PhoneUpdateError('This change has nothing left to synchronise.', 'invalid_state', { state: s.state });
    try {
      await this.store.runSync?.(ctx.tenantId, sessionId, this.sync);
      return { state: 'customer_records_synchronized' };
    } catch {
      await this.store.scheduleSyncRetry?.(ctx.tenantId, sessionId).catch(() => undefined);
      throw new PhoneUpdateError('The records still could not be updated. It will keep retrying automatically.', 'invalid_state', { state: 'synchronization_failed' });
    }
  }

  /** Give up. The old number stays exactly as it was. */
  async cancel(ctx: PhoneUpdateCtx, sessionId: string, customerId: string): Promise<void> {
    const s = await this.owned(ctx, sessionId, customerId, { allowClosed: true });
    if (s.closed) return;                                        // already ended: canceling again is a no-op
    const t = transition(s.state, 'cancel');
    if (!t.ok) {
      // A PROVEN number cannot be cancelled back to nothing — the customer HAS the new phone, and pretending
      // otherwise would leave the records disagreeing with reality.
      throw new PhoneUpdateError('This number has already been verified and cannot be cancelled.', 'invalid_state');
    }
    // Ends the session AND retires its pending number (audit E11: a canceled number used to stay "pending" and look
    // like somebody else's number to the duplicate check).
    await this.store.closeSession(ctx.tenantId, sessionId, t.state);
  }
}
