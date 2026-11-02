// booking-verification-settings.service.ts — the tenant's own Booking Phone Verification settings.
//
// ── The rule this file exists to enforce ────────────────────────────────────────────────────────────────
//
//     "A tenant cannot enable SMS phone verification unless a valid Twilio configuration is connected and
//      tested."
//
// That is not paperwork. A tenant who flips the switch with no working provider gets a verification system that
// REFUSES EVERY REMOTE BOOKING — because the policy resolver blocks (correctly) when verification is required
// and cannot be performed. Their online booking simply stops, and the cause is a toggle they were allowed to
// turn on.
//
// So `enabled: true` is refused unless the provider both EXISTS and has VALIDATED. "Configured" is not
// "working": somebody typing an account SID into a form proves nothing about whether Twilio will accept it.
//
// ── Versioning ─────────────────────────────────────────────────────────────────────────────────────────
// Every change bumps `version`, and the version is stamped onto each verification session. So when a tenant
// disputes a booking six months later — "why did it not ask for a code?" — the answer is a fact on the row, not
// an archaeology exercise.
import type { AuditSink } from '@aipowersalon/audit';
import type { TenantCredentialResolver } from './booking-verification-provider';
import { clampHoldSeconds } from './booking-hold-core';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

/**
 * The rows this service reads and writes. A PORT, not a raw db handle — the project's own convention, and the
 * reason this file has no SQL in it: the decisions here (may this be enabled? is the platform forcing it?) are
 * the part worth testing, and they should be testable without a database.
 */
export interface VerificationSettingsStore {
  settingsRow(tenantId: string, branchId: string | null): Promise<any | null>;
  upsert(row: Record<string, unknown>): Promise<void>;
  /** Has this tenant's Twilio ever actually VALIDATED? (`configured` is not `working`.) */
  providerValidated(tenantId: string, branchId: string): Promise<boolean>;
  platformPolicy(tenantId: string): Promise<{ requiredForTenant: boolean; blockedForTenant: boolean; emergencyDisabled: boolean; moduleEnabled?: boolean }>;
}

export class VerificationSettingsError extends Error {
  constructor(msg: string, readonly code: 'provider_required' | 'forbidden' | 'invalid') { super(msg); }
}

export interface VerificationSettingsView {
  enabled: boolean;
  channels: {
    online: boolean; customerApp: boolean; aiReceptionist: boolean;
    kiosk: boolean; frontDesk: boolean; walkIn: boolean;
  };
  verifyEveryBooking: boolean;
  reverifyAfterSeconds: number;
  reverifyOnGroupBooking: boolean;
  reverifyOnDeposit: boolean;
  reverifyOnHighValue: boolean;
  /** guide §9: the salon's high-value line in cents; null = not configured (the high-value rule never fires). */
  highValueThresholdCents: number | null;
  holdSeconds: number;
  version: number;

  /** Provider state — so the UI can explain WHY the switch is locked instead of just disabling it. */
  provider: {
    connected: boolean;
    validated: boolean;
    /** null when there is nothing to say; otherwise the exact reason the toggle cannot be turned on. */
    blockedReason: string | null;
  };

  /** Platform overrides. The UI shows these as text, not toggles — a toggle that silently does nothing is worse
   *  than no toggle at all. */
  platform: {
    requiredByPlatform: boolean;
    blockedByPlatform: boolean;
    emergencyDisabled: boolean;
    /** Phase 4: the platform has the module switched off (for everyone, or this salon). */
    moduleDisabled: boolean;
  };
}

const DEFAULTS = {
  enabled: false,
  channel_online: true, channel_customer_app: true, channel_ai_receptionist: true,
  channel_kiosk: false, channel_front_desk: false, channel_walk_in: false,
  verify_every_booking: false, reverify_after_seconds: 86_400,
  reverify_on_group_booking: true, reverify_on_deposit: true, reverify_on_high_value: true,
  hold_seconds: 600, version: 0, high_value_threshold_cents: null as number | null,
};

/** guide §9: a high-value line the salon typed — whole cents, $1..$100,000, or a clear refusal (never silently clamped). */
function highValueCents(v: unknown): number {
  const c = Number(v);
  if (!Number.isInteger(c) || c < 100 || c > 10_000_000) throw withCode(new VerificationSettingsError('The high-value amount must be between $1 and $100,000.', 'invalid'), 'VALIDATION_FAILED');
  return c;
}

export class BookingVerificationSettingsService {
  constructor(
    private readonly store: VerificationSettingsStore,
    private readonly creds: TenantCredentialResolver,
    private readonly audit?: AuditSink,
  ) {}

