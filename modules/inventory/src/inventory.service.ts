// inventory.service.ts — canonical tenant Inventory service. ALWAYS tenant+branch scoped from the session
// (never the client). Stock counts are recomputed from the authoritative bottle rows after every change
// (no blind increments → safe under concurrency). Every mutation writes an immutable movement + audit.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import type { ServiceRecipe } from '@aipowersalon/api-contracts/tenant';
import { utcDate } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { transitionStatus, type DB } from '@aipowersalon/database';
import { PURCHASE_ORDER, INVENTORY_COUNT, INVENTORY_TECH_REPORT } from './inventory-lifecycles';
import {
  countsFromUnits, stockStatus, reorderSuggestion, canTransitionBottle, validateTechReport,
  poReceivingStatus, receivableQty, poTotals, canReceivePO,
  clampCount, countVariance, summarizeCount, recipeCostCents,
  type BottleStatus, type MovementType,
} from './inventory-core';
import { hasPermission } from '@aipowersalon/permissions';

export class InventoryError extends Error { constructor(public status: number, message: string, public extra?: any) { super(message); } }
export interface InvCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }

/** BUILD_PLAN Phase 9: the salon approvals engine as inventory sees it (string token 'TENANT_APPROVALS', @Optional, structural). */
export const PO_APPROVALS_TOKEN = 'TENANT_APPROVALS';
type ApprovalActorLike = { tenantId: string; branchId: string | null; userId: string; role: string; permissions: readonly string[] };
export interface PurchaseOrderApprovalsPort {
  registerExecutor(kind: 'purchase_order', executor: {
    prepare?(actor: ApprovalActorLike, input: { subjectType: string; subjectId: string | null; reason: string; payload: Record<string, unknown> }): Promise<Record<string, unknown>>;
    execute(actor: ApprovalActorLike, request: { id: string; subjectId: string | null }): Promise<Record<string, unknown> | void>;
    onReject?(actor: ApprovalActorLike, request: { id: string; subjectId: string | null }, note: string | null): Promise<void>;
  }): void;
  needsApproval(tenantId: string, kind: 'purchase_order', amountCents: number | null): Promise<boolean>;
  request(actor: ApprovalActorLike, body: unknown): Promise<{ request: { id: string }; created: boolean }>;
  liveFor(actor: ApprovalActorLike, kind: 'purchase_order', subjectType: string, subjectId: string): Promise<{ id: string; version: number; status: string } | null>;
  decide(actor: ApprovalActorLike, id: string, body: unknown): Promise<{ status: string; payload?: Record<string, unknown> }>;
}
const PO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const poActor = (ctx: InvCtx): ApprovalActorLike => ({ tenantId: ctx.tenantId, branchId: ctx.branchId && PO_UUID.test(ctx.branchId) ? ctx.branchId : null, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions ?? [] });
const invCtx = (a: ApprovalActorLike): InvCtx => ({ tenantId: a.tenantId, branchId: a.branchId ?? '', userId: a.userId, role: a.role, permissions: [...a.permissions] });

export class InventoryService {
  constructor(private readonly db: Kysely<DB> | null, private readonly clock: { iso(): string } = { iso: () => new Date().toISOString() }, private readonly outbox: OutboxWriter | null = null) {}

  // ── BUILD_PLAN Phase 9: purchase-order approvals on the salon's ONE approvals engine ────────────────────────────────
  // A new PO the salon's policy says needs approval (default: every PO; the owner may set a threshold) files a
  // purchase_order request; the approve route decides THROUGH it when one is live (approver key
  // inventory.purchase_order.approve, separation of duties when the salon turns it on, the approver limit). A rejected
  // request cancels the PO (so it cannot be approved around the decision). Under the threshold, or with no live request
  // (a PO from before the engine), the approve route acts directly as before. Without the engine: unchanged.
  private approvals: PurchaseOrderApprovalsPort | null = null;
  useApprovals(port: PurchaseOrderApprovalsPort | null | undefined): this {
    this.approvals = port ?? null;
    port?.registerExecutor('purchase_order', {
      prepare: async (actor, input) => {
        if (input.subjectType !== 'purchase_order' || !input.subjectId || !PO_UUID.test(input.subjectId)) throw new InventoryError(400, 'A purchase-order approval names the purchase order.');
        const r = await sql<any>`SELECT id, branch_id, po_number, status, total_cents FROM purchase_orders WHERE id = ${input.subjectId} AND tenant_id = ${actor.tenantId}`.execute(this.need());
        const po = r.rows[0];
        if (!po) throw new InventoryError(404, 'Purchase order not found');
        if (po.status !== 'draft') throw new InventoryError(409, `This purchase order is not waiting for approval (it is ${po.status}).`);
        return { title: `Purchase order ${po.po_number}`, amountCents: Number(po.total_cents ?? 0), branchId: po.branch_id ?? null, payload: { purchaseOrderId: String(po.id), poNumber: po.po_number, totalCents: Number(po.total_cents ?? 0) } };
      },
      execute: async (actor, request) => { await this.approvePurchaseOrderDirect(invCtx(actor), String(request.subjectId)); return { purchaseOrderId: String(request.subjectId), status: 'approved' }; },
      onReject: async (actor, request, note) => { await this.cancelPurchaseOrder(invCtx(actor), String(request.subjectId), `Not approved: ${note ?? ''}`.trim()); },
    });
    return this;
  }
  private need(): Kysely<DB> { if (!this.db) throw new InventoryError(503, 'Inventory store unavailable'); return this.db; }

  private async resolveBranchId(ctx: InvCtx): Promise<string | null> {
    if (ctx.branchId && typeof ctx.branchId === 'string' && ctx.branchId.trim().length > 0) {
      return ctx.branchId;
    }
    const b = await sql<{ id: string }>`SELECT id FROM branches WHERE tenant_id = ${ctx.tenantId} ORDER BY created_at ASC LIMIT 1`.execute(this.need()).catch(() => ({ rows: [] }));
    return b.rows[0]?.id ?? null;
  }

