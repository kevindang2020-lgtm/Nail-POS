// suppliers-screen.repository.ts — Suppliers & Purchasing mandate (Oct 29 2026): the READ side of POS Services & Products →
// Suppliers (/tenant/inventory/vendors). Raw SQL; tenant from the session, purchase orders at the session's branch.
// Why the photo said "Total Suppliers 0" next to a purchase order that shows a supplier name: the directory listed ACTIVE
// vendors only, while the purchase-order list joined the vendor whatever its state — an archived (or deactivated) supplier
// kept its name on the order and vanished from the directory and the count. Both sides now say what they are: the count is
// active suppliers (inactive shown beside it), and a purchase order of an inactive supplier says "inactive supplier".
// Active POs are committed orders not yet fully received (approved / ordered / partially received) — the one draft was
// rightly not counted, and is now shown as "1 draft". Open PO Value is what is still to arrive on active orders (remaining
// quantity × unit cost, integer cents); a real zero shows $0.00, never a dash. Brands are the salon's active catalog brands,
// supplier or not. The expected delivery date is a calendar date (to_char), never a midnight-UTC timestamp.
import { sql, type RawBuilder } from 'kysely';
import { withCode } from '@aipowersalon/api-contracts';
import { InventoryScreenRepository, OPEN_PO_STATUSES } from './inventory-screen.repository';
import { likeOf, isoOf, phoneDigits, type Paging, type Period } from './stock-alerts.repository';
import { InventoryError, type InvCtx } from './inventory.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const N = (v: unknown): number => Number(v ?? 0) || 0;
const pages = (total: number, pg: Paging) => { const n = Math.max(1, Math.ceil(total / pg.pageSize)); return { pages: n, page: Math.min(pg.page, n) }; };
export const SUPPLIER_STATUS_FILTERS = ['all', 'active', 'inactive', 'preferred'] as const;
export const SUPPLIER_SORTS = ['newest', 'az', 'last_order'] as const;

export class SuppliersScreenRepository extends InventoryScreenRepository {
  private hideMoney(ctx: InvCtx) { return ctx.permissions.includes('inventory.view_limited') && !ctx.permissions.includes('inventory.cost.view') && !ctx.permissions.includes('*'); }

  /** The search box over suppliers: the supplier itself, its contacts, the products it sells, their brands, its orders. */
  private match(ctx: InvCtx, s: string): { where: RawBuilder<unknown>; via: RawBuilder<unknown> } {
    if (!s) return { where: sql`true`, via: sql`NULL::text` };
    const l = likeOf(s.toLowerCase()); const d = phoneDigits(s); const dl = '%' + d + '%'; const hasD = d.length >= 4 && !/[a-z]/i.test(s);
    const self = sql`(lower(v.name) LIKE ${l} OR lower(coalesce(v.trade_name, '')) LIKE ${l} OR lower(coalesce(v.supplier_code, '')) LIKE ${l} OR v.id::text = ${s.toLowerCase()}
      OR lower(coalesce(v.email, '')) LIKE ${l} OR lower(coalesce(v.contact_name, '')) LIKE ${l} OR lower(coalesce(v.website, '')) LIKE ${l}
      OR (${hasD} AND regexp_replace(coalesce(v.phone, ''), '\\D', '', 'g') LIKE ${dl}))`;
    const contact = sql`EXISTS (SELECT 1 FROM inventory_vendor_contacts vc WHERE vc.tenant_id = v.tenant_id AND vc.vendor_id = v.id
      AND (lower(vc.name) LIKE ${l} OR lower(coalesce(vc.role, '')) LIKE ${l} OR lower(coalesce(vc.email, '')) LIKE ${l}
        OR (${hasD} AND regexp_replace(coalesce(vc.mobile_phone, '') || ' ' || coalesce(vc.office_phone, ''), '\\D', '', 'g') LIKE ${dl})))`;
    const product = sql`EXISTS (SELECT 1 FROM inventory_products p LEFT JOIN inventory_vendor_products vp ON vp.product_id = p.id AND vp.tenant_id = p.tenant_id AND vp.vendor_id = v.id AND vp.active
      WHERE p.tenant_id = v.tenant_id AND p.archived_at IS NULL AND (vp.id IS NOT NULL OR p.preferred_vendor_id = v.id)
        AND (lower(p.name) LIKE ${l} OR lower(coalesce(p.sku, '')) LIKE ${l} OR coalesce(p.barcode, '') = ${s} OR coalesce(p.upc, '') = ${s} OR lower(coalesce(vp.supplier_sku, '')) LIKE ${l}))`;
    const brand = sql`EXISTS (SELECT 1 FROM inventory_products p JOIN inventory_brands br ON br.id = p.brand_id AND br.tenant_id = p.tenant_id
      LEFT JOIN inventory_vendor_products vp ON vp.product_id = p.id AND vp.tenant_id = p.tenant_id AND vp.vendor_id = v.id AND vp.active
      WHERE p.tenant_id = v.tenant_id AND (vp.id IS NOT NULL OR p.preferred_vendor_id = v.id) AND lower(br.name) LIKE ${l})`;
    const po = sql`EXISTS (SELECT 1 FROM purchase_orders po WHERE po.tenant_id = v.tenant_id AND po.vendor_id = v.id AND lower(coalesce(po.po_number, '')) LIKE ${l})`;
    return {
      where: sql`(${self} OR ${contact} OR ${product} OR ${brand} OR ${po})`,
      via: sql`CASE WHEN ${self} THEN 'supplier' WHEN ${contact} THEN 'contact' WHEN ${po} THEN 'purchase_order' WHEN ${product} THEN 'product' WHEN ${brand} THEN 'brand' END`,
    };
  }

