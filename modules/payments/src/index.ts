// modules/payments — the payments domain (Constitution 13 Phase 6): the ONE public entry point (§97). The API composes the Nest
// module and imports ONLY from here; every other file in this module is internal (§98–99).

export { RefundsVoidsModule } from './refunds-voids/refunds-voids.module';
export { SplitPaymentsModule } from './split-payments/split-payments.module';
export * from './refunds-voids/refunds-voids.dto';
export * from './split-payments/split-payments.dto';
// joined by --into (payments):
export { PaymentReconciliationModule } from './payments/payment-reconciliation.module';
export { PaymentWebhookModule } from './payments/payment-webhook.module';
export { BoltConfig, CardPointeBoltClient, TerminalDevicePort, terminalSignatureDataUrl } from './payments/cardpointe-bolt.client';   // used by the API today
export { FetchLike } from './payments/cardpointe.client';   // used by the API today
export { CommerceHubClient, commerceHubConfigFromEnv } from './payments/commercehub.client';   // used by the API today
export { PaymentGatewayResolver, UpsertGatewayInput, BranchMerchantAccountView, TapToPayMerchant, checkProcessorUrl, PROCESSOR_URL_POLICIES } from './payments/payment-gateway.resolver';   // used by the API today
export { PaymentGatewayModule, PAYMENT_GATEWAY_TOKEN } from './payments/payment-gateway.module';   // §105: the router under a string token for domains that must not import payments
export { terminalOperationalStatus, TERMINAL_STATUS_LABEL, TERMINAL_FRESH_MS, type TerminalOperationalStatus, type TerminalStatusInput } from '@aipowersalon/api-contracts';   // wave 3 PAYI §12/§50 (the contract owns the derivation)
export { GatewayAction, GatewayFilters, RawEventRow, RawGatewayRow, computeKpis, filterGateways, gatewayStatusTransition, mapEvent, maskMid, paginate, statusBreakdown, toCsv, toGatewayView, topProcessors } from './payments/payment-gateways-core';   // used by the API today
export { PaymentProcessor, authorizeOutcome, type AuthorizeOutcome } from './payments/payment-processor.port';   // used by the API today
export { cardPointeConfigured, processorFromEnv } from './payments/processor.factory';   // used by the API today
// joined by --into (hardware-payment):
export { HardwarePaymentModule } from './hardware-payment/hardware-payment.module';
export * from './hardware-payment/hardware-payment.dto';
export { SandboxPaymentProcessor } from './hardware-payment/hardware-payment.charge-adapter';   // used by the API today
// joined by --into (invoices):
export { InvoicesModule } from './invoices/invoices.module';
// joined by --into (customer-payments):
export { CustomerPaymentsModule } from './customer-payments/customer-payments.module';
export { WalletTopupService, decideTopUp, decideTopUp as decideIntentFromRecord, type TopUpSweepReport } from './customer-payments/customer-payments.service';   // B-79/B-80 (Oct 23 2026): the stranded sweep settles open top-ups; skip-line reuses the one record→verdict rule
// joined by --into (deposit-reconciliation):
export { DepositReconciliationModule } from './deposit-reconciliation/deposit-reconciliation.module';
export * from './deposit-reconciliation/deposit-reconciliation.dto';
export { KyselyWebhookRepository } from './deposit-reconciliation/deposit-reconciliation.webhook.repository';   // used by the API today
export { BankWebhookService } from './deposit-reconciliation/deposit-reconciliation.webhook.service';   // Phase 14: the API's per-provider webhook dedupe pgtest
export { looksLikeRawPan, isCardSecureToken, tokenizerForGatewayBase } from './payments/card-data';   // the one PCI card-data rule (the purge script uses it too)
export { calculateRefundAllocations, type OriginalTender, type RefundAllocation } from './refunds-voids/refund-orchestration';   // Functional Decision 20 — used by checkout's ticket-level refund
export { PaymentWebhookService, settlementTxnIds } from './payments/payment-webhook.service';   // used by the API's Phase 10 settlement-link pgtest
export { PAYMENT, CHARGEBACK, PAYMENT_GATEWAY, MERCHANT_ONBOARDING, INVOICE, BANK_ACCOUNT, RECONCILIATION_EXCEPTION, RECONCILIATION_PERIOD, WALLET_TOPUP_INTENT, PAYMENT_REFUND, INVOICE_DELIVERY } from './payments-lifecycles';   // Phase 12 (#27): checkout, super-admin
export { integrationsProductionProblems } from './payments/integrations-production-config';   // wave 3 PAYI §125–§126: startup validation of the provider environment
export { GiftCardsScreenRepository } from './finance-screens/gift-cards-screen.repository';
export { TipsScreenRepository } from './finance-screens/tips-screen.repository';   // Tips mandate (Oct 29 2026)
export { SplitPaymentsScreenRepository } from './finance-screens/split-payments-screen.repository';   // Split Payments mandate (Oct 29 2026)   // Gift Cards mandate (Oct 29 2026): the screen read model (checkout's gift-card tests read through it)
export { CashHandoffsScreenRepository } from './finance-screens/cash-handoffs-screen.repository';   // End-of-Day Cash mandate (Oct 29 2026)
export { RefundsVoidsScreenRepository } from './finance-screens/refunds-voids-screen.repository';   // Refunds & Voids mandate (Oct 29 2026)
