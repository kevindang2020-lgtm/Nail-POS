// super-admin-tickets.kysely.repository.ts — cross-tenant, read-only reads over Postgres. No tenant scoping (Super Admin
// sees the whole platform); tenantId is an optional filter. Joins tenants to label each ticket. No status filter on history.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SuperAdminTicketsRepo, AdminTicketFilters, AdminTicketList, AdminTicketRow, AdminTicketDetail } from './super-admin-tickets.service';
import type { TicketHistoryLine, TicketHistoryRevision } from '@aipowersalon/checkout';

const iso = (v: any): string => (v == null ? '' : new Date(v).toISOString());
const isoOrNull = (v: any): string | null => (v == null ? null : new Date(v).toISOString());
const like = (s: string) => `%${s.replace(/[%_]/g, (m) => '\\' + m)}%`;

export class SuperAdminTicketsKyselyRepository implements SuperAdminTicketsRepo {
  constructor(private readonly db: Kysely<DB> | null) {}

  private baseFiltered(filters: AdminTicketFilters) {
    let qb: any = (this.db as any).selectFrom('tickets as t')
      .innerJoin('tenants as tn', 'tn.id', 't.tenant_id')
      .leftJoin('customers as c', 'c.id', 't.customer_id')
      .leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id');
    if (filters.tenantId) qb = qb.where('t.tenant_id', '=', filters.tenantId);
    if (filters.status) qb = qb.where('t.status', '=', filters.status);
    if (filters.search) qb = qb.where((eb: any) => eb.or([
      eb('t.ticket_number', 'ilike', like(filters.search!)),
      eb('c.full_name', 'ilike', like(filters.search!)),
      eb('tech.full_name', 'ilike', like(filters.search!)),
      eb('tn.display_name', 'ilike', like(filters.search!)),
    ]));
    if (filters.dateFrom) qb = qb.where('t.created_at', '>=', sql`((${filters.dateFrom})::date)::timestamp AT TIME ZONE ${filters.tz || 'UTC'}`);
    if (filters.dateTo) qb = qb.where('t.created_at', '<', sql`(((${filters.dateTo})::date) + 1)::timestamp AT TIME ZONE ${filters.tz || 'UTC'}`);
    return qb;
  }

