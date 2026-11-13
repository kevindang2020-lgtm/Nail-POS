// posTipsScreenApi.ts — Tips & Gratuity mandate (Oct 29 2026): the READ side of Payments → Tips (/pos/payments/tips*,
// pos.reports.view; export pos.reports.export). KPIs, lists and the distribution are computed on the server over the whole
// scope; lists page on the server. The ONE write (a reasoned re-allocation of a paid ticket's tip) is posPayrollApi.setTicketTip
// → POST /pos/tickets/:id/tip-allocation (tips.adjust), which the detail dialog calls.
import { api } from './client';
import type { TipsTechnicianEarningsResponse } from '@aipowersalon/api-contracts/tenant';
type Q = Record<string, unknown>;
const clean = (q: Q) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const B = '/pos/payments/tips';
export const posTipsScreenApi = {
  summary: (q: Q) => api.get<any>(`${B}/summary`, clean(q)),
  transactions: (q: Q) => api.get<any>(`${B}/transactions`, clean(q)),
  distribution: (q: Q) => api.get<any>(`${B}/distribution`, clean(q)),
  /** extras TIPS 01: one technician's earnings overlay (same period / basis as distribution) */
  technicianEarnings: (technicianId: string, q: Q) => api.get<TipsTechnicianEarningsResponse>(`${B}/technicians/${encodeURIComponent(technicianId)}/earnings`, clean(q)),
  technicians: () => api.get<{ id: string; name: string }[]>(`${B}/technicians`),
  adjustments: (q: Q) => api.get<any>(`${B}/adjustments`, clean(q)),
  detail: (ticketId: string) => api.get<any>(`${B}/${encodeURIComponent(ticketId)}/detail`),
  exportCsv: (q: Q) => api.exportAsync<string>(`${B}/export`, clean(q), 'text'),
};