  async get(tenantId: string, branchId?: string | null): Promise<VerificationSettingsView> {
    const row = await this.row(tenantId, branchId ?? null);
    const provider = await this.providerState(tenantId, branchId ?? '');
    const platform = await this.platformState(tenantId);
    return this.view(row, provider, platform);
  }

  /**
   * Update the tenant's (or a branch's) settings.
   *
   * The ONLY field this method is strict about is `enabled`. Everything else is the tenant's business; turning
   * the feature ON with no working provider is the platform's business, because it breaks their bookings.
   */
  async patch(
    actorUserId: string | undefined,
    tenantId: string,
    branchId: string | null,
    patch: Partial<{
      enabled: boolean;
      channels: Partial<VerificationSettingsView['channels']>;
      verifyEveryBooking: boolean;
      reverifyAfterSeconds: number;
      reverifyOnGroupBooking: boolean;
      reverifyOnDeposit: boolean;
      reverifyOnHighValue: boolean;
      highValueThresholdCents: number | null;
      holdSeconds: number;
    }>,
  ): Promise<VerificationSettingsView> {
    const platform = await this.platformState(tenantId);

    // Super Admin has forced this on. The tenant may configure the DETAILS but may not switch it off — and the
    // UI is expected to say "Required by AI PowerSalon platform policy" rather than render a dead toggle.
    if (platform.requiredByPlatform && patch.enabled === false) {
      throw withCode(new VerificationSettingsError('Phone verification is required by AI PowerSalon platform policy and cannot be turned off.', 'forbidden'), 'PHONE_VERIFICATION_REQUIRED_BY_POLICY');
    }
    if (platform.blockedByPlatform && patch.enabled === true) {
      throw withCode(new VerificationSettingsError('Phone verification is unavailable for this business. Contact support.', 'forbidden'), 'PHONE_VERIFICATION_UNAVAILABLE');
    }
    // Phase 4 (audit): the settings accepted "enabled" while the platform had the module off — a switch that showed ON
    // and did nothing (the policy resolver answers `disabled` before it reads the tenant).
    if (platform.moduleDisabled && patch.enabled === true) {
      throw withCode(new VerificationSettingsError('Phone verification is not available on AI PowerSalon right now.', 'forbidden'), 'PHONE_VERIFICATION_UNAVAILABLE');
    }
    // Phase 4 (decided, audit bug 13 "dead toggles"): staff-created bookings (front desk, walk-in) are never verified —
    // the staff member is the check, and the POS calendar never consulted these switches, so turning one on was a
    // promise nothing kept. The in-salon kiosk makes NO bookings (check-in and walk-in only, the guest is standing in the
    // salon), so its switch had nothing to gate either. A kiosk "book a future time" flow, if one is ever added, must
    // admit through RemoteBookingAdmission with channel 'kiosk' (no trust carried from earlier proofs).
    if (patch.channels?.frontDesk === true || patch.channels?.walkIn === true || patch.channels?.kiosk === true) {
      throw withCode(new VerificationSettingsError('Bookings made in the salon (front desk, walk-in, kiosk check-in) are not phone-verified. Use the manager override for a remote booking that cannot receive a code.', 'invalid'), 'IN_SALON_NOT_VERIFIED');
    }

    // THE RULE. Enabling with no working provider hands the tenant a feature that refuses every remote booking.
    if (patch.enabled === true) {
      const p = await this.providerState(tenantId, branchId ?? '');
      if (!p.connected) {
        throw withCode(new VerificationSettingsError('Connect and verify your Twilio account before enabling Booking Phone Verification.', 'provider_required'), 'TWILIO_VERIFY_FIRST');
      }
      if (!p.validated) {
        // "Configured" is not "working". Somebody typed an account SID into a form; that proves nothing about
        // whether Twilio will accept it — and finding out at the first real customer is not acceptable.
        throw withCode(new VerificationSettingsError('Test your Twilio connection before enabling Booking Phone Verification.', 'provider_required'), 'TWILIO_VERIFY_FIRST');
      }
    }

    const current = await this.row(tenantId, branchId);
    const c = patch.channels ?? {};

    const next = {
      enabled: patch.enabled ?? current.enabled,
      channel_online: c.online ?? current.channel_online,
      channel_customer_app: c.customerApp ?? current.channel_customer_app,
      channel_ai_receptionist: c.aiReceptionist ?? current.channel_ai_receptionist,
      channel_kiosk: false,
      channel_front_desk: false,
      channel_walk_in: false,
      verify_every_booking: patch.verifyEveryBooking ?? current.verify_every_booking,
      // Clamped: a negative or absurd window is not a setting, it is a bug waiting to happen.
      reverify_after_seconds: Math.max(0, Math.min(90 * 24 * 3600, Number(patch.reverifyAfterSeconds ?? current.reverify_after_seconds) || 0)),
      reverify_on_group_booking: patch.reverifyOnGroupBooking ?? current.reverify_on_group_booking,
      reverify_on_deposit: patch.reverifyOnDeposit ?? current.reverify_on_deposit,
      reverify_on_high_value: patch.reverifyOnHighValue ?? current.reverify_on_high_value,
      // The PLATFORM clamps the hold, not the tenant: an hour-long hold is a denial-of-service on the salon's
      // own calendar, and it must not be reachable through a settings form.
      hold_seconds: clampHoldSeconds(patch.holdSeconds ?? current.hold_seconds),
      // guide §9: null clears it; otherwise whole cents between $1 and $100,000 (the column's CHECK says the same)
      high_value_threshold_cents: patch.highValueThresholdCents === undefined ? (current.high_value_threshold_cents ?? null)
        : patch.highValueThresholdCents === null ? null : highValueCents(patch.highValueThresholdCents),
    };

    // The version is BUMPED, never overwritten — it is stamped onto every verification session, so a booking
    // disputed six months from now can be explained from the row rather than from memory.
    await this.store.upsert({
      tenant_id: tenantId, branch_id: branchId, ...next,
      version: Number(current.version ?? 0) + 1,
      updated_by_user_id: actorUserId ?? null,
    });

    // Audited — turning verification on or off changes who can book this salon. The audit record carries the
    // decision, never a credential.
    await this.audit?.record({
      tenantId, branchId, userId: actorUserId,
      module: 'booking_verification', action: patch.enabled === undefined ? 'settings_changed' : (next.enabled ? 'verification_enabled' : 'verification_disabled'),
      summary: `Booking phone verification ${next.enabled ? 'enabled' : 'disabled'}`,
      metadata: { branchId, enabled: next.enabled, verifyEveryBooking: next.verify_every_booking, highValueThresholdCents: next.high_value_threshold_cents, changed: Object.keys(patch) },
    }).catch(() => undefined);

    return this.get(tenantId, branchId);
  }

