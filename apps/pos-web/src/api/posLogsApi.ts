// posLogsApi.ts — read-only client for the Device & Integration log store (/pos/logs).
import { api } from './client';
import type { LogEntryView } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export type LogsPage = { logs: LogEntryView[]; total: number; page: number; pageSize: number; totalPages: number; summary: { events: number; warnings: number; errors: number; device: number; integration: number };
  /** Device Integration Logs 06: the payment environment these logs come from (absent on an older server) */
  paymentEnvironment?: { environment: 'sandbox' | 'production' | null; source: 'branch' | 'salon' | null; processor: string | null; certification: string | null } };
export const posLogsApi = {
  list: (params?: { category?: string; severity?: string; source?: string; search?: string; limit?: number }) => api.get<{ logs: LogEntryView[] }>('/pos/logs', params as any),
  /** SUNMI batch 8 (Nov 9 2026): dated, numbered pages (newest first) + the range's counts — device events included */
  page: (p: { category?: string; severity?: string; search?: string; relatedId?: string; from?: string; to?: string; page: number; pageSize: number }) =>
    api.get<LogsPage>('/pos/logs', Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== 'all'))),
};
export type { LogEntryView };
