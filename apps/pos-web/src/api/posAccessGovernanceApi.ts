// posAccessGovernanceApi.ts — BUILD_PLAN Phase 9 (Constitution 2): the owner's access governance — periodic access
// reviews (keep / revoke / change each person), the high-risk access report, dormant accounts and permission-denial
// metrics. Routes: prefix /pos/security (contract §3.4). Deciding a review item is a step-up route.
import type { AccessReviewDecision, AccessReviewView, DormantAccountsReport, HighRiskAccessReport, PermissionDenialMetrics } from '@aipowersalon/api-contracts/tenant';
import { api } from './client';

const S = '/pos/security';
const u = (id: string) => encodeURIComponent(id);

export const posAccessGovernanceApi = {
  reviews: () => api.get<AccessReviewView[]>(`${S}/access-reviews`),
  startReview: (body: { dueAt?: string | null }) => api.post<AccessReviewView>(`${S}/access-reviews`, body as Record<string, unknown>),
  review: (id: string) => api.get<AccessReviewView>(`${S}/access-reviews/${u(id)}`),
  decide: (id: string, body: AccessReviewDecision) => api.post<AccessReviewView>(`${S}/access-reviews/${u(id)}/decisions`, body as unknown as Record<string, unknown>),
  completeReview: (id: string) => api.post<AccessReviewView>(`${S}/access-reviews/${u(id)}/complete`, {}),
  highRisk: () => api.get<HighRiskAccessReport>(`${S}/high-risk`),
  dormant: (days = 60) => api.get<DormantAccountsReport>(`${S}/dormant`, { days }),
  denials: (q: { from?: string; to?: string }) => api.get<PermissionDenialMetrics>(`${S}/denials`, q as Record<string, unknown>),
};
