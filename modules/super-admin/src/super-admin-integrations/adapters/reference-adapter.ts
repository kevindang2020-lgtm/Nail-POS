// reference-adapter.ts — a DETERMINISTIC, NON-PRODUCTION adapter that implements the provider contract without any
// real network call. It exists so the connection/OAuth/refresh/test lifecycle and its security properties (state +
// PKCE, redirect allowlisting, code-replay prevention, scope recording, tokens-never-returned, invalid_grant →
// reauthorization) can be exercised and unit/integration-tested. Real providers each ship their own adapter that
// implements the same contract with real HTTP + credentials; the service code is identical either way.

import { createHmac, timingSafeEqual } from 'crypto';
import type { AuthMethod, HealthResult, IntegrationAdapter, SyncPage, SyncRecord, TokenResult, WebhookEventMeta, WebhookVerifyInput, WebhookVerifyResult } from './adapter.contract';

export class ReferenceAdapter implements IntegrationAdapter {
  constructor(
    public readonly providerKey: string,
    public readonly category: string,
    public readonly authMethods: AuthMethod[],
    public readonly defaultScopes: string[],
    public readonly webhookCapable: boolean,
    public readonly syncCapable: boolean,
    private readonly authorizeBase = 'https://auth.reference.local/authorize',
  ) {}

  buildAuthorizationUrl(i: { redirectUri: string; state: string; codeChallenge?: string; scopes: string[] }): string {
    const q = new URLSearchParams({ client_id: `ref_${this.providerKey}`, response_type: 'code', redirect_uri: i.redirectUri, state: i.state, scope: i.scopes.join(' ') });
    if (i.codeChallenge) { q.set('code_challenge', i.codeChallenge); q.set('code_challenge_method', 'S256'); }
    return `${this.authorizeBase}?${q.toString()}`;
  }

  // Deterministic outcomes keyed on the code value so tests can drive each branch:
  //   code starting 'bad'   → invalid_code ; code starting 'noscope' → invalid_scope ; else success.
  async exchangeAuthorizationCode(i: { code: string; codeVerifier?: string; redirectUri: string }): Promise<TokenResult> {
    if (i.code.startsWith('bad')) return { ok: false, error: 'invalid_code' };
    if (i.code.startsWith('noscope')) return { ok: false, error: 'invalid_scope' };
    return { ok: true, accessToken: `ref-access-${i.code}`, refreshToken: `ref-refresh-${i.code}`, expiresInSeconds: 3600, grantedScopes: this.defaultScopes, providerAccount: `acct_${this.providerKey}` };
  }

  //   refreshToken containing 'revoked' → invalid_grant (needs reauthorization) ; 'norefresh' → not_refreshable.
  async refreshAuthentication(i: { refreshToken: string }): Promise<TokenResult> {
    if (i.refreshToken.includes('revoked')) return { ok: false, error: 'invalid_grant' };
    if (i.refreshToken.includes('norefresh')) return { ok: false, error: 'not_refreshable' };
    return { ok: true, accessToken: `ref-access-refreshed`, refreshToken: `${i.refreshToken}`, expiresInSeconds: 3600, grantedScopes: this.defaultScopes, providerAccount: `acct_${this.providerKey}` };
  }

  async testConnection(i: { accessToken?: string; apiKey?: string }): Promise<HealthResult> {
    const authed = !!(i.accessToken || i.apiKey);
    return { ok: authed, latencyMs: 42, providerAccount: authed ? `acct_${this.providerKey}` : undefined, apiVersion: 'reference-v1', rateLimited: false, webhookCapable: this.webhookCapable, syncCapable: this.syncCapable, errorCategory: authed ? undefined : 'Missing OAuth Scope' };
  }

  // Deterministic sync source: cursor is an integer offset as a string. A null cursor (full sync / first run) yields
  // the first PAGE_TOTAL records (rec-0…); a cursor at/after PAGE_TOTAL yields nothing new (incremental no-op). This
  // lets tests prove full → 5 processed, re-run → all skipped (idempotent), and partial → targeted retry.
  async fetchSyncPage(input: { cursor: string | null; syncType: string; limit: number }): Promise<SyncPage> {
    const PAGE_TOTAL = 5;
    const start = input.cursor ? parseInt(input.cursor, 10) || 0 : 0;
    if (start >= PAGE_TOTAL) return { records: [], nextCursor: String(start), hasMore: false };
    const end = Math.min(PAGE_TOTAL, start + Math.max(1, input.limit));
    const records: SyncRecord[] = [];
    for (let i = start; i < end; i++) records.push({ providerRecordId: `rec-${i}`, payload: { i, provider: this.providerKey }, updatedAt: new Date().toISOString() });
    return { records, nextCursor: String(end), hasMore: end < PAGE_TOTAL };
  }

  normalizeError(raw: unknown): string { return typeof raw === 'string' ? raw : 'Provider Error'; }

  // Reference webhook signature scheme: header `t=<unixSeconds>,v1=<hexHmac>` where the HMAC-SHA256 is computed over
  // `${t}.${rawBody}` keyed by the connection's webhook secret. Verification recomputes and constant-time compares,
  // and enforces a freshness window (replay protection).
  verifyWebhookSignature(input: WebhookVerifyInput): WebhookVerifyResult {
    const header = input.signatureHeader ?? '';
    const parts = Object.fromEntries(header.split(',').map((kv) => { const [k, v] = kv.split('='); return [k?.trim(), v?.trim()]; }));
    const t = Number(parts['t']); const provided = parts['v1'];
    if (!provided || !Number.isFinite(t)) return { valid: false, reason: 'missing_signature' };
    if (Math.abs(Math.floor(Date.now() / 1000) - t) > input.toleranceSeconds) return { valid: false, reason: 'stale_timestamp', timestamp: t };
    const expected = createHmac('sha256', input.secret).update(`${t}.${input.rawBody}`).digest('hex');
    const a = Buffer.from(expected); const b = Buffer.from(provided);
    const ok = a.length === b.length && timingSafeEqual(a, b);
    return ok ? { valid: true, timestamp: t } : { valid: false, reason: 'bad_signature', timestamp: t };
  }

  extractWebhookEventMeta(rawBody: string): WebhookEventMeta | null {
    try { const p = JSON.parse(rawBody); if (!p || !p.id) return null; return { eventId: String(p.id), eventType: p.type ? String(p.type) : undefined, summary: { type: p.type ?? null } }; }
    catch { return null; }
  }
}
