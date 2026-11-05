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
export { PaymentGatewayResolver, UpsertGatewayInput, BranchMerchantAccountView } from './payments/payment-gateway.resolver';   // used by the API today
export { terminalOperationalStatus, TERMINAL_STATUS_LABEL, TERMINAL_FRESH_MS, type TerminalOperationalStatus, type TerminalStatusInput } from '@aipowersalon/api-contracts';   // wave 3 PAYI §12/§50 (the contract owns the derivation)
export { GatewayAction, GatewayFilters, RawEventRow, RawGatewayRow, computeKpis, filterGateways, gatewayStatusTransition, mapEvent, maskMid, paginate, statusBreakdown, toCsv, toGatewayView, topProcessors } from './payments/payment-gateways-core';   // used by the API today
export { PaymentProcessor } from './payments/payment-processor.port';   // used by the API today
export { cardPointeConfigured, processorFromEnv } from './payments/processor.factory';   // used by the API today
// joined by --into (hardware-payment):
export { HardwarePaymentModule } from './hardware-payment/hardware-payment.module';
export * from './hardware-payment/hardware-payment.dto';
export { SandboxPaymentProcessor } from './hardware-payment/hardware-payment.charge-adapter';   // used by the API today
// joined by --into (invoices):
export { InvoicesModule } from './invoices/invoices.module';
// joined by --into (customer-payments):
export { CustomerPaymentsModule } from './customer-payments/customer-payments.module';
// joined by --into (deposit-reconciliation):
export { DepositReconciliationModule } from './deposit-reconciliation/deposit-reconciliation.module';
export * from './deposit-reconciliation/deposit-reconciliation.dto';
export { KyselyWebhookRepository } from './deposit-reconciliation/deposit-reconciliation.webhook.repository';   // used by the API today
export { BankWebhookService } from './deposit-reconciliation/deposit-reconciliation.webhook.service';   // Phase 14: the API's per-provider webhook dedupe pgtest
export { looksLikeRawPan, isCardSecureToken, tokenizerForGatewayBase } from './payments/card-data';   // the one PCI card-data rule (the purge script uses it too)
export { calculateRefundAllocations, type OriginalTender, type RefundAllocation } from './refunds-voids/refund-orchestration';   // Functional Decision 20 — used by checkout's ticket-level refund
export { PaymentWebhookService, settlementTxnIds } from './payments/payment-webhook.service';   // used by the API's Phase 10 settlement-link pgtest
export { PAYMENT, CHARGEBACK, PAYMENT_GATEWAY, MERCHANT_ONBOARDING, INVOICE, RECONCILIATION_EXCEPTION, RECONCILIATION_PERIOD } from './payments-lifecycles';   // Phase 12 (#27): checkout, super-admin
export { integrationsProductionProblems } from './payments/integrations-production-config';   // wave 3 PAYI §125–§126: startup validation of the provider environment
