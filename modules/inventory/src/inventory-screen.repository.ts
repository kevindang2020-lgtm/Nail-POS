// inventory-screen.repository.ts — Inventory / Products / Suppliers mandates (Oct 29 2026): the READ side of POS Inventory
// (/tenant/inventory), Products (/tenant/products) and the purchase-order lists Suppliers shares. Raw SQL; tenant + branch
// always from the session. Built on the Stock Alerts read model (one search, one period shape, one "Last Used By").
//
// What every number means (the photo's 11 products · 11 bottles · 20 open · 171 unopened · 128 expiring could not all be
// true at once, because they came from two different sources):
//   * Products        active, un-archived product records (one per product — a bottle or a lot is never a product).
//   * Bottles / units usable containers from the BOTTLE ROWS (inventory_units: unopened + opened + low), split by the
//                     product's unit (bottle / piece / …) — never a mixed sum. The old card summed the cached
//                     quantity_on_hand while Open / Unopened summed other cached columns: a cache that drifted from the
//                     bottle rows (hand-written or stale rows) showed 11 next to 20 + 171. `stockDrift` counts products whose
//                     cache disagrees, and Recount (POST …/recount) rebuilds the cache from the bottles — the bottles win.
//   * Open / Unopened bottle rows by status (low counts as open). Empty / damaged / expired / sold are not on hand.
//   * Low stock       products at or below the reorder level but above zero (location overrides applied) — the Stock
//                     Alerts scope (stock-alert-state.ts); Out of stock = nothing usable on hand.
//   * Expiring soon   usable BOTTLES whose expiration date falls in the next 30 days (128 was bottles, not products); bottles
//                     already past their date are counted apart as expired and are not available.
//   * Pending reports technician bottle reports waiting for review (the card the photo calls Pending Imports).
//   * Inventory value cost × usable, unexpired bottles (cents, integer). Hidden from the limited technician view.
// A period filter never changes these: they are "now". Periods filter the dated lists (with the date field named).
import { sql, type RawBuilder } from 'kysely';
import { withCode } from '@aipowersalon/api-contracts';
import { liveAlertState, openAlertCount } from './stock-alert-state';
import { StockAlertsRepository, likeOf, isoOf, phoneDigits, type Paging, type Period } from './stock-alerts.repository';
import { InventoryError, type InvCtx } from './inventory.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const N = (v: unknown): number => Number(v ?? 0) || 0;
const idOrNull = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null);
const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => ((list as readonly string[]).includes(String(v)) ? (v as T) : def);
// a user's display name, per fixed join alias (no dynamic identifiers)
const NAME = {
  au: sql`coalesce(nullif(au.full_name, ''), nullif(trim(coalesce(au.first_name, '') || ' ' || coalesce(au.last_name, '')), ''), au.email)`,
  ou: sql`coalesce(nullif(ou.full_name, ''), nullif(trim(coalesce(ou.first_name, '') || ' ' || coalesce(ou.last_name, '')), ''), ou.email)`,
  cu: sql`coalesce(nullif(cu.full_name, ''), nullif(trim(coalesce(cu.first_name, '') || ' ' || coalesce(cu.last_name, '')), ''), cu.email)`,
  su: sql`coalesce(nullif(su.full_name, ''), nullif(trim(coalesce(su.first_name, '') || ' ' || coalesce(su.last_name, '')), ''), su.email)`,
  ru: sql`coalesce(nullif(ru.full_name, ''), nullif(trim(coalesce(ru.first_name, '') || ' ' || coalesce(ru.last_name, '')), ''), ru.email)`,
  tu: sql`coalesce(nullif(tu.full_name, ''), nullif(trim(coalesce(tu.first_name, '') || ' ' || coalesce(tu.last_name, '')), ''), tu.email)`,
} as const;
const nameOf = (a: keyof typeof NAME) => NAME[a];
const pages = (total: number, pg: Paging) => { const n = Math.max(1, Math.ceil(total / pg.pageSize)); return { pages: n, page: Math.min(pg.page, n) }; };

export const STOCK_STATUSES = ['out_of_stock', 'critical', 'low', 'in_stock', 'overstock'] as const;
export const PRODUCT_DATE_FIELDS = ['created', 'updated', 'activity', 'received', 'archived', 'expiration', 'used'] as const;
export const PRODUCT_SORTS = ['newest', 'oldest', 'name', 'sku', 'stock', 'critical', 'price_desc', 'price_asc', 'updated', 'last_used'] as const;
export const PO_STATUSES = ['draft', 'approved', 'ordered', 'partial', 'received', 'cancelled', 'closed'] as const;
export const PO_DATE_FIELDS = ['created', 'expected', 'approved', 'received'] as const;
export const OPEN_PO_STATUSES = ['approved', 'ordered', 'partial'] as const;   // committed, not yet fully received (a draft is not active)
export const EXPIRY_DAYS = 30;

export class InventoryScreenRepository extends StockAlertsRepository {
  private techOnly(ctx: InvCtx) { return ctx.permissions.includes('inventory.view_limited') && !ctx.permissions.includes('inventory.cost.view') && !ctx.permissions.includes('*'); }

