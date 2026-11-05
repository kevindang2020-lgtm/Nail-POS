// integration-connections.kysely.repository.ts — raw-SQL persistence for the generic integration connection
// lifecycle (integration_connections / integration_credential_references / integration_oauth_states). Secrets are
// stored ONLY as AES-256-GCM envelope ciphertext + a masked display value; getActiveSecret decrypts internally for
// the runtime adapter and is never exposed to any controller/response.

import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ProviderSecrets } from '@aipowersalon/security';
import { canMoveToSql } from '@aipowersalon/database';
import { INTEGRATION_CREDENTIAL, INTEGRATION_OAUTH_STATE } from '../lifecycles';

export type NewConnection = { tenantId?: string | null; branchId?: string | null; providerKey: string; category: string; ownershipType: string; authMethod?: string | null; createdBy?: string | null };
export type CredKind = 'oauth_access' | 'oauth_refresh' | 'api_key' | 'client_secret' | 'webhook_secret' | 'signing_key';

const mask = (secret: string): string => { const s = String(secret ?? ''); const last = s.slice(-4); return '••••••••' + (last || '••••'); };

export class IntegrationConnectionsRepo {
  constructor(private readonly db: Kysely<DB>, private readonly sealer: ProviderSecrets) {}

  async findLiveByScope(providerKey: string, tenantId: string | null, branchId: string | null): Promise<any | undefined> {
    const r: any = await sql<any>`select id::text as id, connection_status from integration_connections
      where provider_key = ${providerKey} and connection_status <> 'retired'
      and coalesce(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid) = coalesce(${tenantId}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      and coalesce(branch_id,'00000000-0000-0000-0000-000000000000'::uuid) = coalesce(${branchId}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      limit 1`.execute(this.db);
    return r.rows[0];
  }

  async createConnection(c: NewConnection): Promise<any> {
    const r: any = await sql<any>`insert into integration_connections
      (tenant_id, branch_id, provider_key, category, ownership_type, auth_method, connection_status, created_by_user_id)
      values (${c.tenantId ?? null}::uuid, ${c.branchId ?? null}::uuid, ${c.providerKey}, ${c.category}, ${c.ownershipType}, ${c.authMethod ?? null}, 'pending_setup', ${c.createdBy ?? null}::uuid)
      returning id::text as id, provider_key, category, ownership_type, connection_status, authentication_status, sync_status, webhook_status, auth_method`.execute(this.db);
    return r.rows[0];
  }

  async getConnection(id: string): Promise<any | undefined> {
    const r: any = await sql<any>`select id::text as id, tenant_id::text as tenant_id, branch_id::text as branch_id, provider_key, category, ownership_type,
      connection_status, authentication_status, sync_status, webhook_status, auth_method, credential_reference_id::text as credential_reference_id,
      configuration_version, granted_scopes, provider_account, token_expires_at, disabled_reason
      from integration_connections where id = ${id}::uuid`.execute(this.db);
    return r.rows[0];
  }

  async patchConnection(id: string, patch: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    // build a safe SET list from a fixed allowlist of columns
    const allow = new Set(['connection_status', 'authentication_status', 'sync_status', 'webhook_status', 'auth_method', 'credential_reference_id', 'granted_scopes', 'provider_account', 'token_expires_at', 'disabled_reason', 'configuration_version']);
    for (const [k, v] of entries) {
      if (!allow.has(k)) continue;
      if (k === 'granted_scopes') await sql`update integration_connections set granted_scopes = ${v as any}, updated_at = now() where id = ${id}::uuid`.execute(this.db);
      else if (k === 'token_expires_at') await sql`update integration_connections set token_expires_at = ${v as any}::timestamptz, updated_at = now() where id = ${id}::uuid`.execute(this.db);
      else if (k === 'configuration_version') await sql`update integration_connections set configuration_version = ${v as any}, updated_at = now() where id = ${id}::uuid`.execute(this.db);
      else if (k === 'credential_reference_id') await sql`update integration_connections set credential_reference_id = ${v as any}::uuid, updated_at = now() where id = ${id}::uuid`.execute(this.db);
      else await sql`update integration_connections set ${sql.raw(k)} = ${v as any}, updated_at = now() where id = ${id}::uuid`.execute(this.db);
    }
  }

  // Atomic refresh lock: flips authentication_status to 'refresh_in_progress' only if not already refreshing.
  // Returns the previous status if we acquired the lock, or null if a refresh is already in progress.
  async acquireRefreshLock(id: string): Promise<string | null> {
    const r: any = await sql<any>`update integration_connections set authentication_status = 'refresh_in_progress', updated_at = now()
      where id = ${id}::uuid and authentication_status <> 'refresh_in_progress'
      returning (select authentication_status from integration_connections where id = ${id}::uuid) as prev`.execute(this.db).catch(() => ({ rows: [] }));
    // The subselect reads the NEW value; we only need to know if a row was affected.
    return (r.rows?.length ?? 0) > 0 ? 'acquired' : null;
  }

