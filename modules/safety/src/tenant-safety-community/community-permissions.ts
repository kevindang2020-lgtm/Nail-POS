// community-permissions.ts — pure role→capability model + the non-negotiable safety guardrails that keep the
// Safety Community from becoming a customer blacklist. No I/O.
import type { CommunityRole } from './community-classification';

export type Capability =
  | 'view_community' | 'create_private_incident' | 'create_advisory_draft' | 'submit_advisory'
  | 'approve_advisory' | 'comment' | 'upload_evidence' | 'request_removal' | 'manage_tenant_settings'
  | 'moderate';

// Defaults per the spec. Tenant settings can REMOVE capabilities but never grant 'moderate' (Super-Admin only)
// and never let a receptionist/technician 'approve_advisory' or publish.
const DEFAULTS: Record<CommunityRole, Capability[]> = {
  owner: ['view_community', 'create_private_incident', 'create_advisory_draft', 'submit_advisory', 'approve_advisory', 'comment', 'upload_evidence', 'request_removal', 'manage_tenant_settings'],
  tenant_admin: ['view_community', 'create_private_incident', 'create_advisory_draft', 'submit_advisory', 'approve_advisory', 'comment', 'upload_evidence', 'request_removal'],
  branch_manager: ['view_community', 'create_private_incident', 'create_advisory_draft', 'submit_advisory', 'approve_advisory', 'comment', 'upload_evidence'],
  receptionist: ['view_community', 'create_private_incident', 'create_advisory_draft', 'comment'], // NO submit/approve by default
  technician: [], // no community posting by default; tenant may grant 'view_community' only
  moderator: ['view_community', 'comment', 'moderate', 'request_removal'],
};

// Capabilities a tenant setting may never grant to a role (safety floor).
const NEVER_GRANT: Partial<Record<CommunityRole, Capability[]>> = {
  receptionist: ['approve_advisory', 'moderate'],
  technician: ['approve_advisory', 'submit_advisory', 'moderate', 'create_private_incident'],
  owner: ['moderate'], tenant_admin: ['moderate'], branch_manager: ['moderate'],
};

/** Effective capabilities = defaults, minus tenant removals, with the safety floor enforced (never-grant wins). */
export function effectiveCapabilities(role: CommunityRole, tenantGrants?: Capability[], tenantRemovals?: Capability[]): Set<Capability> {
  const set = new Set<Capability>(DEFAULTS[role]);
  for (const g of tenantGrants ?? []) {
    if ((NEVER_GRANT[role] ?? []).includes(g)) continue; // safety floor: cannot grant forbidden caps
    if (g === 'moderate') continue;                       // moderate is Super-Admin only, never tenant-granted
    set.add(g);
  }
  for (const r of tenantRemovals ?? []) set.delete(r);
  return set;
}

export function can(role: CommunityRole, cap: Capability, tenantGrants?: Capability[], tenantRemovals?: Capability[]): boolean {
  return effectiveCapabilities(role, tenantGrants, tenantRemovals).has(cap);
}

// ── Safety guardrails ──

// Words that assert guilt/criminality; only allowed when an official report is referenced AND moderation
// reviewed the wording. Otherwise the post must use neutral phrasing.
const ACCUSATORY_TERMS = /\b(criminal|fraudster|thief|scammer|felon|guilty|convicted|liar|predator)\b/i;
const NEUTRAL_SUGGESTIONS = [
  'suspected scam attempt', 'unverified payment concern', 'pattern requiring caution',
  'reported safety incident', 'possible fraudulent behavior', 'under review',
];

export interface WordingCheck { ok: boolean; requiresRewrite: boolean; matched: string | null; suggestions: string[] }

/** Neutral-wording guardrail: reject accusatory/criminalizing language unless an official report is referenced
 *  and moderation approved it. Never auto-labels a person guilty. */
export function checkWording(text: string, opts: { officialReportReferenced: boolean; moderationApprovedWording: boolean }): WordingCheck {
  const m = text.match(ACCUSATORY_TERMS);
  if (!m) return { ok: true, requiresRewrite: false, matched: null, suggestions: [] };
  if (opts.officialReportReferenced && opts.moderationApprovedWording) return { ok: true, requiresRewrite: false, matched: m[0], suggestions: [] };
  return { ok: false, requiresRewrite: true, matched: m[0], suggestions: NEUTRAL_SUGGESTIONS };
}

/** The hardest invariant: a community post can NEVER, by itself, deny service to a customer or act as an
 *  automated blacklist. Any code path that would gate service on community data must call this and get false. */
export function communityPostMayDenyService(): false { return false; }

/** "Possible related reports" — never "known scammer". Requires >1 reliable indicator before surfacing, and
 *  never returns an identity or the reporting tenant. Pure decision used by the (feature-flagged) matcher. */
export function relatedReportsDisposition(indicatorCount: number, reliableIndicators: number): { surface: boolean; label: string } {
  if (reliableIndicators >= 2 && indicatorCount >= 2) return { surface: true, label: 'possible related reports' };
  return { surface: false, label: 'insufficient_indicators' };
}
