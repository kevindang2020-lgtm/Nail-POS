// posRebookingApi — AI Center → Customer Profile → Rebooking (/pos/rebooking/*). Rebooking Opportunities guide (Nov 1 2026):
// the cards, the review queue (tab · search · service · technician · date dimension + range · sort · pages 10/25/50/100,
// newest first), the 360° overlay (audited), the review workflow (reviewed · deferred · reopened · note), the Booking
// Assistant handoff (prefill only — never an appointment), history and the read-only check. Refresh is the shared Customer
// Intelligence scan. Tenant / branch: the session.
import { api } from './client';
const enc = encodeURIComponent;
export type RebookingQuery = { q?: string; tab?: string; serviceId?: string; technicianId?: string; dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posRebookingApi = {
  summary: () => api.get<any>(`/pos/rebooking/summary`),
  customers: (q: RebookingQuery) => api.get<any>(`/pos/rebooking/customers`, clean(q)),
  customer: (id: string) => api.get<any>(`/pos/rebooking/customers/${enc(id)}`),
  review: (id: string, body: { action: string; note?: string; dueOn?: string; expectedVersion?: number }) => api.post<any>(`/pos/rebooking/customers/${enc(id)}/review`, clean(body)),
  handoff: (id: string, body: { serviceId?: string; technicianId?: string }) => api.post<any>(`/pos/rebooking/customers/${enc(id)}/handoff`, clean(body)),
  history: (q: { page?: number; pageSize?: number }) => api.get<any>(`/pos/rebooking/history`, clean(q)),
  check: () => api.post<any>(`/pos/rebooking/check`, {}),
  refresh: () => api.post<any>(`/pos/customer-intelligence/scan`, {}),
};

/** the Booking Assistant prefill handed from Rebooking to POS → Booking (session storage, one use, 10 minutes) */
export const BOOKING_HANDOFF_KEY = 'aps.bookingHandoff';
export type BookingHandoff = { source: 'rebooking'; customerId: string; customerName: string | null; customerPhone: string | null; serviceId: string | null; technicianId: string | null; technicianName: string | null; date: string; preparedAt: string };
export function storeBookingHandoff(h: BookingHandoff) { try { sessionStorage.setItem(BOOKING_HANDOFF_KEY, JSON.stringify(h)); } catch { /* storage unavailable: the Booking Assistant opens empty */ } }
export function takeBookingHandoff(now = Date.now()): BookingHandoff | null {
  try {
    const raw = sessionStorage.getItem(BOOKING_HANDOFF_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(BOOKING_HANDOFF_KEY);
    const h = JSON.parse(raw) as BookingHandoff;
    return h?.source === 'rebooking' && now - Date.parse(h.preparedAt) < 10 * 60_000 ? h : null;
  } catch { return null; }
}