  private async audit(ctx: InvCtx, action: string, productId: string | null, unitId: string | null, meta: any) {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${ctx.userId}, ${ctx.role}, ${action}, ${'inventory'}, ${unitId ?? productId}, ${JSON.stringify(meta || {})}::jsonb)`.execute(this.db);
    } catch { /* best effort */ }
  }

  private async move(ctx: InvCtx, productId: string, unitId: string | null, type: MovementType, before: number, change: number, after: number, reason?: string, related?: { type: string; id: string }) {
    await sql`INSERT INTO inventory_stock_movements (tenant_id, branch_id, product_id, inventory_unit_id, movement_type, quantity_before, quantity_change, quantity_after, related_type, related_id, actor_user_id, reason)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId}, ${unitId}, ${type}, ${before}, ${change}, ${after}, ${related?.type ?? null}, ${related?.id ?? null}, ${ctx.userId}, ${reason ?? null})`.execute(this.need());
    // inventory.adjusted (declared since Constitution 8; produced by nothing until Oct 3 2026). Inventory writes are plain
    // statements, not one transaction, so this is recorded right after the movement row — a STANDARD-class event, not a
    // financial one. Quantities and ids only.
    if (this.outbox) await this.outbox.write(this.need(), createDomainEvent({ eventType: DOMAIN_EVENTS.INVENTORY_ADJUSTED, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined,
      aggregateType: 'inventory_product', aggregateId: productId, actorId: ctx.userId || undefined, actorType: 'user',
      payload: { productId, unitId: unitId ?? null, movementType: type, quantityBefore: before, quantityChange: change, quantityAfter: after, relatedType: related?.type ?? null, relatedId: related?.id ?? null } })).catch(() => undefined);
  }

  /** Recompute location stock for a product from its bottle rows — the single source of truth. */
  private async recompute(ctx: InvCtx, productId: string): Promise<{ onHand: number; before: number }> {
    const units = await sql<{ status: BottleStatus }>`SELECT status FROM inventory_units
      WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId}`.execute(this.need());
    const prev = await sql<{ quantity_on_hand: number }>`SELECT quantity_on_hand FROM inventory_location_stock
      WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId}`.execute(this.need());
    const before = prev.rows[0]?.quantity_on_hand ?? 0;
    const c = countsFromUnits(units.rows, 0);
    await sql`INSERT INTO inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand, quantity_available, quantity_unopened, quantity_open, quantity_low, quantity_empty, quantity_damaged, updated_at)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId}, ${c.onHand}, ${c.available}, ${c.unopened}, ${c.open}, ${c.low}, ${c.empty}, ${c.damaged}, now())
      ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity_on_hand = ${c.onHand}, quantity_available = ${c.available},
        quantity_unopened = ${c.unopened}, quantity_open = ${c.open}, quantity_low = ${c.low}, quantity_empty = ${c.empty},
        quantity_damaged = ${c.damaged}, updated_at = now()`.execute(this.need());
    await this.checkStockAlert(ctx, productId, before, c.onHand);
    return { onHand: c.onHand, before };
  }

  // ---- stock-threshold alert dispatch (§17) ----
  private stockRank(s: string): number { return s === 'out_of_stock' ? 3 : s === 'critical' ? 2 : s === 'low' ? 1 : 0; }

  /** Called from recompute on every stock change. Records an alert when a product crosses into a worse tier
   *  (deduped per product/status, superseding lower open alerts), and auto-resolves open alerts on recovery. */
  private async checkStockAlert(ctx: InvCtx, productId: string, before: number, after: number) {
    const branchId = await this.resolveBranchId(ctx);
    const p = (await sql<any>`
      SELECT
        COALESCE(s.reorder_level_override, p.reorder_level) AS reorder_level,
        COALESCE(s.critical_level_override, p.critical_level) AS critical_level,
        p.maximum_stock
      FROM inventory_products p
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.branch_id = ${branchId}
      WHERE p.id = ${productId} AND p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL
    `.execute(this.need())).rows[0];
    if (!p) return;
    
    const sAfter = stockStatus(after, p.reorder_level ?? 0, p.maximum_stock, p.critical_level);
    const rAfter = this.stockRank(sAfter);

    if (rAfter === 0) {
      // recovered to a healthy level — resolve any open alerts for this product
      await sql`UPDATE inventory_alerts SET resolved_at = now() WHERE product_id = ${productId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND tenant_id = ${ctx.tenantId} AND resolved_at IS NULL`.execute(this.need());
      return;
    }

    const currentAlert = (await sql<{ id: string, status: string }>`SELECT id, status FROM inventory_alerts WHERE product_id = ${productId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND tenant_id = ${ctx.tenantId} AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`.execute(this.need())).rows[0];
    
    if (currentAlert && currentAlert.status === sAfter) return; // already alerting at exactly this status
    if (currentAlert && this.stockRank(currentAlert.status) >= rAfter) return; // already alerting at a worse or equal status

    if (!branchId) return;

    // supersede any lower open alerts for this product, then record the new one
    await sql`UPDATE inventory_alerts SET resolved_at = now() WHERE product_id = ${productId} AND branch_id = ${branchId} AND tenant_id = ${ctx.tenantId} AND resolved_at IS NULL`.execute(this.need());
    await sql`INSERT INTO inventory_alerts (tenant_id, branch_id, product_id, status, on_hand) VALUES (${ctx.tenantId}, ${branchId}, ${productId}, ${sAfter}, ${after})`.execute(this.need());
    await this.audit(ctx, 'inventory_stock_alert', productId, null, { status: sAfter, onHand: after });
    // inventory.low_stock — the product crossed INTO a worse tier (low / critical / out_of_stock); a tier it already alerts
    // at emits nothing (the early returns above).
    if (this.outbox) await this.outbox.write(this.need(), createDomainEvent({ eventType: DOMAIN_EVENTS.INVENTORY_LOW_STOCK, tenantId: ctx.tenantId, branchId: branchId || undefined,
      aggregateType: 'inventory_product', aggregateId: productId, actorType: 'system',
      payload: { productId, status: sAfter, onHand: after, reorderLevel: Number(p.reorder_level ?? 0), criticalLevel: p.critical_level == null ? null : Number(p.critical_level) } })).catch(() => undefined);
  }

  async listAlerts(ctx: InvCtx, includeAcknowledged = true) {
    const branchId = await this.resolveBranchId(ctx);
    const rows = await sql<any>`
      SELECT a.id, a.product_id, a.status, a.on_hand, a.created_at, a.acknowledged_at, p.name AS product_name, p.color_number
      FROM inventory_alerts a JOIN inventory_products p ON p.id = a.product_id
      WHERE a.tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR a.branch_id = ${branchId}) AND a.resolved_at IS NULL
        AND (${includeAcknowledged}::boolean OR a.acknowledged_at IS NULL)
      ORDER BY CASE a.status WHEN 'out_of_stock' THEN 0 WHEN 'critical' THEN 1 ELSE 2 END, a.created_at DESC`.execute(this.need());
    const openCount = rows.rows.filter((r: any) => !r.acknowledged_at).length;
    return { alerts: rows.rows, openCount };
  }

  async acknowledgeAlert(ctx: InvCtx, id: string) {
    const branchId = await this.resolveBranchId(ctx);
    const ex = (await sql`SELECT id FROM inventory_alerts WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND resolved_at IS NULL`.execute(this.need())).rows[0];
    if (!ex) throw new InventoryError(404, 'Alert not found');
    await sql`UPDATE inventory_alerts SET acknowledged_at = now(), acknowledged_by_user_id = ${ctx.userId} WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_alert_acknowledged', null, null, { id });
    return { ok: true };
  }

  // ---- OCR receipt → expense (ai_ocr_receipt_scanner) ----
  /** Save a reviewed/confirmed scanned receipt as an expense. The scan + extraction is gated AI; this persists the
   *  manager-confirmed result. Tenant + branch + user scoped. Inventory-linking of line items is intentionally separate. */
  async saveReceiptExpense(ctx: InvCtx, body: { vendor?: string | null; amountCents?: number; incurredOn?: string | null; category?: string | null; description?: string | null }) {
    const amount = Math.max(0, Math.round(Number(body?.amountCents) || 0));
    if (!amount) throw new InventoryError(400, 'Expense amount is required');
    const category = (body?.category && String(body.category).trim()) || 'inventory';
    const vendor = body?.vendor ? String(body.vendor).slice(0, 200) : null;
    const description = body?.description ? String(body.description).slice(0, 1000) : null;
    const incurredOn = body?.incurredOn && /^\d{4}-\d{2}-\d{2}$/.test(body.incurredOn) ? body.incurredOn : utcDate();   // §87: the named UTC-day helper (a salon-local day would be businessDate(tz))
    const row = await sql<any>`INSERT INTO expenses (tenant_id, branch_id, category, amount_cents, description, vendor, incurred_on, created_by)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${category}, ${amount}, ${description}, ${vendor}, ${incurredOn}, ${ctx.userId})
      RETURNING id, category, amount_cents, vendor, incurred_on`.execute(this.need());
    await this.audit(ctx, 'inventory_receipt_expense_created', row.rows[0]?.id ?? null, null, { amountCents: amount, vendor });
    return { ok: true, expense: row.rows[0] };
  }

  private async product(ctx: InvCtx, id: string) {
    const r = await sql<any>`SELECT * FROM inventory_products WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND archived_at IS NULL`.execute(this.need());
    if (!r.rows[0]) throw new InventoryError(404, 'Product not found');
    return r.rows[0];
  }
  private async unit(ctx: InvCtx, id: string) {
    const r = await sql<any>`SELECT * FROM inventory_units WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(this.need());
    if (!r.rows[0]) throw new InventoryError(404, 'Bottle not found');
    return r.rows[0];
  }

  // ---- categories / brands / vendors ----
  async listCategories(ctx: InvCtx) { return { categories: (await sql<any>`SELECT * FROM inventory_categories WHERE tenant_id = ${ctx.tenantId} AND active = true ORDER BY sort_order, name`.execute(this.need())).rows }; }
  async createCategory(ctx: InvCtx, b: any) {
    if (!b?.name?.trim()) throw new InventoryError(400, 'Category name required');
    const r = await sql<{ id: string }>`INSERT INTO inventory_categories (tenant_id, parent_category_id, name, code, description, display_color, tracking_mode)
      VALUES (${ctx.tenantId}, ${b.parentCategoryId ?? null}, ${b.name.trim()}, ${b.code ?? null}, ${b.description ?? null}, ${b.displayColor ?? null}, ${b.trackingMode === 'bottle' ? 'bottle' : 'quantity'}) RETURNING id`.execute(this.need());
    await this.audit(ctx, 'inventory_category_created', null, null, { id: r.rows[0].id, name: b.name });
    return { id: r.rows[0].id };
  }
  async listBrands(ctx: InvCtx) { return { brands: (await sql<any>`SELECT * FROM inventory_brands WHERE tenant_id = ${ctx.tenantId} AND active = true ORDER BY name`.execute(this.need())).rows }; }
  async createBrand(ctx: InvCtx, b: any) {
    if (!b?.name?.trim()) throw new InventoryError(400, 'Brand name required');
    const r = await sql<{ id: string }>`INSERT INTO inventory_brands (tenant_id, name, code, website, notes) VALUES (${ctx.tenantId}, ${b.name.trim()}, ${b.code ?? null}, ${b.website ?? null}, ${b.notes ?? null}) RETURNING id`.execute(this.need());
    await this.audit(ctx, 'inventory_brand_created', null, null, { id: r.rows[0].id, name: b.name });
    return { id: r.rows[0].id };
  }
  /** Phase 12 #19: the vendor fields the POS screens read (InvVendor) + timestamps — not tenant_id / active / actor stamps.
   *  account_number is the SALON's customer number at the supplier (shown and edited on the vendor form), not a bank account. */
  async listVendors(ctx: InvCtx) { return { vendors: (await sql<any>`SELECT id, name, contact_name, phone, email, website, account_number, payment_terms, lead_time_days, created_at, updated_at FROM inventory_vendors WHERE tenant_id = ${ctx.tenantId} AND active = true ORDER BY name`.execute(this.need())).rows }; }
  async createVendor(ctx: InvCtx, b: any) {
    if (!b?.name?.trim()) throw new InventoryError(400, 'Vendor name required');
    const r = await sql<{ id: string }>`INSERT INTO inventory_vendors (tenant_id, name, contact_name, phone, email, website, account_number, payment_terms, lead_time_days)
      VALUES (${ctx.tenantId}, ${b.name.trim()}, ${b.contactName ?? null}, ${b.phone ?? null}, ${b.email ?? null}, ${b.website ?? null}, ${b.accountNumber ?? null}, ${b.paymentTerms ?? null}, ${b.leadTimeDays ?? null}) RETURNING id`.execute(this.need());
    await this.audit(ctx, 'inventory_vendor_created', null, null, { id: r.rows[0].id, name: b.name });
    return { id: r.rows[0].id };
  }

  // ---- catalog editors (§ manager catalog): update + archive for categories / brands / vendors ----
  async updateCategory(ctx: InvCtx, id: string, b: any) {
    if (!b?.name?.trim()) throw new InventoryError(400, 'Category name required');
    const ex = await sql`SELECT id FROM inventory_categories WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw new InventoryError(404, 'Category not found');
    await sql`UPDATE inventory_categories SET name = ${b.name.trim()}, code = ${b.code ?? null}, description = ${b.description ?? null},
      display_color = ${b.displayColor ?? null}, sort_order = ${Number.isFinite(+b.sortOrder) ? +b.sortOrder : 0},
      tracking_mode = ${b.trackingMode === 'bottle' ? 'bottle' : 'quantity'}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_category_updated', null, null, { id, name: b.name });
    return { id };
  }
  async archiveCategory(ctx: InvCtx, id: string) {
    const ex = await sql`SELECT id FROM inventory_categories WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw new InventoryError(404, 'Category not found');
    const used = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_products WHERE category_id = ${id} AND tenant_id = ${ctx.tenantId} AND archived_at IS NULL`.execute(this.need());
    await sql`UPDATE inventory_categories SET active = false, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_category_archived', null, null, { id, productsAffected: used.rows[0].n });
    return { ok: true, productsAffected: used.rows[0].n };
  }

  async updateBrand(ctx: InvCtx, id: string, b: any) {
    if (!b?.name?.trim()) throw new InventoryError(400, 'Brand name required');
    const ex = await sql`SELECT id FROM inventory_brands WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw new InventoryError(404, 'Brand not found');
    await sql`UPDATE inventory_brands SET name = ${b.name.trim()}, code = ${b.code ?? null}, website = ${b.website ?? null}, notes = ${b.notes ?? null}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_brand_updated', null, null, { id, name: b.name });
    return { id };
  }
  async archiveBrand(ctx: InvCtx, id: string) {
    const ex = await sql`SELECT id FROM inventory_brands WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw new InventoryError(404, 'Brand not found');
    const used = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_products WHERE brand_id = ${id} AND tenant_id = ${ctx.tenantId} AND archived_at IS NULL`.execute(this.need());
    await sql`UPDATE inventory_brands SET active = false, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_brand_archived', null, null, { id, productsAffected: used.rows[0].n });
    return { ok: true, productsAffected: used.rows[0].n };
  }

  async updateVendor(ctx: InvCtx, id: string, b: any) {
    if (!b?.name?.trim()) throw new InventoryError(400, 'Vendor name required');
    const ex = await sql`SELECT id FROM inventory_vendors WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw new InventoryError(404, 'Vendor not found');
    await sql`UPDATE inventory_vendors SET name = ${b.name.trim()}, contact_name = ${b.contactName ?? null}, phone = ${b.phone ?? null},
      email = ${b.email ?? null}, website = ${b.website ?? null}, account_number = ${b.accountNumber ?? null},
      payment_terms = ${b.paymentTerms ?? null}, lead_time_days = ${b.leadTimeDays != null && b.leadTimeDays !== '' ? parseInt(b.leadTimeDays, 10) : null}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_vendor_updated', null, null, { id, name: b.name });
    return { id };
  }
  async archiveVendor(ctx: InvCtx, id: string) {
    const ex = await sql`SELECT id FROM inventory_vendors WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw new InventoryError(404, 'Vendor not found');
    await sql`UPDATE inventory_vendors SET active = false, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_vendor_archived', null, null, { id });
    return { ok: true };
  }

  // ---- products ----
  async listProducts(ctx: InvCtx, q: any) {
    const branchId = await this.resolveBranchId(ctx);
    const search = (q?.search || '').trim().toLowerCase();
    const rows = await sql<any>`
      SELECT p.*, s.quantity_on_hand, s.quantity_unopened, s.quantity_open, s.quantity_empty, s.quantity_damaged, s.quantity_reserved,
        s.reorder_level_override, s.reorder_quantity_override, s.critical_level_override, s.lead_time_days_override, s.preferred_vendor_id_override,
        b.name AS brand_name, c.name AS category_name
      FROM inventory_products p
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND (${branchId}::uuid IS NULL OR s.branch_id = ${branchId})
      LEFT JOIN inventory_brands b ON b.id = p.brand_id
      LEFT JOIN inventory_categories c ON c.id = p.category_id
      WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL
        AND (${q?.categoryId ?? null}::uuid IS NULL OR p.category_id = ${q?.categoryId ?? null})
        AND (${q?.brandId ?? null}::uuid IS NULL OR p.brand_id = ${q?.brandId ?? null})
        AND (${search || null}::text IS NULL OR lower(coalesce(p.name,'')||' '||coalesce(p.color_name,'')||' '||coalesce(p.color_number,'')||' '||coalesce(p.sku,'')||' '||coalesce(p.barcode,'')) LIKE ${'%' + search + '%'})
      ORDER BY p.name LIMIT 200`.execute(this.need());
    const withStatus = rows.rows.map((p) => {
      const onHand = p.quantity_on_hand ?? 0;
      const reorderLvl = p.reorder_level_override ?? p.reorder_level ?? 0;
      const reorderQty = p.reorder_quantity_override ?? p.reorder_quantity ?? 0;
      const critLvl = p.critical_level_override ?? p.critical_level ?? null;
      return { ...p, onHand, status: stockStatus(onHand, reorderLvl, p.maximum_stock, critLvl), reorderSuggestion: reorderSuggestion(onHand, reorderLvl, reorderQty) };
    });
    // technicians never see cost/value
    if (this.isTechOnly(ctx)) withStatus.forEach((p: any) => { delete p.cost_cents; delete p.retail_price_cents; });
    return { products: withStatus };
  }
  // BUILD_PLAN Phase 9: no role name. The technician's LIMITED inventory view (inventory.view_limited) is what hides cost
  // and value; an explicit inventory.cost.view shows it. (Same people as before: only the TECHNICIAN template holds it.)
  private isTechOnly(ctx: InvCtx) { return ctx.permissions.includes('inventory.view_limited') && !hasPermission(ctx as any, 'inventory.cost.view'); }

  async getProduct(ctx: InvCtx, id: string) {
    const branchId = await this.resolveBranchId(ctx);
    const p = await this.product(ctx, id);
    const units = await sql<any>`SELECT id, status, lot_number, expiration_date, internal_barcode, opened_at, storage_location FROM inventory_units
      WHERE tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND product_id = ${id} ORDER BY status, received_at`.execute(this.need());
    const counts = countsFromUnits(units.rows);
    if (this.isTechOnly(ctx)) { delete p.cost_cents; delete p.retail_price_cents; }
    // the location row's version (Phase 10 §40) — send it back as expectedVersion on the stock-overrides PATCH
    const stockVersion = branchId ? (await sql<{ version: number }>`SELECT version FROM inventory_location_stock WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${branchId} AND product_id = ${id}`.execute(this.need())).rows[0]?.version ?? 0 : null;
    return { product: { ...p, ...counts, stockVersion: stockVersion === null ? null : Number(stockVersion), status: stockStatus(counts.onHand, p.reorder_level ?? 0, p.maximum_stock, p.critical_level) }, units: units.rows };
  }

  async createProduct(ctx: InvCtx, b: any) {
    if (!b?.name?.trim()) throw new InventoryError(400, 'Product name required');
    const categoryId = b.categoryId && String(b.categoryId).trim().length > 0 ? b.categoryId : null;
    const brandId = b.brandId && String(b.brandId).trim().length > 0 ? b.brandId : null;
    const preferredVendorId = b.preferredVendorId && String(b.preferredVendorId).trim().length > 0 ? b.preferredVendorId : null;
    const r = await sql<{ id: string }>`INSERT INTO inventory_products
      (tenant_id, category_id, brand_id, preferred_vendor_id, name, product_line, color_name, color_number, color_family, finish, sku, barcode, upc, unit_type, size_value, size_unit, tracking_mode, cost_cents, retail_price_cents, reorder_level, reorder_quantity, maximum_stock, track_expiration, is_retail, is_service)
      VALUES (${ctx.tenantId}, ${categoryId}, ${brandId}, ${preferredVendorId}, ${b.name.trim()}, ${b.productLine ?? null}, ${b.colorName ?? null}, ${b.colorNumber ?? null}, ${b.colorFamily ?? null}, ${b.finish ?? null}, ${b.sku ?? null}, ${b.barcode ?? null}, ${b.upc ?? null}, ${b.unitType ?? 'bottle'}, ${b.sizeValue ?? null}, ${b.sizeUnit ?? null}, ${b.trackingMode === 'bottle' ? 'bottle' : 'quantity'}, ${b.costCents ?? null}, ${b.retailPriceCents ?? null}, ${b.reorderLevel ?? 0}, ${b.reorderQuantity ?? 0}, ${b.maximumStock ?? null}, ${!!b.trackExpiration}, ${!!b.isRetail}, ${b.isService !== false}) RETURNING id`.execute(this.need());
    await this.audit(ctx, 'inventory_product_created', r.rows[0].id, null, { name: b.name });
    return { id: r.rows[0].id };
  }

  async updateProduct(ctx: InvCtx, id: string, b: any) {
    await this.product(ctx, id);
    const W = ['name', 'product_line', 'color_name', 'color_number', 'color_family', 'finish', 'sku', 'barcode', 'upc', 'unit_type', 'tracking_mode', 'cost_cents', 'retail_price_cents', 'reorder_level', 'reorder_quantity', 'maximum_stock', 'critical_level', 'lead_time_days', 'image_url', 'button_color', 'track_expiration', 'is_retail', 'is_service', 'category_id', 'brand_id', 'preferred_vendor_id'];
    const map: Record<string, string> = { productLine: 'product_line', colorName: 'color_name', colorNumber: 'color_number', colorFamily: 'color_family', unitType: 'unit_type', trackingMode: 'tracking_mode', costCents: 'cost_cents', reorderLevel: 'reorder_level', reorderQuantity: 'reorder_quantity', maximumStock: 'maximum_stock', criticalLevel: 'critical_level', leadTimeDays: 'lead_time_days', imageUrl: 'image_url', buttonColor: 'button_color', trackExpiration: 'track_expiration', isRetail: 'is_retail', isService: 'is_service', categoryId: 'category_id', brandId: 'brand_id', preferredVendorId: 'preferred_vendor_id' };
    const sets: any[] = [];
    for (const k of Object.keys(b || {})) {
      const col = map[k] || k;
      if (W.includes(col)) {
        let val = b[k] ?? null;
        if ((col === 'category_id' || col === 'brand_id' || col === 'preferred_vendor_id') && (val === '' || (typeof val === 'string' && val.trim().length === 0))) {
          val = null;
        }
        sets.push(sql`${sql.ref(col)} = ${val}`);
      }
    }
    if (sets.length) { await sql`UPDATE inventory_products SET ${sql.join(sets, sql`, `)}, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need()); await this.audit(ctx, 'inventory_product_updated', id, null, { fields: Object.keys(b || {}) }); }
    return this.getProduct(ctx, id);
  }

  async setLocationStockOverrides(ctx: InvCtx, productId: string, overrides: any) {
    const branchId = await this.resolveBranchId(ctx);
    if (!branchId) throw new InventoryError(400, 'Branch is required to set overrides');
    await this.product(ctx, productId);
    
    const reorderLevel = overrides.reorderLevelOverride !== undefined ? (overrides.reorderLevelOverride === null || overrides.reorderLevelOverride === '' ? null : Number(overrides.reorderLevelOverride)) : undefined;
    const reorderQty = overrides.reorderQuantityOverride !== undefined ? (overrides.reorderQuantityOverride === null || overrides.reorderQuantityOverride === '' ? null : Number(overrides.reorderQuantityOverride)) : undefined;
    const critLevel = overrides.criticalLevelOverride !== undefined ? (overrides.criticalLevelOverride === null || overrides.criticalLevelOverride === '' ? null : Number(overrides.criticalLevelOverride)) : undefined;
    const leadTime = overrides.leadTimeDaysOverride !== undefined ? (overrides.leadTimeDaysOverride === null || overrides.leadTimeDaysOverride === '' ? null : Number(overrides.leadTimeDaysOverride)) : undefined;
    const vendorId = overrides.preferredVendorIdOverride !== undefined ? (overrides.preferredVendorIdOverride === null || overrides.preferredVendorIdOverride === '' ? null : String(overrides.preferredVendorIdOverride)) : undefined;

    const sets: any[] = [];
    if (reorderLevel !== undefined) sets.push(sql`reorder_level_override = ${reorderLevel}`);
    if (reorderQty !== undefined) sets.push(sql`reorder_quantity_override = ${reorderQty}`);
    if (critLevel !== undefined) sets.push(sql`critical_level_override = ${critLevel}`);
    if (leadTime !== undefined) sets.push(sql`lead_time_days_override = ${leadTime}`);
    if (vendorId !== undefined) sets.push(sql`preferred_vendor_id_override = ${vendorId}`);

    // BUILD_PLAN Phase 10 (Constitution 1 §40): optimistic concurrency on the location row. An `expectedVersion` (body,
    // or If-Match via the version-precondition interceptor) must equal the row's version or the write is refused with
    // 409 VERSION_CONFLICT — two managers editing the same location's thresholds no longer overwrite each other
    // silently. The version is bumped by the row's trigger (539) on every update, recompute included.
    const expected = overrides.expectedVersion === undefined || overrides.expectedVersion === null || overrides.expectedVersion === '' ? null : Number(overrides.expectedVersion);
    if (expected !== null && (!Number.isInteger(expected) || expected < 0)) throw new InventoryError(400, 'expectedVersion must be a whole number');
    if (sets.length > 0) {
      const r = await sql<{ version: number }>`
        INSERT INTO inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand, reorder_level_override, reorder_quantity_override, critical_level_override, lead_time_days_override, preferred_vendor_id_override, updated_at)
        VALUES (${ctx.tenantId}, ${branchId}, ${productId}, 0, ${reorderLevel ?? null}, ${reorderQty ?? null}, ${critLevel ?? null}, ${leadTime ?? null}, ${vendorId ?? null}, now())
        ON CONFLICT (branch_id, product_id) DO UPDATE SET ${sql.join(sets, sql`, `)}, updated_at = now()
          WHERE ${expected}::int IS NULL OR inventory_location_stock.version = ${expected}::int
        RETURNING version
      `.execute(this.need());
      if (!r.rows.length) {
        const cur = (await sql<{ version: number }>`SELECT version FROM inventory_location_stock WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${branchId} AND product_id = ${productId}`.execute(this.need())).rows[0];
        throw new InventoryError(409, 'These stock settings were changed on another device. Reload and try again.', { code: 'VERSION_CONFLICT', currentVersion: cur ? Number(cur.version) : null });
      }
    } else if (expected !== null) {
      const cur = (await sql<{ version: number }>`SELECT version FROM inventory_location_stock WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${branchId} AND product_id = ${productId}`.execute(this.need())).rows[0];
      if (cur && Number(cur.version) !== expected) throw new InventoryError(409, 'These stock settings were changed on another device. Reload and try again.', { code: 'VERSION_CONFLICT', currentVersion: Number(cur.version) });
    }
    
    await this.recompute(ctx, productId);
    return this.getProduct(ctx, productId);
  }

  async archiveProduct(ctx: InvCtx, id: string) {
    await this.product(ctx, id);
    await sql`UPDATE inventory_products SET archived_at = now(), active = false, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_product_archived', id, null, {});
    return { ok: true };
  }

  // ---- add stock (creates bottle rows + movement + recompute) ----
  async addStock(ctx: InvCtx, productId: string, b: any) {
    const p = await this.product(ctx, productId);
    const qty = Math.max(0, parseInt(b?.quantity, 10) || 0);
    if (qty <= 0) throw new InventoryError(400, 'Quantity must be at least 1');
    if (qty > 1000) throw new InventoryError(400, 'Quantity too large for a single receipt');
    const before = (await this.recompute(ctx, productId)).onHand;
    for (let i = 0; i < qty; i++) {
      await sql`INSERT INTO inventory_units (tenant_id, branch_id, product_id, lot_number, expiration_date, storage_location, status)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId}, ${b?.lotNumber ?? null}, ${b?.expirationDate ?? null}, ${b?.storageLocation ?? null}, ${'unopened'})`.execute(this.need());
    }
    if (b?.costCents != null) await sql`UPDATE inventory_products SET cost_cents = ${b.costCents}, updated_at = now() WHERE id = ${productId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    const after = (await this.recompute(ctx, productId)).onHand;
    await this.move(ctx, productId, null, b?.purchaseOrderId ? 'purchase_received' : 'manual_add', before, after - before, after, b?.note, b?.purchaseOrderId ? { type: 'purchase_order', id: b.purchaseOrderId } : undefined);
    await this.audit(ctx, 'inventory_stock_added', productId, null, { quantity: qty, lot: b?.lotNumber ?? null });
    return { product: (await this.getProduct(ctx, productId)).product };
  }

  /** Retail sale → stock. Called after a retail line is written on a ticket (Jul 27, 2026).
   *
   *  Stock in this system is ALWAYS unit rows — even a 'quantity'-tracked product stores one inventory_units row
   *  per item (see addStock), and quantity_on_hand is a derived, self-healing cache recomputed from them. So a
   *  sale consumes units: the oldest sealed ones first, flipped to 'sold' (a status countsFromUnits treats as
   *  off-hand), then a single 'retail_sale' movement row records the real decrement against the ticket.
   *
   *  DELIBERATE: selling more than the system thinks is on hand does NOT fail. The guest is at the counter with
   *  the product in hand — the money is real. We consume what exists, record exactly what we consumed, and let
   *  the count go to zero rather than blocking a legitimate sale over a stale number. `shortBy` is returned so
   *  the caller can surface a discrepancy instead of hiding it.
   */
  async recordRetailSale(ctx: InvCtx, productId: string, quantity: number, ticketId?: string): Promise<{ consumed: number; shortBy: number; onHand: number }> {
    const qty = Math.max(0, Math.trunc(quantity));
    if (qty <= 0) return { consumed: 0, shortBy: 0, onHand: 0 };
    const before = (await this.recompute(ctx, productId)).onHand;
    // Oldest sealed units first (FIFO) — the same order a person would take them off the shelf.
    const picked = await sql<{ id: string }>`SELECT id FROM inventory_units
      WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId} AND status = 'unopened'
      ORDER BY created_at ASC LIMIT ${qty}`.execute(this.need());
    const ids = picked.rows.map((r) => r.id);
    for (const id of ids) {
      await sql`UPDATE inventory_units SET status = 'sold', updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    }
    const after = (await this.recompute(ctx, productId)).onHand;
    await this.move(ctx, productId, null, 'retail_sale', before, after - before, after,
      ids.length < qty ? `sold ${qty}, only ${ids.length} in stock` : undefined,
      ticketId ? { type: 'ticket', id: ticketId } : undefined);
    await this.audit(ctx, 'inventory_retail_sold', productId, null, { quantity: qty, consumed: ids.length, shortBy: qty - ids.length, ticketId: ticketId ?? null });
    return { consumed: ids.length, shortBy: qty - ids.length, onHand: after };
  }

  // ---- bottle lifecycle ----
  private async transition(ctx: InvCtx, unitId: string, to: BottleStatus, audit: string, moveType: MovementType, byCol?: 'opened' | 'emptied') {
    const u = await this.unit(ctx, unitId);
    if (!canTransitionBottle(u.status, to)) throw new InventoryError(409, `Cannot change bottle from ${u.status} to ${to}`);
    const stamp = byCol === 'opened' ? sql`, opened_at = now(), opened_by_user_id = ${ctx.userId}` : byCol === 'emptied' ? sql`, emptied_at = now(), emptied_by_user_id = ${ctx.userId}` : sql``;
    const before = (await this.recompute(ctx, u.product_id)).onHand;
    await sql`UPDATE inventory_units SET status = ${to}, updated_at = now() ${stamp} WHERE id = ${unitId} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(this.need());
    const after = (await this.recompute(ctx, u.product_id)).onHand;
    await this.move(ctx, u.product_id, unitId, moveType, before, after - before, after, undefined);
    await this.audit(ctx, audit, u.product_id, unitId, { from: u.status, to });
    const reorder = await this.reorderAlert(ctx, u.product_id);
    return { unit: await this.unit(ctx, unitId), product: (await this.getProduct(ctx, u.product_id)).product, reorderAlert: reorder };
  }
  openUnit(ctx: InvCtx, unitId: string) { return this.transition(ctx, unitId, 'opened', 'inventory_bottle_opened', 'bottle_opened', 'opened'); }
  markLow(ctx: InvCtx, unitId: string) { return this.transition(ctx, unitId, 'low', 'inventory_bottle_marked_low', 'technician_report'); }
  markEmpty(ctx: InvCtx, unitId: string) { return this.transition(ctx, unitId, 'empty', 'inventory_bottle_marked_empty', 'bottle_empty', 'emptied'); }
  markDamaged(ctx: InvCtx, unitId: string) { return this.transition(ctx, unitId, 'damaged', 'inventory_bottle_damaged', 'damaged'); }

  private async reorderAlert(ctx: InvCtx, productId: string): Promise<{ needed: boolean; suggested: number } | null> {
    const p = await sql<any>`SELECT reorder_level, reorder_quantity FROM inventory_products WHERE id = ${productId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    const s = await sql<any>`SELECT quantity_on_hand FROM inventory_location_stock WHERE product_id = ${productId} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(this.need());
    const onHand = s.rows[0]?.quantity_on_hand ?? 0; const lvl = p.rows[0]?.reorder_level ?? 0;
    const suggested = reorderSuggestion(onHand, lvl, p.rows[0]?.reorder_quantity ?? 0);
    return suggested > 0 ? { needed: true, suggested } : null;
  }

  // ---- technician reports ----
  async submitReport(ctx: InvCtx, b: any) {
    const type = String(b?.reportType || '');
    if (!type) throw new InventoryError(400, 'Report type required');
    let unitStatus: BottleStatus | null = null; let productId = b?.productId ?? null;
    if (b?.unitId) { const u = await this.unit(ctx, b.unitId); unitStatus = u.status; productId = u.product_id; }
    if (!productId) throw new InventoryError(400, 'Product or bottle required');
    await this.product(ctx, productId); // tenant ownership check
    const invalid = validateTechReport(type, unitStatus);
    if (invalid) throw new InventoryError(409, invalid);
    try {
      const r = await sql<{ id: string }>`INSERT INTO inventory_technician_reports
        (tenant_id, branch_id, product_id, inventory_unit_id, technician_user_id, service_ticket_id, report_type, reported_quantity, estimated_remaining_percent, photo_url, note, status)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId}, ${b?.unitId ?? null}, ${ctx.userId}, ${b?.serviceTicketId ?? null}, ${type}, ${b?.reportedQuantity ?? null}, ${b?.estimatedRemainingPercent ?? null}, ${b?.photoUrl ?? null}, ${b?.note ?? null}, ${'pending'}) RETURNING id`.execute(this.need());
      await this.audit(ctx, 'inventory_technician_report_submitted', productId, b?.unitId ?? null, { type });
      return { reportId: r.rows[0].id, status: 'pending' };
    } catch (e: any) {
      if (String(e?.message || '').includes('idx_inv_techrep_dedup') || e?.code === '23505') throw new InventoryError(409, 'This bottle already has a pending report of that type');
      throw e;
    }
  }

  async myReports(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    return { reports: (await sql<any>`SELECT r.id, r.product_id, r.inventory_unit_id, r.report_type, r.status, r.note, r.created_at, p.name AS product_name, p.color_number FROM inventory_technician_reports r
      LEFT JOIN inventory_products p ON p.id = r.product_id
      WHERE r.tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR r.branch_id = ${branchId}) AND r.technician_user_id = ${ctx.userId} ORDER BY r.created_at DESC LIMIT 50`.execute(this.need())).rows };
  }

  async listReports(ctx: InvCtx, status = 'pending') {
    const branchId = await this.resolveBranchId(ctx);
    return { reports: (await sql<any>`SELECT r.*, p.name AS product_name, p.color_number FROM inventory_technician_reports r
      JOIN inventory_products p ON p.id = r.product_id
      WHERE r.tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR r.branch_id = ${branchId}) AND (${status || null}::text IS NULL OR r.status = ${status}) ORDER BY r.created_at DESC LIMIT 100`.execute(this.need())).rows };
  }

  async approveReport(ctx: InvCtx, reportId: string) {
    const branchId = await this.resolveBranchId(ctx);
    const r = await sql<any>`SELECT * FROM inventory_technician_reports WHERE id = ${reportId} AND tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId})`.execute(this.need());
    const rep = r.rows[0]; if (!rep) throw new InventoryError(404, 'Report not found');
    if (rep.status !== 'pending') throw new InventoryError(409, 'Report already reviewed');
    // Phase 12 (#27): the review is claimed FIRST (conditional pending → approved through INVENTORY_TECH_REPORT), then the
    // stock effect is applied — two concurrent approvals used to both pass the check above and apply the effect twice
    await transitionStatus(this.need(), INVENTORY_TECH_REPORT, { where: { id: reportId, tenant_id: ctx.tenantId }, from: 'pending', to: 'approved', set: { reviewed_by_user_id: ctx.userId, reviewed_at: sql`now()`, updated_at: sql`now()` } });
    // apply the effect of the report
    if (rep.inventory_unit_id) {
      try {
        if (rep.report_type === 'bottle_empty') await this.markEmpty(ctx, rep.inventory_unit_id);
        else if (rep.report_type === 'bottle_low') await this.markLow(ctx, rep.inventory_unit_id);
        else if (rep.report_type === 'open_new') await this.openUnit(ctx, rep.inventory_unit_id);
        else if (rep.report_type === 'damaged') await this.markDamaged(ctx, rep.inventory_unit_id);
      } catch { /* bottle may already be in the target state; approval still records */ }
    }
    await this.audit(ctx, 'inventory_technician_report_approved', rep.product_id, rep.inventory_unit_id, { type: rep.report_type });
    return { ok: true };
  }
  async rejectReport(ctx: InvCtx, reportId: string, note?: string) {
    const branchId = await this.resolveBranchId(ctx);
    const r = await sql<any>`SELECT product_id, inventory_unit_id, status FROM inventory_technician_reports WHERE id = ${reportId} AND tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId})`.execute(this.need());
    if (!r.rows[0]) throw new InventoryError(404, 'Report not found');
    if (r.rows[0].status !== 'pending') throw new InventoryError(409, 'Report already reviewed');
    await transitionStatus(this.need(), INVENTORY_TECH_REPORT, { where: { id: reportId, tenant_id: ctx.tenantId }, from: 'pending', to: 'rejected', set: { reviewed_by_user_id: ctx.userId, reviewed_at: sql`now()`, resolution_note: note ?? null, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_technician_report_rejected', r.rows[0].product_id, r.rows[0].inventory_unit_id, {});
    return { ok: true };
  }

  // ---- summary / alerts ----
  async summary(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    const rows = await sql<any>`SELECT p.reorder_level, p.critical_level, p.maximum_stock, p.cost_cents, p.track_expiration,
        s.reorder_level_override, s.critical_level_override,
        coalesce(s.quantity_on_hand,0) AS on_hand, coalesce(s.quantity_unopened,0) AS unopened, coalesce(s.quantity_open,0) AS open, coalesce(s.quantity_empty,0) AS empty
      FROM inventory_products p
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND (${branchId}::uuid IS NULL OR s.branch_id = ${branchId})
      WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL`.execute(this.need());
    let totalProducts = 0, totalBottles = 0, openBottles = 0, unopenedBottles = 0, lowStock = 0, outOfStock = 0, valueCents = 0;
    for (const r of rows.rows) {
      totalProducts++; totalBottles += r.on_hand; openBottles += r.open; unopenedBottles += r.unopened; valueCents += (r.on_hand * (r.cost_cents || 0));
      const reorderLvl = r.reorder_level_override ?? r.reorder_level ?? 0;
      const critLvl = r.critical_level_override ?? r.critical_level ?? null;
      const st = stockStatus(r.on_hand, reorderLvl, r.maximum_stock, critLvl);
      if (st === 'out_of_stock') outOfStock++; else if (st === 'low' || st === 'critical') lowStock++;
    }
    const pending = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_technician_reports WHERE tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND status = 'pending'`.execute(this.need());
    const expiring = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_units WHERE tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND status IN ('unopened','opened','low') AND expiration_date IS NOT NULL AND expiration_date <= (now() + interval '30 days')`.execute(this.need());
    const summary: any = { totalProducts, totalBottles, openBottles, unopenedBottles, lowStock, outOfStock, expiringSoon: expiring.rows[0]?.n ?? 0, pendingReports: pending.rows[0]?.n ?? 0 };
    if (!this.isTechOnly(ctx)) summary.inventoryValueCents = valueCents;
    return { summary };
  }

  async alerts(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    const low = await sql<any>`SELECT p.id, p.name, p.color_number, p.reorder_level, p.reorder_quantity, coalesce(s.quantity_on_hand,0) AS on_hand,
        s.reorder_level_override, s.reorder_quantity_override
      FROM inventory_products p LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND (${branchId}::uuid IS NULL OR s.branch_id = ${branchId})
      WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL AND coalesce(s.reorder_level_override, p.reorder_level) > 0 AND coalesce(s.quantity_on_hand,0) <= coalesce(s.reorder_level_override, p.reorder_level)
      ORDER BY coalesce(s.quantity_on_hand,0) ASC LIMIT 100`.execute(this.need());
    return { alerts: low.rows.map((p) => {
      const rLvl = p.reorder_level_override ?? p.reorder_level ?? 0;
      const rQty = p.reorder_quantity_override ?? p.reorder_quantity ?? 0;
      return { productId: p.id, name: p.name, colorNumber: p.color_number, onHand: p.on_hand, status: stockStatus(p.on_hand, rLvl, null), suggested: reorderSuggestion(p.on_hand, rLvl, rQty) };
    }) };
  }

  // ---- purchase orders (§18) — create / approve / receive / cancel ----
  private async po(ctx: InvCtx, id: string) {
    const r = await sql<any>`SELECT * FROM purchase_orders WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(this.need());
    if (!r.rows[0]) throw new InventoryError(404, 'Purchase order not found');
    return r.rows[0];
  }

  async listPurchaseOrders(ctx: InvCtx, status?: string) {
    const branchId = await this.resolveBranchId(ctx);
    const rows = await sql<any>`
      SELECT po.id, po.po_number, po.status, po.expected_date, po.subtotal_cents, po.shipping_cents, po.tax_cents, po.total_cents,
             po.created_at, po.approved_at, po.received_at, v.name AS vendor_name,
             (SELECT count(*)::int FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS line_count,
             (SELECT coalesce(sum(l.quantity_ordered),0)::int FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS qty_ordered,
             (SELECT coalesce(sum(l.quantity_received),0)::int FROM purchase_order_lines l WHERE l.purchase_order_id = po.id) AS qty_received
      FROM purchase_orders po
      LEFT JOIN inventory_vendors v ON v.id = po.vendor_id
      WHERE po.tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR po.branch_id = ${branchId})
        AND (${status || null}::text IS NULL OR po.status = ${status})
      ORDER BY po.created_at DESC LIMIT 100`.execute(this.need());
    const out = rows.rows;
    if (this.isTechOnly(ctx)) out.forEach((p: any) => { delete p.subtotal_cents; delete p.shipping_cents; delete p.tax_cents; delete p.total_cents; });
    return { purchaseOrders: out };
  }

  async getPurchaseOrder(ctx: InvCtx, id: string) {
    const po = await this.po(ctx, id);
    const lines = await sql<any>`
      SELECT l.id, l.product_id, l.quantity_ordered, l.quantity_received, l.unit_cost_cents, l.lot_number, l.expiration_date,
             p.name AS product_name, p.color_number
      FROM purchase_order_lines l JOIN inventory_products p ON p.id = l.product_id
      WHERE l.purchase_order_id = ${id} AND l.tenant_id = ${ctx.tenantId} ORDER BY p.name`.execute(this.need());
    if (this.isTechOnly(ctx)) { delete po.subtotal_cents; delete po.shipping_cents; delete po.tax_cents; delete po.total_cents; lines.rows.forEach((l: any) => delete l.unit_cost_cents); }
    return { purchaseOrder: po, lines: lines.rows };
  }

  async createPurchaseOrder(ctx: InvCtx, b: any) {
    const raw = Array.isArray(b?.lines) ? b.lines : [];
    if (raw.length === 0) throw new InventoryError(400, 'A purchase order needs at least one line item');
    const clean: { productId: string; quantityOrdered: number; unitCostCents: number }[] = [];
    for (const l of raw) {
      const pid = l?.productId;
      if (!pid) throw new InventoryError(400, 'Each line needs a product');
      await this.product(ctx, pid); // tenant ownership + existence
      const qty = parseInt(l?.quantityOrdered, 10) || 0;
      if (qty < 1) throw new InventoryError(400, 'Each line needs a quantity of at least 1');
      if (qty > 100000) throw new InventoryError(400, 'Line quantity is too large');
      clean.push({ productId: pid, quantityOrdered: qty, unitCostCents: Math.max(0, parseInt(l?.unitCostCents, 10) || 0) });
    }
    const shipping = Math.max(0, parseInt(b?.shippingCents, 10) || 0);
    const tax = Math.max(0, parseInt(b?.taxCents, 10) || 0);
    const totals = poTotals(clean, shipping, tax);
    const poNum = 'PO-' + Date.now().toString(36).toUpperCase();
    const r = await sql<{ id: string }>`INSERT INTO purchase_orders
      (tenant_id, branch_id, vendor_id, po_number, status, expected_date, notes, subtotal_cents, shipping_cents, tax_cents, total_cents, created_by_user_id)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${b?.vendorId ?? null}, ${poNum}, 'draft', ${b?.expectedDate ?? null}, ${b?.notes ?? null}, ${totals.subtotalCents}, ${shipping}, ${tax}, ${totals.totalCents}, ${ctx.userId}) RETURNING id`.execute(this.need());
    const poId = r.rows[0].id;
    for (const l of clean) {
      await sql`INSERT INTO purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, unit_cost_cents)
        VALUES (${ctx.tenantId}, ${poId}, ${l.productId}, ${l.quantityOrdered}, ${l.unitCostCents})`.execute(this.need());
    }
    await this.audit(ctx, 'inventory_po_created', null, null, { id: poId, poNumber: poNum, lines: clean.length, totalCents: totals.totalCents });
    let approvalId: string | null = null;
    if (this.approvals && await this.approvals.needsApproval(ctx.tenantId, 'purchase_order', totals.totalCents).catch(() => false)) {
      try { approvalId = (await this.approvals.request(poActor(ctx), { kind: 'purchase_order', subjectType: 'purchase_order', subjectId: poId, amountCents: totals.totalCents, reason: String(b?.notes ?? '').trim().slice(0, 200) || 'New purchase order' })).request.id; }
      catch { /* the PO stays a draft; the approve route decides it directly */ }
    }
    return { id: poId, poNumber: poNum, approvalId };
  }

  async approvePurchaseOrder(ctx: InvCtx, id: string) {
    if (this.approvals && PO_UUID.test(id)) {
      const live = await this.approvals.liveFor(poActor(ctx), 'purchase_order', 'purchase_order', id);
      if (live && live.status === 'pending') {
        let out: { status: string; payload?: Record<string, unknown> };
        try { out = await this.approvals.decide(poActor(ctx), live.id, { decision: 'approve', note: null, expectedVersion: live.version }); }
        catch (e: any) { throw new InventoryError(Number(e?.status) || 400, String(e?.message ?? 'Not allowed.')); }
        if (out.status === 'execution_failed') throw new InventoryError(409, String((out.payload?.executionResult as any)?.error ?? 'The purchase order could not be approved.'));
        return this.getPurchaseOrder(ctx, id);
      }
    }
    return this.approvePurchaseOrderDirect(ctx, id);
  }
  private async approvePurchaseOrderDirect(ctx: InvCtx, id: string) {
    const po = await this.po(ctx, id);
    if (po.status !== 'draft') throw new InventoryError(409, `Cannot approve a ${po.status} purchase order`);
    // Phase 12 (#27): conditional on the state just read — a concurrent cancel is not overwritten (409 instead)
    await transitionStatus(this.need(), PURCHASE_ORDER, { where: { id, tenant_id: ctx.tenantId }, from: 'draft', to: 'approved', set: { approved_by_user_id: ctx.userId, approved_at: sql`now()`, ordered_at: sql`now()`, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_po_approved', null, null, { id });
    return this.getPurchaseOrder(ctx, id);
  }

  async cancelPurchaseOrder(ctx: InvCtx, id: string, note?: string) {
    const po = await this.po(ctx, id);
    if (po.status === 'received' || po.status === 'cancelled' || po.status === 'closed') throw new InventoryError(409, `Cannot cancel a ${po.status} purchase order`);
    // Phase 12 (#27): a receive that lands first wins — the cancel is refused (409), never written over a received PO
    await transitionStatus(this.need(), PURCHASE_ORDER, { where: { id, tenant_id: ctx.tenantId }, from: po.status, to: 'cancelled', set: { cancelled_at: sql`now()`, notes: sql`coalesce(${note ?? null}, notes)`, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_po_cancelled', null, null, { id });
    return { ok: true };
  }

  /** Receive against a PO. Claim-first per line (guarded UPDATE) so the same line can never be received
   *  twice; physical stock is only added after the claim succeeds. Status recomputes to partial/received. */
  async receivePurchaseOrder(ctx: InvCtx, id: string, b: any) {
    const po = await this.po(ctx, id);
    if (!canReceivePO(po.status)) throw new InventoryError(409, `Cannot receive a ${po.status} purchase order`);
    const reqLines: { lineId: string; quantity: number; lotNumber?: string; expirationDate?: string }[] = Array.isArray(b?.lines) ? b.lines : [];
    if (reqLines.length === 0) throw new InventoryError(400, 'Nothing to receive');
    let receivedAny = false;
    for (const rl of reqLines) {
      const want = parseInt(rl?.quantity as any, 10) || 0;
      if (want <= 0) continue;
      const lineRow = await sql<any>`SELECT id, product_id, quantity_ordered, quantity_received, unit_cost_cents, lot_number, expiration_date, storage_location
        FROM purchase_order_lines WHERE id = ${rl.lineId} AND purchase_order_id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
      const line = lineRow.rows[0];
      if (!line) throw new InventoryError(404, 'Purchase order line not found');
      const take = receivableQty(line.quantity_ordered, line.quantity_received, want);
      if (take <= 0) continue;
      // claim-first: guarded bump so received can never exceed ordered, even under concurrent receivers (§25)
      const claim = await sql<{ id: string }>`UPDATE purchase_order_lines
        SET quantity_received = quantity_received + ${take},
            lot_number = coalesce(${rl?.lotNumber ?? null}, lot_number),
            expiration_date = coalesce(${rl?.expirationDate ?? null}, expiration_date),
            updated_at = now()
        WHERE id = ${line.id} AND purchase_order_id = ${id} AND tenant_id = ${ctx.tenantId}
          AND quantity_received + ${take} <= quantity_ordered
        RETURNING id`.execute(this.need());
      if (!claim.rows[0]) continue; // lost the race — another receiver already took it
      // only AFTER the claim do we create physical stock (units + 'purchase_received' movement + recompute)
      let remaining = take;
      while (remaining > 0) {
        const chunk = Math.min(1000, remaining);
        await this.addStock(ctx, line.product_id, {
          quantity: chunk, costCents: line.unit_cost_cents || undefined,
          lotNumber: rl?.lotNumber ?? line.lot_number ?? null, expirationDate: rl?.expirationDate ?? line.expiration_date ?? null,
          storageLocation: line.storage_location ?? null, purchaseOrderId: id, note: 'PO ' + (po.po_number || id),
        });
        remaining -= chunk;
      }
      receivedAny = true;
    }
    if (!receivedAny) throw new InventoryError(409, 'Those lines are already fully received');
    const allLines = await sql<any>`SELECT quantity_ordered AS "quantityOrdered", quantity_received AS "quantityReceived" FROM purchase_order_lines WHERE purchase_order_id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    const newStatus = poReceivingStatus(allLines.rows) === 'received' ? 'received' : 'partial';
    // Phase 12 (#27): only from a receivable state — a PO cancelled while these lines were received is NOT flipped back
    // to received (it was, before: the unconditional update overwrote the cancel)
    await transitionStatus(this.need(), PURCHASE_ORDER, { where: { id, tenant_id: ctx.tenantId }, from: ['approved', 'ordered', 'partial'], to: newStatus, set: { received_at: newStatus === 'received' ? sql`now()` : sql`received_at`, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_po_received', null, null, { id, status: newStatus });
    return this.getPurchaseOrder(ctx, id);
  }

  // ---- branch transfers (§19) — move stock between branches in the same tenant ----
  private async branch(ctx: InvCtx, id: string) {
    const r = await sql<{ id: string; name: string }>`SELECT id, name FROM branches WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL`.execute(this.need());
    if (!r.rows[0]) throw new InventoryError(404, 'Branch not found');
    return r.rows[0];
  }

  async listTransferBranches(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    const r = await sql<any>`SELECT id, name, city, state FROM branches
      WHERE tenant_id = ${ctx.tenantId} AND deleted_at IS NULL AND status = 'active' AND (${branchId}::uuid IS NULL OR id <> ${branchId}) ORDER BY name`.execute(this.need());
    return { branches: r.rows };
  }

  async listTransfers(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    const r = await sql<any>`
      SELECT t.id, t.transfer_number, t.status, t.from_branch_id, t.to_branch_id, t.item_count, t.unit_count, t.notes, t.created_at,
             fb.name AS from_branch_name, tb.name AS to_branch_name, (t.from_branch_id = ${branchId}) AS outbound
      FROM inventory_transfers t
      LEFT JOIN branches fb ON fb.id = t.from_branch_id
      LEFT JOIN branches tb ON tb.id = t.to_branch_id
      WHERE t.tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR t.from_branch_id = ${branchId} OR t.to_branch_id = ${branchId})
      ORDER BY t.created_at DESC LIMIT 100`.execute(this.need());
    return { transfers: r.rows };
  }

  async getTransfer(ctx: InvCtx, id: string) {
    const h = await sql<any>`SELECT t.*, fb.name AS from_branch_name, tb.name AS to_branch_name
      FROM inventory_transfers t LEFT JOIN branches fb ON fb.id = t.from_branch_id LEFT JOIN branches tb ON tb.id = t.to_branch_id
      WHERE t.id = ${id} AND t.tenant_id = ${ctx.tenantId} AND (t.from_branch_id = ${ctx.branchId} OR t.to_branch_id = ${ctx.branchId})`.execute(this.need());
    if (!h.rows[0]) throw new InventoryError(404, 'Transfer not found');
    const lines = await sql<any>`SELECT l.id, l.product_id, l.quantity_requested, l.quantity_moved, p.name AS product_name, p.color_number
      FROM inventory_transfer_lines l JOIN inventory_products p ON p.id = l.product_id
      WHERE l.transfer_id = ${id} AND l.tenant_id = ${ctx.tenantId} ORDER BY p.name`.execute(this.need());
    return { transfer: h.rows[0], lines: lines.rows };
  }

  /** Create + execute an immediate branch transfer. Movable bottles are claimed at the source with
   *  FOR UPDATE SKIP LOCKED (claim-first — a bottle can't be double-moved or moved while being sold),
   *  reassigned to the destination branch, and both branches' stock is recomputed from unit rows.
   *  quantity_moved reflects what was actually on hand; a paired transfer_out/transfer_in is logged. */
  async createTransfer(ctx: InvCtx, b: any) {
    const toBranchId = b?.toBranchId;
    if (!toBranchId) throw new InventoryError(400, 'A destination branch is required');
    if (toBranchId === ctx.branchId) throw new InventoryError(400, 'Source and destination branches must differ');
    await this.branch(ctx, toBranchId); // destination belongs to this tenant
    const raw = Array.isArray(b?.lines) ? b.lines : [];
    if (raw.length === 0) throw new InventoryError(400, 'A transfer needs at least one product line');

    const destCtx: InvCtx = { ...ctx, branchId: toBranchId };
    const transferNumber = 'TR-' + Date.now().toString(36).toUpperCase();
    const th = await sql<{ id: string }>`INSERT INTO inventory_transfers
      (tenant_id, from_branch_id, to_branch_id, transfer_number, status, notes, created_by_user_id)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${toBranchId}, ${transferNumber}, 'completed', ${b?.notes ?? null}, ${ctx.userId}) RETURNING id`.execute(this.need());
    const transferId = th.rows[0].id;

    let itemCount = 0, unitCount = 0;
    for (const l of raw) {
      const pid = l?.productId;
      if (!pid) throw new InventoryError(400, 'Each line needs a product');
      await this.product(ctx, pid); // tenant ownership + existence
      const want = parseInt(l?.quantity, 10) || 0;
      if (want < 1) throw new InventoryError(400, 'Each line needs a quantity of at least 1');

      const srcBefore = (await this.recompute(ctx, pid)).onHand;
      const destBefore = (await this.recompute(destCtx, pid)).onHand;
      // claim movable bottles at the source (freshest first) and reassign them to the destination branch
      const moved = await sql<{ id: string }>`
        WITH picked AS (
          SELECT id FROM inventory_units
          WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${pid}
            AND status IN ('unopened', 'opened', 'low')
          ORDER BY CASE status WHEN 'unopened' THEN 0 WHEN 'opened' THEN 1 ELSE 2 END, received_at NULLS LAST
          LIMIT ${want}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE inventory_units u SET branch_id = ${toBranchId}, storage_location = NULL, updated_at = now()
        FROM picked WHERE u.id = picked.id RETURNING u.id`.execute(this.need());
      const movedCount = moved.rows.length;

      const srcAfter = (await this.recompute(ctx, pid)).onHand;
      const destAfter = (await this.recompute(destCtx, pid)).onHand;

      await sql`INSERT INTO inventory_transfer_lines (tenant_id, transfer_id, product_id, quantity_requested, quantity_moved)
        VALUES (${ctx.tenantId}, ${transferId}, ${pid}, ${want}, ${movedCount})`.execute(this.need());

      if (movedCount > 0) {
        await this.move(ctx, pid, null, 'transfer_out', srcBefore, -movedCount, srcAfter, 'Transfer ' + transferNumber, { type: 'transfer', id: transferId });
        await this.move(destCtx, pid, null, 'transfer_in', destBefore, movedCount, destAfter, 'Transfer ' + transferNumber, { type: 'transfer', id: transferId });
        itemCount += 1; unitCount += movedCount;
      }
    }

    if (unitCount === 0) {
      // nothing was available — don't leave an empty transfer behind
      await sql`DELETE FROM inventory_transfer_lines WHERE transfer_id = ${transferId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
      await sql`DELETE FROM inventory_transfers WHERE id = ${transferId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
      throw new InventoryError(409, 'No stock was available to transfer for the selected products');
    }
    await sql`UPDATE inventory_transfers SET item_count = ${itemCount}, unit_count = ${unitCount}, updated_at = now() WHERE id = ${transferId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_transfer_created', null, null, { id: transferId, transferNumber, toBranchId, items: itemCount, units: unitCount });
    return this.getTransfer(ctx, transferId);
  }

  // ---- physical inventory counts (§20) — snapshot, enter, reconcile to system of record ----
  private async count(ctx: InvCtx, id: string) {
    const r = await sql<any>`SELECT * FROM inventory_counts WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(this.need());
    if (!r.rows[0]) throw new InventoryError(404, 'Count not found');
    return r.rows[0];
  }

  async listCounts(ctx: InvCtx, status?: string) {
    const branchId = await this.resolveBranchId(ctx);
    const rows = await sql<any>`
      SELECT c.id, c.count_number, c.status, c.scope_type, c.scope_id, c.notes, c.line_count, c.counted_count, c.variance_units, c.created_at, c.reconciled_at,
             CASE c.scope_type WHEN 'category' THEN cat.name WHEN 'brand' THEN br.name ELSE 'All products' END AS scope_label
      FROM inventory_counts c
      LEFT JOIN inventory_categories cat ON cat.id = c.scope_id AND c.scope_type = 'category'
      LEFT JOIN inventory_brands br ON br.id = c.scope_id AND c.scope_type = 'brand'
      WHERE c.tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR c.branch_id = ${branchId})
        AND (${status || null}::text IS NULL OR c.status = ${status})
      ORDER BY c.created_at DESC LIMIT 100`.execute(this.need());
    return { counts: rows.rows };
  }

  async getCount(ctx: InvCtx, id: string) {
    const c = await this.count(ctx, id);
    const lines = await sql<any>`
      SELECT l.id, l.product_id, l.expected_qty, l.counted_qty, l.is_counted, p.name AS product_name, p.color_number
      FROM inventory_count_lines l JOIN inventory_products p ON p.id = l.product_id
      WHERE l.count_id = ${id} AND l.tenant_id = ${ctx.tenantId} ORDER BY p.name`.execute(this.need());
    return { count: c, lines: lines.rows };
  }

  async createCount(ctx: InvCtx, b: any) {
    const scopeType = (b?.scopeType === 'category' || b?.scopeType === 'brand') ? b.scopeType : 'all';
    const scopeId = scopeType === 'all' ? null : (b?.scopeId ?? null);
    if (scopeType !== 'all' && !scopeId) throw new InventoryError(400, 'A category or brand is required for a scoped count');
    // snapshot the system's current on-hand for every in-scope product at this branch
    const products = await sql<{ id: string; on_hand: number }>`
      SELECT p.id, COALESCE(ls.quantity_on_hand, 0) AS on_hand
      FROM inventory_products p
      LEFT JOIN inventory_location_stock ls ON ls.product_id = p.id AND ls.branch_id = ${ctx.branchId} AND ls.tenant_id = ${ctx.tenantId}
      WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL
        AND (${scopeType}::text = 'all'
             OR (${scopeType}::text = 'category' AND p.category_id = ${scopeId}::uuid)
             OR (${scopeType}::text = 'brand' AND p.brand_id = ${scopeId}::uuid))
      ORDER BY p.name`.execute(this.need());
    if (products.rows.length === 0) throw new InventoryError(400, 'No products to count for that scope');
    const countNumber = 'CNT-' + Date.now().toString(36).toUpperCase();
    const r = await sql<{ id: string }>`INSERT INTO inventory_counts
      (tenant_id, branch_id, count_number, status, scope_type, scope_id, notes, line_count, started_by_user_id)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${countNumber}, 'in_progress', ${scopeType}, ${scopeId}, ${b?.notes ?? null}, ${products.rows.length}, ${ctx.userId}) RETURNING id`.execute(this.need());
    const countId = r.rows[0].id;
    for (const p of products.rows) {
      await sql`INSERT INTO inventory_count_lines (tenant_id, count_id, product_id, expected_qty)
        VALUES (${ctx.tenantId}, ${countId}, ${p.id}, ${p.on_hand})`.execute(this.need());
    }
    await this.audit(ctx, 'inventory_count_started', null, null, { id: countId, countNumber, scopeType, lines: products.rows.length });
    return { id: countId, countNumber };
  }

  async enterCount(ctx: InvCtx, countId: string, b: any) {
    const c = await this.count(ctx, countId);
    if (c.status !== 'in_progress') throw new InventoryError(409, `Cannot enter counts on a ${c.status} count`);
    const reqLines: { lineId: string; countedQty: number | null }[] = Array.isArray(b?.lines) ? b.lines : (b?.lineId ? [{ lineId: b.lineId, countedQty: b.countedQty }] : []);
    if (reqLines.length === 0) throw new InventoryError(400, 'Nothing to record');
    for (const rl of reqLines) {
      const counted = (rl?.countedQty === null || rl?.countedQty === undefined || (rl.countedQty as any) === '') ? null : clampCount(parseInt(rl.countedQty as any, 10) || 0);
      await sql`UPDATE inventory_count_lines SET counted_qty = ${counted}, is_counted = ${counted !== null}, updated_at = now()
        WHERE id = ${rl.lineId} AND count_id = ${countId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    }
    const cc = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_count_lines WHERE count_id = ${countId} AND tenant_id = ${ctx.tenantId} AND is_counted = true`.execute(this.need());
    await sql`UPDATE inventory_counts SET counted_count = ${cc.rows[0].n}, updated_at = now() WHERE id = ${countId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    return this.getCount(ctx, countId);
  }

  async submitCount(ctx: InvCtx, id: string) {
    const c = await this.count(ctx, id);
    if (c.status !== 'in_progress') throw new InventoryError(409, `Cannot submit a ${c.status} count`);
    await transitionStatus(this.need(), INVENTORY_COUNT, { where: { id, tenant_id: ctx.tenantId }, from: 'in_progress', to: 'submitted', set: { updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_count_submitted', null, null, { id });
    return this.getCount(ctx, id);
  }

  async cancelCount(ctx: InvCtx, id: string) {
    const c = await this.count(ctx, id);
    if (c.status === 'reconciled' || c.status === 'cancelled') throw new InventoryError(409, `Cannot cancel a ${c.status} count`);
    await transitionStatus(this.need(), INVENTORY_COUNT, { where: { id, tenant_id: ctx.tenantId }, from: c.status, to: 'cancelled', set: { cancelled_at: sql`now()`, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_count_cancelled', null, null, { id });
    return { ok: true };
  }

  /** Reconcile: correct the system to the counted quantities. For each counted line, recompute the live
   *  on-hand and apply the delta — add unopened units for a surplus, mark units 'missing' for shrinkage —
   *  writing an adjustment_increase / adjustment_decrease movement. Uncounted lines are skipped. */
  async reconcileCount(ctx: InvCtx, id: string) {
    const c = await this.count(ctx, id);
    if (c.status !== 'in_progress' && c.status !== 'submitted') throw new InventoryError(409, `Cannot reconcile a ${c.status} count`);
    // Phase 12 (#27): CLAIM the transition first — two reconciles of the same count used to both apply the stock
    // adjustments; now the second is refused (409) before it touches a single bottle
    await transitionStatus(this.need(), INVENTORY_COUNT, { where: { id, tenant_id: ctx.tenantId }, from: c.status, to: 'reconciled', set: { reconciled_by_user_id: ctx.userId, reconciled_at: sql`now()`, updated_at: sql`now()` } });
    const lines = await sql<any>`SELECT id, product_id, counted_qty FROM inventory_count_lines
      WHERE count_id = ${id} AND tenant_id = ${ctx.tenantId} AND is_counted = true AND counted_qty IS NOT NULL`.execute(this.need());
    let absVariance = 0;
    for (const l of lines.rows) {
      const counted = clampCount(l.counted_qty);
      const cur = (await this.recompute(ctx, l.product_id)).onHand;
      const delta = counted - cur;
      if (delta === 0) continue;
      if (delta > 0) {
        for (let i = 0; i < delta; i++) {
          await sql`INSERT INTO inventory_units (tenant_id, branch_id, product_id, status)
            VALUES (${ctx.tenantId}, ${ctx.branchId}, ${l.product_id}, ${'unopened'})`.execute(this.need());
        }
      } else {
        // mark |delta| movable bottles 'missing' (claim-first so a concurrent sale can't double-remove them)
        await sql`
          WITH picked AS (
            SELECT id FROM inventory_units
            WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${l.product_id}
              AND status IN ('unopened', 'opened', 'low')
            ORDER BY CASE status WHEN 'low' THEN 0 WHEN 'opened' THEN 1 ELSE 2 END
            LIMIT ${-delta} FOR UPDATE SKIP LOCKED
          )
          UPDATE inventory_units u SET status = 'missing', updated_at = now() FROM picked WHERE u.id = picked.id`.execute(this.need());
      }
      const after = (await this.recompute(ctx, l.product_id)).onHand;
      const applied = after - cur;
      if (applied !== 0) {
        await this.move(ctx, l.product_id, null, applied > 0 ? 'adjustment_increase' : 'adjustment_decrease', cur, applied, after, 'Count ' + (c.count_number || id), { type: 'inventory_count', id });
        absVariance += Math.abs(applied);
      }
    }
    await sql`UPDATE inventory_counts SET variance_units = ${absVariance}, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_count_reconciled', null, null, { id, varianceUnits: absVariance });
    return this.getCount(ctx, id);
  }

  // ---- service recipes (§13) — products a service consumes; deduction writes service_usage movements ----
  private async service(ctx: InvCtx, id: string) {
    const branchId = await this.resolveBranchId(ctx);
    const r = await sql<{ id: string; name: string }>`SELECT id, name FROM services WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND archived_at IS NULL`.execute(this.need());
    if (!r.rows[0]) throw new InventoryError(404, 'Service not found');
    return r.rows[0];
  }

  async listServicesForRecipes(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    const rows = await sql<any>`
      SELECT s.id, s.name, s.price_cents, COALESCE(r.n, 0) AS recipe_lines, COALESCE(r.units, 0) AS recipe_units
      FROM services s
      LEFT JOIN (SELECT service_id, count(*)::int AS n, COALESCE(sum(quantity), 0)::int AS units FROM service_product_recipes WHERE tenant_id = ${ctx.tenantId} GROUP BY service_id) r ON r.service_id = s.id
      WHERE s.tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR s.branch_id = ${branchId}) AND s.archived_at IS NULL AND s.status = 'active'
      ORDER BY s.sort_order, s.name`.execute(this.need());
    return { services: rows.rows };
  }

  async getServiceRecipe(ctx: InvCtx, serviceId: string): Promise<ServiceRecipe> {
    const s = await this.service(ctx, serviceId);
    const lines = await sql<any>`
      SELECT r.id, r.product_id, r.quantity, p.name AS product_name, p.color_number, p.cost_cents
      FROM service_product_recipes r JOIN inventory_products p ON p.id = r.product_id
      WHERE r.service_id = ${serviceId} AND r.tenant_id = ${ctx.tenantId} ORDER BY p.name`.execute(this.need());
    const cost = recipeCostCents(lines.rows.map((l: any) => ({ quantity: l.quantity, costCents: l.cost_cents })));
    return { service: { id: s.id, name: s.name }, lines: lines.rows, recipeCostCents: cost };
  }

  async setServiceRecipe(ctx: InvCtx, serviceId: string, b: any) {
    await this.service(ctx, serviceId);
    const reqLines: { productId: string; quantity: number }[] = Array.isArray(b?.lines) ? b.lines : [];
    const seen = new Set<string>();
    const clean: { productId: string; quantity: number }[] = [];
    for (const l of reqLines) {
      const pid = l?.productId;
      const qty = Math.max(1, Math.floor(Number(l?.quantity) || 0));
      if (!pid || seen.has(pid) || qty < 1) continue;
      const p = await sql`SELECT id FROM inventory_products WHERE id = ${pid} AND tenant_id = ${ctx.tenantId} AND archived_at IS NULL`.execute(this.need());
      if (!p.rows[0]) throw new InventoryError(400, 'A selected product no longer exists');
      seen.add(pid); clean.push({ productId: pid, quantity: qty });
    }
    await sql`DELETE FROM service_product_recipes WHERE service_id = ${serviceId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    for (const l of clean) {
      await sql`INSERT INTO service_product_recipes (tenant_id, service_id, product_id, quantity) VALUES (${ctx.tenantId}, ${serviceId}, ${l.productId}, ${l.quantity})`.execute(this.need());
    }
    await this.audit(ctx, 'service_recipe_set', null, null, { serviceId, lines: clean.length });
    return this.getServiceRecipe(ctx, serviceId);
  }

  /** Deduct a service's recipe from stock (e.g. when the service is performed). For each line, claim
   *  quantity×multiplier movable units (most-used first), mark them 'empty', and write a service_usage
   *  movement. Deducts only what's on hand (reports any shortfall) — never goes negative. */
  async consumeServiceRecipe(ctx: InvCtx, serviceId: string, multiplier = 1) {
    await this.service(ctx, serviceId);
    const mult = Math.max(1, Math.floor(multiplier || 1));
    const lines = await sql<any>`SELECT product_id, quantity FROM service_product_recipes WHERE service_id = ${serviceId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    const result: { productId: string; requested: number; deducted: number }[] = [];
    for (const l of lines.rows) {
      const want = Math.max(0, Math.floor(l.quantity) * mult);
      if (want <= 0) { result.push({ productId: l.product_id, requested: 0, deducted: 0 }); continue; }
      const before = (await this.recompute(ctx, l.product_id)).onHand;
      await sql`
        WITH picked AS (
          SELECT id FROM inventory_units
          WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${l.product_id}
            AND status IN ('unopened', 'opened', 'low')
          ORDER BY CASE status WHEN 'low' THEN 0 WHEN 'opened' THEN 1 ELSE 2 END
          LIMIT ${want} FOR UPDATE SKIP LOCKED
        )
        UPDATE inventory_units u SET status = 'empty', updated_at = now() FROM picked WHERE u.id = picked.id`.execute(this.need());
      const after = (await this.recompute(ctx, l.product_id)).onHand;
      const deducted = before - after;
      if (deducted > 0) await this.move(ctx, l.product_id, null, 'service_usage', before, -deducted, after, 'Service usage', { type: 'service', id: serviceId });
      result.push({ productId: l.product_id, requested: want, deducted });
    }
    await this.audit(ctx, 'service_recipe_consumed', null, null, { serviceId, multiplier: mult, lines: result.length });
    return { serviceId, multiplier: mult, deducted: result };
  }
}
