// posAppointmentHistoryApi — Customers → Appointment History workspace (/pos/appointment-history/*). Appointment History SUNMI
// guide (Nov 9 2026): the six cards (over the table's filters), the salon-wide table (search · status · technician · which date +
// range · sort · pages), filter options and the read-only Check Appointment History System. A customer's own history (with the
// money details) is still posCustomersApi.appointments.
import { api } from './client';
import type { AhSummaryResponse, AhListResponse, AhCheckResponse } from '@aipowersalon/api-contracts/tenant';

export type AppointmentHistoryQuery = { q?: string; status?: string; technician?: string; dateField?: string; preset?: string; from?: string; to?: string; sort?: string; page?: number; pageSize?: number };
const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;
export const posAppointmentHistoryApi = {
  summary: (q: AppointmentHistoryQuery = {}) => { const { status: _s, sort: _o, page: _p, pageSize: _z, ...f } = q; return api.get<AhSummaryResponse>('/pos/appointment-history/summary', clean(f)); },
  list: (q: AppointmentHistoryQuery = {}) => api.get<AhListResponse>('/pos/appointment-history/appointments', clean(q)),
  options: () => api.get<{ technicians: { id: string; name: string }[] }>('/pos/appointment-history/options'),
  check: () => api.post<AhCheckResponse>('/pos/appointment-history/check', {}),
};
