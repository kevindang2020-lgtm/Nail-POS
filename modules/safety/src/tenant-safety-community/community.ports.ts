// community.ports.ts — BUILD_PLAN Phase 8: the seams between the three halves of the Safety Community backend, all
// living in ONE Nest module (TenantSafetyCommunityModule):
//   • the CORE (agent A — community.service.ts): tenant settings, roles → capabilities, visibility, the posting
//     workflow, the safe response shape. Provides COMMUNITY_CORE.
//   • MODERATION (agent B — community-moderation.*): cases, every moderator action, restrictions, queues. Provides
//     COMMUNITY_RESTRICTIONS.
//   • INTERACTIONS (agent C — community-interactions.*): comments, follows, similar experiences, evidence, alerts /
//     notifications, related & duplicate detection, analytics, retention jobs. Provides COMMUNITY_FANOUT.
// Events go through COMMUNITY_EVENTS (community-events.ts, the outbox). Wire shapes: @aipowersalon/api-contracts
// (tenant/community.ts, platform/community-moderation.ts).
import type { CommunityPostView } from '@aipowersalon/api-contracts/tenant';
import type { CommunityRole } from './community-classification';
import type { Capability } from './community-permissions';
import type { CommunityCtx, PostRow, TenantSettingsRow } from './community.repository';

/** Who is looking, resolved once per request. role is the COMMUNITY role (OWNER→owner, ADMIN→tenant_admin,
 *  MANAGER→branch_manager, FRONT_DESK/RECEPTION→receptionist, TECHNICIAN→technician; a Super Admin moderator → moderator). */
export interface CommunityViewerInfo {
  ctx: CommunityCtx; role: CommunityRole; capabilities: Set<Capability>;
  settings: TenantSettingsRow; communityEnabled: boolean;
  restrictions: CommunityRestrictionState;
}
export interface CommunityRestrictionState { suspended: boolean; postingRestricted: boolean; commentingRestricted: boolean }

export interface CommunityCorePort {
  viewer(ctx: CommunityCtx): Promise<CommunityViewerInfo>;
  /** throws CommunityError('permission_denied', 403) / ('community_suspended', 403) / ('community_disabled', 403) */
  requireCapability(ctx: CommunityCtx, cap: Capability): Promise<CommunityViewerInfo>;
  /** the post if this viewer may see it; throws CommunityError('post_not_found', 404) / ('not_visible', 403) */
  visiblePost(ctx: CommunityCtx, postId: string): Promise<PostRow>;
  /** the safe tenant-facing shape (no ids of other salons / users, author label per the posting salon's choice) */
  postView(ctx: CommunityCtx, row: PostRow, opts?: { detail?: boolean }): Promise<CommunityPostView>;
  /** the label readers see for a salon ("Bella Nails" / its display name / "A salon in <region>") */
  authorLabelFor(tenantId: string, display: 'tenant_name' | 'display_name' | 'anonymous', region: string | null): Promise<string>;
}
export const COMMUNITY_CORE = 'CommunityCorePort';

/** Active moderation restrictions for a salon / user (agent B owns community_restrictions). */
export interface CommunityRestrictionsPort { active(tenantId: string, userId: string | null): Promise<CommunityRestrictionState> }
export const COMMUNITY_RESTRICTIONS = 'CommunityRestrictionsPort';

/** Called by the core and by moderation whenever a post becomes community-visible or changes while visible.
 *  Agent C: alerts to followers / subscribed salons (one COMMUNITY_ALERT_DELIVERED per recipient salon, in-app + push,
 *  email per settings, SMS only for critical with opt-in), related / duplicate detection, counters. Never throws into
 *  the caller (publication stands even if an alert fails). */
export interface CommunityFanoutPort {
  advisoryPublished(post: PostRow): Promise<void>;
  advisoryChanged(post: PostRow, change: 'edited' | 'update_added' | 'label' | 'severity' | 'resolved' | 'disputed' | 'corrected' | 'removed' | 'restored' | 'merged'): Promise<void>;
}
export const COMMUNITY_FANOUT = 'CommunityFanoutPort';

export type CommunityAggregateType = 'community_post' | 'community_comment' | 'community_case' | 'community_settings' | 'community_evidence' | 'community_restriction';
/** community.* domain events to the outbox (pass the transaction handle when inside one). Realtime is the projection
 *  consumer's job. For COMMUNITY_ALERT_DELIVERED pass the RECIPIENT salon as ctx.tenantId. */
export interface CommunityEventsPort {
  emit(ctx: { tenantId: string | null; branchId?: string | null; userId?: string | null }, eventType: string, aggregate: { type: CommunityAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>, trx?: unknown): Promise<void>;
}
export const COMMUNITY_EVENTS = 'CommunityEventsPort';

/** Evidence for moderators (agent C owns evidence; agent B's moderation routes call this). Access is under a case, with a
 *  reason, logged in community_evidence_access_log and audited; the URL is short-lived. */
export interface CommunityEvidenceModerationPort {
  moderatorAccess(input: { evidenceId: string; caseId: string; moderatorUserId: string; reason: string }): Promise<{ url: string; expiresAt: string }>;
  review(input: { evidenceId: string; caseId: string; moderatorUserId: string; decision: 'clean' | 'redacted' | 'reject'; reason: string }): Promise<{ scanStatus: string; redactionStatus: string; uploadStatus: string }>;
}
export const COMMUNITY_EVIDENCE_MODERATION = 'CommunityEvidenceModerationPort';
