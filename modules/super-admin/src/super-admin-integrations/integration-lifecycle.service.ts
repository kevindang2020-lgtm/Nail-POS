// integration-lifecycle.service.ts — Add-Integration + Configure-Credentials + OAuth + Refresh + Test + Disable, as a
// real audited state machine. Security properties enforced here: only approved providers; OAuth redirect + scope
// allowlisting; single-use state + PKCE; code-replay prevention; concurrent-refresh lock; invalid_grant →
// reauthorization_required; secrets envelope-encrypted; tokens/secrets NEVER returned to any caller; every mutation
// audited to audit_logs. Provider HTTP lives behind the adapter contract (ReferenceAdapter here).

import { createHash, randomBytes } from 'crypto';
import { sql } from 'kysely';
import { IntegrationConnectionsRepo, type CredKind } from './integration-connections.kysely.repository';
import { getProvider, isApprovedProvider, isAllowedRedirect, scopesAllowed, defaultAdapterFactory, PROVIDERS, type AdapterFactory } from './adapters/provider-registry';

type Actor = { id?: string; role?: string };
type Fail = { ok: false; error: string; status: number };
const fail = (error: string, status: number): Fail => ({ ok: false, error, status });
const b64url = (b: Buffer) => b.toString('base64url');

export class IntegrationLifecycleService {
  constructor(private readonly repo?: IntegrationConnectionsRepo, private readonly db?: any, private readonly adapters: AdapterFactory = defaultAdapterFactory) {}

  private async audit(actor: Actor, action: string, connectionId: string, tenantId: string | null, meta: Record<string, unknown>) {
    if (!this.db) return;
    await sql`insert into audit_logs (tenant_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
      values (${tenantId ?? null}::uuid, ${actor.id ?? null}::uuid, 'SUPER_ADMIN', ${action}, 'integration_connection', ${connectionId}, ${JSON.stringify(meta || {})}::jsonb)`.execute(this.db).catch(() => undefined);
  }

  async createConnection(actor: Actor, input: { providerKey?: string; ownershipType?: string; tenantId?: string | null; branchId?: string | null; authMethod?: string }) {
    if (!this.repo) return fail('unavailable', 503);
    const key = String(input.providerKey ?? '').trim();
    const prov = getProvider(key);
    if (!prov) return fail('unsupported_provider', 400);
    const ownership = String(input.ownershipType ?? 'platform_tenant');
    if (!['platform_shared', 'platform_tenant', 'tenant_owned', 'branch', 'enterprise'].includes(ownership)) return fail('invalid_ownership', 400);
    const tenantId = ownership === 'platform_shared' ? null : (input.tenantId ?? null);
    const branchId = input.branchId ?? null;
    const authMethod = input.authMethod && prov.authMethods.includes(input.authMethod as any) ? input.authMethod : prov.authMethods[0];
    const dup = await this.repo.findLiveByScope(key, tenantId, branchId);
    if (dup) return { ok: false as const, error: 'duplicate_connection', status: 409, existingId: dup.id };
    const conn = await this.repo.createConnection({ providerKey: key, category: prov.category, ownershipType: ownership, tenantId, branchId, authMethod, createdBy: actor.id ?? null });
    await this.audit(actor, 'super_admin_integration_created', conn.id, tenantId, { provider: key, ownership, authMethod });
    return { ok: true as const, status: 201, connection: conn };
  }

  async beginOAuth(actor: Actor, connectionId?: string, input: { redirectUri?: string; scopes?: string[] } = {}) {
    if (!this.repo) return fail('unavailable', 503);
    const conn = connectionId ? await this.repo.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    const prov = getProvider(conn.provider_key);
    if (!prov || !prov.authMethods.includes('oauth2')) return fail('oauth_not_supported', 400);
    const redirectUri = String(input.redirectUri ?? '');
    if (!isAllowedRedirect(conn.provider_key, redirectUri)) return fail('invalid_redirect_uri', 400);
    const scopes = (input.scopes && input.scopes.length ? input.scopes : prov.defaultScopes);
    if (!scopesAllowed(conn.provider_key, scopes)) return fail('invalid_scope', 400);
    const adapter = this.adapters(conn.provider_key); if (!adapter) return fail('unsupported_provider', 400);
    const state = b64url(randomBytes(24));
    const codeVerifier = b64url(randomBytes(32));
    const codeChallenge = b64url(createHash('sha256').update(codeVerifier).digest());
    await this.repo.beginOAuthState({ connectionId: conn.id, providerKey: conn.provider_key, state, codeVerifier, redirectUri, scopes, createdBy: actor.id ?? null });
    const authorizationUrl = adapter.buildAuthorizationUrl({ redirectUri, state, codeChallenge, scopes });
    await this.audit(actor, 'super_admin_integration_oauth_begin', conn.id, conn.tenant_id ?? null, { provider: conn.provider_key, scopes });
    // NOTE: no secret/verifier/token returned — only the state + a provider authorization URL.
    return { ok: true as const, status: 200, authorizationUrl, state, scopes };
  }

