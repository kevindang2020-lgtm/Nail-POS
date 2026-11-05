// oauth-core.ts — Constitution 3 §79 (Step 10d, Oct 4 2026): the pure rules of the OAuth authorization server, and the
// access-token check TenantContextMiddleware makes (it lives in common/ because the middleware reads it).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import { INTEGRATION_SCOPES } from './api-key-auth';

export const OAUTH_CODE_TTL_SECONDS = 600;
export const OAUTH_ACCESS_TTL_SECONDS = 3600;
export const OAUTH_REFRESH_TTL_SECONDS = 30 * 86400;
export const oauthHash = (s: string) => createHash('sha256').update(String(s)).digest('hex');
export const newOAuthSecret = (prefix: 'oac' | 'oat' | 'ort' | 'ocs') => `${prefix}_` + randomBytes(32).toString('base64url');

/** PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)) === challenge. Verifier 43–128 unreserved chars. Timing-safe. */
export function pkceMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const got = Buffer.from(createHash('sha256').update(verifier).digest('base64url')), want = Buffer.from(String(challenge));
  return got.length === want.length && timingSafeEqual(got, want);
}
/** Exact match against a registered redirect URI — no prefix matching, no wildcards (open-redirect class of bugs). */
export function redirectAllowed(redirect: unknown, registered: string[]): boolean {
  return typeof redirect === 'string' && registered.includes(redirect);
}
/** What an app may get: requested ∩ the client's registered scopes ∩ the integration allow-list (read-only). */
export function grantableScopes(requested: unknown, clientAllowed: string[]): string[] {
  const req = String(requested ?? '').split(/[\s,]+/).filter(Boolean);
  return [...new Set(req)].filter((s) => clientAllowed.includes(s) && (INTEGRATION_SCOPES as readonly string[]).includes(s));
}
export function readOAuthAccessToken(headers: Record<string, any> | undefined): string | null {
  const m = /^Bearer\s+(oat_[A-Za-z0-9_-]{30,80})$/i.exec(String(headers?.authorization ?? headers?.Authorization ?? '').trim());
  return m ? m[1] : null;
}
export interface VerifiedOAuthAccess { grantId: string; tenantId: string; clientId: string; scopes: string[] }
/** The middleware's check: a live access token of a live grant of an enabled client. */
export class KyselyOAuthAccess {
  constructor(private readonly db: any) {}
  async verify(token: string): Promise<VerifiedOAuthAccess | null> {
    const r: any = (await sql`select g.id, g.tenant_id, g.client_id, g.scopes from oauth_tokens t
        join oauth_grants g on g.id = t.grant_id join oauth_clients c on c.client_id = g.client_id
      where t.token_hash = ${oauthHash(token)} and t.kind = 'access' and t.revoked_at is null and t.expires_at > now()
        and g.revoked_at is null and c.disabled_at is null limit 1`.execute(this.db)).rows[0];
    return r ? { grantId: String(r.id), tenantId: String(r.tenant_id), clientId: String(r.client_id), scopes: (r.scopes ?? []).map(String) } : null;
  }
}
