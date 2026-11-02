// community-moderation.ts — BUILD_PLAN Phase 8: the Super Admin "Safety Community Moderation" center's wire contract.
// Routes under /super-admin/community-moderation (SuperAdminGuard; every write needs step-up and a reason, and acts
// under a moderation CASE — opened explicitly or by the action itself — so every cross-tenant look is audited).
import type {
  CommunityCategory, CommunitySeverity, CommunityPostStatus, CommunityVerificationLabel, CommunityPage,
  CommunityAuthorDisplay, CommunityChannel, CommunityAmountRange,
} from '../tenant/community';

export type ModQueue = 'review' | 'sensitive' | 'reports' | 'comment_reports' | 'disputes' | 'appeals' | 'evidence' | 'returned' | 'published' | 'removed';
export type ModCaseKind = 'post_review' | 'report' | 'dispute' | 'appeal' | 'sensitive_data' | 'evidence' | 'comment' | 'tenant_conduct' | 'incident_access';
export type ModCaseStatus = 'open' | 'investigating' | 'resolved' | 'closed';
export type ModPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface ModOverview {
  queues: Record<ModQueue, number>;
  cases: { open: number; investigating: number; urgent: number; assignedToMe: number };
  published7d: number; removed7d: number; rejected7d: number;
  restrictionsActive: number; tenantsEnabled: number;
  avgHoursToDecision: number | null; oldestWaitingHours: number | null;
  generatedAt: string;
}

/** A moderator's view of a post: everything, including which salon posted it (never the raw private incident). */
export interface ModPostView {
  id: string; title: string; body: string; category: CommunityCategory; severity: CommunitySeverity;
  status: CommunityPostStatus; verificationLabel: CommunityVerificationLabel; visibility: 'draft' | 'community_published' | 'removed';
  region: string | null; incidentDate: string | null; scamMethod: string | null; channels: CommunityChannel[];
  recommendation: string | null; tags: string[]; paymentProcessor: string | null; amountRange: CommunityAmountRange | null; officialReference: string | null;
  authorDisplay: CommunityAuthorDisplay; authorLabel: string | null;
  originTenantId: string; originTenantName: string; originBranchName: string | null; createdByName: string | null;
  privacyScanFlags: string[]; moderationRequired: boolean; commentsLocked: boolean; removedReason: string | null;
  counts: { comments: number; reports: number; openReports: number; similar: number; disputes: number; evidence: number };
  signals: { flags: string[]; score: number; notes: string[] } | null;   // AI assist: advisory only, never a decision
  version: number; createdAt: string; updatedAt: string; publishedAt: string | null;
}
export interface ModPostDetail {
  post: ModPostView;
  versions: { version: number; title: string | null; body: string | null; status: string | null; editedBy: string | null; changeNote: string | null; createdAt: string }[];
  reports: ModReportView[]; disputes: ModDisputeView[]; evidence: ModEvidenceView[]; cases: ModCaseView[];
  related: { id: string; title: string; relation: string; score: number | null }[];
  redactions: { field: string; reason: string; by: string | null; createdAt: string }[];
}
export interface ModReportView { id: string; kind: 'post' | 'comment'; postId: string; commentId: string | null; reporterTenantName: string; reason: string; detail: string | null; status: 'open' | 'reviewing' | 'actioned' | 'dismissed'; caseId: string | null; createdAt: string }
export interface ModDisputeView { id: string; postId: string; raisedByKind: 'tenant' | 'subject' | 'moderator'; raisedByTenantName: string | null; reason: string; status: 'open' | 'under_review' | 'upheld' | 'overturned' | 'withdrawn'; resolutionNote: string | null; caseId: string | null; createdAt: string }
export interface ModAppealView { id: string; postId: string | null; commentId: string | null; appellantTenantName: string; subject: string; reason: string; status: string; originalDecision: string | null; originalDeciderIsMe: boolean; decisionNote: string | null; caseId: string | null; createdAt: string }
export interface ModEvidenceView { id: string; postId: string | null; tenantName: string; mimeType: string | null; sizeBytes: number | null; uploadStatus: string; scanStatus: string; redactionStatus: string; createdAt: string }
export interface ModCommentView { id: string; postId: string; parentId: string | null; body: string; tenantName: string; authorLabel: string | null; removed: boolean; removedReason: string | null; reportCount: number; createdAt: string }
export interface ModActionView { id: string; action: string; actorName: string | null; reason: string | null; postId: string | null; commentId: string | null; targetTenantName: string | null; detail: Record<string, unknown>; createdAt: string }
export interface ModCaseView {
  id: string; kind: ModCaseKind; status: ModCaseStatus; priority: ModPriority; reason: string;
  postId: string | null; postTitle: string | null; commentId: string | null; incidentId: string | null;
  targetTenantId: string | null; targetTenantName: string | null;
  openedByName: string | null; assignedToUserId: string | null; assignedToName: string | null;
  resolutionNote: string | null; createdAt: string; updatedAt: string; closedAt: string | null;
}
export interface ModCaseDetail { case: ModCaseView; actions: ModActionView[]; post: ModPostView | null }
export interface ModRestrictionView { id: string; tenantId: string; tenantName: string; userId: string | null; kind: 'suspended' | 'posting_restricted' | 'commenting_restricted'; reason: string; expiresAt: string | null; createdAt: string; liftedAt: string | null }
export interface ModTenantConduct { tenantId: string; tenantName: string; enabled: boolean; posts: number; removed: number; upheldDisputes: number; reportsAgainst: number; restrictions: ModRestrictionView[] }