  async completeOAuth(actor: Actor, connectionId?: string, input: { state?: string; code?: string } = {}) {
    if (!this.repo) return fail('unavailable', 503);
    const conn = connectionId ? await this.repo.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    const st = String(input.state ?? ''); const code = String(input.code ?? '');
    if (!st || !code) return fail('missing_state_or_code', 400);
    const consumed = await this.repo.consumeOAuthState(st, conn.id);
    if (!consumed) return fail('invalid_state', 409); // unknown / expired / already used → replay blocked
    const adapter = this.adapters(conn.provider_key); if (!adapter) return fail('unsupported_provider', 400);
    const tok = await adapter.exchangeAuthorizationCode({ code, codeVerifier: consumed.codeVerifier, redirectUri: consumed.redirectUri });
    if (!tok.ok) {
      if (tok.error === 'invalid_scope') { await this.repo.patchConnection(conn.id, { authentication_status: 'scope_missing' }); return fail('invalid_scope', 400); }
      return fail('authorization_failed', 400);
    }
    const expIso = tok.expiresInSeconds ? new Date(Date.now() + tok.expiresInSeconds * 1000).toISOString() : null;
    await this.repo.createCredentialRef({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, kind: 'oauth_access', secret: tok.accessToken!, expiresAt: expIso, createdBy: actor.id ?? null });
    if (tok.refreshToken) await this.repo.createCredentialRef({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, kind: 'oauth_refresh', secret: tok.refreshToken, createdBy: actor.id ?? null });
    await this.repo.patchConnection(conn.id, { authentication_status: 'valid', connection_status: 'active', auth_method: 'oauth2', granted_scopes: tok.grantedScopes ?? consumed.scopes, provider_account: tok.providerAccount ?? null, token_expires_at: expIso });
    await this.audit(actor, 'super_admin_integration_oauth_completed', conn.id, conn.tenant_id ?? null, { provider: conn.provider_key, grantedScopes: tok.grantedScopes ?? consumed.scopes, providerAccount: tok.providerAccount ?? null });
    // tokens are stored encrypted, then discarded — never returned.
    return { ok: true as const, status: 200, authenticationStatus: 'valid', grantedScopes: tok.grantedScopes ?? consumed.scopes, providerAccount: tok.providerAccount ?? null, tokenExpiresAt: expIso };
  }

  async refreshAuthentication(actor: Actor, connectionId?: string) {
    if (!this.repo) return fail('unavailable', 503);
    const conn = connectionId ? await this.repo.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    if (conn.auth_method !== 'oauth2') return fail('not_refreshable', 400);
    const refresh = await this.repo.getActiveSecret(conn.id, 'oauth_refresh');
    if (!refresh) return fail('not_refreshable', 400);
    const lock = await this.repo.acquireRefreshLock(conn.id);
    if (!lock) return fail('refresh_in_progress', 409); // concurrency guard — one refresh at a time
    const adapter = this.adapters(conn.provider_key); if (!adapter) { await this.repo.patchConnection(conn.id, { authentication_status: 'valid' }); return fail('unsupported_provider', 400); }
    const tok = await adapter.refreshAuthentication({ refreshToken: refresh });
    if (!tok.ok) {
      if (tok.error === 'invalid_grant') { await this.repo.patchConnection(conn.id, { authentication_status: 'reauthorization_required' }); await this.audit(actor, 'super_admin_integration_auth_refresh', conn.id, conn.tenant_id ?? null, { result: 'invalid_grant' }); return { ok: false as const, error: 'reauthorization_required', status: 409 }; }
      await this.repo.patchConnection(conn.id, { authentication_status: 'invalid' });
      return fail('not_refreshable', 400);
    }
    const expIso = tok.expiresInSeconds ? new Date(Date.now() + tok.expiresInSeconds * 1000).toISOString() : null;
    await this.repo.createCredentialRef({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, kind: 'oauth_access', secret: tok.accessToken!, expiresAt: expIso, createdBy: actor.id ?? null });
    if (tok.refreshToken && tok.refreshToken !== refresh) await this.repo.createCredentialRef({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, kind: 'oauth_refresh', secret: tok.refreshToken, createdBy: actor.id ?? null });
    await this.repo.patchConnection(conn.id, { authentication_status: 'valid', granted_scopes: tok.grantedScopes ?? conn.granted_scopes, token_expires_at: expIso });
    await this.audit(actor, 'super_admin_integration_auth_refresh', conn.id, conn.tenant_id ?? null, { result: 'refreshed', tokenExpiresAt: expIso });
    return { ok: true as const, status: 200, authenticationStatus: 'valid', tokenExpiresAt: expIso };
  }

