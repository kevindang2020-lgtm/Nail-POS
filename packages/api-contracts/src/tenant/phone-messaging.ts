// phone-messaging.ts — Phone & Messaging (Oct 30 2026, rounds 1–2): the wire shapes the POS reads from tenant/messaging/*
// (readiness, diagnostics, number search / quote, test SMS). Realm: tenant. Declaration file: types only (Constitution 13 §13/§15 —
// the ONE definition; the POS imports these instead of re-declaring them). Moved from apps/pos-web/src/api/posPhoneApi.ts
// in the gap sweep (architecture: "frontend type mirroring an API type").

export type Caps = { sms: boolean; voice: boolean; mms: boolean };
export interface StatusOf<S extends string = string> { state: S; lastCheckedAt: string | null; reasonCode: string | null; fixLink: string }
export type TestDisplayState = 'requested' | 'accepted' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'unknown';
export interface TestEvent { id: string; status: string; displayState?: TestDisplayState; destinationMasked: string; sender: string | null; providerSidLast6: string | null; errorCode: string | null; warningCodes: string[]; createdAt: string; statusUpdatedAt: string; deliveredAt: string | null; final: boolean;
  branchId?: string | null; configSource?: string | null; accountSidLast4?: string | null }
/** one carrier-registration item, from the provider snapshot (PM-03) */
export interface RegItem { state: string; providerStatus: string | null; verified: boolean; source: string; reasonCode: string | null; providerIdLast4: string | null; errorClass: string | null; checkedAt: string | null; lastSuccessAt: string | null; retryCount: number; nextRetryAt: string | null; stale: boolean }
export interface TollFree extends RegItem { applicable: boolean; numberType: string; numberTypeSource: string; verificationSidLast4: string | null; submittedAt: string | null; rejectionCode: string | null; rejectionReason: string | null; nextAction: string | null }
export interface ConfigItem { name: string; state: 'ok' | 'warning' | 'invalid' | 'not_set'; reasonCodes: string[]; value: string | null; expectedRoute: string }
export interface NumberInbound { number: string; state: string; reasonCode: string | null }
export interface CheckEvent { id: string; checkedAt: string; trigger: string; accountState: string; reasonCode: string | null; senderState: string | null; apiKeyState: string | null; verifyState: string | null; inboundUrlState: string | null; durationMs: number | null; current: boolean }
export interface MessagingReadiness {
  generatedAt: string; staleAfterSeconds: number; source: 'tenant_default' | 'branch_override' | 'none';
  scope: { branchId: string | null; salonName: string | null; branchName: string | null; inheritsFromDefault: boolean; branchOverrides: { branchId: string; name: string | null }[]; branchesInheriting: { branchId: string; name: string | null }[];
    authorizedBranches?: { branchId: string; name: string | null; source: 'branch_override' | 'tenant_default' }[] };
  account: StatusOf & { mode: string; accountSidLast4: string | null; accountSidMasked?: string | null; authTokenLast4: string | null; authMode: string | null; apiKey: { sid: string | null; sidLast4?: string | null; hasSecret: boolean; state: string | null; scope?: 'sufficient' | 'insufficient' | 'unknown' | null }; accountType: string | null };
  sender: StatusOf & { number: string | null; senderType: string; capabilities: Caps | null; smsCapable: boolean | null };
  a2p: StatusOf & { applicable: boolean; brand: RegItem; campaign: RegItem; messagingService: RegItem & { sidLast4: string | null; numberAttached: boolean }; numberAssociation?: RegItem; lastUpdatedAt: string | null; stale: boolean;
    providerVerified?: boolean; lastProviderCheckAt?: string | null; lastProviderSuccessAt?: string | null; lastRun?: { at: string; outcome: string; trigger: string } | null };
  tollFree?: TollFree;
  config?: { state: string; items: ConfigItem[] } | null;
  outbound: StatusOf & { blockers: string[]; warnings: string[]; deliveryTracking: boolean };
  inbound: StatusOf & { webhookUrl: string | null; lastVerifiedEventAt: string | null; numbers?: NumberInbound[]; statusCallback: StatusOf & { url: string | null; lastVerifiedEventAt: string | null } };
  verify: StatusOf & { tenantEnabled: boolean; requiredByPlatform: boolean; platformBlocked: boolean; channel: string | null; serviceSidLast4: string | null; settingsSource: string };
  voice: { numberVoiceCapable: boolean | null; fixLink: string };
  lastTest: TestEvent | null;
  checklist: { key: 'connect' | 'number' | 'registration' | 'webhooks' | 'test'; state: 'done' | 'action' | 'pending' | 'blocked' | 'not_applicable'; reasonCode: string | null; fixLink: string }[];
  lastChanged: { at: string | null; byUserLast4: string | null };
  registeredNumbers: { number: string; status: string }[];
  diagnostics: { checks: CheckEvent[]; tests: TestEvent[] };
}
export type AvailableNumber = { phoneNumber: string; friendlyName: string; locality: string | null; region: string | null; capabilities: Caps | null };
export interface NumberQuote { ok: true; confirmationToken: string; phoneNumber: string; capabilities: Caps | null; price: { amount: string; unit: string } | null; priceNote: string; expiresAt: string; billedTo: string; replacesNumber: string | null }
export type TestSendResult = { ok: boolean; sid?: string; error?: string; reason?: string; eventId?: string; status?: string; displayState?: TestDisplayState; errorCode?: string | null; warnings?: string[]; replayed?: boolean; destinationMasked?: string;
  branchId?: string | null; configSource?: string; accountSidMasked?: string | null; sender?: string | null };
