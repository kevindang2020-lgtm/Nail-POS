// modules/customers — the customers domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { CustomerSalonsModule } from './customer-salons/customer-salons.module';
export { readAppFlag } from './customer-salons/app-flags.util';   // used by the API today
export { CustomerSalonsController } from './customer-salons/customer-salons.controller';   // used by the API today
export { CustomerSalonsService, SalonSearchError } from './customer-salons/customer-salons.service';   // used by the API today
export { haversineMiles } from './customer-salons/salon-directory-core';   // used by the API today
// joined by --into (customer-activation-rules):
export { CodeState, DirectoryMatch, GENERIC_REQUEST_RESPONSE, MSG, OTP_MAX_ATTEMPTS, MAX_CODES_PER_IP_HOUR, MAX_CODES_PER_DEVICE_HOUR, OTP_TTL_SECONDS, SalonChoice, canResend, checkSource, decideVerify, generateOtp, isWellFormedOtp, maskPhone, displayPhone, callingCode, normalizePhone, otpMessage, phoneDigitsMatch, phoneKey, redactOtp, resolveMatches, toStoredCustomerPhone } from './customer-activation-rules/customer-activation-core';   // used by the API today
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
export { KyselyCustomersRepository } from './customers/customers.kysely.repository';   // used by the API today
export { CustomersContext, InMemoryCustomersRepository } from './customers/customers.repository';   // used by the API today
export { CustomersService } from './customers/customers.service';   // used by the API today
// joined by --into (reviews, wallet):
export { ReviewsModule } from './reviews/reviews.module';
export { WalletModule } from './wallet/wallet.module';
export * from './reviews/reviews.dto';
export { ReviewsService } from './reviews/reviews.service';   // used by the API today
export { recomputeTechRatingDenorm } from './reviews/reviews.kysely.repository';   // THE rating denorm — the workforce tech-profile service applies it after a rating / response (WF merge Oct 12 2026)
export { InMemoryWalletLedgerRepository } from './wallet/wallet.repository';   // used by the API today
export { WalletLedgerService } from './wallet/wallet.service';   // used by the API today
// joined by --into (pos-referrals):
export { ReferralsModule } from './pos-referrals/pos-referrals.module';
export * from './pos-referrals/pos-referrals.dto';
// BUILD_PLAN Phase 10: the ONE loyalty balance writer (ledger as truth) + its daily reconcile job
export { applyLoyaltyEntry, lockLoyaltyCustomer, reconcileLoyaltyBalances, LoyaltyLedgerService, LoyaltyLedgerError, LOYALTY_ENTRY_TYPES, type LoyaltyEntryInput, type LoyaltyEntryResult, type LoyaltyEntryType, type LoyaltyReconcileResult } from './loyalty/loyalty-ledger.service';
export { LoyaltyReconcileScheduler, loyaltyReconcileEnabled } from './loyalty/loyalty-reconcile.scheduler';
