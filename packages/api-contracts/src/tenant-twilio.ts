// tenant-twilio.ts — the masked view of a salon's (or a branch's) own Twilio credentials (BUILD_PLAN Phase 4).
// GET/PUT /tenant/messaging/credentials[?branchId=] and the Super Admin equivalent. Secrets are never on the wire:
// only SIDs, the from number, a last-4 hint and the validation state.
export interface TenantTwilioCredentialsView {
  tenantId: string;
  branchId: string | null;
  provider: 'twilio';
  status: 'not_configured' | 'configured';
  accountSid: string | null;
  fromNumber: string | null;
  authTokenLast4: string | null;
  /** The Verify Service booking codes are sent through (VA…). */
  verifyServiceSid: string | null;
  /** An API key (SK…) that signs Verify calls instead of the account auth token. */
  apiKeySid: string | null;
  hasApiKeySecret: boolean;
  /** Set by a successful "Test Verify" (or, without a Verify Service, a successful test text). Cleared by any change. */
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  /** True when this is a branch's own row; false when a branch inherits the salon default. */
  branchOverride: boolean;
  /** B-16: whose Twilio account it is — the salon's own (`tenant_owned`), or a subaccount the platform provisioned for it. */
  accountMode?: 'platform_managed' | 'tenant_owned';
  /** B-16: a platform-managed salon's provisioning — the last step completed, the last failure, when it went live. */
  provisioning?: { step: 'subaccount' | 'messaging_service' | 'number' | 'done' | null; error: string | null; provisionedAt: string | null; messagingServiceSid: string | null } | null;
}
