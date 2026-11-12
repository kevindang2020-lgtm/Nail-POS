// booking-verification-policy.ts — the deterministic resolver for "must this booking verify a phone?".
//
// PURE. No DB, no Twilio, no clock of its own. Every input is passed in, so the decision is reproducible and
// testable, and the same function answers the question for the online booking page, the customer app, the AI
// receptionist, and the kiosk. One resolver, one answer — a second copy of this logic in a controller is how a
// channel quietly ends up enforcing a different policy from the one the tenant configured.
//
// ── Why the ORDER is the whole design ────────────────────────────────────────────────────────────────────
// The precedence below is not stylistic. Each rule can only ever make verification MORE likely, or refuse the
// booking — never less likely — until we reach the tenant's own configuration. That means a platform lock
// cannot be argued away by a tenant setting, and a tenant requirement cannot be argued away by a channel rule.
//
// It also means the one genuinely dangerous outcome is impossible to reach by accident: "verification is
// required, but the provider is broken, so let the booking through." That is silently turning the feature off
// during exactly the incident it exists for. When verification is required and no working provider resolves,
// this returns `provider_not_configured` / `provider_unavailable` — which BLOCKS the remote booking. It never
// downgrades to `not_required`.
//
// ── Reuse ────────────────────────────────────────────────────────────────────────────────────────────────
// This resolves POLICY only. The OTP mechanics it leads to already exist and are not reimplemented:
// `customer-activation-core` owns normalization, masking, secure generation, hashed storage, expiry, attempt
// limits, resend cooldown and enumeration-safety; `tenant-messaging-credentials` owns the tenant's encrypted
// Twilio credentials.

/** Every remote channel a booking can arrive through. Front-desk and walk-in are NOT remote. */
export type BookingChannel =
  | 'online'            // public booking website / tenant-branded page
  | 'customer_app'      // iOS / Android
  | 'ai_receptionist'   // phone or chat
  | 'kiosk'
  | 'front_desk'        // staff-created
  | 'walk_in';

export const REMOTE_CHANNELS: BookingChannel[] = ['online', 'customer_app', 'ai_receptionist', 'kiosk'];
export const isRemote = (c: BookingChannel) => REMOTE_CHANNELS.includes(c);

export type PolicyDecision =
  | 'required'
  | 'not_required'
  | 'disabled'
  | 'blocked_by_platform'
  | 'provider_not_configured'
  | 'provider_unavailable'
  | 'recent_verification_accepted'
  | 'high_risk_reverification_required';

/** A decision the caller can act on without re-deriving anything. */
export interface PolicyResult {
  decision: PolicyDecision;
  /** True when the booking MUST NOT be finalized until a phone is verified. */
  mustVerify: boolean;
  /** True when the booking must be REFUSED outright (required, but we cannot verify). */
  blocked: boolean;
  /** Machine-readable cause. Safe to log and to return to a client. */
  reason: string;
  /** Human text for the tenant/customer. Never leaks configuration or provider internals. */
  message: string;
  /** Versions, so a decision can be explained after the fact when a tenant disputes a booking. */
  versions: {
    policy: string;
    platform: number | null;
    tenant: number | null;
    branch: number | null;
    provider: number | null;
  };
}

export const POLICY_VERSION = 'bpv-1';

// ── inputs ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PlatformPolicy {
  /** Super Admin kill switch. Beats everything, including a tenant that requires verification. */
  emergencyDisabled: boolean;
  /** Module available platform-wide at all. */
  moduleEnabled: boolean;
  /** Super Admin forces verification for this tenant; the tenant cannot turn it off. */
  requiredForTenant: boolean;
  /** Super Admin forbids this tenant from using it (e.g. compromised integration). */
  blockedForTenant: boolean;
  version: number | null;
}

export interface TenantPolicy {
  enabled: boolean;
  /** Per-channel switches. A channel absent from this map is treated as NOT enabled. */
  channels: Partial<Record<BookingChannel, boolean>>;
  /** Ignore any prior verification and verify every single booking. */
  verifyEveryBooking: boolean;
  /** How long a previous successful verification is trusted, for THIS tenant. 0 = never trust. */
  reverifyAfterSeconds: number;
  /** Force re-verification regardless of history. */
  reverifyOnGroupBooking: boolean;
  reverifyOnDeposit: boolean;
  reverifyOnHighValue: boolean;
  version: number | null;
}

/** A branch may override the tenant. `null` on a field = inherit. */
export interface BranchPolicy {
  enabled: boolean | null;
  channels: Partial<Record<BookingChannel, boolean>> | null;
  /** Phase 4 (found by the live proof): a branch's own re-verification rules. The settings screen writes them on a branch
   *  row, and the resolver used to read only the tenant's — so "verify every booking" at a branch did nothing.
   *  Absent / null = inherit the tenant. */
  verifyEveryBooking?: boolean | null;
  reverifyAfterSeconds?: number | null;
  reverifyOnGroupBooking?: boolean | null;
  reverifyOnDeposit?: boolean | null;
  reverifyOnHighValue?: boolean | null;
  version: number | null;
}

