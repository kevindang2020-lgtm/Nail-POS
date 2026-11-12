// booking-verification.kysely.ts — the Postgres bindings for booking phone verification.
//
// Everything here is an EDGE: the decisions live in the pure modules (`booking-verification-policy`,
// `booking-hold-core`, `customer-activation-core`). These classes only fetch and persist.
//
// Two properties are enforced here and nowhere else, because only the query can enforce them:
//
//   1. TENANT SCOPE. Every statement carries `tenant_id`. A verification proven at one salon can never satisfy a
//      booking at another, and the `UNIQUE (tenant_id, phone_hash)` on booking_verified_phones means that is
//      structurally true, not merely conventional.
//   2. FAIL-CLOSED CREDENTIALS. No tenant Twilio → `not_configured`. Never the platform's shared account. See
//      the long note in booking-verification-provider.ts for why that fallback would have been a real bug.
import { sql } from 'kysely';
import { platformSendsLastHour, staleVerificationIds } from './booking-verification-platform.kysely';
import { canMoveToSql, assertTransition, type AppDatabase } from '@aipowersalon/database';
import { BOOKING_HOLD, BOOKING_VERIFICATION_SESSION } from './booking-hold-machine';
import type { ProviderSecrets } from '@aipowersalon/security';   // provider credentials open through the PROVIDER_SECRETS port (Constitution 13 §94)
import type { VerificationStore, SessionStatus } from './booking-verification.service';
import type { ProofStore, VerificationLabel } from './booking-verification-flow';
import { createDomainEvent, type OutboxWriter } from '@aipowersalon/events';
import type { CredentialResolution, TenantCredentialResolver } from './booking-verification-provider';
import type { BookingVerificationConfigPort } from './booking-verification-guard';
import type { PlatformPolicy, TenantPolicy, BranchPolicy, ProviderStatus } from './booking-verification-policy';
import { tenantPolicyFromRow, branchPolicyFromRow, DEFAULT_SALON_POLICY } from './booking-verification-policy';

const ms = (t: any): number => (t instanceof Date ? t.getTime() : t ? new Date(t).getTime() : 0);

// ── credentials ─────────────────────────────────────────────────────────────────────────────────────────
export class KyselyTenantCredentialResolver implements TenantCredentialResolver {
  constructor(private readonly db: AppDatabase | null, private readonly secrets: ProviderSecrets) {}

