// posAiForecastingApi.ts — client for AI Analytics & Forecasting (/pos/ai-analytics/*). Server derives tenant/branch.
// All endpoints are READ-ONLY: statistical forecasts (appointments, revenue) and an operational no-show risk view.
import { api } from "./client";

export const posAiForecastingApi = {
  appointments: (horizonDays = 14) => api.get<any>(`/pos/ai-analytics/forecast/appointments`, { horizonDays }),
  revenue: (horizonDays = 14) => api.get<any>(`/pos/ai-analytics/forecast/revenue`, { horizonDays }),
  noShowRisk: (days = 7) => api.get<any>(`/pos/ai-analytics/no-show-risk`, { days }),
  accuracy: (domain: 'appointments' | 'revenue') => api.get<any>(`/pos/ai-analytics/accuracy`, { domain }),
};
