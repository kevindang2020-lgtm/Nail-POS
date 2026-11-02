// posStaffRolesApi.ts — Functional Decision 12: the salon's own (custom) roles. Phase 9: listing roles, the roster and
// assigning a role moved to /pos/access (posAccessApi — one assignment path, with a reason, preview and step-up);
// creating and archiving a custom role stay here (roles.manage).
import type { AccessScope } from '@aipowersalon/api-contracts/tenant';
import { api } from "./client";
export type StaffRoleView = { key: string; name: string; baseRole: string; scope: string; permissions: string[]; custom: boolean; description?: string };
export const posStaffRolesApi = {
  createRole: (body: { name: string; baseRole: string; scope: AccessScope | string; permissions: string[] }) => api.post<StaffRoleView>(`/pos/staff-roles`, body),
  archiveRole: (id: string) => api.post<{ ok: true }>(`/pos/staff-roles/${encodeURIComponent(id)}/archive`, {}),
};
