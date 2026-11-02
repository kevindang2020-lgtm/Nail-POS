// booking-verification-oversight.service.ts — Super Admin oversight of Booking Phone Verification.
//
// ── The four levers, and what each one is FOR ───────────────────────────────────────────────────────────
//
//   emergencyDisable  GLOBAL kill switch. Verification stops platform-wide, and bookings CONTINUE.
//                     For when OUR verification layer is the thing that is broken. It must not take every
//                     tenant's booking offline with it — that would turn our outage into their outage.
//
//   requireForTenant  Forces verification ON at one tenant, and they cannot turn it off. For a salon that is
//                     being used as a fake-booking channel. The tenant UI must SAY SO ("Required by AI
//                     PowerSalon platform policy") rather than render a toggle that silently does nothing.
//
//   blockForTenant    Forbids the feature at one tenant. For a COMPROMISED Twilio integration: stop them
//                     sending, immediately, without waiting for them to notice.
//
//   moduleEnabled     The feature exists at all, platform-wide.
//
// ── The one that is easy to get backwards ──────────────────────────────────────────────────────────────
// `emergencyDisable` DISABLES VERIFICATION. It does not disable BOOKING. If it blocked bookings, the button
// intended to protect tenants from a verification outage would instead take every salon on the platform offline
// — the most destructive possible reading of "emergency disable". The policy resolver returns `disabled` (not
// `blocked`) for exactly this reason, and there is a test.
//
// ── What Super Admin must NOT be able to see ───────────────────────────────────────────────────────────
// Verification codes. Twilio auth tokens. Full customer phone numbers. None of them appear in this service, and
// none of them can: the codes are held by Twilio, the tokens are encrypted at rest and never decrypted here, and
// phones are stored hashed with only a mask for display.
// CROSS-TENANT BY DESIGN: Super Admin platform oversight — cross-tenant counts are the point.

import type { AuditSink } from '@aipowersalon/audit';
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';

export class OversightError extends Error {
  constructor(msg: string, readonly code: 'invalid' | 'not_found') { super(msg); }
}

import type { BookingVerificationPlatformPolicyView, BookingVerificationTenantRow, BookingVerificationHealthView } from '@aipowersalon/api-contracts';
export type PlatformPolicyView = BookingVerificationPlatformPolicyView;
export type TenantOversightRow = BookingVerificationTenantRow;
export type VerificationHealth = BookingVerificationHealthView;

export class BookingVerificationOversightService {
  constructor(
    private readonly db: AppDatabase | null,
    private readonly audit?: AuditSink,
  ) {}

  async platformPolicy(): Promise<PlatformPolicyView> {
    const off: PlatformPolicyView = { moduleEnabled: true, emergencyDisabled: false, reason: null, version: 0 };
    if (!this.db) return off;
    const r: any = await sql`
      SELECT module_enabled, emergency_disabled, reason, version
      FROM booking_verification_platform_policy WHERE tenant_id IS NULL LIMIT 1`
      .execute(this.db).catch(() => ({ rows: [] }));
    const row = r.rows?.[0];
    if (!row) return off;
    return {
      moduleEnabled: !!row.module_enabled,
      emergencyDisabled: !!row.emergency_disabled,
      reason: row.reason ?? null,
      version: Number(row.version ?? 0),
    };
  }

  /**
   * The GLOBAL kill switch.
   *
   * Requires a REASON. Not bureaucracy: this is the button someone reaches for at 3am during an incident, and the
   * next person to look at it needs to know whether it was a Twilio outage, an abuse wave, or a mistake — because
   * the difference decides whether they turn it back on.
   */
  async setEmergencyDisabled(actorUserId: string | undefined, disabled: boolean, reason: string): Promise<PlatformPolicyView> {
    if (!this.db) throw new OversightError('Unavailable.', 'invalid');
    const r = String(reason ?? '').trim();
    if (disabled && r.length < 8) {
      throw new OversightError('A reason is required to disable phone verification platform-wide.', 'invalid');
    }

    await sql`
      INSERT INTO booking_verification_platform_policy (tenant_id, emergency_disabled, reason, version, updated_by_user_id)
      VALUES (NULL, ${disabled}, ${disabled ? r : null}, 1, ${actorUserId ?? null})
      ON CONFLICT ((true)) WHERE tenant_id IS NULL DO UPDATE SET
        emergency_disabled = EXCLUDED.emergency_disabled,
        reason = EXCLUDED.reason,
        version = booking_verification_platform_policy.version + 1,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()`.execute(this.db);

    await this.audit?.record({
      module: 'booking_verification', action: disabled ? 'platform_emergency_disabled' : 'platform_emergency_cleared',
      userId: actorUserId, summary: disabled ? 'Booking phone verification disabled platform-wide' : 'Platform emergency disable cleared',
      metadata: { reason: disabled ? r : null },
    }).catch(() => undefined);

    return this.platformPolicy();
  }

