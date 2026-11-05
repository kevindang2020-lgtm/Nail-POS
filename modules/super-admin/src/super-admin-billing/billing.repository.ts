// billing.repository.ts — port for raw billing facts + plan-price config. The Postgres (Kysely) adapter joins tenants
// with each tenant's latest subscription, payment config, and hardware payoff. The in-memory adapter returns empty
// (zeros, never fabricated) so the surface is safe before a DB handle exists.
import type { BillingFact, SubscriptionUpdate, SubscriptionStatus } from './billing.dto';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { BillingSubscriptionsOverview } from '@aipowersalon/api-contracts/platform';
import type { BillingSubscriptionsOverview } from '@aipowersalon/api-contracts/platform';

export interface AuditActor { userId?: string; role?: string }


export interface BillingDataPort {
  getFacts(): Promise<BillingFact[]>;
  getPlanPrices(): Promise<Record<string, number>>;
  // Update (or create) a tenant's current subscription. Writes an audit row. Returns true if a tenant matched.
  updateSubscription(tenantId: string, patch: SubscriptionUpdate, actor?: AuditActor): Promise<boolean>;
  subscriptionsOverview(): Promise<BillingSubscriptionsOverview>;
  createInvoice(actor: AuditActor, input: CreateInvoiceInput): Promise<{ invoiceNumber: string; totalCents: number; status: string }>;
  finalizeInvoice(actor: AuditActor, invoiceNumber: string): Promise<{ invoiceNumber: string; status: string }>;
  applyCredit(actor: AuditActor, input: { creditId: string; invoiceNumber: string; amountCents: number }): Promise<{ invoiceNumber: string; creditRemainingCents: number; amountDueCents: number }>;
  retryPayment(actor: AuditActor, input: { invoiceNumber: string; idempotencyKey: string }): Promise<{ invoiceNumber: string; status: string; recovered: boolean; idempotent: boolean }>;
  changePlan(actor: AuditActor, input: { tenantId: string; toPlanCode: string; strategy?: string; preview?: boolean }): Promise<any>;
  changeAddOn(actor: AuditActor, input: { tenantId: string; addOnCode: string; action: 'add' | 'remove'; quantity?: number }): Promise<any>;
  extendTrial(actor: AuditActor, input: { tenantId: string; days: number }): Promise<any>;
  createDiscount(actor: AuditActor, input: { tenantId?: string; code: string; discountType: 'percent' | 'fixed'; percent?: number; amountCents?: number; appliesTo?: string; cycles?: number }): Promise<any>;
  pauseSubscription(actor: AuditActor, input: { tenantId: string; resumeDate?: string; reason?: string; preview?: boolean }): Promise<any>;
  resumeSubscription(actor: AuditActor, input: { tenantId: string }): Promise<any>;
  cancelSubscription(actor: AuditActor, input: { tenantId: string; strategy?: string; reason?: string; preview?: boolean }): Promise<any>;
  reviewRequest(actor: AuditActor, input: { changeId: string; decision: 'approve' | 'reject'; note?: string }): Promise<any>;
  ingestWebhook(event: { providerEventId: string; eventType: string; invoiceNumber?: string }): Promise<{ processed: boolean; duplicate: boolean; effect: string }>;
  exportReport(actor: AuditActor, input: { report: string; tenantId?: string; planCode?: string; status?: string; format?: string }): Promise<{ filename: string; csv?: string; base64?: string; contentType: string; rowCount: number }>;
  tenantBillingProfile(actor: AuditActor, tenantId: string): Promise<any>;
  createExportJob(actor: AuditActor, input: { report: string; format?: string; tenantId?: string; status?: string }): Promise<{ jobId: string; token: string; status: string }>;
  processPendingExportJobs(limit?: number): Promise<{ processed: number }>;
  getExportJob(token: string): Promise<any>;
  downloadExportJob(actor: AuditActor, token: string): Promise<{ filename: string; csv?: string; base64?: string; contentType: string }>;
  expireStaleExportJobs(): Promise<{ expired: number }>;
}

export interface CreateInvoiceInput {
  tenantId: string; planCode?: string; currency?: string;
  lines: { kind: string; description: string; quantity: number; unitPriceCents: number }[];
  discountCents?: number; creditCents?: number; taxCents?: number; dueDate?: string; periodStart?: string; periodEnd?: string;
}