  // ── internals ──
  private async row(tenantId: string, branchId: string | null): Promise<any> {
    return (await this.store.settingsRow(tenantId, branchId)) ?? { ...DEFAULTS };
  }

  private async providerState(tenantId: string, branchId: string): Promise<{ connected: boolean; validated: boolean; blockedReason: string | null }> {
    const r = await this.creds.resolve(tenantId, branchId);
    if (r.status !== 'configured') {
      return { connected: false, validated: false, blockedReason: 'Connect and verify your Twilio account before enabling Booking Phone Verification.' };
    }
    const validated = await this.store.providerValidated(tenantId, branchId);
    return {
      connected: true,
      validated,
      // A disabled toggle with no explanation is how a tenant ends up filing a support ticket.
      blockedReason: validated ? null : 'Test your Twilio connection before enabling Booking Phone Verification.',
    };
  }

  private async platformState(tenantId: string) {
    const p = await this.store.platformPolicy(tenantId);
    return {
      requiredByPlatform: !!p.requiredForTenant,
      blockedByPlatform: !!p.blockedForTenant,
      emergencyDisabled: !!p.emergencyDisabled,
      moduleDisabled: p.moduleEnabled === false,
    };
  }

  private view(r: any, provider: any, platform: any): VerificationSettingsView {
    return {
      enabled: !!r.enabled,
      channels: {
        online: !!r.channel_online, customerApp: !!r.channel_customer_app,
        aiReceptionist: !!r.channel_ai_receptionist, kiosk: !!r.channel_kiosk,
        frontDesk: !!r.channel_front_desk, walkIn: !!r.channel_walk_in,
      },
      verifyEveryBooking: !!r.verify_every_booking,
      reverifyAfterSeconds: Number(r.reverify_after_seconds ?? 0),
      reverifyOnGroupBooking: !!r.reverify_on_group_booking,
      reverifyOnDeposit: !!r.reverify_on_deposit,
      reverifyOnHighValue: !!r.reverify_on_high_value,
      highValueThresholdCents: r.high_value_threshold_cents == null ? null : Number(r.high_value_threshold_cents),
      holdSeconds: Number(r.hold_seconds ?? 600),
      version: Number(r.version ?? 0),
      provider,
      platform,
    };
  }
}
