// booking-verification-override.service.ts — the manual staff bypass.
//
// ══ I PUSHED BACK ON THIS TWICE. HERE IS WHY, AND WHAT CHANGED. ═══════════════════════════════════════════
//
// This is a documented, permissioned way to turn the control OFF for one booking. The moment it exists, **every
// social-engineering attack on this feature routes through it** — the attacker's job stops being "defeat an SMS
// code" and becomes "convince a receptionist". That is a much easier job.
//
// So it is not a checkbox. It is built with the assumption that **the person using it is being manipulated**, and
// every constraint below exists to make that manipulation expensive, visible, and attributable:
//
//   • RECEPTIONISTS CANNOT USE IT.  The spec says so, and it is the single most important line in this file: the
//     receptionist is exactly who a social engineer calls. Owner and Manager only.
//
//   • A REASON IS REQUIRED, and it is stored.  Not for tidiness — so that when the same reason appears forty
//     times in a month, somebody can see it. A bypass nobody can count is a bypass nobody can govern.
//
//   • THE PHONE IS NOT MARKED VERIFIED.  This is the one that matters most and the one that is easiest to get
//     wrong. The override lets THIS booking through. It does NOT write `booking_verified_phones`, so it grants
//     no trust window, and the next booking on that number asks for a code again. Otherwise one manipulated
//     receptionist would hand an attacker a verified phone for 24 hours — the bypass would not be a bypass, it
//     would be a key.
//
//   • IT IS LABELLED ON THE APPOINTMENT.  `Phone verification manually bypassed` — so the technician, the manager
//     reviewing no-shows, and the auditor all see it. A bypass that looks identical to a verified booking is a
//     bypass that will be used routinely.
//
//   • SUPER ADMIN CANNOT USE IT.  Platform support bypassing a tenant's fraud control through a back door is
//     precisely the escalation path an attacker wants. Support goes through the audited support workflow, not
//     through here.
//
//   • THE PLATFORM CAN FORBID IT ENTIRELY.  A tenant whose staff are being targeted can have it switched off
//     above their heads.
/**
 * The rows this service touches. A PORT, not a raw db handle — same convention as the settings service, and for
 * the same reason: the DECISIONS here (who may bypass, what a bypass must NOT grant) are the whole value, and they
 * must be testable without a database.
 */
import type { AuditSink } from '@aipowersalon/audit';
import { hasPermission, isPlatformPrincipal } from '@aipowersalon/permissions';

export interface OverrideStore {
  /** Is manual bypass forbidden for this tenant by platform policy (its own switch: bypass_blocked)? */
  bypassBlocked(tenantId: string): Promise<boolean>;
  /**
   * Mark THIS verification overridden — one waiting (pending / sent / locked) session of this salon (and of this
   * branch, for branch-scoped staff). Deliberately narrow — there is no method here that can mark a PHONE verified.
   * Null when no such session is waiting.
   */
  markSessionOverridden(tenantId: string, branchId: string | null, verificationId: string, by: { userId: string; reason: string; contactMethod: string }): Promise<{ id: string } | null>;
  /** The verifications waiting for a code right now (masked numbers only), for the manager's list. */
  listOpen?(tenantId: string, branchId: string | null): Promise<OpenVerification[]>;
}

export interface OpenVerification {
  id: string; channel: string; maskedPhone: string; status: string; attempts: number;
  createdAt: string; expiresAt: string; slotStartsAt: string | null; technicianId: string | null;
}

export class OverrideError extends Error {
  constructor(msg: string, readonly code: 'forbidden' | 'invalid' | 'not_found') { super(msg); }
}

/** Only these may bypass. NOT receptionists — they are exactly who a social engineer calls. */
// BUILD_PLAN Phase 9: was ALLOWED_ROLES = ['OWNER', 'MANAGER'] — decided by role NAME, so a branch-manager template
// with the key DENIED still passed and an owner-granted ALLOW could not. Both keys map to booking.override.
const OVERRIDE_PERM = 'pos.booking.override_verification';
const PENDING_PERM = 'pos.booking.verification_pending';

/** Minimum length for a reason. Short enough not to be a nuisance; long enough that "ok" does not pass. */
const MIN_REASON = 12;

export interface OverrideCtx {
  tenantId: string;
  branchId: string | null;
  userId: string;
  role: string;
  /** BUILD_PLAN Phase 9: the session's permissions — the override is decided by pos.booking.override_verification
   *  (→ booking.override: owners and managers by default), not by the role's name. */
  permissions?: readonly string[];
}

