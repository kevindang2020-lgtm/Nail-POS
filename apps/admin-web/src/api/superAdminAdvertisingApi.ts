// superAdminAdvertisingApi.ts — Global Advertising + Tenant Control guide (Nov 5 2026, G7): the master switch, the
// display fleet's real acknowledgments, and AI PowerSalon's own campaigns.
import { api } from './client';
const enc = encodeURIComponent;
export const superAdminAdvertisingApi = {
  policy: () => api.get<any>('/super-admin/advertising/policy'),
  setPolicy: (b: { allowTenantAdvertising: boolean; reason: string; expectedVersion: number; acceptNeutralFallback?: boolean }) => api.put<any>('/super-admin/advertising/policy', b),
  fleet: (q: { status?: string; page?: number; pageSize?: number } = {}) => api.get<any>('/super-admin/advertising/fleet', q as Record<string, unknown>),
  ads: (q: { status?: string; page?: number } = {}) => api.get<any>('/super-admin/advertising/ads', q as Record<string, unknown>),
  create: (b: Record<string, unknown>) => api.post<any>('/super-admin/advertising/ads', b),
  update: (id: string, b: Record<string, unknown>) => api.put<any>(`/super-admin/advertising/ads/${enc(id)}`, b),
  act: (id: string, action: 'publish' | 'pause' | 'archive' | 'restore', expectedVersion: number) => api.post<any>(`/super-admin/advertising/ads/${enc(id)}/${action}`, { expectedVersion }),
  upload: (form: FormData) => api.upload<any>('/super-admin/advertising/media', form),
};
