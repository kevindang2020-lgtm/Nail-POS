import { describe, it, expect } from 'vitest';
import { computeRevenueSplit, computeShortfallCents, computeExtraCreditCents, validateSplitSettings, reconcileMonth, decideAutoCharge, DEFAULT_SPLIT_SETTINGS } from './hardware-payment-core';

describe('Hardware Payment Recovery — money math (build doc §9, §19)', () => {
  it('the exact spec example: $50k volume, 300/180 bps, $250 due → $152.50 shortfall', () => {
    const s = computeRevenueSplit(5_000_000, DEFAULT_SPLIT_SETTINGS);
    expect(s.grossProcessingRevenueCents).toBe(150_000); // $1,500
    expect(s.expenseCostCents).toBe(90_000);             // $900
    expect(s.netMarginCents).toBe(60_000);               // $600
    expect(s.platformShareCents).toBe(39_000);           // $390
    expect(s.fiservShareCents).toBe(21_000);             // $210
    expect(s.salonHardwareCreditCents).toBe(9_750);      // $97.50
    expect(s.platformNetAfterHardwareCreditCents).toBe(29_250); // $292.50
    expect(s.platformShareCents + s.fiservShareCents).toBe(s.netMarginCents); // split sums to net
    const shortfall = computeShortfallCents(25_000, s.salonHardwareCreditCents); // due $250
    expect(shortfall).toBe(15_250);                      // $152.50
  });

  it('no charge when the credit covers the monthly due', () => {
    const s = computeRevenueSplit(5_000_000, DEFAULT_SPLIT_SETTINGS); // credit $97.50
    expect(computeShortfallCents(9_000, s.salonHardwareCreditCents)).toBe(0); // due $90 < credit
    expect(computeExtraCreditCents(s.salonHardwareCreditCents, 9_000)).toBe(750); // $7.50 extra
  });

  it('reconcileMonth emits a balanced breakdown + ledger and applies extra-credit by rule', () => {
    const r = reconcileMonth({ cardVolumeCents: 5_000_000, hardwareMonthlyDueCents: 9_000, settings: DEFAULT_SPLIT_SETTINGS, extraCreditHandling: 'apply_to_principal_balance' });
    expect(r.shortfallCents).toBe(0);
    expect(r.extraCreditCents).toBe(750);
    expect(r.principalReductionCents).toBe(750);
    expect(r.ledger.find((l) => l.entryType === 'principal_reduction')?.amountCents).toBe(750);
    // platform_share + fiserv_share == net_margin (ledger internal consistency)
    const get = (t: string) => r.ledger.find((l) => l.entryType === t)?.amountCents ?? 0;
    expect(get('platform_share') + get('fiserv_share')).toBe(get('net_margin'));
  });

  it('carry-forward reduces the shortfall', () => {
    const s = computeRevenueSplit(5_000_000, DEFAULT_SPLIT_SETTINGS); // credit $97.50
    expect(computeShortfallCents(25_000, s.salonHardwareCreditCents, 5_000)).toBe(10_250); // $250 - $97.50 - $50 = $102.50
  });

  it('validates settings (§7)', () => {
    expect(validateSplitSettings(DEFAULT_SPLIT_SETTINGS)).toEqual([]);
    expect(validateSplitSettings({ ...DEFAULT_SPLIT_SETTINGS, expenseRateBps: 400 }).some((i) => i.field === 'pricingRateBps')).toBe(true);
    expect(validateSplitSettings({ ...DEFAULT_SPLIT_SETTINGS, fiservSharePercent: 40 }).some((i) => i.field === 'platformSharePercent')).toBe(true);
    expect(validateSplitSettings({ ...DEFAULT_SPLIT_SETTINGS, salonHardwareCreditPercentOfPlatformShare: 150 }).length).toBeGreaterThan(0);
  });

  it('auto-charge gate: only charges the shortfall, and only with consent + a saved method (§10)', () => {
    const base = { shortfallCents: 15_250, autoChargeEnabled: true, hasAutopayConsent: true, hasSavedPaymentMethod: true, planActive: true };
    expect(decideAutoCharge(base)).toEqual({ charge: true, amountCents: 15_250, invoiceStatus: 'auto_charge_processing' });
    expect(decideAutoCharge({ ...base, shortfallCents: 0 }).charge).toBe(false);
    expect(decideAutoCharge({ ...base, hasAutopayConsent: false })).toMatchObject({ charge: false, reason: 'no_consent', invoiceStatus: 'payment_method_required' });
    expect(decideAutoCharge({ ...base, hasSavedPaymentMethod: false })).toMatchObject({ charge: false, reason: 'no_payment_method' });
    expect(decideAutoCharge({ ...base, autoChargeEnabled: false })).toMatchObject({ charge: false, reason: 'auto_charge_disabled' });
  });
});
