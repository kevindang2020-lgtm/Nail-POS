// posSettingsApi.ts — POS Settings client. getCategory/updateCategory build /pos/settings/<section>, which maps to the
// real per-section backend routes (business-branch, tips, tax, queue-workflow, …). Reconciled per the api contract audit.
import { api } from "./client";
export const posSettingsApi = {
  getState: () => api.get(`/pos/settings/state`),
  getCategory: (category: string) => api.get(`/pos/settings/${category}`),
  updateCategory: (category: string, body: Record<string, unknown>) => api.patch(`/pos/settings/${category}`, body),
  gatewayStatus: () => api.get('/pos/payment-gateway/status'),
  // The salon logo (receipts + the 23-inch customer display header). Its own routes: the generic settings PATCH can
  // never point the logo at an address — the server stores the checked file and keeps its URL (salon-logo.ts).
  getLogo: () => api.get<SalonLogoView | null>('/pos/settings/receipts-branding/logo'),
  uploadLogo: (dataUrl: string) => api.post<{ logoUrl: string; width: number; height: number }>('/pos/settings/receipts-branding/logo', { logo: dataUrl }),
  removeLogo: () => api.post<{ removed: boolean }>('/pos/settings/receipts-branding/logo/remove'),
};
export interface SalonLogoView { url: string; width: number; height: number; updatedAt: string }
