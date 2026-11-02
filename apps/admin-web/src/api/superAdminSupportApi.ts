import { api } from './client';
import type { SupportOverview } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)


export const superAdminSupportApi = {
  dashboard: (params?: { category?: string; priority?: string; slaStatus?: string; agent?: string }) => api.get<{ ok: true } & SupportOverview>('/super-admin/support/overview', params as Record<string, unknown> | undefined),
  createTicket: (body: { tenantId: string; branchId?: string | null; subject: string; description?: string; category?: string; priority?: string }) => api.post<{ ok: boolean; error?: string; ticket?: { ticketNumber?: string } }>('/super-admin/support/tickets', body),
  ticketDetail: (id: string) => api.get<SupportTicketDetail>(`/super-admin/support/tickets/${id}`),
  reply: (id: string, body: string) => api.post<{ ok: boolean; error?: string }>(`/super-admin/support/tickets/${id}/reply`, { body }),
  setTicketStatus: (id: string, to: string, note?: string) => api.post<{ ok: boolean; error?: string }>(`/super-admin/support/tickets/${id}/status`, { to, note }),
  addInternalNote: (id: string, body: string) => api.post<{ ok: boolean; error?: string }>(`/super-admin/support/tickets/${id}/internal-note`, { body }),
};

export interface SupportTicketDetail {
  ok: boolean; error?: string;
  ticket?: { id: string; ticketNumber: string; tenant: string | null; tenantId: string; subject: string; description: string | null; category: string; priority: string; status: string; assignedAgent: string | null; csatScore: number | null; createdAt: string; updatedAt: string };
  conversation?: { id: string; authorKind: string; body: string; createdAt: string }[];
  events?: { id: string; kind: string; detail: string | null; createdAt: string }[];
}
export type { SupportOverview };
