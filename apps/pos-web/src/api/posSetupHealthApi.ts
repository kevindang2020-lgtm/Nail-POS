// posSetupHealthApi — Setup Health (Four-Module Completion Guide, Oct 30 2026): `/tenant/setup-health/*`. Tenant and
// authorized branches come from the session; the branch is a query filter the server re-checks (never a body field).
import { api } from './client';
const enc = encodeURIComponent;
export const posSetupHealthApi = {
  summary: (branchId?: string) => api.get<any>(`/tenant/setup-health/summary`, branchId ? { branchId } : {}),
  run: () => api.post<any>(`/tenant/setup-health/run`, {}),
  runs: (q: { page: number; pageSize: number }) => api.get<any>(`/tenant/setup-health/runs`, q),
  acknowledge: (id: string) => api.post<any>(`/tenant/setup-health/alerts/${enc(id)}/acknowledge`, {}),
};
