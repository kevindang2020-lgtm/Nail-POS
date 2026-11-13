// authorization.ts — BUILD_PLAN Phase 9 (Constitution 2, Permissions): the wire contract for the salon's roles, branch
// access, per-user overrides (incl. temporary access), the permission preview / per-user view, the authorization audit,
// ownership transfer, access review, the high-risk / dormant reports and the salon's one approvals engine.
// Routes are under /pos/team/* (roles + access), /pos/approvals/* (approvals), /pos/security/* (governance reports).

export type AccessScope = 'OWN' | 'BRANCH' | 'SELECTED_BRANCHES' | 'TENANT';
export type PermissionSensitivity = 'low' | 'medium' | 'high' | 'critical';

/** One catalog key with its metadata (the registry, packages/permissions). */
export interface PermissionDefinition {
  key: string; domain: string; action: string; label: string; description: string;
  sensitivity: PermissionSensitivity; scopes: AccessScope[]; stepUp: boolean; realm: 'tenant' | 'platform' | 'technician' | 'owner';
  deprecatedAliases: string[];
}

/** Why a decision came out the way it did (the decision object's reason codes). */
export type AuthzReason =
  | 'granted_by_role' | 'granted_by_template' | 'granted_by_override' | 'granted_temporarily'
  | 'denied_by_override' | 'missing_permission' | 'out_of_branch_scope' | 'out_of_own_scope'
  | 'platform_key_for_tenant' | 'tenant_key_for_platform' | 'account_inactive' | 'policy_denied' | 'step_up_required';
export interface AuthzDecision { allowed: boolean; key: string; reason: AuthzReason; scope: AccessScope | null; detail?: string | null }

// ── roles / members ────────────────────────────────────────────────────────────────────────────────────────────────
export interface TeamRoleView { key: string; name: string; baseRole: string; scope: AccessScope; permissions: string[]; custom: boolean; description: string | null; memberCount: number }
export interface TeamMemberView {
  userId: string; name: string; email: string | null; role: string; templateKey: string | null; templateName: string | null;
  status: 'active' | 'inactive' | 'suspended' | 'invited' | string; homeBranchId: string | null;
  branchAccess: TeamBranchAccess[]; overrides: TeamOverrideView[];
  lastLoginAt: string | null; dormant: boolean; isOwner: boolean; isPrimaryOwner: boolean; authorizationVersion: number;
}
export interface TeamAssignRoleRequest { templateKey: string | null; reason: string }

// ── branch access (salon side) ─────────────────────────────────────────────────────────────────────────────────────
export interface TeamBranchAccess { branchId: string; branchName: string; role: string | null; accessLevel: 'owner' | 'manager' | 'staff' | 'viewer' | 'report_only'; isPrimaryOwner: boolean }
export interface TeamBranchAccessRequest { branchIds: string[]; accessLevel?: 'manager' | 'staff' | 'viewer' | 'report_only'; reason: string }

// ── per-user overrides: ALLOW / DENY, temporary when expiresAt is set ──────────────────────────────────────────────
export interface TeamOverrideView {
  id: string; permission: string; effect: 'ALLOW' | 'DENY'; branchId: string | null; reason: string;
  grantedByName: string | null; startsAt: string; expiresAt: string | null; active: boolean; temporary: boolean;
}
/** `scopeBranchId`, not `branchId`: the tenant-context middleware strips a body `branchId` (the session owns the branch). */
export interface TeamOverrideRequest { permission: string; effect: 'ALLOW' | 'DENY'; scopeBranchId?: string | null; reason: string; expiresAt?: string | null }
export interface TeamOverrideRevoke { reason: string }

// ── preview / per-user effective permissions ───────────────────────────────────────────────────────────────────────
export interface TeamEffectivePermissions {
  userId: string; role: string; templateKey: string | null; scope: AccessScope; branchIds: string[] | null;   // null = every branch
  permissions: { key: string; reason: AuthzReason; expiresAt: string | null }[];
  denied: { key: string; reason: AuthzReason }[];
  authorizationVersion: number;
}
/** "What would this person be able to do if…" — nothing is saved. */
export interface TeamPreviewRequest { userId?: string | null; templateKey?: string | null; customRole?: { baseRole: string; scope: AccessScope; permissions: string[] } | null; overrides?: TeamOverrideRequest[] }
export interface TeamPreviewResult { granted: string[]; denied: string[]; added: string[]; removed: string[]; highRisk: string[] }

