// tenant-messaging-readiness.service.ts — the shared, tenant-scoped readiness read behind BOTH Phone & Messaging pages
// (/tenant/communications/phone and /messaging-setup), and the Health Check action. Owner guide §12/§13: one
// authoritative configuration (tenant_messaging_credentials, read here — never copied), independent status models
// (messaging-readiness-model.ts), every status with its last-checked time, a safe reason code and where to fix it.
//
// Tenant and branch come from the session (the controller passes ctx.tenantId; a branch id comes from the PATH and is
// checked to be this salon's). Every statement carries `tenant_id = ${tenantId}`.
//
// Booking Verify readiness reads booking_verification_settings + booking_verification_platform_policy directly (raw,
// read-only): the booking module depends on this one, so it cannot be imported here. The rule is the booking
// settings service's own (platform kill switch / module off / blocked → disabled; tenant toggle or platform-required →
// on; then provider readiness = last_validated_at), and the toggle itself stays on its existing screen.
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { AuditService } from '@aipowersalon/audit';
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { withCode } from '@aipowersalon/api-contracts';
import { evaluateReadiness, configFingerprint, testDisplayState, type MessagingReadiness, type CheckRow, type CredRow, type TestRow, type VerifyPolicy } from './messaging-readiness-model';
import { runProviderChecks, recordHealthCheck, expectedInboundUrl } from './messaging-health';
import type { ProbeHttp } from './twilio-account-probe';
import { loadRegistrationSnapshots } from './registration-sync.service';
import { messagingConfigDiagnostics } from './messaging-config-diagnostics';
import type { Kysely } from 'kysely';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** one manual health check per salon per this window (bounded provider traffic at 10,000+ salons) */
export const HEALTH_CHECK_MIN_INTERVAL_MS = 20_000;

export class ReadinessInputError extends Error {}
const logGap = (what: string) => (e: unknown): void => {
  const code = (e as { code?: unknown } | null)?.code;
  process.stderr.write(JSON.stringify({ level: 'warn', msg: what, code: typeof code === 'string' ? code : null }) + '\n');
};
const d = (v: unknown): Date | null => (v ? new Date(String(v instanceof Date ? v.toISOString() : v)) : null);

export interface ReadinessView extends MessagingReadiness {
  scope: { branchId: string | null; salonName: string | null; branchName: string | null; inheritsFromDefault: boolean; branchOverrides: { branchId: string; name: string | null }[]; branchesInheriting: { branchId: string; name: string | null }[];
    /** PM-01: the branches THIS actor may act for (test SMS / branch views), each with the configuration it uses */
    authorizedBranches: { branchId: string; name: string | null; source: 'branch_override' | 'tenant_default' }[] };
  lastChanged: { at: string | null; byUserLast4: string | null };
  registeredNumbers: { number: string; status: string }[];
  diagnostics: { checks: { id: string; checkedAt: string; trigger: string; accountState: string; reasonCode: string | null; senderState: string | null; apiKeyState: string | null; verifyState: string | null; inboundUrlState: string | null; durationMs: number | null; current: boolean }[]; tests: ReadinessView['lastTest'][] };
}

/** the credentials columns readiness reads — never the encrypted secrets: whether a key secret is stored, and the config
 *  fingerprint computed in SQL exactly as configFingerprint() does (sha256 of the six fields joined by U+0001) */
const READ_COLS = sql`c.id, c.tenant_id, c.branch_id, c.status, c.offboarded_at, c.account_mode, c.account_sid, c.auth_token_last4, c.from_number,
  c.verify_service_sid, c.api_key_sid, (c.api_key_secret_enc IS NOT NULL) AS has_api_key_secret, c.messaging_service_sid, c.last_validated_at,
  c.last_validation_error, c.updated_at, c.updated_by_user_id,
  encode(sha256(convert_to(concat_ws(chr(1), COALESCE(c.account_sid, ''), COALESCE(c.auth_token_enc, ''), COALESCE(c.api_key_sid, ''),
    COALESCE(c.api_key_secret_enc, ''), COALESCE(c.from_number, ''), COALESCE(c.verify_service_sid, '')), 'UTF8')), 'hex') AS config_fingerprint`;
