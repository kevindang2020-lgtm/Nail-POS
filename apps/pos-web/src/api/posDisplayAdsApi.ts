// posDisplayAdsApi.ts — Marketing & Growth → Customer Display Advertising (23-inch dual-screen spec §48–§111).
// Reads need pos.customer_display_ads.view; writes .create/.update/.publish/.pause/.archive (owners and managers; a
// branch manager only for their own branch — enforced server-side). Types come from the contracts (§15), never copied.
import type { CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';
import type {
  DisplayAdAction, DisplayAdInput, DisplayAdMediaView, DisplayAdsAnalytics, DisplayAdsSettingsInput, DisplayAdsState, DisplayAdUpdateInput, DisplayAdView,
} from '@aipowersalon/api-contracts/tenant';
import { api } from './client';
import { apiUrl } from './apiBase';

const BASE = '/pos/marketing/display-ads';
export const posDisplayAdsApi = {
  state: () => api.get<DisplayAdsState>(`${BASE}/state`),
  get: (id: string) => api.get<DisplayAdView>(`${BASE}/${encodeURIComponent(id)}`),
  create: (body: DisplayAdInput) => api.post<DisplayAdView>(`${BASE}`, body as Record<string, unknown>),
  update: (id: string, body: DisplayAdUpdateInput) => api.patch<DisplayAdView>(`${BASE}/${encodeURIComponent(id)}`, body as unknown as Record<string, unknown>),
  act: (id: string, action: DisplayAdAction, expectedVersion: number) => {
    if (action === 'publish') return api.post<DisplayAdView>(`${BASE}/${encodeURIComponent(id)}/publish`, { expectedVersion });
    if (action === 'pause') return api.post<DisplayAdView>(`${BASE}/${encodeURIComponent(id)}/pause`, { expectedVersion });
    if (action === 'archive') return api.post<DisplayAdView>(`${BASE}/${encodeURIComponent(id)}/archive`, { expectedVersion });
    return api.post<DisplayAdView>(`${BASE}/${encodeURIComponent(id)}/restore`, { expectedVersion });
  },
  remove: (id: string, version: number) => api.del<{ deleted: true }>(`${BASE}/${encodeURIComponent(id)}?version=${version}`),
  /** The original plus the three optimized copies made in the browser (see adImagePipeline). */
  uploadMedia: (form: FormData) => api.upload<DisplayAdMediaView>(`${BASE}/media`, form),
  // a branch is a PATH parameter: the API strips tenantId/branchId from bodies and query strings
  playlist: (branchId: string) => api.get<CustomerDisplayAdPlaylist>(`${BASE}/branches/${encodeURIComponent(branchId)}/playlist`),
  analytics: (days: number) => api.get<DisplayAdsAnalytics>(`${BASE}/analytics`, { days }),
  branchAnalytics: (branchId: string, days: number) => api.get<DisplayAdsAnalytics>(`${BASE}/branches/${encodeURIComponent(branchId)}/analytics`, { days }),
  saveSettings: (body: DisplayAdsSettingsInput) => api.patch<DisplayAdsState['settings']>(`${BASE}/settings`, body as unknown as Record<string, unknown>),
  saveBranchSettings: (branchId: string, body: DisplayAdsSettingsInput) => api.patch<DisplayAdsState['settings']>(`${BASE}/branches/${encodeURIComponent(branchId)}/settings`, body as unknown as Record<string, unknown>),
  setDevice: (deviceId: string, adsEnabled: boolean) => api.patch<{ deviceId: string; adsEnabled: boolean }>(`${BASE}/devices/${encodeURIComponent(deviceId)}`, { adsEnabled }),
};

/** Stored media URLs are relative to the API when images live on the API's own disk; the CDN's are absolute. */
export function mediaUrl(u: string): string {
  return /^https?:\/\//i.test(u) || !u.startsWith('/') ? u : apiUrl(u);
}