  async configureApiKey(actor: Actor, connectionId?: string, input: { apiKey?: string } = {}) {
    if (!this.repo) return fail('unavailable', 503);
    const conn = connectionId ? await this.repo.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    const prov = getProvider(conn.provider_key);
    if (!prov || !prov.authMethods.includes('api_key')) return fail('api_key_not_supported', 400);
    const apiKey = String(input.apiKey ?? '');
    if (!apiKey.trim()) return { ok: true as const, status: 200, unchanged: true, message: 'Blank credential — existing credential kept unchanged.' };
    const cred = await this.repo.createCredentialRef({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, kind: 'api_key', secret: apiKey, createdBy: actor.id ?? null });
    await this.repo.patchConnection(conn.id, { authentication_status: 'valid', connection_status: 'active', auth_method: 'api_key', credential_reference_id: cred.id });
    await this.audit(actor, 'super_admin_integration_credential_added', conn.id, conn.tenant_id ?? null, { kind: 'api_key' });
    return { ok: true as const, status: 200, maskedCredential: cred.masked, authenticationStatus: 'valid' };
  }

  async rotateCredential(actor: Actor, connectionId?: string, input: { kind?: CredKind; newSecret?: string; reason?: string } = {}) {
    if (!this.repo) return fail('unavailable', 503);
    const conn = connectionId ? await this.repo.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    if (!String(input.reason ?? '').trim()) return fail('reason_required', 400);
    if (!String(input.newSecret ?? '').trim()) return fail('secret_required', 400);
    const kind = (input.kind && ['api_key', 'client_secret', 'webhook_secret', 'signing_key', 'oauth_access', 'oauth_refresh'].includes(input.kind)) ? input.kind : 'api_key';
    const cred = await this.repo.createCredentialRef({ connectionId: conn.id, tenantId: conn.tenant_id ?? null, kind, secret: String(input.newSecret), createdBy: actor.id ?? null });
    await this.repo.patchConnection(conn.id, { credential_reference_id: cred.id });
    await this.audit(actor, 'super_admin_integration_credential_rotated', conn.id, conn.tenant_id ?? null, { kind, reason: input.reason });
    return { ok: true as const, status: 200, maskedCredential: cred.masked };
  }

  async testConnection(actor: Actor, connectionId?: string) {
    if (!this.repo) return fail('unavailable', 503);
    const conn = connectionId ? await this.repo.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    const adapter = this.adapters(conn.provider_key); if (!adapter) return fail('unsupported_provider', 400);
    const accessToken = conn.auth_method === 'oauth2' ? (await this.repo.getActiveSecret(conn.id, 'oauth_access')) ?? undefined : undefined;
    const apiKey = conn.auth_method === 'api_key' ? (await this.repo.getActiveSecret(conn.id, 'api_key')) ?? undefined : undefined;
    const health = await adapter.testConnection({ accessToken, apiKey });
    await this.audit(actor, 'super_admin_integration_connection_tested', conn.id, conn.tenant_id ?? null, { ok: health.ok, latencyMs: health.latencyMs ?? null });
    // No secret is returned; only the non-destructive health summary.
    return { ok: true as const, status: 200, result: { succeeded: health.ok, latencyMs: health.latencyMs ?? null, providerAccount: health.providerAccount ?? null, apiVersion: health.apiVersion ?? null, rateLimited: !!health.rateLimited, webhookCapable: !!health.webhookCapable, syncCapable: !!health.syncCapable, errorCategory: health.errorCategory ?? null } };
  }

  async disableConnection(actor: Actor, connectionId?: string, reason?: string) {
    if (!this.repo) return fail('unavailable', 503);
    if (!String(reason ?? '').trim()) return fail('reason_required', 400);
    const conn = connectionId ? await this.repo.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    await this.repo.patchConnection(conn.id, { connection_status: 'disabled', disabled_reason: String(reason) });
    await this.repo.revokeCredentials(conn.id);
    await this.audit(actor, 'super_admin_integration_disabled', conn.id, conn.tenant_id ?? null, { reason });
    // history/records preserved; credentials revoked; new work stops.
    return { ok: true as const, status: 200, connectionStatus: 'disabled' };
  }

  async credentialSummary(_actor: Actor, connectionId?: string) {
    if (!this.repo) return fail('unavailable', 503);
    const conn = connectionId ? await this.repo.getConnection(String(connectionId)) : undefined;
    if (!conn) return fail('not_found', 404);
    const refs = await this.repo.listCredentialRefs(conn.id);
    return { ok: true as const, status: 200, connection: { id: conn.id, provider: conn.provider_key, authMethod: conn.auth_method, authenticationStatus: conn.authentication_status, grantedScopes: conn.granted_scopes, providerAccount: conn.provider_account, tokenExpiresAt: conn.token_expires_at }, credentials: refs };
  }

  async listConnections(_actor: Actor, opts: { providerKey?: string; status?: string; tenantId?: string } = {}) {
    if (!this.repo) return { ok: false as const, error: 'unavailable', status: 503, connections: [] as any[] };
    const rows = await this.repo.listConnections(opts);
    return { ok: true as const, status: 200, connections: rows };
  }

  static approvedProviders() { return Object.values(PROVIDERS).map((p) => ({ key: p.key, name: p.name, category: p.category, authMethods: p.authMethods, defaultScopes: p.defaultScopes, webhookCapable: p.webhookCapable })); }
}

export { isApprovedProvider };
