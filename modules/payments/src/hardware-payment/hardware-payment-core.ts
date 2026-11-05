// hardware-payment-core.ts — PURE, backend-authoritative money math for Hardware Payment Recovery (build doc §2–§9).
// All amounts are integer cents; all rates are basis points (bps) or whole percent. No floating money, ever.

export interface RevenueSplitSettings {
  pricingRateBps: number;                              // 300 = 3.00%
  expenseRateBps: number;                              // 180 = 1.80%
  platformSharePercent: number;                        // 65
  fiservSharePercent: number;                          // 35
  salonHardwareCreditPercentOfPlatformShare: number;   // 25
}

export const DEFAULT_SPLIT_SETTINGS: RevenueSplitSettings = {
  pricingRateBps: 300, expenseRateBps: 180,
  platformSharePercent: 65, fiservSharePercent: 35,
  salonHardwareCreditPercentOfPlatformShare: 25,
};

export type ExtraCreditHandling = 'cap_at_monthly_due' | 'carry_forward_next_month' | 'apply_to_principal_balance';

export interface SplitBreakdown {
  cardVolumeCents: number;
  grossProcessingRevenueCents: number;
  expenseCostCents: number;
  netMarginCents: number;
  platformShareCents: number;
  fiservShareCents: number;
  salonHardwareCreditCents: number;
  platformNetAfterHardwareCreditCents: number;
}

// integer helpers — round half-up to the nearest cent on each division
const bpsOf = (amountCents: number, bps: number): number => Math.round((amountCents * bps) / 10000);
const pctOf = (amountCents: number, pct: number): number => Math.round((amountCents * pct) / 100);

/** §9 core: from card volume + split settings, derive every figure. */
export function computeRevenueSplit(cardVolumeCents: number, s: RevenueSplitSettings): SplitBreakdown {
  const v = Math.max(0, Math.trunc(cardVolumeCents));
  const gross = bpsOf(v, s.pricingRateBps);
  const expense = bpsOf(v, s.expenseRateBps);
  const net = gross - expense;
  const platform = pctOf(net, s.platformSharePercent);
  const fiserv = pctOf(net, s.fiservSharePercent);
  const credit = pctOf(platform, s.salonHardwareCreditPercentOfPlatformShare);
  return {
    cardVolumeCents: v, grossProcessingRevenueCents: gross, expenseCostCents: expense, netMarginCents: net,
    platformShareCents: platform, fiservShareCents: fiserv, salonHardwareCreditCents: credit,
    platformNetAfterHardwareCreditCents: platform - credit,
  };
}

/** §9: shortfall = max(0, monthly due - salon credit - carry-forward credit). */
export function computeShortfallCents(hardwareMonthlyDueCents: number, salonHardwareCreditCents: number, carryForwardCreditCents = 0): number {
  return Math.max(0, hardwareMonthlyDueCents - salonHardwareCreditCents - carryForwardCreditCents);
}

/** §9: extra credit = max(0, salon credit + carry-forward - monthly due) when the credit exceeds what's due. */
export function computeExtraCreditCents(salonHardwareCreditCents: number, hardwareMonthlyDueCents: number, carryForwardCreditCents = 0): number {
  return Math.max(0, salonHardwareCreditCents + carryForwardCreditCents - hardwareMonthlyDueCents);
}

export interface ValidationIssue { field: string; message: string; }
/** §7 settings validation. */
export function validateSplitSettings(s: RevenueSplitSettings): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [k, v] of Object.entries(s)) if (!Number.isInteger(v) || v < 0) issues.push({ field: k, message: 'must be a non-negative integer' });
  if (s.pricingRateBps < s.expenseRateBps) issues.push({ field: 'pricingRateBps', message: 'pricing rate must be >= expense rate' });
  if (s.platformSharePercent + s.fiservSharePercent !== 100) issues.push({ field: 'platformSharePercent', message: 'platform + fiserv share must equal 100' });
  if (s.salonHardwareCreditPercentOfPlatformShare > 100) issues.push({ field: 'salonHardwareCreditPercentOfPlatformShare', message: 'must be between 0 and 100' });
  return issues;
}

export type LedgerEntryType =
  | 'card_volume_recorded' | 'gross_processing_revenue' | 'expense_cost' | 'net_margin' | 'platform_share'
  | 'fiserv_share' | 'salon_hardware_credit' | 'hardware_payment_due' | 'shortfall_charge' | 'carry_forward_credit'
  | 'principal_reduction' | 'payment_failed' | 'manual_adjustment';

export interface LedgerLine { entryType: LedgerEntryType; amountCents: number; description: string; }

export interface ReconcileInput {
  cardVolumeCents: number;
  hardwareMonthlyDueCents: number;
  settings: RevenueSplitSettings;
  carryForwardCreditCents?: number;     // prior carry-forward (if enabled)
  extraCreditHandling?: ExtraCreditHandling;
}

