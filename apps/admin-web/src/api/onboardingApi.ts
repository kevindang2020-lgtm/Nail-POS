// onboardingApi.ts — typed client + hook for the Super-Admin "Onboarding & Approvals" surface.
// Mirrors the backend OnboardingService.overview() payload (GET /super-admin/onboarding/overview) and the command
// endpoints. Same-origin via the shared fetch client; the session cookie carries the super-admin principal, never a
// tenantId. Production values come from real backend rows; nothing here fabricates data.
import { useCallback, useEffect, useState } from 'react';
import { api } from './client';
import type { DonutSlice, OnboardingExportFormat, OnboardingExportResult, OnboardingKpis } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import type { OnboardingState, OnboardingQuery, ApprovalRow } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)
import type { PagedRows } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

export type ApplicationType = 'new_tenant' | 'new_branch';


export interface OnboardingRow {
  id: string; applicationId: string; applicationType: ApplicationType; parentTenantId: string | null; tenantId: string | null;
  salonName: string | null; ownerName: string | null; ownerEmail: string | null; branchCount: number;
  currentStage: OnboardingState; completionPct: number; specialistUserId: string | null; specialistName: string | null;
  stageEnteredAt: string; stageAgeHours: number; slaBand: 'ok' | 'aging' | 'breached';
  identity: string; merchant: string; bank: string; hardware: string; dataImport: string; training: string;
  usersInvited: boolean; missingDocsCount: number; priority: 'low' | 'normal' | 'high' | 'urgent';
  targetActivationDate: string | null; activatedAt: string | null; activationType: string | null;
  createdAt: string; updatedAt: string;
}

export interface Donut { slices: DonutSlice[]; total: number }

export interface OnboardingOverview {
  generatedAt: string;
  kpis: OnboardingKpis;
  applications: PagedRows<OnboardingRow>;
  onboardingHealth: { key: string; label: string; count: number; severity: 'critical' | 'warning' | 'info' | 'ok' }[];
  pendingApprovals: { byType: Record<string, number>; total: number };
  workflow: { stage: OnboardingState; label: string; count: number }[];
  completionTrend: { date: string; applications: number; completions: number }[];
  stageDistribution: { buckets: { stage: OnboardingState; label: string; count: number }[]; total: number };
  merchantStatus: Donut; shipmentStatus: Donut; dataImportStatus: Donut; trainingProgress: Donut;
  specialistWorkload: { specialistUserId: string; specialistName: string | null; active: number; completed: number }[];
  recentActivity: { id: string; onboardingId: string; from: string | null; to: string; reason: string | null; at: string }[];
  approvalNotes: { id: string; onboardingId: string; authorName: string | null; noteType: string; body: string; visibility: string; createdAt: string }[];
  activationSummary: { total: number; newTenants: number; upgraded: number; reactivated: number };
  rejectedExpired: { rejectedApplications: number; expiredIdentityVerifications: number; cancelledOnboarding: number; expiredApplications: number };
  permissions: Record<string, boolean>;
}


export interface OnboardingHistoryRow {
  id: string; onboardingId: string; fromState: string | null; toState: string; skippedStages?: string[];
  reason?: string | null; actorUserId?: string | null; actorRole?: string | null; auditEventId?: string | null; createdAt: string;
}
export interface OnboardingNote {
  id: string; onboardingId: string; authorUserId: string | null; authorName: string | null;
  noteType: string; body: string; stage: string | null; visibility: string;
  attachmentDocumentId: string | null; followUpDate: string | null; createdAt: string;
}
export interface OnboardingDocument {
  id: string; onboardingId: string; category: string; fileName: string | null; status: string;
  reviewerUserId: string | null; reviewedAt: string | null; rejectionReason: string | null;
  issueDate: string | null; expirationDate: string | null; version: number; virusScanStatus: string;
  createdAt: string; updatedAt: string;
}



const clean = (q: OnboardingQuery): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '' && v !== null) out[k] = v;
  return out;
};

