// hardware-payment.dto.ts — types, statuses, and the small ports the service depends on.
import type { RevenueSplitSettings, ExtraCreditHandling, LedgerLine } from './hardware-payment-core';
export const AUTOPAY_CONSENT_TEXT = 'I authorize AIPowerSalon to charge my saved payment method for any monthly hardware payment shortage not covered by my hardware credit from processing revenue.';
export const AUTOPAY_CONSENT_VERSION = 'v1';

export type PlanStatus = 'draft' | 'active' | 'paused' | 'paid_off' | 'defaulted' | 'cancelled' | 'closed';
export type InvoiceStatus = 'draft' | 'open' | 'credit_applied' | 'shortfall_pending' | 'auto_charge_processing' | 'paid' | 'payment_failed' | 'payment_method_required' | 'past_due' | 'voided' | 'cancelled';

export interface HardwarePaymentPlan {
  id: string; tenantId: string; branchId?: string | null; hardwarePackageId?: string | null; status: PlanStatus;
  totalHardwareCostCents: number; downPaymentCents: number; financedAmountCents: number; monthlyPaymentCents: number;
  remainingBalanceCents: number; startDate?: string | null; endDate?: string | null; dueDayOfMonth: number;
  revenueSplitRecoveryEnabled: boolean; autoChargeShortfallEnabled: boolean; extraCreditHandling: ExtraCreditHandling;
  carryForwardCreditCents: number; savedPaymentMethodId?: string | null; createdByUserId?: string | null;
}
export interface HardwareInvoice {
  id: string; tenantId: string; planId: string; billingMonth: string; cardVolumeCents: number; pricingRateBps: number;
  expenseRateBps: number; netMarginCents: number; platformShareCents: number; fiservShareCents: number;
  salonHardwareCreditCents: number; hardwareMonthlyDueCents: number; carryForwardCreditCents: number;
  shortfallCents: number; autoChargeAmountCents: number; status: InvoiceStatus; dueDate?: string | null; paidAt?: string | null;
}
export interface LedgerRow extends LedgerLine { id: string; tenantId: string; planId: string; invoiceId?: string | null; source: string; createdAt: string; }
/** Phase 12 #19: what a RESPONSE may say about the saved card — never the gateway token (it is used only to charge). */
export interface PaymentMethodView { id: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; status: PaymentMethod['status']; }
export const toPaymentMethodView = (m: PaymentMethod): PaymentMethodView => ({ id: m.id, brand: m.brand ?? null, last4: m.last4 ?? null, expMonth: m.expMonth ?? null, expYear: m.expYear ?? null, status: m.status });
export interface PaymentMethod { id: string; tenantId: string; gatewayCustomerId?: string | null; gatewayPaymentMethodToken: string; brand?: string | null; last4?: string | null; expMonth?: number | null; expYear?: number | null; status: 'active' | 'expired' | 'removed'; }
export interface AutopayConsent { id: string; tenantId: string; planId?: string | null; authorizedByUserId: string; authorizedAt: string; ipAddress?: string | null; deviceInfo?: string | null; consentTextVersion: string; revokedAt?: string | null; }
export interface PaymentTxn { id: string; tenantId: string; planId: string; invoiceId?: string | null; amountCents: number; status: 'processing' | 'succeeded' | 'failed' | 'voided' | 'refunded'; gatewayRetref?: string | null; gatewayRespStatus?: string | null; gatewayRespText?: string | null; attempt: number; }
export interface SplitSettingsRow extends RevenueSplitSettings { id: string; tenantId: string | null; isDefault: boolean; }

// ---- the small ports the service depends on (default mocks live in the module; prod swaps in CardPointe + real sinks) ----
export interface ChargeInput { tenantId: string; token: string; amountCents: number; invoiceId: string; }
export interface ChargeResult { ok: boolean; retref?: string; respstat: string; respText: string; }
export interface HardwareChargePort { charge(input: ChargeInput): Promise<ChargeResult>; }

export interface AlertInput { tenantId: string; severity: 'info' | 'warning' | 'critical'; code: string; message: string; meta?: Record<string, unknown>; }
export interface AlertSink { raise(a: AlertInput): Promise<void> | void; }

export interface AuditInput { tenantId: string; userId?: string | null; role?: string | null; action: string; oldValue?: unknown; newValue?: unknown; ipAddress?: string | null; deviceInfo?: string | null; }
export interface AuditSink { log(a: AuditInput): Promise<void> | void; }

export class HardwarePaymentError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = 'HardwarePaymentError'; }
}
