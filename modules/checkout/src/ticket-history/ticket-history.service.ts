// ticket-history.service.ts — permanent, status-agnostic ticket history (epic Req §9). Unlike the live Serving repo
// (which only loads tickets in serving/service_done), this reads a ticket and its append-only revision timeline for ANY
// status — completed, paid, cancelled, voided — so a ticket and its full edit history remain retrievable forever.
// Read-only. Tenant scoping is enforced in the repository (the client never supplies tenant/branch).

export interface TicketHistoryCtx { tenantId: string; branchId: string | null; userId: string; role: string; permissions: string[]; }
export class TicketHistoryError extends Error { constructor(msg: string) { super(msg); this.name = 'TicketHistoryError'; } }

export interface TicketHistoryLine { serviceName: string; priceCents: number; lineTotalCents: number; technicianName: string | null; status: string; isAddOn: boolean; }
export interface TicketHistoryRevision { version: number; action: string; serviceLineId: string | null; actorUserId: string | null; actorRole: string | null; before: unknown; after: unknown; summary: string | null; createdAt: string; }
export interface TicketHistorySummary {
  ticketId: string; ticketNumber: string | null; status: string; customerName: string | null; technicianName: string | null;
  subtotalCents: number; taxCents: number; discountCents: number; tipCents: number; totalCents: number; version: number;
  createdAt: string; servingStartedAt: string | null; serviceDoneAt: string | null; paidAt: string | null;
  serviceDoneLock: { lockedAt: string; lockedByUserId: string | null; lockedTotalCents: number | null } | null;
}
export interface TicketHistoryResult { ticket: TicketHistorySummary; lines: TicketHistoryLine[]; revisions: TicketHistoryRevision[]; }

export interface TicketHistoryRepo {
  getTicket(ctx: TicketHistoryCtx, ticketId: string): Promise<TicketHistorySummary | null>;
  getLines(ctx: TicketHistoryCtx, ticketId: string): Promise<TicketHistoryLine[]>;
  getRevisions(ctx: TicketHistoryCtx, ticketId: string): Promise<TicketHistoryRevision[]>;
}

export class TicketHistoryService {
  constructor(private readonly repo: TicketHistoryRepo) {}

  /** Full permanent history for one ticket, regardless of its current status. */
  async getHistory(ctx: TicketHistoryCtx, ticketId: string): Promise<TicketHistoryResult> {
    const id = String(ticketId ?? '').trim();
    if (!id) throw new TicketHistoryError('A ticket id is required.');
    const ticket = await this.repo.getTicket(ctx, id);
    if (!ticket) throw new TicketHistoryError('Ticket not found.');
    const [lines, revisions] = await Promise.all([this.repo.getLines(ctx, id), this.repo.getRevisions(ctx, id)]);
    return { ticket, lines, revisions };
  }
}