  /** A date column (calendar dates) within the period — date-only semantics, both ends inclusive. */
  private dateInPeriod(col: RawBuilder<unknown>, p: Period): RawBuilder<unknown> {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= ${p.from}::date AND ${col} <= ${p.to}::date)`;
  }

  /** One row per product at this branch: stock cache, bottle-row counts, thresholds, severity, vendor, last use. */
  private productFrom(ctx: InvCtx, b: string, today: string): RawBuilder<unknown> {
    return sql`FROM inventory_products p
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${b}
      LEFT JOIN (SELECT u.product_id,
          count(*) FILTER (WHERE u.status = 'unopened')::int AS unopened,
          count(*) FILTER (WHERE u.status IN ('opened', 'low'))::int AS open,
          count(*) FILTER (WHERE u.status = 'empty')::int AS empty,
          count(*) FILTER (WHERE u.status IN ('damaged', 'expired', 'missing'))::int AS unusable,
          count(*) FILTER (WHERE u.status IN ('unopened', 'opened', 'low') AND u.expiration_date < ${today}::date)::int AS expired,
          count(*) FILTER (WHERE u.status IN ('unopened', 'opened', 'low') AND u.expiration_date >= ${today}::date AND u.expiration_date <= ${today}::date + ${EXPIRY_DAYS}::int)::int AS expiring,
          min(u.expiration_date) FILTER (WHERE u.status IN ('unopened', 'opened', 'low') AND u.expiration_date >= ${today}::date) AS next_expiry
        FROM inventory_units u WHERE u.tenant_id = ${ctx.tenantId} AND u.branch_id = ${b} GROUP BY u.product_id) uc ON uc.product_id = p.id
      LEFT JOIN inventory_brands br ON br.id = p.brand_id AND br.tenant_id = p.tenant_id
      LEFT JOIN inventory_categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
      LEFT JOIN inventory_vendors v ON v.id = coalesce(s.preferred_vendor_id_override, p.preferred_vendor_id) AND v.tenant_id = p.tenant_id
      LEFT JOIN ${this.lastUse(ctx, b)} lu ON lu.product_id = p.id
      LEFT JOIN LATERAL (SELECT max(m.created_at) AS at FROM inventory_stock_movements m WHERE m.tenant_id = ${ctx.tenantId} AND m.branch_id = ${b} AND m.product_id = p.id) am ON true
      CROSS JOIN LATERAL (SELECT coalesce(s.quantity_on_hand, 0)::int AS on_hand, coalesce(s.quantity_reserved, 0)::int AS reserved,
          (coalesce(uc.unopened, 0) + coalesce(uc.open, 0) - coalesce(uc.expired, 0))::int AS bottles,   -- usable, unexpired: the same rule as the stock cache
          coalesce(s.reorder_level_override, p.reorder_level, 0)::int AS rl,
          coalesce(s.reorder_quantity_override, p.reorder_quantity, 0)::int AS rq,
          CASE WHEN coalesce(s.critical_level_override, p.critical_level, 0) > 0 THEN coalesce(s.critical_level_override, p.critical_level)::int
               ELSE ceil(coalesce(s.reorder_level_override, p.reorder_level, 0) / 2.0)::int END AS cl) k
      CROSS JOIN LATERAL (SELECT CASE WHEN k.on_hand <= 0 THEN 'out_of_stock' WHEN k.cl > 0 AND k.on_hand <= k.cl THEN 'critical'
          WHEN k.rl > 0 AND k.on_hand <= k.rl THEN 'low' WHEN coalesce(p.maximum_stock, 0) > 0 AND k.on_hand > p.maximum_stock THEN 'overstock' ELSE 'in_stock' END AS severity) sv`;
  }
  private productCols = sql`p.id, p.name, p.sku, p.barcode, p.upc, p.color_name, p.color_number, p.finish, p.unit_type, p.tracking_mode, p.cost_cents, p.retail_price_cents,
      p.maximum_stock, p.created_at, p.updated_at, p.archived_at, p.image_url, p.button_color, p.is_retail, p.brand_id, p.category_id,
      br.name AS brand_name, c.name AS category_name, v.id AS vendor_id, v.name AS vendor_name, v.phone AS vendor_phone,
      k.on_hand, k.reserved, k.bottles, k.rl, k.rq, k.cl, sv.severity, coalesce(uc.unopened, 0)::int AS unopened, coalesce(uc.open, 0)::int AS open,
      coalesce(uc.empty, 0)::int AS empty, coalesce(uc.unusable, 0)::int AS unusable, coalesce(uc.expired, 0)::int AS expired, coalesce(uc.expiring, 0)::int AS expiring,
      to_char(uc.next_expiry, 'YYYY-MM-DD') AS next_expiry, am.at AS last_activity,
      lu.technician_id AS last_tech_id, lu.technician_name AS last_tech_name, lu.occurred_at AS last_used_at, lu.hundredths AS last_qty, lu.source AS last_source`;

  private productOut(ctx: InvCtx, r: any) {
    const hide = this.techOnly(ctx);
    const available = Math.max(0, N(r.bottles) - N(r.reserved));   // bottles already excludes expired
    return {
      id: String(r.id), name: r.name, sku: r.sku ?? null, barcode: r.barcode ?? null, upc: r.upc ?? null, colorName: r.color_name ?? null, colorNumber: r.color_number ?? null,
      finish: r.finish ?? null, unit: r.unit_type || 'unit', trackingMode: r.tracking_mode ?? 'quantity', brandId: r.brand_id ?? null, brand: r.brand_name ?? null,
      categoryId: r.category_id ?? null, category: r.category_name ?? null, vendorId: r.vendor_id ?? null, vendor: r.vendor_name ?? null, vendorPhone: r.vendor_phone ?? null,
      onHand: N(r.bottles), available, reserved: N(r.reserved), cachedOnHand: N(r.on_hand), stockDrift: N(r.on_hand) !== N(r.bottles),
      unopened: N(r.unopened), open: N(r.open), empty: N(r.empty), unusable: N(r.unusable), expired: N(r.expired), expiring: N(r.expiring), nextExpiry: r.next_expiry ?? null,
      reorderLevel: N(r.rl), reorderQuantity: N(r.rq), criticalLevel: N(r.cl), maximumStock: r.maximum_stock == null ? null : N(r.maximum_stock), severity: r.severity,
      suggestedReorder: N(r.rl) > 0 && N(r.on_hand) <= N(r.rl) ? Math.max(N(r.rq), N(r.rl) - N(r.on_hand)) : 0,
      retailCents: hide || r.retail_price_cents == null ? null : N(r.retail_price_cents), costCents: hide || r.cost_cents == null ? null : N(r.cost_cents),
      isRetail: !!r.is_retail, imageUrl: r.image_url ?? null, buttonColor: r.button_color ?? null,
      createdAt: isoOf(r.created_at), updatedAt: isoOf(r.updated_at), archivedAt: isoOf(r.archived_at), lastActivityAt: isoOf(r.last_activity),
      ...this.lastUsedOut(r),
    };
  }

  // ── Metrics (now; never period-filtered) ────────────────────────────────────────────────────────────────────────────
  async metrics(ctx: InvCtx) {
    const b = this.branch(ctx); const p = await this.period(ctx, { preset: 'today' });
    const from = this.productFrom(ctx, b, p.today);
    const r = (await sql<any>`SELECT count(*)::int AS products, coalesce(sum(coalesce(uc.unopened, 0)), 0)::int AS unopened, coalesce(sum(coalesce(uc.open, 0)), 0)::int AS open,
        coalesce(sum(coalesce(uc.expiring, 0)), 0)::int AS expiring, coalesce(sum(coalesce(uc.expired, 0)), 0)::int AS expired,
        count(*) FILTER (WHERE sv.severity = 'out_of_stock')::int AS out_of_stock, count(*) FILTER (WHERE k.on_hand <> k.bottles)::int AS drift,
        coalesce(sum(coalesce(p.cost_cents, 0)::bigint * greatest(k.bottles, 0)), 0)::bigint AS value_cents,
        coalesce(sum(coalesce(p.retail_price_cents, 0)::bigint * greatest(k.bottles, 0)), 0)::bigint AS retail_cents,
        count(*) FILTER (WHERE p.cost_cents IS NULL AND k.bottles > 0)::int AS no_cost
      ${from} WHERE p.tenant_id = ${ctx.tenantId} AND p.active = true AND p.archived_at IS NULL`.execute(this.db)).rows[0];
    const units = (await sql<{ unit: string; n: number }>`SELECT coalesce(nullif(p.unit_type, ''), 'unit') AS unit, count(*)::int AS n FROM inventory_units u
      JOIN inventory_products p ON p.id = u.product_id AND p.tenant_id = u.tenant_id AND p.active = true AND p.archived_at IS NULL
      WHERE u.tenant_id = ${ctx.tenantId} AND u.branch_id = ${b} AND u.status IN ('unopened', 'opened', 'low') GROUP BY 1 ORDER BY 2 DESC, 1`.execute(this.db)).rows;
    const live = (await sql<{ severity: string; n: number }>`SELECT la.severity, count(*)::int AS n FROM (${liveAlertState(ctx.tenantId, b)}) la GROUP BY la.severity`.execute(this.db)).rows;
    const open = N((await openAlertCount(ctx.tenantId, b).execute(this.db)).rows[0]?.n);
    const pending = N((await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_technician_reports WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${b} AND status = 'pending'`.execute(this.db)).rows[0]?.n);
    const by = (s: string) => N(live.find((x) => x.severity === s)?.n);
    const hide = this.techOnly(ctx);
    return {
      asOf: new Date().toISOString(), timeZone: p.tz, today: p.today,
      products: N(r?.products), bottles: N(r?.unopened) + N(r?.open), bottlesByUnit: units.map((u) => ({ unit: u.unit, count: N(u.n) })),
      open: N(r?.open), unopened: N(r?.unopened), lowStock: by('low') + by('critical'), critical: by('critical'), outOfStock: N(r?.out_of_stock),
      needReorder: by('low') + by('critical') + by('out_of_stock'), openAlerts: open,
      expiringSoon: N(r?.expiring), expired: N(r?.expired), expiryHorizonDays: EXPIRY_DAYS, pendingReports: pending, stockDrift: N(r?.drift),
      inventoryValueCents: hide ? null : N(r?.value_cents), retailValueCents: hide ? null : N(r?.retail_cents), productsWithoutCost: N(r?.no_cost),
      definitions: {
        products: 'Active products (one per product record; bottles and lots are not products).',
        bottles: 'Usable containers on hand from the bottle records (unopened + open), per unit type.',
        open: 'Opened bottles still in use (including ones marked low).', unopened: 'Sealed bottles on hand.',
        lowStock: 'Products at or below their reorder level but not out (location overrides applied).',
        outOfStock: 'Products with nothing usable on hand.',
        expiringSoon: `Usable bottles whose expiration date is within ${EXPIRY_DAYS} days; already-expired bottles are counted separately.`,
        pendingReports: 'Technician bottle reports waiting for review.',
        inventoryValue: 'Cost × usable, unexpired bottles.', retailValue: 'Retail price × usable, unexpired bottles.',
        needReorder: 'Products at or below their reorder level, out of stock included — the Stock Alerts scope.',
      },
    };
  }

  // ── Products (All Inventory · Products page) ────────────────────────────────────────────────────────────────────────
  async products(ctx: InvCtx, q: Record<string, string | undefined>, period: Period, pg: Paging) {
    const b = this.branch(ctx);
    const status = (STOCK_STATUSES as readonly string[]).includes(String(q.status)) ? q.status! : q.status === 'needs_reorder' ? 'needs_reorder' : null;
    const lifecycle = pick(q.lifecycle, ['active', 'archived', 'all'] as const, 'active');
    const brand = idOrNull(q.brandId); const cat = idOrNull(q.categoryId); const vendor = idOrNull(q.vendorId); const tech = idOrNull(q.technicianId);
    const dateField = pick(q.dateField, PRODUCT_DATE_FIELDS, 'created'); const sort = pick(q.sort, PRODUCT_SORTS, 'newest');
    const dateCol = dateField === 'activity' ? this.inPeriod(sql`am.at`, period) : dateField === 'used' ? this.inPeriod(sql`lu.occurred_at`, period)
      : dateField === 'updated' ? this.inPeriod(sql`p.updated_at`, period) : dateField === 'archived' ? (period.from ? this.inPeriod(sql`p.archived_at`, period) : sql`true`)
      : dateField === 'received' ? (period.from ? sql`EXISTS (SELECT 1 FROM inventory_stock_movements mr WHERE mr.tenant_id = ${ctx.tenantId} AND mr.branch_id = ${b} AND mr.product_id = p.id
          AND mr.movement_type IN ('purchase_received', 'manual_add', 'opening_balance', 'transfer_in') AND ${this.inPeriod(sql`mr.created_at`, period)})` : sql`true`)
      : dateField === 'expiration' ? (period.from ? sql`EXISTS (SELECT 1 FROM inventory_units ux WHERE ux.tenant_id = ${ctx.tenantId} AND ux.branch_id = ${b} AND ux.product_id = p.id
          AND ux.status IN ('unopened', 'opened', 'low') AND ${this.dateInPeriod(sql`ux.expiration_date`, period)})` : sql`true`)
      : this.inPeriod(sql`p.created_at`, period);
    const from = this.productFrom(ctx, b, period.today);
    const where = sql`WHERE p.tenant_id = ${ctx.tenantId}
      AND ${lifecycle === 'active' ? sql`p.archived_at IS NULL` : lifecycle === 'archived' ? sql`p.archived_at IS NOT NULL` : sql`true`}
      AND ${status === 'needs_reorder' ? sql`(k.rl > 0 AND k.on_hand <= k.rl)` : status ? sql`sv.severity = ${status}` : sql`true`}
      AND (${brand}::uuid IS NULL OR p.brand_id = ${brand}) AND (${cat}::uuid IS NULL OR p.category_id = ${cat})
      AND (${vendor}::uuid IS NULL OR v.id = ${vendor} OR EXISTS (SELECT 1 FROM inventory_vendor_products vp WHERE vp.tenant_id = ${ctx.tenantId} AND vp.vendor_id = ${vendor} AND vp.product_id = p.id AND vp.active))
      AND (${tech}::uuid IS NULL OR EXISTS (SELECT 1 FROM ${this.uses(ctx, b)} ut WHERE ut.product_id = p.id AND ut.technician_id = ${tech} AND ut.hundredths > 0))
      AND ${dateCol} AND ${this.productSearch(ctx, q.search)}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${from} ${where}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    // exact SKU / barcode / UPC hits first, then the chosen order (newest = created DESC, id DESC)
    const s = String(q.search ?? '').trim();
    const exact = s ? sql`CASE WHEN lower(coalesce(p.sku, '')) = ${s.toLowerCase()} OR coalesce(p.barcode, '') = ${s} OR coalesce(p.upc, '') = ${s} THEN 0 ELSE 1 END,` : sql``;
    const order = sort === 'name' ? sql`lower(p.name), p.id` : sort === 'stock' ? sql`k.on_hand, lower(p.name), p.id` : sort === 'last_used' ? sql`lu.occurred_at DESC NULLS LAST, p.id DESC`
      : sort === 'oldest' ? sql`p.created_at, p.id` : sort === 'sku' ? sql`lower(p.sku) NULLS LAST, p.id` : sort === 'updated' ? sql`p.updated_at DESC NULLS LAST, p.id DESC`
      : sort === 'price_desc' ? sql`p.retail_price_cents DESC NULLS LAST, p.id DESC` : sort === 'price_asc' ? sql`p.retail_price_cents NULLS LAST, p.id`
      : sort === 'critical' ? sql`CASE sv.severity WHEN 'out_of_stock' THEN 0 WHEN 'critical' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, k.on_hand, p.id` : sql`p.created_at DESC, p.id DESC`;
    const rows = (await sql<any>`SELECT ${this.productCols} ${from} ${where} ORDER BY ${exact} ${order} LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, period, dateField, sort, rows: rows.map((r) => this.productOut(ctx, r)) };
  }

  /** One product, everything the Product Details overlay shows (usage history comes from the Stock Alerts ledger). */
  async product(ctx: InvCtx, productId: string) {
    const b = this.branch(ctx);
    if (!UUID.test(productId)) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const p = await this.period(ctx, { preset: 'today' });
    const row = (await sql<any>`SELECT ${this.productCols}, p.product_line, p.color_family, p.size_value, p.size_unit, p.track_expiration, p.lead_time_days, p.reorder_level AS base_reorder,
        p.critical_level AS base_critical, s.reorder_level_override, s.critical_level_override, s.version AS stock_version, p.preferred_vendor_id
      ${this.productFrom(ctx, b, p.today)} WHERE p.tenant_id = ${ctx.tenantId} AND p.id = ${productId}`.execute(this.db)).rows[0];
    if (!row) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const hide = this.techOnly(ctx);
    const bottles = (await sql<any>`SELECT u.id, u.status, u.lot_number, to_char(u.expiration_date, 'YYYY-MM-DD') AS expiration_date, u.internal_barcode, u.received_at, u.opened_at,
        u.emptied_at, u.estimated_remaining_percent, u.storage_location, ${nameOf('ou')} AS opened_by
      FROM inventory_units u LEFT JOIN users ou ON ou.id = u.opened_by_user_id
      WHERE u.tenant_id = ${ctx.tenantId} AND u.branch_id = ${b} AND u.product_id = ${productId}
      ORDER BY CASE WHEN u.status IN ('opened', 'low') THEN 0 WHEN u.status = 'unopened' THEN 1 ELSE 2 END, u.expiration_date NULLS LAST, u.received_at DESC, u.id LIMIT 200`.execute(this.db)).rows;
    const suppliers = (await sql<any>`SELECT v.id, v.name, v.phone, v.email, v.active, vp.supplier_sku, vp.last_cost_cents, vp.purchase_unit, vp.units_per_purchase_unit, vp.minimum_order_qty,
        vp.lead_time_days, vp.is_preferred, (v.id = ${row.vendor_id ?? null}::uuid) AS is_product_preferred,
        (SELECT max(po.created_at) FROM purchase_orders po JOIN purchase_order_lines pl ON pl.purchase_order_id = po.id AND pl.tenant_id = po.tenant_id
          WHERE po.tenant_id = ${ctx.tenantId} AND po.vendor_id = v.id AND pl.product_id = ${productId}) AS last_ordered_at,
        (SELECT pl.unit_cost_cents FROM purchase_orders po JOIN purchase_order_lines pl ON pl.purchase_order_id = po.id AND pl.tenant_id = po.tenant_id
          WHERE po.tenant_id = ${ctx.tenantId} AND po.vendor_id = v.id AND pl.product_id = ${productId} ORDER BY po.created_at DESC LIMIT 1) AS last_po_cost
      FROM inventory_vendors v LEFT JOIN inventory_vendor_products vp ON vp.vendor_id = v.id AND vp.tenant_id = v.tenant_id AND vp.product_id = ${productId} AND vp.active
      WHERE v.tenant_id = ${ctx.tenantId} AND (vp.id IS NOT NULL OR v.id = ${row.vendor_id ?? null}::uuid
        OR EXISTS (SELECT 1 FROM purchase_orders po JOIN purchase_order_lines pl ON pl.purchase_order_id = po.id AND pl.tenant_id = po.tenant_id WHERE po.tenant_id = ${ctx.tenantId} AND po.vendor_id = v.id AND pl.product_id = ${productId}))
      ORDER BY (v.id = ${row.vendor_id ?? null}::uuid) DESC, vp.is_preferred DESC NULLS LAST, v.name LIMIT 20`.execute(this.db)).rows;
    const orders = (await sql<any>`SELECT po.id, po.po_number, po.status, to_char(po.expected_date, 'YYYY-MM-DD') AS expected_date, po.created_at, pl.quantity_ordered, pl.quantity_received, pl.unit_cost_cents, v.name AS vendor_name
      FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id AND po.tenant_id = pl.tenant_id LEFT JOIN inventory_vendors v ON v.id = po.vendor_id AND v.tenant_id = po.tenant_id
      WHERE pl.tenant_id = ${ctx.tenantId} AND pl.product_id = ${productId} AND po.branch_id = ${b} ORDER BY po.created_at DESC, po.id DESC LIMIT 8`.execute(this.db)).rows;
    const audit = (await sql<any>`SELECT a.id, a.action_type, a.created_at, a.metadata_json, ${nameOf('au')} AS actor
      FROM audit_logs a LEFT JOIN users au ON au.id = a.user_id
      WHERE a.tenant_id = ${ctx.tenantId} AND a.entity_type = 'inventory' AND a.entity_id = ${productId} ORDER BY a.created_at DESC, a.id DESC LIMIT 12`.execute(this.db)).rows;
    const out = this.productOut(ctx, row);
    return {
      product: { ...out, productLine: row.product_line ?? null, colorFamily: row.color_family ?? null, size: row.size_value == null ? null : `${Number(row.size_value)} ${row.size_unit ?? ''}`.trim(),
        trackExpiration: !!row.track_expiration, leadTimeDays: row.lead_time_days == null ? null : N(row.lead_time_days),
        thresholds: { reorderLevel: N(row.rl), criticalLevel: N(row.cl), baseReorderLevel: N(row.base_reorder), baseCriticalLevel: row.base_critical == null ? null : N(row.base_critical),
          reorderOverride: row.reorder_level_override == null ? null : N(row.reorder_level_override), criticalOverride: row.critical_level_override == null ? null : N(row.critical_level_override) },
        stockVersion: row.stock_version == null ? 0 : N(row.stock_version),
        marginCents: hide || row.retail_price_cents == null || row.cost_cents == null ? null : N(row.retail_price_cents) - N(row.cost_cents) },
      bottles: bottles.map((u: any) => ({ id: String(u.id), status: u.status, lot: u.lot_number ?? null, expirationDate: u.expiration_date ?? null, barcode: u.internal_barcode ?? null,
        receivedAt: isoOf(u.received_at), openedAt: isoOf(u.opened_at), openedBy: u.opened_by ?? null, emptiedAt: isoOf(u.emptied_at), remainingPercent: u.estimated_remaining_percent == null ? null : N(u.estimated_remaining_percent),
        location: u.storage_location ?? null, expired: !!u.expiration_date && u.expiration_date < p.today && ['unopened', 'opened', 'low'].includes(u.status) })),
      suppliers: suppliers.map((v: any) => ({ id: String(v.id), name: v.name, phone: v.phone ?? null, email: v.email ?? null, active: !!v.active, supplierSku: v.supplier_sku ?? null,
        lastCostCents: hide ? null : v.last_cost_cents == null ? (v.last_po_cost == null ? null : N(v.last_po_cost)) : N(v.last_cost_cents), purchaseUnit: v.purchase_unit ?? null,
        unitsPerPurchaseUnit: v.units_per_purchase_unit == null ? null : N(v.units_per_purchase_unit), minimumOrderQty: v.minimum_order_qty == null ? null : N(v.minimum_order_qty),
        leadTimeDays: v.lead_time_days == null ? null : N(v.lead_time_days), preferred: !!v.is_preferred || !!v.is_product_preferred, lastOrderedAt: isoOf(v.last_ordered_at) })),
      purchaseOrders: orders.map((o: any) => ({ id: String(o.id), poNumber: o.po_number, status: o.status, expectedDate: o.expected_date ?? null, createdAt: isoOf(o.created_at),
        ordered: N(o.quantity_ordered), received: N(o.quantity_received), unitCostCents: hide ? null : N(o.unit_cost_cents), vendor: o.vendor_name ?? null })),
      audit: audit.map((a: any) => ({ id: String(a.id), action: a.action_type, at: isoOf(a.created_at), actor: a.actor ?? null, meta: a.metadata_json ?? null })),
      timeZone: p.tz, today: p.today,
    };
  }

  /** Stock movements (newest first): one product, or the branch's whole ledger. */
  async movements(ctx: InvCtx, q: Record<string, string | undefined>, period: Period, pg: Paging) {
    const b = this.branch(ctx); const prod = idOrNull(q.productId);
    const type = q.type && /^[a-z_]{3,40}$/.test(q.type) ? q.type : null;
    const base = sql`FROM inventory_stock_movements m JOIN inventory_products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id LEFT JOIN users au ON au.id = m.actor_user_id
      WHERE m.tenant_id = ${ctx.tenantId} AND m.branch_id = ${b} AND (${prod}::uuid IS NULL OR m.product_id = ${prod}) AND (${type}::text IS NULL OR m.movement_type = ${type})
        AND ${this.inPeriod(sql`m.created_at`, period)} AND ${prod ? sql`true` : this.productSearch(ctx, q.search)}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const rows = (await sql<any>`SELECT m.id, m.product_id, p.name, m.movement_type, m.quantity_before, m.quantity_change, m.quantity_after, m.related_type, m.related_id, m.reason, m.created_at,
        ${nameOf('au')} AS actor, (SELECT po.po_number FROM purchase_orders po WHERE m.related_type = 'purchase_order' AND po.id = m.related_id AND po.tenant_id = m.tenant_id) AS po_number
      ${base} ORDER BY m.created_at DESC, m.id DESC LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, period, rows: rows.map((r: any) => ({
      id: String(r.id), productId: String(r.product_id), product: r.name, type: r.movement_type, before: N(r.quantity_before), change: N(r.quantity_change), after: N(r.quantity_after),
      relatedType: r.related_type ?? null, relatedId: r.related_id ?? null, poNumber: r.po_number ?? null, reason: r.reason ?? null, at: isoOf(r.created_at), actor: r.actor ?? null,
    })) };
  }

  // ── Purchase orders (Inventory tab · Suppliers) ────────────────────────────────────────────────────────────────────
  async purchaseOrders(ctx: InvCtx, q: Record<string, string | undefined>, period: Period, pg: Paging) {
    const b = this.branch(ctx);
    const status = q.status === 'open' ? 'open' : q.status === 'active' ? 'active' : (PO_STATUSES as readonly string[]).includes(String(q.status)) ? q.status! : null;
    const vendor = idOrNull(q.vendorId); const product = idOrNull(q.productId);
    const dateField = pick(q.dateField, PO_DATE_FIELDS, 'created');
    const s = String(q.search ?? '').trim().slice(0, 100); const l = likeOf(s.toLowerCase()); const d = phoneDigits(s); const hasD = d.length >= 4 && !/[a-z]/i.test(s);
    const amount = /^\$?\d{1,7}(\.\d{1,2})?$/.test(s) ? Math.round(Number(s.replace('$', '')) * 100) : null;
    const dateCol = dateField === 'expected' ? this.dateInPeriod(sql`po.expected_date`, period) : dateField === 'approved' ? this.inPeriod(sql`po.approved_at`, period)
      : dateField === 'received' ? this.inPeriod(sql`po.received_at`, period) : this.inPeriod(sql`po.created_at`, period);
    const search = s ? sql`(lower(coalesce(po.po_number, '')) LIKE ${l} OR lower(coalesce(v.name, '')) LIKE ${l} OR lower(coalesce(v.trade_name, '')) LIKE ${l} OR lower(coalesce(po.notes, '')) LIKE ${l}
        OR (${hasD} AND regexp_replace(coalesce(v.phone, ''), '\\D', '', 'g') LIKE ${'%' + d + '%'})
        OR (${amount}::int IS NOT NULL AND po.total_cents = ${amount}::int)
        OR EXISTS (SELECT 1 FROM inventory_vendor_contacts vc WHERE vc.tenant_id = po.tenant_id AND vc.vendor_id = po.vendor_id AND (lower(vc.name) LIKE ${l} OR lower(coalesce(vc.email, '')) LIKE ${l}
             OR (${hasD} AND regexp_replace(coalesce(vc.mobile_phone, '') || ' ' || coalesce(vc.office_phone, ''), '\\D', '', 'g') LIKE ${'%' + d + '%'})))
        OR EXISTS (SELECT 1 FROM purchase_order_lines pl JOIN inventory_products p ON p.id = pl.product_id AND p.tenant_id = pl.tenant_id
             WHERE pl.purchase_order_id = po.id AND pl.tenant_id = po.tenant_id AND (lower(p.name) LIKE ${l} OR lower(coalesce(p.sku, '')) LIKE ${l} OR coalesce(p.barcode, '') = ${s})))` : sql`true`;
    const base = sql`FROM purchase_orders po LEFT JOIN inventory_vendors v ON v.id = po.vendor_id AND v.tenant_id = po.tenant_id LEFT JOIN branches bb ON bb.id = po.branch_id AND bb.tenant_id = po.tenant_id
      LEFT JOIN LATERAL (SELECT count(*)::int AS lines, coalesce(sum(pl.quantity_ordered), 0)::int AS ordered, coalesce(sum(pl.quantity_received), 0)::int AS received,
          coalesce(sum(greatest(pl.quantity_ordered - pl.quantity_received, 0)), 0)::int AS remaining,
          coalesce(sum(greatest(pl.quantity_ordered - pl.quantity_received, 0)::bigint * coalesce(pl.unit_cost_cents, 0)), 0)::bigint AS remaining_cents
        FROM purchase_order_lines pl WHERE pl.purchase_order_id = po.id AND pl.tenant_id = po.tenant_id) ln ON true
      WHERE po.tenant_id = ${ctx.tenantId} AND po.branch_id = ${b}
        AND ${status === 'open' ? sql`po.status IN ('draft', 'approved', 'ordered', 'partial')` : status === 'active' ? sql`po.status IN ('approved', 'ordered', 'partial')` : status ? sql`po.status = ${status}` : sql`true`}
        AND (${vendor}::uuid IS NULL OR po.vendor_id = ${vendor})
        AND (${product}::uuid IS NULL OR EXISTS (SELECT 1 FROM purchase_order_lines pl WHERE pl.purchase_order_id = po.id AND pl.tenant_id = po.tenant_id AND pl.product_id = ${product}))
        AND ${q.unlinked === 'true' ? sql`po.vendor_id IS NULL` : sql`true`} AND (${idOrNull(q.poId)}::uuid IS NULL OR po.id = ${idOrNull(q.poId)}) AND ${dateCol} AND ${search}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const exact = s ? sql`CASE WHEN lower(coalesce(po.po_number, '')) = ${s.toLowerCase()} THEN 0 ELSE 1 END,` : sql``;
    const order = q.sort === 'expected' ? sql`po.expected_date NULLS LAST, po.created_at DESC, po.id DESC` : q.sort === 'value' ? sql`po.total_cents DESC NULLS LAST, po.id DESC` : sql`po.created_at DESC, po.id DESC`;
    const rows = (await sql<any>`SELECT po.id, po.po_number, po.status, to_char(po.expected_date, 'YYYY-MM-DD') AS expected_date, po.created_at, po.approved_at, po.ordered_at, po.received_at, po.cancelled_at,
        po.subtotal_cents, po.shipping_cents, po.tax_cents, po.total_cents, po.notes, po.vendor_id, v.name AS vendor_name, v.active AS vendor_active, v.phone AS vendor_phone,
        bb.name AS branch_name, ln.lines, ln.ordered, ln.received, ln.remaining, ln.remaining_cents
      ${base} ORDER BY ${exact} ${order} LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    const hide = this.techOnly(ctx);
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, period, dateField, rows: rows.map((r: any) => ({
      id: String(r.id), poNumber: r.po_number ?? null, status: r.status, vendorId: r.vendor_id ?? null, vendor: r.vendor_name ?? null, vendorArchived: r.vendor_id ? r.vendor_active === false : false,
      vendorPhone: r.vendor_phone ?? null, branch: r.branch_name ?? null, createdAt: isoOf(r.created_at), approvedAt: isoOf(r.approved_at), receivedAt: isoOf(r.received_at), cancelledAt: isoOf(r.cancelled_at),
      expectedDate: r.expected_date ?? null, lines: N(r.lines), ordered: N(r.ordered), received: N(r.received), remaining: N(r.remaining),
      totalCents: hide ? null : N(r.total_cents), subtotalCents: hide ? null : N(r.subtotal_cents), shippingCents: hide ? null : N(r.shipping_cents), taxCents: hide ? null : N(r.tax_cents),
      remainingCents: hide ? null : N(r.remaining_cents), notes: r.notes ?? null,
      overdue: !!r.expected_date && r.expected_date < period.today && ['approved', 'ordered', 'partial'].includes(r.status),
    })) };
  }

  /** One purchase order with its lines and receiving history (the receipts that put stock on the shelf). */
  async purchaseOrder(ctx: InvCtx, id: string) {
    this.branch(ctx);
    if (!UUID.test(id)) throw withCode(new InventoryError(404, 'Purchase order not found'), 'PO_NOT_FOUND');
    const p = await this.period(ctx, { preset: 'all' });
    const one = (await this.purchaseOrders(ctx, { poId: id }, p, { page: 1, pageSize: 1 })).rows[0];
    if (!one) throw withCode(new InventoryError(404, 'Purchase order not found'), 'PO_NOT_FOUND');
    const hide = this.techOnly(ctx);
    const lines = (await sql<any>`SELECT pl.id, pl.product_id, p.name, p.sku, p.color_number, p.unit_type, pl.quantity_ordered, pl.quantity_received, pl.unit_cost_cents, pl.lot_number,
        to_char(pl.expiration_date, 'YYYY-MM-DD') AS expiration_date, vp.supplier_sku, vp.purchase_unit, pl.units_per_purchase_unit   -- the pack the order was placed in (snapshot)
      FROM purchase_order_lines pl JOIN inventory_products p ON p.id = pl.product_id AND p.tenant_id = pl.tenant_id
      JOIN purchase_orders po ON po.id = pl.purchase_order_id AND po.tenant_id = pl.tenant_id
      LEFT JOIN inventory_vendor_products vp ON vp.tenant_id = pl.tenant_id AND vp.vendor_id = po.vendor_id AND vp.product_id = pl.product_id
      WHERE pl.tenant_id = ${ctx.tenantId} AND pl.purchase_order_id = ${id} ORDER BY p.name, pl.id`.execute(this.db)).rows;
    const receipts = (await sql<any>`SELECT m.id, m.product_id, p.name, m.quantity_change, m.created_at, ${nameOf('au')} AS actor
      FROM inventory_stock_movements m JOIN inventory_products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id LEFT JOIN users au ON au.id = m.actor_user_id
      WHERE m.tenant_id = ${ctx.tenantId} AND m.related_type = 'purchase_order' AND m.related_id = ${id} ORDER BY m.created_at DESC, m.id DESC LIMIT 100`.execute(this.db)).rows;
    const contact = one.vendorId ? (await sql<any>`SELECT vc.name, vc.role, vc.mobile_phone, vc.office_phone, vc.email FROM inventory_vendor_contacts vc
      WHERE vc.tenant_id = ${ctx.tenantId} AND vc.vendor_id = ${one.vendorId} AND vc.active ORDER BY vc.is_primary DESC, vc.created_at LIMIT 1`.execute(this.db)).rows[0] : null;
    return {
      purchaseOrder: one,
      contact: contact ? { name: contact.name, role: contact.role ?? null, phone: contact.mobile_phone || contact.office_phone || null, email: contact.email ?? null } : null,
      lines: lines.map((l: any) => ({ id: String(l.id), productId: String(l.product_id), product: l.name, sku: l.sku ?? null, colorNumber: l.color_number ?? null, unit: l.unit_type || 'unit',
        ordered: N(l.quantity_ordered), received: N(l.quantity_received), remaining: Math.max(0, N(l.quantity_ordered) - N(l.quantity_received)),
        unitCostCents: hide ? null : N(l.unit_cost_cents), lineCents: hide ? null : N(l.unit_cost_cents) * N(l.quantity_ordered), lot: l.lot_number ?? null, expirationDate: l.expiration_date ?? null,
        supplierSku: l.supplier_sku ?? null, purchaseUnit: l.purchase_unit ?? null, unitsPerPurchaseUnit: l.units_per_purchase_unit == null ? null : N(l.units_per_purchase_unit) })),
      receipts: receipts.map((m: any) => ({ id: String(m.id), productId: String(m.product_id), product: m.name, quantity: N(m.quantity_change), at: isoOf(m.created_at), actor: m.actor ?? null })),
    };
  }

  // ── Transfers · Counts · Catalog · Recipes (each its own paged, searchable, dated list) ──────────────────────────────
  async transfers(ctx: InvCtx, q: Record<string, string | undefined>, period: Period, pg: Paging) {
    const b = this.branch(ctx); const s = String(q.search ?? '').trim().slice(0, 100); const l = likeOf(s.toLowerCase());
    const dir = q.direction === 'outbound' ? sql`t.from_branch_id = ${b}` : q.direction === 'inbound' ? sql`t.to_branch_id = ${b}` : sql`(t.from_branch_id = ${b} OR t.to_branch_id = ${b})`;
    const status = q.status && /^[a-z_]{3,20}$/.test(q.status) ? q.status : null;
    const base = sql`FROM inventory_transfers t LEFT JOIN branches fb ON fb.id = t.from_branch_id AND fb.tenant_id = t.tenant_id LEFT JOIN branches tb ON tb.id = t.to_branch_id AND tb.tenant_id = t.tenant_id
      LEFT JOIN users cu ON cu.id = t.created_by_user_id
      WHERE t.tenant_id = ${ctx.tenantId} AND ${dir} AND (${status}::text IS NULL OR t.status = ${status}) AND ${this.inPeriod(sql`t.created_at`, period)}
        AND (${s} = '' OR lower(coalesce(t.transfer_number, '')) LIKE ${l} OR lower(coalesce(fb.name, '')) LIKE ${l} OR lower(coalesce(tb.name, '')) LIKE ${l} OR lower(coalesce(t.notes, '')) LIKE ${l}
          OR EXISTS (SELECT 1 FROM inventory_transfer_lines tl JOIN inventory_products p ON p.id = tl.product_id AND p.tenant_id = tl.tenant_id WHERE tl.transfer_id = t.id AND tl.tenant_id = t.tenant_id AND (lower(p.name) LIKE ${l} OR lower(coalesce(p.sku, '')) LIKE ${l})))`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const rows = (await sql<any>`SELECT t.id, t.transfer_number, t.status, t.item_count, t.unit_count, t.notes, t.created_at, fb.name AS from_name, tb.name AS to_name, (t.from_branch_id = ${b}) AS outbound, ${nameOf('cu')} AS created_by
      ${base} ORDER BY t.created_at DESC, t.id DESC LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, period, rows: rows.map((r: any) => ({
      id: String(r.id), number: r.transfer_number ?? null, status: r.status, items: N(r.item_count), units: N(r.unit_count), notes: r.notes ?? null, createdAt: isoOf(r.created_at),
      from: r.from_name ?? null, to: r.to_name ?? null, outbound: !!r.outbound, createdBy: r.created_by ?? null,
    })) };
  }

  async counts(ctx: InvCtx, q: Record<string, string | undefined>, period: Period, pg: Paging) {
    const b = this.branch(ctx); const s = String(q.search ?? '').trim().slice(0, 100); const l = likeOf(s.toLowerCase());
    const status = q.status && /^[a-z_]{3,20}$/.test(q.status) ? q.status : null;
    const col = q.dateField === 'reconciled' ? sql`c.reconciled_at` : sql`c.created_at`;
    const base = sql`FROM inventory_counts c LEFT JOIN inventory_categories cat ON cat.id = c.scope_id AND c.scope_type = 'category' AND cat.tenant_id = c.tenant_id
      LEFT JOIN inventory_brands br ON br.id = c.scope_id AND c.scope_type = 'brand' AND br.tenant_id = c.tenant_id LEFT JOIN users su ON su.id = c.started_by_user_id LEFT JOIN users ru ON ru.id = c.reconciled_by_user_id
      WHERE c.tenant_id = ${ctx.tenantId} AND c.branch_id = ${b} AND (${status}::text IS NULL OR c.status = ${status}) AND ${this.inPeriod(col, period)}
        AND (${s} = '' OR lower(coalesce(c.count_number, '')) LIKE ${l} OR lower(coalesce(c.notes, '')) LIKE ${l} OR lower(coalesce(cat.name, br.name, '')) LIKE ${l})`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const rows = (await sql<any>`SELECT c.id, c.count_number, c.status, c.scope_type, c.line_count, c.counted_count, c.variance_units, c.created_at, c.reconciled_at, c.notes,
        coalesce(cat.name, br.name) AS scope_name, ${nameOf('su')} AS started_by, ${nameOf('ru')} AS reconciled_by
      ${base} ORDER BY c.created_at DESC, c.id DESC LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, period, rows: rows.map((r: any) => ({
      id: String(r.id), number: r.count_number ?? null, status: r.status, scopeType: r.scope_type ?? 'all', scope: r.scope_name ?? null, lines: N(r.line_count), counted: N(r.counted_count),
      variance: N(r.variance_units), createdAt: isoOf(r.created_at), reconciledAt: isoOf(r.reconciled_at), startedBy: r.started_by ?? null, reconciledBy: r.reconciled_by ?? null, notes: r.notes ?? null,
    })) };
  }

  async catalog(ctx: InvCtx, q: Record<string, string | undefined>, pg: Paging) {
    const kind = pick(q.kind, ['brand', 'category'] as const, 'brand'); const s = String(q.search ?? '').trim().slice(0, 100); const l = likeOf(s.toLowerCase());
    const table = kind === 'brand' ? sql`inventory_brands` : sql`inventory_categories`;
    const fk = kind === 'brand' ? sql`p.brand_id` : sql`p.category_id`;
    const base = sql`FROM ${table} x WHERE x.tenant_id = ${ctx.tenantId} AND x.active = true AND (${s} = '' OR lower(x.name) LIKE ${l} OR lower(coalesce(x.code, '')) LIKE ${l})`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const rows = (await sql<any>`SELECT x.id, x.name, x.code, x.created_at,
        (SELECT count(*)::int FROM inventory_products p WHERE p.tenant_id = x.tenant_id AND ${fk} = x.id AND p.archived_at IS NULL) AS products
      ${base} ORDER BY x.created_at DESC, x.id DESC LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { kind, total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, rows: rows.map((r: any) => ({ id: String(r.id), name: r.name, code: r.code ?? null, products: N(r.products), createdAt: isoOf(r.created_at) })) };
  }

  async recipes(ctx: InvCtx, q: Record<string, string | undefined>, pg: Paging) {
    const b = this.branch(ctx); const s = String(q.search ?? '').trim().slice(0, 100); const l = likeOf(s.toLowerCase());
    const base = sql`FROM services sv LEFT JOIN LATERAL (SELECT count(*)::int AS n, coalesce(sum(r.quantity), 0)::numeric AS units, string_agg(p.name, ', ' ORDER BY p.name) AS products
          FROM service_product_recipes r JOIN inventory_products p ON p.id = r.product_id AND p.tenant_id = r.tenant_id WHERE r.tenant_id = sv.tenant_id AND r.service_id = sv.id) rc ON true
      WHERE sv.tenant_id = ${ctx.tenantId} AND (sv.branch_id IS NULL OR sv.branch_id = ${b}) AND sv.archived_at IS NULL AND sv.status = 'active'
        AND (${s} = '' OR lower(sv.name) LIKE ${l} OR lower(coalesce(rc.products, '')) LIKE ${l})
        AND ${q.withRecipe === 'true' ? sql`rc.n > 0` : q.withRecipe === 'false' ? sql`rc.n = 0` : sql`true`}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const rows = (await sql<any>`SELECT sv.id, sv.name, sv.price_cents, rc.n, rc.units, rc.products ${base} ORDER BY sv.sort_order, lower(sv.name), sv.id LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, rows: rows.map((r: any) => ({ id: String(r.id), name: r.name, priceCents: r.price_cents == null ? null : N(r.price_cents), lines: N(r.n), units: Number(r.units ?? 0), products: r.products ?? null })) };
  }

  /** Pending technician bottle reports (the review queue), paged, newest first. */
  async reports(ctx: InvCtx, q: Record<string, string | undefined>, period: Period, pg: Paging) {
    const b = this.branch(ctx); const status = pick(q.status, ['pending', 'approved', 'rejected', 'all'] as const, 'pending');
    const base = sql`FROM inventory_technician_reports r JOIN inventory_products p ON p.id = r.product_id AND p.tenant_id = r.tenant_id LEFT JOIN users tu ON tu.id = r.technician_user_id
      WHERE r.tenant_id = ${ctx.tenantId} AND r.branch_id = ${b} AND ${status === 'all' ? sql`true` : sql`r.status = ${status}`} AND ${this.inPeriod(sql`r.created_at`, period)} AND ${this.productSearch(ctx, q.search)}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const rows = (await sql<any>`SELECT r.id, r.product_id, p.name, p.color_number, r.report_type, r.status, r.note, r.created_at, r.reported_quantity, r.estimated_remaining_percent, ${nameOf('tu')} AS technician
      ${base} ORDER BY r.created_at DESC, r.id DESC LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, period, rows: rows.map((r: any) => ({
      id: String(r.id), productId: String(r.product_id), product: r.name, colorNumber: r.color_number ?? null, type: r.report_type, status: r.status, note: r.note ?? null,
      createdAt: isoOf(r.created_at), quantity: r.reported_quantity == null ? null : N(r.reported_quantity), remainingPercent: r.estimated_remaining_percent == null ? null : N(r.estimated_remaining_percent), technician: r.technician ?? null,
    })) };
  }
}
