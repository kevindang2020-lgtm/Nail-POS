// posAccountInvoicesApi.ts — the tenant's own platform billing invoices (settings.view). Server-derived tenant.
import { api } from "./client";
export const posAccountInvoicesApi = {
  state: () => api.get<any>(`/tenant/account/invoices/state`),
};