/** the test-send columns testOf reads */
const TEST_COLS = sql`t.id, t.status, t.destination_masked, t.sender, t.provider_message_sid, t.error_code, t.warning_codes, t.created_at,
  t.status_updated_at, t.delivered_at, t.branch_id, t.config_source, t.account_sid_last4`;
/** the health-check columns checkOf reads */
const HC_COLS = sql`h.id, h.checked_at, h.config_fingerprint, h.account_state, h.account_reason_code, h.account_type, h.auth_mode, h.api_key_state,
  h.sender_number, h.sender_state, h.sender_capabilities, h.inbound_url_state, h.verify_state, h.verify_reason_code, h.trigger_kind, h.numbers_inbound`;

@Injectable()
export class TenantMessagingReadinessService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly audit: AuditService, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets) {}
  /** the provider HTTP client (tests swap it for a fake; never a DI dependency) */
  http: ProbeHttp = (...a) => fetch(...a);
  /** the clock (tests pin it) */
  now: () => Date = () => new Date();
  /** the per-salon health check window (tests shorten it) */
  minIntervalMs = HEALTH_CHECK_MIN_INTERVAL_MS;

  private need(): NonNullable<AppDatabase> { if (!this.db) throw withCode(new ReadinessInputError('Messaging readiness needs the database.'), 'SERVICE_UNAVAILABLE'); return this.db; }

  private async scopeOf(tenantId: string, branchId: string | null): Promise<string | null> {
    if (!branchId) return null;
    if (!UUID.test(branchId)) throw withCode(new ReadinessInputError('Unknown branch.'), 'BRANCH_NOT_FOUND');
    const r: any = await sql`SELECT b.id FROM branches b WHERE b.tenant_id = ${tenantId} AND b.id = ${branchId}::uuid LIMIT 1`.execute(this.need());
    if (!r.rows?.length) throw withCode(new ReadinessInputError('Unknown branch.'), 'BRANCH_NOT_FOUND');
    return branchId;
  }

  /** the configuration this scope actually uses: its own row, else (a branch) the salon default it inherits */
  private async effectiveRow(tenantId: string, scope: string | null, withSecrets = false): Promise<{ row: any | null; source: 'tenant_default' | 'branch_override' | 'none'; rowScope: string | null }> {
    const db = this.need();
    const cols = withSecrets ? sql`${READ_COLS}, c.auth_token_enc, c.api_key_secret_enc` : READ_COLS;
    if (scope) {
      const own: any = await sql`SELECT ${cols} FROM tenant_messaging_credentials c WHERE c.tenant_id = ${tenantId} AND c.provider = 'twilio' AND c.branch_id = ${scope}::uuid LIMIT 1`.execute(db);
      if (own.rows?.[0]) return { row: own.rows[0], source: 'branch_override', rowScope: scope };
    }
    const def: any = await sql`SELECT ${cols} FROM tenant_messaging_credentials c WHERE c.tenant_id = ${tenantId} AND c.provider = 'twilio' AND c.branch_id IS NULL LIMIT 1`.execute(db);
    return def.rows?.[0] ? { row: def.rows[0], source: 'tenant_default', rowScope: null } : { row: null, source: 'none', rowScope: null };
  }

  private credOf(r: any): CredRow | null {
    if (!r || r.status !== 'configured' || r.offboarded_at) return null;
    return {
      accountMode: r.account_mode === 'platform_managed' ? 'platform_managed' : 'tenant_owned', accountSid: r.account_sid ?? null, authTokenLast4: r.auth_token_last4 ?? null,
      fromNumber: r.from_number ?? null, verifyServiceSid: r.verify_service_sid ?? null, apiKeySid: r.api_key_sid ?? null, hasApiKeySecret: !!(r.has_api_key_secret ?? r.api_key_secret_enc),
      messagingServiceSid: r.messaging_service_sid ?? null, lastValidatedAt: d(r.last_validated_at), lastValidationError: !!r.last_validation_error,
      updatedAt: d(r.updated_at), updatedByUserId: r.updated_by_user_id ? String(r.updated_by_user_id) : null, fingerprint: r.config_fingerprint ?? configFingerprint(r),
    };
  }

  private checkOf(r: any): CheckRow {
    return { id: String(r.id), checkedAt: d(r.checked_at)!, fingerprint: r.config_fingerprint ?? null, accountState: String(r.account_state), accountReasonCode: r.account_reason_code ?? null,
      accountType: r.account_type ?? null, authMode: r.auth_mode ?? null, apiKeyState: r.api_key_state ?? null, senderNumber: r.sender_number ?? null, senderState: r.sender_state ?? null,
      senderCapabilities: r.sender_capabilities ? (typeof r.sender_capabilities === 'string' ? JSON.parse(r.sender_capabilities) : r.sender_capabilities) : null,
      inboundUrlState: r.inbound_url_state ?? null, verifyState: r.verify_state ?? null, verifyReasonCode: r.verify_reason_code ?? null, triggerKind: String(r.trigger_kind),
      numbersInbound: r.numbers_inbound ? (typeof r.numbers_inbound === 'string' ? JSON.parse(r.numbers_inbound) : r.numbers_inbound) : null };
  }

  private testOf(r: any): TestRow {
    return { id: String(r.id), status: String(r.status), destinationMasked: String(r.destination_masked), sender: r.sender ?? null,
      providerSidLast6: r.provider_message_sid ? String(r.provider_message_sid).slice(-6) : null, errorCode: r.error_code ?? null, warningCodes: Array.isArray(r.warning_codes) ? r.warning_codes.map(String) : [],
      createdAt: d(r.created_at)!, statusUpdatedAt: d(r.status_updated_at)!, deliveredAt: d(r.delivered_at),
      branchId: r.branch_id ? String(r.branch_id) : null, configSource: r.config_source ?? null, accountSidLast4: r.account_sid_last4 ?? null };
  }

  private async verifyPolicy(tenantId: string, scope: string | null): Promise<VerifyPolicy> {
    const db = this.need();
    const s: any = await sql`SELECT s.enabled, s.branch_id FROM booking_verification_settings s WHERE s.tenant_id = ${tenantId}
      AND (s.branch_id IS NULL OR s.branch_id = ${scope}::uuid) ORDER BY s.branch_id NULLS LAST LIMIT 1`.execute(db);
    const p: any = await sql`SELECT p.tenant_id, p.emergency_disabled, p.required_for_tenant, p.blocked_for_tenant, p.module_enabled FROM booking_verification_platform_policy p
      WHERE p.tenant_id = ${tenantId} OR p.tenant_id IS NULL`.execute(db);
    const rows: any[] = p.rows ?? [];
    const global = rows.find((x) => x.tenant_id == null); const mine = rows.find((x) => x.tenant_id != null);
    const row = s.rows?.[0];
    return { tenantEnabled: !!row?.enabled, requiredByPlatform: !!mine?.required_for_tenant, blockedByPlatform: !!mine?.blocked_for_tenant,
      emergencyDisabled: !!global?.emergency_disabled, moduleDisabled: global?.module_enabled === false || mine?.module_enabled === false,
      source: !row ? 'default' : row.branch_id ? 'branch_override' : 'tenant_default' };
  }

  /**
   * GET readiness — the salon default (branchId null) or a branch (its own row, else the inherited default).
   * `allowedBranches` (PM-01): the branches the actor may act for (null = every branch of the salon); the controller
   * passes it from the session and has already refused a branch outside it.
   */
  async readiness(tenantId: string, branchId: string | null, allowedBranches: string[] | null = null): Promise<ReadinessView> {
    const db = this.need();
    const scope = await this.scopeOf(tenantId, branchId);
    const { row, source, rowScope } = await this.effectiveRow(tenantId, scope);
    const cred = this.credOf(row);
    const lastCheckR: any = await sql`SELECT ${HC_COLS} FROM tenant_messaging_health_checks h WHERE h.tenant_id = ${tenantId}
      AND ${rowScope ? sql`h.branch_id = ${rowScope}::uuid` : sql`h.branch_id IS NULL`} ORDER BY h.checked_at DESC LIMIT 1`.execute(db);
    const numbers: any = await sql`SELECT n.phone_number, n.status FROM tenant_messaging_numbers n WHERE n.tenant_id = ${tenantId} AND n.channel = 'sms' ORDER BY (n.status = 'active') DESC, n.created_at ASC LIMIT 10`.execute(db);
    const a2pR: any = await sql`SELECT a.brand_status, a.brand_sid, a.campaign_status, a.campaign_sid, a.messaging_service_sid, a.number_sid, a.status, a.updated_at, a.last_error
      FROM tenant_a2p_registrations a WHERE a.tenant_id = ${tenantId} ORDER BY a.updated_at DESC NULLS LAST LIMIT 1`.execute(db);
    const wh: any = await sql`SELECT w.webhook_kind, w.last_verified_at FROM tenant_messaging_webhook_activity w WHERE w.tenant_id = ${tenantId}`.execute(db);
    // a branch view lists that branch's tests; the salon view lists every test of the salon
    const tests: any = await sql`SELECT ${TEST_COLS} FROM sms_test_events t WHERE t.tenant_id = ${tenantId} ${scope ? sql`AND t.branch_id = ${scope}::uuid` : sql``} ORDER BY t.created_at DESC LIMIT 5`.execute(db);
    const checks: any = await sql`SELECT ${HC_COLS} FROM tenant_messaging_health_checks h WHERE h.tenant_id = ${tenantId}
      AND ${rowScope ? sql`h.branch_id = ${rowScope}::uuid` : sql`h.branch_id IS NULL`} ORDER BY h.checked_at DESC LIMIT 5`.execute(db);
    const names: any = await sql`SELECT t.display_name, (SELECT b.name FROM branches b WHERE b.tenant_id = ${tenantId} AND b.id = ${scope}::uuid) AS branch_name FROM tenants t WHERE t.id = ${tenantId}`.execute(db);
    const br: any = await sql`SELECT b.id, b.name, EXISTS (SELECT 1 FROM tenant_messaging_credentials c WHERE c.tenant_id = ${tenantId} AND c.provider = 'twilio' AND c.branch_id = b.id) AS own
      FROM branches b WHERE b.tenant_id = ${tenantId} ORDER BY b.name LIMIT 200`.execute(db);
    const a = a2pR.rows?.[0];
    const whOf = (k: string) => d((wh.rows ?? []).find((x: any) => x.webhook_kind === k)?.last_verified_at);
    const verify = await this.verifyPolicy(tenantId, scope);
    const lastCheck = lastCheckR.rows?.[0] ? this.checkOf(lastCheckR.rows[0]) : null;
    const activeNumber = (numbers.rows ?? []).find((n: any) => n.status === 'active')?.phone_number ?? null;
    const reg = await loadRegistrationSnapshots(db as unknown as Kysely<any>, tenantId);
    const model = evaluateReadiness({
      now: this.now(), source, cred, sharedPlatformAccount: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN), lastCheck, registryNumber: activeNumber,
      a2p: a ? { brandStatus: a.brand_status ?? null, brandSid: !!a.brand_sid, campaignStatus: a.campaign_status ?? null, campaignSid: !!a.campaign_sid, messagingServiceSid: a.messaging_service_sid ?? null,
        numberAttached: !!a.number_sid, status: a.status ?? null, updatedAt: d(a.updated_at), hasError: !!a.last_error } : null,
      webhooks: { inbound: whOf('inbound'), status: whOf('status') }, expectedInboundUrl: expectedInboundUrl(), statusCallbackUrl: process.env.TWILIO_STATUS_CALLBACK_URL || null,
      verify, lastTest: tests.rows?.[0] ? this.testOf(tests.rows[0]) : null,
      registration: { items: reg.items, lastRun: reg.lastRun ? { at: reg.lastRun.finishedAt ?? reg.lastRun.startedAt, outcome: reg.lastRun.outcome, trigger: reg.lastRun.trigger } : null },
      config: messagingConfigDiagnostics(),
    });
    const branches = (br.rows ?? []).map((x: any) => ({ branchId: String(x.id), name: x.name ?? null, own: !!x.own }));
    const nowD = this.now();
    const testView = (r: any) => { const t = this.testOf(r); return { ...t, createdAt: t.createdAt.toISOString(), statusUpdatedAt: t.statusUpdatedAt.toISOString(), deliveredAt: t.deliveredAt ? t.deliveredAt.toISOString() : null, final: ['delivered', 'failed', 'undelivered', 'rejected'].includes(t.status), displayState: testDisplayState(t.status, t.statusUpdatedAt, nowD) }; };
    const allowed = allowedBranches ? new Set(allowedBranches) : null;
    return {
      ...model,
      scope: { branchId: scope, salonName: names.rows?.[0]?.display_name ?? null, branchName: names.rows?.[0]?.branch_name ?? null, inheritsFromDefault: !!scope && source === 'tenant_default',
        branchOverrides: branches.filter((b: any) => b.own).map(({ branchId: id, name }: any) => ({ branchId: id, name })), branchesInheriting: branches.filter((b: any) => !b.own).map(({ branchId: id, name }: any) => ({ branchId: id, name })),
        authorizedBranches: branches.filter((b: any) => !allowed || allowed.has(b.branchId)).map((b: any) => ({ branchId: b.branchId, name: b.name, source: b.own ? 'branch_override' as const : 'tenant_default' as const })) },
      lastChanged: { at: cred?.updatedAt ? cred.updatedAt.toISOString() : null, byUserLast4: cred?.updatedByUserId ? cred.updatedByUserId.slice(-4) : null },
      registeredNumbers: (numbers.rows ?? []).map((n: any) => ({ number: String(n.phone_number), status: String(n.status) })),
      diagnostics: {
        checks: (checks.rows ?? []).map((r: any) => { const c = this.checkOf(r); return { id: c.id, checkedAt: c.checkedAt.toISOString(), trigger: c.triggerKind, accountState: c.accountState, reasonCode: c.accountReasonCode,
          senderState: c.senderState, apiKeyState: c.apiKeyState, verifyState: c.verifyState, inboundUrlState: c.inboundUrlState, durationMs: r.duration_ms ?? null, current: !!cred && c.fingerprint === cred.fingerprint }; }),
        tests: (tests.rows ?? []).map(testView),
      },
    };
  }

  /**
   * POST health-check — the authenticated provider check of this scope's EFFECTIVE configuration: the account (SID +
   * token), the API key pair if one is set, the sender number's ownership + capabilities + inbound URL, and the Verify
   * Service. Records the result (append-only) and returns the fresh readiness. Rate-limited per salon.
   */
  async healthCheck(actor: { userId: string; tenantId: string }, branchId: string | null, allowedBranches: string[] | null = null, opts: { trigger?: 'manual' | 'scheduled' } = {}): Promise<ReadinessView> {
    // Text Messaging Setup guide §11: the nightly run (env-gated, messaging-setup-center.ts) records trigger 'scheduled';
    // only MANUAL checks are rate-limited per salon (a scheduled run is one per salon per salon-local day by its job key)
    const trigger: 'manual' | 'scheduled' = opts.trigger === 'scheduled' ? 'scheduled' : 'manual';
    const db = this.need();
    const tenantId = actor.tenantId;
    const scope = await this.scopeOf(tenantId, branchId);
    // the window is measured by the DATABASE clock (every API instance agrees), not this process's
    const recent: any = await sql`SELECT EXTRACT(EPOCH FROM (now() - h.checked_at)) * 1000 AS age_ms FROM tenant_messaging_health_checks h
      WHERE h.tenant_id = ${tenantId} AND h.trigger_kind = 'manual' ORDER BY h.checked_at DESC LIMIT 1`.execute(db);
    const age = recent.rows?.[0]?.age_ms;
    const wait = age == null || trigger === 'scheduled' ? 0 : this.minIntervalMs - Number(age);
    if (wait > 0) throw withCode(new ReadinessInputError('A health check just ran for this salon. Try again in a few seconds.'), 'HEALTH_CHECK_RATE_LIMITED', { retryAfterSeconds: Math.ceil(wait / 1000) });

    const { row, source, rowScope } = await this.effectiveRow(tenantId, scope, true);   // the health check decrypts the stored secrets
    if (!this.credOf(row)) {
      await recordHealthCheck(db, { tenantId, branchId: rowScope, source, fingerprint: null, actorUserId: actor.userId, trigger, fromNumber: null, result: null, notConfigured: true });
      return this.readiness(tenantId, scope, allowedBranches);
    }
    let token: string; let keySecret: string | null = null;
    try {
      token = this.secrets.decrypt(row.auth_token_enc);
      if (row.api_key_sid && row.api_key_secret_enc) keySecret = this.secrets.decrypt(row.api_key_secret_enc);
    } catch (e) {
      logGap('messaging health check: stored secret could not be decrypted')(e);
      await recordHealthCheck(db, { tenantId, branchId: rowScope, source, fingerprint: configFingerprint(row), actorUserId: actor.userId, trigger, fromNumber: row.from_number ?? null, result: null, errorCode: 'SECRET_DECRYPT_FAILED' });
      return this.readiness(tenantId, scope, allowedBranches);
    }
    // OPS-01: every registered number of the salon gets its own inbound webhook check (read-only, ≤ 10)
    const regNums: any = await sql`SELECT n.phone_number FROM tenant_messaging_numbers n WHERE n.tenant_id = ${tenantId} AND n.channel = 'sms' AND n.status = 'active' ORDER BY n.created_at LIMIT 10`.execute(db);
    const result = await runProviderChecks(this.http, { accountSid: row.account_sid, authToken: token, apiKeySid: row.api_key_sid ?? null, apiKeySecret: keySecret, fromNumber: row.from_number ?? null, verifyServiceSid: row.verify_service_sid ?? null },
      { checkVerify: true, expectedInbound: expectedInboundUrl(), otherNumbers: (regNums.rows ?? []).map((x: any) => String(x.phone_number)) });
    await recordHealthCheck(db, { tenantId, branchId: rowScope, source, fingerprint: configFingerprint(row), actorUserId: actor.userId, trigger, fromNumber: row.from_number ?? null, result });
    // The Verify probe IS "Test Verify": the booking policy reads last_validated_at, so the outcome is recorded the same way.
    if (result.verify.state === 'ok') await sql`UPDATE tenant_messaging_credentials SET last_validated_at = now(), last_validation_error = NULL WHERE tenant_id = ${tenantId} AND id = ${row.id}`.execute(db);
    else if (result.verify.state === 'failed') await sql`UPDATE tenant_messaging_credentials SET last_validated_at = NULL, last_validation_error = ${result.verify.reasonCode} WHERE tenant_id = ${tenantId} AND id = ${row.id}`.execute(db);
    await this.audit.record({ tenantId, userId: actor.userId }, {
      module: 'messaging', action: 'tenant_credentials.health_check', resourceType: 'tenant_messaging_credentials', resourceId: rowScope ?? tenantId,
      summary: result.account.state === 'connected' ? 'Twilio health check: connected' : 'Twilio health check: not connected',
      metadata: { trigger, branchId: rowScope, source, account: result.account.state, reasonCode: result.account.reasonCode, apiKey: result.apiKey.state, sender: result.sender?.state ?? null, verify: result.verify.state },
    }).catch(logGap('messaging health check: audit write failed'));
    return this.readiness(tenantId, scope, allowedBranches);
  }
}
