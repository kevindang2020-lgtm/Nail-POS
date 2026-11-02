// posCustomerTimelineApi — AI Center → Customer Profile → Customer Timeline (/pos/customer-timeline/*). Customer Timeline guide
// (Nov 1 2026): one customer's source-linked events (family · date field + range · search · sort · pages 10/25/50/100,
// newest occurrence first), one event re-read from its source with its visit, and the read-only Check Customer Timeline
// System. Customer lookup and the 360° summary are Customer Search's (posCustomerSearchApi). Tenant / branch: the session.
import { api } from './client';
const enc = encodeURIComponent;
export type TimelineQuery = { q?: string; family?: string; technician?: string; dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posCustomerTimelineApi = {
  events: (customerId: string, q: TimelineQuery) => api.get<any>(`/pos/customer-timeline/customers/${enc(customerId)}/events`, clean(q)),
  event: (customerId: string, eventId: string) => api.get<any>(`/pos/customer-timeline/customers/${enc(customerId)}/events/${enc(eventId)}`),
  check: () => api.post<any>(`/pos/customer-timeline/check`, {}),
};
