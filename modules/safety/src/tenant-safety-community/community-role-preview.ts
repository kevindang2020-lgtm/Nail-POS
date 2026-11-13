// community-role-preview.ts — Safety Community backlog · 08 (Nov 12 2026): Permission-Aware Role Preview. For each of the
// platform's default staff roles, which Safety Community actions a person in that role could take in THIS salon — evaluated
// with the REAL checks, never a copy of them:
//   1. the route permission each action's endpoint declares (@RequirePermission community.*), checked with hasPermission
//      against the role's catalog grants (templatePermissions — the same grants a signed-in session of that role carries);
//   2. the community role that session acts as (communityRoleOf — derived from those permissions) and its capability after
//      this salon's grants / removals and the safety floor (effectiveCapabilities — the function requireCapability uses);
//   3. the salon's on/off switch (a disabled community refuses everything but its own settings).
// Read-only and no privilege escalation: nothing is granted, assumed or stored; the viewer never acts as the previewed role;
// moderation is Super-Admin only and is never shown as grantable. Pure (no I/O).
import { DEFAULT_ROLE_TEMPLATES, templatePermissions, hasPermission } from '@aipowersalon/permissions';
import type { CommunityRolePreview, CommunityRolePreviewAction } from '@aipowersalon/api-contracts/tenant';
import { effectiveCapabilities, type Capability } from './community-permissions';
import type { CommunityRole } from './community-classification';

/** each action = the permission its route declares + the capability its service method requires (null = none beyond the route) */
export const COMMUNITY_PREVIEW_ACTIONS: ReadonlyArray<{ action: string; routeKey: string; capability: Capability | null }> = [
  { action: 'view_feed', routeKey: 'community.feed.view', capability: 'view_community' },
  { action: 'follow', routeKey: 'community.follow', capability: 'view_community' },
  { action: 'report', routeKey: 'community.report.create', capability: 'view_community' },
  { action: 'dispute', routeKey: 'community.dispute.create', capability: 'view_community' },
  { action: 'appeal', routeKey: 'community.appeal.create', capability: null },
  { action: 'comment', routeKey: 'community.comment.create', capability: 'comment' },
  { action: 'create_incident', routeKey: 'community.incident.create', capability: 'create_private_incident' },
  { action: 'draft_advisory', routeKey: 'community.advisory.draft', capability: 'create_advisory_draft' },
  { action: 'submit_advisory', routeKey: 'community.advisory.submit', capability: 'submit_advisory' },
  { action: 'approve_advisory', routeKey: 'community.advisory.approve', capability: 'approve_advisory' },
  { action: 'upload_evidence', routeKey: 'community.evidence.upload', capability: 'upload_evidence' },
  { action: 'manage_settings', routeKey: 'community.settings.manage', capability: 'manage_tenant_settings' },
];

export interface PreviewSettings { enabled: boolean; roleGrants: Record<string, string[]>; roleRemovals: Record<string, string[]> }

/** One role's actions. `communityRoleOf` is passed in (community.service.ts owns it) so this file has no service import. */
export function previewOneRole(t: { key: string; name: string; baseRole: string; permissions: string[] }, s: PreviewSettings,
  communityRoleOf: (ctx: { role?: string | null; permissions?: readonly string[] | null }) => CommunityRole): CommunityRolePreview['roles'][number] {
  const role = communityRoleOf({ role: t.baseRole, permissions: t.permissions });
  const grants = (s.roleGrants[role] ?? []) as Capability[]; const removals = (s.roleRemovals[role] ?? []) as Capability[];
  const caps = effectiveCapabilities(role, grants, removals);
  const defaults = effectiveCapabilities(role);
  const principal = { tenantId: 'preview', branchId: '', userId: 'preview', role: t.baseRole as never, permissions: t.permissions };
  const actions: CommunityRolePreviewAction[] = COMMUNITY_PREVIEW_ACTIONS.map((a) => {
    const routeHeld = hasPermission(principal, a.routeKey);
    const capHeld = a.capability == null || caps.has(a.capability);
    const off = !s.enabled && a.action !== 'manage_settings';
    const blockedBy: CommunityRolePreviewAction['blockedBy'] = !routeHeld ? 'role_permission'
      : !capHeld ? (a.capability && defaults.has(a.capability) && removals.includes(a.capability) ? 'salon_setting' : 'community_role')
      : off ? 'community_off' : null;
    return { action: a.action, routeKey: a.routeKey, capability: a.capability, routeHeld, capabilityHeld: capHeld, allowed: blockedBy === null, blockedBy };
  });
  return { key: t.key, name: t.name, baseRole: t.baseRole, communityRole: role, actions };
}

/** Every default staff role (packages/permissions role-templates), previewed against this salon's settings. */
export function previewCommunityRoles(s: PreviewSettings, communityRoleOf: Parameters<typeof previewOneRole>[2]): CommunityRolePreview['roles'] {
  return DEFAULT_ROLE_TEMPLATES.map((t) => previewOneRole({ key: t.key, name: t.name, baseRole: t.baseRole, permissions: templatePermissions(t) }, s, communityRoleOf));
}
