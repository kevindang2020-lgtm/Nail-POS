// modules/checkout — the checkout domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { CashDrawerModule } from './cash-drawer/cash-drawer.module';
export { CheckoutModule } from './checkout/checkout.module';
export { type BookingDepositCheckoutPort } from './checkout/checkout.service';
export { CheckoutService } from './checkout/checkout.service';   // used by the API's customer display (the receipt step, 23-inch spec §97)
export { pickDisplays, type DisplayCandidate, type DisplayPick } from './checkout/display-send-core';   // 23-inch spec §9–§11: which display a checkout goes to
export { MobileCheckoutModule } from './mobile-checkout/mobile-checkout.module';
export * from './cash-drawer/cash-drawer.dto';
export { drawerCtx, drawerRun } from './cash-drawer/cash-drawer.http';   // used by the API today
export { CashDrawerService } from './cash-drawer/cash-drawer.service';   // used by the API today
export { CheckoutSettings, CustomerDisplayState, DEFAULT_CHECKOUT_SETTINGS, DisplayState, PaymentMethod, computeTotals, tipForPercent, tipOptions, validateCustomTip } from './checkout/checkout-display.dto';   // used by the API today
export { resolveCheckoutSettings } from './checkout/checkout-settings.resolver';   // used by the API today
export { KyselyCheckoutRepository } from './checkout/checkout.kysely.repository';   // used by the API today
export { buildCustomerDisplayCheckout, type CustomerDisplayProjectionInput } from './checkout/customer-display-projection';   // 23-inch display: the customer-safe checkout (used by the API's customer display)
export { refundThresholds } from './checkout/refund-approval';   // used by the API today
// joined by --into (ticket-history):
export { TicketHistoryModule } from './ticket-history/ticket-history.module';
export { TicketHistoryLine, TicketHistoryRevision } from './ticket-history/ticket-history.service';   // used by the API today
// joined by --into (skip-line-checkout, ai-checkout-upsell):
export { AiCheckoutUpsellModule } from './ai-checkout-upsell/ai-checkout-upsell.module';
export { SkipLineCheckoutModule } from './skip-line-checkout/skip-line-checkout.module';
export * from './ai-checkout-upsell/ai-checkout-upsell.dto';
export * from './skip-line-checkout/skip-line-checkout.dto';
export { CashDrawerRepository } from './cash-drawer/cash-drawer.repository';   // used by the API's cash-drawer producer pgtest
export { SkipLineCheckoutRepository } from './skip-line-checkout/skip-line-checkout.repository';   // used by the API's skip-line producer pgtest
export { visitCompletedEvent, type VisitChannel } from './checkout/visit-completed';   // Phase 15: the one visit.completed builder
export { KyselyTerminalLeases, InMemoryTerminalLeases, TERMINAL_LEASE_TTL_SECONDS, type TerminalLeasePort } from './checkout/terminal-lease';
export { CheckoutLockService, LockHeldElsewhereError } from './checkout-lock/checkout-lock.service';   // one lock per ticket — the display's terminal charge takes it too (Oct 6 2026)
export { KyselyCheckoutLockRepository, InMemoryCheckoutLockRepository } from './checkout-lock/checkout-lock.repository';   // Functional Decision 34 — shared terminal, one transaction at a time
export { strandedMinutes, decideSplitAttempt, type Resolution as PaymentAttemptResolution } from './checkout/payment-attempt-sweep';   // BUILD_PLAN Phase 11: System Operations shows the stranded-attempt threshold
export { PAYMENT_ATTEMPT } from './checkout/payment-attempt-machine';   // BUILD_PLAN Phase 12 (#27): this module's lifecycle state machines
export { LOYALTY_REDEMPTION, CASH_DRAWER_SESSION } from './checkout/checkout-lifecycles';   // BUILD_PLAN Phase 12 (#27): this module's lifecycle state machines
// Owner & Manager Payment App mandate (Oct 13 2026, wave 3 / TTP): production-config refusal of a mock provider (§211–§213),
// the recovery worker for unresolved Tap to Pay attempts (§74–§78) and the termination hook (§140) — used by the API.
export { tapToPayProductionProblems, FISERV_COMMERCEHUB_TTP_CAPABILITIES, type PaymentProviderCapabilities } from './mobile-checkout/ttp-config';
export { MobileCheckoutService } from './mobile-checkout/mobile-checkout.service';
export { MobileAttemptRecoveryWorker, type MobileRecoveryReport } from './mobile-checkout/mobile-attempt-recovery';
export { KyselyMobilePayDeviceStore } from './mobile-checkout/mobile-pay-device.kysely';   // the API's termination consumer revokes a user's payment phones through the ONE store (mandate §140)
export { KyselyMobilePaymentAttemptRepository } from './mobile-checkout/mobile-payment-attempt.repository';   // SD-21: the cross-branch suite reads the attempt-by-key predicate on the real repository
