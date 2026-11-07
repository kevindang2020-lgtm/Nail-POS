// payment-processor.port.ts — a minimal processor abstraction the checkout service depends on.
// Implemented for real by CardPointeClient (Fiserv/CardConnect Gateway). Kept independent of checkout DTOs so it can be
// unit-tested in isolation and reused. All amounts are integer cents at this boundary; the client converts to the
// processor's wire format.

export interface AuthorizeInput {
  /** A CardSecure/CardPointe token (hosted-tokenizer model) or, in test, a PAN. The raw card never needs to touch us. */
  account: string;
  /** Card expiry as MMYY (e.g. "1229"). */
  expiry?: string;
  amountCents: number;
  cvv?: string;
  /** Our ticket id — passed through as the processor order id for reconciliation. */
  orderId?: string;
  idempotencyKey?: string;
  /** Card-not-present ('E' ecommerce) vs retail keyed ('R'). Fiserv onboarding (Aug 27 2026): CNP transactions MUST carry
   *  ecomind 'E' or they are processed as card present. Default: 'E' — every REST-gateway charge in this system is a
   *  token from the hosted tokenizer or a saved card, never a swipe (swipes go through the Bolt terminal). */
  ecomind?: 'E' | 'R' | 'T';
  /** Cardholder name and AVS (street number + zip) — the gateway's stated best practice for CNP; sent when known. */
  name?: string;
  address?: string;
  postal?: string;
  /** Visa/Mastercard Stored Credential Transaction Framework (mandated by Fiserv when a token / profile is reused):
   *  cof 'C' = cardholder-initiated (the customer taps "pay with my saved card"), 'M' = merchant-initiated (a membership
   *  renewal the customer is not present for); cofscheduled 'Y' for a recurring/installment schedule, 'N' for an
   *  unscheduled one. cofpermission 'Y' on the FIRST transaction that stores the credential with consent. */
  cof?: 'C' | 'M';
  cofscheduled?: 'Y' | 'N';
  cofpermission?: 'Y' | 'N';
  /** 'Y' asks the gateway to create a stored profile from this transaction (the response carries profileid). */
  profile?: 'Y';
}

/** Mandate §232 (Oct 20 2026): what the processor's answer MEANS, decided by the adapter that knows its vocabulary.
 *  'retry'   — the host could not process the request and nothing was charged (CardPointe respstat 'B'); safe to try again
 *              or take another tender; NEVER a decline.
 *  'unknown' — the processor answered but did not settle the question (Clover 'pending', an unrecognised status); the
 *              attempt must be VERIFIED, never recorded as declined and never charged again blindly.
 *  Absent → derived from approved / declined (older adapters / tests): approved → 'approved', declined → 'declined',
 *  otherwise 'unknown'. */
export type AuthorizeOutcome = 'approved' | 'declined' | 'retry' | 'unknown';
export function authorizeOutcome(r: { approved: boolean; declined?: boolean; outcome?: AuthorizeOutcome; respstat?: string }): AuthorizeOutcome {
  if (r.outcome) return r.outcome;
  if (r.approved) return 'approved';
  if (r.declined === true) return 'declined';
  // the documented respstat vocabulary ('A' approved, 'B' retry, 'C' declined) for adapters / fakes that set only it
  const rs = String(r.respstat ?? '').toUpperCase();
  return rs === 'C' ? 'declined' : rs === 'B' ? 'retry' : 'unknown';
}
export interface AuthorizeResult {
  approved: boolean;
  /** TRUE only for an explicit processor decline — never "not approved" (mandate §232). */
  declined: boolean;
  outcome?: AuthorizeOutcome;
  /** The processor retrieval reference ("retref") — the id used for later capture/refund/void. */
  retref?: string;
  authCode?: string;
  /** Raw processor status: "A" approved, "B" retry, "C" declined. */
  respstat: string;
  respText: string;
  amountCents?: number;
  /** Set when the gateway created a stored profile (profile: 'Y' on the request). */
  profileId?: string;
  /** AVS / CVV response codes as the gateway returns them (e.g. 'Y', 'N', 'P'). */
  avsResp?: string;
  cvvResp?: string;
  /** Fiserv Merchant Surcharge Program — the fee the PROVIDER assessed on this authorization (fee_amount), in integer
   *  cents. Absent/0 = no surcharge (merchant not enrolled, debit/prepaid, restricted ZIP, waived). This is the ONLY
   *  surcharge figure the ledger may record; the app never adds its own fee to an authorization amount. */
  surchargeCents?: number;
  /** fee_type as returned ("SURCHRG" | "SURCHRG_WAIVED" | …) and fee_value (rate in basis points, e.g. "300" = 3%). */
  feeType?: string;
  feeValue?: string;
}

export interface ConnectionTestResult { ok: boolean; merchantEnabled?: boolean; cardProcessor?: string; avsSupported?: boolean; cvvSupported?: boolean; message: string; }
export interface RefundInput { retref: string; amountCents?: number; idempotencyKey?: string; }
export interface VoidInput { retref: string; idempotencyKey?: string; }
export interface ProcessorActionResult { ok: boolean; retref?: string; respstat: string; respText: string; /** an explicit decline (not an unknown) */ declined?: boolean }

export interface PaymentProcessor {
  readonly name: string;
  authorizeAndCapture(input: AuthorizeInput): Promise<AuthorizeResult>;
  /** "Please make sure you can communicate with our gateway": an authenticated round trip that charges nothing. */
  testConnection?(): Promise<ConnectionTestResult>;
  refund(input: RefundInput): Promise<ProcessorActionResult>;
  voidTransaction(input: VoidInput): Promise<ProcessorActionResult>;
  /** Functional Decision 22: when a charge's outcome is unknown (connection lost mid-transaction), ASK the processor
   *  what happened instead of retrying or voiding. Returns every transaction the processor holds for the order id.
   *  Throws when the processor cannot be reached — the caller must then treat the outcome as still unknown.
   *  Optional: a processor without an inquiry API leaves verification at "unknown" (never guessed). */
  inquireByOrderId?(orderId: string): Promise<InquiryResult>;
  /** Fiserv master build §8D: store a hosted-iFrame token as a provider profile for THIS merchant (CardPointe
   *  PUT /profile). The provider accepting it is the proof the token is genuine and usable by this MID; a format check
   *  alone never is. Optional: a processor without it cannot save cards (the feature stays off). */
  createStoredProfile?(input: StoredProfileInput): Promise<StoredProfileResult>;
  /** Remove the provider profile when the customer deletes the card (best-effort; the row is revoked regardless). */
  deleteStoredProfile?(input: { profileId: string; acctId?: string }): Promise<{ ok: boolean; respText: string }>;
}

export interface StoredProfileInput { account: string; expiry?: string; postal?: string; name?: string }
export interface StoredProfileResult {
  ok: boolean; respstat: string; respText: string;
  profileId?: string; acctId?: string; token?: string; expiry?: string; accountType?: string;
}

export interface InquiryTransaction { retref?: string; approved: boolean; declined: boolean; amountCents?: number; authCode?: string; respText?: string }
export interface InquiryResult { transactions: InquiryTransaction[] }

export class ProcessorError extends Error {
  constructor(message: string, readonly httpStatus?: number) { super(message); this.name = 'ProcessorError'; }
}