  async resolve(tenantId: string, branchId: string): Promise<CredentialResolution> {
    if (!this.db) return { status: 'not_configured', reason: 'no_database' };

    // Branch row FIRST, then the tenant-wide default. `ORDER BY branch_id NULLS LAST` puts the branch-specific
    // row ahead of the default — so a branch that has its own Twilio uses it, and one that does not inherits.
    // A branch NEVER picks up an unrelated branch's configuration: the WHERE clause only ever admits its own
    // row or the tenant's default.
    const res: any = await sql`
      SELECT account_sid, auth_token_enc, from_number, verify_service_sid, api_key_sid, api_key_secret_enc, status, last_validated_at
      FROM tenant_messaging_credentials
      WHERE tenant_id = ${tenantId}
        AND provider = 'twilio'
        AND (branch_id = ${branchId || null} OR branch_id IS NULL)
      ORDER BY branch_id NULLS LAST
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));

    const r = res.rows?.[0];
    if (!r?.account_sid || !r?.auth_token_enc || r.status !== 'configured') {
      return { status: 'not_configured', reason: 'no_tenant_twilio' };
    }

    let authToken: string;
    let apiKeySecret: string | null = null;
    try {
      authToken = this.secrets.decrypt(r.auth_token_enc);
      if (r.api_key_sid && r.api_key_secret_enc) apiKeySecret = this.secrets.decrypt(r.api_key_secret_enc);
    } catch {
      // A credential we cannot decrypt is a credential we do not have. Failing closed here — rather than
      // reaching for the platform account — is the whole point: the alternative silently bills us for a tenant's
      // verification traffic and sends the code from a number the customer has never seen from that salon.
      return { status: 'not_configured', reason: 'credential_decrypt_failed' };
    }

    const credentials = {
      accountSid: String(r.account_sid),
      authToken,
      verifyServiceSid: r.verify_service_sid ? String(r.verify_service_sid) : null,
      fromNumber: r.from_number ? String(r.from_number) : null,
      // Phase 4: a salon may sign Verify calls with an API key instead of its account auth token.
      apiKeySid: r.api_key_sid && apiKeySecret ? String(r.api_key_sid) : null,
      apiKeySecret,
    };

    // Verify is preferred, but it needs the tenant's own Verify Service. Without one we fall back to the
    // internal hashed-OTP path, which needs a sending number instead. With NEITHER, this tenant cannot send a
    // code at all — and must not be allowed to believe otherwise.
    if (credentials.verifyServiceSid) return { status: 'configured', credentials, kind: 'twilio_verify' };
    if (credentials.fromNumber) return { status: 'configured', credentials, kind: 'internal_otp' };
    return { status: 'not_configured', reason: 'no_verify_service_and_no_sender' };
  }
}

// ── policy config ───────────────────────────────────────────────────────────────────────────────────────
const DEFAULT_TENANT: TenantPolicy = DEFAULT_SALON_POLICY;   // OFF until a tenant turns it on (booking-verification-policy.ts)

export class KyselyBookingVerificationConfig implements BookingVerificationConfigPort {
  constructor(private readonly db: AppDatabase | null, private readonly resolver: TenantCredentialResolver) {}

  async platform(tenantId: string): Promise<PlatformPolicy> {
    const off: PlatformPolicy = { emergencyDisabled: false, moduleEnabled: true, requiredForTenant: false, blockedForTenant: false, version: null };
    if (!this.db) return off;
    const res: any = await sql`
      SELECT tenant_id, module_enabled, emergency_disabled, required_for_tenant, blocked_for_tenant, version
      FROM booking_verification_platform_policy
      WHERE tenant_id = ${tenantId} OR tenant_id IS NULL`.execute(this.db).catch(() => ({ rows: [] }));

    const rows: any[] = res.rows ?? [];
    const global = rows.find((r) => r.tenant_id == null);
    const mine = rows.find((r) => r.tenant_id != null);

    return {
      // The GLOBAL emergency switch and the GLOBAL module switch are Super Admin's, and a per-tenant row can
      // never turn them back on. A kill switch a tenant can override is not a kill switch.
      emergencyDisabled: !!global?.emergency_disabled,
      moduleEnabled: global ? !!global.module_enabled : true,
      requiredForTenant: !!mine?.required_for_tenant,
      blockedForTenant: !!mine?.blocked_for_tenant,
      version: mine?.version ?? global?.version ?? null,
    };
  }

  async tenant(tenantId: string): Promise<TenantPolicy> {
    if (!this.db) return DEFAULT_TENANT;
    const res: any = await sql`
      SELECT * FROM booking_verification_settings
      WHERE tenant_id = ${tenantId} AND branch_id IS NULL LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const r = res.rows?.[0];
    if (!r) return DEFAULT_TENANT;                  // never configured → the feature is off for this tenant
    return tenantPolicyFromRow(r);
  }

