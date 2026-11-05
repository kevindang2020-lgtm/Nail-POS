// oauth.service.ts — Constitution 3 §79 (Step 10d): the authorization server's flows on the database.
import { sql } from 'kysely';
import { oauthHash, newOAuthSecret, pkceMatches, redirectAllowed, grantableScopes, OAUTH_CODE_TTL_SECONDS, OAUTH_ACCESS_TTL_SECONDS, OAUTH_REFRESH_TTL_SECONDS } from '../common/oauth-core';

export class OAuthError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
export interface AuthorizeRequest { clientId: string; redirectUri: string; scope: string; state?: string; codeChallenge: string; codeChallengeMethod?: string }
export interface TokenPair { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }

export class OAuthService {
  constructor(private readonly db: any) {}
  private async client(clientId: string): Promise<{ client_id: string; name: string; redirect_uris: string[]; client_secret_hash: string | null; allowed_scopes: string[] }> {
    const c: any = (await sql`select client_id, name, redirect_uris, client_secret_hash, allowed_scopes from oauth_clients where client_id = ${clientId} and disabled_at is null`.execute(this.db)).rows[0];
    if (!c) throw new OAuthError('invalid_client', 'Unknown or disabled application.', 400);
    return c;
  }
  /** What the consent screen shows. Validates everything BEFORE the owner sees anything. */
  async describe(q: AuthorizeRequest): Promise<{ clientName: string; scopes: string[] }> {
    const c = await this.client(q.clientId);
    if (!redirectAllowed(q.redirectUri, c.redirect_uris)) throw new OAuthError('invalid_redirect_uri', 'This application\'s return address is not registered.');
    if ((q.codeChallengeMethod ?? 'S256') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(String(q.codeChallenge ?? ''))) throw new OAuthError('invalid_request', 'PKCE (S256) is required.');
    const scopes = grantableScopes(q.scope, c.allowed_scopes);
    if (!scopes.length) throw new OAuthError('invalid_scope', 'This application asked for nothing it may have.');
    return { clientName: c.name, scopes };
  }
  /** The owner approved: one grant per (salon, app) — re-approval replaces the scopes. Returns where to send the browser. */
  async approve(q: AuthorizeRequest, owner: { userId: string; tenantId: string }): Promise<{ redirect: string }> {
    const { scopes } = await this.describe(q);
    const code = newOAuthSecret('oac');
    await this.db.transaction().execute(async (trx: any) => {
      const g: any = (await sql`select id from oauth_grants where tenant_id = ${owner.tenantId}::uuid and client_id = ${q.clientId} and revoked_at is null limit 1`.execute(trx)).rows[0];
      const grantId = g ? String(g.id) : String(((await sql`insert into oauth_grants (client_id, tenant_id, approved_by, scopes) values (${q.clientId}, ${owner.tenantId}::uuid, ${owner.userId}::uuid, ${scopes}::text[]) returning id`.execute(trx)).rows[0] as any).id);
      if (g) await sql`update oauth_grants set scopes = ${scopes}::text[], approved_by = ${owner.userId}::uuid where id = ${grantId}::uuid`.execute(trx);
      await sql`insert into oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, expires_at) values (${oauthHash(code)}, ${grantId}::uuid, ${q.redirectUri}, ${q.codeChallenge}, now() + make_interval(secs => ${OAUTH_CODE_TTL_SECONDS}))`.execute(trx);
    });
    const u = new URL(q.redirectUri); u.searchParams.set('code', code); if (q.state) u.searchParams.set('state', q.state);
    return { redirect: u.toString() };
  }
  private async authClient(clientId: string, clientSecret: unknown) {
    const c = await this.client(clientId);
    if (c.client_secret_hash && (typeof clientSecret !== 'string' || oauthHash(clientSecret) !== c.client_secret_hash)) throw new OAuthError('invalid_client', 'Client authentication failed.', 401);
    return c;
  }
  private async issue(trx: any, grantId: string, scopes: string[]): Promise<TokenPair> {
    const access = newOAuthSecret('oat'), refresh = newOAuthSecret('ort');
    await sql`insert into oauth_tokens (token_hash, grant_id, kind, expires_at) values (${oauthHash(access)}, ${grantId}::uuid, 'access', now() + make_interval(secs => ${OAUTH_ACCESS_TTL_SECONDS})), (${oauthHash(refresh)}, ${grantId}::uuid, 'refresh', now() + make_interval(secs => ${OAUTH_REFRESH_TTL_SECONDS}))`.execute(trx);
    return { access_token: access, token_type: 'Bearer', expires_in: OAUTH_ACCESS_TTL_SECONDS, refresh_token: refresh, scope: scopes.join(' ') };
  }
  /** grant_type=authorization_code: one use; the redirect must match; the PKCE verifier must match the challenge. */
  async exchangeCode(p: { clientId: string; clientSecret?: string; code: string; redirectUri: string; codeVerifier: string }): Promise<TokenPair> {
    await this.authClient(p.clientId, p.clientSecret);
    return this.db.transaction().execute(async (trx: any) => {
      const row: any = (await sql`update oauth_codes c set used_at = now() from oauth_grants g
          where c.code_hash = ${oauthHash(p.code)} and c.used_at is null and c.expires_at > now() and g.id = c.grant_id and g.client_id = ${p.clientId} and g.revoked_at is null
        returning c.grant_id, c.redirect_uri, c.code_challenge, g.scopes`.execute(trx)).rows[0];
      if (!row) throw new OAuthError('invalid_grant', 'The code is invalid, expired or already used.');
      if (row.redirect_uri !== p.redirectUri || !pkceMatches(p.codeVerifier, row.code_challenge)) throw new OAuthError('invalid_grant', 'The code does not match this request.');
      return this.issue(trx, String(row.grant_id), (row.scopes ?? []).map(String));
    });
  }
  /** grant_type=refresh_token: rotating; presenting an already-exchanged refresh token revokes the whole grant. */
  async refresh(p: { clientId: string; clientSecret?: string; refreshToken: string }): Promise<TokenPair> {
    await this.authClient(p.clientId, p.clientSecret);
    const reused = await this.db.transaction().execute(async (trx: any) => {
      const t: any = (await sql`select t.grant_id, t.rotated_at, t.revoked_at, t.expires_at, g.scopes, g.revoked_at as g_revoked from oauth_tokens t join oauth_grants g on g.id = t.grant_id
        where t.token_hash = ${oauthHash(p.refreshToken)} and t.kind = 'refresh' and g.client_id = ${p.clientId} for update`.execute(trx)).rows[0];
      if (!t || t.g_revoked || t.revoked_at || new Date(t.expires_at).getTime() <= Date.now()) throw new OAuthError('invalid_grant', 'The refresh token is invalid.');
      if (t.rotated_at) {   // reuse of an exchanged refresh token: assume theft — the app's access to this salon ends
        await sql`update oauth_grants set revoked_at = now() where id = ${t.grant_id}::uuid`.execute(trx);
        await sql`update oauth_tokens set revoked_at = now() where grant_id = ${t.grant_id}::uuid and revoked_at is null`.execute(trx);
        return 'reused';
      }
      await sql`update oauth_tokens set rotated_at = now() where token_hash = ${oauthHash(p.refreshToken)}`.execute(trx);
      return this.issue(trx, String(t.grant_id), (t.scopes ?? []).map(String));
    });
    if (reused === 'reused') throw new OAuthError('invalid_grant', 'The refresh token was already used; access was revoked.');
    return reused;
  }
  /** RFC 7009: revoking a token always answers 200; a refresh token takes its grant's tokens with it. */
  async revokeToken(token: string): Promise<void> {
    const t: any = (await sql`select grant_id, kind from oauth_tokens where token_hash = ${oauthHash(token)}`.execute(this.db)).rows[0];
    if (!t) return;
    if (t.kind === 'refresh') await sql`update oauth_tokens set revoked_at = now() where grant_id = ${t.grant_id}::uuid and revoked_at is null`.execute(this.db);
    else await sql`update oauth_tokens set revoked_at = now() where token_hash = ${oauthHash(token)}`.execute(this.db);
  }
  async listGrants(tenantId: string) {
    const r: any = await sql`select g.id, g.client_id, c.name, g.scopes, g.created_at from oauth_grants g join oauth_clients c on c.client_id = g.client_id where g.tenant_id = ${tenantId}::uuid and g.revoked_at is null order by g.created_at desc`.execute(this.db);
    return r.rows.map((x: any) => ({ id: String(x.id), clientId: x.client_id, name: x.name, scopes: x.scopes ?? [], connectedAt: new Date(x.created_at).toISOString() }));
  }
  async revokeGrant(tenantId: string, grantId: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx: any) => {
      const r: any = await sql`update oauth_grants set revoked_at = now() where id = ${grantId}::uuid and tenant_id = ${tenantId}::uuid and revoked_at is null returning id`.execute(trx);
      if (!r.rows.length) return false;
      await sql`update oauth_tokens set revoked_at = now() where grant_id = ${grantId}::uuid and revoked_at is null`.execute(trx);
      return true;
    });
  }
}
