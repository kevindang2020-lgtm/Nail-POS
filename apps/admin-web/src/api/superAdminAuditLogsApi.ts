// superAdminAuditLogsApi.ts — typed client for the Super Admin Audit Logs oversight dashboard.
import { api } from './client';

export interface ALKpi { key: string; label: string; value: number; display: string; available: boolean; deltaPct: number; direction: 'up' | 'down' | 'flat'; semantic: 'good' | 'warn' | 'bad' | 'neutral' }
export interface ALSegment { key: string; label: string; count: number; pct: number }
export interface ALTrendDay { day: string; count: number }
export interface ALTopUser { user: string; events: number }
export interface ALSuspicious { time: string; user: string; event: string; status: string; risk: 'high' | 'medium' | 'low'; riskLabel: string; ip: string }
export interface ALTrailRow { time: string; user: string; role: string; tenant: string; action: string; previous: string; next: string; ip: string; device: string; reason: string; result: string }
export interface ALExport { time: string; user: string; scope: string; summary: string }
export interface ALBeforeAfter { time: string; user: string; action: string; previous: string; next: string }
export interface ALOverview {
  ok: boolean;
  metadata: { generatedAt: string; windowDays: number };
  scope: { tenantId: string | null; label: string };
  tamperResistance: { appendOnly: boolean; editable: boolean; note: string };
  kpis: ALKpi[];
  eventsByCategory: { total: number; segments: ALSegment[] };
  resultBreakdown: { total: number; segments: ALSegment[] };
  eventVolumeTrend: ALTrendDay[];
  topUsers: ALTopUser[];
  suspiciousQueue: ALSuspicious[];
  auditTrail: ALTrailRow[];
  recentExports: ALExport[];
  beforeAfterReview: ALBeforeAfter[];
  accessSourceSummary: { total: number; segments: ALSegment[] };
  legalHoldRecords: { available: boolean; records: { holdRef: string; scope: string; status: string; reason: string; createdAt: string }[] };
  openInvestigations: { available: boolean; investigations: { caseRef: string; title: string; severity: string; assignee: string | null; status: string }[] };
  retentionStatus: { available: boolean; appendOnly?: boolean; adminEditable?: boolean; controls?: { key: string; label: string; value: string; status: string; detail: string | null; lastVerifiedAt: string | null }[]; configuredCount?: number; totalControls?: number; anyFailing?: boolean; lastVerifiedAt?: string | null; retention?: { available: boolean; policies: ALRetentionPolicy[]; categoriesConfigured: number; note: string } };
  atAGlance: { eventsToday: number; failedLoginsToday: number; highRiskToday: number; openInvestigations: { available: boolean; value?: number }; legalHoldsActive: { available: boolean; value?: number }; exportsFlagged: { available: boolean; value?: number } };
}

export interface ALExportFlag { id: string; eventRef: string; ruleKey: string; ruleVersion: number; risk: string; reason: string; status: string; reviewNote: string | null; createdAt: string }
export interface ALRetentionPolicy { id: string; category: string; hotDays: number; archiveDays: number; version: number; status: string; reason: string | null; effectiveDate: string; totalDays: number; purgeEligible: number }

export interface ALLegalHold { id: string; holdRef: string; scopeType: string; scopeValue: string | null; reason: string; legalAuthority: string | null; status: string; createdAt: string; reviewDate: string | null; expirationDate: string | null; releasedAt: string | null; releaseReason: string | null }

export interface ALInvestigation { id: string; caseRef: string; title: string; tenantId: string | null; severity: string; assignee: string | null; status: string; description: string | null; createdAt: string; updatedAt: string }
export interface ALTimelineEntry { id: string; entryType: string; payload: any; author: string | null; createdAt: string }

export interface ALEvidencePack { id: string; packRef: string; requestedBy: string | null; scope: any; format: string; eventCount: number; checksum: string; manifest: any; redactionApplied: boolean; status: string; createdAt: string; expiresAt: string | null }
export interface ALCustodyEntry { entryType: string; actor: string | null; purpose: string | null; at: string }