  async branch(tenantId: string, branchId: string): Promise<BranchPolicy | null> {
    if (!this.db || !branchId) return null;
    const res: any = await sql`
      SELECT * FROM booking_verification_settings
      WHERE tenant_id = ${tenantId} AND branch_id = ${branchId} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const r = res.rows?.[0];
    if (!r) return null;                            // no branch row → inherit the tenant
    // NULL on a branch row means INHERIT (branchPolicyFromRow keeps it null); Phase 4: the branch's own re-verification
    // rules are read too (the settings service writes them on the branch row)
    return branchPolicyFromRow(r);
  }

  async provider(tenantId: string, branchId: string): Promise<ProviderStatus> {
    const r = await this.resolver.resolve(tenantId, branchId);
    if (r.status !== 'configured') return { configured: false, healthy: false, version: null };

    // "configured" only means somebody typed credentials in. HEALTHY means they have actually worked. Treating
    // an unvalidated configuration as healthy would send codes into the void and tell the customer to wait for
    // one that is never coming — so an unvalidated provider blocks the booking instead, which is honest.
    let healthy = false;
    if (this.db) {
      const res: any = await sql`
        SELECT last_validated_at FROM tenant_messaging_credentials
        WHERE tenant_id = ${tenantId} AND provider = 'twilio'
          AND (branch_id = ${branchId || null} OR branch_id IS NULL)
        ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
      healthy = !!res.rows?.[0]?.last_validated_at;
    }
    return { configured: true, healthy, version: null };
  }

  async lastVerified(tenantId: string, phoneHash: string): Promise<{ verifiedAt: number; revoked?: boolean } | null> {
    if (!this.db) return null;
    // TENANT-SCOPED. This is the query that would leak cross-tenant trust if it ever dropped its tenant_id — so
    // the table also carries UNIQUE (tenant_id, phone_hash), and the two guard each other.
    const res: any = await sql`
      SELECT verified_at, revoked_at FROM booking_verified_phones
      WHERE tenant_id = ${tenantId} AND phone_hash = ${phoneHash}
      ORDER BY verified_at DESC LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const r = res.rows?.[0];
    // Phase 3 (audit E7): a number retired from a customer has its verification REVOKED — it is reported, so the
    // policy treats the phone as changed (always re-verify), never as recently verified.
    return r?.verified_at ? { verifiedAt: ms(r.verified_at), revoked: r.revoked_at != null } : null;
  }

  async lastVerifiedOnDevice(tenantId: string, phoneHash: string, deviceId: string): Promise<number | null> {
    if (!this.db || !deviceId) return null;
    // An SMS proof from THIS device (a manager's override is never trust).
    const res: any = await sql`
      SELECT max(verified_at) AS at FROM booking_verification_sessions
      WHERE tenant_id = ${tenantId} AND phone_hash = ${phoneHash} AND device_id = ${deviceId.slice(0, 200)}
        AND status = 'verified' AND override_at IS NULL`.execute(this.db).catch(() => ({ rows: [] }));
    return res.rows?.[0]?.at ? ms(res.rows[0].at) : null;
  }
}

// ── verification sessions ───────────────────────────────────────────────────────────────────────────────
//
// One row per booking session (UNIQUE-ish by (tenant, booking_session_id); the latest row wins). Lifecycle:
//   pending  — opened when a booking was refused for verification (the slot is held, staff can see and override it)
//   sent     — a code went out (Twilio Verify holds it; the internal fallback keeps its HASH in code_hash)
//   verified — the code was right (a manager's override sets override_* and verified_at, never the phone trust row)
//   locked   — the attempts ran out; the hold is released
//   expired  — the deadline passed unproven; the hold is released (the expiry sweep)
// and, separately, consumed_at / consumed_appointment_id: the ONE appointment the proof produced.
export type VerificationEventType =
  | 'booking.phone_verification_requested' | 'booking.phone_verification_sent' | 'booking.phone_verified'
  | 'booking.phone_verification_failed' | 'booking.phone_verification_expired' | 'booking.phone_verification_overridden';

export class KyselyVerificationStore implements VerificationStore, ProofStore {
  constructor(private readonly db: AppDatabase, private readonly outbox?: OutboxWriter) {}

  /** A booking.phone_* fact, on the outbox in the same transaction as the change (no number, no code). */
  private async emit(trx: any, type: VerificationEventType, row: { tenant_id: string; branch_id?: string | null; id: string; channel?: string; phone_mask?: string; booking_session_id?: string }, extra: Record<string, unknown> = {}): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({
      eventType: type, tenantId: String(row.tenant_id), branchId: row.branch_id ? String(row.branch_id) : undefined,
      aggregateType: 'booking_verification', aggregateId: String(row.id), actorType: 'system',
      payload: { sessionId: String(row.id), channel: row.channel ?? null, maskedPhone: row.phone_mask ?? null, ...extra },
    }));
  }

  /** Run `fn` in one transaction; when it RETURNs a row, emit `type` about it in the same transaction. */
  private async tx<T extends Record<string, any> | null>(fn: (trx: any) => Promise<T>, type?: VerificationEventType, extra?: (r: NonNullable<T>) => Record<string, unknown>): Promise<T> {
    return (this.db as any).transaction().execute(async (trx: any) => {
      const r = await fn(trx);
      if (r && type) await this.emit(trx, type, r as any, extra ? extra(r as any) : {});
      return r;
    });
  }

  async findSession(tenantId: string, bookingSessionId: string) {
    const res: any = await sql`
      SELECT id, phone_hash, attempt_count, resend_count, expires_at, last_sent_at, verified_at,
             provider, provider_verification_sid, status, code_hash, booking_hold_id, branch_id
      FROM booking_verification_sessions
      WHERE tenant_id = ${tenantId} AND booking_session_id = ${bookingSessionId}
      ORDER BY created_at DESC LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    const r = res.rows?.[0];
    if (!r) return null;
    return {
      id: String(r.id),
      phoneHash: String(r.phone_hash),
      // Twilio Verify keeps its codes (NULL here); the internal fallback keeps only the hash.
      codeHash: r.code_hash ? String(r.code_hash) : null,
      attempts: Number(r.attempt_count ?? 0),
      resendCount: Number(r.resend_count ?? 0),
      expiresAt: ms(r.expires_at),
      lastSentAt: r.last_sent_at ? ms(r.last_sent_at) : null,
      consumed: r.status === 'verified' || !!r.verified_at,
      providerVerificationSid: r.provider_verification_sid ?? null,
      provider: String(r.provider ?? 'internal_otp'),
      status: String(r.status) as SessionStatus,
      branchId: r.branch_id ? String(r.branch_id) : null,
    };
  }

  async createSession(i: {
    tenantId: string; branchId: string; bookingSessionId: string; customerId: string | null;
    phoneHash: string; phoneMask: string; channel: string; provider: string;
    providerServiceSid: string | null; providerVerificationSid: string | null;
    codeHash: string | null; expiresAt: number;
    requestIp?: string | null; deviceId?: string | null;
  }): Promise<{ id: string }> {
    // Created BEFORE the provider is called (Phase 4, audit bug 11): a billed code must always have its session.
    // request_ip / device_id are what the fraud engine counts.
    const r = await this.tx(async (trx) => (await sql`
      INSERT INTO booking_verification_sessions
        (tenant_id, branch_id, booking_session_id, customer_id, phone_hash, phone_mask, channel,
         provider, provider_service_sid, provider_verification_sid, status, expires_at, request_ip, device_id, code_hash)
      VALUES
        (${i.tenantId}, ${i.branchId}, ${i.bookingSessionId}, ${i.customerId}, ${i.phoneHash}, ${i.phoneMask}, ${i.channel},
         ${i.provider}, ${i.providerServiceSid}, ${i.providerVerificationSid}, 'pending', to_timestamp(${i.expiresAt} / 1000.0),
         ${i.requestIp ?? null}, ${i.deviceId ?? null}, ${i.codeHash})
      RETURNING id, tenant_id, branch_id, channel, phone_mask`.execute(trx)).rows?.[0] ?? null, 'booking.phone_verification_requested');
    return { id: String((r as any)?.id ?? '') };
  }

  async openPending(i: Parameters<ProofStore['openPending']>[0]): Promise<void> {
    const v = i.versions ?? null;   // the policy / config versions that asked (audit: never written)
    await this.tx(async (trx) => {
      const cur: any = (await sql`SELECT id, phone_hash, status FROM booking_verification_sessions
        WHERE tenant_id = ${i.tenantId} AND booking_session_id = ${i.bookingSessionId} ORDER BY created_at DESC LIMIT 1 FOR UPDATE`.execute(trx)).rows?.[0];
      if (cur && cur.status !== 'verified' && cur.status !== 'locked') {
        // The same booking attempt again (or with another number): re-open it for this number and this hold.
        const sameNumber = String(cur.phone_hash) === i.phoneHash;
        assertTransition(BOOKING_VERIFICATION_SESSION, String(cur.status), sameNumber ? String(cur.status) : 'pending');   // Phase 12 (#27): on the row locked above
        return (await sql`UPDATE booking_verification_sessions
          SET booking_hold_id = coalesce(${i.holdId}, booking_hold_id), expires_at = to_timestamp(${i.expiresAt} / 1000.0),
              policy_version = coalesce(${v?.policy ?? null}, policy_version), policy_reason = coalesce(${i.reason ?? null}, policy_reason), tenant_config_version = coalesce(${v?.tenant ?? null}::int, tenant_config_version),
              branch_config_version = coalesce(${v?.branch ?? null}::int, branch_config_version), provider_config_version = coalesce(${v?.provider ?? null}::int, provider_config_version),
              phone_hash = ${i.phoneHash}, phone_mask = ${i.phoneMask},
              status = ${sameNumber ? sql`status` : sql`'pending'`},
              attempt_count = ${sameNumber ? sql`attempt_count` : sql`0`},
              provider_verification_sid = ${sameNumber ? sql`provider_verification_sid` : sql`NULL`},
              code_hash = ${sameNumber ? sql`code_hash` : sql`NULL`},
              updated_at = now()
          WHERE id = ${cur.id} RETURNING id, tenant_id, branch_id, channel, phone_mask`.execute(trx)).rows?.[0] ?? null;
      }
      return (await sql`INSERT INTO booking_verification_sessions
          (tenant_id, branch_id, booking_session_id, booking_hold_id, customer_id, phone_hash, phone_mask, channel, status, expires_at, request_ip, device_id,
           policy_version, tenant_config_version, branch_config_version, provider_config_version, policy_reason)
        VALUES (${i.tenantId}, ${i.branchId}, ${i.bookingSessionId}, ${i.holdId}, ${i.customerId}, ${i.phoneHash}, ${i.phoneMask}, ${i.channel},
          'pending', to_timestamp(${i.expiresAt} / 1000.0), ${i.requestIp ?? null}, ${i.deviceId ?? null},
          ${v?.policy ?? null}, ${v?.tenant ?? null}::int, ${v?.branch ?? null}::int, ${v?.provider ?? null}::int, ${i.reason ?? null})
        RETURNING id, tenant_id, branch_id, channel, phone_mask`.execute(trx)).rows?.[0] ?? null;
    }, 'booking.phone_verification_requested', () => ({ held: !!i.holdId }));
  }

  /** guide §9: the booked services' price (catalog price, this tenant only), the salon's deposit policy (branch row over
   *  salon row of booking-appointments, the same rule BookingDepositService applies), and the high-value line (branch
   *  setting over salon setting; NULL = not configured). */
  async riskFacts(tenantId: string, branchId: string, serviceIds: string[]): Promise<{ priceCents: number; depositRequired: boolean; highValueThresholdCents: number | null } | null> {
    if (!serviceIds.length) return null;
    const price: any = (await sql`SELECT coalesce(sum(price_cents), 0)::bigint AS p FROM services
      WHERE tenant_id = ${tenantId} AND id = ANY(${serviceIds}::uuid[])`.execute(this.db!)).rows?.[0];
    const dep: any = (await sql`SELECT settings_json FROM tenant_settings
      WHERE tenant_id = ${tenantId} AND category = 'booking-appointments' AND (branch_id = ${branchId}::uuid OR branch_id IS NULL)
      ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db!)).rows?.[0];
    let v: any = dep?.settings_json ?? {}; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = {}; } }
    const pct = Number.isFinite(Number(v?.depositPercent)) ? Math.max(0, Math.min(100, Number(v.depositPercent))) : 20;
    const priceCents = Number(price?.p ?? 0);
    const depositRequired = v?.depositRequired === true && pct > 0 && Math.round(priceCents * pct / 100) > 0;
    const hv: any = (await sql`SELECT high_value_threshold_cents AS t FROM booking_verification_settings
      WHERE tenant_id = ${tenantId} AND (branch_id = ${branchId}::uuid OR branch_id IS NULL) AND high_value_threshold_cents IS NOT NULL
      ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db!)).rows?.[0];
    return { priceCents, depositRequired, highValueThresholdCents: hv?.t == null ? null : Number(hv.t) };
  }

  /** The number for this session changed before any code was proven: start its verification over. */
  async rebindPhone(sessionId: string, phoneHash: string, phoneMask: string): Promise<void> {
    await sql`UPDATE booking_verification_sessions SET phone_hash = ${phoneHash}, phone_mask = ${phoneMask}, status = 'pending',
        attempt_count = 0, provider_verification_sid = NULL, code_hash = NULL, last_sent_at = NULL, updated_at = now()
      WHERE id = ${sessionId} AND status IN ('pending', 'sent') AND ${canMoveToSql(BOOKING_VERIFICATION_SESSION, 'pending')}`.execute(this.db as any);
  }

  /** Before the provider is called: which mechanism, which service. */
  async prepareSend(sessionId: string, provider: string, providerServiceSid: string | null, from?: { requestIp: string | null; deviceId: string | null }): Promise<void> {
    // The SENDER's network and device are what the hard caps and the fraud engine count (the session may have been
    // opened by the booking request; the code is requested by whoever asks for it).
    await sql`UPDATE booking_verification_sessions SET provider = ${provider}, provider_service_sid = ${providerServiceSid}, failure_reason = NULL,
        request_ip = coalesce(${from?.requestIp ?? null}, request_ip), device_id = coalesce(${from?.deviceId?.slice(0, 200) ?? null}, device_id), updated_at = now()
      WHERE id = ${sessionId}`.execute(this.db as any);
  }

  async markSent(sessionId: string, at: number, providerVerificationSid: string | null, codeHash?: string | null, expiresAt?: number): Promise<void> {
    await this.tx(async (trx) => (await sql`
      UPDATE booking_verification_sessions
      SET status = 'sent', last_sent_at = to_timestamp(${at} / 1000.0),
          resend_count = resend_count + CASE WHEN last_sent_at IS NULL THEN 0 ELSE 1 END,
          provider_verification_sid = coalesce(${providerVerificationSid}, provider_verification_sid),
          code_hash = ${codeHash === undefined ? sql`code_hash` : codeHash},
          expires_at = ${expiresAt ? sql`greatest(expires_at, to_timestamp(${expiresAt} / 1000.0))` : sql`expires_at`},
          delivered_at = NULL, updated_at = now()
      WHERE id = ${sessionId} AND status IN ('pending', 'sent') AND ${canMoveToSql(BOOKING_VERIFICATION_SESSION, 'sent')}
      RETURNING id, tenant_id, branch_id, channel, phone_mask, resend_count`.execute(trx)).rows?.[0] ?? null,
      'booking.phone_verification_sent', (r: any) => ({ resend: Number(r.resend_count ?? 0) > 0 }));
  }

  /** The provider refused the send. The session stays open (the customer may try again after the cooldown). */
  async markSendFailed(sessionId: string, reason: string): Promise<void> {
    await this.tx(async (trx) => (await sql`UPDATE booking_verification_sessions SET failure_reason = ${reason.slice(0, 200)}, updated_at = now()
      WHERE id = ${sessionId} RETURNING id, tenant_id, branch_id, channel, phone_mask`.execute(trx)).rows?.[0] ?? null,
      'booking.phone_verification_failed', () => ({ reason: 'send_failed' }));
    await alertOnPattern(this.db, sessionId, 'send_failed');
  }

  async sendsLastHour(ip: string | null, deviceId: string | null): Promise<{ ip: number; device: number }> {
    return platformSendsLastHour(this.db, ip, deviceId);
  }

  async reserveAttempt(sessionId: string, max: number): Promise<number | null> {
    // One statement: the row lock serialises simultaneous guesses, and the WHERE refuses a guess past the budget.
    const r: any = await sql`
      UPDATE booking_verification_sessions
      SET attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = ${sessionId} AND status IN ('pending', 'sent') AND attempt_count < ${max}
      RETURNING attempt_count`.execute(this.db as any);
    const n = r.rows?.[0]?.attempt_count;
    return n == null ? null : Number(n);
  }

  async refundAttempt(sessionId: string): Promise<void> {
    await sql`UPDATE booking_verification_sessions SET attempt_count = greatest(attempt_count - 1, 0), updated_at = now()
      WHERE id = ${sessionId} AND status IN ('pending', 'sent')`.execute(this.db as any).catch(() => undefined);
  }

  /** The attempts ran out: lock the session and give the slot back. */
  async lock(sessionId: string): Promise<void> {
    await this.tx(async (trx) => {
      const r: any = (await sql`UPDATE booking_verification_sessions SET status = 'locked', failure_reason = 'too_many_attempts', updated_at = now()
        WHERE id = ${sessionId} AND status IN ('pending', 'sent') AND ${canMoveToSql(BOOKING_VERIFICATION_SESSION, 'locked')} RETURNING id, tenant_id, branch_id, channel, phone_mask, booking_hold_id`.execute(trx)).rows?.[0];
      if (r?.booking_hold_id) await releaseHold(trx, r.booking_hold_id, 'verification_failed');
      return r ?? null;
    }, 'booking.phone_verification_failed', () => ({ reason: 'locked' }));
    await alertOnPattern(this.db, sessionId, 'locked');
  }

  async markVerified(sessionId: string, at: number): Promise<boolean> {
    // Guarded by the status, so a replayed confirmation cannot re-verify. One-time use in the WHERE clause.
    // Returns whether THIS call verified it (false: another check already verified — or the last wrong guess locked — it).
    const r = await this.tx(async (trx) => (await sql`
      UPDATE booking_verification_sessions
      SET status = 'verified', verified_at = to_timestamp(${at} / 1000.0), updated_at = now()
      WHERE id = ${sessionId} AND status IN ('pending', 'sent') AND ${canMoveToSql(BOOKING_VERIFICATION_SESSION, 'verified')}
      RETURNING id, tenant_id, branch_id, channel, phone_mask`.execute(trx)).rows?.[0] ?? null, 'booking.phone_verified');
    return r != null;
  }

  async markFailed(sessionId: string, reason: string): Promise<void> {
    await this.tx(async (trx) => {
      const r: any = (await sql`UPDATE booking_verification_sessions SET status = 'failed', failure_reason = ${reason.slice(0, 200)}, updated_at = now()
        WHERE id = ${sessionId} AND status IN ('pending', 'sent') AND ${canMoveToSql(BOOKING_VERIFICATION_SESSION, 'failed')} RETURNING id, tenant_id, branch_id, channel, phone_mask, booking_hold_id`.execute(trx)).rows?.[0];
      if (r?.booking_hold_id) await releaseHold(trx, r.booking_hold_id, 'verification_failed');
      return r ?? null;
    }, 'booking.phone_verification_failed', () => ({ reason }));
  }

  async recordVerifiedPhone(v: {
    tenantId: string; customerId: string | null; phoneHash: string; phoneMask: string;
    provider: string; channel: string; verifiedAt: number;
  }): Promise<void> {
    // The per-phone trust row the policy reads for an ACCOUNT's own number (customer app). Tenant-scoped by its key.
    await sql`
      INSERT INTO booking_verified_phones (tenant_id, customer_id, phone_hash, phone_mask, provider, channel, verified_at)
      VALUES (${v.tenantId}, ${v.customerId}, ${v.phoneHash}, ${v.phoneMask}, ${v.provider}, ${v.channel}, to_timestamp(${v.verifiedAt} / 1000.0))
      ON CONFLICT (tenant_id, phone_hash) DO UPDATE
        SET verified_at = EXCLUDED.verified_at,
            customer_id = coalesce(EXCLUDED.customer_id, booking_verified_phones.customer_id),
            provider = EXCLUDED.provider,
            channel = EXCLUDED.channel,
            phone_mask = EXCLUDED.phone_mask,
            -- a fresh proof of the number clears an earlier revocation (it was retired, now it is proven again)
            revoked_at = NULL, revoked_reason = NULL,
            updated_at = now()`.execute(this.db as any);
  }

  // ── the proof (ProofStore) ──
  async claimProof(tenantId: string, bookingSessionId: string, phoneHash: string, maxAgeMs: number) {
    const r: any = await sql`
      UPDATE booking_verification_sessions SET consumed_at = now(), updated_at = now()
      WHERE id = (SELECT id FROM booking_verification_sessions
                  WHERE tenant_id = ${tenantId} AND booking_session_id = ${bookingSessionId} AND phone_hash = ${phoneHash}
                    AND status = 'verified' AND consumed_at IS NULL
                    AND coalesce(override_at, verified_at) > now() - make_interval(secs => ${Math.round(maxAgeMs / 1000)})
                  ORDER BY created_at DESC LIMIT 1
                  FOR UPDATE SKIP LOCKED)
        AND consumed_at IS NULL
      RETURNING id, override_at`.execute(this.db as any);
    const row = r.rows?.[0];
    return row ? { sessionId: String(row.id), method: (row.override_at ? 'staff_override' : 'verified') as 'verified' | 'staff_override' } : null;
  }

  async attachProof(tenantId: string, sessionId: string | null, appointmentId: string, label: VerificationLabel | null): Promise<void> {
    if (sessionId) await sql`UPDATE booking_verification_sessions SET consumed_appointment_id = ${appointmentId}, updated_at = now()
      WHERE id = ${sessionId} AND tenant_id = ${tenantId} AND consumed_appointment_id IS NULL`.execute(this.db as any);
    if (label) await sql`UPDATE pos_tech_appointments SET phone_verification = ${label}, phone_verification_session_id = ${sessionId}
      WHERE id = ${appointmentId} AND tenant_id = ${tenantId}`.execute(this.db as any);
    // the proven number's last booking (audit: booking_verified_phones.last_booking_at was never written)
    if (sessionId && label !== 'staff_override') await sql`UPDATE booking_verified_phones SET last_booking_at = now(), updated_at = now()
      WHERE tenant_id = ${tenantId} AND phone_hash = (SELECT phone_hash FROM booking_verification_sessions WHERE id = ${sessionId} AND tenant_id = ${tenantId})`.execute(this.db as any).catch(() => undefined);
  }

  async releaseProof(sessionId: string): Promise<void> {
    await sql`UPDATE booking_verification_sessions SET consumed_at = NULL, updated_at = now()
      WHERE id = ${sessionId} AND consumed_appointment_id IS NULL`.execute(this.db as any);
  }

  async holdSeconds(tenantId: string, branchId: string): Promise<number> {
    const r: any = await sql`SELECT hold_seconds FROM booking_verification_settings WHERE tenant_id = ${tenantId}
      AND (branch_id = ${branchId || null}::uuid OR branch_id IS NULL) ORDER BY branch_id NULLS LAST LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return Number(r.rows?.[0]?.hold_seconds ?? 600);
  }

  /** Close every unproven session past its deadline and give its slot back (the expiry sweep). */
  async expireStale(limit = 500): Promise<number> {
    const ids = await staleVerificationIds(this.db, limit);
    let n = 0;
    for (const id of ids) {
      const done = await this.tx(async (trx) => {
        const x: any = (await sql`UPDATE booking_verification_sessions SET status = 'expired', updated_at = now()
          WHERE id = ${id} AND status IN ('pending', 'sent') AND ${canMoveToSql(BOOKING_VERIFICATION_SESSION, 'expired')} AND expires_at < now()
          RETURNING id, tenant_id, branch_id, channel, phone_mask, booking_hold_id`.execute(trx)).rows?.[0];
        if (x?.booking_hold_id) await releaseHold(trx, x.booking_hold_id, 'hold_expired');
        return x ?? null;
      }, 'booking.phone_verification_expired');
      if (done) n++;
    }
    return n;
  }
}

/**
 * An owner alert about booking verification (BUILD_PLAN Phase 4: notifications). At most ONE of a kind per salon per
 * window — a spike must not become a flood. Masked numbers only; an alert never blocks what it describes.
 */
export async function bookingVerificationAlert(db: any, a: { tenantId: string; branchId?: string | null; kind: string; severity: 'info' | 'warning' | 'high'; title: string; body: string; windowMinutes?: number; audience?: 'all' | 'owner'; metadata?: Record<string, unknown> }): Promise<boolean> {
  try {
    const dup: any = await sql`SELECT 1 FROM owner_alerts WHERE tenant_id = ${a.tenantId} AND category = 'booking_verification'
      AND metadata->>'kind' = ${a.kind} AND created_at > now() - make_interval(mins => ${a.windowMinutes ?? 60}) LIMIT 1`.execute(db);
    if (dup.rows?.length) return false;
    await sql`INSERT INTO owner_alerts (tenant_id, branch_id, category, severity, status, title, body, metadata, audience)
      VALUES (${a.tenantId}, ${a.branchId ?? null}, 'booking_verification', ${a.severity}, 'new', ${a.title}, ${a.body}, ${JSON.stringify({ ...(a.metadata ?? {}), kind: a.kind })}::jsonb, ${a.audience ?? 'all'})`.execute(db);
    return true;
  } catch { return false; }
}

/** After a lock or a failed send: has it become a pattern worth an owner's attention? */
async function alertOnPattern(db: any, sessionId: string, what: 'locked' | 'send_failed'): Promise<void> {
  const s: any = (await sql`SELECT tenant_id, branch_id FROM booking_verification_sessions WHERE id = ${sessionId}`.execute(db).catch(() => ({ rows: [] }))).rows?.[0];
  if (!s) return;
  if (what === 'locked') {
    const n = Number(((await sql`SELECT count(*)::int AS n FROM booking_verification_sessions WHERE tenant_id = ${s.tenant_id} AND status = 'locked' AND updated_at > now() - interval '1 hour'`.execute(db).catch(() => ({ rows: [] }))).rows?.[0] as any)?.n ?? 0);
    if (n >= 3) await bookingVerificationAlert(db, { tenantId: String(s.tenant_id), branchId: s.branch_id, kind: 'lock_spike', severity: 'warning',
      title: 'Several bookings were locked for wrong phone codes',
      body: `${n} booking verifications were locked in the last hour after too many wrong codes. That can be someone guessing codes. Review them under Booking Phone Verification.`, metadata: { locked: n } });
  } else {
    const n = Number(((await sql`SELECT count(*)::int AS n FROM booking_verification_sessions WHERE tenant_id = ${s.tenant_id} AND failure_reason IS NOT NULL AND status <> 'verified' AND updated_at > now() - interval '30 minutes' AND failure_reason NOT IN ('too_many_attempts')`.execute(db).catch(() => ({ rows: [] }))).rows?.[0] as any)?.n ?? 0);
    if (n >= 3) await bookingVerificationAlert(db, { tenantId: String(s.tenant_id), branchId: s.branch_id, kind: 'provider_failures', severity: 'high', audience: 'owner',
      title: 'Booking verification codes are failing to send',
      body: `${n} verification codes could not be sent in the last 30 minutes, so those customers cannot finish booking online. Check your Twilio connection (Messaging setup → Test Verify).`, metadata: { failures: n } });
  }
}

async function releaseHold(trx: any, holdId: string, reason: string): Promise<void> {
  await sql`UPDATE booking_holds SET released_at = now(), release_reason = ${reason}, status = 'released', updated_at = now()
    WHERE id = ${holdId} AND released_at IS NULL AND converted_appointment_id IS NULL AND ${canMoveToSql(BOOKING_HOLD, 'released')}`.execute(trx);
}
