// community.ts — BUILD_PLAN Phase 8: the Safety Community's wire contract (tenant realm). A moderated network where
// salons share SANITIZED safety advisories — the platform's one deliberate exception to tenant isolation. Nothing in
// these shapes ever carries another salon's id, a user id, a customer identifier or raw incident text: other salons
// are shown only by the author label the posting salon chose (its name, its display name, or "A salon in <region>").
// Routes live under /community (tenant session). Lists are paged: { items, page, pageSize, total, hasMore }.

export const COMMUNITY_CATEGORIES = [
  'payment_fraud_attempt', 'chargeback_abuse', 'fake_payment_confirmation', 'counterfeit_currency',
  'stolen_payment_method_concern', 'gift_card_scam', 'phone_scam', 'phishing_email_or_text', 'fake_vendor_or_supplier',
  'fake_ai_powersalon_representative', 'account_takeover_attempt', 'impersonation_of_staff', 'booking_no_show_pattern',
  'fake_booking_spam', 'refund_abuse', 'coupon_or_deal_abuse', 'review_extortion', 'theft_or_shoplifting',
  'property_damage', 'harassment_or_abusive_conduct', 'threat_or_violence', 'employee_safety_incident',
  'customer_safety_incident', 'health_or_hygiene_concern', 'product_recall_or_safety_alert',
  'data_breach_or_privacy_concern', 'other',
] as const;
export type CommunityCategory = typeof COMMUNITY_CATEGORIES[number];
/** These categories (and any 'critical' post) always go through Super Admin moderation before anyone else sees them. */
export const COMMUNITY_MODERATION_REQUIRED_CATEGORIES: readonly CommunityCategory[] = [
  'threat_or_violence', 'harassment_or_abusive_conduct', 'employee_safety_incident', 'customer_safety_incident',
  'fake_ai_powersalon_representative', 'account_takeover_attempt', 'stolen_payment_method_concern',
];
export type CommunitySeverity = 'informational' | 'low' | 'moderate' | 'high' | 'critical';
export type CommunityPostStatus =
  | 'incident_draft' | 'tenant_review' | 'privacy_scan' | 'manager_approval' | 'moderation_review'
  | 'published_unverified' | 'published_evidence_reviewed' | 'published_multiple_reports' | 'published_official_report'
  | 'returned_for_correction' | 'sensitive_data_detected' | 'insufficient_information' | 'evidence_requested'
  | 'rejected' | 'disputed' | 'corrected' | 'resolved' | 'removed' | 'archived';
export type CommunityVerificationLabel = 'unverified' | 'evidence_reviewed' | 'multiple_reports' | 'official_report';
export type CommunityAuthorDisplay = 'tenant_name' | 'display_name' | 'anonymous';
export type CommunityChannel = 'phone' | 'sms' | 'email' | 'in_person' | 'online_booking' | 'social' | 'other';
export type CommunityAmountRange = 'under_50' | '50_200' | '200_500' | '500_2000' | 'over_2000';
export type CommunityReportReason = 'contains_personal_info' | 'accusatory_or_defamatory' | 'inaccurate' | 'spam' | 'harassment' | 'other';

/** Shown before a user's first post and whenever the version changes; acknowledged per user. */
export const COMMUNITY_RULES_VERSION = '2026-10-08';
export const COMMUNITY_RULES: readonly string[] = [
  'Share what happened and how to stay safe — never who did it. No customer names, phone numbers, emails, addresses, photos of faces, licence plates, card or bank details.',
  'Use neutral words: "suspected scam attempt", "unverified payment concern". Do not call anyone a criminal, thief or scammer unless an official report is referenced and moderation approved it.',
  'A post is never a reason to refuse service to a customer. Use it to stay alert, not to blacklist anyone.',
  'Only post what your salon experienced or verified. Mark what is unverified.',
  'Serious and critical posts are reviewed by AI PowerSalon moderators before other salons see them.',
  'Evidence is private: other salons see only that evidence was reviewed, never the files.',
  'Disputes and corrections are welcome — a disputed post is labelled until moderation decides.',
];

export interface CommunityPage<T> { items: T[]; page: number; pageSize: number; total: number; hasMore: boolean }

