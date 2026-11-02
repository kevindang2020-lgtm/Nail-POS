// ownerApprovalRequestsApi.ts — BUILD_PLAN Phase 9 (agent D): the Owner App's slice of the salon's ONE approvals engine
// (owner/approvals/requests + /:id/decide + owner/approvals/policies — the owner mirror of pos/approvals). Shapes are the
// API's own (Approval* in @aipowersalon/api-contracts/tenant) — never re-declared. Rules are READ here; the owner changes
// them on the POS Approvals screen (a step-up route the Owner App has no prompt for).
import { api } from './client';
import type { ApprovalDecisionRequest, ApprovalListQuery, ApprovalPage, ApprovalPolicyDetail, ApprovalRequestView } from '@aipowersalon/api-contracts/tenant';

export type { ApprovalRequestView, ApprovalPolicyDetail };
const enc = encodeURIComponent;
const items = (r: ApprovalPage | ApprovalRequestView[] | null | undefined): ApprovalRequestView[] => (Array.isArray(r) ? r : Array.isArray(r?.items) ? r!.items : []);

export const ownerApprovalRequestsApi = {
  pending: (q: ApprovalListQuery = { status: 'pending', pageSize: 50 }) => api.get<ApprovalPage>('/owner/approvals/requests', q as Record<string, unknown>).then(items),
  // BUILD_PLAN Phase 13: one Idempotency-Key per decision (the route is @Idempotent()) — a retry after a lost answer is
  // answered with the first result, never decided (and a refund executed) twice. Online-only: never journaled.
  decide: (id: string, d: ApprovalDecisionRequest, o?: { idempotencyKey?: string }) => o?.idempotencyKey
    ? api.post<ApprovalRequestView>(`/owner/approvals/requests/${enc(id)}/decide`, d as unknown as Record<string, unknown>, { idempotencyKey: o.idempotencyKey })
    : api.post<ApprovalRequestView>(`/owner/approvals/requests/${enc(id)}/decide`, d as unknown as Record<string, unknown>),
  policies: () => api.get<ApprovalPolicyDetail[]>('/owner/approvals/policies').then((r) => (Array.isArray(r) ? r : [])),
};
