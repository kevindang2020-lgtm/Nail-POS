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
import { TENANT_MESSAGING_CREDENTIALS } from '../communications-lifecycles';

export type MaskedCredentials = TenantTwilioCredentialsView;   // the wire shape lives in @aipowersalon/api-contracts
export interface SetCredentialsInput {
  accountSid?: string; authToken?: string; fromNumber?: string;
  verifyServiceSid?: string | null; apiKeySid?: string | null; apiKeySecret?: string | null;
}

function isE164(n: string): boolean { return /^\+[1-9]\d{6,15}$/.test(n); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const scopeOf = (branchId?: string | null): string | null => (branchId && UUID.test(branchId) ? branchId : null);
/** `updated_by_user_id` is a uuid; a caller without a real user id (the Super Admin controller's fallback) records none. */
const actorOf = (id: string): string | null => (UUID.test(String(id ?? '')) ? id : null);

export class CredentialsInputError extends Error {}

@Injectable()
export class TenantMessagingCredentialsService {
  // Credentials through the ProviderSecrets port (Constitution 13 §94) — never the key ring directly.
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null, private readonly audit: AuditService, @Inject(PROVIDER_SECRETS) private readonly secrets: ProviderSecrets) {}
  /** The HTTP client for the Verify probe (tests swap it; not a DI dependency). */
  http: typeof fetch = (...a) => fetch(...a);

  private base(tenantId: string, branchId: string | null): MaskedCredentials {
    return { tenantId, branchId, provider: 'twilio', status: 'not_configured', accountSid: null, fromNumber: null, authTokenLast4: null,
      verifyServiceSid: null, apiKeySid: null, hasApiKeySecret: false, lastValidatedAt: null, lastValidationError: null, branchOverride: false };
  }

  /** This scope's own row (exactly; a branch row is never confused with the default). */
  private async row(tenantId: string, branchId: string | null): Promise<any | null> {
    if (!this.db) return null;
    const r: any = await sql`SELECT * FROM tenant_messaging_credentials WHERE tenant_id = ${tenantId} AND provider = 'twilio'
      AND ${branchId ? sql`branch_id = ${branchId}::uuid` : sql`branch_id IS NULL`} LIMIT 1`.execute(this.db as any);
    return r.rows?.[0] ?? null;
  }

  private mask(tenantId: string, branchId: string | null, r: any, branchOverride: boolean): MaskedCredentials {
    return {
      tenantId, branchId, provider: 'twilio', status: r.status === 'configured' ? 'configured' : 'not_configured',
      accountSid: r.account_sid ?? null, fromNumber: r.from_number ?? null, authTokenLast4: r.auth_token_last4 ?? null,
      verifyServiceSid: r.verify_service_sid ?? null, apiKeySid: r.api_key_sid ?? null, hasApiKeySecret: !!r.api_key_secret_enc,
      lastValidatedAt: r.last_validated_at ? new Date(r.last_validated_at).toISOString() : null,
      lastValidationError: r.last_validation_error ?? null, branchOverride,
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
      WHERE tenant_id = ${tenantId} AND provider = 'twilio' AND branch_id IS NOT NULL ORDER BY created_at`.execute(this.db as any);
    return (r.rows ?? []).map((x: any) => ({ branchId: String(x.branch_id), status: String(x.status), verifyServiceSid: x.verify_service_sid ?? null,
      lastValidatedAt: x.last_validated_at ? new Date(x.last_validated_at).toISOString() : null }));
  }

  private async branchBelongs(tenantId: string, branchId: string): Promise<boolean> {
    if (!this.db) return true;
    const r: any = await sql`SELECT 1 FROM branches WHERE id = ${branchId}::uuid AND tenant_id = ${tenantId} LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (r.rows?.length ?? 0) > 0;
  }

  /**
   * Set or update the salon's (or a branch's) Twilio. Secrets are optional on update (kept when omitted). A sending
   * number is needed for texts; a Verify Service SID is needed for booking verification — at least one of the two.
   * ANY change clears the validation: new credentials are untested credentials.
   */
  async set(actorUserId: string, tenantId: string, input: SetCredentialsInput, branchId?: string | null): Promise<MaskedCredentials> {
    const scope = scopeOf(branchId);
    if (branchId && !scope) throw new CredentialsInputError('Unknown branch.');
    if (scope && !(await this.branchBelongs(tenantId, scope))) throw new CredentialsInputError('Unknown branch.');
    const accountSid = (input.accountSid ?? '').trim();
    const fromNumber = (input.fromNumber ?? '').trim();
    const authToken = (input.authToken ?? '').trim();
    const verifyServiceSid = input.verifyServiceSid == null ? undefined : String(input.verifyServiceSid).trim();
    const apiKeySid = input.apiKeySid == null ? undefined : String(input.apiKeySid).trim();
    const apiKeySecret = (input.apiKeySecret ?? '').trim();
    if (!accountSid) throw new CredentialsInputError('accountSid is required');
    if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) throw new CredentialsInputError('accountSid must be a Twilio Account SID (it starts with AC).');
    if (fromNumber && !isE164(fromNumber)) throw new CredentialsInputError('fromNumber must be E.164 (e.g. +18565551234)');
    if (verifyServiceSid && !isVerifyServiceSid(verifyServiceSid)) throw new CredentialsInputError('verifyServiceSid must be a Twilio Verify Service SID (it starts with VA).');
    if (apiKeySid && !isApiKeySid(apiKeySid)) throw new CredentialsInputError('apiKeySid must be a Twilio API key SID (it starts with SK).');

    const existing = await this.row(tenantId, scope);
    const nextFrom = fromNumber || existing?.from_number || '';
    const nextVerify = verifyServiceSid === undefined ? existing?.verify_service_sid ?? '' : verifyServiceSid;
    if (!nextFrom && !nextVerify) throw new CredentialsInputError('Give a sending number (for texts) or a Verify Service SID (for booking verification).');
    if (!this.db) return { ...this.base(tenantId, scope), status: 'configured', accountSid, fromNumber: nextFrom || null, authTokenLast4: authToken ? secretLast4(authToken) : null, verifyServiceSid: nextVerify || null, branchOverride: !!scope };
    if (!authToken && !existing?.auth_token_enc) throw new CredentialsInputError('authToken is required on first setup');
    const nextKeySid = apiKeySid === undefined ? existing?.api_key_sid ?? null : (apiKeySid || null);
    if (nextKeySid && !apiKeySecret && !existing?.api_key_secret_enc) throw new CredentialsInputError('apiKeySecret is required with an API key.');

    const tokenEnc = authToken ? this.secrets.encrypt(authToken) : existing?.auth_token_enc;
    const tokenLast4 = authToken ? secretLast4(authToken) : existing?.auth_token_last4 ?? null;
    const keyEnc = !nextKeySid ? null : apiKeySecret ? this.secrets.encrypt(apiKeySecret) : existing?.api_key_secret_enc ?? null;

    if (existing) {
      await sql`UPDATE tenant_messaging_credentials SET account_sid = ${accountSid}, from_number = ${nextFrom || null}, auth_token_enc = ${tokenEnc},
          auth_token_last4 = ${tokenLast4}, verify_service_sid = ${nextVerify || null}, api_key_sid = ${nextKeySid}, api_key_secret_enc = ${keyEnc},
          status = 'configured', last_validated_at = NULL, last_validation_error = NULL, updated_by_user_id = ${actorOf(actorUserId)}, updated_at = now()
        WHERE id = ${existing.id} AND ${canMoveToSql(TENANT_MESSAGING_CREDENTIALS, 'configured')}`.execute(this.db as any);
    } else {
      await sql`INSERT INTO tenant_messaging_credentials (tenant_id, branch_id, provider, account_sid, auth_token_enc, auth_token_last4, from_number,
          verify_service_sid, api_key_sid, api_key_secret_enc, status, updated_by_user_id)
        VALUES (${tenantId}, ${scope}, 'twilio', ${accountSid}, ${tokenEnc}, ${tokenLast4}, ${nextFrom || null}, ${nextVerify || null}, ${nextKeySid}, ${keyEnc}, 'configured', ${actorOf(actorUserId)})`.execute(this.db as any);
    }
    // Keep the number registry in sync so inbound routing + per-tenant send agree on this tenant's number.
    if (nextFrom) await sql`INSERT INTO tenant_messaging_numbers (tenant_id, phone_number, channel, provider) VALUES (${tenantId}, ${nextFrom}, 'sms', 'twilio') ON CONFLICT (phone_number) DO UPDATE SET tenant_id = ${tenantId}`.execute(this.db as any).catch(() => undefined);

    await this.audit.record({ tenantId, userId: actorUserId } as any, {
      module: 'messaging', action: 'tenant_credentials.updated', resourceType: 'tenant_messaging_credentials', resourceId: scope ?? tenantId,
      summary: scope ? 'Branch Twilio credentials updated' : 'Salon Twilio credentials updated',
      metadata: { provider: 'twilio', branchId: scope, accountSid, fromNumber: nextFrom || null, verifyServiceSid: nextVerify || null, apiKeySid: nextKeySid, tokenRotated: !!authToken, apiKeyRotated: !!apiKeySecret },
    }).catch(() => undefined);
    return this.getMasked(tenantId, scope);
  }

  /** Disconnect: remove this scope's credentials (a branch then inherits the salon default again). */
  async disconnect(actorUserId: string, tenantId: string, branchId?: string | null): Promise<{ ok: boolean }> {
    const scope = scopeOf(branchId);
    if (branchId && !scope) throw new CredentialsInputError('Unknown branch.');
    if (!this.db) return { ok: false };
    const r: any = await sql`DELETE FROM tenant_messaging_credentials WHERE tenant_id = ${tenantId} AND provider = 'twilio'
      AND ${scope ? sql`branch_id = ${scope}::uuid` : sql`branch_id IS NULL`} RETURNING id`.execute(this.db as any);
    const ok = (r.rows?.length ?? 0) > 0;
    if (ok) {
      await this.audit.record({ tenantId, userId: actorUserId } as any, {
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
    const row = await this.row(tenantId, scope);
    if (!row?.account_sid || !row?.auth_token_enc || row.status !== 'configured') return { ok: false, reason: 'not_configured' };
    if (!row.verify_service_sid) return { ok: false, reason: 'no_verify_service', error: 'Add your Verify Service SID first.' };
    let authToken: string; let apiKeySecret: string | null = null;
    try {
      authToken = this.secrets.decrypt(row.auth_token_enc);
      if (row.api_key_sid && row.api_key_secret_enc) apiKeySecret = this.secrets.decrypt(row.api_key_secret_enc);
    } catch { return { ok: false, error: 'Could not decrypt the stored credentials — check PROVIDER_VAULT_KEK in the API environment.' }; }
    const probe = await probeVerifyService({ accountSid: row.account_sid, authToken, apiKeySid: row.api_key_sid, apiKeySecret }, row.verify_service_sid, this.http);
    if (this.db) {
      if (probe.ok) await sql`UPDATE tenant_messaging_credentials SET last_validated_at = now(), last_validation_error = NULL, updated_at = now() WHERE id = ${row.id}`.execute(this.db as any);
      else await sql`UPDATE tenant_messaging_credentials SET last_validated_at = NULL, last_validation_error = ${probe.error.slice(0, 300)}, updated_at = now() WHERE id = ${row.id}`.execute(this.db as any);
    }
    await this.audit.record({ tenantId, userId: actorUserId } as any, {
      module: 'messaging', action: 'tenant_credentials.test_verify', resourceType: 'tenant_messaging_credentials', resourceId: scope ?? tenantId,
      summary: probe.ok ? 'Twilio Verify test passed' : 'Twilio Verify test failed', metadata: { branchId: scope, ok: probe.ok, error: probe.ok ? null : probe.error },
    }).catch(() => undefined);
    return probe.ok ? { ok: true, friendlyName: probe.friendlyName } : { ok: false, error: probe.error };
  }

  /**
   * Diagnostic: send a real test SMS through THIS salon's own Twilio account (the salon default) and report the honest
   * outcome. Does not meter credits or touch opt-out state.
   */
  async testSend(actorUserId: string, tenantId: string, toNumber: string): Promise<{ ok: boolean; sid?: string; error?: string; reason?: 'not_configured' }> {
    const to = (toNumber ?? '').trim();
    if (!to || !isE164(to)) throw new CredentialsInputError('destination must be E.164 (e.g. +18565551234)');
    if (!this.db) return { ok: false, reason: 'not_configured' };
    const row = await this.row(tenantId, null);
    if (!row?.account_sid || !row?.auth_token_enc || !row?.from_number || row.status !== 'configured') return { ok: false, reason: 'not_configured' };
    let token: string;
    try { token = this.secrets.decrypt(row.auth_token_enc); } catch { return { ok: false, error: 'Could not decrypt the stored token — check PROVIDER_VAULT_KEK in the API environment.' }; }
    const sender = new TwilioSmsSender({ accountSid: row.account_sid, authToken: token, from: row.from_number });
    let result: { ok: boolean; sid?: string; error?: string };
    try {
      const { sid } = await sender.send(to, 'AIPowerSalon test message — your Twilio setup is working.');
      result = { ok: true, sid };
    } catch (e: any) {
      result = { ok: false, error: String(e?.message || 'send failed').replace(/^sms_failed:/, '') };
    }
    // A salon WITHOUT a Verify Service sends booking codes as texts from this number (the hashed internal code), so
    // for it the SMS test is the validation the booking policy waits for. With a Verify Service, "Test Verify" is.
    if (!row.verify_service_sid) {
      if (result.ok) await sql`UPDATE tenant_messaging_credentials SET last_validated_at = now(), last_validation_error = NULL, updated_at = now() WHERE id = ${row.id}`.execute(this.db as any).catch(() => undefined);
      else await sql`UPDATE tenant_messaging_credentials SET last_validated_at = NULL, last_validation_error = ${String(result.error ?? 'send failed').slice(0, 300)}, updated_at = now() WHERE id = ${row.id}`.execute(this.db as any).catch(() => undefined);
    }
    await this.audit.record({ tenantId, userId: actorUserId } as any, {
      module: 'messaging', action: 'tenant_credentials.test_send', resourceType: 'tenant_messaging_credentials', resourceId: tenantId,
      summary: result.ok ? 'Test SMS sent successfully' : 'Test SMS failed', metadata: { to, ok: result.ok, error: result.error ?? null },
    }).catch(() => undefined);
    return result;
  }
}