  async list(filters: Required<Pick<AdminTicketFilters, 'page' | 'pageSize'>> & AdminTicketFilters): Promise<AdminTicketList> {
    if (!this.db) return { tickets: [], page: filters.page, pageSize: filters.pageSize, total: 0 };
    const total = await this.baseFiltered(filters).select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => Number(r?.c || 0)).catch(() => 0);
    const rows: any[] = await this.baseFiltered(filters)
      .select([
        't.id as id', 't.ticket_number as ticket_number', 't.tenant_id as tenant_id', 'tn.display_name as tenant_name', 't.status as status',
        'c.full_name as customer_name', 'tech.full_name as technician_name', 't.total_cents as total_cents', 't.version as version',
        't.service_done_locked_at as locked_at', 't.created_at as created_at', 't.paid_at as paid_at', 't.removed_at as removed_at',
      ])
      .orderBy('t.created_at', 'desc').limit(filters.pageSize).offset((filters.page - 1) * filters.pageSize).execute().catch(() => []);
    const tickets: AdminTicketRow[] = rows.map((r) => ({
      ticketId: r.id, ticketNumber: r.ticket_number ?? null, tenantId: r.tenant_id, tenantName: r.tenant_name ?? null, status: r.status,
      customerName: r.customer_name ?? null, technicianName: r.technician_name ?? null, totalCents: Number(r.total_cents ?? 0), version: Number(r.version ?? 0),
      serviceDoneLocked: !!r.locked_at, lockedAt: isoOrNull(r.locked_at), createdAt: iso(r.created_at), paidAt: isoOrNull(r.paid_at), removedAt: isoOrNull(r.removed_at),
    }));
    return { tickets, page: filters.page, pageSize: filters.pageSize, total };
  }

  async ticket(ticketId: string): Promise<AdminTicketDetail | null> {
    if (!this.db) return null;
    const r: any = await this.db.selectFrom('tickets as t')
      .innerJoin('tenants as tn', 'tn.id', 't.tenant_id')
      .leftJoin('customers as c', 'c.id', 't.customer_id')
      .leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id')
      .where('t.id', '=', ticketId)
      .select([
        't.id as id', 't.ticket_number as ticket_number', 't.tenant_id as tenant_id', 'tn.display_name as tenant_name', 't.status as status',
        'c.full_name as customer_name', 'tech.full_name as technician_name', 't.total_cents as total_cents', 't.version as version',
        't.subtotal_cents as subtotal_cents', 't.tax_cents as tax_cents', 't.discount_cents as discount_cents', 't.tip_cents as tip_cents',
        't.created_at as created_at', 't.serving_started_at as serving_started_at', 't.service_done_at as service_done_at', 't.paid_at as paid_at',
        't.service_done_locked_at as locked_at', 't.service_done_locked_by_user_id as locked_by', 't.service_done_locked_total_cents as locked_total', 't.removed_at as removed_at',
      ]).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    return {
      ticketId: r.id, ticketNumber: r.ticket_number ?? null, tenantId: r.tenant_id, tenantName: r.tenant_name ?? null, status: r.status,
      customerName: r.customer_name ?? null, technicianName: r.technician_name ?? null, totalCents: Number(r.total_cents ?? 0), version: Number(r.version ?? 0),
      serviceDoneLocked: !!r.locked_at, lockedAt: isoOrNull(r.locked_at), createdAt: iso(r.created_at), paidAt: isoOrNull(r.paid_at), removedAt: isoOrNull(r.removed_at),
      subtotalCents: Number(r.subtotal_cents ?? 0), taxCents: Number(r.tax_cents ?? 0), discountCents: Number(r.discount_cents ?? 0), tipCents: Number(r.tip_cents ?? 0),
      servingStartedAt: isoOrNull(r.serving_started_at), serviceDoneAt: isoOrNull(r.service_done_at), lockedByUserId: r.locked_by ?? null, lockedTotalCents: r.locked_total != null ? Number(r.locked_total) : null,
    };
  }

  async lines(ticketId: string): Promise<TicketHistoryLine[]> {
    if (!this.db) return [];
    const rows: any[] = await this.db.selectFrom('ticket_service_lines as l')
      .leftJoin('technicians as tech', 'tech.id', 'l.technician_id')
      .where('l.ticket_id', '=', ticketId)
      .select(['l.service_name_snapshot as name', 'l.price_cents_snapshot as price', 'l.line_total_cents as line_total', 'tech.full_name as technician_name', 'l.status as status', 'l.is_add_on as is_add_on'])
      .orderBy('l.created_at', 'asc').execute().catch(() => []);
    return rows.map((r) => ({ serviceName: r.name, priceCents: Number(r.price ?? 0), lineTotalCents: Number(r.line_total ?? 0), technicianName: r.technician_name ?? null, status: r.status, isAddOn: !!r.is_add_on }));
  }

  async revisions(ticketId: string): Promise<TicketHistoryRevision[]> {
    if (!this.db) return [];
    const rows: any[] = await this.db.selectFrom('ticket_revisions').where('ticket_id', '=', ticketId)
      .orderBy('version', 'asc').selectAll().execute().catch(() => []);
    return rows.map((r) => ({ version: Number(r.version), action: r.action, serviceLineId: r.service_line_id ?? null, actorUserId: r.actor_user_id ?? null, actorRole: r.actor_role ?? null, before: r.before, after: r.after, summary: r.summary ?? null, createdAt: iso(r.created_at) }));
  }

  async tenantTimezone(tenantId: string): Promise<string> {
    if (!this.db) return 'UTC';
    const row: any = await this.db.selectFrom('tenant_settings').select(['settings_json'])
      .where('tenant_id', '=', tenantId).where('category', '=', 'business-branch').where('branch_id', 'is', null)
      .executeTakeFirst().catch(() => undefined);
    const j = (row?.settings_json ?? {}) as { timezone?: string };
    return j.timezone || 'America/New_York';
  }
}
