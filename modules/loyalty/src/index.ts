// modules/loyalty — the loyalty domain (Constitution 13 §40): the ONE public entry point (§97). Everything else in
// this module is internal; the API composes LoyaltyModule and never imports past this file (§98–99).
export { LoyaltyModule } from './loyalty.module';
export * from './loyalty.dto';

// Global Loyalty & Rewards Network + prepaid tenant token wallet (LoyaltyTokens.pdf v1.0, LoyaltyRules.pdf v2.0)
export { GlobalRewardsRepository } from './global-rewards/global-rewards.repository';
export { earnForTicket, reverseEarnForRefund, TenantMismatchError as GrTenantMismatchError } from './global-rewards/rewards-earn';
export { GR_FLAGS } from './global-rewards/global-rewards-flags';
// Final Completion guide §04–§05: cross-salon redemption at Checkout + reimbursement payables / payouts
export { holdForTicket, releaseHold, finalizeForPaidTicket, reverseRedemptionForRefund, redemptionQuote, rewardsIdentityFor, requestPayout, applyPayoutSettlement, markPayoutEligible, holdPayable, payoutProviderFromEnv, PAYOUT_PROVIDER, type PayoutProvider } from './global-rewards/rewards-redemption';
export { GlobalRewardsCheckoutModule, GlobalRewardsCheckoutAdapter, GLOBAL_REWARDS_CHECKOUT_TOKEN, expireHolds } from './global-rewards/global-rewards-checkout';