// ── requests ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ModQueueQuery { queue: ModQueue; q?: string; category?: CommunityCategory; severity?: CommunitySeverity; page?: number; pageSize?: number }
export interface ModOpenCase { kind: ModCaseKind; reason: string; priority?: ModPriority; postId?: string | null; commentId?: string | null; targetTenantId?: string | null; incidentId?: string | null }
export interface ModCaseUpdate { assignToMe?: boolean; status?: ModCaseStatus; priority?: ModPriority; resolutionNote?: string | null }

/** POST /super-admin/community-moderation/posts/:id/actions — one route, every post action. `reason` always required.
 *  A caseId is optional: without one the action opens (or reuses the open) case for that post. */
export type ModPostAction =
  | 'publish' | 'reject' | 'request_evidence' | 'request_changes' | 'redact' | 'set_label' | 'set_severity'
  | 'remove' | 'restore' | 'lock_comments' | 'unlock_comments' | 'merge_into' | 'link_related' | 'mark_resolved';
export interface ModPostActionRequest {
  action: ModPostAction; reason: string; caseId?: string | null; expectedVersion: number;
  label?: CommunityVerificationLabel; severity?: CommunitySeverity;
  redactions?: { field: 'title' | 'body' | 'recommendation' | 'official_reference'; find: string; replaceWith?: string }[];
  targetPostId?: string | null;                     // merge_into / link_related
  messageToTenant?: string | null;                   // request_evidence / request_changes / reject: shown to the posting salon
}
export type ModCommentAction = 'remove' | 'restore' | 'redact';
export interface ModCommentActionRequest { action: ModCommentAction; reason: string; caseId?: string | null; find?: string; replaceWith?: string }
export type ModTenantAction = 'restrict_posting' | 'restrict_commenting' | 'suspend' | 'lift' | 'contact';
export interface ModTenantActionRequest { action: ModTenantAction; reason: string; caseId?: string | null; userId?: string | null; expiresAt?: string | null; restrictionId?: string | null; message?: string | null }
export interface ModReportResolve { resolution: 'actioned' | 'dismissed'; reason: string; caseId?: string | null }
export interface ModDisputeDecision { decision: 'upheld' | 'corrected' | 'overturned'; note: string; caseId?: string | null }
export interface ModAppealDecision { decision: 'uphold' | 'overturn'; note: string; caseId?: string | null; allowSameDecider?: boolean }
export interface ModEvidenceReview { decision: 'clean' | 'redacted' | 'reject'; reason: string; caseId?: string | null }
export interface ModIncidentAccessRequest { caseId: string; reason: string }
export interface ModActionResult { ok: true; caseId: string; post?: ModPostView; comment?: ModCommentView; restriction?: ModRestrictionView }
export interface ModPlatformSettings { riskMatchingEnabled: boolean; rulesVersion: string; autoHideReportThreshold: number; version: number }
export interface ModPlatformSettingsUpdate { expectedVersion: number; riskMatchingEnabled?: boolean; autoHideReportThreshold?: number; reason: string }
export interface ModAnalytics {
  from: string; to: string;
  published: number; rejected: number; removed: number; disputes: number; appeals: number; overturnRate: number | null;
  byCategory: { category: CommunityCategory; count: number }[];
  bySeverity: Record<CommunitySeverity, number>;
  medianHoursToDecision: number | null;
}
export type ModPage<T> = CommunityPage<T>;
