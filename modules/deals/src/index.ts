// modules/deals — the deals domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { BundlesModule } from './bundles/bundles.module';
export { PromotionsModule } from './promotions/promotions.module';
export { SalonPromotionsModule } from './salon-promotions/salon-promotions.module';
export * from './bundles/bundles.dto';
export * from './salon-promotions/salon-promotions.dto';
export { SalonPromotionsService } from './salon-promotions/salon-promotions.service';   // used by the API today
// joined by --into (deals):
export { DealsModule } from './deals/deals.module';
export * from './deals/deals.dto';
export { KyselyDealsRepository } from './deals/deals.kysely.repository';   // used by the API today
export { DealsService } from './deals/deals.service';   // used by the API today
// BUILD_PLAN Phase 5 (deals_engine): the one pricing engine, eligibility, coupons and the ticket-offer service
export * from './engine/pricing';
export * from './engine/eligibility';
export * from './engine/coupons';
export { DealsCheckoutService, DealRefusedError, applicationOffer, type TicketOfferRequest, type OfferCandidate, type OfferSummary } from './engine/deals-checkout.service';
export { KyselyDealsLedger, LedgerRefusal, dealRule, type LiveApplication } from './engine/deals-ledger.kysely';   // dealRule: Deals & Offers 12 (commission impact sample)
export { KyselyDealsMarketplace } from './deals/deals-marketplace.kysely';
export { DealsLifecycleScheduler, runDealsLifecycle, registerDealsJobHandlers, DEALS_JOB } from './engine/deals-lifecycle.scheduler';
export { DealForbiddenError, DealValidationError, DealConflictError } from './deals/deals.service';
export { DEAL_REDEMPTION_HOLD, DEAL_REDEMPTION, DEAL, DEAL_COUPON_CODE, BUNDLE } from './engine/deal-lifecycles';   // BUILD_PLAN Phase 12 (#27): the deal lifecycles' state machines
export { ReferralVouchersModule, ReferralVoucherIssuer, REFERRAL_VOUCHERS, type IssuedVoucher, type VoucherUsage, type VoucherRole } from './salon-promotions/referral-vouchers';   // Referral Rewards build (Nov 5 2026)
