// super-admin-tickets.service.ts — platform-wide, READ-ONLY ticket oversight (epic Req §10). Behind SuperAdminGuard.
// Reuses the Phase 4/5/6 foundations: the append-only revision timeline, the Service Done lock, and the ticket snapshot —
// but cross-tenant (no tenant scoping; tenant is shown and can be used as a filter). No mutation paths exist here.
import type { TicketHistoryLine, TicketHistoryRevision } from '@aipowersalon/checkout';

export interface AdminCtx { userId?: string; email?: string; ip?: string }
export class SuperAdminTicketsError extends Error { constructor(public code: 'not_found' | 'invalid', msg: string) { super(msg); this.name = 'SuperAdminTicketsError'; } }

export interface AdminTicketFilters { tenantId?: string; status?: string; search?: string; dateFrom?: string; dateTo?: string; tz?: string; page?: number; pageSize?: number; }
export interface AdminTicketRow {
  ticketId: string; ticketNumber: string | null; tenantId: string; tenantName: string | null; status: string;
  customerName: string | null; technicianName: string | null; totalCents: number; version: number;
  serviceDoneLocked: boolean; lockedAt: string | null; createdAt: string; paidAt: string | null; removedAt: string | null;
}
export interface AdminTicketList { tickets: AdminTicketRow[]; page: number; pageSize: number; total: number; }
export interface AdminTicketDetail extends AdminTicketRow {
  subtotalCents: number; taxCents: number; discountCents: number; tipCents: number;
  servingStartedAt: string | null; serviceDoneAt: string | null; lockedByUserId: string | null; lockedTotalCents: number | null;
}
export interface AdminTicketHistory { ticket: AdminTicketDetail; lines: TicketHistoryLine[]; revisions: TicketHistoryRevision[]; }

export interface SuperAdminTicketsRepo {
  list(filters: Required<Pick<AdminTicketFilters, 'page' | 'pageSize'>> & AdminTicketFilters): Promise<AdminTicketList>;
  ticket(ticketId: string): Promise<AdminTicketDetail | null>;
  lines(ticketId: string): Promise<TicketHistoryLine[]>;
  revisions(ticketId: string): Promise<TicketHistoryRevision[]>;
  tenantTimezone?(tenantId: string): Promise<string>;
}

export class SuperAdminTicketsService {
  constructor(private readonly repo: SuperAdminTicketsRepo) {}

  /** Platform-wide ticket list (read-only), optionally filtered by tenant/status/search. */
  async listTickets(_ctx: AdminCtx, filters: AdminTicketFilters = {}): Promise<AdminTicketList> {
    const page = Math.max(1, Number(filters.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize) || 25));
    const search = typeof filters.search === 'string' ? filters.search.trim().slice(0, 80) : undefined;
    const ymd = (s?: string) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
    const df = ymd(filters.dateFrom); const dt = ymd(filters.dateTo);
    // Cross-tenant: a local day is only well-defined when scoped to one tenant — otherwise fall back to UTC.
    const tz = (df || dt) ? (filters.tenantId && this.repo.tenantTimezone ? await this.repo.tenantTimezone(filters.tenantId) : 'UTC') : undefined;
    return this.repo.list({ tenantId: filters.tenantId || undefined, status: filters.status || undefined, search: search || undefined, dateFrom: df, dateTo: dt, tz, page, pageSize });
  }

  /** Full read-only history for ANY ticket across ANY tenant: snapshot + lines + the append-only revision timeline. */
  async ticketHistory(_ctx: AdminCtx, ticketId: string): Promise<AdminTicketHistory> {
    const id = String(ticketId ?? '').trim();
    if (!id) throw new SuperAdminTicketsError('invalid', 'A ticket id is required.');
    const ticket = await this.repo.ticket(id);
    if (!ticket) throw new SuperAdminTicketsError('not_found', 'Ticket not found.');
    const [lines, revisions] = await Promise.all([this.repo.lines(id), this.repo.revisions(id)]);
    return { ticket, lines, revisions };
  }
}