// ── audit ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AuthzAuditEventView { id: string; action: string; actorName: string | null; targetName: string | null; before: unknown; after: unknown; reason: string | null; createdAt: string }

// ── ownership ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface OwnershipTransferRequest { toUserId: string; reason: string; keepPreviousOwnerAs?: string | null }   // template key for the previous owner, or null = OWNER stays (co-owner)
export interface OwnershipTransferResult { ok: true; newOwnerUserId: string; previousOwnerUserId: string }

// ── governance (owner) ─────────────────────────────────────────────────────────────────────────────────────────────
export interface AccessReviewView {
  id: string; status: 'open' | 'completed' | 'cancelled'; startedByName: string | null; dueAt: string | null; createdAt: string; completedAt: string | null;
  items: { userId: string; name: string; role: string; templateKey: string | null; highRiskPermissions: string[]; lastLoginAt: string | null; decision: 'keep' | 'revoke' | 'change' | null; note: string | null; decidedAt: string | null }[];
}
export interface AccessReviewDecision { userId: string; decision: 'keep' | 'revoke' | 'change'; note?: string | null; templateKey?: string | null }
export interface HighRiskAccessReport { generatedAt: string; rows: { userId: string; name: string; role: string; permissions: { key: string; sensitivity: PermissionSensitivity; via: AuthzReason }[] }[] }
export interface DormantAccountsReport { generatedAt: string; thresholdDays: number; rows: { userId: string; name: string; role: string; lastLoginAt: string | null; daysSince: number | null; status: string }[] }
export interface PermissionDenialMetrics { from: string; to: string; total: number; byKey: { key: string; count: number }[]; byReason: { reason: AuthzReason; count: number }[]; byUser: { userId: string; name: string; count: number }[] }

// ── the salon's one approvals engine ───────────────────────────────────────────────────────────────────────────────
export type TenantApprovalKind = 'refund' | 'void' | 'discount_override' | 'deal_publish' | 'purchase_order' | 'price_override' | 'payout_adjustment' | 'loyalty_bonus' | 'other';
export type TenantApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired' | 'executed' | 'execution_failed';
export interface ApprovalRequestView {
  id: string; kind: TenantApprovalKind; status: TenantApprovalStatus; branchId: string | null; branchName: string | null;
  subjectType: string; subjectId: string | null; title: string; amountCents: number | null;
  requestedByUserId: string; requestedByName: string | null; reason: string;
  decidedByName: string | null; decidedAt: string | null; decisionNote: string | null;
  requiredPermission: string; canDecide: boolean; whyNot: string | null;   // e.g. 'requester_cannot_approve', 'over_your_limit'
  expiresAt: string | null; createdAt: string; version: number;
  payload: Record<string, unknown>;
  /** round 10 (Approvals 01 point 2): marked urgent — still pending, decided by the same rules (never auto-approved) */
  escalatedAt?: string | null; escalatedByName?: string | null; escalationReason?: string | null;
}
export interface ApprovalEscalateRequest { reason: string }
export interface ApprovalListQuery { status?: TenantApprovalStatus | 'open' | 'all'; kind?: TenantApprovalKind; mine?: boolean; page?: number; pageSize?: number }
export interface ApprovalPage { items: ApprovalRequestView[]; page: number; pageSize: number; total: number; hasMore: boolean }
export interface ApprovalCreateRequest { kind: TenantApprovalKind; subjectType: string; subjectId?: string | null; amountCents?: number | null; reason: string; payload?: Record<string, unknown>; branchId?: string | null }
export interface ApprovalDecisionRequest { decision: 'approve' | 'reject'; note?: string | null; expectedVersion: number }
export interface ApprovalPolicyView { kind: TenantApprovalKind; enabled: boolean; thresholdCents: number | null; approverPermission: string; requireDifferentApprover: boolean; expiresAfterHours: number; version: number }
export interface ApprovalPolicyUpdate { kind: TenantApprovalKind; enabled?: boolean; thresholdCents?: number | null; requireDifferentApprover?: boolean; expiresAfterHours?: number; expectedVersion: number; reason: string }
