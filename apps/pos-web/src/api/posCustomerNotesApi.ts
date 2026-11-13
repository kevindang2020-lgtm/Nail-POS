// posCustomerNotesApi — Customers → Customer Notes workspace (/pos/customer-notes/*). Customer Notes SUNMI guide (Nov 9 2026):
// the four cards, the salon-wide notes table (search · category · review · which date + range · sort · pages), one customer's
// notes with their review history, the Review & Accuracy step for safety notes and the read-only Check Customer Notes System.
// The note text itself is still saved through posCustomersApi.setNotes (PATCH /pos/customers/:id/notes).
import { api } from './client';
import type { CnSummaryResponse, CnListResponse, CnDetailResponse, CnCheckResponse } from '@aipowersalon/api-contracts/tenant';

export type CustomerNotesQuery = { q?: string; category?: string; review?: string; dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posCustomerNotesApi = {
  summary: () => api.get<CnSummaryResponse>('/pos/customer-notes/summary'),
  list: (q: CustomerNotesQuery = {}) => api.get<CnListResponse>('/pos/customer-notes/notes', clean(q)),
  /** Customer Notes 01: an optional visit (ticketId) ranks the notes for it; without one the session's branch + technician do */
  detail: (customerId: string, ticketId?: string) => api.get<CnDetailResponse>('/pos/customer-notes/notes/detail', ticketId ? { customerId, ticketId } : { customerId }),
  review: (b: { customerId: string; category: 'allergy' | 'warning'; contentHash: string; decision: 'confirmed' | 'needs_correction'; reason?: string | null }) =>
    api.post<CnDetailResponse>('/pos/customer-notes/review', b),
  check: () => api.post<CnCheckResponse>('/pos/customer-notes/check', {}),
};
