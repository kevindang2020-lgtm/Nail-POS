// posOverviewApi.ts — POS Overview client.
//  • getOverview(): rich PosOverviewResponse from /pos/overview/state (KPIs+trends, schedule, walk-ins, analytics).
//  • getBoard():    supplemental modules from /pos/overview/board (communications, retention, inventory).
//  • getState():    legacy flat summary projection (kept for back-compat with any other caller).
import { api } from './client';
export const posOverviewApi = {
  getOverview: (date?: string) => api.get<any>('/pos/overview/state' + (date ? `?date=${encodeURIComponent(date)}` : '')),
  getBoard: () => api.get<any>('/pos/overview/board'),
  getState: () => api.get('/pos/overview/state?shape=summary'),
};
