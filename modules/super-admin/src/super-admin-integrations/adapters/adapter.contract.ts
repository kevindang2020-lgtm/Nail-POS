// adapter.contract.ts — the common provider-adapter interface. Provider-specific logic lives ONLY behind this
// contract (never in controllers/services/UI). Real providers implement it with real HTTP calls + credentials; the
// ReferenceAdapter implements it deterministically so the connection/OAuth/refresh lifecycle and its security
// properties are exercisable and testable without live provider credentials.

export type AuthMethod = 'oauth2' | 'api_key' | 'none';

export type TokenResult = {
  ok: boolean;
  error?: 'invalid_grant' | 'invalid_code' | 'invalid_scope' | 'provider_error' | 'not_refreshable';
  accessToken?: string;      // NEVER returned past the service boundary — stored encrypted, then discarded
  refreshToken?: string;     // NEVER returned past the service boundary
  expiresInSeconds?: number;
  grantedScopes?: string[];
  providerAccount?: string;  // non-secret account identifier
};

export type HealthResult = {
  ok: boolean;
  latencyMs?: number;
  providerAccount?: string;
  apiVersion?: string;
  rateLimited?: boolean;
  errorCategory?: string;
  webhookCapable?: boolean;
  syncCapable?: boolean;
};

export type SyncRecord = { providerRecordId: string; payload: unknown; updatedAt?: string };
export type SyncPage = { records: SyncRecord[]; nextCursor: string | null; hasMore: boolean };

export type WebhookVerifyInput = { rawBody: string; signatureHeader?: string; secret: string; toleranceSeconds: number };
export type WebhookVerifyResult = { valid: boolean; reason?: 'missing_signature' | 'bad_signature' | 'stale_timestamp'; timestamp?: number };
export type WebhookEventMeta = { eventId: string; eventType?: string; summary?: Record<string, unknown> };

export interface IntegrationAdapter {
  readonly providerKey: string;
  readonly category: string;
  readonly authMethods: AuthMethod[];
  readonly defaultScopes: string[];
  readonly webhookCapable: boolean;
  readonly syncCapable: boolean;
  // OAuth
  buildAuthorizationUrl(input: { redirectUri: string; state: string; codeChallenge?: string; scopes: string[] }): string;
  exchangeAuthorizationCode(input: { code: string; codeVerifier?: string; redirectUri: string }): Promise<TokenResult>;
  refreshAuthentication(input: { refreshToken: string }): Promise<TokenResult>;
  // Non-destructive health/test
  testConnection(input: { accessToken?: string; apiKey?: string }): Promise<HealthResult>;
  // Synchronization — pull a bounded page of provider records from the given cursor (undefined on adapters that
  // don't sync). The engine owns idempotency, cursors, retries, and the downstream domain write.
  fetchSyncPage?(input: { cursor: string | null; syncType: string; limit: number }): Promise<SyncPage>;
  // Inbound webhooks — verify the provider signature + freshness (provider-specific scheme), and extract the dedup
  // event id + a safe (non-secret) summary. The ingest service owns dedup, tenant resolution, and async handoff.
  verifyWebhookSignature?(input: WebhookVerifyInput): WebhookVerifyResult;
  extractWebhookEventMeta?(rawBody: string): WebhookEventMeta | null;
  // Error mapping
  normalizeError(raw: unknown): string;
}
