// community-classification.ts — the enforcement heart of the Safety Community's controlled-exception model.
// AI PowerSalon is strictly tenant-isolated; this module is the ONE place where approved records cross the
// tenant boundary, so the visibility rule lives here as pure, testable logic. Two classifications:
//   - private_incident: visible ONLY to the posting tenant's authorized roles (+ a moderator acting under an
//     explicit audited case). NEVER auto-visible to other tenants.
//   - community_advisory: visible to verified tenants with community permission — but ONLY once it reaches a
//     published state via the sanitize→approve→moderate workflow.
// A private incident does not become community-visible by the absence of a restriction; visibility is explicit.
// PURE — no imports, no I/O, fully testable.

export type Classification = 'private_incident' | 'community_advisory';

// Published states are the ONLY states in which a community_advisory is visible to other tenants.
export type AdvisoryStatus =
  | 'incident_draft' | 'tenant_review' | 'privacy_scan' | 'manager_approval' | 'moderation_review'
  | 'published_unverified' | 'published_evidence_reviewed' | 'published_multiple_reports'
  | 'published_official_report'
  | 'returned_for_correction' | 'sensitive_data_detected' | 'insufficient_information'
  | 'evidence_requested' | 'rejected' | 'disputed' | 'corrected' | 'resolved' | 'removed' | 'archived';

const PUBLISHED_STATES: ReadonlySet<AdvisoryStatus> = new Set<AdvisoryStatus>([
  'published_unverified', 'published_evidence_reviewed', 'published_multiple_reports',
  'published_official_report', 'disputed', 'corrected', 'resolved',
]);
// 'disputed'/'corrected'/'resolved' remain visible (with a label); 'removed'/'archived'/pre-publish are not.

export function isCommunityVisible(status: AdvisoryStatus): boolean {
  return PUBLISHED_STATES.has(status);
}

export type CommunityRole = 'owner' | 'tenant_admin' | 'branch_manager' | 'receptionist' | 'technician' | 'moderator';

export interface Viewer {
  tenantId: string;
  role: CommunityRole;
  communityEnabled: boolean;          // tenant has the community turned on
  canAccessCommunity: boolean;        // tenant granted this role view access
  branchIds?: string[];               // branches the viewer is scoped to (managers)
  moderationCaseId?: string | null;   // set ONLY when a moderator is acting under an audited case
}

export interface SafetyRecord {
  classification: Classification;
  ownerTenantId: string;              // the tenant that created it
  ownerBranchId?: string | null;
  status: AdvisoryStatus;
}

export type VisibilityDecision = { allowed: boolean; reason: string };

const deny = (reason: string): VisibilityDecision => ({ allowed: false, reason });
const allow = (reason: string): VisibilityDecision => ({ allowed: true, reason });

/**
 * The single source of truth for "can this viewer see this record?". Fail-closed: anything not explicitly
 * allowed is denied. A private incident never leaks to another tenant; a moderator may only reach another
 * tenant's private incident while acting under an explicit moderation case (which the caller must audit).
 */
export function canView(viewer: Viewer, record: SafetyRecord): VisibilityDecision {
  if (record.classification === 'private_incident') {
    // Same-tenant authorized roles see their own tenant's private incidents.
    if (viewer.tenantId === record.ownerTenantId) {
      if (viewer.role === 'owner' || viewer.role === 'tenant_admin') return allow('same_tenant_admin');
      if (viewer.role === 'branch_manager') {
        // branch managers see incidents for branches they manage (or tenant-wide if unscoped)
        if (!record.ownerBranchId || (viewer.branchIds ?? []).includes(record.ownerBranchId)) return allow('same_tenant_branch_manager');
        return deny('branch_scope');
      }
      if (viewer.role === 'receptionist') return deny('receptionist_no_private_incident_read');
      if (viewer.role === 'technician') return deny('technician_no_private_incident_read');
    }
    // Cross-tenant: ONLY a moderator acting under an explicit audited case.
    if (viewer.role === 'moderator' && viewer.moderationCaseId) return allow('moderator_case');
    return deny('private_incident_is_tenant_scoped');
  }

  // community_advisory
  if (!isCommunityVisible(record.status)) {
    // pre-publish advisory: only its own tenant's authorized users (draft review), never other tenants
    if (viewer.tenantId === record.ownerTenantId && viewer.role !== 'technician') return allow('own_tenant_draft');
    if (viewer.role === 'moderator' && viewer.moderationCaseId) return allow('moderator_case');
    return deny('advisory_not_published');
  }
  // published advisory: any verified tenant user with community access
  if (viewer.role === 'moderator') return allow('moderator');
  if (!viewer.communityEnabled) return deny('community_disabled_for_tenant');
  if (!viewer.canAccessCommunity) return deny('role_lacks_community_access');
  return allow('published_advisory');
}

/** A private incident may only be promoted to a community advisory by an explicit sanitized submission —
 *  never automatically. This guard is the code-level statement of that rule. */
export function assertExplicitAdvisorySubmission(params: { fromPrivateIncident: boolean; sanitizedAdvisoryProvided: boolean; submittedByAuthorizedUser: boolean }): { ok: boolean; reason: string } {
  if (!params.fromPrivateIncident) return { ok: true, reason: 'new_advisory' };
  if (!params.sanitizedAdvisoryProvided) return { ok: false, reason: 'no_sanitized_advisory' };
  if (!params.submittedByAuthorizedUser) return { ok: false, reason: 'unauthorized_submitter' };
  return { ok: true, reason: 'explicit_sanitized_submission' };
}
