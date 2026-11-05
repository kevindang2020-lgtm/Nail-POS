// ticket-history.kysely.repository.ts — status-agnostic reads over Postgres. EVERY query is tenant-scoped
// (`tenant_id = ctx.tenantId`, plus branch when the ctx carries one). No status filter — terminal tickets stay readable.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TicketHistoryRepo, TicketHistoryCtx, TicketHistorySummary, TicketHistoryLine, TicketHistoryRevision } from './ticket-history.service';

const iso = (v: any): string => (v == null ? '' : new Date(v).toISOString());
const isoOrNull = (v: any): string | null => (v == null ? null : new Date(v).toISOString());

export class TicketHistoryKyselyRepository implements TicketHistoryRepo {
  constructor(private readonly db: Kysely<DB> | null) {}

  private scope<QB extends { where: (...a: any[]) => QB }>(qb: QB, ctx: TicketHistoryCtx, alias?: string): QB {
    const col = (n: string) => (alias ? `${alias}.${n}` : n);
    let out = qb.where(col('tenant_id') as any, '=', ctx.tenantId as any);
    if (ctx.branchId) out = out.where(col('branch_id') as any, '=', ctx.branchId as any);
    return out;
  }

  async getTicket(ctx: TicketHistoryCtx, ticketId: string): Promise<TicketHistorySummary | null> {
    if (!this.db) return null;
    const r: any = await this.scope(this.db.selectFrom('tickets as t'), ctx, 't')
      .leftJoin('customers as c', 'c.id', 't.customer_id')
      .leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id')
      .where('t.id', '=', ticketId)
      .select([
        't.id as id', 't.ticket_number as ticket_number', 't.status as status', 'c.full_name as customer_name', 'tech.full_name as technician_name',
        't.subtotal_cents as subtotal_cents', 't.tax_cents as tax_cents', 't.discount_cents as discount_cents', 't.tip_cents as tip_cents', 't.total_cents as total_cents', 't.version as version',
        't.created_at as created_at', 't.serving_started_at as serving_started_at', 't.service_done_at as service_done_at', 't.paid_at as paid_at',
        't.service_done_locked_at as locked_at', 't.service_done_locked_by_user_id as locked_by', 't.service_done_locked_total_cents as locked_total',
      ]).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    return {
      ticketId: r.id, ticketNumber: r.ticket_number ?? null, status: r.status, customerName: r.customer_name ?? null, technicianName: r.technician_name ?? null,
      subtotalCents: Number(r.subtotal_cents ?? 0), taxCents: Number(r.tax_cents ?? 0), discountCents: Number(r.discount_cents ?? 0), tipCents: Number(r.tip_cents ?? 0), totalCents: Number(r.total_cents ?? 0), version: Number(r.version ?? 0),
      createdAt: iso(r.created_at), servingStartedAt: isoOrNull(r.serving_started_at), serviceDoneAt: isoOrNull(r.service_done_at), paidAt: isoOrNull(r.paid_at),
      serviceDoneLock: r.locked_at ? { lockedAt: iso(r.locked_at), lockedByUserId: r.locked_by ?? null, lockedTotalCents: r.locked_total != null ? Number(r.locked_total) : null } : null,
    };
  }

  async getLines(ctx: TicketHistoryCtx, ticketId: string): Promise<TicketHistoryLine[]> {
    if (!this.db) return [];
    const rows: any[] = await this.scope(this.db.selectFrom('ticket_service_lines as l'), ctx, 'l')
      .leftJoin('technicians as tech', 'tech.id', 'l.technician_id')
      .where('l.ticket_id', '=', ticketId)
      .select(['l.service_name_snapshot as name', 'l.price_cents_snapshot as price', 'l.line_total_cents as line_total', 'tech.full_name as technician_name', 'l.status as status', 'l.is_add_on as is_add_on'])
      .orderBy('l.created_at', 'asc').execute().catch(() => []);
    return rows.map((r) => ({ serviceName: r.name, priceCents: Number(r.price ?? 0), lineTotalCents: Number(r.line_total ?? 0), technicianName: r.technician_name ?? null, status: r.status, isAddOn: !!r.is_add_on }));
  }

  async getRevisions(ctx: TicketHistoryCtx, ticketId: string): Promise<TicketHistoryRevision[]> {
    if (!this.db) return [];
    const rows: any[] = await this.db.selectFrom('ticket_revisions').where('ticket_id', '=', ticketId).where('tenant_id', '=', ctx.tenantId)
      .orderBy('version', 'asc').selectAll().execute().catch(() => []);
    return rows.map((r) => ({ version: Number(r.version), action: r.action, serviceLineId: r.service_line_id ?? null, actorUserId: r.actor_user_id ?? null, actorRole: r.actor_role ?? null, before: r.before, after: r.after, summary: r.summary ?? null, createdAt: iso(r.created_at) }));
  }
}
