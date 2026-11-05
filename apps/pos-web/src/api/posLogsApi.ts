// posLogsApi.ts — read-only client for the Device & Integration log store (/pos/logs).
import { api } from './client';
import type { LogEntryView } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)
export const posLogsApi = {
  list: (params?: { category?: string; severity?: string; source?: string; search?: string; limit?: number }) => api.get<{ logs: LogEntryView[] }>('/pos/logs', params as any),
};
export type { LogEntryView };