export interface ProviderStatus {
  /** A tenant-owned (or branch-owned) Twilio configuration exists and is complete. */
  configured: boolean;
  /** It last validated successfully. */
  healthy: boolean;
  version: number | null;
}

/** What we know about this phone's verification history FOR THIS TENANT. Never cross-tenant. */
export interface VerificationHistory {
  /** Epoch ms of the last successful verification of THIS phone for THIS tenant, or null. */
  lastVerifiedAt: number | null;
  /** True when the phone on this booking differs from the one that was verified. */
  phoneChanged: boolean;
}

export interface BookingRisk {
  isGroupBooking: boolean;
  requiresDeposit: boolean;
  isHighValue: boolean;
  /** Fraud/velocity signal from the abuse layer. */
  highRisk: boolean;
}

export interface PolicyInput {
  channel: BookingChannel;
  platform: PlatformPolicy;
  tenant: TenantPolicy;
  branch?: BranchPolicy | null;
  provider: ProviderStatus;
  history?: VerificationHistory | null;
  risk?: BookingRisk | null;
  now?: number;
}

/** What a salon that never saved settings gets: verification OFF. */
export const DEFAULT_SALON_POLICY: TenantPolicy = {
  enabled: false,                                  // OFF until a tenant turns it on. Shipping this code must not
                                                   // start refusing bookings at tenants who never asked for it.
  channels: {}, verifyEveryBooking: false, reverifyAfterSeconds: 86_400,
  reverifyOnGroupBooking: true, reverifyOnDeposit: true, reverifyOnHighValue: true, version: null,
};

// ── inheritance (ONE rule, used by the resolver AND by the configuration comparison below) ───────────────
/** A branch value wins where the branch row has one; `null` / absent inherits the salon's. */
export function inheritedRules(t: TenantPolicy, b: BranchPolicy | null | undefined) {
  return {
    verifyEveryBooking: b?.verifyEveryBooking ?? t.verifyEveryBooking,
    reverifyAfterSeconds: b?.reverifyAfterSeconds ?? t.reverifyAfterSeconds,
    reverifyOnGroupBooking: b?.reverifyOnGroupBooking ?? t.reverifyOnGroupBooking,
    reverifyOnDeposit: b?.reverifyOnDeposit ?? t.reverifyOnDeposit,
    reverifyOnHighValue: b?.reverifyOnHighValue ?? t.reverifyOnHighValue,
  };
}
export const inheritedEnabled = (t: TenantPolicy, b: BranchPolicy | null | undefined): boolean => (b?.enabled ?? null) ?? t.enabled;
export const inheritedChannels = (t: TenantPolicy, b: BranchPolicy | null | undefined) => b?.channels ?? t.channels;

/** Row → policy (booking_verification_settings), shared by the resolver's config reader and the settings screen. A NULL on a
 *  branch row means INHERIT — `?? null`, never `!!`, or "no opinion" would read as "disabled". */
export function tenantPolicyFromRow(r: Record<string, unknown>): TenantPolicy {
  return {
    enabled: !!r.enabled,
    channels: { online: !!r.channel_online, customer_app: !!r.channel_customer_app, ai_receptionist: !!r.channel_ai_receptionist, kiosk: !!r.channel_kiosk, front_desk: !!r.channel_front_desk, walk_in: !!r.channel_walk_in },
    verifyEveryBooking: !!r.verify_every_booking, reverifyAfterSeconds: Number(r.reverify_after_seconds ?? 0),
    reverifyOnGroupBooking: !!r.reverify_on_group_booking, reverifyOnDeposit: !!r.reverify_on_deposit, reverifyOnHighValue: !!r.reverify_on_high_value,
    version: r.version == null ? null : Number(r.version),
  };
}
export function branchPolicyFromRow(r: Record<string, unknown>): BranchPolicy {
  const b = (v: unknown) => (v == null ? null : !!v);
  return {
    enabled: b(r.enabled),
    channels: { online: !!r.channel_online, customer_app: !!r.channel_customer_app, ai_receptionist: !!r.channel_ai_receptionist, kiosk: !!r.channel_kiosk, front_desk: !!r.channel_front_desk, walk_in: !!r.channel_walk_in },
    verifyEveryBooking: b(r.verify_every_booking), reverifyAfterSeconds: r.reverify_after_seconds == null ? null : Number(r.reverify_after_seconds),
    reverifyOnGroupBooking: b(r.reverify_on_group_booking), reverifyOnDeposit: b(r.reverify_on_deposit), reverifyOnHighValue: b(r.reverify_on_high_value),
    version: r.version == null ? null : Number(r.version),
  };
}

