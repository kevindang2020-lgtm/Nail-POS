// pos-search.kysely.repository.ts — implements the SearchRepo PORT for PosSearchService. EVERY query is
// tenant-scoped server-side: `tenant_id = scope.tenantId` is applied unconditionally, and `branch_id`
// is applied for the current-location default (dropped only when the service passes branchId=null for an
// OWNER/MANAGER "all my authorized locations" search). The client never supplies tenant/branch — the
// service derives them from the session. All filters are parameterized (Kysely bindings); no raw text
// is concatenated into SQL. Any per-group failure returns [] (never leaks / never throws cross-tenant).
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SearchRepo, Scope } from './pos-search.service';

type Row = { id: string; title: string; subtitle?: string; badge?: string; status?: string; route?: string; metadata?: Record<string, unknown> };
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');
const like = (s: string) => `%${s.replace(/[%_]/g, (m) => '\\' + m)}%`;
const money = (cents?: number | null) => (cents == null ? undefined : `$${(cents / 100).toFixed(2)}`);

export class PosSearchKyselyRepository implements SearchRepo {
  constructor(private readonly db: Kysely<DB> | null) {}

  /** Apply the trusted tenant (+ optional branch) scope to ANY query builder. `alias` qualifies the
   * columns to the PRIMARY table so joined queries (which also expose customers.tenant_id) are never
   * ambiguous and can never match another tenant's rows. */
  private scope<QB extends { where: (...a: any[]) => QB }>(qb: QB, scope: Scope, alias?: string): QB {
    const tcol = alias ? `${alias}.tenant_id` : 'tenant_id';
    const bcol = alias ? `${alias}.branch_id` : 'branch_id';
    let out = qb.where(tcol as any, '=', scope.tenantId as any);
    if (scope.branchId) out = out.where(bcol as any, '=', scope.branchId as any);
    return out;
  }
  private db_(): Kysely<DB> | null { return this.db; }

  async customers(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    const digits = onlyDigits(q);
    try {
      const rows: any[] = await this.scope((db as any).selectFrom('customers'), scope, 'customers')
        .where((eb: any) => eb.or([
          eb('full_name', 'ilike', like(q)),
          eb('email', 'ilike', like(q)),
          ...(digits.length >= 3 ? [eb('normalized_phone', 'ilike', like(digits))] : []),
        ]))
        .where('status', '!=', 'archived')
        .select(['id', 'full_name', 'phone_display', 'normalized_phone', 'email', 'status'])
        .orderBy(sql`CASE WHEN lower(full_name) = lower(${q}) THEN 0 WHEN full_name ILIKE ${q + '%'} THEN 1 ELSE 2 END`)
        .orderBy('full_name')
        .limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.full_name, subtitle: r.phone_display || r.normalized_phone || r.email || undefined, badge: r.status }));
    } catch { return []; }
  }

  async appointments(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    const digits = onlyDigits(q);
    try {
      const rows: any[] = await this.scope((db as any).selectFrom('pos_tech_appointments as a'), scope, 'a')
        .innerJoin('customers as c', 'c.id', 'a.customer_id')
        .where((eb: any) => eb.or([
          eb('c.full_name', 'ilike', like(q)),
          eb('a.status', 'ilike', like(q)),
          ...(digits.length >= 3 ? [eb('c.normalized_phone', 'ilike', like(digits))] : []),
        ]))
        .select(['a.id as id', 'c.full_name as full_name', 'a.start_time as start_time', 'a.status as status'])
        .orderBy('a.start_time', 'desc').limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.full_name, subtitle: [r.start_time ? new Date(r.start_time).toLocaleString() : null, r.status].filter(Boolean).join(' · '), badge: r.status, status: r.status }));
    } catch { return []; }
  }

  async services(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    try {
      const rows: any[] = await this.scope((db as any).selectFrom('services'), scope, 'services')
        .where('name', 'ilike', like(q))
        .select(['id', 'name', 'price_cents', 'status'])
        .orderBy(sql`CASE WHEN name ILIKE ${q + '%'} THEN 0 ELSE 1 END`).orderBy('name').limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.name, subtitle: money(r.price_cents), badge: r.status }));
    } catch { return []; }
  }

  async technicians(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    const digits = onlyDigits(q);
    try {
      const rows: any[] = await this.scope((db as any).selectFrom('technicians'), scope, 'technicians')
        .where((eb: any) => eb.or([
          eb('full_name', 'ilike', like(q)),
          eb('email', 'ilike', like(q)),
          ...(digits.length >= 3 ? [eb('normalized_phone', 'ilike', like(digits))] : []),
        ]))
        .select(['id', 'full_name', 'phone_display', 'email', 'status'])
        .orderBy('full_name').limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.full_name, subtitle: r.email || r.phone_display || undefined, badge: r.status }));
    } catch { return []; }
  }

  async tickets(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    try {
      const rows: any[] = await this.scope((db as any).selectFrom('tickets as t'), scope, 't')
        .innerJoin('customers as c', 'c.id', 't.customer_id')
        .leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id')
        .where((eb: any) => eb.or([
          eb('t.ticket_number', 'ilike', like(q)),
          eb('c.full_name', 'ilike', like(q)),
          eb('tech.full_name', 'ilike', like(q)),
          eb('t.status', 'ilike', like(q)),
        ]))
        .select(['t.id as id', 't.ticket_number as ticket_number', 'c.full_name as full_name', 't.total_cents as total_cents', 't.status as status'])
        .orderBy('t.created_at', 'desc').limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.ticket_number ? `Ticket ${r.ticket_number}` : 'Ticket', subtitle: [r.full_name, money(r.total_cents)].filter(Boolean).join(' · '), badge: r.status, status: r.status }));
    } catch { return []; }
  }

  async receipts(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    try {
      const rows: any[] = await this.scope((db as any).selectFrom('receipts'), scope, 'receipts')
        .where('receipt_number', 'ilike', like(q))
        .select(['id', 'receipt_number', 'total_cents', 'created_at'])
        .orderBy('created_at', 'desc').limit(limit).execute();
      // Safe fields only — never card/token/gateway data.
      return rows.map((r) => ({ id: r.id, title: r.receipt_number ? `Receipt ${r.receipt_number}` : 'Receipt', subtitle: money(r.total_cents), badge: undefined }));
    } catch { return []; }
  }

  async queue(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    const digits = onlyDigits(q);
    try {
      const rows: any[] = await this.scope((db as any).selectFrom('pos_queue_items as qi'), scope, 'qi')
        .innerJoin('customers as c', 'c.id', 'qi.customer_id')
        .where((eb: any) => eb.or([
          eb('c.full_name', 'ilike', like(q)),
          eb('qi.status', 'ilike', like(q)),
          ...(digits.length >= 3 ? [eb('c.normalized_phone', 'ilike', like(digits))] : []),
        ]))
        .select(['qi.id as id', 'c.full_name as full_name', 'qi.status as status'])
        .orderBy('qi.created_at', 'desc').limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.full_name, subtitle: r.status, badge: r.status }));
    } catch { return []; }
  }
}
