// customer-phone.ts — the wire shape of a customer's phone status (BUILD_PLAN Phase 3, customer_phone_number_management).
// Shared by the API (GET /pos/customers/:id/phone/status, GET /customer/profile/phone/status), the POS and the customer
// app — one definition, not three copies that drift (Constitution 13 §15). No full number for the customer realm:
// `display` is null there; staff see the readable number they need to call.
export type CustomerPhoneStatusValue =
  | 'active_verified' | 'active_unverified' | 'pending_verification' | 'verification_failed' | 'verification_expired'
  | 'replaced' | 'inactive' | 'disputed' | 'locked' | 'manual_review_required';

export interface CustomerPhoneStatus {
  customerId: string;
  /** The customer record's version — send it back as `expectedVersion` so a stale screen cannot overwrite a newer number. */
  recordVersion: number;
  phone: {
    display: string | null;
    masked: string | null;
    status: CustomerPhoneStatusValue;
    verified: boolean;
    /** "Verified by SMS" | "Not verified" | "Manually confirmed — OTP not completed" */
    label: string;
    verifiedAt: string | null;
    since: string | null;
  } | null;
  /** A change in flight (at most one per customer). */
  openChange: { sessionId: string; state: string; maskedPhone: string; expired: boolean; source: string } | null;
  /** 'retrying': the last change is active but some linked records are still updating (the job queue retries it). */
  sync: 'ok' | 'retrying';
  lastChange: { sessionId: string; state: string; completedAt: string | null } | null;
}

/** Super Admin → Customer Phone Oversight (GET /super-admin/customer-phone/oversight). Counts only — never a number. */
export interface CustomerPhoneOversight {
  sinceHours: number;
  tenantsWithUpdatesEnabled: number;
  updatesRequested: number;
  verified: number;
  failed: number;
  /** Changes whose number another customer already used (shared family phone, manager-resolved, …). */
  duplicateConflicts: number;
  /** Verified, but the linked records never caught up. These customers believe their number changed. */
  synchronizationFailures: number;
  /** Synchronisations whose retries ran out (dead jobs) — need support. */
  synchronizationDead: number;
  /** A manager confirmed a number without SMS ("OTP not completed"). */
  manualConfirmations: number;
  /** Staff changed a number without SMS under the salon's policy. */
  changesWithoutSms: number;
  awaitingApproval: number;
  openSessions: number;
  expiredSessions: number;
}

/** GET /super-admin/customer-phone/oversight/tenants — per salon, counts only. */
export interface CustomerPhoneOversightTenantRow { tenantId: string; tenantName: string; requested: number; verified: number; failed: number; syncFailed: number; awaitingApproval: number }

/** POST /super-admin/customer-phone/sweep */
export interface CustomerPhoneSweepResult { ok: true; expired: number; syncQueued: number }
