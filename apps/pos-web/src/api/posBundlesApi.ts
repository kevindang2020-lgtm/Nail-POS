import { api } from './client';

// posBundlesApi — tenant POS Bundles / Packages / Membership Add-ons (`/pos/bundles/*`). Reads return derived
// componentsTotalCents / savingsCents / savingsPct / isLiveNow from the backend; the UI never recomputes money.
export const posBundlesApi = {
  state: (q: Record<string, string> = {}) => api.get(`/pos/bundles/state${toQuery(q)}`),
  kpis: () => api.get(`/pos/bundles/kpis`),
  list: (q: Record<string, string> = {}) => api.get(`/pos/bundles${toQuery(q)}`),
  detail: (id: string) => api.get(`/pos/bundles/${id}`),
  create: (body: Record<string, unknown>) => api.post(`/pos/bundles`, body),
  update: (id: string, body: Record<string, unknown>) => api.patch(`/pos/bundles/${id}`, body),
  archive: (id: string) => api.post(`/pos/bundles/${id}/archive`),
  reactivate: (id: string) => api.post(`/pos/bundles/${id}/reactivate`),
};

function toQuery(q: Record<string, string>): string {
  const parts = Object.entries(q).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
