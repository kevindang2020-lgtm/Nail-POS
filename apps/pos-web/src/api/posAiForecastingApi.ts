// posAiForecastingApi.ts — client for AI Analytics & Forecasting (/pos/ai-analytics/*). Server derives tenant/branch.
// All endpoints are READ-ONLY: statistical forecasts (appointments, revenue) and an operational no-show risk view.
import { api } from "./client";

export const posAiForecastingApi = {
  appointments: (horizonDays = 14) => api.get<any>(`/pos/ai-analytics/forecast/appointments`, { horizonDays }),
  revenue: (horizonDays = 14) => api.get<any>(`/pos/ai-analytics/forecast/revenue`, { horizonDays }),
  noShowRisk: (days = 7) => api.get<any>(`/pos/ai-analytics/no-show-risk`, { days }),
  accuracy: (domain: 'appointments' | 'revenue') => api.get<any>(`/pos/ai-analytics/accuracy`, { domain }),
  /** how much verified history each forecast has, the minimum and what is short (AI Analytics & Forecasting guide, Nov 2026) */
  readiness: () => api.get<any>(`/pos/ai-analytics/forecast/readiness`),
  /** forecast history, forecast vs actual, Check AI Analytics & Forecasting System (AI Analytics & Forecasting guide, Nov 2 2026) */
  center: {
    summary: () => api.get<any>(`/pos/ai-analytics/center/summary`),
    runs: (q: Record<string, string | number | undefined> = {}) => api.get<any>(`/pos/ai-analytics/center/runs`, Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '')) as Record<string, string | number>),
    run: (runId: string) => api.get<any>(`/pos/ai-analytics/center/run`, { runId }),
    check: () => api.post<any>(`/pos/ai-analytics/center/check`, {}),
  },
};