export interface OverrideInput {
  /** The waiting verification (from the manager's list) — never a phone number. */
  verificationId: string;
  /** Why. Stored, and countable — a bypass nobody can count is a bypass nobody can govern. */
  reason: string;
  /** How the staff member confirmed the customer is real: they were standing there, or staff called them back. */
  contactMethod: 'in_person' | 'staff_called_back' | 'known_customer';
}

export class BookingVerificationOverrideService {
  constructor(
    private readonly store: OverrideStore,
    private readonly audit?: AuditSink,
  ) {}

  /**
   * Authorise ONE booking without a verification code.
   *
   * Returns nothing useful on purpose: the caller gets permission to proceed, not a token, not a verified phone,
   * not anything reusable.
   */
  async authorize(ctx: OverrideCtx, input: OverrideInput): Promise<{ ok: true; label: string }> {
    // ── who ──
    //
    // SUPER_ADMIN is checked FIRST and separately. My first version put it after the allowed-roles check, which
    // made it unreachable — SUPER_ADMIN is not in ALLOWED_ROLES, so it was rejected with the wrong message and the
    // specific refusal never fired. The distinction matters: "you are not an owner" and "platform support does not
    // get a back door into a tenant's fraud control" are different refusals, and the second one is the one
    // somebody needs to read.
    if (isPlatformPrincipal(ctx)) {
      throw new OverrideError('Platform support cannot bypass a salon\u2019s phone verification.', 'forbidden');
    }

    // A receptionist is the person a social engineer calls. Giving them this permission by default would make the
    // control's weakest point its most accessible one.
    if (!hasPermission({ ...ctx, branchId: ctx.branchId ?? '', permissions: [...(ctx.permissions ?? [])] } as any, OVERRIDE_PERM)) {
      throw new OverrideError('Only an owner or a manager can complete a booking without phone verification.', 'forbidden');
    }

    // ── the platform may forbid it entirely ──
    if (await this.store.bypassBlocked(ctx.tenantId)) {
      throw new OverrideError('Manual bypass is disabled for this salon by platform policy.', 'forbidden');
    }

    // ── why ──
    const reason = String(input.reason ?? '').trim();
    if (reason.length < MIN_REASON) {
      throw new OverrideError('A specific reason is required to bypass phone verification.', 'invalid');
    }
    if (!['in_person', 'staff_called_back', 'known_customer'].includes(input.contactMethod)) {
      throw new OverrideError('Record how you confirmed this customer.', 'invalid');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.verificationId ?? ''))) {
      throw new OverrideError('Choose the booking waiting for verification.', 'invalid');
    }

    // ── mark the SESSION, and ONLY the session ──
    //
    // THE CRITICAL LINE. This writes to `booking_verification_sessions` and NOT to `booking_verified_phones`.
    //
    // The override lets THIS booking through. It grants NO trust window. The next booking on that number asks for
    // a code again — because otherwise one manipulated receptionist would hand an attacker a verified phone for
    // 24 hours, and the bypass would stop being a bypass and start being a key.
    // Note what this port CANNOT do: there is no method on it that marks a PHONE verified. The safeguard is not a
    // line of code someone could delete — it is an absence in the interface.
    // The customer's retry then claims it (label staff_override) for exactly ONE appointment, like any proof.
    const done = await this.store.markSessionOverridden(ctx.tenantId, ctx.branchId, input.verificationId, { userId: ctx.userId, reason, contactMethod: input.contactMethod });
    if (!done) throw new OverrideError('No booking is waiting for verification with that reference (it may have been verified, expired or completed).', 'not_found');

    // ── audited, attributably ──
    await this.audit?.record({
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      userId: ctx.userId,
      module: 'booking_verification',
      action: 'verification_manually_bypassed',
      summary: 'Phone verification manually bypassed',
      metadata: {
        verificationId: input.verificationId,
        reason,
        contactMethod: input.contactMethod,
        role: ctx.role,
      },
    }).catch(() => undefined);

    // The label goes ON THE APPOINTMENT. A bypassed booking that looks identical to a verified one is a bypass
    // that will be used routinely — by the technician who sees no difference, and by the manager reviewing
    // no-shows who cannot tell which bookings were never verified.
    return { ok: true, label: 'Phone verification manually bypassed' };
  }

  /** The verifications waiting for a code — what a manager may override. Same roles as the override itself. */
  async pending(ctx: OverrideCtx): Promise<OpenVerification[]> {
    if (isPlatformPrincipal(ctx) || !hasPermission({ ...ctx, branchId: ctx.branchId ?? '', permissions: [...(ctx.permissions ?? [])] } as any, PENDING_PERM)) throw new OverrideError('Only an owner or a manager can see bookings waiting for verification.', 'forbidden');
    return (await this.store.listOpen?.(ctx.tenantId, ctx.branchId)) ?? [];
  }
}
