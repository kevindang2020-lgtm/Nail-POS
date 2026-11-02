import { api } from './client';
import type { HelpArticleSummary, HelpSystemStatus } from '@aipowersalon/api-contracts/tenant';   // the wire contract (Constitution 13 §15)

// posHelpCenterApi — the LIVE /help backend that has existed server-side all along (articles + view counts, video
// guides, the full support-ticket system with SLA stats, real platform status, and the product-updates feed from
// migration 147). The Help Center screen previously carried a stale "nothing is wired up" note; these are the real
// endpoints. Nothing here is computed client-side.

export interface HelpVideoSummary { id: string; slug: string; title: string; description?: string | null; durationSeconds?: number; categoryLabel?: string | null; }
export interface HelpTicketStats { total: number; open: number; unassigned: number; awaitingFirstResponse: number; breached: number; byStatus: Record<string, number>; byPriority: Record<string, number>; }
export interface HelpTicketRow { id: string; subject: string; status: string; priority: string; createdAt?: string; }
export interface HelpProductUpdate { id: string; version?: string | null; title: string; category?: string | null; body?: string | null; publishedAt?: string; }

const toQuery = (q: Record<string, string>) => { const s = new URLSearchParams(q).toString(); return s ? `?${s}` : ''; };

export const posHelpCenterApi = {
  articles: (limit = 50) => api.get<HelpArticleSummary[]>(`/tenant/help/articles${toQuery({ limit: String(limit) })}`),
  videos: (limit = 24) => api.get<HelpVideoSummary[]>(`/tenant/help/videos${toQuery({ limit: String(limit) })}`),
  ticketStats: () => api.get<HelpTicketStats>(`/tenant/help/tickets/stats`),
  listTickets: () => api.get<HelpTicketRow[]>(`/tenant/help/tickets`),
  createTicket: (input: { subject: string; description?: string; priority?: string }) => api.post<HelpTicketRow>(`/tenant/help/tickets`, input as unknown as Record<string, unknown>),
  // Ticket attachments (Jul 29, 2026 — first frontend consumer; backend CRUD existed since the Support Center build).
  listAttachments: (ticketId: string) => api.get<{ id: string; fileName: string; contentType?: string; sizeBytes?: number }[]>(`/tenant/help/tickets/${encodeURIComponent(ticketId)}/attachments`),
  uploadAttachment: (ticketId: string, input: { fileName: string; contentType?: string; data: string }) => api.post<{ ok: boolean; id?: string; error?: string }>(`/tenant/help/tickets/${encodeURIComponent(ticketId)}/attachments`, input as unknown as Record<string, unknown>),
  downloadAttachment: (ticketId: string, attachmentId: string) => api.get<{ ok: boolean; fileName?: string; contentType?: string; data?: string; error?: string }>(`/tenant/help/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/download`),
  deleteAttachment: (ticketId: string, attachmentId: string) => api.post<{ ok: boolean }>(`/tenant/help/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/delete`, {}),
  status: () => api.get<HelpSystemStatus>(`/tenant/help/status`),
  updates: (limit = 6) => api.get<HelpProductUpdate[]>(`/tenant/help/updates${toQuery({ limit: String(limit) })}`),
};
export type { HelpArticleSummary, HelpSystemStatus };