  async createCredentialRef(input: { connectionId: string; tenantId?: string | null; kind: CredKind; secret: string; expiresAt?: string | null; createdBy?: string | null }): Promise<{ id: string; masked: string }> {
    // supersede any existing active credential of the same kind
    await sql`update integration_credential_references set status = 'rotated', rotated_at = now() where connection_id = ${input.connectionId}::uuid and kind = ${input.kind} and status = 'active' and ${canMoveToSql(INTEGRATION_CREDENTIAL, 'rotated')}`.execute(this.db);
    const enc = this.sealer.encrypt(input.secret); const masked = mask(input.secret);
    const r: any = await sql<any>`insert into integration_credential_references (connection_id, tenant_id, kind, secret_enc, masked_value, expires_at, created_by_user_id)
      values (${input.connectionId}::uuid, ${input.tenantId ?? null}::uuid, ${input.kind}, ${enc}, ${masked}, ${input.expiresAt ?? null}::timestamptz, ${input.createdBy ?? null}::uuid)
      returning id::text as id`.execute(this.db);
    return { id: r.rows[0].id, masked };
  }

  // INTERNAL ONLY — decrypts the active secret for the runtime adapter. Never call from a controller/response path.
  async getActiveSecret(connectionId: string, kind: CredKind): Promise<string | null> {
    const r: any = await sql<any>`select secret_enc from integration_credential_references where connection_id = ${connectionId}::uuid and kind = ${kind} and status = 'active' order by created_at desc limit 1`.execute(this.db);
    if (!r.rows[0]) return null;
    try { return this.sealer.decrypt(r.rows[0].secret_enc); } catch { return null; }
  }

  async revokeCredentials(connectionId: string): Promise<void> {
    await sql`update integration_credential_references set status = 'revoked', revoked_at = now() where connection_id = ${connectionId}::uuid and status = 'active' and ${canMoveToSql(INTEGRATION_CREDENTIAL, 'revoked')}`.execute(this.db);
  }

  async listCredentialRefs(connectionId: string): Promise<any[]> {
    const r: any = await sql<any>`select id::text as id, kind, masked_value, version, status, to_char(created_at,'YYYY-MM-DD') as created_at, to_char(rotated_at,'YYYY-MM-DD') as rotated_at
      from integration_credential_references where connection_id = ${connectionId}::uuid order by created_at desc`.execute(this.db);
    return r.rows ?? [];
  }

  async listConnections(opts: { providerKey?: string; status?: string; tenantId?: string; limit?: number } = {}): Promise<any[]> {
    const lim = Math.min(500, Math.max(1, opts.limit ?? 100));
    const where = [sql`1=1`];
    if (opts.providerKey) where.push(sql`and provider_key = ${opts.providerKey}`);
    if (opts.status) where.push(sql`and connection_status = ${opts.status}`);
    if (opts.tenantId) where.push(sql`and tenant_id = ${opts.tenantId}::uuid`);
    const r: any = await sql<any>`select id::text as id, tenant_id::text as tenant_id, provider_key, category, ownership_type,
      connection_status, authentication_status, sync_status, webhook_status, auth_method, granted_scopes, provider_account,
      to_char(token_expires_at,'YYYY-MM-DD"T"HH24:MI:SS') as token_expires_at, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS') as created_at
      from integration_connections where ${sql.join(where, sql` `)} order by created_at desc limit ${lim}`.execute(this.db).catch(() => ({ rows: [] }));
    return r.rows ?? [];
  }

  async beginOAuthState(input: { connectionId: string; providerKey: string; state: string; codeVerifier: string; redirectUri: string; scopes: string[]; createdBy?: string | null }): Promise<void> {
    const encV = this.sealer.encrypt(input.codeVerifier);
    await sql`insert into integration_oauth_states (connection_id, provider_key, state, code_verifier_enc, redirect_uri, requested_scopes, created_by_user_id)
      values (${input.connectionId}::uuid, ${input.providerKey}, ${input.state}, ${encV}, ${input.redirectUri}, ${input.scopes as any}, ${input.createdBy ?? null}::uuid)`.execute(this.db);
  }

  // Single-use consume: returns the row (with decrypted verifier + redirect) ONLY if it was pending & unexpired, and
  // marks it consumed in the same statement. A replayed/expired/consumed state returns null.
  async consumeOAuthState(state: string, connectionId: string): Promise<{ codeVerifier: string; redirectUri: string; scopes: string[] } | null> {
    const r: any = await sql<any>`update integration_oauth_states set status = 'consumed', consumed_at = now()
      where state = ${state} and connection_id = ${connectionId}::uuid and status = 'pending' and ${canMoveToSql(INTEGRATION_OAUTH_STATE, 'consumed')} and expires_at > now()
      returning code_verifier_enc, redirect_uri, requested_scopes`.execute(this.db);
    if (!r.rows[0]) return null;
    let verifier = ''; try { verifier = this.sealer.decrypt(r.rows[0].code_verifier_enc); } catch { verifier = ''; }
    return { codeVerifier: verifier, redirectUri: r.rows[0].redirect_uri, scopes: r.rows[0].requested_scopes ?? [] };
  }
}