export interface CommunityAuthor {
  label: string;               // "Bella Nails" | "Downtown salon" | "A salon in NJ" — never an id
  isOwnSalon: boolean;
  anonymous: boolean;
}
export interface CommunityViewerActions {
  canComment: boolean; canEdit: boolean; canAddUpdate: boolean; canResolve: boolean; canReport: boolean;
  canDispute: boolean; canAppeal: boolean; canFollow: boolean; canUploadEvidence: boolean; canMarkSimilar: boolean;
}
export interface CommunityPostUpdateView { id: string; body: string; createdAt: string; author: CommunityAuthor }
export interface CommunityRelatedPostView { id: string; title: string; relation: 'related' | 'possible_duplicate' | 'merged_into'; severity: CommunitySeverity; publishedAt: string | null }

export interface CommunityPostView {
  id: string; title: string; body: string;
  category: CommunityCategory; severity: CommunitySeverity; status: CommunityPostStatus; verificationLabel: CommunityVerificationLabel;
  region: string | null; incidentDate: string | null; scamMethod: string | null; channels: CommunityChannel[];
  recommendation: string | null; tags: string[]; paymentProcessor: string | null; amountRange: CommunityAmountRange | null;
  officialReference: string | null;
  author: CommunityAuthor;
  counts: { comments: number; similar: number; followers: number };
  publishedAt: string | null; lastActivityAt: string | null; resolvedAt: string | null; resolutionNote: string | null;
  commentsLocked: boolean;
  following: boolean; similarReportedByMe: boolean;
  evidence: { count: number; reviewed: boolean };
  viewerActions: CommunityViewerActions;
  version: number; createdAt: string; updatedAt: string;
  /** detail only (GET /community/posts/:id); omitted in lists */
  updates?: CommunityPostUpdateView[];
  related?: CommunityRelatedPostView[];
}
/** The posting salon's own view of its advisory (my lists, drafts, approvals) — adds workflow detail, still no raw incident text. */
export interface CommunityMyPostView extends CommunityPostView {
  privacyScanFlags: string[];          // categories the privacy scan found (redacted) — never the matched text
  moderationRequired: boolean;
  authorDisplay: CommunityAuthorDisplay;
  createdByMe: boolean; awaitingMyApproval: boolean;
  returnReason: string | null;         // the moderator's / approver's note when returned, rejected or evidence requested
  fromIncidentId: string | null;
}

export interface CommunityFeedQuery {
  q?: string; category?: CommunityCategory; severity?: CommunitySeverity; region?: string;
  status?: 'active' | 'resolved' | 'all';           // default active
  sort?: 'newest' | 'most_active' | 'severity';     // default newest
  followingOnly?: boolean;
  page?: number; pageSize?: number;                 // pageSize default 20, max 50
}
export type CommunityMyListKind = 'drafts' | 'submitted' | 'awaiting_approval' | 'published' | 'returned' | 'all';

export interface CommunityAdvisoryInput {
  category: CommunityCategory; severity: CommunitySeverity; title: string; body: string;
  region?: string | null; incidentDate?: string | null; scamMethod?: string | null; channels?: CommunityChannel[];
  recommendation?: string | null; tags?: string[]; paymentProcessor?: string | null; amountRange?: CommunityAmountRange | null;
  officialReference?: string | null; authorDisplay?: CommunityAuthorDisplay | null;
  fromIncidentId?: string | null;                   // create the advisory from a private incident (explicit, sanitized)
}
export interface CommunityAdvisoryUpdate extends Partial<CommunityAdvisoryInput> { expectedVersion: number; changeNote?: string | null }
export interface CommunityVersionedRequest { expectedVersion: number; note?: string | null }
export interface CommunityScanSummary { blocked: boolean; flagged: boolean; categories: string[]; redactedPreview: string }
export interface CommunityWordingIssue { matched: string; suggestions: string[] }
export interface CommunitySubmitResult { post: CommunityMyPostView; scan: CommunityScanSummary; wording: CommunityWordingIssue | null }

