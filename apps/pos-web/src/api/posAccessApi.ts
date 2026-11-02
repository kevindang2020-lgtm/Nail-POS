// posAccessApi.ts — BUILD_PLAN Phase 9 (Constitution 2): the salon's Roles & Permissions — roster, per-person access
// (role, branch access, ALLOW / DENY overrides incl. temporary), the effective-permission view with reason codes, the
// "what would change" preview, the authorization audit, the permission registry and ownership transfer.
// Routes: prefix /pos/access (contract §2.6). Step-up routes answer 403 STEP_UP_REQUIRED until the person re-proves
// their password (components/StepUp.tsx retries once after POST /auth/step-up).
import type {
  AuthzAuditEventView, OwnershipTransferRequest, OwnershipTransferResult, PermissionDefinition, TeamAssignRoleRequest,
  TeamBranchAccessRequest, TeamEffectivePermissions, TeamMemberView, TeamOverrideRequest, TeamOverrideRevoke, TeamOverrideView,
  TeamPreviewRequest, TeamPreviewResult, TeamRoleView,
} from '@aipowersalon/api-contracts/tenant';
import { api } from './client';

export type StaffInviteRequest = { fullName: string; email?: string; phone?: string; role: 'RECEPTION' | 'FRONT_DESK' | 'MANAGER'; channel?: 'email' | 'sms' };
export type StaffInviteResult = { id: string; status: string; role?: string; reused?: boolean; deliveryStatus?: string; deliveryNote?: string | null; acceptUrl?: string | null; message?: string };
export type AuthzAuditPage = { items: AuthzAuditEventView[]; page: number; pageSize: number; total: number; hasMore: boolean };
const A = '/pos/access';
/** The override's branch travels as `scopeBranchId` (contract TeamOverrideRequest) — a body `branchId` would be stripped by
 *  the API's tenant-context middleware (the session owns the branch). No branch = every branch the person may enter. */
export const OVERRIDE_BRANCH_FIELD = 'scopeBranchId' as const;
const overrideBody = (b: TeamOverrideRequest): Record<string, unknown> => {
  const { scopeBranchId, ...rest } = b;
  return scopeBranchId ? { ...rest, scopeBranchId } : { ...rest };
};
const u = (id: string) => encodeURIComponent(id);

export const posAccessApi = {
  roles: () => api.get<TeamRoleView[]>(`${A}/roles`),
  members: () => api.get<TeamMemberView[]>(`${A}/members`),
  member: (userId: string) => api.get<TeamMemberView>(`${A}/members/${u(userId)}`),
  assignRole: (userId: string, body: TeamAssignRoleRequest) => api.put<TeamMemberView>(`${A}/members/${u(userId)}/role`, body as unknown as Record<string, unknown>),
  setBranches: (userId: string, body: TeamBranchAccessRequest) => api.put<TeamMemberView>(`${A}/members/${u(userId)}/branches`, body as unknown as Record<string, unknown>),
  grantOverride: (userId: string, body: TeamOverrideRequest) => api.post<TeamOverrideView>(`${A}/members/${u(userId)}/overrides`, overrideBody(body)),
  revokeOverride: (overrideId: string, body: TeamOverrideRevoke) => api.post<TeamOverrideView>(`${A}/overrides/${u(overrideId)}/revoke`, body as unknown as Record<string, unknown>),
  effective: (userId: string) => api.get<TeamEffectivePermissions>(`${A}/members/${u(userId)}/effective`),
  preview: (body: TeamPreviewRequest) => api.post<TeamPreviewResult>(`${A}/preview`, body as unknown as Record<string, unknown>),
  audit: (q: { userId?: string; page?: number; pageSize?: number }) => api.get<AuthzAuditPage>(`${A}/audit`, q as Record<string, unknown>),
  catalog: () => api.get<PermissionDefinition[]>(`${A}/catalog`),
  /** wave 4 pilot: the salon invites its own front desk / manager (the same invitation the Super Admin sends; roles.manage,
   *  never above the inviter's own permissions). `acceptUrl` is the link to hand over when nothing could be delivered. */
  inviteStaff: (body: StaffInviteRequest) => api.post<StaffInviteResult>(`${A}/invitations`, body as unknown as Record<string, unknown>),
  transferOwnership: (body: OwnershipTransferRequest) => api.post<OwnershipTransferResult>(`${A}/ownership/transfer`, body as unknown as Record<string, unknown>),
  /** B-13 (Oct 20 2026): end a non-technician staff member's employment — login inactive, sessions signed out, branch grants and role
   *  assignment removed, audited. Technicians are ended from their profile (their chain removes roster + Clock PIN too). Step-up. */
  endEmployment: (userId: string, body: { reason: string }) => api.post<{ ok: true; userId: string; sessionsRevoked: number; branchGrantsRemoved: number }>(`${A}/members/${u(userId)}/end-employment`, body),
};