  /**
   * Phase 4: the module itself, platform-wide (`module_enabled`). Off = the feature does not exist: no salon is asked to
   * verify, and no salon can turn it on (the settings refuse). A reason is required either way — turning it back on
   * starts asking every enabled salon's customers for codes again.
   */
  async setModuleEnabled(actorUserId: string | undefined, enabled: boolean, reason: string): Promise<PlatformPolicyView> {
    if (!this.db) throw new OversightError('Unavailable.', 'invalid');
    const r = String(reason ?? '').trim();
    if (r.length < 8) throw new OversightError('A reason is required to switch the booking verification module on or off.', 'invalid');
    await sql`
      INSERT INTO booking_verification_platform_policy (tenant_id, module_enabled, reason, version, updated_by_user_id)
      VALUES (NULL, ${enabled}, ${r}, 1, ${actorUserId ?? null})
      ON CONFLICT ((true)) WHERE tenant_id IS NULL DO UPDATE SET
        module_enabled = EXCLUDED.module_enabled, reason = EXCLUDED.reason,
        version = booking_verification_platform_policy.version + 1,
        updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = now()`.execute(this.db);
    await this.audit?.record({
      module: 'booking_verification', action: enabled ? 'platform_module_enabled' : 'platform_module_disabled',
      userId: actorUserId, summary: enabled ? 'Booking phone verification module enabled' : 'Booking phone verification module disabled', metadata: { reason: r },
    }).catch(() => undefined);
    return this.platformPolicy();
  }

  /**
   * Force verification ON at one tenant, or forbid it.
   *
   * `required` and `blocked` are mutually exclusive — a tenant cannot be simultaneously compelled to verify and
   * forbidden from verifying. Allowing both would make the policy resolver's outcome depend on the order its
   * rules happen to be written in, which is exactly the kind of accident that produces a booking system that
   * refuses everything.
   */
  async setTenantPolicy(
    actorUserId: string | undefined,
    tenantId: string,
    patch: { required?: boolean; blocked?: boolean; reason?: string; bypassBlocked?: boolean },
  ): Promise<void> {
    if (!this.db) throw new OversightError('Unavailable.', 'invalid');
    if (patch.required && patch.blocked) {
      throw new OversightError('A tenant cannot be both required to verify and blocked from verifying.', 'invalid');
    }
    const reason = String(patch.reason ?? '').trim();
    if ((patch.required || patch.blocked || patch.bypassBlocked) && reason.length < 8) {
      // These override a paying tenant's own configuration. The tenant will ask why, and "somebody clicked it"
      // is not an answer.
      throw new OversightError('A reason is required when overriding a tenant\u2019s verification policy.', 'invalid');
    }

    await sql`
      INSERT INTO booking_verification_platform_policy (tenant_id, required_for_tenant, blocked_for_tenant, bypass_blocked, reason, version, updated_by_user_id)
      VALUES (${tenantId}, ${!!patch.required}, ${!!patch.blocked}, ${!!patch.bypassBlocked}, ${reason || null}, 1, ${actorUserId ?? null})
      ON CONFLICT (tenant_id) WHERE tenant_id IS NOT NULL DO UPDATE SET
        required_for_tenant = EXCLUDED.required_for_tenant,
        blocked_for_tenant = EXCLUDED.blocked_for_tenant,
        -- Phase 4: its own switch — left as it was when the request does not mention it
        bypass_blocked = ${patch.bypassBlocked === undefined ? sql`booking_verification_platform_policy.bypass_blocked` : sql`EXCLUDED.bypass_blocked`},
        reason = EXCLUDED.reason,
        version = booking_verification_platform_policy.version + 1,
        updated_by_user_id = EXCLUDED.updated_by_user_id,
        updated_at = now()`.execute(this.db);

    await this.audit?.record({
      tenantId, userId: actorUserId, module: 'booking_verification', action: 'platform_tenant_policy_changed',
      summary: patch.blocked ? 'Verification BLOCKED for tenant' : patch.required ? 'Verification REQUIRED for tenant' : 'Tenant override cleared',
      metadata: { required: !!patch.required, blocked: !!patch.blocked, bypassBlocked: patch.bypassBlocked ?? null, reason: reason || null },
    }).catch(() => undefined);
  }