export interface CommunityIncidentInput { category: CommunityCategory; severity: CommunitySeverity; occurredOn?: string | null; rawDetail?: string | null }
export interface CommunityIncidentView { id: string; branchId: string | null; category: CommunityCategory; severity: CommunitySeverity; occurredOn: string | null; rawDetail: string | null; advisoryPostId: string | null; createdAt: string }

export interface CommunitySettingsView {
  enabled: boolean; receptionistApprovalRequired: boolean; managerApprovalRequired: boolean;
  displayName: string | null; authorDisplay: CommunityAuthorDisplay; allowAnonymous: boolean;
  branchVisibility: 'tenant' | 'own_branch'; retentionDays: number; regionPreferences: string[];
  riskMatchingEnabled: boolean;                      // read-only for the salon while the platform flag is off
  notify: { categories: CommunityCategory[]; push: boolean; email: boolean; criticalSms: boolean };
  roleGrants: Record<string, string[]>; roleRemovals: Record<string, string[]>;
  version: number;
  rulesVersion: string; rulesAcknowledgedByMe: boolean;
}
export interface CommunitySettingsUpdate {
  expectedVersion: number;                           // 0 when the salon has no settings row yet
  enabled?: boolean; receptionistApprovalRequired?: boolean; managerApprovalRequired?: boolean;
  displayName?: string | null; authorDisplay?: CommunityAuthorDisplay; allowAnonymous?: boolean;
  branchVisibility?: 'tenant' | 'own_branch'; retentionDays?: number; regionPreferences?: string[];
  notify?: Partial<CommunitySettingsView['notify']>;
  roleGrants?: Record<string, string[]>; roleRemovals?: Record<string, string[]>;
}

export interface CommunityCommentView {
  id: string; postId: string; parentId: string | null; depth: number;
  body: string;                                      // "[removed by moderator]" when removed
  author: CommunityAuthor; mine: boolean; edited: boolean; removed: boolean;
  version: number; createdAt: string;
  replies: CommunityCommentView[];
}
export interface CommunityCommentInput { body: string; parentId?: string | null }
export interface CommunityCommentEdit { body: string; expectedVersion: number }

export interface CommunitySimilarInput { note?: string | null; occurredOn?: string | null }
export interface CommunityFollowView { id: string; category: CommunityCategory | null; region: string | null; severityMin: CommunitySeverity | null; channels: ('in_app' | 'push' | 'email' | 'sms')[] }
export interface CommunityFollowInput { category?: CommunityCategory | null; region?: string | null; severityMin?: CommunitySeverity | null; channels?: ('in_app' | 'push' | 'email' | 'sms')[] }

export interface CommunityReportInput { reason: CommunityReportReason; detail?: string | null }
export interface CommunityDisputeInput { reason: string; raisedByKind?: 'tenant' | 'subject' }
export interface CommunityAppealInput { subject: 'post_rejected' | 'post_removed' | 'comment_removed' | 'community_suspended' | 'verification_status' | 'severity_change'; reason: string; commentId?: string | null }
export interface CommunityAppealView { id: string; postId: string | null; subject: string; reason: string; status: 'submitted' | 'under_review' | 'upheld' | 'overturned' | 'withdrawn'; decisionNote: string | null; createdAt: string; decidedAt: string | null }

export interface CommunityEvidenceUploadRequest { postId?: string | null; incidentId?: string | null; mimeType: string; sizeBytes: number; sha256: string }
export interface CommunityEvidenceUploadTicket { evidenceId: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresAt: string }
export interface CommunityEvidenceView { id: string; mimeType: string | null; sizeBytes: number | null; uploadStatus: 'pending_upload' | 'uploaded' | 'failed'; scanStatus: 'unscanned' | 'clean' | 'infected' | 'error'; redactionStatus: 'pending' | 'redacted' | 'not_required'; createdAt: string }
export interface CommunityEvidenceAccess { url: string; expiresAt: string }

export interface CommunityActiveAlert { postId: string; title: string; severity: CommunitySeverity; category: CommunityCategory; publishedAt: string; author: CommunityAuthor }

export interface CommunityTenantAnalytics {
  from: string; to: string;
  posts: Record<string, number>;                     // by status
  published: number; comments: number; similarReports: number; followers: number;
  avgHoursToPublish: number | null;
  topCategories: { category: CommunityCategory; count: number }[];
}
