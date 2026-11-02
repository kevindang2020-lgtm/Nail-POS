// token-funding-provider.ts — the ONE seam through which Buy Tokens reaches money (LoyaltyTokens.pdf §5.2–§5.4, §12.3).
//
// There is NO live provider in this code: collecting prepaid funds from unaffiliated merchants for rewards redeemable at
// one another's salons needs an approved platform funding merchant/service, merchant terms, and legal/accounting review
// (guide §12.3) — and a salon's own card-processing merchant account cannot be assumed to buy from the platform (§5.2). Until one is
// approved and wired here, production has no provider and Buy Tokens answers TOKEN_FUNDING_PROVIDER_UNAVAILABLE
// (BLOCKED_EXTERNAL). The SANDBOX provider exists for tests and the internal pilot only: it can never be selected when
// NODE_ENV is 'production', and it never marks funds verified by itself — a Super Admin sandbox action (or, for a real
// provider, a signed webhook / provider inquiry) moves a purchase to FUNDS_VERIFIED, the only spendable state.
export interface FundingSubmitResult {
  /** what the provider said; never FUNDS_VERIFIED — confirmation of a payment is not settled funding */
  status: 'PROCESSING' | 'PAYMENT_CONFIRMED' | 'DECLINED' | 'UNKNOWN';
  providerRef: string | null;
  failureCode?: string | null;
}
export interface TokenFundingProvider {
  readonly name: string;
  readonly sandbox: boolean;
  submit(intent: { id: string; tenantId: string; amountCents: number; tokenCents: number; idempotencyKey: string }): Promise<FundingSubmitResult>;
}
export const TOKEN_FUNDING_PROVIDER = 'TokenFundingProvider';

export class SandboxTokenFundingProvider implements TokenFundingProvider {
  readonly name = 'sandbox';
  readonly sandbox = true;
  /** the provider ref is derived from the intent id, so a retried submit is the SAME provider order (no second charge) */
  async submit(intent: { id: string }): Promise<FundingSubmitResult> { return { status: 'PAYMENT_CONFIRMED', providerRef: `sbx_${intent.id}` }; }
}

/** The provider for this process: the sandbox only outside production and only when explicitly switched on. */
export function fundingProviderFromEnv(env: Record<string, string | undefined> = process.env): TokenFundingProvider | null {
  if (env.NODE_ENV === 'production') return null;
  return env.GLOBAL_REWARDS_SANDBOX_PROVIDER === 'on' ? new SandboxTokenFundingProvider() : null;
}