  /**
   * The oversight table.
   *
   * `effective` is computed here rather than left to the reader, because the precedence is not obvious and an
   * operator staring at four booleans will get it wrong under pressure. The most important row it surfaces is
   * `provider_not_ready`: a tenant who turned verification ON but whose Twilio is not usable is **refusing every
   * remote booking right now** — and they may not know.
   */
  async tenants(limit = 200): Promise<TenantOversightRow[]> {
    if (!this.db) return [];
    const platform = await this.platformPolicy();

    const r: any = await sql`
      SELECT
        t.id                                        AS tenant_id,
        t.display_name                              AS tenant_name,
        coalesce(s.enabled, false)                  AS enabled,
        coalesce(p.required_for_tenant, false)      AS required,
        coalesce(p.blocked_for_tenant, false)       AS blocked,
        coalesce(p.bypass_blocked, false)           AS bypass_blocked,
        (c.account_sid IS NOT NULL AND c.status = 'configured') AS provider_connected,
        (c.last_validated_at IS NOT NULL)           AS provider_validated
      FROM tenants t
      LEFT JOIN booking_verification_settings s        ON s.tenant_id = t.id AND s.branch_id IS NULL
      LEFT JOIN booking_verification_platform_policy p ON p.tenant_id = t.id
      LEFT JOIN tenant_messaging_credentials c         ON c.tenant_id = t.id AND c.provider = 'twilio' AND c.branch_id IS NULL
      ORDER BY t.display_name
      LIMIT ${limit}`.execute(this.db).catch(() => ({ rows: [] }));

    return (r.rows ?? []).map((row: any) => {
      const enabled = !!row.enabled;
      const required = !!row.required;
      const blocked = !!row.blocked;
      const connected = !!row.provider_connected;
      const validated = !!row.provider_validated;

      // Same precedence as the policy resolver. Duplicated ONLY as a label — the resolver remains the single
      // source of truth for what actually happens at booking time; this is a human-readable summary of it.
      let effective: TenantOversightRow['effective'];
      if (platform.emergencyDisabled || !platform.moduleEnabled) effective = 'platform_emergency';
      else if (blocked) effective = 'blocked_by_platform';
      else if (!enabled && !required) effective = 'disabled_by_tenant';
      else if (!connected || !validated) effective = 'provider_not_ready';
      else effective = 'active';

      return {
        tenantId: String(row.tenant_id),
        tenantName: row.tenant_name ?? null,
        enabled, requiredByPlatform: required, blockedByPlatform: blocked, bypassBlocked: !!row.bypass_blocked,
        providerConnected: connected, providerValidated: validated,
        effective,
      };
    });
  }

  /** Aggregate health. Counts only — never a phone number, never a code, never a credential. */
  async health(sinceHours = 24): Promise<VerificationHealth> {
    const empty: VerificationHealth = { sinceHours, requested: 0, codesSent: 0, verified: 0, overridden: 0, failed: 0, locked: 0, expired: 0, tenantsMisconfigured: 0 };
    if (!this.db) return empty;

    const r: any = await sql`
      SELECT
        count(*)::int                                                                   AS requested,
        coalesce(sum(CASE WHEN last_sent_at IS NOT NULL THEN resend_count + 1 ELSE 0 END), 0)::int AS codes_sent,
        count(*) FILTER (WHERE status = 'verified' AND override_at IS NULL)::int         AS verified,
        count(*) FILTER (WHERE override_at IS NOT NULL)::int                             AS overridden,
        count(*) FILTER (WHERE status = 'failed')::int                                   AS failed,
        count(*) FILTER (WHERE status = 'locked')::int                                   AS locked,
        count(*) FILTER (WHERE status = 'expired')::int                                  AS expired
      FROM booking_verification_sessions
      WHERE created_at > now() - (${sinceHours} || ' hours')::interval`
      .execute(this.db).catch(() => ({ rows: [] }));

    // The row that matters: verification ON, provider not usable. These tenants are refusing every remote booking
    // RIGHT NOW, and the first they will hear of it is a customer phoning to complain.
    const m: any = await sql`
      SELECT count(*)::int AS n
      FROM booking_verification_settings s
      LEFT JOIN tenant_messaging_credentials c
        ON c.tenant_id = s.tenant_id AND c.provider = 'twilio' AND c.branch_id IS NULL
      WHERE s.branch_id IS NULL
        AND s.enabled = true
        AND (c.account_sid IS NULL OR c.status <> 'configured' OR c.last_validated_at IS NULL)`
      .execute(this.db).catch(() => ({ rows: [] }));

    const row = r.rows?.[0] ?? {};
    return {
      sinceHours,
      requested: Number(row.requested ?? 0),
      codesSent: Number(row.codes_sent ?? 0),
      verified: Number(row.verified ?? 0),
      overridden: Number(row.overridden ?? 0),
      failed: Number(row.failed ?? 0),
      locked: Number(row.locked ?? 0),
      expired: Number(row.expired ?? 0),
      tenantsMisconfigured: Number(m.rows?.[0]?.n ?? 0),
    };
  }
}
