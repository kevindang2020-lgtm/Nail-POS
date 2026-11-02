// superAdminWebsiteLeadsApi.ts — typed client for the Super-Admin Website Leads surface (backend:
// @Controller('super-admin/website-leads')). One `state` call drives the page; the rest are actions.
import { useCallback, useEffect, useState } from 'react';
import { useStableValue } from '@aipowersalon/ui';
import { api } from './client';

const enc = encodeURIComponent;
const qs = (q: Record<string, unknown>) => { const p = new URLSearchParams(); Object.entries(q).forEach(([k, v]) => { if (v != null && v !== '' && v !== 'all') p.set(k, String(v)); }); const s = p.toString(); return s ? `?${s}` : ''; };

export interface WebsiteLead {
  id: string; salonName: string | null; contactName: string | null; phone: string | null; email: string | null; city: string | null; state: string | null;
  source: string | null; leadScore: number | null; status: string; message: string | null; currentPos: string | null; technicianCount: number | null;
  monthlyCardVolumeCents: number | null; assignedToUserId: string | null; assignedToName: string | null; nextFollowUpAt: string | null;
  convertedApplicationId: string | null; createdAt: string; updatedAt: string;
}
export interface LeadsState {
  kpis: { totalLeads: number; newLeads: number; contacted: number; qualified: number; converted: number; conversionRatePct: number; trends: Record<string, number> };
  filters: Record<string, unknown>;
  leads: WebsiteLead[];
  pagination: { page: number; limit: number; totalItems: number; totalPages: number };
  analytics: { bySource: { source: string; count: number; pct: number }[]; byStatus: { status: string; count: number; pct: number }[]; topSources: { rank: number; source: string; count: number; growthPct: number }[] };
  recentActivity: { id: string; leadId: string; activityType: string; title: string | null; message: string | null; createdAt: string; leadName?: string | null }[];
  permissions: Record<string, boolean>;
  sources: string[]; statuses: string[];
  assignableUsers: { id: string; name: string }[];
}
export type LeadQuery = { search?: string; source?: string; status?: string; scoreRange?: string; dateFrom?: string; dateTo?: string; page?: number; limit?: number };

export const superAdminWebsiteLeadsApi = {
  state: (q: LeadQuery = {}) => api.get<LeadsState>(`/super-admin/website-leads/state${qs(q)}`),
  get: (id: string) => api.get<{ lead: WebsiteLead; activities: any[]; followUps: any[] }>(`/super-admin/website-leads/${enc(id)}`),
  create: (b: Record<string, unknown>) => api.post(`/super-admin/website-leads`, b),
  update: (id: string, b: Record<string, unknown>) => api.patch(`/super-admin/website-leads/${enc(id)}`, b),
  setStatus: (id: string, status: string) => api.patch(`/super-admin/website-leads/${enc(id)}/status`, { status }),
  assign: (id: string, assignedToUserId: string | null) => api.patch(`/super-admin/website-leads/${enc(id)}/assign`, { assignedToUserId }),
  addNote: (id: string, text: string) => api.post(`/super-admin/website-leads/${enc(id)}/notes`, { text }),
  convert: (id: string) => api.post(`/super-admin/website-leads/${enc(id)}/convert-to-application`, {}),
  recalcScore: (id: string) => api.post(`/super-admin/website-leads/${enc(id)}/recalculate-score`, {}),
  async downloadCsv(q: LeadQuery = {}) {
    const csv = await api.exportAsync<string>(`/super-admin/website-leads/export`, q as Record<string, unknown>, 'text');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = `website-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  },
};

export function useSuperAdminWebsiteLeadsState(query: LeadQuery) {
  const [state, setState] = useState<LeadsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const stableQuery = useStableValue(query);   // same identity while the query is structurally equal
  const load = useCallback(() => {
    setLoading(true);
    superAdminWebsiteLeadsApi.state(stableQuery).then((s) => { setState(s); setError(null); }).catch((e: any) => setError(e?.status === 403 ? 'You do not have access to Website Leads.' : e?.message || 'Failed to load Website Leads.')).finally(() => setLoading(false));
  }, [stableQuery]);
  useEffect(load, [load]);
  return { state, loading, error, reload: load };
}
