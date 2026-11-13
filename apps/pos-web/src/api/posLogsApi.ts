// posLogsApi.ts — read-only client for the Device & Integration log store (/pos/logs).
import { api } from './client';
import type { LogEntryView, LogRetryQueueView, DfAlertsResponse } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export type LogsPage = { logs: LogEntryView[]; total: number; page: number; pageSize: number; totalPages: number; summary: { events: number; warnings: number; errors: number; device: number; integration: number };
  /** Device Integration Logs 06: the payment environment these logs come from (absent on an older server) */
  paymentEnvironment?: { environment: 'sandbox' | 'production' | null; source: 'branch' | 'salon' | null; processor: string | null; certification: string | null } };
export const posLogsApi = {
  list: (params?: { category?: string; severity?: string; source?: string; search?: string; limit?: number }) => api.get<{ logs: LogEntryView[] }>('/pos/logs', params as any),
  /** SUNMI batch 8 (Nov 9 2026): dated, numbered pages (newest first) + the range's counts — device events included */
  page: (p: { category?: string; severity?: string; search?: string; relatedId?: string; correlationId?: string; from?: string; to?: string; page: number; pageSize: number }) =>
    api.get<LogsPage>('/pos/logs', Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== 'all'))),
  /** Device Integration Logs 08: the sanitized CSV of one range (from + to, at most 31 days) with the page's filters —
   *  needs pos.reports.export; the server records the export before it returns the file */
  exportCsv: (p: { category?: string; severity?: string; search?: string; relatedId?: string; correlationId?: string; from?: string; to?: string }) =>
    api.exportAsync<string>('/pos/logs/export', Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== 'all')), 'text'),
  /** Device Integration Logs 05: the routed (deduplicated) device / integration alerts in the salon's alert feed */
  alerts: (p: { status?: 'open' | 'closed' | 'all'; page?: number; pageSize?: number }) => api.get<DfAlertsResponse>('/pos/device-fleet/alerts', p),
  /** resolve through the EXISTING owner-alert lifecycle (owner.alerts.resolve) — the same call the messaging incidents use */
  resolveAlert: (id: string) => api.post<unknown>(`/owner/alerts/${encodeURIComponent(id)}/resolve`, {}),
  /** Device Integration Logs 09: the salon's work waiting in the existing retry stores (read-only) */
  retries: (p: { page?: number; pageSize?: number }) => api.get<LogRetryQueueView>('/pos/logs/retries', p),
};
export type { LogEntryView, LogRetryQueueView, DfAlertsResponse };
