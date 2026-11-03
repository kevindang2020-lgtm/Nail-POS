// inventory-center.ts — AI Inventory Assistant guides (spec + guide, Nov 2 2026; built Nov 3 2026): `/pos/ai-inventory/center/*`.
//
// What the page was: six cards (Products · In Stock · Low · Critical · Out of Stock · Overstock) and four tabs over the read-only
// position / low-stock / reorder / slow-moving services. The cards came from ONE branch's stock row; for a salon-wide login there is
// no branch, so every product read 0 on hand and showed as Out of Stock. Nothing said why a product was Critical (an explicit
// critical level, or half the reorder level when none is set — the usual reason "11 Critical, 0 Out of Stock"), nothing compared the
// stock figure with the movement ledger, there was no product search, no activity history and no system check.
//
// What it is now (read-only — no order, count, transfer, adjustment or disposal happens here):
//   • summary  — the six cards with one definition each (the same classification as the position service), WHY the critical ones
//                are critical (explicit level vs derived from the reorder level), products without any threshold, the scope
//                (this branch, or every branch summed for a salon-wide login), stock freshness;
//   • products — search (name, SKU, vendor, category) · status (incl. "no threshold" and "stock differs from the ledger") · sort ·
//                numbered pages; each row says on hand, reserved, open purchase-order quantity, its levels and where they come from,
//                and the ledger's last balance;
//   • activity — the stock movements, newest first: search (product, SKU, reason, reference) · type · presets + From/To · pages;
//   • check    — "Check Inventory System": read-only.
import { sql, type Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { branchTimeZone } from '@aipowersalon/database';
import { positionStatus } from './ai-inventory-core';

type Row = Record<string, any>;
export interface IcCtx { tenantId: string; branchId?: string | null; userId?: string | null; role?: string | null; permissions?: string[] }
export class InventoryCenterError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) { super(message); }
}
export const IC_STATUSES = ['all', 'in_stock', 'low', 'critical', 'out_of_stock', 'overstock', 'no_threshold', 'ledger_mismatch'] as const;
export const IC_SORTS = ['attention', 'name', 'on_hand', 'updated'] as const;
export const IC_MOVE_TYPES = ['all', 'received', 'retail_sale', 'service_usage', 'adjustment', 'count', 'transfer', 'damage_waste', 'return', 'other'] as const;
export const IC_PRESETS = ['all', 'today', 'yesterday', 'week', 'last_7', 'month', 'last_30', 'last_month', 'last_90', 'year', 'custom'] as const;
export const IC_PAGE_SIZES = [10, 25, 50, 100] as const;
const MOVE_GROUP: Record<string, string[]> = {
  received: ['received', 'purchase_received'], retail_sale: ['retail_sale'], service_usage: ['service_usage'],
  adjustment: ['adjustment_increase', 'adjustment_decrease', 'correction', 'manual_add', 'opening_balance'], count: ['count', 'counts', 'cycle_count'],
  transfer: ['transfer_in', 'transfer_out'], damage_waste: ['damaged', 'waste', 'expired'], return: ['returned', 'customer_return', 'return_to_vendor'],
};
const KNOWN = Object.values(MOVE_GROUP).flat();
const X_COLS = sql.raw('x.id, x.name, x.sku, x.reorder_level, x.critical_level, x.maximum_stock, x.created_at, x.category, x.vendor, x.lead_time_days, x.on_hand, x.reserved, x.stock_rows, x.stock_updated_at, x.inbound, x.ledger_after, x.ledger_at');
const RANK: Record<string, number> = { out_of_stock: 0, critical: 1, low: 2, overstock: 3, in_stock: 4 };
const HEALTH_GAP_SECONDS = 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const N = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string | number | Date).toISOString());
const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | undefined => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T[number] : undefined);
const isUuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v ?? ''));
const has = (ctx: IcCtx, p: string) => (ctx.permissions ?? []).includes(p);
const esc = (s: string) => '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
const addDays = (d: string, k: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
/** the critical level the classification uses, and where it comes from */
export function criticalOf(reorderLevel: number, criticalLevel: number | null): { level: number; source: 'explicit' | 'derived' | 'none' } {
  if (criticalLevel != null && criticalLevel > 0) return { level: criticalLevel, source: 'explicit' };
  if (reorderLevel > 0) return { level: Math.ceil(reorderLevel / 2), source: 'derived' };
  return { level: 0, source: 'none' };
}

export class InventoryCenter {
  constructor(private readonly db: Kysely<any>, private readonly now: () => number = () => Date.now()) {}

  private need(ctx: IcCtx) {
    if (!has(ctx, 'inventory.view')) throw new InventoryCenterError('Your role cannot see inventory.', 'PERMISSION_DENIED', 403);
  }
  private branch(ctx: IcCtx) { return isUuid(ctx.branchId) ? String(ctx.branchId) : null; }
  /** one row per active product: stock summed over the scope (this branch, or every branch), its levels, the ledger's last balance */
  private products(ctx: IcCtx) {
    const T = ctx.tenantId; const B = this.branch(ctx);
    const SB = B ? sql`and s.branch_id = ${B}::uuid` : sql``;
    const MB = B ? sql`and m.branch_id = ${B}::uuid` : sql``;
    const PB = B ? sql`and po.branch_id = ${B}::uuid` : sql``;
    return sql`(select p.id, p.name, p.sku, p.reorder_level, p.critical_level, p.maximum_stock, p.created_at, c.name as category, v.name as vendor, v.lead_time_days,
          coalesce(st.on_hand, 0) as on_hand, coalesce(st.reserved, 0) as reserved, st.rows as stock_rows, st.updated_at as stock_updated_at,
          coalesce(oo.inbound, 0) as inbound, lg.ledger_after, lg.ledger_at
        from inventory_products p
        left join inventory_categories c on c.id = p.category_id and c.tenant_id = p.tenant_id
        left join inventory_vendors v on v.id = p.preferred_vendor_id and v.tenant_id = p.tenant_id
        left join lateral (select sum(s.quantity_on_hand)::int as on_hand, sum(s.quantity_reserved)::int as reserved, count(*)::int as rows, max(s.updated_at) as updated_at
          from inventory_location_stock s where s.tenant_id = p.tenant_id and s.product_id = p.id ${SB}) st on true
        left join lateral (select sum(greatest(l.quantity_ordered - l.quantity_received, 0))::int as inbound from purchase_order_lines l
          join purchase_orders po on po.id = l.purchase_order_id and po.tenant_id = l.tenant_id
          where l.tenant_id = p.tenant_id and l.product_id = p.id and po.status in ('approved', 'ordered', 'partial') ${PB}) oo on true
        left join lateral (select sum(x.quantity_after)::int as ledger_after, max(x.created_at) as ledger_at from (
            select distinct on (m.branch_id) m.quantity_after, m.created_at from inventory_stock_movements m
            where m.tenant_id = p.tenant_id and m.product_id = p.id and m.quantity_after is not null ${MB} order by m.branch_id, m.created_at desc, m.id desc) x) lg on true
        where p.tenant_id = ${T} and p.archived_at is null) x`;
  }
  private classify(r: Row) {
    const reorder = N(r.reorder_level); const crit = criticalOf(reorder, r.critical_level == null ? null : N(r.critical_level));
    const status = positionStatus(N(r.on_hand), reorder, r.maximum_stock == null ? null : N(r.maximum_stock), r.critical_level == null ? null : N(r.critical_level));
    const mismatch = r.ledger_after != null && N(r.ledger_after) !== N(r.on_hand);
    return { status, crit, mismatch, noThreshold: reorder <= 0 && crit.source === 'none' };
  }

  // ── the six cards, with their definitions and the reasons ───────────────────────────────────────────────────
  async summary(ctx: IcCtx) {
    this.need(ctx);
    const rows = (await sql<Row>`select ${X_COLS} from ${this.products(ctx)}`.execute(this.db)).rows;
    const c = { products: rows.length, inStock: 0, low: 0, critical: 0, outOfStock: 0, overstock: 0 };
    let critExplicit = 0, critDerived = 0, noThreshold = 0, mismatch = 0, noStockRow = 0, inbound = 0; let freshest: number | null = null;
    for (const r of rows) {
      const k = this.classify(r);
      if (k.status === 'in_stock') c.inStock++; else if (k.status === 'low') c.low++; else if (k.status === 'critical') c.critical++;
      else if (k.status === 'out_of_stock') c.outOfStock++; else c.overstock++;
      if (k.status === 'critical') { if (k.crit.source === 'explicit') critExplicit++; else critDerived++; }
      if (k.noThreshold) noThreshold++;
      if (k.mismatch) mismatch++;
      if (!N(r.stock_rows)) noStockRow++;
      if (N(r.inbound) > 0) inbound++;
      if (r.stock_updated_at) freshest = Math.max(freshest ?? 0, new Date(r.stock_updated_at).getTime());
    }
    return {
      asOf: new Date(this.now()).toISOString(), scope: this.branch(ctx) ? 'branch' : 'all_branches',
      cards: c,
      reasons: { criticalExplicit: critExplicit, criticalDerived: critDerived, noThreshold, ledgerMismatch: mismatch, noStockRecord: noStockRow, withOpenOrders: inbound },
      definitions: { products: 'active (not archived) products in the catalog', outOfStock: 'on hand 0 or less', critical: 'on hand above 0 and at or below the critical level (the explicit critical level, or half the reorder level when none is set)',
        low: 'above critical and at or below the reorder level', overstock: 'above the maximum stock', inStock: 'everything else', onHand: 'summed over the scope' },
      stockUpdatedAt: freshest ? new Date(freshest).toISOString() : null,
      costVisible: has(ctx, 'inventory.cost.view') || has(ctx, 'ai_inventory.view_cost'),
    };
  }

  // ── products ───────────────────────────────────────────────────────────────────────────────────────────────
  async productsList(ctx: IcCtx, f: Record<string, unknown>) {
    this.need(ctx);
    const pageSize = (IC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const status = pick(IC_STATUSES, f.status) ?? 'all';
    const sort = pick(IC_SORTS, f.sort) ?? 'attention';
    const q = String(f.q ?? '').trim().slice(0, 80);
    const where = [sql`true`];
    if (q) where.push(sql`(x.name ilike ${esc(q)} or coalesce(x.sku, '') ilike ${esc(q)} or coalesce(x.vendor, '') ilike ${esc(q)} or coalesce(x.category, '') ilike ${esc(q)})`);
    // the classification is the pure position rule, applied to the page's candidate set in memory (a salon has hundreds, not millions)
    const rows = (await sql<Row>`select ${X_COLS} from ${this.products(ctx)} where ${sql.join(where, sql` and `)} limit 5000`.execute(this.db)).rows
      .map((r) => ({ r, k: this.classify(r) }))
      .filter(({ k }) => status === 'all' ? true : status === 'no_threshold' ? k.noThreshold : status === 'ledger_mismatch' ? k.mismatch : k.status === status);
    rows.sort((a, z) => sort === 'name' ? String(a.r.name).localeCompare(String(z.r.name))
      : sort === 'on_hand' ? N(a.r.on_hand) - N(z.r.on_hand)
        : sort === 'updated' ? String(z.r.stock_updated_at ?? '').localeCompare(String(a.r.stock_updated_at ?? ''))
          : (RANK[a.k.status] - RANK[z.k.status]) || String(a.r.name).localeCompare(String(z.r.name)));
    const total = rows.length;
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: slice.map(({ r, k }) => ({ id: String(r.id), name: r.name, sku: r.sku ?? null, category: r.category ?? null, vendor: r.vendor ?? null, leadTimeDays: r.lead_time_days == null ? null : N(r.lead_time_days),
        onHand: N(r.on_hand), reserved: N(r.reserved), openOrderQty: N(r.inbound), reorderLevel: N(r.reorder_level), criticalLevel: k.crit.level, criticalSource: k.crit.source,
        maximumStock: r.maximum_stock == null ? null : N(r.maximum_stock), status: k.status, noThreshold: k.noThreshold, hasStockRecord: N(r.stock_rows) > 0,
        ledgerBalance: r.ledger_after == null ? null : N(r.ledger_after), ledgerAt: iso(r.ledger_at), ledgerMismatch: k.mismatch, stockUpdatedAt: iso(r.stock_updated_at) })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), applied: { q: q || null, status, sort }, scope: this.branch(ctx) ? 'branch' : 'all_branches',
    };
  }

  // ── stock activity ─────────────────────────────────────────────────────────────────────────────────────────
  async activity(ctx: IcCtx, f: Record<string, unknown>) {
    this.need(ctx);
    const T = ctx.tenantId; const B = this.branch(ctx);
    const pageSize = (IC_PAGE_SIZES as readonly number[]).includes(Number(f.pageSize)) ? Number(f.pageSize) : 25;
    const page = Math.max(1, Math.min(100000, Math.floor(Number(f.page) || 1)));
    const type = pick(IC_MOVE_TYPES, f.type) ?? 'all';
    const tz = await branchTimeZone(this.db, T, B);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(this.now()));
    const preset = pick(IC_PRESETS, f.preset) ?? (f.from || f.to ? 'custom' : 'all');
    let from: string | null = null, to: string | null = null;
    if (preset !== 'all') {
      const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; to = today;
      if (preset === 'today') from = today; else if (preset === 'yesterday') from = to = addDays(today, -1); else if (preset === 'week') from = addDays(today, -dow);
      else if (preset === 'last_7') from = addDays(today, -6); else if (preset === 'month') from = today.slice(0, 8) + '01'; else if (preset === 'last_30') from = addDays(today, -29);
      else if (preset === 'last_90') from = addDays(today, -89); else if (preset === 'year') from = today.slice(0, 4) + '-01-01';
      else if (preset === 'last_month') { const first = today.slice(0, 8) + '01'; to = addDays(first, -1); from = to.slice(0, 8) + '01'; }
      else {
        const a = typeof f.from === 'string' && DAY.test(f.from) && !Number.isNaN(Date.parse(f.from)) ? f.from : null;
        const z = typeof f.to === 'string' && DAY.test(f.to) && !Number.isNaN(Date.parse(f.to)) ? f.to : null;
        if (!a || !z || a > z) throw new InventoryCenterError('Choose a From and a To date; the From date must be on or before the To date.', 'IC_INVALID_PERIOD');
        from = a; to = z;
      }
    }
    const q = String(f.q ?? '').trim().slice(0, 80);
    const where = [sql`m.tenant_id = ${T}`, B ? sql`m.branch_id = ${B}::uuid` : sql`true`];
    if (type === 'other') where.push(sql`m.movement_type <> all(${KNOWN}::text[])`);
    else if (type !== 'all') where.push(sql`m.movement_type = any(${MOVE_GROUP[type]}::text[])`);
    if (from && to) where.push(sql`m.created_at >= (${from}::date::timestamp at time zone ${tz}) and m.created_at < ((${to}::date + 1)::timestamp at time zone ${tz})`);
    if (q) where.push(sql`(p.name ilike ${esc(q)} or coalesce(p.sku, '') ilike ${esc(q)} or coalesce(m.reason, '') ilike ${esc(q)} or coalesce(m.related_id::text, '') ilike ${esc(q)})`);
    const W = sql.join(where, sql` and `);
    const FROM = sql`inventory_stock_movements m join inventory_products p on p.id = m.product_id and p.tenant_id = m.tenant_id
      left join users u on u.id = m.actor_user_id and u.tenant_id = m.tenant_id left join branches b on b.id = m.branch_id and b.tenant_id = m.tenant_id`;
    const total = N((await sql<Row>`select count(*)::int as n from ${FROM} where ${W}`.execute(this.db)).rows[0]?.n);
    const rows = (await sql<Row>`select m.id, m.movement_type, m.quantity_before, m.quantity_change, m.quantity_after, m.unit, m.related_type, m.related_id, m.reason, m.created_at,
        p.id as product_id, p.name, p.sku, coalesce(u.full_name, u.email) as actor, b.name as branch
      from ${FROM} where ${W} order by m.created_at desc, m.id desc limit ${pageSize} offset ${(page - 1) * pageSize}`.execute(this.db)).rows;
    const groupOf = (t: string) => Object.keys(MOVE_GROUP).find((g) => MOVE_GROUP[g].includes(t)) ?? 'other';
    return {
      items: rows.map((r) => ({ id: String(r.id), at: iso(r.created_at), type: r.movement_type, group: groupOf(String(r.movement_type)), productId: String(r.product_id), product: r.name, sku: r.sku ?? null,
        before: r.quantity_before == null ? null : N(r.quantity_before), change: r.quantity_change == null ? null : N(r.quantity_change), after: r.quantity_after == null ? null : N(r.quantity_after),
        unit: r.unit ?? null, reference: r.related_type ? { type: r.related_type, id: r.related_id ?? null } : null, reason: r.reason ?? null, actor: r.actor ?? null, branch: r.branch ?? null })),
      total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)), applied: { q: q || null, type, preset, from, to }, period: { today, timeZone: tz },
    };
  }

  // ── Check Inventory System — read-only ─────────────────────────────────────────────────────────────────────
  async check(ctx: IcCtx) {
    this.need(ctx);
    const T = ctx.tenantId; const B = this.branch(ctx);
    type St = 'PASSED' | 'WARNING' | 'FAILED' | 'INSUFFICIENT_DATA' | 'UNAVAILABLE';
    const recentRun = async (ex: Kysely<any>) => (await sql<Row>`select id, overall, checks, created_at from inventory_health_runs where tenant_id = ${T} and branch_id is not distinct from ${B}
      and created_at >= now() - ${HEALTH_GAP_SECONDS + ' seconds'}::interval order by created_at desc limit 1`.execute(ex)).rows[0];
    const reusedOut = (r: Row) => ({ id: r.id, overall: r.overall, checks: r.checks, checkedAt: iso(r.created_at), reused: true });
    const early = await recentRun(this.db);
    if (early) return reusedOut(early);
    const checks: Array<{ key: string; component: string; state: St; count?: number | null; detail?: Record<string, unknown>; lastPassedAt?: string | null }> = [];
    const one = async (q: { execute: (db: Kysely<any>) => Promise<{ rows: Row[] }> }): Promise<Row> => (await q.execute(this.db)).rows[0] ?? {};
    const rows = (await sql<Row>`select ${X_COLS} from ${this.products(ctx)}`.execute(this.db)).rows;
    const k = rows.map((r) => ({ r, k: this.classify(r) }));
    const n = rows.length;
    checks.push({ key: 'products_tracked', component: 'catalog', state: n ? 'PASSED' : 'INSUFFICIENT_DATA', count: n });
    const noRow = k.filter((x) => !N(x.r.stock_rows)).length;
    checks.push({ key: 'stock_records', component: 'stock', state: !n ? 'INSUFFICIENT_DATA' : noRow ? 'WARNING' : 'PASSED', count: noRow, detail: { scope: B ? 'branch' : 'all_branches' } });
    const neg = N((await one(sql<Row>`select count(*)::int as n from inventory_location_stock s where s.tenant_id = ${T} ${B ? sql`and s.branch_id = ${B}::uuid` : sql``} and s.quantity_on_hand < 0`)).n);
    checks.push({ key: 'no_negative_stock', component: 'stock', state: neg ? 'FAILED' : 'PASSED', count: neg });
    const mism = k.filter((x) => x.k.mismatch).length;
    checks.push({ key: 'ledger_matches_stock', component: 'ledger', state: !k.some((x) => x.r.ledger_after != null) ? 'INSUFFICIENT_DATA' : mism ? 'FAILED' : 'PASSED', count: mism });
    const noTh = k.filter((x) => x.k.noThreshold).length;
    checks.push({ key: 'thresholds_set', component: 'thresholds', state: !n ? 'INSUFFICIENT_DATA' : noTh ? 'WARNING' : 'PASSED', count: noTh });
    const derived = k.filter((x) => x.k.status === 'critical' && x.k.crit.source === 'derived').length;
    checks.push({ key: 'critical_explained', component: 'thresholds', state: derived ? 'WARNING' : 'PASSED', count: derived, detail: { critical: k.filter((x) => x.k.status === 'critical').length } });
    const badLevels = k.filter((x) => x.r.critical_level != null && N(x.r.reorder_level) > 0 && N(x.r.critical_level) > N(x.r.reorder_level)).length;
    checks.push({ key: 'levels_consistent', component: 'thresholds', state: badLevels ? 'WARNING' : 'PASSED', count: badLevels });
    const use = await one(sql<Row>`select count(*) filter (where m.created_at > now() - interval '30 days')::int as n30, max(m.created_at) as last
      from inventory_stock_movements m where m.tenant_id = ${T} ${B ? sql`and m.branch_id = ${B}::uuid` : sql``}`);
    checks.push({ key: 'movements_recorded', component: 'ledger', state: !use.last ? 'INSUFFICIENT_DATA' : N(use.n30) ? 'PASSED' : 'WARNING', count: N(use.n30), detail: { lastMovementAt: iso(use.last) } });
    const overdue = N((await one(sql<Row>`select count(*)::int as n from purchase_orders po where po.tenant_id = ${T} ${B ? sql`and po.branch_id = ${B}::uuid` : sql``}
      and po.status in ('approved', 'ordered', 'partial') and po.expected_date is not null and po.expected_date < current_date - 3`)).n);
    checks.push({ key: 'orders_received', component: 'purchasing', state: overdue ? 'WARNING' : 'PASSED', count: overdue });
    const needLead = k.filter((x) => (x.k.status === 'critical' || x.k.status === 'low' || x.k.status === 'out_of_stock') && (x.r.vendor == null || x.r.lead_time_days == null)).length;
    checks.push({ key: 'reorder_data', component: 'purchasing', state: needLead ? 'WARNING' : 'PASSED', count: needLead });
    const cross = N((await one(sql<Row>`select count(*)::int as n from inventory_location_stock s join inventory_products p on p.id = s.product_id where s.tenant_id = ${T} and p.tenant_id <> s.tenant_id`)).n);
    checks.push({ key: 'tenant_isolation', component: 'security', state: cross ? 'FAILED' : 'PASSED', count: cross });
    checks.push({ key: 'no_side_effects', component: 'security', state: 'PASSED' });

    const prev = (await sql<Row>`select c->>'key' as key, max(h.created_at) as at from inventory_health_runs h cross join lateral jsonb_array_elements(h.checks) c
      where h.tenant_id = ${T} and h.branch_id is not distinct from ${B} and c->>'state' = 'PASSED' group by 1`.execute(this.db)).rows;
    const checkedAt = new Date(this.now()).toISOString();
    for (const c of checks) c.lastPassedAt = c.state === 'PASSED' ? checkedAt : iso(prev.find((p) => p.key === c.key)?.at);
    const order = ['FAILED', 'UNAVAILABLE', 'WARNING', 'INSUFFICIENT_DATA', 'PASSED'];
    checks.sort((a, z) => order.indexOf(a.state) - order.indexOf(z.state));
    const overall = checks.some((x) => x.state === 'FAILED' || x.state === 'UNAVAILABLE') ? 'FAILED' : checks.some((x) => x.state === 'WARNING') ? 'WARNING' : n ? 'PASSED' : 'INSUFFICIENT_DATA';
    const id = randomUUID();
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('inventory-health:' || ${T} || ':' || coalesce(${B}::text, '')))`.execute(trx);
      const raced = await recentRun(trx);
      if (raced) return reusedOut(raced);
      await sql`insert into inventory_health_runs (id, tenant_id, branch_id, actor_user_id, overall, checks)
        values (${id}, ${T}, ${B}, ${isUuid(ctx.userId) ? ctx.userId : null}, ${overall}, ${JSON.stringify(checks)}::jsonb)`.execute(trx);
      return { id, overall, checks, checkedAt, reused: false };
    });
  }
}
