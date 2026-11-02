// GENERATED FROM apps/api by tooling/contracts/move-contracts.py, then OWNED HERE (Constitution 13 §13).
// Realm: tenant. Declaration file: types only, never emitted (see packages/api-contracts/README.md).

export interface ApiKeyView {
  id: string; name: string; prefix: string; masked: string; environment: string; scopes: string[];
  status: ApiKeyStatus; createdByUserId: string | null; lastUsedIso: string | null; expiresIso: string | null; createdIso: string | null;
}

export interface ApiKeyCreated extends ApiKeyView { secret: string }

export interface WebhookView {
  id: string; name: string; url: string; events: string[]; status: WebhookStatus; hasSecret: true;
  lastDeliveryIso: string | null; lastSuccessIso: string | null; lastFailureIso: string | null; failureCount: number; createdIso: string | null;
}

export interface WebhookCreated extends WebhookView { signingSecret: string }

export type ApiKeyStatus = 'active' | 'expired' | 'revoked';

export type WebhookStatus = 'active' | 'paused' | 'disabled';
