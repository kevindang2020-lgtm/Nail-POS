// modules/customers — the customers domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { CustomerSalonsModule } from './customer-salons/customer-salons.module';
export { readAppFlag } from './customer-salons/app-flags.util';   // used by the API today
export { CustomerSalonsController } from './customer-salons/customer-salons.controller';   // used by the API today
export { CustomerSalonsService, SalonSearchError } from './customer-salons/customer-salons.service';   // used by the API today
export { haversineMiles } from './customer-salons/salon-directory-core';   // used by the API today
// joined by --into (customer-activation-rules):
export { CodeState, DirectoryMatch, GENERIC_REQUEST_RESPONSE, MSG, OTP_MAX_ATTEMPTS, MAX_CODES_PER_IP_HOUR, MAX_CODES_PER_DEVICE_HOUR, OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS, SalonChoice, canResend, checkSource, decideVerify, generateOtp, isWellFormedOtp, maskPhone, displayPhone, callingCode, normalizePhone, otpMessage, phoneDigitsMatch, phoneKey, redactOtp, resolveMatches, toStoredCustomerPhone } from './customer-activation-rules/customer-activation-core';   // used by the API today
// joined by --into (legal-hold):
export { KyselyLegalHoldRepo } from './legal-hold/legal-hold.kysely.repository';   // used by the API today
export { InMemoryLegalHoldRepo, LegalHoldRepo } from './legal-hold/legal-hold.repository';   // used by the API today
export { LegalHoldService } from './legal-hold/legal-hold.service';   // used by the API today
// joined by --into (customer-identity):
export { CustomerIdentityModule } from './customer-identity/customer-identity.module';
export { CustomerIdentityService } from './customer-identity/customer-identity.service';   // used by the API today
export { CustomerReconciliationService } from './customer-identity/customer-reconciliation.service';   // used by the API today
export { maskEmail } from './customer-identity/identity-core';   // used by the API today
// joined by --into (customers):
export { CustomersModule } from './customers/customers.module';
export * from './customers/customers.dto';
export { INACTIVE_DAYS, RETURNING_MIN_VISITS, VISIT_TICKET_STATUSES } from './customers/customer-segments';   // used by the API today
export { RetentionRepository, RetentionError, PERIOD_PRESETS, isUuid, maskPhone as maskStoredPhone } from './retention/retention.repository';   // Marketing & Growth (reports): salon-local periods + authorized branch scope
export type { RetentionContext, BranchScope } from './retention/retention.repository';
export { WinBackCenter } from './retention/winback-center';   // AI Marketing Assistant (ai): the ONE win-back / rebooking audience rule + its Segments draft
export { SegmentsRepository, SegmentsError } from './segments/segments.repository';   // Birthday Campaigns (reports): consent verdicts, unsent audience drafts, the customer overlay
export * from './birthdays/birthday-core';   // Birthday Campaigns: the ONE birthday → occurrence rule (Feb 29 policy, year rollover, occasion year)
export { KyselyCustomersRepository } from './customers/customers.kysely.repository';   // used by the API today
export { CustomersContext, InMemoryCustomersRepository } from './customers/customers.repository';   // used by the API today
export { CustomersService } from './customers/customers.service';   // used by the API today
// joined by --into (reviews, wallet):
export { ReviewsModule } from './reviews/reviews.module';
export { CustomerSearchModule } from './customer-search/customer-search.module';   // Customer Search guide (Nov 1 2026): /pos/customer-search/*
export { CustomerTimelineModule } from './customer-timeline/customer-timeline.module';   // Customer Timeline guide (Nov 1 2026): /pos/customer-timeline/*
export { tlPresetRange as salonPresetRange } from './customer-timeline/customer-timeline-center';   // shared salon-local date presets
export { DuplicateReviewModule } from './duplicate-review/duplicate-review.module';   // Duplicate Review guides (Nov 1 2026): /pos/duplicate-review/*
export { mergeCustomersTx, MERGE_REASSIGN_TABLES } from './customers/customer-merge';   // the canonical customer merge (one transaction)
export { WalletModule } from './wallet/wallet.module';
export * from './reviews/reviews.dto';
export { ReviewsService } from './reviews/reviews.service';   // used by the API today
export { recomputeTechRatingDenorm } from './reviews/reviews.kysely.repository';   // THE rating denorm — the workforce tech-profile service applies it after a rating / response (WF merge Oct 12 2026)
export { InMemoryWalletLedgerRepository } from './wallet/wallet.repository';   // used by the API today
export { WalletLedgerService } from './wallet/wallet.service';   // used by the API today
export { KyselyWalletLedgerRepository } from './wallet/wallet.kysely.repository';   // B-79 (Oct 23 2026): the top-up race / pg tests credit through the real ledger
// joined by --into (pos-referrals):
export { ReferralsModule } from './pos-referrals/pos-referrals.module';
export * from './pos-referrals/pos-referrals.dto';
export { ReferralProgram, ReferralProgramError } from './pos-referrals/referral-program';
export { REFERRAL_PROGRAM } from './pos-referrals/referral-program.controller';
// BUILD_PLAN Phase 10: the ONE loyalty balance writer (ledger as truth) + its daily reconcile job
export { applyLoyaltyEntry, lockLoyaltyCustomer, reconcileLoyaltyBalances, LoyaltyLedgerService, LoyaltyLedgerError, LOYALTY_ENTRY_TYPES, type LoyaltyEntryInput, type LoyaltyEntryResult, type LoyaltyEntryType, type LoyaltyReconcileResult } from './loyalty/loyalty-ledger.service';
export { LoyaltyReconcileScheduler, loyaltyReconcileEnabled } from './loyalty/loyalty-reconcile.scheduler';
export { LOYALTY_REDEMPTION } from './loyalty/loyalty-redemption-machine';   // loyalty_redemptions.status (checkout re-exports it)
