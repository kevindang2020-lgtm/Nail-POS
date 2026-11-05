// posCommunicationsApi.ts — unified inbox client. Reads tenant-scoped inbox state + conversation detail and drives the
// conversation (reply, mark read, assign, status). All endpoints guarded + tenant-scoped server-side.
import type { ActivityMetric } from '@aipowersalon/api-contracts/tenant';
export type { ActivityMetric };   // the API's own contract (Constitution 13 §15) — never re-declare it here
import { api } from './client';


export const posCommunicationsApi = {
  getState: (q?: Record<string, unknown>) => api.get<any>('/pos/communications/state', q),
  // Activity/volume metrics — each value carries `available`; a false one means the SOURCE is absent, not a zero.
  getActivity: (days = 30) => api.get<{
    windowDays: number;
    messagesSentToday: ActivityMetric; campaignDeliveryRatePct: ActivityMetric; aiCallsHandled: ActivityMetric;
    reviewRequestsSent: ActivityMetric; avgResponseMinutes: ActivityMetric; rebookingConversionPct: ActivityMetric;
  }>('/pos/communications/activity', { days }),
  getThread: (id: string) => api.get<any>(`/pos/communications/threads/${id}`),
  reply: (id: string, body: string) => api.post<any>(`/pos/communications/threads/${id}/reply`, { body }),
  markRead: (id: string) => api.post<any>(`/pos/communications/threads/${id}/read`),
  setStatus: (id: string, status: string) => api.post<any>(`/pos/communications/threads/${id}/status`, { status }),
  create: (body: Record<string, unknown>) => api.post<any>('/pos/communications/threads', body),
};
