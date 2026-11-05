// merchant-accounts-export-core.ts — pure CSV shaping for the Merchant Accounts export (§48). Reuses the canonical
// injection-guarded toCsv (a cell starting with = + - @ is neutralized). Only SAFE, display-level fields are exported —
// never a full bank/routing number, processor secret, or credential. Sensitive funding is intentionally excluded.
import { toCsv } from '@aipowersalon/reports';

export const MERCHANT_ACCOUNTS_EXPORT_HEADERS = [
  'Merchant ID', 'Processor', 'Tenant', 'Branch', 'Legal Business Name', 'Processing Status', 'Underwriting Status',
  'Bank Verification', 'Pricing Plan', 'Processing Rates', 'Terminal Assignments', 'Application Status', 'Risk Status',
  'Funding Schedule', 'Environment',
];

// A shaped directory row (already secret-free) → a safe CSV row. Unavailable fields export as "—".
export interface ExportableMerchant {
  merchantId: string; processorLabel: string; tenant: string; branch: string; legalBusinessName: string;
  processingStatusLabel: string; underwritingStatusLabel: string;
  bankVerificationLabel: string; bankVerificationAvailable: boolean;
  pricingPlan: string; pricingPlanAvailable: boolean;
  processingRates: string; processingRatesAvailable: boolean;
  terminalAssignments: number; applicationStatusLabel: string;
  riskStatusLabel: string; riskStatusAvailable: boolean;
  fundingScheduleLabel: string; fundingScheduleAvailable: boolean;
  environment: string;
}

export function merchantAccountExportRow(m: ExportableMerchant): (string | number)[] {
  return [
    m.merchantId, m.processorLabel, m.tenant, m.branch, m.legalBusinessName, m.processingStatusLabel,
    m.underwritingStatusLabel,
    m.bankVerificationAvailable ? m.bankVerificationLabel : '—',
    m.pricingPlanAvailable ? m.pricingPlan : '—',
    m.processingRatesAvailable ? m.processingRates : '—',
    `${m.terminalAssignments}`, m.applicationStatusLabel,
    m.riskStatusAvailable ? m.riskStatusLabel : '—',
    m.fundingScheduleAvailable ? m.fundingScheduleLabel : '—',
    m.environment,
  ];
}

export function merchantAccountsExportCsv(rows: ExportableMerchant[]): string {
  return toCsv(MERCHANT_ACCOUNTS_EXPORT_HEADERS, rows.map(merchantAccountExportRow));
}

export function merchantAccountsExportFilename(now: Date = new Date()): string {
  return `merchant-accounts-${now.toISOString().slice(0, 10)}.csv`;
}
