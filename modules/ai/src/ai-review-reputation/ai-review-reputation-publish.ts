// ai-review-reputation-publish.ts — the REAL publication path. It resolves the tenant's active provider connection and a
// valid OAuth access token from the existing integration-credential store (integration_connections +
// integration_credential_references), then calls the provider's reply API. Secrets are decrypted ONLY through the
// established provider-crypto helper — this file never reimplements crypto and never returns a token to a caller. When a
// tenant has no active/valid connection (or the vault isn't configured, or the provider doesn't permit API replies), it
// throws INTEGRATION_DISCONNECTED — honest, never a faked post. Google Business Profile replies are supported; Facebook
// review replies are platform-restricted and reported as disconnected.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { PublicationPort, DraftingCtx } from './ai-review-reputation-drafting.service';

export const SOURCE_TO_PROVIDER: Record<string, string> = { google: 'google_business_profile', facebook: 'facebook_pages' };
const API_PUBLISHABLE = new Set(['google_business_profile']);   // facebook_pages: review replies not available via API
/** Review Reputation 08: may a reply to this provider's reviews be published through its API (the one publish rule) */
export function providerRepliesByApi(providerKey: string | null | undefined): boolean { return !!providerKey && API_PUBLISHABLE.has(providerKey); }

export interface ResolvedCredential { accessToken: string; providerAccount: string | null; }
export interface ConnectionCredentialResolver { resolve(tenantId: string, providerKey: string): Promise<ResolvedCredential | null>; }
export interface ReviewTargetLookup { target(ctx: { tenantId: string }, reviewId: string): Promise<{ source: string; externalReviewId: string | null } | null>; }
export interface HttpJson { send(method: 'PUT' | 'POST', url: string, body: unknown, bearerToken: string): Promise<{ ok: boolean; status: number; json: any }>; }

export class ReviewPublishAdapter implements PublicationPort {
  constructor(private readonly targets: ReviewTargetLookup, private readonly creds: ConnectionCredentialResolver, private readonly http: HttpJson) {}

  async publish(ctx: DraftingCtx, reviewId: string, text: string, _isAuto: boolean): Promise<{ externalResponseId: string }> {
    const target = await this.targets.target(ctx, reviewId);
    if (!target || !target.externalReviewId) throw new Error('INTEGRATION_DISCONNECTED');   // internal/manual reviews have no external target
    const providerKey = SOURCE_TO_PROVIDER[target.source];
    if (!providerKey || !API_PUBLISHABLE.has(providerKey)) throw new Error('INTEGRATION_DISCONNECTED'); // e.g. Facebook: no API reply
    const cred = await this.creds.resolve(ctx.tenantId, providerKey);
    if (!cred?.accessToken) throw new Error('INTEGRATION_DISCONNECTED');                     // not connected / expired / vault off

    if (providerKey === 'google_business_profile') {
      // Google Business Profile: PUT v4/{review.name}/reply { comment }. external_review_id stores the full resource name.
      const url = `https://mybusiness.googleapis.com/v4/${target.externalReviewId}/reply`;
      const res = await this.http.send('PUT', url, { comment: text }, cred.accessToken);
      if (!res.ok) throw new Error('PUBLISH_FAILED');
      return { externalResponseId: res.json?.name ?? `${target.externalReviewId}/reply` };
    }
    throw new Error('INTEGRATION_DISCONNECTED');
  }
}

// ---- Kysely implementations over the existing integration-credential store ----
export class KyselyReviewTarget implements ReviewTargetLookup {
  constructor(private readonly db: Kysely<DB>) {}
  async target(ctx: { tenantId: string }, reviewId: string) {
    const r: any = await this.db.selectFrom('reviews').select(['source', 'external_review_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', reviewId).executeTakeFirst().catch(() => null);
    return r ? { source: String(r.source), externalReviewId: r.external_review_id ? String(r.external_review_id) : null } : null;
  }
}

/** Resolves a usable access token from the active connection's oauth_access credential. Decryption is delegated to the
 *  established provider-crypto helper (injected), so this class never holds the vault key or reimplements crypto. */
export class KyselyConnectionCredentialResolver implements ConnectionCredentialResolver {
  constructor(private readonly db: Kysely<DB>, private readonly decrypt: (enc: string) => string, private readonly vaultConfigured: () => boolean) {}
  async resolve(tenantId: string, providerKey: string): Promise<ResolvedCredential | null> {
    if (!this.vaultConfigured()) return null;                                                // no vault key -> cannot decrypt -> disconnected
    const conn: any = await this.db.selectFrom('integration_connections').select(['id', 'provider_account', 'authentication_status']).where('provider_key', '=', providerKey).where('tenant_id', '=', tenantId).where('connection_status', '=', 'active').executeTakeFirst().catch(() => null);
    if (!conn || conn.authentication_status !== 'valid') return null;                         // not connected or token not valid
    const ref: any = await this.db.selectFrom('integration_credential_references').select(['secret_enc']).where('tenant_id', '=', tenantId).where('connection_id', '=', String(conn.id)).where('kind', '=', 'oauth_access').where('status', '=', 'active').orderBy('version', 'desc').executeTakeFirst().catch(() => null);
    if (!ref?.secret_enc) return null;
    let accessToken: string;
    try { accessToken = this.decrypt(String(ref.secret_enc)); } catch { return null; }        // malformed/failed decrypt -> disconnected
    return { accessToken, providerAccount: conn.provider_account ?? null };
  }
}

/** Real HTTP client (global fetch). Kept tiny + injectable so the adapter stays unit-testable without network. */
export class FetchHttpJson implements HttpJson {
  async send(method: 'PUT' | 'POST', url: string, body: unknown, bearerToken: string) {
    const res = await fetch(url, { method, headers: { authorization: `Bearer ${bearerToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let json: any = null; try { json = await res.json(); } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, json };
  }
}
