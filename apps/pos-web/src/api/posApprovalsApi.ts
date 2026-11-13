// posApprovalsApi.ts — typed client for the salon's ONE approvals engine (/pos/approvals, BUILD_PLAN Phase 9 — contract
// scratchpad/p9/CONTRACT.md §5). Every shape is the API's own (@aipowersalon/api-contracts/tenant Approval*) — never
// re-declared here. The client never sends a tenant, branch or user id (the server derives them from the session).
// A decision carries `expectedVersion`; 409 version_conflict / not_pending = "someone decided it first — reload".
// Changing a rule is a step-up route (403 STEP_UP_REQUIRED → the screen's step-up prompt, then a retry).
import { api } from './client';
import type {
  ApprovalCreateRequest, ApprovalCreateResult, ApprovalDecisionRequest, ApprovalListQuery, ApprovalPage, ApprovalPolicyChange,
  ApprovalPolicyDetail, ApprovalRequestView, ApprovalEscalateRequest,
} from '@aipowersalon/api-contracts/tenant';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const BASE = '/pos/approvals';
const enc = encodeURIComponent;
const body = <T extends object>(b: T) => b as unknown as Record<string, unknown>;
/** drop empty filters so the query string carries only what the user chose */
const query = (q: object): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '' && v !== false) out[k] = typeof v === 'boolean' ? 'true' : v;
  return out;
};
/** a list answer is ApprovalPage; never crash on a bare array or nothing */
export const pageOf = (r: ApprovalPage | ApprovalRequestView[] | null | undefined): ApprovalPage =>
  Array.isArray(r) ? { items: r, page: 1, pageSize: r.length, total: r.length, hasMore: false }
    : r && Array.isArray(r.items) ? r : { items: [], page: 1, pageSize: 0, total: 0, hasMore: false };

export const posApprovalsApi = {
  list: (q: ApprovalListQuery = {}) => api.get<ApprovalPage>('/pos/approvals', query(q)).then((r) => pageOf(r)),
  one: (id: string) => api.get<ApprovalRequestView>(`${BASE}/${enc(id)}`),
  create: (b: ApprovalCreateRequest) => api.post<ApprovalCreateResult>('/pos/approvals', body(b)),
  decide: (id: string, d: ApprovalDecisionRequest) => api.post<ApprovalRequestView>(`${BASE}/${enc(id)}/decide`, body(d)),
  cancel: (id: string, reason: string) => api.post<ApprovalRequestView>(`${BASE}/${enc(id)}/cancel`, { reason }),
  /** round 10 (Approvals 01 point 2): mark a pending request urgent — it stays pending; the approvers are alerted */
  escalate: (id: string, b: ApprovalEscalateRequest) => api.post<ApprovalRequestView>(`${BASE}/${enc(id)}/escalate`, body(b)),
  policies: () => api.get<ApprovalPolicyDetail[]>(`${BASE}/policies`).then((r) => (Array.isArray(r) ? r : [])),
  updatePolicy: (u: ApprovalPolicyChange) => api.put<ApprovalPolicyDetail>(`${BASE}/policies`, body(u)),
};

/** The server's reason a request cannot be decided, in plain words (ApprovalRequestView.whyNot / an error code). */
// getters: read at render, so the text follows an instant language switch (never translated at import)
export const WHY_NOT: Record<string, string> = {
  get requester_cannot_approve() { return t('admin.approvals.whyNot.requesterCannotApprove'); },
  get missing_permission() { return t('admin.approvals.whyNot.missingPermission'); },
  get over_your_limit() { return t('admin.approvals.whyNot.overYourLimit'); },
  get not_pending() { return t('admin.approvals.whyNot.notPending'); },
  get expired() { return t('admin.approvals.whyNot.expired'); },
};
export const isConflict = (e: any) => e?.status === 409;
export function approvalErrorText(e: any, fallback: string): string {
  const code = String(e?.code ?? e?.details?.code ?? e?.body?.code ?? '');
  if (Object.prototype.hasOwnProperty.call(WHY_NOT, code)) return WHY_NOT[code];
  if (code === 'version_conflict') return t('pos.someone_changed_this_first_it_has_2ukk');
  if (code === 'policy_disabled') return t('pos.this_salon_does_not_use_approvals_14c3');
  if (code === 'policy_below_platform') return t('errors.APPROVAL_POLICY_PLATFORM_FLOOR');
  return String(e?.message || fallback);
}
