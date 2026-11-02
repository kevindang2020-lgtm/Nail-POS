// posTeamPermissionsApi.ts — read-only RBAC role -> permission matrix. pos.technicians.view.
import { api } from "./client";
export const posTeamPermissionsApi = {
  state: () => api.get<any>(`/pos/team/permissions/state`),
};
