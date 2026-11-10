// posReportsApi.ts — POS Reports client. All reads are permission-gated server-side
// (pos.reports.view; financial reports also need financial/technician/customer view perms).
import { api } from "./client";
export const posReportsApi = {
  state: (q?: Record<string, unknown>) => api.get(`/pos/reports/state`, q),
  sales: (q?: Record<string, unknown>) => api.get(`/pos/reports/sales`, q),
  services: (q?: Record<string, unknown>) => api.get(`/pos/reports/services`, q),
  /** batch 9 guide 2: Revenue by Service (shared with Daily Summary) — categories, totals over every match, paged lines */
  serviceRevenue: (q?: Record<string, unknown>) => api.get(`/pos/reports/service-revenue`, q),
  technicians: (q?: Record<string, unknown>) => api.get(`/pos/reports/technicians`, q),
  payments: (q?: Record<string, unknown>) => api.get(`/pos/reports/payments`, q),
  customers: (q?: Record<string, unknown>) => api.get(`/pos/reports/customers`, q),
  booking: (q?: Record<string, unknown>) => api.get(`/pos/reports/booking`, q),
  tax: (q?: Record<string, unknown>) => api.get(`/pos/reports/tax`, q),
  tips: (q?: Record<string, unknown>) => api.get(`/pos/reports/tips`, q),
  transactions: (q?: Record<string, unknown>) => api.get(`/pos/reports/transactions`, q),
  exportReport: (q: Record<string, unknown>) => api.exportAsync(`/pos/reports/export`, q),
};
