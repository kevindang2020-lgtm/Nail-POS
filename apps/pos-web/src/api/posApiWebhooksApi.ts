// posApiWebhooksApi.ts — client for tenant API keys (/pos/api-keys) and webhooks (/pos/webhooks). Raw secrets are
// returned only by create/rotate; list responses are masked. The server enforces tenant scope, RBAC, and OWNER-only
// secret minting.
import type { ApiKeyCreated, ApiKeyView, WebhookCreated, WebhookView } from '@aipowersalon/api-contracts/tenant';
export type { ApiKeyCreated, ApiKeyView, WebhookCreated, WebhookView };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';


export const posApiKeysApi = {
  list: () => api.get<ApiKeyView[]>('/pos/api-keys'),
  create: (b: { name: string; environment?: string; scopes?: string[]; expiresAt?: string | null }) => api.post<ApiKeyCreated>('/pos/api-keys', b),
  rotate: (id: string) => api.post<ApiKeyCreated>(`/pos/api-keys/${id}/rotate`, {}),
  revoke: (id: string) => api.post<{ id: string; revoked: boolean }>(`/pos/api-keys/${id}/revoke`, {}),
};
export const posWebhooksApi = {
  list: () => api.get<WebhookView[]>('/pos/webhooks'),
  create: (b: { name: string; url: string; events?: string[] }) => api.post<WebhookCreated>('/pos/webhooks', b),
  pause: (id: string) => api.post<WebhookView>(`/pos/webhooks/${id}/pause`, {}),
  resume: (id: string) => api.post<WebhookView>(`/pos/webhooks/${id}/resume`, {}),
  disable: (id: string) => api.post<WebhookView>(`/pos/webhooks/${id}/disable`, {}),
  rotateSecret: (id: string) => api.post<{ id: string; signingSecret: string }>(`/pos/webhooks/${id}/rotate-secret`, {}),
  test: (id: string) => api.post<{ id: string; delivered: boolean; detail: string }>(`/pos/webhooks/${id}/test`, {}),
};
