// ttp-config.ts — the honest boundary for Tap to Pay on iPhone.
//
// Tap to Pay on iPhone runs in a NATIVE iOS SDK on the device — for Fiserv that is the `FiservTTP` Swift package
// (FiservTTPCardReader), which talks to Fiserv **CommerceHub** (a different product from the CardPointe/Bolt terminal
// rail this codebase already uses). The backend's job for TTP is NOT to authorize cards itself; it is to (1) mint a
// CommerceHub session token for the device SDK and (2) verify/finalize the resulting transaction server-side. Both
// require CommerceHub credentials + an Apple Tap-to-Pay entitlement (requested from Apple with PSP = "Fiserv").
//
// None of that exists yet, so this module reports Tap to Pay as **SetupRequired** — never as ready, and never faking a
// successful payment. Fill these env vars (and complete Apple entitlement + CommerceHub merchant onboarding) to enable
// it; readiness will flip to ok only once a real session token can be minted.

export interface FiservTtpConfig {
  apiKey: string;
  apiSecret: string;
  /** the PLATFORM's sandbox CommerceHub MID (optional since migration 704): each location charges through its own MID
   *  (resolveTapToPayMerchant); this env MID is used only in a sandbox / with PAYMENTS_ALLOW_ENV_FALLBACK=1. */
  merchantId: string;
  terminalProfileId: string;     // configures the on-device reader kernels
  appleTtpMerchantId?: string;   // optional, provided by Fiserv
  environment: 'sandbox' | 'production';
  currency: string;
}

/** Returns the CommerceHub TTP config when fully present, else null (→ readiness SetupRequired). No secrets are logged. */
export function fiservTtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): FiservTtpConfig | null {
  const apiKey = env.COMMERCEHUB_TTP_API_KEY;
  const apiSecret = env.COMMERCEHUB_TTP_API_SECRET;
  const merchantId = env.COMMERCEHUB_TTP_MERCHANT_ID;
  const terminalProfileId = env.COMMERCEHUB_TTP_TERMINAL_PROFILE_ID;
  if (!apiKey || !apiSecret || !terminalProfileId) return null;
  return {
    apiKey,
    apiSecret,
    merchantId: merchantId || '',
    terminalProfileId,
    appleTtpMerchantId: env.COMMERCEHUB_TTP_APPLE_MERCHANT_ID || undefined,
    environment: env.COMMERCEHUB_TTP_ENV === 'production' ? 'production' : 'sandbox',
    currency: env.COMMERCEHUB_TTP_CURRENCY || 'USD',
  };
}

export function tapToPayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return fiservTtpConfigFromEnv(env) !== null;
}

// ── Mandate §211–§213: production refuses a mock / sandbox Tap to Pay provider ──────────────────────────────────────────
/**
 * Pure: every reason a PRODUCTION process must not start with this payment configuration ([] outside production).
 * Wired into apps/api common/production-config.ts (assertProductionConfig) so the API exits before it serves a request.
 *   • PAYMENTS_SANDBOX=1 — the checkout's simulated card approvals (a fake-success provider) are never a production mode.
 *   • PAYMENTS_ALLOW_ENV_FALLBACK=1 — a process-wide env gateway instead of each salon's own merchant (§30).
 *   • TAP_TO_PAY_MOCK / MOBILE_PAY_MOCK_PROVIDER — any mock Tap to Pay provider switch (§212: tests and sandbox only).
 *   • CommerceHub Tap to Pay credentials present but COMMERCEHUB_TTP_ENV != 'production' — mixed sandbox/production
 *     merchant credentials (§125).
 */
export function tapToPayProductionProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const out: string[] = [];
  if (env.PAYMENTS_SANDBOX === '1') out.push('PAYMENTS_SANDBOX=1 is a simulated (fake-success) card provider — refused in production (Owner & Manager Payment App mandate §211–§213)');
  if (env.PAYMENTS_ALLOW_ENV_FALLBACK === '1') out.push('PAYMENTS_ALLOW_ENV_FALLBACK=1 would charge every salon through one environment gateway — refused in production (§30)');
  for (const k of ['TAP_TO_PAY_MOCK', 'MOBILE_PAY_MOCK_PROVIDER', 'TAP_TO_PAY_FAKE_SUCCESS']) {
    if (String(env[k] ?? '').trim() && String(env[k]).trim() !== '0' && String(env[k]).trim().toLowerCase() !== 'false') out.push(`${k} names a mock Tap to Pay provider — refused in production (§212–§213)`);
  }
  if (fiservTtpConfigFromEnv(env) && env.COMMERCEHUB_TTP_ENV !== 'production') out.push("COMMERCEHUB_TTP_ENV must be 'production' when CommerceHub Tap to Pay credentials are set (§125: no sandbox credentials in production)");
  return out;
}

// ── Mandate §19–§20: provider capabilities come from the ACTUAL integration, never assumed ─────────────────────────────
export interface PaymentProviderCapabilities {
  provider: string;
  tapToPay: boolean;
  cardPresentTerminal: boolean;
  refunds: boolean;
  voids: boolean;
  partialRefunds: boolean;
  splitPayments: boolean;
  tokenization: boolean;
  offlinePayments: boolean;   // §127: DISABLED unless the PSP certifies it and the reconciliation protocol exists — none does here
  statusLookup: boolean;
}

/** The Fiserv CommerceHub Tap to Pay provider as this codebase integrates it (fiserv-commercehub-ttp.adapter.ts +
 *  @aipowersalon/payments CommerceHubClient). Every `true` names an operation the adapter actually implements; the
 *  CardPointe / Clover terminal rails are different products (§20) and are described by @aipowersalon/payments. */
export const FISERV_COMMERCEHUB_TTP_CAPABILITIES: PaymentProviderCapabilities = Object.freeze({
  provider: 'fiserv_commercehub',
  tapToPay: true,
  cardPresentTerminal: false,     // chip / swipe route to Clover Compact / CardPointe terminal (§63)
  refunds: true,                  // through the canonical checkout refund engine → the tenant's processor adapter
  voids: true,
  partialRefunds: true,
  splitPayments: true,            // multiple tenders on ONE checkout (§83–§87); each card split is its own intent
  tokenization: false,            // no card-on-file through this rail
  offlinePayments: false,         // §127 default policy
  statusLookup: true,             // TapToPaySessionPort.lookupTransaction (CommerceHub inquiry) — BLOCKED_EXTERNAL until credentials exist
});
