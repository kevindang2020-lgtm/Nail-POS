import { describe, it, expect } from 'vitest';
import { MERCHANT_ACCOUNTS_EXPORT_HEADERS, merchantAccountsExportCsv, merchantAccountsExportFilename, type ExportableMerchant } from './merchant-accounts-export-core';

const m = (over: Partial<ExportableMerchant> = {}): ExportableMerchant => ({
  merchantId: 'MID-202605-001', processorLabel: 'Fiserv', tenant: 'Glamour Studio', branch: 'Downtown', legalBusinessName: 'Glamour Studio LLC',
  processingStatusLabel: 'Active', underwritingStatusLabel: 'Approved', bankVerificationLabel: 'Verified', bankVerificationAvailable: true,
  pricingPlan: 'Premium', pricingPlanAvailable: true, processingRates: '2.49% + $0.15', processingRatesAvailable: true,
  terminalAssignments: 2, applicationStatusLabel: 'Approved', riskStatusLabel: 'Low', riskStatusAvailable: true,
  fundingScheduleLabel: 'Next Day', fundingScheduleAvailable: true, environment: 'production', ...over,
});

describe('merchant-accounts export core', () => {
  it('emits headers + a safe row', () => {
    const csv = merchantAccountsExportCsv([m()]);
    const [header, row] = csv.split('\n');
    expect(header).toBe(MERCHANT_ACCOUNTS_EXPORT_HEADERS.join(','));
    expect(row).toContain('MID-202605-001');
    expect(row).toContain('Fiserv');
    expect(row).toContain('2.49% + $0.15');
  });

  it('renders unavailable fields as —', () => {
    const csv = merchantAccountsExportCsv([m({ bankVerificationAvailable: false, pricingPlanAvailable: false, processingRatesAvailable: false, riskStatusAvailable: false, fundingScheduleAvailable: false })]);
    const cells = csv.split('\n')[1].split(',');
    expect(cells).toContain('—');
  });

  it('neutralizes formula injection in a merchant field', () => {
    const csv = merchantAccountsExportCsv([m({ legalBusinessName: '=cmd()|calc' })]);
    expect(csv).toContain("'=cmd()"); // leading = neutralized with a quote
  });

  it('filenames are date-stamped .csv', () => {
    expect(merchantAccountsExportFilename(new Date('2026-07-01T00:00:00Z'))).toBe('merchant-accounts-2026-07-01.csv');
  });
});
