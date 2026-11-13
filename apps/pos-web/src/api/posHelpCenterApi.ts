import { api } from './client';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import type { HelpArticleSummary, HelpSystemStatus } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)

// posHelpCenterApi — the LIVE /help backend that has existed server-side all along (articles + view counts, video
// guides, the full support-ticket system with SLA stats, real platform status, and the product-updates feed from
// migration 147). The Help Center screen previously carried a stale "nothing is wired up" note; these are the real
// endpoints. Nothing here is computed client-side.

export interface HelpVideoSummary { id: string; slug: string; title: string; description?: string | null; durationSeconds?: number; categoryLabel?: string | null; }
export interface HelpTicketStats { total: number; open: number; unassigned: number; awaitingFirstResponse: number; breached: number; byStatus: Record<string, number>; byPriority: Record<string, number>; }
export interface HelpTicketRow { id: string; subject: string; status: string; priority: string; createdAt?: string; ticketNumber?: string; }
/** the create answer as the service returns it */
type HelpTicketCreateAnswer = { ok: boolean; error?: string; ticket?: HelpTicketRow } | HelpTicketRow;
export interface HelpProductUpdate { id: string; version?: string | null; title: string; category?: string | null; body?: string | null; publishedAt?: string; }

const toQuery = (q: Record<string, string>) => { const s = new URLSearchParams(q).toString(); return s ? `?${s}` : ''; };

export const posHelpCenterApi = {
  articles: (limit = 50) => api.get<HelpArticleSummary[]>(`/tenant/help/articles${toQuery({ limit: String(limit) })}`),
  videos: (limit = 24) => api.get<HelpVideoSummary[]>(`/tenant/help/videos${toQuery({ limit: String(limit) })}`),
  ticketStats: () => api.get<HelpTicketStats>(`/tenant/help/tickets/stats`),
  listTickets: () => api.get<HelpTicketRow[]>(`/tenant/help/tickets`),
  // POST /tenant/help/tickets answers { ok, ticket } or { ok: false, error } (support-tickets.service createTicket) — the row
  // is unwrapped here and a refusal is thrown, so no caller shows "submitted" for a ticket that was never created.
  createTicket: async (input: { subject: string; description?: string; priority?: string; category?: string; affectedModule?: string; idempotencyKey?: string }): Promise<HelpTicketRow> => {
    const r = await api.post<HelpTicketCreateAnswer>(`/tenant/help/tickets`, input as unknown as Record<string, unknown>);
    if (r && typeof r === 'object' && 'ok' in r) {
      if (r.ok === false || !r.ticket) throw Object.assign(new Error(t('pos.the_ticket_could_not_be_submitted')), { code: r.error ?? 'create_failed' });
      return r.ticket;
    }
    return r as HelpTicketRow;
  },
  // Ticket attachments (Jul 29, 2026 — first frontend consumer; backend CRUD existed since the Support Center build).
  listAttachments: (ticketId: string) => api.get<{ id: string; fileName: string; contentType?: string; sizeBytes?: number }[]>(`/tenant/help/tickets/${encodeURIComponent(ticketId)}/attachments`),
  uploadAttachment: (ticketId: string, input: { fileName: string; contentType?: string; data: string }) => api.post<{ ok: boolean; id?: string; error?: string }>(`/tenant/help/tickets/${encodeURIComponent(ticketId)}/attachments`, input as unknown as Record<string, unknown>),
  downloadAttachment: (ticketId: string, attachmentId: string) => api.get<{ ok: boolean; fileName?: string; contentType?: string; data?: string; error?: string }>(`/tenant/help/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/download`),
  deleteAttachment: (ticketId: string, attachmentId: string) => api.post<{ ok: boolean }>(`/tenant/help/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/delete`, {}),
  status: () => api.get<HelpSystemStatus>(`/tenant/help/status`),
  updates: (limit = 6) => api.get<HelpProductUpdate[]>(`/tenant/help/updates${toQuery({ limit: String(limit) })}`),
};
export type { HelpArticleSummary, HelpSystemStatus };