/** Extras (Booking Phone Verification 11 "Tenant Configuration Comparison"): for one location, each setting's salon value,
 *  the location's own value (null = inherits), the EFFECTIVE value the resolver uses and where it comes from — the platform
 *  (Super Admin required / blocked / switched off), the location's row, the salon's row, or the built-in default (no salon
 *  row yet). Same inheritance functions as resolveBookingVerificationPolicy, so the screen can never disagree with it. */
export type ConfigSource = 'platform' | 'branch' | 'salon' | 'default';
export const COMPARED_FIELDS = ['enabled', 'channel.online', 'channel.customer_app', 'channel.ai_receptionist', 'verifyEveryBooking', 'reverifyAfterSeconds', 'reverifyOnGroupBooking', 'reverifyOnDeposit', 'reverifyOnHighValue'] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];
export interface ConfigComparisonRow { field: ComparedField; salon: boolean | number; branch: boolean | number | null; effective: boolean | number; source: ConfigSource }
export function branchConfigComparison(platform: PlatformPolicy, salon: TenantPolicy | null, salonDefault: TenantPolicy, branch: BranchPolicy | null) {
  const t = salon ?? salonDefault;
  const base: ConfigSource = salon ? 'salon' : 'default';
  const rules = inheritedRules(t, branch); const ch = inheritedChannels(t, branch);
  const platformOff = platform.emergencyDisabled || !platform.moduleEnabled || platform.blockedForTenant;
  const rows: ConfigComparisonRow[] = [];
  const add = (field: ComparedField, sv: boolean | number, bv: boolean | number | null | undefined, ev: boolean | number, forced: ConfigSource | null = null) =>
    rows.push({ field, salon: sv, branch: bv ?? null, effective: ev, source: forced ?? (bv != null ? 'branch' : base) });
  add('enabled', t.enabled, branch?.enabled, platformOff ? false : platform.requiredForTenant ? true : inheritedEnabled(t, branch), platformOff || platform.requiredForTenant ? 'platform' : null);
  for (const c of ['online', 'customer_app', 'ai_receptionist'] as const) add(('channel.' + c) as ComparedField, t.channels[c] === true, branch?.channels ? branch.channels[c] === true : null, ch?.[c] === true);
  add('verifyEveryBooking', t.verifyEveryBooking, branch?.verifyEveryBooking, rules.verifyEveryBooking);
  add('reverifyAfterSeconds', t.reverifyAfterSeconds, branch?.reverifyAfterSeconds, rules.reverifyAfterSeconds);
  add('reverifyOnGroupBooking', t.reverifyOnGroupBooking, branch?.reverifyOnGroupBooking, rules.reverifyOnGroupBooking);
  add('reverifyOnDeposit', t.reverifyOnDeposit, branch?.reverifyOnDeposit, rules.reverifyOnDeposit);
  add('reverifyOnHighValue', t.reverifyOnHighValue, branch?.reverifyOnHighValue, rules.reverifyOnHighValue);
  return {
    branchHasOwnSettings: !!branch, salonHasSettings: !!salon,
    platform: { emergencyDisabled: platform.emergencyDisabled, moduleDisabled: !platform.moduleEnabled, blockedForTenant: platform.blockedForTenant, requiredForTenant: platform.requiredForTenant },
    rows,
  };
}

// ── the resolver ─────────────────────────────────────────────────────────────────────────────────────────

const result = (
  decision: PolicyDecision,
  reason: string,
  message: string,
  i: PolicyInput,
  over: Partial<PolicyResult> = {},
): PolicyResult => ({
  decision,
  mustVerify: decision === 'required' || decision === 'high_risk_reverification_required',
  blocked: decision === 'blocked_by_platform' || decision === 'provider_not_configured' || decision === 'provider_unavailable',
  reason,
  message,
  versions: {
    policy: POLICY_VERSION,
    platform: i.platform.version ?? null,
    tenant: i.tenant.version ?? null,
    branch: i.branch?.version ?? null,
    provider: i.provider.version ?? null,
  },
  ...over,
});