export interface ReconcileResult {
  split: SplitBreakdown;
  hardwareMonthlyDueCents: number;
  carryForwardCreditCents: number;
  shortfallCents: number;
  extraCreditCents: number;
  /** how the extra credit (if any) is applied next, per the configured rule */
  carryForwardNextMonthCents: number;
  principalReductionCents: number;
  ledger: LedgerLine[];
}

/** §8/§9 monthly reconciliation — pure: derive the invoice figures + the balanced ledger lines. */
export function reconcileMonth(input: ReconcileInput): ReconcileResult {
  const carry = Math.max(0, Math.trunc(input.carryForwardCreditCents ?? 0));
  const split = computeRevenueSplit(input.cardVolumeCents, input.settings);
  const due = Math.max(0, Math.trunc(input.hardwareMonthlyDueCents));
  const shortfall = computeShortfallCents(due, split.salonHardwareCreditCents, carry);
  const extra = computeExtraCreditCents(split.salonHardwareCreditCents, due, carry);
  const handling = input.extraCreditHandling ?? 'cap_at_monthly_due';

  let carryForwardNext = 0, principalReduction = 0;
  if (extra > 0) {
    if (handling === 'carry_forward_next_month') carryForwardNext = extra;
    else if (handling === 'apply_to_principal_balance') principalReduction = extra;
    // cap_at_monthly_due → extra is simply not used
  }

  const creditAppliedToDue = Math.min(due, split.salonHardwareCreditCents + carry);
  const ledger: LedgerLine[] = [
    { entryType: 'card_volume_recorded', amountCents: split.cardVolumeCents, description: 'Monthly card volume' },
    { entryType: 'gross_processing_revenue', amountCents: split.grossProcessingRevenueCents, description: 'Gross processing revenue' },
    { entryType: 'expense_cost', amountCents: -split.expenseCostCents, description: 'Interchange / expense cost' },
    { entryType: 'net_margin', amountCents: split.netMarginCents, description: 'Net margin' },
    { entryType: 'platform_share', amountCents: split.platformShareCents, description: 'AIPowerSalon share' },
    { entryType: 'fiserv_share', amountCents: split.fiservShareCents, description: 'Fiserv share' },
    { entryType: 'salon_hardware_credit', amountCents: split.salonHardwareCreditCents, description: 'Salon hardware credit' },
    { entryType: 'hardware_payment_due', amountCents: due, description: 'Hardware monthly due' },
  ];
  if (carry > 0) ledger.push({ entryType: 'carry_forward_credit', amountCents: carry, description: 'Applied carry-forward credit' });
  // NB: the shortfall is a computed obligation (carried on the invoice), not a ledger movement — a `shortfall_charge`
  // ledger entry is written by the service only when the card is actually charged, so the ledger never double-counts.
  if (principalReduction > 0) ledger.push({ entryType: 'principal_reduction', amountCents: principalReduction, description: 'Extra credit applied to principal' });
  if (carryForwardNext > 0) ledger.push({ entryType: 'carry_forward_credit', amountCents: carryForwardNext, description: 'Extra credit carried to next month' });

  return {
    split, hardwareMonthlyDueCents: due, carryForwardCreditCents: carry, shortfallCents: shortfall,
    extraCreditCents: extra, carryForwardNextMonthCents: carryForwardNext, principalReductionCents: principalReduction,
    ledger,
  };
}

export type AutoChargeDecision =
  | { charge: false; reason: 'no_shortfall' | 'auto_charge_disabled' | 'no_consent' | 'no_payment_method' | 'plan_not_active'; invoiceStatus: 'credit_applied' | 'payment_method_required' | 'shortfall_pending' }
  | { charge: true; amountCents: number; invoiceStatus: 'auto_charge_processing' };

export interface AutoChargeContext {
  shortfallCents: number;
  autoChargeEnabled: boolean;
  hasAutopayConsent: boolean;
  hasSavedPaymentMethod: boolean;
  planActive: boolean;
}

/** §10 gate — never charges more than the shortfall, and only when consent + a tokenized method exist. Pure decision. */
export function decideAutoCharge(c: AutoChargeContext): AutoChargeDecision {
  if (c.shortfallCents <= 0) return { charge: false, reason: 'no_shortfall', invoiceStatus: 'credit_applied' };
  if (!c.planActive) return { charge: false, reason: 'plan_not_active', invoiceStatus: 'shortfall_pending' };
  if (!c.autoChargeEnabled) return { charge: false, reason: 'auto_charge_disabled', invoiceStatus: 'shortfall_pending' };
  if (!c.hasAutopayConsent) return { charge: false, reason: 'no_consent', invoiceStatus: 'payment_method_required' };
  if (!c.hasSavedPaymentMethod) return { charge: false, reason: 'no_payment_method', invoiceStatus: 'payment_method_required' };
  return { charge: true, amountCents: c.shortfallCents, invoiceStatus: 'auto_charge_processing' };
}
