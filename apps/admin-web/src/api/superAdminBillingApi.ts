import { api } from './client';
import type { BillingSubscriptionsOverviewResponse } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

// superAdminBillingApi — platform Billing & Subscriptions overview (Super Admin, read-only, cross-tenant). This is
// SOFTWARE subscription billing (tenant → AI PowerSalon). Merchant card transactions live under Payments & Revenue.
// Money is integer cents; catalogs are canonical (subscription_plans / plan_add_ons).

export const superAdminBillingApi = {
  overview: () => api.get<BillingSubscriptionsOverviewResponse>('/super-admin/billing/subscriptions-overview'),
};

export const billingActionsApi = {
  createInvoice: (body: { tenantId: string; planCode?: string; lines: { kind: string; description: string; quantity: number; unitPriceCents: number }[]; discountCents?: number; dueDate?: string }) =>
    api.post<{ ok: boolean; invoiceNumber: string; totalCents: number; status: string }>('/super-admin/billing/invoices', body),
  finalizeInvoice: (invoiceNumber: string) => api.post<{ ok: boolean; invoiceNumber: string; status: string }>(`/super-admin/billing/invoices/${encodeURIComponent(invoiceNumber)}/finalize`, {}),
  applyCredit: (body: { creditId: string; invoiceNumber: string; amountCents: number }) =>
    api.post<{ ok: boolean; invoiceNumber: string; creditRemainingCents: number; amountDueCents: number }>('/super-admin/billing/credits/apply', body),
  retryPayment: (body: { invoiceNumber: string; idempotencyKey: string }) =>
    api.post<{ ok: boolean; invoiceNumber: string; status: string; recovered: boolean; idempotent: boolean }>('/super-admin/billing/payments/retry', body),
};

export const billingChangeApi = {
  previewPlan: (body: { tenantId: string; toPlanCode: string }) => api.post<{ preview: boolean; from: string; to: string; changeType: string; strategy: string; proration: { daysTotal: number; daysRemaining: number; creditCents: number; chargeCents: number; netCents: number } }>('/super-admin/billing/subscriptions/change-plan', { ...body, preview: true }),
  changePlan: (body: { tenantId: string; toPlanCode: string; strategy?: string }) => api.post<any>('/super-admin/billing/subscriptions/change-plan', body),
  changeAddOn: (body: { tenantId: string; addOnCode: string; action: 'add' | 'remove'; quantity?: number }) => api.post<any>('/super-admin/billing/subscriptions/add-ons', body),
  extendTrial: (body: { tenantId: string; days: number }) => api.post<{ ok: boolean; newTrialEnd: string; days: number }>('/super-admin/billing/subscriptions/extend-trial', body),
  createDiscount: (body: { tenantId?: string; code: string; discountType: 'percent' | 'fixed'; percent?: number; amountCents?: number; cycles?: number }) => api.post<{ ok: boolean; code: string }>('/super-admin/billing/discounts', body),
};

export const billingLifecycleApi = {
  previewCancel: (body: { tenantId: string; strategy?: string }) => api.post<{ preview: boolean; strategy: string; resultStatus: string; effectiveAt: string; impact: { outstandingInvoices: number; outstandingCents: number; creditRemainingCents: number; activeAddOns: number; dataRetentionDays: number } }>('/super-admin/billing/subscriptions/cancel', { ...body, preview: true }),
  cancel: (body: { tenantId: string; strategy?: string; reason?: string }) => api.post<any>('/super-admin/billing/subscriptions/cancel', body),
  pause: (body: { tenantId: string; resumeDate?: string; reason?: string }) => api.post<any>('/super-admin/billing/subscriptions/pause', body),
  resume: (body: { tenantId: string }) => api.post<any>('/super-admin/billing/subscriptions/resume', body),
  reviewRequest: (changeId: string, body: { decision: 'approve' | 'reject'; note?: string }) => api.post<any>(`/super-admin/billing/change-requests/${encodeURIComponent(changeId)}/review`, body),
};

export const billingExportApi = {
  exportReport: (body: { report: string; tenantId?: string; status?: string; format?: string }) => api.post<{ ok: boolean; filename: string; csv?: string; base64?: string; contentType: string; rowCount: number }>('/super-admin/billing/exports', body),
};

export const billingProfileApi = {
  profile: (tenantId: string) => api.get<{ ok: boolean; profile: any }>(`/super-admin/billing/tenants/${encodeURIComponent(tenantId)}/profile`),
};

// Period-end subscription invoice generator (manual trigger). The hourly worker is off by default
// (BILLING_CYCLE_WORKER_ENABLED); this runs one pass on demand and returns the counts.
export interface BillingCycleResult { due: number; invoiced: number; cancelled: number; skipped: number; errors: number; dryRun: boolean }
export const billingCycleApi = {
  run: (dryRun = false) => api.post<BillingCycleResult>('/super-admin/billing/cycle/run', { dryRun }),
};
export type { BillingSubscriptionsOverviewResponse };
