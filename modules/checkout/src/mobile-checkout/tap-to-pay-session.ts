// tap-to-pay-session.ts — the canonical abstraction for the Tap to Pay on iPhone *session* boundary (spec §8).
//
// Tap to Pay on iPhone authorizes the card in a NATIVE iOS SDK on the device. The backend's role is NOT to swipe the
// card; it is to (1) mint a short-lived processor session token the on-device SDK uses to run the tap, and (2) verify
// / finalize the resulting transaction server-side before the checkout is marked paid. Both steps sit behind THIS
// port so the checkout service never talks to a processor SDK directly and a different processor can be swapped in.
//
// When no real integration is wired, the adapter reports an HONEST unavailable state (a typed error) and NEVER
// fabricates a session token or a successful charge (spec §7). Readiness already blocks the app before it gets here;
// this port is the last, definitive honest boundary.

export interface MintSessionInput {
  tenantId: string;
  branchId?: string | null;
  idempotencyKey: string;   // ties the session to the payment attempt (replay-safe)
  amountCents: number;      // integer cents
  currency: string;         // e.g. 'USD'
  deviceId?: string | null;
}

export interface DeviceSession {
  provider: string;         // e.g. 'fiserv_commercehub'
  sessionToken: string;     // the PaymentSession id (sessionId) the on-device SDK inits with and later charges against
  expiresAt: string;        // ISO — short lived (CommerceHub sessions expire in ~30 min)
  environment: 'sandbox' | 'production';
  accessToken?: string;     // CommerceHub: token the SDK initialises with
  publicKey?: string;       // CommerceHub: public key for on-device encryption
}

export interface FinalizeInput {
  tenantId: string;
  idempotencyKey: string;
  processorRef: string;     // the reference the device SDK returned
  amountCents: number;
}

export interface FinalizeResult {
  verified: boolean;        // did the processor confirm this transaction server-side?
  processorRef: string;
  capturedAmountCents?: number;
  respText?: string;
}

/** Mandate §76/§78: the provider's own answer about a transaction whose result never reached us. Never guessed. */
export type TapToPayLookup =
  | { kind: 'approved'; processorRef: string; capturedAmountCents?: number; cardBrand?: string; cardLast4?: string }
  | { kind: 'declined'; processorRef?: string; respText?: string }
  | { kind: 'not_found' }
  | { kind: 'no_inquiry' }          // the provider integration has no status lookup → a human resolves it (never auto-decided)
  | { kind: 'unreachable'; error: string };

/** The canonical Tap to Pay session boundary (the mandate's TapToPayProviderPort, §18/§179). Implemented by a real
 *  processor adapter (Fiserv CommerceHub) or a Noop. */
export interface TapToPaySessionPort {
  /** The provider's normalized name — PaymentIntent.provider and the provider-specific kill switch key (§199). */
  readonly provider: string;
  /** True only when a real, credentialled integration is present. */
  isConfigured(): boolean;
  /** §76: ask the provider what became of a transaction (by the idempotency key / order id and, when known, its
   *  reference). Throws TapToPayNotConfiguredError when unconfigured; otherwise always answers honestly. */
  lookupTransaction(input: { tenantId: string; idempotencyKey: string; processorRef?: string | null; amountCents: number }): Promise<TapToPayLookup>;
  /** Mint a processor session token for the on-device SDK. Throws TapToPayNotConfiguredError when unconfigured. */
  mintDeviceSession(input: MintSessionInput): Promise<DeviceSession>;
  /** Verify/finalize the SDK's transaction server-side. Throws TapToPayNotConfiguredError when unconfigured. */
  finalizeTransaction(input: FinalizeInput): Promise<FinalizeResult>;
}

/** The integration is not set up (no credentials / not onboarded). Honest, never a fabricated success. */
export class TapToPayNotConfiguredError extends Error {
  readonly code = 'tap_to_pay_not_configured';
  constructor(message = 'Tap to Pay on iPhone is not configured for this environment.') { super(message); this.name = 'TapToPayNotConfiguredError'; }
}

/** Credentials exist but the live processor call has not been wired against the verified processor contract yet. */
export class TapToPayNotImplementedError extends Error {
  readonly code = 'tap_to_pay_not_implemented';
  constructor(message = 'Tap to Pay session minting requires the verified CommerceHub API contract to be wired.') { super(message); this.name = 'TapToPayNotImplementedError'; }
}

/** Default adapter when Tap to Pay is not configured: everything is honestly unavailable. */
export class NoopTapToPaySessionAdapter implements TapToPaySessionPort {
  readonly provider = 'none';
  isConfigured(): boolean { return false; }
  async mintDeviceSession(): Promise<DeviceSession> { throw new TapToPayNotConfiguredError(); }
  async finalizeTransaction(): Promise<FinalizeResult> { throw new TapToPayNotConfiguredError(); }
  async lookupTransaction(): Promise<TapToPayLookup> { throw new TapToPayNotConfiguredError(); }
}
