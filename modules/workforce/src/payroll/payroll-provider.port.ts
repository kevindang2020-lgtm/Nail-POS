/**
 * payroll-provider.port.ts — the EXTERNAL payroll provider boundary (Payroll mandate §136–§138, §162). AIPowerSalon stays
 * the authority for salon compensation facts (the approved, hashed period); a provider (ADP, Gusto, …) would own statutory
 * withholding, filing, direct deposit and pay stubs. No provider is wired — that is a business decision (§137: "do not
 * hard-wire ADP/Gusto without a business decision") — so the bound adapter is NotConfiguredPayrollProvider: every call
 * says so honestly (PAYROLL_PROVIDER_NOT_CONFIGURED), the screens show "not connected" and the CSV / Excel export is the
 * supported hand-off. A real adapter must run its submit from a durable job / outbox consumer, never inside the period's
 * database transaction (§162).
 */
export interface PayrollProviderStatus { configured: boolean; provider: string | null; capabilities: string[]; reason: string | null }
export interface PayrollProviderPort {
  status(tenantId: string): Promise<PayrollProviderStatus>;
  /** Export an APPROVED period to the provider (idempotent per period + version on the provider side). */
  submitPeriod(tenantId: string, periodId: string, periodVersion: number): Promise<{ submissionId: string }>;
  getSubmissionStatus(tenantId: string, submissionId: string): Promise<{ status: 'pending' | 'accepted' | 'rejected'; detail?: string }>;
  syncEmployees(tenantId: string): Promise<{ synced: number }>;
}
export class PayrollProviderNotConfiguredError extends Error {
  readonly code = 'PAYROLL_PROVIDER_NOT_CONFIGURED' as const;
  constructor() { super('No external payroll provider is connected. Use the CSV or Excel export.'); this.name = 'PayrollProviderNotConfiguredError'; }
}
export class NotConfiguredPayrollProvider implements PayrollProviderPort {
  async status(): Promise<PayrollProviderStatus> {
    return { configured: false, provider: null, capabilities: [], reason: 'No external payroll provider is connected for this salon. Approved periods can be exported as CSV or Excel.' };
  }
  async submitPeriod(): Promise<{ submissionId: string }> { throw new PayrollProviderNotConfiguredError(); }
  async getSubmissionStatus(): Promise<{ status: 'pending' | 'accepted' | 'rejected'; detail?: string }> { throw new PayrollProviderNotConfiguredError(); }
  async syncEmployees(): Promise<{ synced: number }> { throw new PayrollProviderNotConfiguredError(); }
}
