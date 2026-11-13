// posPhoneApi.ts — Phone & Messaging (both /tenant/communications/phone and /messaging-setup read the SAME server
// configuration and readiness — there is no second credential store). Session-scoped on the server: the tenant is never
// sent; a branch is named only in the PATH (the session middleware strips scope from bodies and queries).
import { api } from "./client";
import type { TenantTwilioCredentialsView } from '@aipowersalon/api-contracts';
import type { Caps, StatusOf, TestDisplayState, TestEvent, RegItem, TollFree, ConfigItem, NumberInbound, CheckEvent, MessagingReadiness, AvailableNumber, NumberQuote, TestSendResult } from '@aipowersalon/api-contracts/tenant';
// the wire shapes live in the contracts package (one definition); re-exported for this app's screens
export type { Caps, StatusOf, TestDisplayState, TestEvent, RegItem, TollFree, ConfigItem, NumberInbound, CheckEvent, MessagingReadiness, AvailableNumber, NumberQuote, TestSendResult };
export type CredsBody = { accountSid: string; authToken?: string; fromNumber?: string; verifyServiceSid: string; apiKeySid: string; apiKeySecret?: string; confirmUnverified?: boolean };

const scoped = (base: string, branchId: string, tail = '') => (branchId ? `${base}/branches/${encodeURIComponent(branchId)}${tail}` : `${base}${tail}`);

export const posPhoneApi = {
  number: () => api.get<{ configured: boolean; usingOwnAccount: boolean; registeredNumber: string | null }>(`/tenant/messaging/number`),
  a2p: () => api.get<{ senderBrand: string; a2pStatus: string }>(`/pos/settings/notifications-reminders/a2p-status`),
  readiness: (branchId = '') => api.get<MessagingReadiness>(branchId ? `/tenant/messaging/readiness/branches/${encodeURIComponent(branchId)}` : '/tenant/messaging/readiness'),
  healthCheck: (branchId = '') => api.post<MessagingReadiness>(branchId ? `/tenant/messaging/health-check/branches/${encodeURIComponent(branchId)}` : '/tenant/messaging/health-check', {}),
  credentials: (branchId = '') => api.get<TenantTwilioCredentialsView>(scoped('/tenant/messaging/credentials', branchId)),
  saveCredentials: (branchId: string, body: CredsBody) => api.put<TenantTwilioCredentialsView>(scoped('/tenant/messaging/credentials', branchId), body),
  /** TEXT MESSAGING SETUP 08: the save's own validation with nothing written (rotation preflight) */
  preflightCredentials: (branchId: string, body: CredsBody) => api.post<MessagingCredentialPreflight>(scoped('/tenant/messaging/credentials', branchId, '/preflight'), body as unknown as Record<string, unknown>),
  disconnect: (branchId = '') => api.del<{ ok: boolean }>(scoped('/tenant/messaging/credentials', branchId)),
  testVerify: (branchId = '') => api.post<{ ok: boolean; friendlyName?: string | null; error?: string; reason?: string }>(scoped('/tenant/messaging/credentials', branchId, '/test-verify'), {}),
  searchNumbers: (areaCode: string) => api.get<{ available: AvailableNumber[]; configured: boolean }>('/tenant/messaging/number/search', areaCode ? { areaCode } : undefined),
  quoteNumber: (phoneNumber: string) => api.post<NumberQuote | { ok: false; reason: 'not_configured' }>('/tenant/messaging/number/quote', { phoneNumber }),
  buyNumber: (phoneNumber: string, confirmationToken: string) => api.post<{ ok: boolean; number?: string; error?: string; reason?: string; replayed?: boolean }>('/tenant/messaging/number/buy', { phoneNumber, confirmationToken }),
  /** PM-01: '' = the salon default; a branch id = that branch's EFFECTIVE configuration (server checks the actor may act for it) */
  testSms: (to: string, idempotencyKey: string, branchId = '', message?: string) => api.post<TestSendResult>(scoped('/tenant/messaging/credentials', branchId, '/test'), { to, confirm: true, idempotencyKey, ...(message ? { message } : {}) }),
  /** PM-02: the one way to see the full Account SID (step-up, audited) */
  revealSid: (branchId = '') => api.post<{ accountSid: string | null; branchId: string | null }>(scoped('/tenant/messaging/credentials', branchId, '/reveal-sid'), {}),
  /** PM-03/PM-04: read the carrier registration / toll-free verification from Twilio now (rate-limited per salon) */
  refreshRegistration: (idempotencyKey: string) => api.post<{ run: { outcome: string; errorClass: string | null; finishedAt: string | null }; replayed: boolean; readiness: MessagingReadiness }>('/tenant/messaging/registration/refresh', { idempotencyKey }),
};