  // ── KPIs (current; a PO date range never changes them) ─────────────────────────────────────────────────────────────
  async supplierKpis(ctx: InvCtx) {
    const b = this.branch(ctx);
    const v = (await sql<any>`SELECT count(*) FILTER (WHERE v.active)::int AS active, count(*) FILTER (WHERE NOT v.active)::int AS inactive,
        count(*) FILTER (WHERE v.active AND v.is_preferred)::int AS preferred FROM inventory_vendors v WHERE v.tenant_id = ${ctx.tenantId}`.execute(this.db)).rows[0];
    const po = (await sql<any>`SELECT count(*)::int AS total, count(*) FILTER (WHERE po.status IN ('approved', 'ordered', 'partial'))::int AS active,
        count(*) FILTER (WHERE po.status = 'draft')::int AS drafts, count(*) FILTER (WHERE po.vendor_id IS NULL)::int AS unlinked,
        count(*) FILTER (WHERE po.vendor_id IS NOT NULL AND v.active = false)::int AS inactive_vendor,
        coalesce(sum(ln.remaining_cents) FILTER (WHERE po.status IN ('approved', 'ordered', 'partial')), 0)::bigint AS open_value,
        coalesce(sum(po.total_cents) FILTER (WHERE po.status IN ('approved', 'ordered', 'partial')), 0)::bigint AS committed,
        coalesce(sum(po.total_cents) FILTER (WHERE po.status = 'draft'), 0)::bigint AS draft_value
      FROM purchase_orders po LEFT JOIN inventory_vendors v ON v.id = po.vendor_id AND v.tenant_id = po.tenant_id
      LEFT JOIN LATERAL (SELECT coalesce(sum(greatest(pl.quantity_ordered - pl.quantity_received, 0)::bigint * coalesce(pl.unit_cost_cents, 0)), 0)::bigint AS remaining_cents
        FROM purchase_order_lines pl WHERE pl.purchase_order_id = po.id AND pl.tenant_id = po.tenant_id) ln ON true
      WHERE po.tenant_id = ${ctx.tenantId} AND po.branch_id = ${b}`.execute(this.db)).rows[0];
    const br = (await sql<any>`SELECT count(*)::int AS brands, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM inventory_products p
          LEFT JOIN inventory_vendor_products vp ON vp.product_id = p.id AND vp.tenant_id = p.tenant_id AND vp.active
          WHERE p.tenant_id = x.tenant_id AND p.brand_id = x.id AND p.archived_at IS NULL AND (p.preferred_vendor_id IS NOT NULL OR vp.id IS NOT NULL)))::int AS without_supplier
      FROM inventory_brands x WHERE x.tenant_id = ${ctx.tenantId} AND x.active = true`.execute(this.db)).rows[0];
    const hide = this.hideMoney(ctx);
    return {
      asOf: new Date().toISOString(), currency: 'USD',
      totalSuppliers: N(v?.active), inactiveSuppliers: N(v?.inactive), preferredSuppliers: N(v?.preferred),
      activePurchaseOrders: N(po?.active), draftPurchaseOrders: N(po?.drafts), totalPurchaseOrders: N(po?.total), unlinkedPurchaseOrders: N(po?.unlinked), inactiveSupplierPurchaseOrders: N(po?.inactive_vendor),
      openPoValueCents: hide ? null : N(po?.open_value), committedValueCents: hide ? null : N(po?.committed), draftValueCents: hide ? null : N(po?.draft_value),
      brands: N(br?.brands), brandsWithoutSupplier: N(br?.without_supplier), activeStatuses: [...OPEN_PO_STATUSES],
      definitions: {
        totalSuppliers: 'Active suppliers (contacts are not suppliers); inactive ones are kept and shown apart.',
        activePurchaseOrders: 'Approved / ordered / partially received orders at this location. Drafts are not active.',
        openPoValue: 'Still to arrive on active orders: remaining quantity × unit cost (drafts excluded).',
        brands: 'Active catalog brands, whether or not a supplier is linked.',
      },
    };
  }

