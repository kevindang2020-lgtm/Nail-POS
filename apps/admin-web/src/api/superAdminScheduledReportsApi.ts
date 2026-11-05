// superAdminScheduledReportsApi.ts — typed client for Super Admin scheduled reports.

import { useCallback, useEffect, useState } from 'react';
import { api } from './client';
import { downloadExport } from './superAdminAnalyticsApi';
import type { ScheduleFormat, ScheduleFrequency, ScheduleSource } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

export type ScheduleRange = '7d' | '30d' | '90d' | '6m' | '12m';

export type Schedule = {
  id: string; name: string; source: ScheduleSource; reportDefinitionId: string | null; format: ScheduleFormat;
  rangeKey: ScheduleRange; scopeTenantId: string | null; frequency: ScheduleFrequency; recipients: string[];
  deliveryMethod: 'in_app'; enabled: boolean; nextRunAt: string; lastRunAt: string | null;
  createdByUserId: string | null; createdAt: string; updatedAt: string;
};
export type ScheduleRun = { id: string; scheduleId: string; status: 'success' | 'error'; format: string; filename: string | null; byteSize: number; error: string | null; trigger: 'run_due' | 'manual'; createdAt: string };
export type CreateScheduleBody = { name: string; source: ScheduleSource; reportDefinitionId?: string | null; format: ScheduleFormat; range: ScheduleRange; tenantId?: string | null; frequency: ScheduleFrequency; recipients: string[] };

export const scheduledReportsApi = {
  list: () => api.get<Schedule[]>('/super-admin/scheduled-reports'),
  create: (body: CreateScheduleBody) => api.post<Schedule>('/super-admin/scheduled-reports', body),
  update: (id: string, body: Partial<CreateScheduleBody & { enabled: boolean }>) => api.patch<Schedule>(`/super-admin/scheduled-reports/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.del<{ ok: true }>(`/super-admin/scheduled-reports/${encodeURIComponent(id)}`),
  runs: (id: string) => api.get<ScheduleRun[]>(`/super-admin/scheduled-reports/${encodeURIComponent(id)}/runs`),
  runNow: (id: string) => api.post<{ scheduleId: string; runId: string; status: string; filename?: string; error?: string }>(`/super-admin/scheduled-reports/${encodeURIComponent(id)}/run-now`, {}),
  runDue: () => api.post<{ ranAt: string; dueCount: number; results: any[] }>('/super-admin/scheduled-reports/run-due', {}),
  download: async (runId: string) => downloadExport(await api.get<{ filename: string; mimeType: string; base64: string }>(`/super-admin/scheduled-reports/runs/${encodeURIComponent(runId)}/download`)),
};

export function useScheduledReports() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setSchedules(await scheduledReportsApi.list()); }
    catch (e: any) { setError(e?.message || 'Failed to load schedules.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { schedules, loading, error, reload };
}
export type { ScheduleFormat, ScheduleFrequency, ScheduleSource };
