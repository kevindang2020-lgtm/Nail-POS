// posTeamApi.ts — the tenant's team roster + rich Team Management state.
// Backed by GET /pos/team (Users & Roles list) and GET /pos/team/state (Team Management dashboard),
// both read-only and gated to Owner/Manager (settings.view) behind TenantAuthGuard + RolePermissionGuard.
import type { POSTeamState, RoleSummary, TeamMemberDetail, TeamMemberRow, TeamPagination, TeamResult, TeamUser } from '@aipowersalon/api-contracts/tenant';
export type { POSTeamState, RoleSummary, TeamMemberDetail, TeamMemberRow, TeamPagination, TeamResult, TeamUser };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';


export type TeamStateQuery = { search?: string; role?: string; status?: string; shift?: string; department?: string; tab?: string; page?: number; pageSize?: number };

export const posTeamApi = {
  list: () => api.get<TeamResult>('/pos/team'),
  getState: (q?: TeamStateQuery) => api.get<POSTeamState>('/pos/team/state', q as Record<string, unknown> | undefined),
  getMember: (userId: string) => api.get<TeamMemberDetail>(`/pos/team/member/${encodeURIComponent(userId)}`),
};
