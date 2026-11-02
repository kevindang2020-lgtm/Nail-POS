// tenant-messaging-credentials.service.ts — each salon's own Twilio credentials (Super Admin and the salon's own
// settings). The auth token and the API key secret are encrypted at rest (ProviderSecrets) and NEVER returned; reads
// expose only SIDs, the from number, status, validation state and a last-4 hint.
//
// BUILD_PLAN Phase 4 (customer_booking_phone_verification): a salon could not turn booking verification on through the
// product — nothing wrote `verify_service_sid`, nothing set `last_validated_at`, and the "test" only sent an SMS. Now:
//   • the Verify Service SID (and optionally an API key + secret, to sign Verify calls without the account token);
//   • "Test Verify" fetches the Verify Service with these credentials and records the outcome
//     (`last_validated_at` on success, `last_validation_error` on failure). Changing any credential clears the
//     validation: new credentials are untested credentials;
//   • disconnect;
//   • per-BRANCH rows next to the salon default (migration 521 dropped 311's one-row-per-salon index). A branch with
//     its own row uses it; every other branch inherits the default.
import { PROVIDER_SECRETS, secretLast4, type ProviderSecrets } from '@aipowersalon/security';
import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { TwilioSmsSender, probeVerifyService, isVerifyServiceSid, isApiKeySid } from '@aipowersalon/notifications';
import { AuditService } from '@aipowersalon/audit';
import type { TenantTwilioCredentialsView } from '@aipowersalon/api-contracts';
import { canMoveToSql } from '@aipowersalon/database';
import { TENANT_MESSAGING_CREDENTIALS, SMS_TEST_EVENT } from '../communications-lifecycles';
import { registerTenantNumber } from './tenant-number.service';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
import { recordAuditStrict } from '@aipowersalon/audit';
import { createHash, randomUUID } from 'node:crypto';
import { runProviderChecks, recordHealthCheck, expectedInboundUrl, type CheckResult } from './messaging-health';
import { configFingerprint, mapCampaign, CHECK_STALE_AFTER_MS, maskSid, isMaskedSid, testDisplayState } from './messaging-readiness-model';
import { senderTypeOf } from './twilio-account-probe';

export type MaskedCredentials = TenantTwilioCredentialsView;   // the wire shape lives in @aipowersalon/api-contracts
export interface SetCredentialsInput {
  accountSid?: string; authToken?: string; fromNumber?: string;
  verifyServiceSid?: string | null; apiKeySid?: string | null; apiKeySecret?: string | null;
  /** Twilio could not be reached: save anyway, recorded as unverified (the UI asks first) */
  confirmUnverified?: boolean;
}