export const onboardingApi = {
  overview: (q: OnboardingQuery = {}) => api.get<OnboardingOverview>('/super-admin/onboarding/overview', clean(q)),
  applications: (q: OnboardingQuery = {}) => api.get<PagedRows<OnboardingRow>>('/super-admin/onboarding/applications', clean(q)),
  approvals: (q: { status?: string; approvalType?: string } = {}) => api.get<ApprovalRow[]>('/super-admin/onboarding/approvals', clean(q as OnboardingQuery)),
  exportReport: (q: OnboardingQuery = {}, format: OnboardingExportFormat = 'csv') =>
    api.exportAsync<OnboardingExportResult>('/super-admin/onboarding/export', { ...clean(q), format }),
  get: (id: string) => api.get<OnboardingRow>(`/super-admin/onboarding/${id}`),
  record: (id: string) => api.get<OnboardingRow>(`/super-admin/onboarding/${id}`),
  history: (id: string) => api.get<OnboardingHistoryRow[]>(`/super-admin/onboarding/${id}/history`),
  notes: (id: string) => api.get<OnboardingNote[]>(`/super-admin/onboarding/${id}/notes`),
  documents: (id: string) => api.get<OnboardingDocument[]>(`/super-admin/onboarding/${id}/documents`),
  reviewDocument: (documentId: string, status: string, rejectionReason?: string | null) =>
    api.patch<{ ok: boolean; status: string }>(`/super-admin/onboarding/documents/${documentId}`, { status, rejectionReason }),
  create: (body: { applicationId: string; applicationType?: ApplicationType; parentTenantId?: string | null; branchCount?: number; specialistUserId?: string | null; priority?: string; targetActivationDate?: string | null }) =>
    api.post<OnboardingRow>('/super-admin/onboarding/applications', body),
  transition: (id: string, body: { toState: OnboardingState; reason?: string | null; allowSkip?: boolean; resumeStage?: OnboardingState }) =>
    api.patch<OnboardingRow>(`/super-admin/onboarding/${id}/transition`, body),
  assign: (id: string, specialistUserId: string | null) => api.patch<OnboardingRow>(`/super-admin/onboarding/${id}/assign`, { specialistUserId }),
  addNote: (id: string, body: { body: string; noteType?: string; visibility?: string; stage?: string | null; followUpDate?: string | null }) =>
    api.post<{ id: string }>(`/super-admin/onboarding/${id}/notes`, body),
  requestInfo: (id: string, message: string, deadline?: string | null) => api.post<{ id: string }>(`/super-admin/onboarding/${id}/request-info`, { message, deadline }),
  returnForCorrection: (id: string, reason: string, corrections: string) => api.post<OnboardingRow>(`/super-admin/onboarding/${id}/return-for-correction`, { reason, corrections }),
  queueApproval: (id: string, approvalType: string, stage?: string | null) => api.post<{ id: string }>(`/super-admin/onboarding/${id}/approvals`, { approvalType, stage }),
  decideApproval: (approvalId: string, status: string, reason?: string | null) => api.patch<{ ok: boolean }>(`/super-admin/onboarding/approvals/${approvalId}`, { status, reason }),
  activate: (id: string, body: { note?: string | null; activationType?: string }) => api.post<OnboardingRow>(`/super-admin/onboarding/${id}/activate`, body),
};

export function useOnboardingOverview(query: OnboardingQuery = {}) {
  const [data, setData] = useState<OnboardingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(query);

  const reload = useCallback(() => {
    let alive = true;
    setLoading(true); setError(null);
    onboardingApi.overview(query)
      .then((d) => { if (alive) { setData(d); setLoading(false); } })
      .catch((e: unknown) => { if (alive) { setError(e instanceof Error ? e.message : 'Failed to load onboarding'); setLoading(false); } });
    return () => { alive = false; };
     
  }, [key]);

  useEffect(() => reload(), [reload]);
  return { data, loading, error, reload };
}
export type { DonutSlice, OnboardingExportFormat, OnboardingExportResult, OnboardingKpis };
export type { OnboardingState, OnboardingQuery, ApprovalRow };
export type { PagedRows };
