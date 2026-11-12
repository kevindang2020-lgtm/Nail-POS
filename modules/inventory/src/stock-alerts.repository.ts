// stock-alerts.repository.ts — Stock Alerts + Technician Product Usage mandate (Oct 29 2026): the READ side of POS Inventory →
// Stock Alerts (/tenant/inventory/stock-alerts/*). Raw SQL, always tenant + branch from the session.
//   * the alert SET is the canonical live state (stock-alert-state.ts — the same one the sidebar badge counts);
//     inventory_alerts rows add only the workflow (since / acknowledged by / resolved), so the page and the sidebar agree;
//   * "Last Used By" is the latest effective use by occurred_at DESC, id DESC — the technician usage ledger plus Service-Done
//     recipe deductions attributed to the ticket line's technician — never updated_at; "No recorded use" when none;
//   * lists page on the server, newest created first; the one universal search box reaches product, SKU, barcode / UPC,
//     brand, category, vendor name / phone, PO number and technician; the period filter has a date basis (when it was
//     used vs when it was recorded).
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import { liveAlertState, openAlertCount, onOrderSql } from './stock-alert-state';
import { formatQuantity } from './product-usage-core';
import { reorderSuggestion } from './inventory-core';
import { InventoryError, type InvCtx } from './inventory.service';
import type { InventoryLowStockCause } from '@aipowersalon/api-contracts/tenant';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const SEVERITIES = ['out_of_stock', 'critical', 'low'] as const;
export type Period = { preset: string; from: string | null; to: string | null; tz: string; today: string };
export type Paging = { page: number; pageSize: number };
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const N = (v: unknown): number => Number(v ?? 0) || 0;
const digits = (s: string) => s.replace(/\D/g, '');
/** A typed phone as stored digits: "(856) 555-1234", "856-555-1234" and "+1 856 555 1234" all become 8565551234. */
export const phoneDigits = (s: string) => { const d = digits(s); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d; };
export const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
export const isoOf = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
export function paging(page?: string, pageSize?: string, def = 12, max = 50): Paging {
  const ps = Math.min(max, Math.max(1, Math.trunc(Number(pageSize) || def)));
  return { page: Math.max(1, Math.trunc(Number(page) || 1)), pageSize: ps };
}
const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
export const csv = (head: string[], rows: unknown[][]) => [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export class StockAlertsRepository {
  constructor(protected readonly db: Kysely<DB>) {}

  protected branch(ctx: InvCtx): string {
    if (!ctx.branchId || !UUID.test(ctx.branchId)) throw withCode(new InventoryError(400, 'Choose a location first.'), 'LOCATION_REQUIRED');
    return ctx.branchId;
  }

  /** today / week / month / year / custom / all, as dates in the salon's time zone (bounds applied in SQL with that zone) —
   *  the same shape the POS period bar reads from every finance screen ({ preset, from, to, tz, today }). */
  async period(ctx: InvCtx, q: { preset?: string; from?: string; to?: string }): Promise<Period> {
    const b = this.branch(ctx);
    const tz = (await sql<{ tz: string | null }>`SELECT timezone AS tz FROM branches WHERE id = ${b} AND tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.tz || 'America/New_York';
    const r = (await sql<{ today: string; wk: string; mo: string; yr: string }>`SELECT to_char((now() AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS today,
        to_char(date_trunc('week', (now() AT TIME ZONE ${tz}))::date, 'YYYY-MM-DD') AS wk, to_char(date_trunc('month', (now() AT TIME ZONE ${tz}))::date, 'YYYY-MM-DD') AS mo,
        to_char(date_trunc('year', (now() AT TIME ZONE ${tz}))::date, 'YYYY-MM-DD') AS yr`.execute(this.db)).rows[0];
    const preset = ['today', 'week', 'month', 'year', 'custom', 'all'].includes(String(q.preset)) ? String(q.preset) : 'all';
    if (preset === 'all') return { preset, from: null, to: null, tz, today: r.today };
    if (preset === 'custom') {
      const from = YMD.test(String(q.from)) ? String(q.from) : null; const to = YMD.test(String(q.to)) ? String(q.to) : from;
      if (!from || !to || to < from) throw withCode(new InventoryError(400, 'The start date must be on or before the end date.'), 'DATE_RANGE_INVALID');
      return { preset, from, to, tz, today: r.today };
    }
    const from = preset === 'today' ? r.today : preset === 'week' ? r.wk : preset === 'month' ? r.mo : r.yr;
    return { preset, from, to: r.today, tz, today: r.today };
  }
  /** `col` within the period (dates in the salon's zone; `to` inclusive). */
  protected inPeriod(col: RawBuilder<unknown>, p: Period): RawBuilder<unknown> {
    if (!p.from || !p.to) return sql`true`;
    return sql`(${col} >= (${p.from}::date)::timestamp AT TIME ZONE ${p.tz} AND ${col} < ((${p.to}::date + 1))::timestamp AT TIME ZONE ${p.tz})`;
  }

  /** The one search box, as a predicate on product `p` (and the alert / usage rows it leads to). */
  protected productSearch(ctx: InvCtx, term: string | undefined): RawBuilder<unknown> {
    const s = String(term ?? '').trim().slice(0, 100);
    if (!s) return sql`true`;
    const l = like(s.toLowerCase()); const d = phoneDigits(s); const dl = '%' + d + '%'; const hasD = d.length >= 4 && !/[a-z]/i.test(s);
    return sql`(lower(p.name) LIKE ${l} OR lower(coalesce(p.sku, '')) LIKE ${l} OR coalesce(p.barcode, '') LIKE ${like(s)} OR coalesce(p.upc, '') LIKE ${like(s)}
      OR lower(coalesce(p.color_number, '')) LIKE ${l} OR lower(coalesce(p.color_name, '')) LIKE ${l}
      OR EXISTS (SELECT 1 FROM inventory_brands br WHERE br.id = p.brand_id AND br.tenant_id = p.tenant_id AND lower(br.name) LIKE ${l})
      OR EXISTS (SELECT 1 FROM inventory_categories c WHERE c.id = p.category_id AND c.tenant_id = p.tenant_id AND lower(c.name) LIKE ${l})
      OR EXISTS (SELECT 1 FROM inventory_vendors v WHERE v.id = p.preferred_vendor_id AND v.tenant_id = p.tenant_id AND (lower(v.name) LIKE ${l} OR (${hasD} AND regexp_replace(coalesce(v.phone, ''), '\\D', '', 'g') LIKE ${dl})))
      OR EXISTS (SELECT 1 FROM inventory_vendor_products vp JOIN inventory_vendors v ON v.id = vp.vendor_id AND v.tenant_id = vp.tenant_id
                  WHERE vp.tenant_id = ${ctx.tenantId} AND vp.product_id = p.id AND vp.active
                    AND (lower(coalesce(vp.supplier_sku, '')) LIKE ${l} OR lower(v.name) LIKE ${l} OR (${hasD} AND regexp_replace(coalesce(v.phone, ''), '\\D', '', 'g') LIKE ${dl})))
      OR EXISTS (SELECT 1 FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id AND po.tenant_id = ${ctx.tenantId}
                  WHERE pl.product_id = p.id AND lower(po.po_number) LIKE ${l})
      OR EXISTS (SELECT 1 FROM product_usage_events ue JOIN technicians t ON t.id = ue.technician_id AND t.tenant_id = ue.tenant_id
                  WHERE ue.tenant_id = ${ctx.tenantId} AND ue.product_id = p.id AND lower(coalesce(nullif(t.full_name, ''), t.first_name || ' ' || coalesce(t.last_name, ''))) LIKE ${l}))`;
  }

  /** Every attributable use of stock at this branch, as one row set: the usage ledger (effective quantity after corrections)
   *  and Service-Done recipe deductions (the ticket line's technician). Columns: product_id, technician_id, occurred_at,
   *  recorded_at, hundredths, source, event_id, id (tie-break). */
  protected uses(ctx: InvCtx, b: string): RawBuilder<unknown> {
    return sql`(
      SELECT e.product_id, e.technician_id, e.occurred_at, e.created_at AS recorded_at, e.source, e.id AS event_id, e.id AS id,
             (e.quantity_hundredths + coalesce((SELECT sum(a.delta_hundredths) FROM product_usage_adjustments a WHERE a.tenant_id = e.tenant_id AND a.usage_event_id = e.id), 0))::int AS hundredths
        FROM product_usage_events e WHERE e.tenant_id = ${ctx.tenantId} AND e.branch_id = ${b}
      UNION ALL
      SELECT m.product_id, l.technician_id, m.created_at AS occurred_at, m.created_at AS recorded_at, 'service_recipe' AS source, NULL::uuid AS event_id, m.id AS id,
             -- the exact amount a recipe took (audit D9); older rows recorded whole bottles only
             coalesce((m.metadata_json->>'quantityHundredths')::int, (greatest(0, -coalesce(m.quantity_change, 0)) * 100)::int) AS hundredths
        FROM inventory_stock_movements m LEFT JOIN ticket_service_lines l ON m.related_type = 'ticket_line' AND l.id = m.related_id AND l.tenant_id = m.tenant_id
       WHERE m.tenant_id = ${ctx.tenantId} AND m.branch_id = ${b} AND m.movement_type = 'service_usage'
    )`;
  }
  /** The latest effective use of each product (occurred_at DESC, id DESC): technician id / name, when. */
  protected lastUse(ctx: InvCtx, b: string): RawBuilder<unknown> {
    return sql`(SELECT DISTINCT ON (u.product_id) u.product_id, u.technician_id, u.occurred_at, u.source, u.hundredths,
        coalesce(nullif(t.full_name, ''), trim(t.first_name || ' ' || coalesce(t.last_name, ''))) AS technician_name
      FROM ${this.uses(ctx, b)} u LEFT JOIN technicians t ON t.id = u.technician_id AND t.tenant_id = ${ctx.tenantId}
      WHERE u.hundredths > 0 ORDER BY u.product_id, u.occurred_at DESC, u.id DESC)`;
  }
  protected lastUsedOut(r: any) {
    if (!r.last_used_at) return { lastUsedBy: null, lastUsedAt: null, lastUsedLabel: 'No recorded use' };
    const who = r.last_tech_id ? r.last_tech_name || 'Technician' : 'Unknown / Historical';
    return { lastUsedBy: who, lastUsedTechnicianId: r.last_tech_id ?? null, lastUsedAt: iso(r.last_used_at), lastUsedLabel: who, lastUsedQuantity: r.last_qty == null ? null : formatQuantity(N(r.last_qty)), lastUsedSource: r.last_source ?? null };
  }

  // ── KPIs ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  async summary(ctx: InvCtx) {
    const b = this.branch(ctx); const p = await this.period(ctx, { preset: 'today' });
    const live = (await sql<{ severity: string; n: number; acked: number }>`SELECT la.severity, count(*)::int AS n,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM inventory_alerts a WHERE a.tenant_id = ${ctx.tenantId} AND a.branch_id = ${b} AND a.product_id = la.product_id AND a.resolved_at IS NULL AND a.acknowledged_at IS NOT NULL))::int AS acked
      FROM (${liveAlertState(ctx.tenantId, b)}) la GROUP BY la.severity`.execute(this.db)).rows;
    const open = N((await openAlertCount(ctx.tenantId, b).execute(this.db)).rows[0]?.n);
    const by = (s: string) => live.find((r) => r.severity === s);
    const today = (await sql<{ uses: number; techs: number }>`SELECT count(*)::int AS uses, count(DISTINCT e.technician_id)::int AS techs FROM product_usage_events e
      WHERE e.tenant_id = ${ctx.tenantId} AND e.branch_id = ${b} AND e.status = 'confirmed' AND ${this.inPeriod(sql`e.occurred_at`, p)}`.execute(this.db)).rows[0];
    return {
      openAlerts: open, outOfStock: N(by('out_of_stock')?.n), critical: N(by('critical')?.n), low: N(by('low')?.n),
      acknowledged: live.reduce((n, r) => n + N(r.acked), 0), totalAlerts: live.reduce((n, r) => n + N(r.n), 0),
      productUsesToday: N(today?.uses), activeTechniciansToday: N(today?.techs), timeZone: p.tz,
      definitions: {
        openAlerts: 'Active products at this location at or below their reorder level (location overrides applied), not acknowledged — the same number as the sidebar.',
        outOfStock: 'Alerts with nothing usable on hand.', critical: 'Alerts at or below the critical level (half the reorder level when none is set).',
        productUsesToday: 'Confirmed technician product uses that happened today (salon time).', activeTechniciansToday: 'Technicians with at least one product use today.',
      },
    };
  }

  // ── Active Alerts ───────────────────────────────────────────────────────────────────────────────────────────────────
  async activeAlerts(ctx: InvCtx, q: { search?: string; severity?: string; showAcknowledged?: string }, pg: Paging) {
    const b = this.branch(ctx);
    const sev = (SEVERITIES as readonly string[]).includes(String(q.severity)) ? String(q.severity) : null;
    const showAck = q.showAcknowledged === 'true' || q.showAcknowledged === '1';
    const base = sql`FROM (${liveAlertState(ctx.tenantId, b)}) la
      JOIN inventory_products p ON p.id = la.product_id AND p.tenant_id = ${ctx.tenantId}
      LEFT JOIN LATERAL (SELECT a.id, a.created_at, a.acknowledged_at, a.acknowledged_by_user_id FROM inventory_alerts a
                          WHERE a.tenant_id = ${ctx.tenantId} AND a.branch_id = ${b} AND a.product_id = la.product_id AND a.resolved_at IS NULL ORDER BY a.created_at DESC LIMIT 1) wa ON true
      LEFT JOIN inventory_brands br ON br.id = p.brand_id AND br.tenant_id = p.tenant_id
      LEFT JOIN inventory_categories c ON c.id = p.category_id AND c.tenant_id = p.tenant_id
      LEFT JOIN inventory_vendors v ON v.id = la.preferred_vendor_id AND v.tenant_id = p.tenant_id
      LEFT JOIN users au ON au.id = wa.acknowledged_by_user_id
      LEFT JOIN ${this.lastUse(ctx, b)} lu ON lu.product_id = la.product_id
      WHERE (${sev}::text IS NULL OR la.severity = ${sev}) AND (${showAck}::boolean OR wa.acknowledged_at IS NULL) AND ${this.productSearch(ctx, q.search)}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pages = Math.max(1, Math.ceil(total / pg.pageSize)); const page = Math.min(pg.page, pages);
    const rows = (await sql<any>`SELECT la.product_id, la.severity, la.on_hand, la.reorder_level, la.critical_level, la.reorder_quantity,
        p.name, p.sku, p.barcode, p.color_number, p.unit_type, br.name AS brand_name, c.name AS category_name, v.id AS vendor_id, v.name AS vendor_name, v.phone AS vendor_phone,
        wa.id AS alert_id, wa.created_at AS alert_since, wa.acknowledged_at, wa.acknowledged_by_user_id,
        coalesce(nullif(au.full_name, ''), nullif(trim(coalesce(au.first_name, '') || ' ' || coalesce(au.last_name, '')), ''), au.email) AS acknowledged_by_name,
        ${onOrderSql(ctx.tenantId, b, sql`la.product_id`)} AS on_order,   -- committed orders only: a draft is not on order
        (SELECT string_agg(DISTINCT po.po_number, ', ') FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id
          WHERE po.tenant_id = ${ctx.tenantId} AND po.branch_id = ${b} AND pl.product_id = la.product_id AND po.status IN ('approved', 'ordered', 'partial')) AS open_pos,
        (SELECT string_agg(DISTINCT po.po_number, ', ') FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id
          WHERE po.tenant_id = ${ctx.tenantId} AND po.branch_id = ${b} AND pl.product_id = la.product_id AND po.status = 'draft') AS draft_pos,
        lu.technician_id AS last_tech_id, lu.technician_name AS last_tech_name, lu.occurred_at AS last_used_at, lu.hundredths AS last_qty, lu.source AS last_source
      ${base}
      ORDER BY wa.created_at DESC NULLS LAST, CASE la.severity WHEN 'out_of_stock' THEN 0 WHEN 'critical' THEN 1 ELSE 2 END, p.name, la.product_id
      LIMIT ${pg.pageSize} OFFSET ${(page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return {
      total, page, pageSize: pg.pageSize, pages,
      rows: rows.map((r: any) => ({
        productId: String(r.product_id), alertId: r.alert_id ?? null, name: r.name, sku: r.sku ?? null, barcode: r.barcode ?? null, colorNumber: r.color_number ?? null, unit: r.unit_type || 'unit',
        brand: r.brand_name ?? null, category: r.category_name ?? null, vendorId: r.vendor_id ?? null, vendor: r.vendor_name ?? null, vendorPhone: r.vendor_phone ?? null,
        severity: r.severity, onHand: N(r.on_hand), reorderLevel: N(r.reorder_level), criticalLevel: N(r.critical_level),
        suggestedReorder: reorderSuggestion(N(r.on_hand), N(r.reorder_level), N(r.reorder_quantity), N(r.on_order)), onOrder: N(r.on_order), openPurchaseOrders: r.open_pos ?? null, draftPurchaseOrders: r.draft_pos ?? null,
        since: iso(r.alert_since), acknowledgedAt: iso(r.acknowledged_at), acknowledgedBy: r.acknowledged_by_name ?? null,
        ...this.lastUsedOut(r),
      })),
    };
  }

  /** Acknowledge a live alert by product: the open workflow row, or — for a product that was already low before alert
   *  tracking (no row; the old page showed nothing) — a new row for the current episode, acknowledged at once. */
  async acknowledge(ctx: InvCtx, productId: string, note: string | null) {
    const b = this.branch(ctx);
    if (!UUID.test(productId)) throw withCode(new InventoryError(404, 'That alert could not be found.'), 'ALERT_NOT_FOUND');
    return this.db.transaction().execute(async (trx) => {
      const live = (await sql<{ severity: string; on_hand: number }>`SELECT la.severity, la.on_hand FROM (${liveAlertState(ctx.tenantId, b)}) la WHERE la.product_id = ${productId}`.execute(trx)).rows[0];
      if (!live) throw withCode(new InventoryError(404, 'That alert could not be found.'), 'ALERT_NOT_FOUND');
      await sql`SELECT id FROM inventory_location_stock WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${b} AND product_id = ${productId} FOR UPDATE`.execute(trx);
      let row = (await sql<{ id: string; acknowledged_at: unknown }>`SELECT id, acknowledged_at FROM inventory_alerts WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${b} AND product_id = ${productId} AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`.execute(trx)).rows[0];
      if (!row) row = (await sql<{ id: string; acknowledged_at: unknown }>`INSERT INTO inventory_alerts (tenant_id, branch_id, product_id, status, on_hand) VALUES (${ctx.tenantId}, ${b}, ${productId}, ${live.severity}, ${N(live.on_hand)}) RETURNING id, acknowledged_at`.execute(trx)).rows[0];
      if (row.acknowledged_at) return { ok: true, alertId: String(row.id), alreadyAcknowledged: true };
      await sql`UPDATE inventory_alerts SET acknowledged_at = now(), acknowledged_by_user_id = ${UUID.test(ctx.userId) ? ctx.userId : null} WHERE id = ${row.id} AND tenant_id = ${ctx.tenantId}`.execute(trx);
      return { ok: true, alertId: String(row.id), alreadyAcknowledged: false, severity: live.severity, onHand: N(live.on_hand) };
    });
  }

  // ── Alert History ───────────────────────────────────────────────────────────────────────────────────────────────────
  async history(ctx: InvCtx, q: { search?: string; severity?: string }, period: Period, pg: Paging) {
    const b = this.branch(ctx);
    const sev = (SEVERITIES as readonly string[]).includes(String(q.severity)) ? String(q.severity) : null;
    const base = sql`FROM inventory_alerts a JOIN inventory_products p ON p.id = a.product_id AND p.tenant_id = a.tenant_id
      LEFT JOIN users u ON u.id = a.acknowledged_by_user_id
      WHERE a.tenant_id = ${ctx.tenantId} AND a.branch_id = ${b} AND (${sev}::text IS NULL OR a.status = ${sev}) AND ${this.inPeriod(sql`a.created_at`, period)} AND ${this.productSearch(ctx, q.search)}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pages = Math.max(1, Math.ceil(total / pg.pageSize)); const page = Math.min(pg.page, pages);
    const rows = (await sql<any>`SELECT a.id, a.product_id, a.status, a.on_hand, a.created_at, a.acknowledged_at, a.resolved_at, p.name, p.sku,
        coalesce(nullif(u.full_name, ''), nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''), u.email) AS acknowledged_by_name
      ${base}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${pg.pageSize} OFFSET ${(page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page, pageSize: pg.pageSize, pages, period, rows: rows.map((r: any) => ({
      id: String(r.id), productId: String(r.product_id), name: r.name, sku: r.sku ?? null, severity: r.status, onHandAtAlert: N(r.on_hand),
      createdAt: iso(r.created_at), acknowledgedAt: iso(r.acknowledged_at), acknowledgedBy: r.acknowledged_by_name ?? null, resolvedAt: iso(r.resolved_at),
      state: r.resolved_at ? 'resolved' : r.acknowledged_at ? 'acknowledged' : 'open',
    })) };
  }

  // ── Product Usage (per product) ─────────────────────────────────────────────────────────────────────────────────────
  async productUsage(ctx: InvCtx, q: { search?: string; technicianId?: string; dateBasis?: string }, period: Period, pg: Paging) {
    const b = this.branch(ctx);
    const col = q.dateBasis === 'recorded' ? sql`u.recorded_at` : sql`u.occurred_at`;
    const tech = q.technicianId && UUID.test(q.technicianId) ? q.technicianId : null;
    const base = sql`FROM ${this.uses(ctx, b)} u JOIN inventory_products p ON p.id = u.product_id AND p.tenant_id = ${ctx.tenantId}
      WHERE u.hundredths > 0 AND ${this.inPeriod(col, period)} AND (${tech}::uuid IS NULL OR u.technician_id = ${tech}) AND ${this.productSearch(ctx, q.search)}`;
    const total = N((await sql<{ n: number }>`SELECT count(DISTINCT u.product_id)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pages = Math.max(1, Math.ceil(total / pg.pageSize)); const page = Math.min(pg.page, pages);
    const rows = (await sql<any>`SELECT g.*, p.name, p.sku, p.unit_type, coalesce(s.quantity_on_hand, 0)::int AS on_hand,
        lu.technician_id AS last_tech_id, lu.technician_name AS last_tech_name, lu.occurred_at AS last_used_at, lu.hundredths AS last_qty, lu.source AS last_source
      FROM (SELECT u.product_id, sum(u.hundredths)::int AS hundredths, count(*)::int AS uses, count(DISTINCT u.technician_id)::int AS technicians,
                   count(*) FILTER (WHERE u.technician_id IS NULL)::int AS unattributed, max(u.recorded_at) AS last_recorded ${base} GROUP BY u.product_id) g
      JOIN inventory_products p ON p.id = g.product_id AND p.tenant_id = ${ctx.tenantId}
      LEFT JOIN inventory_location_stock s ON s.product_id = g.product_id AND s.tenant_id = ${ctx.tenantId} AND s.branch_id = ${b}
      LEFT JOIN ${this.lastUse(ctx, b)} lu ON lu.product_id = g.product_id
      ORDER BY g.last_recorded DESC, g.product_id LIMIT ${pg.pageSize} OFFSET ${(page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page, pageSize: pg.pageSize, pages, period, dateBasis: q.dateBasis === 'recorded' ? 'recorded' : 'occurred', rows: rows.map((r: any) => ({
      productId: String(r.product_id), name: r.name, sku: r.sku ?? null, unit: r.unit_type || 'unit', onHand: N(r.on_hand),
      used: formatQuantity(N(r.hundredths)), usedHundredths: N(r.hundredths), uses: N(r.uses), technicians: N(r.technicians), unattributedUses: N(r.unattributed),
      ...this.lastUsedOut(r),
    })) };
  }

  /** One product's ledger: every technician who used it (totals), and every use, newest recorded first. */
  async productLedger(ctx: InvCtx, productId: string, q: { dateBasis?: string }, period: Period, pg: Paging) {
    const b = this.branch(ctx);
    if (!UUID.test(productId)) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const prod = (await sql<any>`SELECT p.id, p.name, p.sku, p.unit_type, coalesce(s.quantity_on_hand, 0)::int AS on_hand,
        coalesce(s.reorder_level_override, p.reorder_level, 0)::int AS reorder_level, coalesce(s.critical_level_override, p.critical_level) AS critical_level,
        (SELECT max(e.created_at) FROM product_usage_events e WHERE e.tenant_id = p.tenant_id AND e.branch_id = ${b} AND e.product_id = p.id) AS last_recorded
      FROM inventory_products p
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${b} WHERE p.id = ${productId} AND p.tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0];
    if (!prod) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const col = q.dateBasis === 'recorded' ? sql`u.recorded_at` : sql`u.occurred_at`;
    const base = sql`FROM ${this.uses(ctx, b)} u LEFT JOIN technicians t ON t.id = u.technician_id AND t.tenant_id = ${ctx.tenantId}
      LEFT JOIN product_usage_events e ON e.id = u.event_id AND e.tenant_id = ${ctx.tenantId}
      WHERE u.product_id = ${productId} AND ${this.inPeriod(col, period)}`;
    const byTech = (await sql<any>`SELECT u.technician_id, max(coalesce(nullif(t.full_name, ''), trim(t.first_name || ' ' || coalesce(t.last_name, '')))) AS name,
        sum(greatest(u.hundredths, 0))::int AS hundredths, count(*) FILTER (WHERE u.hundredths > 0)::int AS uses, max(u.occurred_at) FILTER (WHERE u.hundredths > 0) AS last_at
      ${base} GROUP BY u.technician_id ORDER BY sum(greatest(u.hundredths, 0)) DESC, u.technician_id`.execute(this.db)).rows;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pages = Math.max(1, Math.ceil(total / pg.pageSize)); const page = Math.min(pg.page, pages);
    const events = (await sql<any>`SELECT u.id, u.event_id, u.technician_id, u.occurred_at, u.recorded_at, u.source, u.hundredths,
        coalesce(nullif(t.full_name, ''), trim(t.first_name || ' ' || coalesce(t.last_name, ''))) AS name, e.status, e.note, e.on_behalf_reason, e.quantity_hundredths
      ${base}
      ORDER BY u.recorded_at DESC, u.id DESC LIMIT ${pg.pageSize} OFFSET ${(page - 1) * pg.pageSize}`.execute(this.db)).rows;
    const last = (await sql<any>`SELECT lu.technician_id AS last_tech_id, lu.technician_name AS last_tech_name, lu.occurred_at AS last_used_at, lu.hundredths AS last_qty, lu.source AS last_source FROM ${this.lastUse(ctx, b)} lu WHERE lu.product_id = ${productId}`.execute(this.db)).rows[0] ?? {};
    return {
      product: { id: String(prod.id), name: prod.name, sku: prod.sku ?? null, unit: prod.unit_type || 'unit', onHand: N(prod.on_hand), reorderLevel: N(prod.reorder_level),
        criticalLevel: prod.critical_level == null ? (N(prod.reorder_level) > 0 ? Math.ceil(N(prod.reorder_level) / 2) : 0) : N(prod.critical_level) },
      ...this.lastUsedOut(last), lastRecordedAt: iso(prod.last_recorded), period,
      byTechnician: byTech.map((r: any) => ({ technicianId: r.technician_id ?? null, name: r.technician_id ? r.name || 'Technician' : 'Unknown / Historical', used: formatQuantity(N(r.hundredths)), usedHundredths: N(r.hundredths), uses: N(r.uses), lastUsedAt: iso(r.last_at) })),
      total, page, pageSize: pg.pageSize, pages,
      events: events.map((r: any) => ({
        id: String(r.id), eventId: r.event_id ?? null, technicianId: r.technician_id ?? null, technician: r.technician_id ? r.name || 'Technician' : 'Unknown / Historical',
        occurredAt: iso(r.occurred_at), recordedAt: iso(r.recorded_at), source: r.source, quantity: formatQuantity(N(r.event_id ? r.quantity_hundredths : r.hundredths)),
        effective: formatQuantity(N(r.hundredths)), corrected: !!r.event_id && N(r.quantity_hundredths) !== N(r.hundredths), status: r.status ?? 'confirmed', note: r.note ?? null, onBehalfReason: r.on_behalf_reason ?? null,
      })),
    };
  }

  /** Low-Stock Cause Explanation (Extras · Stock Alerts 12): the measured movements of the last `days` days by kind
   *  (usage, receiving, losses, corrections), open purchase orders, the last receipt, and whether the ledger agrees with
   *  on-hand. Every cause named is a measured fact; when nothing explains it, it says so instead of guessing. */
  async lowStockCause(ctx: InvCtx, productId: string, days = 30) {
    const b = this.branch(ctx);
    if (!UUID.test(productId)) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const prod = (await sql<any>`SELECT p.id, p.name, coalesce(s.quantity_on_hand, 0)::int AS on_hand, coalesce(s.reorder_level_override, p.reorder_level, 0)::int AS reorder_level, coalesce(s.reorder_quantity_override, p.reorder_quantity, 0)::int AS reorder_quantity
      FROM inventory_products p LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${b}
      WHERE p.id = ${productId} AND p.tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0];
    if (!prod) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const D = Math.min(365, Math.max(1, Math.trunc(days) || 30));
    const types = (await sql<any>`SELECT movement_type, coalesce(sum(quantity_change), 0)::int AS change, count(*)::int AS n FROM inventory_stock_movements
      WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${b} AND product_id = ${productId} AND created_at >= now() - make_interval(days => ${D}) GROUP BY movement_type ORDER BY movement_type`.execute(this.db)).rows;
    const last = (await sql<any>`SELECT quantity_after FROM inventory_stock_movements WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${b} AND product_id = ${productId}
      ORDER BY created_at DESC, id DESC LIMIT 1`.execute(this.db)).rows[0];
    const rec = (await sql<any>`SELECT max(created_at) AS at FROM inventory_stock_movements WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${b} AND product_id = ${productId}
      AND movement_type IN ('purchase_received', 'transfer_in', 'manual_add', 'opening_balance')`.execute(this.db)).rows[0];
    const tz = (await sql<{ tz: string | null }>`SELECT timezone AS tz FROM branches WHERE id = ${b} AND tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0]?.tz || 'America/New_York';   // the salon's day, not the server's
    const po = (await sql<any>`SELECT coalesce(sum(l.quantity_ordered - l.quantity_received), 0)::int AS qty, count(DISTINCT o.id)::int AS orders, min(o.expected_date)::text AS expected,
        bool_or(o.expected_date < (now() AT TIME ZONE ${tz})::date) AS overdue
      FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.purchase_order_id AND o.tenant_id = l.tenant_id
      WHERE l.tenant_id = ${ctx.tenantId} AND o.branch_id = ${b} AND l.product_id = ${productId} AND o.status IN ('approved', 'ordered', 'partial') AND l.quantity_received < l.quantity_ordered`.execute(this.db)).rows[0];
    const partly = N((await sql<any>`SELECT count(*)::int AS n FROM purchase_order_lines l JOIN purchase_orders o ON o.id = l.purchase_order_id AND o.tenant_id = l.tenant_id
      WHERE l.tenant_id = ${ctx.tenantId} AND o.branch_id = ${b} AND l.product_id = ${productId} AND o.status IN ('approved', 'ordered', 'partial') AND l.quantity_received > 0 AND l.quantity_received < l.quantity_ordered`.execute(this.db)).rows[0]?.n);
    const lastRec = (await sql<any>`SELECT quantity_change FROM inventory_stock_movements WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${b} AND product_id = ${productId}
      AND movement_type IN ('purchase_received', 'transfer_in', 'manual_add', 'opening_balance') ORDER BY created_at DESC, id DESC LIMIT 1`.execute(this.db)).rows[0];
    const KIND: Record<string, 'usage' | 'received' | 'losses' | 'corrections'> = {
      service_usage: 'usage', technician_usage: 'usage', bottle_opened: 'usage', usage_correction: 'usage',
      purchase_received: 'received', transfer_in: 'received', manual_add: 'received', opening_balance: 'received', customer_return: 'received', returned: 'received',
      damaged: 'losses', expired: 'losses', return_to_vendor: 'losses', transfer_out: 'losses', correction: 'corrections', count_adjustment: 'corrections',
    };
    const buckets = { usage: 0, received: 0, losses: 0, corrections: 0, other: 0 };
    for (const t of types) buckets[KIND[String(t.movement_type)] ?? 'other'] += N(t.change);
    const onHand = N(prod.on_hand); const reorder = N(prod.reorder_level);
    const ledgerAfter = last && last.quantity_after != null ? N(last.quantity_after) : null;
    const consistent = ledgerAfter == null ? null : ledgerAfter === onHand;
    const out = { usage: Math.max(0, -buckets.usage), losses: Math.max(0, -buckets.losses) };
    const causes: InventoryLowStockCause['causes'] = [];
    if (!types.length) causes.push('no_movements');
    if (out.usage > 0 && out.usage >= out.losses) causes.push('usage');
    if (out.losses > 0 && out.losses >= (out.usage + out.losses) / 4) causes.push('losses');
    if (types.length && buckets.received <= 0) causes.push(N(po?.qty) > 0 && po?.overdue ? 'receiving_delayed' : 'no_receiving');
    else if (N(po?.qty) > 0 && po?.overdue) causes.push('receiving_delayed');
    if (buckets.corrections < 0) causes.push('corrections');
    if (consistent === false) causes.push('inconsistent');
    return {
      product: { id: String(prod.id), name: String(prod.name), onHand, reorderLevel: reorder, low: onHand <= reorder },
      days: D, buckets, byType: types.map((t: any) => ({ type: String(t.movement_type), change: N(t.change), count: N(t.n) })),
      lastReceivedAt: iso(rec?.at), openOrders: { quantity: N(po?.qty), orders: N(po?.orders), expectedDate: po?.expected ?? null, overdue: !!po?.overdue },
      ledgerAfter, consistent, causes,
      reorder: { reorderQuantity: N(prod.reorder_quantity), onOrder: N(po?.qty), suggested: reorderSuggestion(onHand, reorder, N(prod.reorder_quantity), N(po?.qty)),
        partlyReceivedLines: partly, receivedInWindow: buckets.received, lastReceiptQuantity: lastRec ? N(lastRec.quantity_change) : null },
    } satisfies InventoryLowStockCause;
  }

  // ── All Technicians ─────────────────────────────────────────────────────────────────────────────────────────────────
  async technicians(ctx: InvCtx, q: { search?: string; dateBasis?: string }, period: Period, pg: Paging) {
    const b = this.branch(ctx);
    const col = q.dateBasis === 'recorded' ? sql`u.recorded_at` : sql`u.occurred_at`;
    const s = String(q.search ?? '').trim().toLowerCase().slice(0, 100);
    const name = sql`coalesce(nullif(t.full_name, ''), trim(t.first_name || ' ' || coalesce(t.last_name, '')))`;
    const base = sql`FROM ${this.uses(ctx, b)} u LEFT JOIN technicians t ON t.id = u.technician_id AND t.tenant_id = ${ctx.tenantId}
      JOIN inventory_products p ON p.id = u.product_id AND p.tenant_id = ${ctx.tenantId}
      WHERE u.hundredths > 0 AND ${this.inPeriod(col, period)} AND (${s} = '' OR lower(coalesce(${name}, 'unknown / historical')) LIKE ${like(s)} OR ${this.productSearch(ctx, s)})`;
    const total = N((await sql<{ n: number }>`SELECT count(DISTINCT coalesce(u.technician_id::text, '-'))::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pages = Math.max(1, Math.ceil(total / pg.pageSize)); const page = Math.min(pg.page, pages);
    const rows = (await sql<any>`SELECT u.technician_id, max(${name}) AS name, count(*)::int AS uses, count(DISTINCT u.product_id)::int AS products, sum(u.hundredths)::int AS hundredths,
        max(u.occurred_at) AS last_at, (array_agg(p.name ORDER BY u.occurred_at DESC, u.id DESC))[1] AS last_product, max(u.recorded_at) AS last_recorded
      ${base} GROUP BY u.technician_id ORDER BY max(u.recorded_at) DESC, u.technician_id NULLS LAST LIMIT ${pg.pageSize} OFFSET ${(page - 1) * pg.pageSize}`.execute(this.db)).rows;
    // "Used" per unit: 2 bottles and 4 pairs of gloves are not "6" (it summed every unit type into one number)
    const ids = rows.map((r: any) => r.technician_id ?? null);
    const byUnit = ids.length ? (await sql<any>`SELECT u.technician_id, coalesce(p.unit_type, 'unit') AS unit, sum(u.hundredths)::int AS hundredths ${base}
      AND (u.technician_id = ANY(${ids.filter(Boolean)}::uuid[]) OR (${ids.includes(null)} AND u.technician_id IS NULL))
      GROUP BY u.technician_id, coalesce(p.unit_type, 'unit') ORDER BY 1, 2`.execute(this.db)).rows : [];
    const unitsOf = (tid: string | null) => byUnit.filter((x: any) => (x.technician_id ?? null) === tid).map((x: any) => ({ unit: String(x.unit), used: formatQuantity(N(x.hundredths)), hundredths: N(x.hundredths) }));
    return { total, page, pageSize: pg.pageSize, pages, period, rows: rows.map((r: any) => ({
      technicianId: r.technician_id ?? null, name: r.technician_id ? r.name || 'Technician' : 'Unknown / Historical', uses: N(r.uses), products: N(r.products),
      ...(() => { const u = unitsOf(r.technician_id ?? null); return u.length > 1 ? { used: null, usedHundredths: null, usedByUnit: u } : { used: formatQuantity(N(r.hundredths)), usedHundredths: N(r.hundredths), usedByUnit: u }; })(),
      lastUsedAt: iso(r.last_at), lastProduct: r.last_product ?? null,
    })) };
  }

  /** Pickers for Record Product Use: products (with on hand) and this salon's technicians. */
  async pickers(ctx: InvCtx, search?: string) {
    const b = this.branch(ctx);
    const products = (await sql<any>`SELECT p.id, p.name, p.sku, p.barcode, p.unit_type, coalesce(s.quantity_on_hand, 0)::int AS on_hand,
        (SELECT coalesce(sum(CASE WHEN u.status = 'low' THEN coalesce(u.estimated_remaining_percent, 25) WHEN u.status IN ('unopened', 'opened') THEN coalesce(u.estimated_remaining_percent, 100) ELSE 0 END), 0)::int
           FROM inventory_units u WHERE u.tenant_id = p.tenant_id AND u.branch_id = ${b} AND u.product_id = p.id) AS stock_hundredths
      FROM inventory_products p LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${b}
      WHERE p.tenant_id = ${ctx.tenantId} AND p.active = true AND p.archived_at IS NULL AND ${this.productSearch(ctx, search)}
      ORDER BY p.name, p.id LIMIT 25`.execute(this.db)).rows;
    const technicians = (await sql<any>`SELECT t.id, coalesce(nullif(t.full_name, ''), trim(t.first_name || ' ' || coalesce(t.last_name, ''))) AS name, t.user_id
      FROM technicians t WHERE t.tenant_id = ${ctx.tenantId} AND t.archived_at IS NULL AND coalesce(t.is_active, true) AND (t.branch_id IS NULL OR t.branch_id = ${b})
      ORDER BY 2, t.id LIMIT 200`.execute(this.db)).rows;
    return {
      products: products.map((r: any) => ({ id: String(r.id), name: r.name, sku: r.sku ?? null, barcode: r.barcode ?? null, unit: r.unit_type || 'unit', onHand: N(r.on_hand), stock: formatQuantity(N(r.stock_hundredths)), stockHundredths: N(r.stock_hundredths) })),
      technicians: technicians.map((r: any) => ({ id: String(r.id), name: r.name || 'Technician', isMe: !!r.user_id && String(r.user_id) === ctx.userId })),
    };
  }

  // ── Exports (every matching row, not a page) ────────────────────────────────────────────────────────────────────────
  async exportCsv(ctx: InvCtx, tab: string, q: Record<string, string>, period: Period): Promise<string> {
    const all: Paging = { page: 1, pageSize: 100000 };
    if (tab === 'usage') {
      const r = await this.productUsage(ctx, q, period, all);
      return csv(['Product', 'SKU', 'Used', 'Unit', 'Uses', 'Technicians', 'Unattributed uses', 'On hand', 'Last used by', 'Last used at'],
        r.rows.map((x) => [x.name, x.sku, x.used, x.unit, x.uses, x.technicians, x.unattributedUses, x.onHand, x.lastUsedLabel, x.lastUsedAt]));
    }
    if (tab === 'technicians') {
      const r = await this.technicians(ctx, q, period, all);
      return csv(['Technician', 'Uses', 'Products', 'Used', 'Last product', 'Last used at'], r.rows.map((x) => [x.name, x.uses, x.products, x.used, x.lastProduct, x.lastUsedAt]));
    }
    if (tab === 'history') {
      const r = await this.history(ctx, q, period, all);
      return csv(['Product', 'SKU', 'Severity', 'On hand at alert', 'Created', 'Acknowledged', 'Acknowledged by', 'Resolved', 'State'],
        r.rows.map((x) => [x.name, x.sku, x.severity, x.onHandAtAlert, x.createdAt, x.acknowledgedAt, x.acknowledgedBy, x.resolvedAt, x.state]));
    }
    const r = await this.activeAlerts(ctx, q, all);
    return csv(['Product', 'SKU', 'Brand', 'Category', 'Severity', 'On hand', 'Reorder level', 'Critical level', 'Suggested reorder', 'On order', 'Vendor', 'Last used by', 'Last used at', 'Alert since', 'Acknowledged by'],
      r.rows.map((x) => [x.name, x.sku, x.brand, x.category, x.severity, x.onHand, x.reorderLevel, x.criticalLevel, x.suggestedReorder, x.onOrder, x.vendor, x.lastUsedLabel, x.lastUsedAt, x.since, x.acknowledgedBy]));
  }
}
