// api-webhooks.dto.ts — request context + API-key / webhook view and create contracts. The *Created responses are the
// ONLY place a raw secret appears (returned once at create/rotate); all list/view responses are masked.
import type { ApiKeyView, ApiKeyCreated, WebhookView, WebhookCreated } from '@aipowersalon/api-contracts/tenant';
export type { ApiKeyView, ApiKeyCreated, WebhookView, WebhookCreated };   // owned by packages/api-contracts (Constitution 13 §13)


export interface ApiWebhooksContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }


export interface WebhookTestResult { id: string; delivered: boolean; detail: string }

export interface CreateApiKeyRequest { name?: string; environment?: string; scopes?: unknown; expiresAt?: string | null }
export interface CreateWebhookRequest { name?: string; url?: string; events?: unknown }

// Producer-facing sink for emitting domain events into the webhook dispatcher (type-only dep → no module cycle).
export interface WebhookEventSink { dispatch(ctx: { tenantId: string; branchId?: string; userId?: string }, eventType: string, data: unknown): Promise<void> }

export interface WebhookDeliveryView {
  id: string; webhookId: string; eventType: string; status: string; attemptCount: number; maxAttempts: number;
  nextAttemptIso: string | null; lastStatusCode: number | null; lastError: string | null; createdIso: string | null; updatedIso: string | null;
}
