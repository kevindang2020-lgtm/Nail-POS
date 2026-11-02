import { api } from './client';
import type {
  ModOverview, ModQueue, ModQueueQuery, ModPostView, ModPostDetail, ModPostActionRequest, ModActionResult, ModCommentView,
  ModCommentActionRequest, ModCaseView, ModCaseDetail, ModCaseKind, ModCaseStatus, ModOpenCase, ModCaseUpdate, ModReportView,
  ModReportResolve, ModDisputeView, ModDisputeDecision, ModAppealView, ModAppealDecision, ModEvidenceView, ModEvidenceReview,
  ModIncidentAccessRequest, ModTenantConduct, ModTenantActionRequest, ModRestrictionView, ModActionView, ModAnalytics,
  ModPlatformSettings, ModPlatformSettingsUpdate, ModPage,
} from '@aipowersalon/api-contracts/platform';
import type { CommunityEvidenceAccess, CommunityIncidentView } from '@aipowersalon/api-contracts/tenant';

// superAdminCommunityModerationApi — BUILD_PLAN Phase 8 (tenant_safety_community): the Super Admin "Safety Community
// Moderation" center (contract scratchpad/p8/CONTRACT.md §3; agent B's
// modules/safety/src/tenant-safety-community/community-moderation.controller.ts). Shapes are the API's own contract
// (@aipowersalon/api-contracts/platform Mod*).
//   reads   GET  — SuperAdminGuard + the workforce domain's view key (super_admin.technicians.view)
//   writes  POST / PATCH / PUT — the workforce manage key (super_admin.technicians.manage) + a fresh step-up (the shared
//           client re-confirms and retries once) + a reason of ≥ 8 characters; every write runs under a moderation case
//           (given, or opened / reused by the action itself) and is audited.
export type {
  ModOverview, ModQueue, ModPostView, ModPostDetail, ModPostActionRequest, ModActionResult, ModCommentView, ModCaseView,
  ModCaseDetail, ModReportView, ModDisputeView, ModAppealView, ModEvidenceView, ModTenantConduct, ModRestrictionView,
  ModActionView, ModAnalytics, ModPlatformSettings, ModPage,
};
export const MOD_MANAGE_PERMISSION = 'super_admin.technicians.manage';
export const MOD_MIN_REASON = 8;
const enc = encodeURIComponent;
export const MOD_BASE = '/super-admin/community-moderation';
const B = MOD_BASE;

/** drop empty query values so the URL carries only what the moderator chose */
function qs(o: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export const superAdminCommunityModerationApi = {
  overview: () => api.get<ModOverview>(`${B}/overview`),
  // posts
  posts: (query: ModQueueQuery) => api.get<ModPage<ModPostView>>(`${B}/posts`, qs({ ...query })),
  post: (id: string) => api.get<ModPostDetail>(`${B}/posts/${enc(id)}`),
  postAction: (id: string, body: ModPostActionRequest) => api.post<ModActionResult>(`${B}/posts/${enc(id)}/actions`, { ...body }),
  postComments: (id: string) => api.get<ModCommentView[]>(`${B}/posts/${enc(id)}/comments`),
  commentAction: (id: string, body: ModCommentActionRequest) => api.post<ModActionResult>(`${B}/comments/${enc(id)}/actions`, { ...body }),
  // cases
  cases: (query: { status?: ModCaseStatus | ''; kind?: ModCaseKind | ''; mine?: boolean; page?: number } = {}) =>
    api.get<ModPage<ModCaseView>>(`${B}/cases`, qs({ status: query.status, kind: query.kind, mine: query.mine ? 'true' : undefined, page: query.page })),
  openCase: (body: ModOpenCase) => api.post<ModCaseView>(`${B}/cases`, { ...body }),
  caseDetail: (id: string) => api.get<ModCaseDetail>(`${B}/cases/${enc(id)}`),
  updateCase: (id: string, body: ModCaseUpdate) => api.patch<ModCaseView>(`${B}/cases/${enc(id)}`, { ...body }),
  // reports, disputes, appeals
  reports: (kind: 'post' | 'comment', query: { status?: string; page?: number } = {}) =>
    api.get<ModPage<ModReportView>>(`${B}/reports`, qs({ kind, status: query.status, page: query.page })),
  resolveReport: (id: string, kind: 'post' | 'comment', body: ModReportResolve) =>
    api.post<ModActionResult>(`${B}/reports/${enc(id)}/resolve?kind=${enc(kind)}`, { ...body }),
  disputes: (query: { status?: string; page?: number } = {}) => api.get<ModPage<ModDisputeView>>(`${B}/disputes`, qs(query)),
  decideDispute: (id: string, body: ModDisputeDecision) => api.post<ModActionResult>(`${B}/disputes/${enc(id)}/decide`, { ...body }),
  appeals: (query: { status?: string; page?: number } = {}) => api.get<ModPage<ModAppealView>>(`${B}/appeals`, qs(query)),
  decideAppeal: (id: string, body: ModAppealDecision) => api.post<ModActionResult>(`${B}/appeals/${enc(id)}/decide`, { ...body }),
  // evidence + private incidents (both need a case and a reason; both audited)
  evidence: (query: { status?: string; page?: number } = {}) => api.get<ModPage<ModEvidenceView>>(`${B}/evidence`, qs(query)),
  evidenceAccess: (id: string, caseId: string, reason: string) => api.get<CommunityEvidenceAccess>(`${B}/evidence/${enc(id)}/access`, { caseId, reason }),
  reviewEvidence: (id: string, body: ModEvidenceReview) => api.post<ModActionResult>(`${B}/evidence/${enc(id)}/review`, { ...body }),
  incidentAccess: (id: string, body: ModIncidentAccessRequest) => api.post<CommunityIncidentView>(`${B}/incidents/${enc(id)}/access`, { ...body }),
  // salons
  tenants: (query: { q?: string; page?: number } = {}) => api.get<ModPage<ModTenantConduct>>(`${B}/tenants`, qs(query)),
  tenant: (tenantId: string) => api.get<ModTenantConduct>(`${B}/tenants/${enc(tenantId)}`),
  tenantAction: (tenantId: string, body: ModTenantActionRequest) => api.post<ModActionResult>(`${B}/tenants/${enc(tenantId)}/actions`, { ...body }),
  restrictions: (active = true) => api.get<ModRestrictionView[]>(`${B}/restrictions`, { active: active ? 'true' : 'false' }),
  // audit trail, analytics, settings
  actions: (query: { caseId?: string; postId?: string; page?: number } = {}) => api.get<ModPage<ModActionView>>(`${B}/actions`, qs(query)),
  analytics: (from: string, to: string) => api.get<ModAnalytics>(`${B}/analytics`, { from, to }),
  settings: () => api.get<ModPlatformSettings>(`${B}/settings`),
  saveSettings: (body: ModPlatformSettingsUpdate) => api.put<ModPlatformSettings>(`${B}/settings`, { ...body }),
};
