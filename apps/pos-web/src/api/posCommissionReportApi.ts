// posCommissionReportApi.ts — per-technician commission + tips report (pos.reports.view).
import { api } from "./client";
export const posCommissionReportApi = {
  state: (preset?: string) => api.get(`/pos/commission-report/state`, preset ? { preset } : undefined),
};