export interface ALTamperControl { key: string; label: string; value: string; status: string; detail: string | null; lastVerifiedAt: string | null }
export interface ALTamperStatus { available: boolean; appendOnly: boolean; adminEditable: boolean; controls: ALTamperControl[]; configuredCount: number; totalControls: number; anyFailing: boolean; lastVerifiedAt: string | null }

export const superAdminAuditLogsApi = {
  overview: (q?: Record<string, unknown>) => api.get<ALOverview>('/super-admin/audit-logs/overview', q),
  listHolds: (status?: string) => api.get<{ holds: ALLegalHold[] }>('/super-admin/audit-logs/legal-holds', status ? { status } : undefined),
  placeHold: (body: { scopeType: string; scopeValue?: string; reason: string; legalAuthority?: string; reviewDate?: string; expirationDate?: string }) => api.post<{ ok: boolean; hold: ALLegalHold; protectedCount: number }>('/super-admin/audit-logs/legal-holds', body),
  releaseHold: (id: string, body: { reason: string }) => api.post<{ ok: boolean; hold: ALLegalHold | null }>(`/super-admin/audit-logs/legal-holds/${id}/release`, body),
  listInvestigations: (status?: string) => api.get<{ investigations: ALInvestigation[] }>('/super-admin/audit-logs/investigations', status ? { status } : undefined),
  getInvestigation: (id: string) => api.get<{ investigation: ALInvestigation; timeline: ALTimelineEntry[] }>(`/super-admin/audit-logs/investigations/${id}`),
  openInvestigation: (body: { title: string; severity?: string; tenantId?: string; assignee?: string; description?: string; eventRefs?: string[] }) => api.post<{ ok: boolean; investigation: ALInvestigation; linkedEvents: number }>('/super-admin/audit-logs/investigations', body),
  addInvestigationNote: (id: string, body: { note: string }) => api.post<{ ok: boolean }>(`/super-admin/audit-logs/investigations/${id}/notes`, body),
  setInvestigationStatus: (id: string, body: { status: string; reason?: string }) => api.post<{ ok: boolean; investigation: ALInvestigation | null }>(`/super-admin/audit-logs/investigations/${id}/status`, body),
  listEvidence: () => api.get<{ packs: ALEvidencePack[] }>('/super-admin/audit-logs/evidence-packs'),
  getEvidence: (id: string) => api.get<{ pack: ALEvidencePack; custody: ALCustodyEntry[] }>(`/super-admin/audit-logs/evidence-packs/${id}`),
  exportEvidence: (body?: { tenantId?: string }) => api.post<{ ok: boolean; pack: ALEvidencePack; filename: string; mimeType: string; content: string; checksum: string; manifest: any }>('/super-admin/audit-logs/exports', body || {}),
  verifyEvidence: (id: string) => api.post<{ ok: boolean; verified: boolean; expected: string; actual: string }>(`/super-admin/audit-logs/evidence-packs/${id}/verify`, {}),
  setTamperControl: (body: { controlKey: string; value: string; status: string; detail?: string }) => api.post<{ ok: boolean; control: ALTamperControl }>('/super-admin/audit-logs/tamper-controls', body),
  verifyTamperControl: (key: string) => api.post<{ ok: boolean; controlKey: string }>(`/super-admin/audit-logs/tamper-controls/${key}/verify`, {}),
  listExportFlags: (status?: string) => api.get<{ flags: ALExportFlag[] }>('/super-admin/audit-logs/export-flags', status ? { status } : undefined),
  scanExportFlags: () => api.post<{ ok: boolean; scanned: number; created: number }>('/super-admin/audit-logs/export-flags/scan', {}),
  reviewExportFlag: (id: string, body: { status: string; note?: string }) => api.post<{ ok: boolean; id: string; status: string }>(`/super-admin/audit-logs/export-flags/${id}/review`, body),
  setRetentionPolicy: (body: { category: string; hotDays: number; archiveDays: number; reason?: string }) => api.post<{ ok: boolean; policy: ALRetentionPolicy }>('/super-admin/audit-logs/retention-policies', body),
};