  // ── Supplier Directory ─────────────────────────────────────────────────────────────────────────────────────────────
  async directory(ctx: InvCtx, q: Record<string, string | undefined>, pg: Paging) {
    const b = this.branch(ctx);
    const status = (SUPPLIER_STATUS_FILTERS as readonly string[]).includes(String(q.status)) ? String(q.status) : 'active';
    const sort = (SUPPLIER_SORTS as readonly string[]).includes(String(q.sort)) ? String(q.sort) : 'newest';
    const brand = q.brandId && UUID.test(q.brandId) ? q.brandId : null;
    const s = String(q.search ?? '').trim().slice(0, 100); const m = this.match(ctx, s);
    const base = sql`FROM inventory_vendors v
      LEFT JOIN LATERAL (SELECT vc.name, vc.role, coalesce(vc.mobile_phone, vc.office_phone) AS phone, vc.email FROM inventory_vendor_contacts vc
          WHERE vc.tenant_id = v.tenant_id AND vc.vendor_id = v.id AND vc.active ORDER BY vc.is_primary DESC, vc.created_at LIMIT 1) pc ON true
      LEFT JOIN LATERAL (SELECT count(DISTINCT p.id)::int AS products, count(DISTINCT p.brand_id)::int AS brands, string_agg(DISTINCT br.name, ', ') AS brand_names
          FROM inventory_products p LEFT JOIN inventory_brands br ON br.id = p.brand_id AND br.tenant_id = p.tenant_id
          LEFT JOIN inventory_vendor_products vp ON vp.product_id = p.id AND vp.tenant_id = p.tenant_id AND vp.vendor_id = v.id AND vp.active
          WHERE p.tenant_id = v.tenant_id AND p.archived_at IS NULL AND (vp.id IS NOT NULL OR p.preferred_vendor_id = v.id)) pr ON true
      LEFT JOIN LATERAL (SELECT count(*) FILTER (WHERE po.status IN ('draft', 'approved', 'ordered', 'partial'))::int AS open_pos, max(po.created_at) AS last_order
          FROM purchase_orders po WHERE po.tenant_id = v.tenant_id AND po.vendor_id = v.id AND po.branch_id = ${b}) po ON true
      WHERE v.tenant_id = ${ctx.tenantId}
        AND ${status === 'active' ? sql`v.active` : status === 'inactive' ? sql`NOT v.active` : status === 'preferred' ? sql`v.active AND v.is_preferred` : sql`true`}
        AND (${brand}::uuid IS NULL OR EXISTS (SELECT 1 FROM inventory_products p LEFT JOIN inventory_vendor_products vp ON vp.product_id = p.id AND vp.tenant_id = p.tenant_id AND vp.vendor_id = v.id AND vp.active
              WHERE p.tenant_id = v.tenant_id AND p.brand_id = ${brand} AND (vp.id IS NOT NULL OR p.preferred_vendor_id = v.id)))
        AND ${m.where}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const exact = s ? sql`CASE WHEN lower(coalesce(v.supplier_code, '')) = ${s.toLowerCase()} OR v.id::text = ${s.toLowerCase()} THEN 0 WHEN lower(v.name) = ${s.toLowerCase()} THEN 1 ELSE 2 END,` : sql``;
    const order = sort === 'az' ? sql`lower(v.name), v.id` : sort === 'last_order' ? sql`po.last_order DESC NULLS LAST, v.id DESC` : sql`v.created_at DESC, v.id DESC`;
    const rows = (await sql<any>`SELECT v.id, v.name, v.trade_name, v.supplier_code, v.active, v.is_preferred, v.phone, v.email, v.contact_name, v.lead_time_days, v.payment_terms, v.created_at,
        pc.name AS c_name, pc.role AS c_role, pc.phone AS c_phone, pc.email AS c_email, pr.products, pr.brands, pr.brand_names, po.open_pos, po.last_order, ${m.via} AS via
      ${base} ORDER BY ${exact} ${order} LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, status, sort, rows: rows.map((r: any) => ({
      id: String(r.id), name: r.name, tradeName: r.trade_name ?? null, code: r.supplier_code ?? null, active: !!r.active, preferred: !!r.is_preferred,
      primaryContact: r.c_name ? { name: r.c_name, role: r.c_role ?? null, phone: r.c_phone ?? null, email: r.c_email ?? null, source: 'contact' }
        : r.contact_name ? { name: r.contact_name, role: null, phone: r.phone ?? null, email: r.email ?? null, source: 'supplier_record' } : null,
      phone: r.phone ?? r.c_phone ?? null, email: r.email ?? r.c_email ?? null, products: N(r.products), brands: N(r.brands), brandNames: r.brand_names ?? null,
      openPurchaseOrders: N(r.open_pos), lastOrderAt: isoOf(r.last_order), leadTimeDays: r.lead_time_days == null ? null : N(r.lead_time_days), paymentTerms: r.payment_terms ?? null,
      createdAt: isoOf(r.created_at), matchedVia: r.via ?? null,
    })) };
  }

  // ── Supplier Details ────────────────────────────────────────────────────────────────────────────────────────────────
  async supplier(ctx: InvCtx, vendorId: string) {
    const b = this.branch(ctx);
    if (!UUID.test(vendorId)) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    const v = (await sql<any>`SELECT v.id, v.name, v.contact_name, v.phone, v.email, v.website, v.account_number, v.payment_terms, v.lead_time_days, v.active, v.created_at, v.updated_at, v.trade_name, v.supplier_code, v.street, v.city, v.state, v.postal_code, v.country, v.notes, v.is_preferred, v.minimum_order_cents, v.currency, v.deactivated_at FROM inventory_vendors v WHERE v.tenant_id = ${ctx.tenantId} AND v.id = ${vendorId}`.execute(this.db)).rows[0];
    if (!v) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    const p = await this.period(ctx, { preset: 'year' });
    const contacts = (await sql<any>`SELECT vc.id, vc.vendor_id, vc.name, vc.role, vc.mobile_phone, vc.office_phone, vc.email, vc.preferred_method, vc.is_primary, vc.active, vc.notes, vc.created_at, vc.updated_at FROM inventory_vendor_contacts vc WHERE vc.tenant_id = ${ctx.tenantId} AND vc.vendor_id = ${vendorId}
      ORDER BY vc.active DESC, vc.is_primary DESC, vc.created_at DESC, vc.id DESC`.execute(this.db)).rows;
    const st = (await sql<any>`SELECT count(*) FILTER (WHERE po.status IN ('approved', 'ordered', 'partial'))::int AS active, count(*) FILTER (WHERE po.status = 'draft')::int AS drafts,
        count(*)::int AS total, max(po.created_at) AS last_order, max(po.received_at) AS last_received,
        coalesce(sum(po.total_cents) FILTER (WHERE po.status NOT IN ('draft', 'cancelled') AND ${this.inPeriod(sql`po.created_at`, p)}), 0)::bigint AS ordered_this_year
      FROM purchase_orders po WHERE po.tenant_id = ${ctx.tenantId} AND po.vendor_id = ${vendorId} AND po.branch_id = ${b}`.execute(this.db)).rows[0];
    const lastReceipt = (await sql<any>`SELECT max(m.created_at) AS at FROM inventory_stock_movements m JOIN purchase_orders po ON po.id = m.related_id AND po.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${ctx.tenantId} AND m.related_type = 'purchase_order' AND po.vendor_id = ${vendorId} AND m.branch_id = ${b}`.execute(this.db)).rows[0];
    const audit = (await sql<any>`SELECT a.id, a.action_type, a.created_at, coalesce(nullif(au.full_name, ''), au.email) AS actor, a.metadata_json
      FROM audit_logs a LEFT JOIN users au ON au.id = a.user_id
      WHERE a.tenant_id = ${ctx.tenantId} AND a.entity_type = 'inventory' AND (a.metadata_json->>'id' = ${vendorId} OR a.metadata_json->>'vendorId' = ${vendorId})
      ORDER BY a.created_at DESC, a.id DESC LIMIT 12`.execute(this.db)).rows;
    const hide = this.hideMoney(ctx);
    return {
      supplier: {
        id: String(v.id), name: v.name, tradeName: v.trade_name ?? null, code: v.supplier_code ?? null, active: !!v.active, preferred: !!v.is_preferred,
        phone: v.phone ?? null, email: v.email ?? null, website: v.website ?? null, contactName: v.contact_name ?? null, accountNumber: v.account_number ?? null,
        address: { street: v.street ?? null, city: v.city ?? null, state: v.state ?? null, postalCode: v.postal_code ?? null, country: v.country ?? null },
        paymentTerms: v.payment_terms ?? null, leadTimeDays: v.lead_time_days == null ? null : N(v.lead_time_days), minimumOrderCents: hide || v.minimum_order_cents == null ? null : N(v.minimum_order_cents),
        currency: v.currency || 'USD', notes: v.notes ?? null, createdAt: isoOf(v.created_at), updatedAt: isoOf(v.updated_at), deactivatedAt: isoOf(v.deactivated_at),
      },
      contacts: contacts.map((c: any) => ({ id: String(c.id), name: c.name, role: c.role ?? null, mobilePhone: c.mobile_phone ?? null, officePhone: c.office_phone ?? null, email: c.email ?? null,
        preferredMethod: c.preferred_method ?? null, primary: !!c.is_primary, active: !!c.active, notes: c.notes ?? null, createdAt: isoOf(c.created_at) })),
      overview: { activeOrders: N(st?.active), draftOrders: N(st?.drafts), totalOrders: N(st?.total), lastOrderAt: isoOf(st?.last_order), lastReceivedAt: isoOf(lastReceipt?.at ?? st?.last_received),
        orderedThisYearCents: hide ? null : N(st?.ordered_this_year), orderedPeriod: p },
      audit: audit.map((a: any) => ({ id: String(a.id), action: a.action_type, at: isoOf(a.created_at), actor: a.actor ?? null })),
    };
  }

  /** Products this supplier sells (linked), is the preferred supplier of, or has been ordered from — newest link first. */
  async supplierProducts(ctx: InvCtx, vendorId: string, q: Record<string, string | undefined>, pg: Paging) {
    const b = this.branch(ctx);
    if (!UUID.test(vendorId)) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    const s = String(q.search ?? '').trim().slice(0, 100); const l = likeOf(s.toLowerCase());
    const base = sql`FROM inventory_products p LEFT JOIN inventory_vendor_products vp ON vp.product_id = p.id AND vp.tenant_id = p.tenant_id AND vp.vendor_id = ${vendorId} AND vp.active
      LEFT JOIN inventory_brands br ON br.id = p.brand_id AND br.tenant_id = p.tenant_id
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${b}
      LEFT JOIN LATERAL (SELECT max(po.created_at) AS last_at, (array_agg(pl.unit_cost_cents ORDER BY po.created_at DESC))[1:3] AS costs
          FROM purchase_order_lines pl JOIN purchase_orders po ON po.id = pl.purchase_order_id AND po.tenant_id = pl.tenant_id
          WHERE pl.tenant_id = p.tenant_id AND pl.product_id = p.id AND po.vendor_id = ${vendorId}) h ON true
      WHERE p.tenant_id = ${ctx.tenantId} AND (vp.id IS NOT NULL OR p.preferred_vendor_id = ${vendorId} OR h.last_at IS NOT NULL)
        AND (${s} = '' OR lower(p.name) LIKE ${l} OR lower(coalesce(p.sku, '')) LIKE ${l} OR coalesce(p.barcode, '') = ${s} OR lower(coalesce(vp.supplier_sku, '')) LIKE ${l} OR lower(coalesce(br.name, '')) LIKE ${l})`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const rows = (await sql<any>`SELECT p.id, p.name, p.sku, p.barcode, p.unit_type, p.archived_at, br.name AS brand, coalesce(s.quantity_on_hand, 0)::int AS on_hand,
        vp.id AS link_id, vp.supplier_sku, vp.last_cost_cents, vp.purchase_unit, vp.units_per_purchase_unit, vp.minimum_order_qty, vp.lead_time_days, vp.is_preferred, vp.created_at AS linked_at,
        (p.preferred_vendor_id = ${vendorId}::uuid) AS is_product_preferred, h.last_at, h.costs
      ${base} ORDER BY coalesce(vp.created_at, h.last_at, p.created_at) DESC, p.id DESC LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    const hide = this.hideMoney(ctx);
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, rows: rows.map((r: any) => ({
      productId: String(r.id), name: r.name, sku: r.sku ?? null, barcode: r.barcode ?? null, unit: r.unit_type || 'unit', brand: r.brand ?? null, onHand: N(r.on_hand), archived: !!r.archived_at,
      linkId: r.link_id ?? null, source: r.link_id ? 'linked' : r.is_product_preferred ? 'preferred' : 'ordered', supplierSku: r.supplier_sku ?? null,
      lastCostCents: hide || r.last_cost_cents == null ? null : N(r.last_cost_cents), purchaseUnit: r.purchase_unit ?? null, unitsPerPurchaseUnit: r.units_per_purchase_unit == null ? null : N(r.units_per_purchase_unit),
      minimumOrderQty: r.minimum_order_qty == null ? null : N(r.minimum_order_qty), leadTimeDays: r.lead_time_days == null ? null : N(r.lead_time_days),
      preferred: !!r.is_preferred || !!r.is_product_preferred, lastOrderedAt: isoOf(r.last_at),
      priceHistoryCents: hide ? [] : (Array.isArray(r.costs) ? r.costs : []).filter((c: unknown) => c != null).map((c: unknown) => N(c)),
    })) };
  }

  /** Receiving history: each receipt that put this supplier's stock on the shelf (one movement per product per receipt). */
  async supplierReceiving(ctx: InvCtx, vendorId: string, period: Period, pg: Paging) {
    const b = this.branch(ctx);
    if (!UUID.test(vendorId)) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    const base = sql`FROM inventory_stock_movements m JOIN purchase_orders po ON po.id = m.related_id AND po.tenant_id = m.tenant_id
      JOIN inventory_products p ON p.id = m.product_id AND p.tenant_id = m.tenant_id LEFT JOIN users au ON au.id = m.actor_user_id
      WHERE m.tenant_id = ${ctx.tenantId} AND m.branch_id = ${b} AND m.related_type = 'purchase_order' AND po.vendor_id = ${vendorId} AND ${this.inPeriod(sql`m.created_at`, period)}`;
    const total = N((await sql<{ n: number }>`SELECT count(*)::int AS n ${base}`.execute(this.db)).rows[0]?.n);
    const pp = pages(total, pg);
    const rows = (await sql<any>`SELECT m.id, m.created_at, m.quantity_change, p.id AS product_id, p.name, p.sku, po.id AS po_id, po.po_number, coalesce(nullif(au.full_name, ''), au.email) AS actor
      ${base} ORDER BY m.created_at DESC, m.id DESC LIMIT ${pg.pageSize} OFFSET ${(pp.page - 1) * pg.pageSize}`.execute(this.db)).rows;
    return { total, page: pp.page, pageSize: pg.pageSize, pages: pp.pages, period, rows: rows.map((r: any) => ({
      id: String(r.id), at: isoOf(r.created_at), quantity: N(r.quantity_change), productId: String(r.product_id), product: r.name, sku: r.sku ?? null,
      purchaseOrderId: String(r.po_id), poNumber: r.po_number ?? null, receivedBy: r.actor ?? null,
    })) };
  }

  /** Suppliers with the same name, phone or email (any status) — the duplicate warning; never merged automatically. */
  async duplicates(ctx: InvCtx, f: { name?: string | null; phone?: string | null; email?: string | null }, exceptId: string | null) {
    const name = String(f.name ?? '').trim().toLowerCase(); const d = phoneDigits(String(f.phone ?? '')); const email = String(f.email ?? '').trim().toLowerCase();
    return (await sql<{ id: string; name: string; active: boolean }>`SELECT v.id, v.name, v.active FROM inventory_vendors v
      WHERE v.tenant_id = ${ctx.tenantId} AND (${exceptId}::uuid IS NULL OR v.id <> ${exceptId})
        AND ((${name} <> '' AND lower(trim(v.name)) = ${name}) OR (${d.length >= 7} AND regexp_replace(coalesce(v.phone, ''), '\\D', '', 'g') IN (${d}, ${'1' + d}))
          OR (${email} <> '' AND lower(coalesce(v.email, '')) = ${email}))
      ORDER BY v.active DESC, v.name LIMIT 5`.execute(this.db)).rows.map((r) => ({ id: String(r.id), name: r.name, active: !!r.active }));
  }
}
