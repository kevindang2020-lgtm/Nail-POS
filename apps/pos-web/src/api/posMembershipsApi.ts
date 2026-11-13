import { api } from './client';
import type { MemberExportRow, PaymentExportRow, RedemptionExportRow, PlanVersionChangePreview } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)

// posMembershipsApi — tenant Memberships surface (`/pos/memberships/*`). The overview returns derived KPIs / plan member
// counts / analytics from the backend; the UI never recomputes money. Tenant + branch are derived from the session.
export const posMembershipsApi = {
  overview: (q: Record<string, string> = {}) => api.get(`/pos/memberships/overview${toQuery(q)}`),
  // Full plan list (the overview only carries a slice for the panel).
  plans: () => api.get<{ plans: { planId: string; name: string; description?: string | null; status: string; isPopular?: boolean; badge?: string | null; memberCount?: number; priceCents?: number; billingInterval?: string }[] }>(`/pos/memberships/plans`),
  exportMembers: () => api.exportAsync(`/pos/memberships/export/members`),
  exportPayments: () => api.exportAsync(`/pos/memberships/export/payments`),
  exportRedemptions: () => api.exportAsync(`/pos/memberships/export/redemptions`),
  runReminders: (withinDays = 7) => api.post(`/pos/memberships/comms/reminders/run`, { withinDays }),
  listPlans: (q: Record<string, string> = {}) => api.get(`/pos/memberships/plans${toQuery(q)}`),
  getPlan: (id: string) => api.get(`/pos/memberships/plans/${id}`),
  createPlan: (body: Record<string, unknown>) => api.post(`/pos/memberships/plans`, body),
  publishVersion: (planId: string, body: Record<string, unknown>) => api.post(`/pos/memberships/plans/${planId}/versions`, body),
  /** extras Membership Overview 13 · 10: what a plan change does to current vs future members — nothing is written */
  previewVersion: (planId: string, body: Record<string, unknown>) => api.post<PlanVersionChangePreview>(`/pos/memberships/plans/${planId}/versions/preview`, body),
  // Membership Overview mandate (Oct 29 2026): the View All lists, KPI click-throughs, plan performance, discounts, the reminder review step.
  // Membership Overview rebuild (Oct 29 2026): phone-first search, period + date field, the six tabs, Member Details.
  members: (q: Record<string, unknown>) => api.get<any>(`/pos/memberships/members`, q),
  memberDetail: (membershipId: string) => api.get<any>(`/pos/memberships/members/${encodeURIComponent(membershipId)}/detail`),
  activity: (q: Record<string, unknown>) => api.get<any>(`/pos/memberships/activity`, q),
  payments: (q: Record<string, unknown>) => api.get<any>(`/pos/memberships/payments`, q),
  redemptions: (q: Record<string, unknown>) => api.get<any>(`/pos/memberships/redemptions`, q),
  planList: (q: Record<string, unknown>) => api.get<any>(`/pos/memberships/plans-list`, q),
  planPerformance: () => api.get<any>(`/pos/memberships/plan-performance`),
  discounts: () => api.get<any>(`/pos/memberships/discounts`),
  previewReminders: (withinDays = 7) => api.get<any>(`/pos/memberships/comms/reminders/preview`, { withinDays }),
};

function toQuery(q: Record<string, string>): string {
  const parts = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
export type { MemberExportRow, PaymentExportRow, RedemptionExportRow };