export function resolveBookingVerificationPolicy(input: PolicyInput): PolicyResult {
  const now = input.now ?? Date.now();
  // The branch's own re-verification rules, where it has them (null = inherit the tenant's).
  const b = input.branch;
  const i: PolicyInput = !b ? input : { ...input, tenant: { ...input.tenant, ...inheritedRules(input.tenant, b) } };

  // 1. PLATFORM EMERGENCY DISABLE — beats everything, including a tenant that requires verification, because it
  //    exists for the case where verification itself is the thing that is broken. It does NOT block the booking:
  //    an outage in our verification layer must not take every tenant's bookings offline with it.
  if (i.platform.emergencyDisabled) {
    return result('disabled', 'platform_emergency_disabled', 'Temporarily disabled by platform operations.', i);
  }
  if (!i.platform.moduleEnabled) {
    return result('disabled', 'platform_module_disabled', 'Phone verification is not available.', i);
  }

  // 2. SUPER ADMIN, per tenant. `blocked` refuses the tenant the feature (e.g. a compromised integration);
  //    `required` forces it on and the tenant cannot turn it off.
  if (i.platform.blockedForTenant) {
    return result('blocked_by_platform', 'platform_blocked_tenant', 'Phone verification is unavailable for this business. Contact support.', i);
  }
  const platformRequires = i.platform.requiredForTenant;

  // 3. TENANT + BRANCH. A branch may override the tenant; `null` inherits. Neither can switch OFF something the
  //    platform requires — that is the entire point of `requiredForTenant`.
  const enabled = inheritedEnabled(i.tenant, i.branch);
  if (!enabled && !platformRequires) {
    return result('disabled', 'tenant_disabled', 'Phone verification is off for this business.', i);
  }

  // 4. CHANNEL. Front-desk and walk-in are staff-created and are NOT verified unless the tenant explicitly opts
  //    in — the spec is explicit, and OTP-ing a customer standing at the counter is theatre, not security.
  const channels = inheritedChannels(i.tenant, i.branch);
  const channelOn = channels?.[i.channel] === true;
  if (!channelOn && !platformRequires) {
    return result('not_required', `channel_not_enabled:${i.channel}`, 'Verification is not required for this booking.', i);
  }
  // A platform requirement still only reaches REMOTE channels. Forcing an OTP on a walk-in would break the
  // front desk for a policy aimed at remote booking abuse.
  if (!isRemote(i.channel)) {
    if (!channelOn) return result('not_required', `channel_not_remote:${i.channel}`, 'Verification is not required for this booking.', i);
  }

  // 5. PROVIDER. Checked BEFORE we let history excuse the booking — because if we are going to require
  //    verification, we must be able to actually perform it.
  //
  //    This is the branch that must never soften. "Verification is required, the provider is down, so let it
  //    through" turns the feature off during precisely the incident it exists for. It BLOCKS.
  if (!i.provider.configured) {
    return result('provider_not_configured', 'provider_not_configured',
      'Online booking is temporarily unavailable. Please call the salon to book.', i);
  }
  if (!i.provider.healthy) {
    return result('provider_unavailable', 'provider_unavailable',
      'We could not send a verification code right now. Please try again shortly, or call the salon.', i);
  }

  // 6. RISK. Overrides any trusted history — a high-value, deposit, group, or flagged booking re-verifies even
  //    if this phone verified five minutes ago. This is where a compromised-but-verified session gets caught.
  const risk = i.risk;
  if (risk) {
    if (risk.highRisk) return result('high_risk_reverification_required', 'risk_flagged', 'Please verify your phone number to continue.', i);
    if (risk.isGroupBooking && i.tenant.reverifyOnGroupBooking) return result('high_risk_reverification_required', 'risk_group_booking', 'Please verify your phone number to continue.', i);
    if (risk.requiresDeposit && i.tenant.reverifyOnDeposit) return result('high_risk_reverification_required', 'risk_deposit', 'Please verify your phone number to continue.', i);
    if (risk.isHighValue && i.tenant.reverifyOnHighValue) return result('high_risk_reverification_required', 'risk_high_value', 'Please verify your phone number to continue.', i);
  }

  // 7. HISTORY. Only now may a previous verification excuse this one.
  //
  //    A CHANGED PHONE always re-verifies. Trusting history after the number changed would let an attacker
  //    verify their own phone once and then book against anyone's number — which is the exact fraud this module
  //    exists to stop, reintroduced through the trust window.
  if (i.tenant.verifyEveryBooking) {
    return result('required', 'tenant_verify_every_booking', 'Please verify your phone number to continue.', i);
  }
  const h = i.history;
  if (h?.phoneChanged) {
    return result('required', 'phone_changed', 'Please verify your new phone number to continue.', i);
  }
  if (h?.lastVerifiedAt != null && i.tenant.reverifyAfterSeconds > 0) {
    const ageSeconds = (now - h.lastVerifiedAt) / 1000;
    // A verification from the FUTURE is a clock problem or a tampered row. It is not a reason to trust.
    if (ageSeconds >= 0 && ageSeconds < i.tenant.reverifyAfterSeconds) {
      return result('recent_verification_accepted', 'recent_verification', 'Your phone number is already verified.', i);
    }
  }

  // 8. Default for a remote channel the tenant enabled: VERIFY.
  return result('required', 'tenant_requires_verification', 'Please verify your phone number to continue.', i);
}