export class InMemoryBillingRepository implements BillingDataPort {
  constructor(private seed: { facts?: BillingFact[]; planPrices?: Record<string, number> } = {}) {}
  async getFacts(): Promise<BillingFact[]> { return this.seed.facts ?? []; }
  async getPlanPrices(): Promise<Record<string, number>> { return this.seed.planPrices ?? {}; }
  async subscriptionsOverview(): Promise<BillingSubscriptionsOverview> {
    return { kpis: { activeSubscriptions: 0, trialAccounts: 0, pastDueAccounts: 0, failedPayments: 0, invoices: 0, creditsIssuedCents: 0, discountsAppliedCents: 0, addOnsActive: 0, subscriptionChanges: 0, cancellationRequests: 0, upcomingRenewals: 0, mrrCents: 0 }, kpiTrends: {}, planDistribution: [], billingStatusBreakdown: [], addOnRevenueMix: [], revenueTrend: [], trialConversion: { rate: 0, numerator: 0, denominator: 0 }, failedVsRecovered: { recoveredRate: 0, weekly: [] }, planCatalog: [], addOnCatalog: [], tenantOverview: [], invoices: [], changes: [], upcomingRenewals: [], recentActivity: [], atAGlance: { newInvoicesToday: 0, paymentsRecoveredCents: 0, creditsAppliedTodayCents: 0, planChangesToday: 0, trialsExtended: 0, renewalsDue: 0 } };
  }
  async createInvoice(): Promise<{ invoiceNumber: string; totalCents: number; status: string }> { throw new Error('not available'); }
  async finalizeInvoice(): Promise<{ invoiceNumber: string; status: string }> { throw new Error('not available'); }
  async applyCredit(): Promise<{ invoiceNumber: string; creditRemainingCents: number; amountDueCents: number }> { throw new Error('not available'); }
  async retryPayment(): Promise<{ invoiceNumber: string; status: string; recovered: boolean; idempotent: boolean }> { throw new Error('not available'); }
  async changePlan(): Promise<any> { throw new Error('not available'); }
  async changeAddOn(): Promise<any> { throw new Error('not available'); }
  async extendTrial(): Promise<any> { throw new Error('not available'); }
  async createDiscount(): Promise<any> { throw new Error('not available'); }
  async pauseSubscription(): Promise<any> { throw new Error('not available'); }
  async resumeSubscription(): Promise<any> { throw new Error('not available'); }
  async cancelSubscription(): Promise<any> { throw new Error('not available'); }
  async reviewRequest(): Promise<any> { throw new Error('not available'); }
  async ingestWebhook(): Promise<{ processed: boolean; duplicate: boolean; effect: string }> { return { processed: false, duplicate: false, effect: 'unavailable' }; }
  async exportReport(): Promise<{ filename: string; csv?: string; base64?: string; contentType: string; rowCount: number }> { return { filename: 'empty.csv', csv: '', contentType: 'text/csv', rowCount: 0 }; }
  async tenantBillingProfile(): Promise<any> { return null; }
  async createExportJob(): Promise<{ jobId: string; token: string; status: string }> { throw new Error('not available'); }
  async processPendingExportJobs(): Promise<{ processed: number }> { return { processed: 0 }; }
  async getExportJob(): Promise<any> { return null; }
  async downloadExportJob(): Promise<{ filename: string; csv?: string; base64?: string; contentType: string }> { throw new Error('not available'); }
  async expireStaleExportJobs(): Promise<{ expired: number }> { return { expired: 0 }; }
  async updateSubscription(tenantId: string, patch: SubscriptionUpdate): Promise<boolean> {
    const fact = (this.seed.facts ?? []).find((f) => f.tenantId === tenantId);
    if (!fact) return false;
    if (patch.plan !== undefined) fact.plan = patch.plan;
    if (patch.status !== undefined) fact.subscriptionStatus = patch.status as SubscriptionStatus;
    return true;
  }
}

export function planPricesFromEnv(): Record<string, number> {
  try { return process.env.PLAN_PRICES_JSON ? JSON.parse(process.env.PLAN_PRICES_JSON) : {}; }
  catch { return {}; }
}