function isE164(n: string): boolean { return /^\+[1-9]\d{6,15}$/.test(n); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scopeOf = (branchId?: string | null): string | null => (branchId && UUID.test(branchId) ? branchId : null);
/** `updated_by_user_id` is a uuid; a caller without a real user id (the Super Admin controller's fallback) records none. */
const actorOf = (id: string): string | null => (UUID.test(String(id ?? '')) ? id : null);

export class CredentialsInputError extends Error {}
/** a best-effort side write that must not hide its failure: one structured warning line (no payload, no PII) */
const logGap = (what: string) => (e: unknown): void => {
  const code = (e as { code?: unknown } | null)?.code;
  process.stderr.write(JSON.stringify({ level: 'warn', msg: what, code: typeof code === 'string' ? code : null }) + '\n');
};

/** the credentials columns an ordinary read needs — never the encrypted secrets (only whether a key secret is stored) */
const CRED_COLS = sql`id, tenant_id, provider, account_sid, auth_token_last4, from_number, status, created_at, updated_at, verify_service_sid, branch_id,
  last_validated_at, last_validation_error, api_key_sid, (api_key_secret_enc IS NOT NULL) AS has_api_key_secret, account_mode, messaging_service_sid,
  config_version, provisioning_step, provisioning_error, provisioning_claimed_at, provisioned_at, offboarded_at, offboarding_error`;
/** the encrypted secrets — selected only by the paths that decrypt them (save re-check, Test Verify, sending config) */
const CRED_SECRET_COLS = sql`auth_token_enc, api_key_secret_enc`;
/** the test-send columns the replay / result reads use */
const TEST_COLS = sql`t.id, t.tenant_id, t.branch_id, t.idempotency_key, t.destination_masked, t.sender, t.provider_message_sid, t.status, t.error_code,
  t.warning_codes, t.created_by_user_id, t.created_at, t.status_updated_at, t.delivered_at, t.config_source, t.account_sid_last4, t.sender_kind`;

@Injectable()
export class TenantMessagingCredentialsService {
  // Credentials through the ProviderSecrets port (Constitution 13 §94) — never the key ring directly.
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly audit: AuditService, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets) {}
  /** The HTTP client for the Verify probe (tests swap it; not a DI dependency). */
  http: typeof fetch = (...a) => fetch(...a);

  private base(tenantId: string, branchId: string | null): MaskedCredentials {
    return { tenantId, branchId, provider: 'twilio', status: 'not_configured', accountSid: null, accountSidLast4: null, apiKeySidLast4: null, fromNumber: null, authTokenLast4: null,
      verifyServiceSid: null, apiKeySid: null, hasApiKeySecret: false, lastValidatedAt: null, lastValidationError: null, branchOverride: false };
  }

  /** This scope's own row (exactly; a branch row is never confused with the default). */
  private async row(tenantId: string, branchId: string | null, withSecrets = false): Promise<any | null> {
    if (!this.db) return null;
    const r: any = await sql`SELECT ${CRED_COLS}${withSecrets ? sql`, ${CRED_SECRET_COLS}` : sql``} FROM tenant_messaging_credentials WHERE tenant_id = ${tenantId} AND provider = 'twilio'
      AND ${branchId ? sql`branch_id = ${branchId}::uuid` : sql`branch_id IS NULL`} LIMIT 1`.execute(this.db);
    return r.rows?.[0] ?? null;
  }

  /**
   * PM-02 (Four-Module Completion Guide §6.2, Oct 30 2026): the Account SID and the API key SID are shown MASKED
   * (`AC…1234` / `SK…5678`) in every ordinary read — the full SID only through the privileged reveal (step-up + audit).
   * The edit form keeps working: a blank or masked SID on save means "keep the stored one". Secrets are never returned.
   */
  private mask(tenantId: string, branchId: string | null, r: any, branchOverride: boolean): MaskedCredentials {
    return {
      tenantId, branchId, provider: 'twilio', status: r.status === 'configured' ? 'configured' : 'not_configured',
      accountSid: maskSid(r.account_sid), accountSidLast4: r.account_sid ? String(r.account_sid).slice(-4) : null, fromNumber: r.from_number ?? null, authTokenLast4: r.auth_token_last4 ?? null,
      verifyServiceSid: r.verify_service_sid ?? null, apiKeySid: maskSid(r.api_key_sid), apiKeySidLast4: r.api_key_sid ? String(r.api_key_sid).slice(-4) : null, hasApiKeySecret: !!(r.has_api_key_secret ?? r.api_key_secret_enc),
      lastValidatedAt: r.last_validated_at ? new Date(r.last_validated_at).toISOString() : null,
      lastValidationError: r.last_validation_error ?? null, branchOverride,
      accountMode: r.account_mode === 'platform_managed' ? 'platform_managed' : 'tenant_owned',
      provisioning: r.account_mode === 'platform_managed' ? { step: r.provisioning_step ?? null, error: r.provisioning_error ?? null,
        provisionedAt: r.provisioned_at ? new Date(r.provisioned_at).toISOString() : null, messagingServiceSid: maskSid(r.messaging_service_sid) } : null,
    };
  }

  /** The masked view for the salon (branchId null) or for a branch — its own row, else the default it inherits. */
  async getMasked(tenantId: string, branchId?: string | null): Promise<MaskedCredentials> {
    const scope = scopeOf(branchId);
    const own = await this.row(tenantId, scope);
    if (own) return this.mask(tenantId, scope, own, !!scope);
    if (scope) { const def = await this.row(tenantId, null); if (def) return this.mask(tenantId, scope, def, false); }
    return this.base(tenantId, scope);
  }

  /** Which branches have their own Twilio. */
  async listBranchOverrides(tenantId: string): Promise<{ branchId: string; status: string; verifyServiceSid: string | null; lastValidatedAt: string | null }[]> {
    if (!this.db) return [];
    const r: any = await sql`SELECT branch_id, status, verify_service_sid, last_validated_at FROM tenant_messaging_credentials
      WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND branch_id IS NOT NULL ORDER BY created_at`.execute(this.db);
    return (r.rows ?? []).map((x: any) => ({ branchId: String(x.branch_id), status: String(x.status), verifyServiceSid: x.verify_service_sid ?? null,
      lastValidatedAt: x.last_validated_at ? new Date(x.last_validated_at).toISOString() : null }));
  }

  private async branchBelongs(tenantId: string, branchId: string): Promise<boolean> {
    if (!this.db) return true;
    const r: any = await sql`SELECT 1 FROM branches WHERE id = ${branchId}::uuid AND tenant_id = ${tenantId} LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows?.length ?? 0) > 0;
  }

  /**
   * Set or update the salon's (or a branch's) Twilio. Secrets are optional on update (kept when omitted). A sending
   * number is needed for texts; a Verify Service SID is needed for booking verification — at least one of the two.
   * ANY change clears the Verify validation: new credentials are untested credentials.
   *
   * Phone & Messaging guide §5 (Oct 30 2026) — validate FIRST, then write ATOMICALLY:
   *   • an API key SID needs ITS secret: a new or changed SID (or a new Account SID) without a secret is refused —
   *     the old secret belongs to the old key; a secret without a SID is refused;
   *   • a different Account SID needs its own auth token (never the old account's token);
   *   • a new account / token / key / sender is checked with Twilio BEFORE anything is written (the injectable `http`):
   *     wrong credentials, a suspended account, a rejected API key or a number that is not on the account → refused,
   *     the working configuration untouched. Twilio unreachable → refused unless the caller confirms saving unverified;
   *   • the number registry, the credential row, the check result and the audit row are ONE transaction, and the row
   *     must still be the version that was validated (config_version) — a concurrent save is a conflict, not an overwrite.
   */
  async set(actorUserId: string, tenantId: string, input: SetCredentialsInput, branchId?: string | null): Promise<MaskedCredentials> {
    const scope = scopeOf(branchId);
    if (branchId && !scope) throw withCode(new CredentialsInputError('Unknown branch.'), 'BRANCH_NOT_FOUND');
    if (scope && !(await this.branchBelongs(tenantId, scope))) throw withCode(new CredentialsInputError('Unknown branch.'), 'BRANCH_NOT_FOUND');
    const existingEarly = this.db ? await this.row(tenantId, scope, true) : null;   // the save may re-check with the stored secrets
    // PM-02: the form shows the SID masked — a blank or masked SID means "keep the stored one" (never "change it to •…")
    const sidIn = (input.accountSid ?? '').trim();
    const accountSid = (!sidIn || isMaskedSid(sidIn, 'AC')) && existingEarly?.account_sid ? String(existingEarly.account_sid) : sidIn;
    const fromNumber = (input.fromNumber ?? '').trim();
    const authToken = (input.authToken ?? '').trim();
    const verifyServiceSid = input.verifyServiceSid == null ? undefined : String(input.verifyServiceSid).trim();
    const keyIn = input.apiKeySid == null ? undefined : String(input.apiKeySid).trim();
    const apiKeySid = keyIn && isMaskedSid(keyIn, 'SK') ? (existingEarly?.api_key_sid ? String(existingEarly.api_key_sid) : undefined) : keyIn;
    const apiKeySecret = (input.apiKeySecret ?? '').trim();
    if (!accountSid) throw withCode(new CredentialsInputError('accountSid is required'), 'TWILIO_ACCOUNT_SID_INVALID');
    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) throw withCode(new CredentialsInputError('accountSid must be a Twilio Account SID (it starts with AC).'), 'TWILIO_ACCOUNT_SID_INVALID');
    if (fromNumber && !isE164(fromNumber)) throw withCode(new CredentialsInputError('fromNumber must be E.164 (e.g. +18565551234)'), 'PHONE_E164_INVALID');
    if (verifyServiceSid && !isVerifyServiceSid(verifyServiceSid)) throw withCode(new CredentialsInputError('verifyServiceSid must be a Twilio Verify Service SID (it starts with VA).'), 'TWILIO_VERIFY_SID_INVALID');
    if (apiKeySid && !isApiKeySid(apiKeySid)) throw withCode(new CredentialsInputError('apiKeySid must be a Twilio API key SID (it starts with SK).'), 'TWILIO_API_KEY_INVALID');

    const existing = existingEarly;
    const nextFrom = fromNumber || existing?.from_number || '';
    const nextVerify = verifyServiceSid === undefined ? existing?.verify_service_sid ?? '' : verifyServiceSid;
    if (!nextFrom && !nextVerify) throw withCode(new CredentialsInputError('Give a sending number (for texts) or a Verify Service SID (for booking verification).'), 'TWILIO_SENDER_REQUIRED');
    const nextKeySid: string | null = apiKeySid === undefined ? existing?.api_key_sid ?? null : (apiKeySid || null);
    if (apiKeySecret && !nextKeySid) throw withCode(new CredentialsInputError('An API key secret needs its API key SID.'), 'TWILIO_API_KEY_SID_REQUIRED');
    if (!this.db) return { ...this.base(tenantId, scope), status: 'configured', accountSid: maskSid(accountSid), accountSidLast4: accountSid.slice(-4), fromNumber: nextFrom || null, authTokenLast4: authToken ? secretLast4(authToken) : null, verifyServiceSid: nextVerify || null, branchOverride: !!scope };
    if (!authToken && !existing?.auth_token_enc) throw withCode(new CredentialsInputError('authToken is required on first setup'), 'TWILIO_AUTH_TOKEN_REQUIRED');
    const accountChanged = !!existing && String(existing.account_sid ?? '') !== accountSid;
    if (accountChanged && !authToken) throw withCode(new CredentialsInputError('A different Account SID needs its own auth token.'), 'TWILIO_AUTH_TOKEN_REQUIRED_FOR_NEW_ACCOUNT');
    const keyChanged = (nextKeySid ?? null) !== (existing?.api_key_sid ?? null);
    // A SID alone is not an authentication secret: a new / changed key (or a key moved to another account) needs ITS secret.
    if (nextKeySid && !apiKeySecret && (keyChanged || accountChanged || !existing?.api_key_secret_enc)) throw withCode(new CredentialsInputError('Enter the API key secret that matches this API key SID.'), 'TWILIO_API_KEY_SECRET_REQUIRED');

    // ── validate with the provider before anything is written ──
    const senderChanged = !!fromNumber && fromNumber !== (existing?.from_number ?? '');
    const needsCheck = !existing || accountChanged || !!authToken || keyChanged || !!apiKeySecret || senderChanged;
    let check: CheckResult | null = null;
    if (needsCheck) {
      let token = authToken; let keySecret: string | null = apiKeySecret || null;
      try {
        if (!token) token = this.secrets.decrypt(existing.auth_token_enc);
        if (!keySecret && nextKeySid && existing?.api_key_secret_enc && !keyChanged) keySecret = this.secrets.decrypt(existing.api_key_secret_enc);
      } catch (e) {
        logGap('messaging credentials: stored secret could not be decrypted')(e);
        throw withCode(new CredentialsInputError('The stored credentials could not be opened — enter the auth token again.'), 'TWILIO_AUTH_TOKEN_REQUIRED');
      }
      check = await runProviderChecks(this.http, { accountSid, authToken: token, apiKeySid: nextKeySid, apiKeySecret: keySecret, fromNumber: nextFrom || null, verifyServiceSid: null },
        { checkVerify: false, expectedInbound: expectedInboundUrl() });
      if (check.account.state === 'invalid') {
        const rc = check.account.reasonCode;
        const code = rc === 'TWILIO_ACCOUNT_NOT_FOUND' ? 'TWILIO_ACCOUNT_NOT_FOUND' : rc === 'TWILIO_WRONG_ACCOUNT' ? 'TWILIO_WRONG_ACCOUNT'
          : rc === 'TWILIO_ACCOUNT_SUSPENDED' || rc === 'TWILIO_ACCOUNT_CLOSED' ? 'TWILIO_ACCOUNT_SUSPENDED' : 'TWILIO_AUTH_FAILED';
        throw withCode(new CredentialsInputError('Twilio did not accept these credentials. Nothing was changed.'), code);
      }
      // OPS-01: a key that authenticated but lacks the numbers-read scope ("limited") is NOT a rejected key
      if (check.apiKey.state === 'invalid') throw withCode(new CredentialsInputError('Twilio did not accept this API key SID and secret. Nothing was changed.'), 'TWILIO_API_KEY_REJECTED');
      if (check.sender?.state === 'not_owned') throw withCode(new CredentialsInputError('That sending number is not on this Twilio account. Nothing was changed.'), 'TWILIO_NUMBER_NOT_ON_ACCOUNT');
      const unverified = check.account.state !== 'connected' || (!!nextKeySid && check.apiKey.state !== 'connected' && check.apiKey.state !== 'limited') || (!!nextFrom && check.sender?.state !== 'assigned');
      if (unverified && !input.confirmUnverified) throw withCode(new CredentialsInputError('Twilio could not be reached to check these credentials. Nothing was changed.'), 'MESSAGING_PROVIDER_UNREACHABLE', { canSaveUnverified: true });
    }

    const tokenEnc = authToken ? this.secrets.encrypt(authToken) : existing?.auth_token_enc;
    const tokenLast4 = authToken ? secretLast4(authToken) : existing?.auth_token_last4 ?? null;
    const keyEnc = !nextKeySid ? null : apiKeySecret ? this.secrets.encrypt(apiKeySecret) : existing?.api_key_secret_enc ?? null;
    const unverifiedSave = !!(check && input.confirmUnverified && check.account.state !== 'connected');

    await this.db.transaction().execute(async (trx) => {
      // Security fix E1 (Oct 23 2026): the registry through THE number write path, which refuses a number registered to
      // another salon — in the SAME transaction as the credentials, so a refused number leaves nothing behind.
      if (fromNumber) {
        const reg = await registerTenantNumber(trx as unknown as AppDatabase, { tenantId, phoneNumber: fromNumber, actorUserId });
        if (!reg.ok) throw withCode(new CredentialsInputError(reg.error), 'MESSAGING_NUMBER_TAKEN');
      }
      let saved: any;
      if (existing) {
        const r: any = await sql`UPDATE tenant_messaging_credentials SET account_sid = ${accountSid}, from_number = ${nextFrom || null}, auth_token_enc = ${tokenEnc},
            auth_token_last4 = ${tokenLast4}, verify_service_sid = ${nextVerify || null}, api_key_sid = ${nextKeySid}, api_key_secret_enc = ${keyEnc},
            status = 'configured', last_validated_at = NULL, last_validation_error = NULL, updated_by_user_id = ${actorOf(actorUserId)}, updated_at = now(), config_version = config_version + 1
          WHERE tenant_id = ${tenantId} AND id = ${existing.id} AND config_version = ${Number(existing.config_version ?? 0)} AND ${canMoveToSql(TENANT_MESSAGING_CREDENTIALS, 'configured')} RETURNING *`.execute(trx);
        saved = r.rows?.[0];
        if (!saved) throw withCode(new CredentialsInputError('Someone else changed these settings. Refresh and try again.'), 'VERSION_CONFLICT');
      } else {
        const r: any = await sql`INSERT INTO tenant_messaging_credentials (tenant_id, branch_id, provider, account_sid, auth_token_enc, auth_token_last4, from_number,
            verify_service_sid, api_key_sid, api_key_secret_enc, status, updated_by_user_id)
          VALUES (${tenantId}, ${scope}, 'twilio', ${accountSid}, ${tokenEnc}, ${tokenLast4}, ${nextFrom || null}, ${nextVerify || null}, ${nextKeySid}, ${keyEnc}, 'configured', ${actorOf(actorUserId)}) RETURNING *`.execute(trx);
        saved = r.rows?.[0];
      }
      if (check) await recordHealthCheck(trx as unknown as AppDatabase, { tenantId, branchId: scope, source: scope ? 'branch_override' : 'tenant_default', fingerprint: configFingerprint(saved), actorUserId, trigger: 'save', fromNumber: nextFrom || null, result: check });
      // fail-closed audit in the same transaction: metadata only — never a token or a key secret
      await recordAuditStrict(trx, { tenantId, userId: actorUserId, branchId: scope }, {
        module: 'messaging', action: 'tenant_credentials.updated', resourceType: 'tenant_messaging_credentials', resourceId: scope ?? tenantId,
        summary: scope ? 'Branch Twilio credentials updated' : 'Salon Twilio credentials updated',
        metadata: { provider: 'twilio', branchId: scope, accountSidLast4: accountSid.slice(-4), fromNumber: nextFrom || null, verifyServiceSid: nextVerify || null, apiKeySidLast4: nextKeySid ? nextKeySid.slice(-4) : null,
          tokenRotated: !!authToken, apiKeyRotated: !!apiKeySecret, providerCheck: check ? check.account.state : 'not_needed', savedUnverified: unverifiedSave },
      });
    });
    return this.getMasked(tenantId, scope);
  }

  /** Disconnect: remove this scope's credentials (a branch then inherits the salon default again). */
  async disconnect(actorUserId: string, tenantId: string, branchId?: string | null): Promise<{ ok: boolean }> {
    const scope = scopeOf(branchId);
    if (branchId && !scope) throw withCode(new CredentialsInputError('Unknown branch.'), 'BRANCH_NOT_FOUND');
    if (!this.db) return { ok: false };
    const r: any = await sql`DELETE FROM tenant_messaging_credentials WHERE tenant_id = ${tenantId} AND provider = 'twilio'
      AND ${scope ? sql`branch_id = ${scope}::uuid` : sql`branch_id IS NULL`} RETURNING id`.execute(this.db);
    const ok = (r.rows?.length ?? 0) > 0;
    if (ok) {
      await this.audit.record({ tenantId, userId: actorUserId }, {
        module: 'messaging', action: 'tenant_credentials.disconnected', resourceType: 'tenant_messaging_credentials', resourceId: scope ?? tenantId,
        summary: scope ? 'Branch Twilio disconnected' : 'Salon Twilio disconnected', metadata: { provider: 'twilio', branchId: scope },
      }).catch(() => undefined);
    }
    return { ok };
  }

  /**
   * "Test Verify": fetch this scope's Verify Service with its own credentials and RECORD the outcome — the booking
   * verification policy treats a salon as able to verify only after a successful test (`last_validated_at`).
   */
  async testVerify(actorUserId: string, tenantId: string, branchId?: string | null): Promise<{ ok: boolean; friendlyName?: string | null; error?: string; reason?: 'not_configured' | 'no_verify_service' }> {
    const scope = scopeOf(branchId);
    const row = await this.row(tenantId, scope, true);
    if (!row?.account_sid || !row?.auth_token_enc || row.status !== 'configured') return { ok: false, reason: 'not_configured' };
    if (!row.verify_service_sid) return { ok: false, reason: 'no_verify_service', error: 'Add your Verify Service SID first.' };
    let authToken: string; let apiKeySecret: string | null = null;
    try {
      authToken = this.secrets.decrypt(row.auth_token_enc);
      if (row.api_key_sid && row.api_key_secret_enc) apiKeySecret = this.secrets.decrypt(row.api_key_secret_enc);
    } catch { return { ok: false, error: 'Could not decrypt the stored credentials — check PROVIDER_VAULT_KEK in the API environment.' }; }
    const probe = await probeVerifyService({ accountSid: row.account_sid, authToken, apiKeySid: row.api_key_sid, apiKeySecret }, row.verify_service_sid, this.http);
    if (this.db) {
      if (probe.ok) await sql`UPDATE tenant_messaging_credentials SET last_validated_at = now(), last_validation_error = NULL, updated_at = now() WHERE id = ${row.id}`.execute(this.db);
      else await sql`UPDATE tenant_messaging_credentials SET last_validated_at = NULL, last_validation_error = ${probe.error.slice(0, 300)}, updated_at = now() WHERE id = ${row.id}`.execute(this.db);
    }
    await this.audit.record({ tenantId, userId: actorUserId }, {
      module: 'messaging', action: 'tenant_credentials.test_verify', resourceType: 'tenant_messaging_credentials', resourceId: scope ?? tenantId,
      summary: probe.ok ? 'Twilio Verify test passed' : 'Twilio Verify test failed', metadata: { branchId: scope, ok: probe.ok, error: probe.ok ? null : probe.error },
    }).catch(() => undefined);
    return probe.ok ? { ok: true, friendlyName: probe.friendlyName } : { ok: false, error: probe.error };
  }

  /**
   * PM-02: the ONE path that returns a full Account SID — an explicit, privileged reveal (the controller requires
   * settings.edit + a fresh step-up). Recorded fail-closed in the audit trail (metadata: scope + last 4 only).
   */
  async revealAccountSid(actorUserId: string, tenantId: string, branchId?: string | null): Promise<{ accountSid: string | null; branchId: string | null }> {
    const scope = scopeOf(branchId);
    if (branchId && !scope) throw withCode(new CredentialsInputError('Unknown branch.'), 'BRANCH_NOT_FOUND');
    if (!this.db) return { accountSid: null, branchId: scope };
    const row = await this.row(tenantId, scope);
    if (!row?.account_sid) return { accountSid: null, branchId: scope };
    await this.db.transaction().execute(async (trx) => {
      await recordAuditStrict(trx, { tenantId, userId: actorUserId, branchId: scope }, {
        module: 'messaging', action: 'tenant_credentials.sid_revealed', resourceType: 'tenant_messaging_credentials', resourceId: scope ?? tenantId,
        summary: 'Twilio Account SID revealed', metadata: { branchId: scope, accountSidLast4: String(row.account_sid).slice(-4) },
      });
    });
    return { accountSid: String(row.account_sid), branchId: scope };
  }

  /**
   * The configuration a scope actually SENDS with (PM-01): a branch's own row when it has one, else the salon
   * default it inherits. A branch never borrows another branch's credentials — only its own row or the default.
   */
  private async effective(tenantId: string, scope: string | null): Promise<{ row: any | null; source: 'branch_override' | 'tenant_default' | 'none'; rowScope: string | null }> {
    if (scope) { const own = await this.row(tenantId, scope, true); if (own) return { row: own, source: 'branch_override', rowScope: scope }; }
    const def = await this.row(tenantId, null, true);
    return def ? { row: def, source: 'tenant_default', rowScope: null } : { row: null, source: 'none', rowScope: null };
  }

  /**
   * Diagnostic: send ONE real test SMS through the salon's own Twilio account — the salon default, or (PM-01) the
   * EFFECTIVE configuration of an authorized branch (its own row, else the default it inherits) — and record it.
   * Phone & Messaging guide §9: E.164 destination, the readiness the caller requires (a fresh check of THAT
   * configuration), an idempotency key (the same key never sends twice — the first attempt's record comes back), a
   * per-salon hourly limit, and an sms_test_events row (masked destination, branch, which configuration, the account's
   * last 4, sender, provider SID, status, safe error code). "accepted" is what Twilio said at send time; delivered /
   * failed / undelivered only ever come from the signed status callback (twilio-inbound.service.ts).
   * Branch authorization (the actor may act for that branch) is the controller's; the branch must be this salon's.
   * Does not meter credits or touch opt-out state.
   */
  async testSend(actorUserId: string, tenantId: string, toNumber: string, opts: { idempotencyKey?: string | null; requireReady?: boolean; branchId?: string | null; message?: string | null } = {}): Promise<TestSendResult> {
    // Text Messaging Setup guide §10: optional editable test text (plain, ≤ 160 characters, English); otherwise the fixed text
    const custom = testMessageText(opts.message);
    const to = (toNumber ?? '').trim();
    if (!to || !isE164(to)) throw withCode(new CredentialsInputError('destination must be E.164 (e.g. +18565551234)'), 'PHONE_E164_INVALID');
    const scope = scopeOf(opts.branchId);
    if (opts.branchId && !scope) throw withCode(new CredentialsInputError('Unknown branch.'), 'BRANCH_NOT_FOUND');
    if (!this.db) return { ok: false, reason: 'not_configured' };
    const db = this.db;
    if (scope && !(await this.branchBelongs(tenantId, scope))) throw withCode(new CredentialsInputError('Unknown branch.'), 'BRANCH_NOT_FOUND');
    const key = String(opts.idempotencyKey ?? '').trim() || randomUUID();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw withCode(new CredentialsInputError('Invalid request key.'), 'TEST_SMS_IDEMPOTENCY_KEY_REQUIRED');
    const prior: any = await sql`SELECT ${TEST_COLS} FROM sms_test_events t WHERE t.tenant_id = ${tenantId} AND t.idempotency_key = ${key} LIMIT 1`.execute(db);
    if (prior.rows?.[0]) return { ...testView(prior.rows[0]), replayed: true };
    const { row, source, rowScope } = await this.effective(tenantId, scope);
    if (!row?.account_sid || !row?.auth_token_enc || !row?.from_number || row.status !== 'configured') return { ok: false, reason: 'not_configured', branchId: scope, configSource: source };
    const warnings: string[] = [];
    if (opts.requireReady) {
      // the check must be of THIS configuration (the branch's own row's checks, or the default's) — never another scope's
      const chk: any = await sql`SELECT h.account_state, h.account_reason_code, h.sender_state, h.config_fingerprint, h.checked_at FROM tenant_messaging_health_checks h
        WHERE h.tenant_id = ${tenantId} AND ${rowScope ? sql`h.branch_id = ${rowScope}::uuid` : sql`h.branch_id IS NULL`} ORDER BY h.checked_at DESC LIMIT 1`.execute(db);
      const c = chk.rows?.[0];
      const fresh = !!c && c.config_fingerprint === configFingerprint(row) && Date.now() - new Date(c.checked_at).getTime() <= CHECK_STALE_AFTER_MS;
      if (!fresh) throw withCode(new CredentialsInputError('Run a health check first — this configuration has not been checked with Twilio recently.'), 'TEST_SMS_NOT_READY', { reasonCode: c ? 'CHECK_STALE_OR_CHANGED' : 'NEVER_CHECKED' });
      if (c.account_state !== 'connected') throw withCode(new CredentialsInputError('The Twilio account is not connected.'), 'TEST_SMS_NOT_READY', { reasonCode: String(c.account_reason_code ?? 'ACCOUNT_NOT_CONNECTED') });
      if (c.sender_state === 'not_owned') throw withCode(new CredentialsInputError('The sending number is not on this Twilio account.'), 'TEST_SMS_NOT_READY', { reasonCode: 'TWILIO_NUMBER_NOT_ON_ACCOUNT' });
      if (c.sender_state !== 'assigned') warnings.push('SENDER_NOT_CHECKED');
      const a2p: any = await sql`SELECT a.campaign_status FROM tenant_a2p_registrations a WHERE a.tenant_id = ${tenantId} ORDER BY a.updated_at DESC NULLS LAST LIMIT 1`.execute(db);
      if (senderTypeOf(row.from_number) === '10dlc' && mapCampaign(a2p.rows?.[0]?.campaign_status ?? null, false) !== 'approved') warnings.push('A2P_NOT_APPROVED_MAY_BE_FILTERED');
      if (senderTypeOf(row.from_number) === 'toll_free') warnings.push('TOLL_FREE_VERIFICATION_REQUIRED');
    }
    if (!process.env.TWILIO_STATUS_CALLBACK_URL) warnings.push('DELIVERY_NOT_TRACKED');
    const recent: any = await sql`SELECT count(*)::int AS n FROM sms_test_events t WHERE t.tenant_id = ${tenantId} AND t.created_at > now() - interval '1 hour'`.execute(db);
    if (Number(recent.rows?.[0]?.n ?? 0) >= TEST_SMS_PER_HOUR) throw withCode(new CredentialsInputError('Too many test messages this hour.'), 'TEST_SMS_RATE_LIMITED');
    const acLast4 = String(row.account_sid).slice(-4);
    const ins: any = await sql`INSERT INTO sms_test_events (tenant_id, branch_id, idempotency_key, destination_masked, destination_hash, sender, status, warning_codes, created_by_user_id, config_source, account_sid_last4, sender_kind)
      VALUES (${tenantId}, ${scope}, ${key}, ${maskPhone(to)}, ${createHash('sha256').update(tenantId + ':' + to).digest('hex')}, ${row.from_number}, 'sending', ${warnings}::text[], ${actorOf(actorUserId)},
        ${source}, ${acLast4}, 'number')
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`.execute(db);
    if (!ins.rows?.[0]) {   // a concurrent request with the same key won the insert: return ITS record, never send twice
      const again: any = await sql`SELECT ${TEST_COLS} FROM sms_test_events t WHERE t.tenant_id = ${tenantId} AND t.idempotency_key = ${key} LIMIT 1`.execute(db);
      return { ...testView(again.rows[0]), replayed: true };
    }
    const eventId = String(ins.rows[0].id);
    const common = { eventId, branchId: scope, configSource: source, accountSidMasked: maskSid(row.account_sid), sender: String(row.from_number) };
    let token: string;
    try { token = this.secrets.decrypt(row.auth_token_enc); }
    catch (e) {
      logGap('messaging test sms: stored token could not be decrypted')(e);
      await sql`UPDATE sms_test_events e SET status = 'rejected', error_code = 'SECRET_DECRYPT_FAILED', status_updated_at = now() WHERE e.tenant_id = ${tenantId} AND e.id = ${eventId}::uuid AND ${canMoveToSql(SMS_TEST_EVENT, 'rejected', 'e')}`.execute(db);
      return { ok: false, error: 'Could not decrypt the stored token — check PROVIDER_VAULT_KEK in the API environment.', ...common, status: 'rejected', displayState: 'failed', errorCode: 'SECRET_DECRYPT_FAILED' };
    }
    const sender = new TwilioSmsSender({ accountSid: row.account_sid, authToken: token, from: row.from_number }, this.http);
    let result: TestSendResult;
    try {
      const { sid } = await sender.send(to, custom ?? DEFAULT_TEST_TEXT);
      // provider_message_sid is written even if a callback somehow raced ahead; the status only moves forward (SMS_TEST_EVENT)
      await sql`UPDATE sms_test_events e SET provider_message_sid = ${sid}, status = CASE WHEN ${canMoveToSql(SMS_TEST_EVENT, 'accepted', 'e')} THEN 'accepted' ELSE e.status END, status_updated_at = now() WHERE e.tenant_id = ${tenantId} AND e.id = ${eventId}::uuid`.execute(db);
      result = { ok: true, sid, ...common, status: 'accepted', displayState: 'accepted', warnings, destinationMasked: maskPhone(to) };
    } catch (e: any) {
      const code = sendErrorCode(String(e?.message ?? ''));
      await sql`UPDATE sms_test_events e SET status = 'rejected', error_code = ${code}, status_updated_at = now() WHERE e.tenant_id = ${tenantId} AND e.id = ${eventId}::uuid AND ${canMoveToSql(SMS_TEST_EVENT, 'rejected', 'e')}`.execute(db);
      result = { ok: false, error: SEND_ERROR_TEXT[code] ?? SEND_ERROR_TEXT.PROVIDER_REJECTED, ...common, status: 'rejected', displayState: 'failed', errorCode: code, warnings, destinationMasked: maskPhone(to) };
    }
    // A salon WITHOUT a Verify Service sends booking codes as texts from this number (the hashed internal code), so
    // for it the SMS test is the validation the booking policy waits for. With a Verify Service, "Test Verify" is.
    if (!row.verify_service_sid) {
      if (result.ok) await sql`UPDATE tenant_messaging_credentials SET last_validated_at = now(), last_validation_error = NULL WHERE tenant_id = ${tenantId} AND id = ${row.id}`.execute(db);
      else await sql`UPDATE tenant_messaging_credentials SET last_validated_at = NULL, last_validation_error = ${result.errorCode ?? 'send failed'} WHERE tenant_id = ${tenantId} AND id = ${row.id}`.execute(db);
    }
    await this.audit.record({ tenantId, userId: actorUserId }, {
      module: 'messaging', action: 'tenant_credentials.test_send', resourceType: 'sms_test_events', resourceId: eventId,
      summary: result.ok ? 'Test SMS accepted by Twilio' : 'Test SMS refused', metadata: { to: maskPhone(to), ok: result.ok, errorCode: result.errorCode ?? null, warnings, branchId: scope, configSource: source, accountSidLast4: acLast4 },
    }).catch(logGap('messaging test sms: audit write failed'));
    return result;
  }
}

export type TestSendResult = { ok: boolean; sid?: string; error?: string; reason?: 'not_configured'; eventId?: string; status?: string; displayState?: string; errorCode?: string | null; warnings?: string[]; replayed?: boolean; destinationMasked?: string;
  branchId?: string | null; configSource?: string; accountSidMasked?: string | null; sender?: string | null };
/** at most this many test messages per salon per hour (each is a real, billable send) */
export const TEST_SMS_PER_HOUR = 10;
export const DEFAULT_TEST_TEXT = 'AIPowerSalon test message — your Twilio setup is working. (Test only; no reply needed.)';
/** the owner's own test text: trimmed, printable, ≤ 160 characters (one SMS segment's worth of plain text); empty = default */
export function testMessageText(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > 160 || /[\u0000-\u001f\u007f]/.test(t)) throw withCode(new CredentialsInputError('The test text must be plain text of at most 160 characters.'), 'TEST_SMS_TEXT_INVALID');
  return t;
}
export const maskPhone = (n: string) => { const v = String(n ?? ''); return v.length > 4 ? `•••${v.slice(-4)}` : '••••'; };
function testView(r: any): TestSendResult {
  const status = String(r.status);
  return { ok: !['rejected', 'failed', 'undelivered'].includes(status), eventId: String(r.id), status, displayState: testDisplayState(status, r.status_updated_at ? new Date(r.status_updated_at) : null, new Date()),
    errorCode: r.error_code ?? null, destinationMasked: String(r.destination_masked), branchId: r.branch_id ? String(r.branch_id) : null, configSource: r.config_source ?? undefined,
    accountSidMasked: r.account_sid_last4 ? `AC…${r.account_sid_last4}` : null, sender: r.sender ?? null,
    ...(r.provider_message_sid ? { sid: String(r.provider_message_sid) } : {}), warnings: Array.isArray(r.warning_codes) ? r.warning_codes.map(String) : [] };
}
/** a Twilio send refusal → a safe code (the provider text can carry the destination number; it is never stored) */
export function sendErrorCode(msg: string): string {
  if (/authenticat|401|unauthori/i.test(msg)) return 'TWILIO_AUTH_FAILED';
  if (/unverified/i.test(msg)) return 'TRIAL_UNVERIFIED_DESTINATION';
  if (/not a valid phone number|invalid .*to/i.test(msg)) return 'INVALID_DESTINATION';
  if (/From|not a .*Twilio phone number|not owned/i.test(msg)) return 'SENDER_NOT_ON_ACCOUNT';
  if (/blacklist|unsubscribed|opted out|21610/i.test(msg)) return 'DESTINATION_OPTED_OUT';
  if (/fetch failed|ECONN|ENOTFOUND|timeout|network/i.test(msg)) return 'PROVIDER_UNREACHABLE';
  return 'PROVIDER_REJECTED';
}
const SEND_ERROR_TEXT: Record<string, string> = {
  TWILIO_AUTH_FAILED: 'Twilio did not accept the saved credentials.', TRIAL_UNVERIFIED_DESTINATION: 'A trial Twilio account can only text numbers verified in its console.',
  INVALID_DESTINATION: 'Twilio says the destination is not a valid mobile number.', SENDER_NOT_ON_ACCOUNT: 'The sending number is not on this Twilio account.',
  DESTINATION_OPTED_OUT: 'That phone has opted out of texts from this number (it can text START).', PROVIDER_UNREACHABLE: 'Twilio could not be reached.', PROVIDER_REJECTED: 'Twilio refused the message.',
};
