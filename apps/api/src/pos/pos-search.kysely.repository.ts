// pos-search.kysely.repository.ts — implements the SearchRepo PORT for PosSearchService. EVERY query is
// tenant-scoped server-side: `tenant_id = scope.tenantId` is applied unconditionally, and `branch_id`
// is applied for the current-location default (dropped only when the service passes branchId=null for an
// OWNER/MANAGER "all my authorized locations" search). The client never supplies tenant/branch — the
// service derives them from the session. All filters are parameterized (Kysely bindings); no raw text
// is concatenated into SQL. Any per-group failure returns [] (never leaks / never throws cross-tenant).
import { escapeLike } from '@aipowersalon/database';   // Security Deep Scan D8: wildcard-escaped LIKE input
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SearchRepo, Scope } from './pos-search.service';

type Row = { id: string; title: string; subtitle?: string; badge?: string; status?: string; route?: string; metadata?: Record<string, unknown> };
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');
const like = (s: string) => `%${escapeLike(s)}%`;
const money = (cents?: number | null) => (cents == null ? undefined : `$${(cents / 100).toFixed(2)}`);
// Vietnamese POS mandate WP-E (§40–§41): accent-insensitive name match. vi_fold() (migration 694) folds BOTH sides —
// the column through the trigram expression index on vi_fold(<name>), the query through the same SQL function — so
// "nguyen" finds "Nguyễn" and "dang" finds "Đặng". The raw ILIKE stays beside it (an exact-accent query still ranks
// first, and the old trigram index still serves it). Tenant / branch scoping is untouched: it is applied by scope().
// `col` is always a constant column reference built at the call site (sql.ref('<literal>')) — never request data.
type ColRef = ReturnType<typeof sql.ref>;
const foldedContains = (col: ColRef, q: string) => sql<boolean>`vi_fold(${col}) LIKE '%' || vi_fold(${escapeLike(q)}) || '%'`;
const foldedPrefix = (col: ColRef, q: string) => sql<boolean>`vi_fold(${col}) LIKE vi_fold(${escapeLike(q)}) || '%'`;

export class PosSearchKyselyRepository implements SearchRepo {
  constructor(private readonly db: Kysely<DB> | null) {}

  /** Apply the trusted tenant (+ optional branch) scope to ANY query builder. `alias` qualifies the
   * columns to the PRIMARY table so joined queries (which also expose customers.tenant_id) are never
   * ambiguous and can never match another tenant's rows. */
  private scope<QB extends { where: (...a: any[]) => QB }>(qb: QB, scope: Scope, alias?: string): QB {
    const tcol = alias ? `${alias}.tenant_id` : 'tenant_id';
    const bcol = alias ? `${alias}.branch_id` : 'branch_id';
    let out = qb.where(tcol, '=', scope.tenantId);
    if (scope.branchId) out = out.where(bcol, '=', scope.branchId);
    return out;
  }
  private db_(): Kysely<DB> | null { return this.db; }

  async customers(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    const digits = onlyDigits(q);
    try {
      const rows: any[] = await this.scope(db.selectFrom('customers'), scope, 'customers')
        .where((eb: any) => eb.or([
          eb('full_name', 'ilike', like(q)),
          foldedContains(sql.ref('full_name'), q),
          eb('email', 'ilike', like(q)),
          ...(digits.length >= 3 ? [eb('normalized_phone', 'ilike', like(digits))] : []),
        ]))
        .where('status', '!=', 'archived')
        .select(['id', 'full_name', 'phone_display', 'normalized_phone', 'email', 'status'])
        // the existing order (exact, then prefix, then the rest) with the accent-insensitive tier after each accented one
        .orderBy(sql`CASE WHEN lower(full_name) = lower(${q}) THEN 0 WHEN vi_fold(full_name) = vi_fold(${q}) THEN 1 WHEN full_name ILIKE ${q + '%'} THEN 2 WHEN ${foldedPrefix(sql.ref('full_name'), q)} THEN 3 ELSE 4 END`)
        .orderBy('full_name')
        .limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.full_name, subtitle: r.phone_display || r.normalized_phone || r.email || undefined, badge: r.status }));
    } catch { return []; }
  }

  async appointments(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    const digits = onlyDigits(q);
    try {
      const rows: any[] = await this.scope(db.selectFrom('pos_tech_appointments as a'), scope, 'a')
        .innerJoin('customers as c', 'c.id', 'a.customer_id')
        .where((eb: any) => eb.or([
          eb('c.full_name', 'ilike', like(q)),
          foldedContains(sql.ref('c.full_name'), q),
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
      const rows: any[] = await this.scope(db.selectFrom('services'), scope, 'services')
        .where((eb: any) => eb.or([eb('name', 'ilike', like(q)), foldedContains(sql.ref('name'), q)]))
        .select(['id', 'name', 'price_cents', 'status'])
        .orderBy(sql`CASE WHEN name ILIKE ${q + '%'} THEN 0 WHEN ${foldedPrefix(sql.ref('name'), q)} THEN 1 ELSE 2 END`).orderBy('name').limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.name, subtitle: money(r.price_cents), badge: r.status }));
    } catch { return []; }
  }

  async technicians(scope: Scope, q: string, limit: number): Promise<Row[]> {
    const db = this.db_(); if (!db) return [];
    const digits = onlyDigits(q);
    try {
      const rows: any[] = await this.scope(db.selectFrom('technicians'), scope, 'technicians')
        .where((eb: any) => eb.or([
          eb('full_name', 'ilike', like(q)),
          foldedContains(sql.ref('full_name'), q),
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
      const rows: any[] = await this.scope(db.selectFrom('tickets as t'), scope, 't')
        .innerJoin('customers as c', 'c.id', 't.customer_id')
        .leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id')
        .where((eb: any) => eb.or([
          eb('t.ticket_number', 'ilike', like(q)),
          eb('c.full_name', 'ilike', like(q)),
          foldedContains(sql.ref('c.full_name'), q),
          eb('tech.full_name', 'ilike', like(q)),
          foldedContains(sql.ref('tech.full_name'), q),
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
      const rows: any[] = await this.scope(db.selectFrom('receipts'), scope, 'receipts')
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
      const rows: any[] = await this.scope(db.selectFrom('pos_queue_items as qi'), scope, 'qi')
        .innerJoin('customers as c', 'c.id', 'qi.customer_id')
        .where((eb: any) => eb.or([
          eb('c.full_name', 'ilike', like(q)),
          foldedContains(sql.ref('c.full_name'), q),
          eb('qi.status', 'ilike', like(q)),
          ...(digits.length >= 3 ? [eb('c.normalized_phone', 'ilike', like(digits))] : []),
        ]))
        .select(['qi.id as id', 'c.full_name as full_name', 'qi.status as status'])
        .orderBy('qi.created_at', 'desc').limit(limit).execute();
      return rows.map((r) => ({ id: r.id, title: r.full_name, subtitle: r.status, badge: r.status }));
    } catch { return []; }
  }
}
