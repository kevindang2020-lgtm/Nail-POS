// posAiCalendarApi — AI Center → AI Calendar (/pos/ai/calendar-center/*). AI Calendar Complete Build Guide: a read layer over
// canonical POS Booking — the four counters with their definitions, Day (12 technicians per page) / Week / Month / List views,
// server-side search and date bases, the appointment overlay, Check Calendar System and the Scheduling Assistant. There is
// no write route: a move is reviewed and confirmed through the Reception Copilot (posCopilotCenterApi.prepare / confirm).
import { api } from './client';
import type { AiCalendarPendingQueue, AiCalendarProvenanceReview } from '@aipowersalon/api-contracts/tenant';
const enc = encodeURIComponent;
const qs = (o: Record<string, unknown>) => { const p = Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${enc(k)}=${enc(String(v))}`); return p.length ? `?${p.join('&')}` : ''; };

export type AicView = 'day' | 'week' | 'month' | 'list';
export type AicListQuery = { q?: string; status?: string; source?: string; aiOnly?: boolean; technicianId?: string; basis?: string; period?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };

export const posAiCalendarApi = {
  summary: (date?: string) => api.get<any>(`/pos/ai/calendar-center/summary${qs({ date })}`),
  /** Pending Verification Queue (Extras · AI Calendar 04): live holds, soonest to expire first */
  pendingHolds: () => api.get<AiCalendarPendingQueue>(`/pos/ai/calendar-center/holds/pending`),
  /** AI booking provenance & exception review (Extras · AI Calendar 10): last 30 days, redacted, read-only */
  provenance: () => api.get<AiCalendarProvenanceReview>(`/pos/ai/calendar-center/provenance/exceptions`),
  day: (date?: string, techPage?: number) => api.get<any>(`/pos/ai/calendar-center/day${qs({ date, techPage })}`),
  range: (view: 'week' | 'month', date?: string) => api.get<any>(`/pos/ai/calendar-center/range${qs({ view, date })}`),
  list: (f: AicListQuery) => api.get<any>(`/pos/ai/calendar-center/appointments${qs(f)}`),
  detail: (id: string) => api.get<any>(`/pos/ai/calendar-center/appointments/${enc(id)}`),
  health: (date?: string) => api.post<any>(`/pos/ai/calendar-center/health${qs({ date })}`, {}),
  assistant: (date?: string) => api.get<any>(`/pos/ai/calendar-center/assistant${qs({ date })}`),
};
