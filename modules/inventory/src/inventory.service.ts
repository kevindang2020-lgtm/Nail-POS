// inventory.service.ts — canonical tenant Inventory service. ALWAYS tenant+branch scoped from the session
// (never the client). Stock counts are recomputed from the authoritative bottle rows after every change
// (no blind increments → safe under concurrency). Every mutation writes an immutable movement + audit.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import type { ServiceRecipe } from '@aipowersalon/api-contracts/tenant';
import { utcDate } from '@aipowersalon/date-time';
import { sql, type Kysely } from 'kysely';
import { transitionStatus, canMoveToSql, type DB } from '@aipowersalon/database';
import { PURCHASE_ORDER, INVENTORY_COUNT, INVENTORY_TECH_REPORT, PRODUCT_USAGE_EVENT } from './inventory-lifecycles';
import { onOrderSql } from './stock-alert-state';
import {
  countsFromUnits, stockStatus, reorderSuggestion, canTransitionBottle, validateTechReport,
  poReceivingStatus, receivableQty, poTotals, canReceivePO,
  clampCount, countVariance, summarizeCount, recipeCostCents,
  type BottleStatus, type MovementType,
} from './inventory-core';
import { hasPermission } from '@aipowersalon/permissions';
import { parseQuantity, formatQuantity, allowsFraction, allocate, planRestore, restoredStatus, remainingOf, stockHundredths, HUNDREDTHS, USABLE_STATUSES, type BottleRow, type Take } from './product-usage-core';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class InventoryError extends Error { constructor(public status: number, message: string, public extra?: any) { super(message); } }
export interface InvCtx { tenantId: string; branchId: string; userId: string; role: string; permissions: string[] }
/** audit_logs.user_id / inventory_stock_movements.actor_user_id are UUIDs: a system context's 'system:<job>' (B-14, the ONE
 *  system-context shape) is kept as the job's NAME instead, never written into a UUID column (the insert would fail and
 *  the best-effort audit would be lost — the swallowed-catch pattern wave 4 found). */
const ACTOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function systemActorOf(userId: string | null | undefined): { userId: string | null; systemActor: string | null } {
  const u = String(userId ?? '').trim();
  if (!u) return { userId: null, systemActor: null };
  return ACTOR_UUID.test(u) ? { userId: u, systemActor: null } : { userId: null, systemActor: u };
}

// ---- Suppliers & Purchasing (Oct 29 2026): supplier / contact / product-link field cleaning ----
const txt = (v: unknown, max = 200): string | null => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, max) : null; };
export const digitsOfPhone = (s: string) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailOf(v: unknown): string | null {
  const e = txt(v, 254); if (e == null) return null;
  if (!EMAIL.test(e)) throw withCode(new InventoryError(400, 'Enter a valid email address.'), 'VENDOR_EMAIL_INVALID');
  return e;
}
function phoneOf(v: unknown): string | null {
  const p = txt(v, 40); if (p == null) return null;
  const d = p.replace(/\D/g, '');
  if (d.length < 7 || d.length > 15 || /[a-z]/i.test(p.replace(/\b(ext|x)\b/gi, ''))) throw withCode(new InventoryError(400, 'Enter a valid phone number.'), 'VENDOR_PHONE_INVALID');
  return p;
}
function intOf(v: unknown, min = 0, max = 100000000): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) throw withCode(new InventoryError(400, 'Enter a whole number.'), 'VALUE_NOT_WHOLE_NUMBER');
  return n;
}
export function vendorFields(b: any) {
  const has = (k: string) => b != null && Object.prototype.hasOwnProperty.call(b, k);
  return {
    name: txt(b?.name, 200), contactName: txt(b?.contactName, 200), phone: phoneOf(b?.phone), email: emailOf(b?.email), website: txt(b?.website, 500),
    accountNumber: txt(b?.accountNumber, 64), paymentTerms: txt(b?.paymentTerms, 200), leadTimeDays: intOf(b?.leadTimeDays, 0, 3650),
    tradeName: txt(b?.tradeName, 200), supplierCode: txt(b?.supplierCode, 40), street: txt(b?.street, 200), city: txt(b?.city, 120), state: txt(b?.state, 80),
    postalCode: txt(b?.postalCode, 20), country: txt(b?.country, 80), notes: txt(b?.notes, 4000), preferred: has('preferred') ? !!b.preferred : null,
    minimumOrderCents: intOf(b?.minimumOrderCents, 0), currency: has('currency') ? (txt(b?.currency, 3)?.toUpperCase() ?? 'USD') : null,
  };
}
const METHODS = ['phone', 'mobile', 'email', 'text'];
export function contactFields(b: any) {
  return { name: txt(b?.name, 200), role: txt(b?.role, 120), mobilePhone: phoneOf(b?.mobilePhone), officePhone: phoneOf(b?.officePhone), email: emailOf(b?.email),
    preferredMethod: METHODS.includes(String(b?.preferredMethod)) ? String(b.preferredMethod) : null, primary: !!b?.primary, notes: txt(b?.notes, 2000) };
}
export function linkFields(b: any) {
  return { supplierSku: txt(b?.supplierSku, 64), lastCostCents: intOf(b?.lastCostCents, 0), purchaseUnit: txt(b?.purchaseUnit, 32), unitsPerPurchaseUnit: intOf(b?.unitsPerPurchaseUnit, 1, 100000),
    minimumOrderQty: intOf(b?.minimumOrderQty, 1, 1000000), leadTimeDays: intOf(b?.leadTimeDays, 0, 3650), preferred: !!b?.preferred };
}

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

/** Structural port to the finance module (inventory does not import it): a confirmed scan → one expense. */
export interface ReceiptExpenseWriter {
  createFromScan(ctx: InvCtx, x: { vendor: string | null; amountCents: number; incurredOn: string; category: string | null; description: string | null }): Promise<{ id: string; status: string; category: string; amountCents: number; vendor: string | null; incurredOn: string; duplicate?: unknown }>;
}
export class InventoryService {
  /** the finance module's expense writer for a scanned receipt, bound by apps/api (finance-wiring.ts) — see saveReceiptExpense */
  receiptExpenses: ReceiptExpenseWriter | null = null;
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
        if (!po) throw withCode(new InventoryError(404, 'Purchase order not found'), 'PO_NOT_FOUND');
        if (po.status !== 'draft') throw withCode(new InventoryError(409, `This purchase order is not waiting for approval (it is ${po.status}).`), 'PO_NOT_PENDING');
        return { title: `Purchase order ${po.po_number}`, amountCents: Number(po.total_cents ?? 0), branchId: po.branch_id ?? null, payload: { purchaseOrderId: String(po.id), poNumber: po.po_number, totalCents: Number(po.total_cents ?? 0) } };
      },
      execute: async (actor, request) => { await this.approvePurchaseOrderDirect(invCtx(actor), String(request.subjectId)); return { purchaseOrderId: String(request.subjectId), status: 'approved' }; },
      onReject: async (actor, request, note) => { await this.cancelPurchaseOrder(invCtx(actor), String(request.subjectId), `Not approved: ${note ?? ''}`.trim()); },
    });
    return this;
  }
  private need(): Kysely<DB> { if (!this.db) throw withCode(new InventoryError(503, 'Inventory store unavailable'), 'SERVICE_UNAVAILABLE'); return this.db; }

  private async resolveBranchId(ctx: InvCtx, exec: Kysely<DB> = this.need()): Promise<string | null> {
    if (ctx.branchId && typeof ctx.branchId === 'string' && ctx.branchId.trim().length > 0) {
      return ctx.branchId;
    }
    const b = await sql<{ id: string }>`SELECT id FROM branches WHERE tenant_id = ${ctx.tenantId} ORDER BY created_at ASC LIMIT 1`.execute(exec).catch(() => ({ rows: [] }));
    return b.rows[0]?.id ?? null;
  }

  /** `exec`: the caller's transaction when it has one (the Service Done consumer) — the audit row then commits or rolls
   *  back WITH the stock change it describes, instead of landing on a separate connection while the change is still open. */
  private async audit(ctx: InvCtx, action: string, productId: string | null, unitId: string | null, meta: any, exec: Kysely<DB> | null = this.db) {
    if (!exec) return;
    try {
      // B-14 / D4: a system actor ('system:<job>', not a UUID) is kept by NAME in the metadata; user_id stays a UUID or NULL
      const actor = systemActorOf(ctx.userId);
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${actor.userId}, ${ctx.role}, ${action}, ${'inventory'}, ${unitId ?? productId}, ${JSON.stringify({ ...(meta || {}), ...(actor.systemActor ? { systemActor: actor.systemActor } : {}) })}::jsonb)`.execute(exec);
    } catch (e) {
      // inside the caller's transaction a failed insert has already aborted it: swallowing hid the failure and the next
      // statement failed with "current transaction is aborted" — rethrow so the whole change rolls back with its audit
      if (exec !== this.db) throw e;
      console.warn('[inventory] audit row not written', action, (e as Error)?.message);   // standalone write: the change itself already committed
    }
  }

  /** M4 lanes (Oct 26 2026): serialize every stock change of these products at this branch for the rest of `exec`'s
   *  transaction. Two `service.completed` consumers for different tickets of one branch now run at the same time (the
   *  publisher's lanes); without a lock taken BEFORE the "before" count, the second read a count that predated the first's
   *  commit and recorded a deduction of two for one bottle (before − after across the other's commit), and two tickets
   *  sharing products P and Q locked the stock rows in opposite order and deadlocked (40P01 — retried as transient, with
   *  the alerts / audit / outbox rows the first attempt had already committed on another connection written again).
   *  The rows are taken FOR UPDATE in product_id order (the same order for every caller, so no cycle); a product with no
   *  stock row yet gets one first (FOR UPDATE on a row that does not exist locks nothing). Outside a transaction (a plain
   *  handle) each statement commits on its own and the lock is gone at once — the same as before. */
  private async lockStock(ctx: InvCtx, productIds: readonly string[], exec: Kysely<DB>): Promise<void> {
    const ids = [...new Set(productIds.map(String))].sort();
    for (const productId of ids) {
      await sql`INSERT INTO inventory_location_stock (tenant_id, branch_id, product_id) VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId})
        ON CONFLICT (branch_id, product_id) DO NOTHING`.execute(exec);
      await sql`SELECT id FROM inventory_location_stock WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId} FOR UPDATE`.execute(exec);
    }
  }

  private async move(ctx: InvCtx, productId: string, unitId: string | null, type: MovementType, before: number, change: number, after: number, reason?: string, related?: { type: string; id: string }, exec: Kysely<DB> = this.need(), meta: Record<string, unknown> | null = null) {
    await sql`INSERT INTO inventory_stock_movements (tenant_id, branch_id, product_id, inventory_unit_id, movement_type, quantity_before, quantity_change, quantity_after, related_type, related_id, actor_user_id, reason, metadata_json)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId}, ${unitId}, ${type}, ${before}, ${change}, ${after}, ${related?.type ?? null}, ${related?.id ?? null}, ${systemActorOf(ctx.userId).userId}, ${reason ?? null}, ${meta ? JSON.stringify(meta) : null}::jsonb)`.execute(exec);
    // inventory.adjusted (declared since Constitution 8; produced by nothing until Oct 3 2026). Inventory writes are plain
    // statements, not one transaction, so this is recorded right after the movement row — a STANDARD-class event, not a
    // financial one. Quantities and ids only.
    if (this.outbox) await this.outbox.write(exec, createDomainEvent({ eventType: DOMAIN_EVENTS.INVENTORY_ADJUSTED, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined,
      aggregateType: 'inventory_product', aggregateId: productId, actorId: ctx.userId || undefined, actorType: 'user',
      payload: { productId, unitId: unitId ?? null, movementType: type, quantityBefore: before, quantityChange: change, quantityAfter: after, relatedType: related?.type ?? null, relatedId: related?.id ?? null } })).catch(() => undefined);
  }

  /** Recompute location stock for a product from its bottle rows — the single source of truth. */
  private async recompute(ctx: InvCtx, productId: string, exec: Kysely<DB> = this.need()): Promise<{ onHand: number; before: number }> {
    // a bottle past its expiration date is not stock (it is never used on a client — consumption skips it — so counting it on hand
    // hid a real shortage); it counts as expired until someone disposes of it
    const units = await sql<{ status: BottleStatus }>`SELECT CASE WHEN status IN ('unopened', 'opened', 'low') AND expiration_date IS NOT NULL
        AND expiration_date < (now() AT TIME ZONE 'UTC')::date THEN 'expired' ELSE status END AS status FROM inventory_units
      WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId}`.execute(exec);
    const prev = await sql<{ quantity_on_hand: number }>`SELECT quantity_on_hand FROM inventory_location_stock
      WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId}`.execute(exec);
    const before = prev.rows[0]?.quantity_on_hand ?? 0;
    const c = countsFromUnits(units.rows, 0);
    await sql`INSERT INTO inventory_location_stock (tenant_id, branch_id, product_id, quantity_on_hand, quantity_available, quantity_unopened, quantity_open, quantity_low, quantity_empty, quantity_damaged, updated_at)
      VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId}, ${c.onHand}, ${c.available}, ${c.unopened}, ${c.open}, ${c.low}, ${c.empty}, ${c.damaged}, now())
      ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity_on_hand = ${c.onHand}, quantity_available = ${c.available},
        quantity_unopened = ${c.unopened}, quantity_open = ${c.open}, quantity_low = ${c.low}, quantity_empty = ${c.empty},
        quantity_damaged = ${c.damaged}, updated_at = now()`.execute(exec);
    await this.checkStockAlert(ctx, productId, before, c.onHand, exec);
    return { onHand: c.onHand, before };
  }

  // ---- stock-threshold alert dispatch (§17) ----
  private stockRank(s: string): number { return s === 'out_of_stock' ? 3 : s === 'critical' ? 2 : s === 'low' ? 1 : 0; }

  /** Called from recompute on every stock change. Records an alert when a product crosses into a worse tier
   *  (deduped per product/status, superseding lower open alerts), and auto-resolves open alerts on recovery. */
  /** `exec` (M4 lanes): the stock change's own transaction, so the alert, its audit row and the inventory.low_stock event
   *  commit — or roll back — with the recompute that caused them, under the product's stock-row lock (lockStock). Before,
   *  they went through the service's own handle while the caller's transaction was still open: a transaction that was
   *  then rolled back (a deadlock retry) had already left its alert and event behind, and the retry wrote them again. */
  private async checkStockAlert(ctx: InvCtx, productId: string, before: number, after: number, exec: Kysely<DB> = this.need()) {
    const branchId = await this.resolveBranchId(ctx, exec);
    const p = (await sql<any>`
      SELECT
        COALESCE(s.reorder_level_override, p.reorder_level) AS reorder_level,
        COALESCE(s.critical_level_override, p.critical_level) AS critical_level,
        p.maximum_stock
      FROM inventory_products p
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.branch_id = ${branchId}
      WHERE p.id = ${productId} AND p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL
    `.execute(exec)).rows[0];
    if (!p) return;
    
    const sAfter = stockStatus(after, p.reorder_level ?? 0, p.maximum_stock, p.critical_level);
    const rAfter = this.stockRank(sAfter);

    if (rAfter === 0) {
      // recovered to a healthy level — resolve any open alerts for this product
      await sql`UPDATE inventory_alerts SET resolved_at = now() WHERE product_id = ${productId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND tenant_id = ${ctx.tenantId} AND resolved_at IS NULL`.execute(exec);
      return;
    }

    const currentAlert = (await sql<{ id: string, status: string }>`SELECT id, status FROM inventory_alerts WHERE product_id = ${productId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND tenant_id = ${ctx.tenantId} AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1`.execute(exec)).rows[0];
    
    if (currentAlert && currentAlert.status === sAfter) return; // already alerting at exactly this status
    if (currentAlert && this.stockRank(currentAlert.status) >= rAfter) return; // already alerting at a worse or equal status

    if (!branchId) return;

    // supersede any lower open alerts for this product, then record the new one
    await sql`UPDATE inventory_alerts SET resolved_at = now() WHERE product_id = ${productId} AND branch_id = ${branchId} AND tenant_id = ${ctx.tenantId} AND resolved_at IS NULL`.execute(exec);
    await sql`INSERT INTO inventory_alerts (tenant_id, branch_id, product_id, status, on_hand) VALUES (${ctx.tenantId}, ${branchId}, ${productId}, ${sAfter}, ${after})`.execute(exec);
    await this.audit(ctx, 'inventory_stock_alert', productId, null, { status: sAfter, onHand: after }, exec);
    // inventory.low_stock — the product crossed INTO a worse tier (low / critical / out_of_stock); a tier it already alerts
    // at emits nothing (the early returns above).
    if (this.outbox) await this.outbox.write(exec, createDomainEvent({ eventType: DOMAIN_EVENTS.INVENTORY_LOW_STOCK, tenantId: ctx.tenantId, branchId: branchId || undefined,
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
    if (!ex) throw withCode(new InventoryError(404, 'Alert not found'), 'ALERT_NOT_FOUND');
    await sql`UPDATE inventory_alerts SET acknowledged_at = now(), acknowledged_by_user_id = ${ctx.userId} WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_alert_acknowledged', null, null, { id });
    return { ok: true };
  }

  // ---- OCR receipt → expense (ai_ocr_receipt_scanner) ----
  /** Save a reviewed/confirmed scanned receipt as an expense. The scan + extraction is gated AI; this persists the
   *  manager-confirmed result. Tenant + branch + user scoped. Inventory-linking of line items is intentionally separate. */
  async saveReceiptExpense(ctx: InvCtx, body: { vendor?: string | null; amountCents?: number; incurredOn?: string | null; category?: string | null; description?: string | null }) {
    const amount = Math.max(0, Math.round(Number(body?.amountCents) || 0));
    if (!amount) throw withCode(new InventoryError(400, 'Expense amount is required'), 'AMOUNT_INVALID');
    // Oct 21 2026 (Receipt / Expense / OCR / Accounting mandate §9): the expense goes through THE expense authority (the
    // finance module, bound by apps/api) — category engine, duplicate check, approval, history, events. The front desk's
    // scanned receipt waits for an owner / manager's approval unless the person may approve. The raw insert below stays
    // only for a server without the finance module.
    if (this.receiptExpenses) {
      const incurredOn0 = body?.incurredOn && /^\d{4}-\d{2}-\d{2}$/.test(body.incurredOn) ? body.incurredOn : utcDate();
      try {
        const r = await this.receiptExpenses.createFromScan(ctx, { vendor: body?.vendor ? String(body.vendor).slice(0, 200) : null, amountCents: amount, incurredOn: incurredOn0, category: body?.category ?? null, description: body?.description ? String(body.description).slice(0, 1000) : null });
        await this.audit(ctx, 'inventory_receipt_expense_created', r.id, null, { amountCents: amount, vendor: body?.vendor ?? null, status: r.status });
        return { ok: true, expense: { id: r.id, category: r.category, amount_cents: r.amountCents, vendor: r.vendor, incurred_on: r.incurredOn, status: r.status }, duplicate: r.duplicate ?? null };
      } catch (e) {
        const x = e as { status?: number; message?: string; extra?: Record<string, unknown> };
        if (typeof x?.status === 'number') throw new InventoryError(x.status === 409 ? 409 : x.status === 403 ? 403 : 400, x.message || 'Could not save the expense.');
        throw e;
      }
    }
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
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    return r.rows[0];
  }
  private async unit(ctx: InvCtx, id: string) {
    const r = await sql<any>`SELECT * FROM inventory_units WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Bottle not found'), 'BOTTLE_NOT_FOUND');
    return r.rows[0];
  }

  // ---- categories / brands / vendors ----
  async listCategories(ctx: InvCtx) { return { categories: (await sql<any>`SELECT * FROM inventory_categories WHERE tenant_id = ${ctx.tenantId} AND active = true ORDER BY sort_order, name`.execute(this.need())).rows }; }
  async createCategory(ctx: InvCtx, b: any) {
    if (!b?.name?.trim()) throw withCode(new InventoryError(400, 'Category name required'), 'CATEGORY_NAME_REQUIRED');
    const r = await sql<{ id: string }>`INSERT INTO inventory_categories (tenant_id, parent_category_id, name, code, description, display_color, tracking_mode)
      VALUES (${ctx.tenantId}, ${b.parentCategoryId ?? null}, ${b.name.trim()}, ${b.code ?? null}, ${b.description ?? null}, ${b.displayColor ?? null}, ${b.trackingMode === 'bottle' ? 'bottle' : 'quantity'}) RETURNING id`.execute(this.need());
    await this.audit(ctx, 'inventory_category_created', null, null, { id: r.rows[0].id, name: b.name });
    return { id: r.rows[0].id };
  }
  async listBrands(ctx: InvCtx) { return { brands: (await sql<any>`SELECT * FROM inventory_brands WHERE tenant_id = ${ctx.tenantId} AND active = true ORDER BY name`.execute(this.need())).rows }; }
  async createBrand(ctx: InvCtx, b: any) {
    if (!b?.name?.trim()) throw withCode(new InventoryError(400, 'Brand name required'), 'BRAND_NAME_REQUIRED');
    const r = await sql<{ id: string }>`INSERT INTO inventory_brands (tenant_id, name, code, website, notes) VALUES (${ctx.tenantId}, ${b.name.trim()}, ${b.code ?? null}, ${b.website ?? null}, ${b.notes ?? null}) RETURNING id`.execute(this.need());
    await this.audit(ctx, 'inventory_brand_created', null, null, { id: r.rows[0].id, name: b.name });
    return { id: r.rows[0].id };
  }
  /** Phase 12 #19: the vendor fields the POS screens read (InvVendor) + timestamps — not tenant_id / active / actor stamps.
   *  account_number is the SALON's customer number at the supplier (shown and edited on the vendor form), not a bank account. */
  async listVendors(ctx: InvCtx) { return { vendors: (await sql<any>`SELECT id, name, contact_name, phone, email, website, account_number, payment_terms, lead_time_days, created_at, updated_at FROM inventory_vendors WHERE tenant_id = ${ctx.tenantId} AND active = true ORDER BY name`.execute(this.need())).rows }; }
  /** Suppliers & Purchasing mandate (Oct 29 2026): the full supplier profile. A name, phone or email that another supplier
   *  already has is a WARNING (409 SUPPLIER_DUPLICATE with the matches), saved only with `confirmDuplicate: true` — two
   *  suppliers are never merged silently. Email / phone are validated; the phone is stored as typed (search is on digits). */
  async createVendor(ctx: InvCtx, b: any) {
    const f = vendorFields(b);
    if (!f.name) throw withCode(new InventoryError(400, 'Vendor name required'), 'VENDOR_NAME_REQUIRED');
    await this.vendorDuplicates(ctx, f, null, b?.confirmDuplicate === true);
    const r = await sql<{ id: string }>`INSERT INTO inventory_vendors (tenant_id, name, contact_name, phone, email, website, account_number, payment_terms, lead_time_days,
        trade_name, supplier_code, street, city, state, postal_code, country, notes, is_preferred, minimum_order_cents, currency, updated_by)
      VALUES (${ctx.tenantId}, ${f.name}, ${f.contactName}, ${f.phone}, ${f.email}, ${f.website}, ${f.accountNumber}, ${f.paymentTerms}, ${f.leadTimeDays},
        ${f.tradeName}, ${f.supplierCode}, ${f.street}, ${f.city}, ${f.state}, ${f.postalCode}, ${f.country}, ${f.notes}, ${f.preferred ?? false}, ${f.minimumOrderCents}, ${f.currency ?? 'USD'}, ${systemActorOf(ctx.userId).userId})
      RETURNING id`.execute(this.need()).catch((e: any) => { throw this.vendorWriteError(e); });
    await this.audit(ctx, 'inventory_vendor_created', null, null, { id: r.rows[0].id, name: f.name });
    return { id: r.rows[0].id };
  }
  private vendorWriteError(e: any) {
    if (String(e?.code) === '23505' && /uq_inventory_vendors_code/.test(String(e?.constraint ?? e?.message ?? ''))) return withCode(new InventoryError(409, 'Another supplier already uses that supplier code.'), 'SUPPLIER_CODE_TAKEN');
    return e;
  }
  private async vendorDuplicates(ctx: InvCtx, f: ReturnType<typeof vendorFields>, exceptId: string | null, confirmed: boolean) {
    if (confirmed) return;
    const d = digitsOfPhone(f.phone ?? ''); const name = (f.name ?? '').toLowerCase(); const email = (f.email ?? '').toLowerCase();
    const dup = (await sql<{ id: string; name: string; active: boolean }>`SELECT v.id, v.name, v.active FROM inventory_vendors v
      WHERE v.tenant_id = ${ctx.tenantId} AND (${exceptId}::uuid IS NULL OR v.id <> ${exceptId})
        AND ((${name} <> '' AND lower(trim(v.name)) = ${name}) OR (${d.length >= 7} AND regexp_replace(coalesce(v.phone, ''), '\\D', '', 'g') IN (${d}, ${'1' + d}))
          OR (${email} <> '' AND lower(coalesce(v.email, '')) = ${email}))
      ORDER BY v.active DESC, v.name LIMIT 5`.execute(this.need())).rows;
    if (dup.length) throw withCode(new InventoryError(409, 'A supplier with the same name, phone or email already exists.', { duplicates: dup.map((x) => ({ id: String(x.id), name: x.name, active: !!x.active })) }), 'SUPPLIER_DUPLICATE');
  }

  // ---- catalog editors (§ manager catalog): update + archive for categories / brands / vendors ----
  async updateCategory(ctx: InvCtx, id: string, b: any) {
    if (!b?.name?.trim()) throw withCode(new InventoryError(400, 'Category name required'), 'CATEGORY_NAME_REQUIRED');
    const ex = await sql`SELECT id FROM inventory_categories WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw withCode(new InventoryError(404, 'Category not found'), 'CATEGORY_NOT_FOUND');
    await sql`UPDATE inventory_categories SET name = ${b.name.trim()}, code = ${b.code ?? null}, description = ${b.description ?? null},
      display_color = ${b.displayColor ?? null}, sort_order = ${Number.isFinite(+b.sortOrder) ? +b.sortOrder : 0},
      tracking_mode = ${b.trackingMode === 'bottle' ? 'bottle' : 'quantity'}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_category_updated', null, null, { id, name: b.name });
    return { id };
  }
  async archiveCategory(ctx: InvCtx, id: string) {
    const ex = await sql`SELECT id FROM inventory_categories WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw withCode(new InventoryError(404, 'Category not found'), 'CATEGORY_NOT_FOUND');
    const used = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_products WHERE category_id = ${id} AND tenant_id = ${ctx.tenantId} AND archived_at IS NULL`.execute(this.need());
    await sql`UPDATE inventory_categories SET active = false, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_category_archived', null, null, { id, productsAffected: used.rows[0].n });
    return { ok: true, productsAffected: used.rows[0].n };
  }

  async updateBrand(ctx: InvCtx, id: string, b: any) {
    if (!b?.name?.trim()) throw withCode(new InventoryError(400, 'Brand name required'), 'BRAND_NAME_REQUIRED');
    const ex = await sql`SELECT id FROM inventory_brands WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw withCode(new InventoryError(404, 'Brand not found'), 'BRAND_NOT_FOUND');
    await sql`UPDATE inventory_brands SET name = ${b.name.trim()}, code = ${b.code ?? null}, website = ${b.website ?? null}, notes = ${b.notes ?? null}, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_brand_updated', null, null, { id, name: b.name });
    return { id };
  }
  async archiveBrand(ctx: InvCtx, id: string) {
    const ex = await sql`SELECT id FROM inventory_brands WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw withCode(new InventoryError(404, 'Brand not found'), 'BRAND_NOT_FOUND');
    const used = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_products WHERE brand_id = ${id} AND tenant_id = ${ctx.tenantId} AND archived_at IS NULL`.execute(this.need());
    await sql`UPDATE inventory_brands SET active = false, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_brand_archived', null, null, { id, productsAffected: used.rows[0].n });
    return { ok: true, productsAffected: used.rows[0].n };
  }

  /** Edit a supplier (active or inactive — an inactive supplier's profile can still be corrected). Fields not sent stay
   *  as they are; the change is audited with the fields' before / after. */
  async updateVendor(ctx: InvCtx, id: string, b: any) {
    if (!ACTOR_UUID.test(String(id))) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    const cur = (await sql<any>`SELECT id, name, contact_name, phone, email, website, account_number, payment_terms, lead_time_days, active, created_at, updated_at, trade_name, supplier_code, street, city, state, postal_code, country, notes, is_preferred, minimum_order_cents, currency, deactivated_at FROM inventory_vendors WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need())).rows[0];
    if (!cur) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    const f = vendorFields(b);
    if ('name' in (b || {}) && !f.name) throw withCode(new InventoryError(400, 'Vendor name required'), 'VENDOR_NAME_REQUIRED');
    const next = (k: keyof ReturnType<typeof vendorFields>, col: string) => (k in (b || {}) || (k === 'leadTimeDays' && 'leadTimeDays' in (b || {})) ? (f as Record<string, unknown>)[k] : cur[col]);
    const row = {
      name: next('name', 'name'), contact_name: next('contactName', 'contact_name'), phone: next('phone', 'phone'), email: next('email', 'email'), website: next('website', 'website'),
      account_number: next('accountNumber', 'account_number'), payment_terms: next('paymentTerms', 'payment_terms'), lead_time_days: next('leadTimeDays', 'lead_time_days'),
      trade_name: next('tradeName', 'trade_name'), supplier_code: next('supplierCode', 'supplier_code'), street: next('street', 'street'), city: next('city', 'city'), state: next('state', 'state'),
      postal_code: next('postalCode', 'postal_code'), country: next('country', 'country'), notes: next('notes', 'notes'),
      is_preferred: 'preferred' in (b || {}) ? !!f.preferred : !!cur.is_preferred, minimum_order_cents: next('minimumOrderCents', 'minimum_order_cents'), currency: next('currency', 'currency') ?? 'USD',
    };
    // only a CHANGED name / phone / email is checked against the other suppliers (an accepted duplicate is not re-warned)
    if (row.name !== cur.name || row.phone !== cur.phone || row.email !== cur.email) await this.vendorDuplicates(ctx, { ...f, name: row.name !== cur.name ? row.name : null, phone: row.phone !== cur.phone ? row.phone : null, email: row.email !== cur.email ? row.email : null }, id, b?.confirmDuplicate === true);
    await sql`UPDATE inventory_vendors SET name = ${row.name}, contact_name = ${row.contact_name}, phone = ${row.phone}, email = ${row.email}, website = ${row.website},
        account_number = ${row.account_number}, payment_terms = ${row.payment_terms}, lead_time_days = ${row.lead_time_days}, trade_name = ${row.trade_name}, supplier_code = ${row.supplier_code},
        street = ${row.street}, city = ${row.city}, state = ${row.state}, postal_code = ${row.postal_code}, country = ${row.country}, notes = ${row.notes}, is_preferred = ${row.is_preferred},
        minimum_order_cents = ${row.minimum_order_cents}, currency = ${row.currency}, updated_at = now(), updated_by = ${systemActorOf(ctx.userId).userId}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need()).catch((e: any) => { throw this.vendorWriteError(e); });
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(row)) if (String(cur[k] ?? '') !== String(v ?? '')) changed[k] = { from: k === 'account_number' ? (cur[k] ? '••••' : null) : cur[k] ?? null, to: k === 'account_number' ? (v ? '••••' : null) : v ?? null };
    await this.audit(ctx, 'inventory_vendor_updated', null, null, { id, name: row.name, changed });
    return { id };
  }
  /** Deactivate a supplier: hidden from the active directory and new orders, every purchase order / contact / product link
   *  kept (an order of an inactive supplier still shows its name, marked inactive). */
  async archiveVendor(ctx: InvCtx, id: string) {
    const ex = await sql`SELECT id FROM inventory_vendors WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = true`.execute(this.need());
    if (!ex.rows[0]) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    await sql`UPDATE inventory_vendors SET active = false, deactivated_at = now(), updated_at = now(), updated_by = ${systemActorOf(ctx.userId).userId} WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_vendor_archived', null, null, { id });
    return { ok: true };
  }
  async restoreVendor(ctx: InvCtx, id: string) {
    if (!ACTOR_UUID.test(String(id))) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    const r = await sql<{ id: string }>`UPDATE inventory_vendors SET active = true, deactivated_at = NULL, updated_at = now(), updated_by = ${systemActorOf(ctx.userId).userId}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND active = false RETURNING id`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    await this.audit(ctx, 'inventory_vendor_restored', null, null, { id });
    return { ok: true };
  }

  // ---- supplier contacts (many per supplier; deactivated, never deleted) ----
  private async vendorExists(ctx: InvCtx, id: string) {
    if (!ACTOR_UUID.test(String(id))) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    const r = (await sql<{ id: string; name: string }>`SELECT id, name FROM inventory_vendors WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(this.need())).rows[0];
    if (!r) throw withCode(new InventoryError(404, 'Vendor not found'), 'VENDOR_NOT_FOUND');
    return r;
  }
  async saveVendorContact(ctx: InvCtx, vendorId: string, contactId: string | null, b: any) {
    await this.vendorExists(ctx, vendorId);
    const c = contactFields(b);
    if (!c.name) throw withCode(new InventoryError(400, 'Contact name required'), 'CONTACT_NAME_REQUIRED');
    return this.need().transaction().execute(async (trx) => {
      if (c.primary) await sql`UPDATE inventory_vendor_contacts SET is_primary = false, updated_at = now() WHERE tenant_id = ${ctx.tenantId} AND vendor_id = ${vendorId} AND is_primary AND (${contactId}::uuid IS NULL OR id <> ${contactId})`.execute(trx);
      let id = contactId;
      if (contactId) {
        if (!ACTOR_UUID.test(contactId)) throw withCode(new InventoryError(404, 'Contact not found'), 'CONTACT_NOT_FOUND');
        const r = await sql<{ id: string }>`UPDATE inventory_vendor_contacts SET name = ${c.name}, role = ${c.role}, mobile_phone = ${c.mobilePhone}, office_phone = ${c.officePhone}, email = ${c.email},
            preferred_method = ${c.preferredMethod}, is_primary = ${c.primary}, notes = ${c.notes}, updated_at = now(), updated_by = ${systemActorOf(ctx.userId).userId}
          WHERE id = ${contactId} AND tenant_id = ${ctx.tenantId} AND vendor_id = ${vendorId} AND active RETURNING id`.execute(trx);
        if (!r.rows[0]) throw withCode(new InventoryError(404, 'Contact not found'), 'CONTACT_NOT_FOUND');
      } else {
        id = (await sql<{ id: string }>`INSERT INTO inventory_vendor_contacts (tenant_id, vendor_id, name, role, mobile_phone, office_phone, email, preferred_method, is_primary, notes, created_by_user_id)
          VALUES (${ctx.tenantId}, ${vendorId}, ${c.name}, ${c.role}, ${c.mobilePhone}, ${c.officePhone}, ${c.email}, ${c.preferredMethod}, ${c.primary}, ${c.notes}, ${systemActorOf(ctx.userId).userId}) RETURNING id`.execute(trx)).rows[0].id;
      }
      await this.audit(ctx, contactId ? 'inventory_vendor_contact_updated' : 'inventory_vendor_contact_added', null, null, { id: vendorId, vendorId, contactId: id, name: c.name, primary: c.primary }, trx);
      return { id };
    });
  }
  async deactivateVendorContact(ctx: InvCtx, vendorId: string, contactId: string) {
    await this.vendorExists(ctx, vendorId);
    if (!ACTOR_UUID.test(String(contactId))) throw withCode(new InventoryError(404, 'Contact not found'), 'CONTACT_NOT_FOUND');
    const r = await sql<{ id: string }>`UPDATE inventory_vendor_contacts SET active = false, is_primary = false, updated_at = now(), updated_by = ${systemActorOf(ctx.userId).userId}
      WHERE id = ${contactId} AND tenant_id = ${ctx.tenantId} AND vendor_id = ${vendorId} AND active RETURNING id`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Contact not found'), 'CONTACT_NOT_FOUND');
    await this.audit(ctx, 'inventory_vendor_contact_deactivated', null, null, { id: vendorId, vendorId, contactId });
    return { ok: true };
  }

  // ---- supplier ↔ product links (catalog data, never stock) ----
  async linkVendorProduct(ctx: InvCtx, vendorId: string, b: any) {
    await this.vendorExists(ctx, vendorId);
    const productId = String(b?.productId ?? '');
    if (!ACTOR_UUID.test(productId)) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    await this.product(ctx, productId);
    const l = linkFields(b);
    const before = (await sql<any>`SELECT supplier_sku, last_cost_cents, purchase_unit, units_per_purchase_unit, minimum_order_qty, lead_time_days, is_preferred, active FROM inventory_vendor_products
      WHERE tenant_id = ${ctx.tenantId} AND vendor_id = ${vendorId} AND product_id = ${productId}`.execute(this.need())).rows[0] ?? null;
    const r = await sql<{ id: string }>`INSERT INTO inventory_vendor_products (tenant_id, vendor_id, product_id, supplier_sku, last_cost_cents, purchase_unit, units_per_purchase_unit, minimum_order_qty, lead_time_days, is_preferred, created_by_user_id)
      VALUES (${ctx.tenantId}, ${vendorId}, ${productId}, ${l.supplierSku}, ${l.lastCostCents}, ${l.purchaseUnit}, ${l.unitsPerPurchaseUnit ?? 1}, ${l.minimumOrderQty}, ${l.leadTimeDays}, ${l.preferred}, ${systemActorOf(ctx.userId).userId})
      ON CONFLICT (tenant_id, vendor_id, product_id) DO UPDATE SET supplier_sku = EXCLUDED.supplier_sku, last_cost_cents = EXCLUDED.last_cost_cents, purchase_unit = EXCLUDED.purchase_unit,
        units_per_purchase_unit = EXCLUDED.units_per_purchase_unit, minimum_order_qty = EXCLUDED.minimum_order_qty, lead_time_days = EXCLUDED.lead_time_days, is_preferred = EXCLUDED.is_preferred,
        active = true, updated_at = now(), updated_by = ${systemActorOf(ctx.userId).userId}
      RETURNING id`.execute(this.need());
    await this.audit(ctx, before ? 'inventory_vendor_product_updated' : 'inventory_vendor_product_linked', productId, null, { id: vendorId, vendorId, productId, before, after: l });
    return { id: r.rows[0].id };
  }
  async unlinkVendorProduct(ctx: InvCtx, vendorId: string, productId: string) {
    await this.vendorExists(ctx, vendorId);
    if (!ACTOR_UUID.test(String(productId))) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const r = await sql<{ id: string }>`UPDATE inventory_vendor_products SET active = false, is_preferred = false, updated_at = now(), updated_by = ${systemActorOf(ctx.userId).userId}
      WHERE tenant_id = ${ctx.tenantId} AND vendor_id = ${vendorId} AND product_id = ${productId} AND active RETURNING id`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'That product is not linked to this supplier.'), 'VENDOR_PRODUCT_NOT_LINKED');
    await this.audit(ctx, 'inventory_vendor_product_unlinked', productId, null, { id: vendorId, vendorId, productId });
    return { ok: true };
  }

  /** Link a purchase order that has no supplier (or a legacy one) to a supplier record — explicit, audited, the order's
   *  amounts and lines untouched. Not allowed on a cancelled order. */
  async linkPurchaseOrderVendor(ctx: InvCtx, poId: string, vendorId: string) {
    const po = await this.po(ctx, poId);
    if (po.status === 'cancelled') throw withCode(new InventoryError(409, 'A cancelled purchase order cannot be linked to a supplier.'), 'PO_STATE_INVALID');
    const v = await this.vendorExists(ctx, vendorId);
    await sql`UPDATE purchase_orders SET vendor_id = ${vendorId}, updated_at = now(), updated_by = ${systemActorOf(ctx.userId).userId} WHERE id = ${poId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    await this.audit(ctx, 'inventory_po_vendor_linked', null, null, { id: poId, vendorId, vendor: v.name, previousVendorId: po.vendor_id ?? null });
    return { ok: true };
  }

  // ---- products ----
  async listProducts(ctx: InvCtx, q: any) {
    const branchId = await this.resolveBranchId(ctx);
    const search = (q?.search || '').trim().toLowerCase();
    const rows = await sql<any>`
      SELECT p.*, s.quantity_on_hand, s.quantity_unopened, s.quantity_open, s.quantity_empty, s.quantity_damaged, s.quantity_reserved,
        s.reorder_level_override, s.reorder_quantity_override, s.critical_level_override, s.lead_time_days_override, s.preferred_vendor_id_override,
        b.name AS brand_name, c.name AS category_name, ${onOrderSql(ctx.tenantId, branchId, sql`p.id`)} AS on_order
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
      const onOrder = Number(p.on_order ?? 0);
      return { ...p, onHand, onOrder, status: stockStatus(onHand, reorderLvl, p.maximum_stock, critLvl), reorderSuggestion: reorderSuggestion(onHand, reorderLvl, reorderQty, onOrder) };
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
    const loc = branchId ? (await sql<{ version: number; reorder_level_override: number | null; critical_level_override: number | null }>`SELECT version, reorder_level_override, critical_level_override FROM inventory_location_stock WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${branchId} AND product_id = ${id}`.execute(this.need())).rows[0] : undefined;
    const stockVersion = branchId ? loc?.version ?? 0 : null;
    // the status uses this location's thresholds when it overrides them (the list did; this detail used the product defaults)
    const reorderLvl = loc?.reorder_level_override ?? p.reorder_level ?? 0, critLvl = loc?.critical_level_override ?? p.critical_level ?? null;
    return { product: { ...p, ...counts, stockVersion: stockVersion === null ? null : Number(stockVersion), status: stockStatus(counts.onHand, reorderLvl, p.maximum_stock, critLvl) }, units: units.rows };
  }

  async createProduct(ctx: InvCtx, b: any) {
    if (!b?.name?.trim()) throw withCode(new InventoryError(400, 'Product name required'), 'PRODUCT_NAME_REQUIRED');
    await this.uniqueCodes(ctx, null, b?.sku, b?.barcode);
    const categoryId = b.categoryId && String(b.categoryId).trim().length > 0 ? b.categoryId : null;
    const brandId = b.brandId && String(b.brandId).trim().length > 0 ? b.brandId : null;
    const preferredVendorId = b.preferredVendorId && String(b.preferredVendorId).trim().length > 0 ? b.preferredVendorId : null;
    const r = await sql<{ id: string }>`INSERT INTO inventory_products
      (tenant_id, category_id, brand_id, preferred_vendor_id, name, product_line, color_name, color_number, color_family, finish, sku, barcode, upc, unit_type, size_value, size_unit, tracking_mode, cost_cents, retail_price_cents, reorder_level, reorder_quantity, maximum_stock, track_expiration, is_retail, is_service)
      VALUES (${ctx.tenantId}, ${categoryId}, ${brandId}, ${preferredVendorId}, ${b.name.trim()}, ${b.productLine ?? null}, ${b.colorName ?? null}, ${b.colorNumber ?? null}, ${b.colorFamily ?? null}, ${b.finish ?? null}, ${b.sku ?? null}, ${b.barcode ?? null}, ${b.upc ?? null}, ${b.unitType ?? 'bottle'}, ${b.sizeValue ?? null}, ${b.sizeUnit ?? null}, ${b.trackingMode === 'bottle' ? 'bottle' : 'quantity'}, ${b.costCents ?? null}, ${b.retailPriceCents ?? null}, ${b.reorderLevel ?? 0}, ${b.reorderQuantity ?? 0}, ${b.maximumStock ?? null}, ${!!b.trackExpiration}, ${!!b.isRetail}, ${b.isService !== false}) RETURNING id`.execute(this.need());
    await this.audit(ctx, 'inventory_product_created', r.rows[0].id, null, { name: b.name });
    return { id: r.rows[0].id };
  }

  /** Products mandate (Oct 29 2026): a SKU or barcode belongs to ONE live product in the salon (case-insensitive SKU) —
   *  a duplicate is refused instead of silently creating two records for one item. Archived products don't block. */
  private async uniqueCodes(ctx: InvCtx, exceptId: string | null, sku: unknown, barcode: unknown) {
    const sk = typeof sku === 'string' ? sku.trim().toLowerCase() : ''; const bc = typeof barcode === 'string' ? barcode.trim() : '';
    if (!sk && !bc) return;
    const r = (await sql<{ sku_hit: boolean; bc_hit: boolean }>`SELECT bool_or(${sk} <> '' AND lower(trim(coalesce(p.sku, ''))) = ${sk}) AS sku_hit, bool_or(${bc} <> '' AND trim(coalesce(p.barcode, '')) = ${bc}) AS bc_hit
      FROM inventory_products p WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL AND (${exceptId}::uuid IS NULL OR p.id <> ${exceptId})`.execute(this.need())).rows[0];
    if (r?.sku_hit) throw withCode(new InventoryError(409, 'Another product already uses that SKU.'), 'PRODUCT_SKU_TAKEN');
    if (r?.bc_hit) throw withCode(new InventoryError(409, 'Another product already uses that barcode.'), 'PRODUCT_BARCODE_TAKEN');
  }

  async updateProduct(ctx: InvCtx, id: string, b: any) {
    await this.product(ctx, id);
    if ((b && ('sku' in b || 'barcode' in b))) await this.uniqueCodes(ctx, id, b.sku, b.barcode);
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
    if (!branchId) throw withCode(new InventoryError(400, 'Branch is required to set overrides'), 'BRANCH_REQUIRED');
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
  /** Products mandate (Oct 29 2026): bring an archived product back — its bottles, movements and history never left. */
  async restoreProduct(ctx: InvCtx, id: string) {
    if (!ACTOR_UUID.test(String(id))) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const r = await sql<{ id: string }>`UPDATE inventory_products SET archived_at = NULL, active = true, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND archived_at IS NOT NULL RETURNING id`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    await this.audit(ctx, 'inventory_product_restored', id, null, {});
    return { ok: true };
  }
  /** Inventory mandate (Oct 29 2026): rebuild this location's cached stock row from the bottle rows (the source of truth)
   *  when the two disagree — under the stock-row lock, with one 'correction' movement for the difference and an audit. */
  async recountProduct(ctx: InvCtx, productId: string) {
    if (!ctx.branchId || !ACTOR_UUID.test(ctx.branchId)) throw withCode(new InventoryError(400, 'Choose a location first.'), 'LOCATION_REQUIRED');
    await this.product(ctx, productId);
    return this.need().transaction().execute(async (trx) => {
      await this.lockStock(ctx, [productId], trx);
      const { onHand, before } = await this.recompute(ctx, productId, trx);
      if (onHand !== before) await this.move(ctx, productId, null, 'correction', before, onHand - before, onHand, 'Recount from bottle records', undefined, trx);
      await this.audit(ctx, 'inventory_stock_recounted', productId, null, { before, after: onHand }, trx);
      return { ok: true, before, after: onHand, changed: onHand !== before };
    });
  }

  // ---- add stock (creates bottle rows + movement + recompute) ----
  /** One transaction: the bottles, the cost, the movement and the audit row land together or not at all (a failure part-way
   *  used to leave bottles without their movement). A purchase-order receipt comes only from receivePurchaseOrder (`fromPo`):
   *  a caller naming a purchaseOrderId here used to label a manual add "purchase received" against any id, unchecked. */
  async addStock(ctx: InvCtx, productId: string, b: any, opts: { fromPo?: boolean; exec?: Kysely<DB> } = {}) {
    await this.product(ctx, productId);
    const qty = Math.max(0, parseInt(b?.quantity, 10) || 0);
    if (qty <= 0) throw withCode(new InventoryError(400, 'Quantity must be at least 1'), 'QUANTITY_AT_LEAST_1');
    if (qty > 1000) throw withCode(new InventoryError(400, 'Quantity too large for a single receipt'), 'QUANTITY_TOO_LARGE');
    if (b?.purchaseOrderId && !opts.fromPo) throw withCode(new InventoryError(400, 'Receive purchase-order stock from the purchase order.'), 'PO_RECEIVE_FROM_PO');
    const work = async (exec: Kysely<DB>) => {
      await this.lockStock(ctx, [productId], exec);
      const before = (await this.recompute(ctx, productId, exec)).onHand;
      for (let i = 0; i < qty; i++) {
        await sql`INSERT INTO inventory_units (tenant_id, branch_id, product_id, lot_number, expiration_date, storage_location, status)
          VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId}, ${b?.lotNumber ?? null}, ${b?.expirationDate ?? null}, ${b?.storageLocation ?? null}, ${'unopened'})`.execute(exec);
      }
      if (b?.costCents != null) await sql`UPDATE inventory_products SET cost_cents = ${b.costCents}, updated_at = now() WHERE id = ${productId} AND tenant_id = ${ctx.tenantId}`.execute(exec);
      const after = (await this.recompute(ctx, productId, exec)).onHand;
      await this.move(ctx, productId, null, b?.purchaseOrderId ? 'purchase_received' : 'manual_add', before, after - before, after, b?.note, b?.purchaseOrderId ? { type: 'purchase_order', id: b.purchaseOrderId } : undefined, exec);
      await this.audit(ctx, 'inventory_stock_added', productId, null, { quantity: qty, lot: b?.lotNumber ?? null }, exec);
    };
    if (opts.exec) await work(opts.exec); else await this.need().transaction().execute((trx) => work(trx as unknown as Kysely<DB>));
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
  async recordRetailSale(ctx: InvCtx, productId: string, quantity: number, ticketId?: string, lineId?: string): Promise<{ consumed: number; shortBy: number; onHand: number }> {
    const qty = Math.max(0, Math.trunc(quantity));
    if (qty <= 0) return { consumed: 0, shortBy: 0, onHand: 0 };
    // B-17 (Oct 20 2026): one transaction; the units are picked FOR UPDATE SKIP LOCKED (two counters selling the last
    // bottle at once take different rows or one of them comes up short — never the same unit twice) and stamped with
    // the ticket and line that sold them, so reverseRetailSale() can put exactly these back.
    const uid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
    return this.need().transaction().execute(async (trx) => {
      const before = (await this.recompute(ctx, productId, trx)).onHand;
      // Oldest sealed units first (FIFO) — the same order a person would take them off the shelf.
      const picked = await sql<{ id: string }>`SELECT id FROM inventory_units
        WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId} AND status = 'unopened'
        ORDER BY created_at ASC LIMIT ${qty} FOR UPDATE SKIP LOCKED`.execute(trx);
      const ids = picked.rows.map((r) => r.id);
      if (ids.length) await sql`UPDATE inventory_units SET status = 'sold', sold_ticket_id = ${uid(ticketId)}, sold_line_id = ${uid(lineId)}, updated_at = now()
        WHERE tenant_id = ${ctx.tenantId} AND id = ANY(${ids}::uuid[])`.execute(trx);
      const after = (await this.recompute(ctx, productId, trx)).onHand;
      await this.move(ctx, productId, null, 'retail_sale', before, after - before, after,
        ids.length < qty ? `sold ${qty}, only ${ids.length} in stock` : undefined,
        ticketId ? { type: 'ticket', id: ticketId } : undefined, trx);
      await this.audit(ctx, 'inventory_retail_sold', productId, null, { quantity: qty, consumed: ids.length, shortBy: qty - ids.length, ticketId: ticketId ?? null, lineId: lineId ?? null });
      return { consumed: ids.length, shortBy: qty - ids.length, onHand: after };
    });
  }

  /** B-17: a removed retail line, a void or a refund puts the units that sale took back on the shelf — exactly those
   *  units (stamped by recordRetailSale), sold → unopened, one customer_return movement per product against the ticket.
   *  `lineIds` null = the whole ticket. Idempotent: a unit already returned is not sold any more and is not found. */
  async reverseRetailSale(ctx: InvCtx, input: { ticketId: string; lineIds: string[] | null; reason: string }): Promise<{ returned: number; byProduct: Array<{ productId: string; returned: number; onHand: number }> }> {
    if (!/^[0-9a-f-]{36}$/i.test(input.ticketId)) return { returned: 0, byProduct: [] };
    const lines = (input.lineIds ?? []).filter((l) => /^[0-9a-f-]{36}$/i.test(l));
    if (input.lineIds && !lines.length) return { returned: 0, byProduct: [] };
    return this.need().transaction().execute(async (trx) => {
      const sold = await sql<{ id: string; product_id: string }>`SELECT id, product_id FROM inventory_units
        WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND status = 'sold' AND sold_ticket_id = ${input.ticketId}
          ${input.lineIds ? sql`AND sold_line_id = ANY(${lines}::uuid[])` : sql``}
        ORDER BY product_id, created_at FOR UPDATE SKIP LOCKED`.execute(trx);
      const byProduct: Array<{ productId: string; returned: number; onHand: number }> = [];
      const groups = new Map<string, string[]>();
      for (const r of sold.rows) groups.set(r.product_id, [...(groups.get(r.product_id) ?? []), r.id]);
      for (const [productId, ids] of groups) {
        const before = (await this.recompute(ctx, productId, trx)).onHand;
        await sql`UPDATE inventory_units SET status = 'unopened', sold_ticket_id = NULL, sold_line_id = NULL, updated_at = now()
          WHERE tenant_id = ${ctx.tenantId} AND id = ANY(${ids}::uuid[])`.execute(trx);
        const after = (await this.recompute(ctx, productId, trx)).onHand;
        await this.move(ctx, productId, null, 'customer_return', before, after - before, after, `retail sale reversed: ${input.reason}`, { type: 'ticket', id: input.ticketId }, trx);
        await this.audit(ctx, 'inventory_retail_returned', productId, null, { returned: ids.length, ticketId: input.ticketId, lineIds: input.lineIds, reason: input.reason });
        byProduct.push({ productId, returned: ids.length, onHand: after });
      }
      return { returned: sold.rows.length, byProduct };
    });
  }


  // ---- bottle lifecycle ----
  private async transition(ctx: InvCtx, unitId: string, to: BottleStatus, audit: string, moveType: MovementType, byCol?: 'opened' | 'emptied') {
    const u0 = await this.unit(ctx, unitId);
    if (!canTransitionBottle(u0.status, to)) throw withCode(new InventoryError(409, `Cannot change bottle from ${u0.status} to ${to}`), 'BOTTLE_STATE_INVALID');
    const stamp = byCol === 'opened' ? sql`, opened_at = now(), opened_by_user_id = ${ctx.userId}` : byCol === 'emptied' ? sql`, emptied_at = now(), emptied_by_user_id = ${ctx.userId}` : sql``;
    // audit D9 (Nov 4 2026): the bottle, the stock cache, the ledger row and the audit are ONE transaction under the
    // product's stock lock, and the bottle moves only from the status just read (two taps: one moves, the other is refused)
    const u = await this.need().transaction().execute(async (trx0) => {
      const trx = trx0 as unknown as Kysely<DB>;
      await this.lockStock(ctx, [String(u0.product_id)], trx);
      const before = (await this.recompute(ctx, u0.product_id, trx)).onHand;
      const moved = await sql`UPDATE inventory_units SET status = ${to}, updated_at = now() ${stamp} WHERE id = ${unitId} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND status = ${u0.status}`.execute(trx);
      if (!Number(moved.numAffectedRows ?? 0)) throw withCode(new InventoryError(409, `Cannot change bottle from its current status to ${to}`), 'BOTTLE_STATE_INVALID');
      const after = (await this.recompute(ctx, u0.product_id, trx)).onHand;
      await this.move(ctx, u0.product_id, unitId, moveType, before, after - before, after, undefined, undefined, trx);
      await this.audit(ctx, audit, u0.product_id, unitId, { from: u0.status, to }, trx);
      return u0;
    });
    const reorder = await this.reorderAlert(ctx, u.product_id);
    return { unit: await this.unit(ctx, unitId), product: (await this.getProduct(ctx, u.product_id)).product, reorderAlert: reorder };
  }
  openUnit(ctx: InvCtx, unitId: string) { return this.transition(ctx, unitId, 'opened', 'inventory_bottle_opened', 'bottle_opened', 'opened'); }
  markLow(ctx: InvCtx, unitId: string) { return this.transition(ctx, unitId, 'low', 'inventory_bottle_marked_low', 'technician_report'); }
  markEmpty(ctx: InvCtx, unitId: string) { return this.transition(ctx, unitId, 'empty', 'inventory_bottle_marked_empty', 'bottle_empty', 'emptied'); }
  markDamaged(ctx: InvCtx, unitId: string) { return this.transition(ctx, unitId, 'damaged', 'inventory_bottle_damaged', 'damaged'); }

  private async reorderAlert(ctx: InvCtx, productId: string): Promise<{ needed: boolean; suggested: number } | null> {
    // the location's overrides win (the alert list's rule) and what is already on order is not suggested again
    const branchId = await this.resolveBranchId(ctx);
    const r = (await sql<any>`SELECT coalesce(s.reorder_level_override, p.reorder_level, 0)::int AS lvl, coalesce(s.reorder_quantity_override, p.reorder_quantity, 0)::int AS qty,
        coalesce(s.quantity_on_hand, 0)::int AS on_hand, ${onOrderSql(ctx.tenantId, branchId, sql`p.id`)} AS on_order
      FROM inventory_products p LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${branchId}
      WHERE p.id = ${productId} AND p.tenant_id = ${ctx.tenantId}`.execute(this.need())).rows[0];
    const suggested = r ? reorderSuggestion(Number(r.on_hand), Number(r.lvl), Number(r.qty), Number(r.on_order)) : 0;
    return suggested > 0 ? { needed: true, suggested } : null;
  }

  // ---- technician reports ----
  async submitReport(ctx: InvCtx, b: any) {
    const type = String(b?.reportType || '');
    if (!type) throw withCode(new InventoryError(400, 'Report type required'), 'REPORT_TYPE_REQUIRED');
    let unitStatus: BottleStatus | null = null; let productId = b?.productId ?? null;
    if (b?.unitId) { const u = await this.unit(ctx, b.unitId); unitStatus = u.status; productId = u.product_id; }
    if (!productId) throw withCode(new InventoryError(400, 'Product or bottle required'), 'PRODUCT_OR_BOTTLE_REQUIRED');
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
      if (String(e?.message || '').includes('idx_inv_techrep_dedup') || e?.code === '23505') throw withCode(new InventoryError(409, 'This bottle already has a pending report of that type'), 'BOTTLE_REPORT_PENDING');
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
    const rep = r.rows[0]; if (!rep) throw withCode(new InventoryError(404, 'Report not found'), 'REPORT_NOT_FOUND');
    if (rep.status !== 'pending') throw withCode(new InventoryError(409, 'Report already reviewed'), 'REPORT_ALREADY_REVIEWED');
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
      } catch (e) {
        // the bottle may already be in the target state (a refusal, 4xx): approval still records. Anything else is a real failure.
        if (!(e instanceof InventoryError) || e.status >= 500) throw e;
      }
    }
    await this.audit(ctx, 'inventory_technician_report_approved', rep.product_id, rep.inventory_unit_id, { type: rep.report_type });
    return { ok: true };
  }
  async rejectReport(ctx: InvCtx, reportId: string, note?: string) {
    const branchId = await this.resolveBranchId(ctx);
    const r = await sql<any>`SELECT product_id, inventory_unit_id, status FROM inventory_technician_reports WHERE id = ${reportId} AND tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId})`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Report not found'), 'REPORT_NOT_FOUND');
    if (r.rows[0].status !== 'pending') throw withCode(new InventoryError(409, 'Report already reviewed'), 'REPORT_ALREADY_REVIEWED');
    await transitionStatus(this.need(), INVENTORY_TECH_REPORT, { where: { id: reportId, tenant_id: ctx.tenantId }, from: 'pending', to: 'rejected', set: { reviewed_by_user_id: ctx.userId, reviewed_at: sql`now()`, resolution_note: note ?? null, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_technician_report_rejected', r.rows[0].product_id, r.rows[0].inventory_unit_id, {});
    return { ok: true };
  }

  // ---- summary / alerts ----
  async summary(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    // Audit D9 (Nov 4 2026): ONE low-stock rule everywhere (the board, the overview insight, the alert list and this
    // summary): a product's stock is summed across the scope (salon-wide had one row per location — a product stocked at
    // three locations counted three times), the location override wins, and an inactive product never counts as low.
    const rows = await sql<any>`SELECT p.reorder_level, p.critical_level, p.maximum_stock, p.cost_cents, p.track_expiration, (p.active IS NOT FALSE) AS active,
        max(s.reorder_level_override) AS reorder_level_override, max(s.critical_level_override) AS critical_level_override,
        coalesce(sum(s.quantity_on_hand),0)::int AS on_hand, coalesce(sum(s.quantity_unopened),0)::int AS unopened, coalesce(sum(s.quantity_open),0)::int AS open, coalesce(sum(s.quantity_empty),0)::int AS empty
      FROM inventory_products p
      LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND (${branchId}::uuid IS NULL OR s.branch_id = ${branchId})
      WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL
      GROUP BY p.id`.execute(this.need());
    let totalProducts = 0, totalBottles = 0, openBottles = 0, unopenedBottles = 0, lowStock = 0, outOfStock = 0, valueCents = 0;
    for (const r of rows.rows) {
      totalProducts++; totalBottles += r.on_hand; openBottles += r.open; unopenedBottles += r.unopened; valueCents += (r.on_hand * (r.cost_cents || 0));
      const reorderLvl = r.reorder_level_override ?? r.reorder_level ?? 0;
      const critLvl = r.critical_level_override ?? r.critical_level ?? null;
      const st = stockStatus(r.on_hand, reorderLvl, r.maximum_stock, critLvl);
      if (!r.active) continue;   // an inactive product is never low / out
      // out of stock = nothing on hand (as the product list says); LOW = at or under a reorder point (the alert list's rule)
      if (st === 'out_of_stock') outOfStock++; else if ((st === 'low' || st === 'critical') && reorderLvl > 0) lowStock++;
    }
    const pending = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_technician_reports WHERE tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND status = 'pending'`.execute(this.need());
    const expiring = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_units WHERE tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND status IN ('unopened','opened','low') AND expiration_date IS NOT NULL AND expiration_date <= (now() + interval '30 days')`.execute(this.need());
    const summary: any = { totalProducts, totalBottles, openBottles, unopenedBottles, lowStock, outOfStock, expiringSoon: expiring.rows[0]?.n ?? 0, pendingReports: pending.rows[0]?.n ?? 0 };
    if (!this.isTechOnly(ctx)) summary.inventoryValueCents = valueCents;
    return { summary };
  }

  async alerts(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    // the shared low-stock rule (see summary): stock summed over the scope, location override wins, active products only
    const low = await sql<any>`SELECT * FROM (
        SELECT p.id, p.name, p.color_number, p.reorder_level, p.reorder_quantity, p.critical_level, p.maximum_stock, coalesce(sum(s.quantity_on_hand),0)::int AS on_hand,
          max(s.reorder_level_override) AS reorder_level_override, max(s.reorder_quantity_override) AS reorder_quantity_override, max(s.critical_level_override) AS critical_level_override,
          ${onOrderSql(ctx.tenantId, branchId, sql`p.id`)} AS on_order
        FROM inventory_products p LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND (${branchId}::uuid IS NULL OR s.branch_id = ${branchId})
        WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL AND p.active IS NOT FALSE
        GROUP BY p.id) x
      WHERE coalesce(x.reorder_level_override, x.reorder_level, 0) > 0 AND x.on_hand <= coalesce(x.reorder_level_override, x.reorder_level)
      ORDER BY x.on_hand ASC LIMIT 100`.execute(this.need());
    return { alerts: low.rows.map((p) => {
      const rLvl = p.reorder_level_override ?? p.reorder_level ?? 0;
      const rQty = p.reorder_quantity_override ?? p.reorder_quantity ?? 0;
      return { productId: p.id, name: p.name, colorNumber: p.color_number, onHand: p.on_hand, status: stockStatus(p.on_hand, rLvl, p.maximum_stock, p.critical_level_override ?? p.critical_level ?? null), onOrder: Number(p.on_order ?? 0), suggested: reorderSuggestion(p.on_hand, rLvl, rQty, Number(p.on_order ?? 0)) };   // the same thresholds as the product list
    }) };
  }

  // ---- purchase orders (§18) — create / approve / receive / cancel ----
  private async po(ctx: InvCtx, id: string) {
    const r = await sql<any>`SELECT * FROM purchase_orders WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Purchase order not found'), 'PO_NOT_FOUND');
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
      SELECT l.id, l.product_id, l.quantity_ordered, l.quantity_received, l.unit_cost_cents, l.units_per_purchase_unit, l.lot_number, l.expiration_date,
             p.name AS product_name, p.color_number
      FROM purchase_order_lines l JOIN inventory_products p ON p.id = l.product_id
      WHERE l.purchase_order_id = ${id} AND l.tenant_id = ${ctx.tenantId} ORDER BY p.name`.execute(this.need());
    if (this.isTechOnly(ctx)) { delete po.subtotal_cents; delete po.shipping_cents; delete po.tax_cents; delete po.total_cents; lines.rows.forEach((l: any) => delete l.unit_cost_cents); }
    return { purchaseOrder: po, lines: lines.rows };
  }

  async createPurchaseOrder(ctx: InvCtx, b: any) {
    const raw = Array.isArray(b?.lines) ? b.lines : [];
    if (raw.length === 0) throw withCode(new InventoryError(400, 'A purchase order needs at least one line item'), 'PO_LINES_REQUIRED');
    const clean: { productId: string; quantityOrdered: number; unitCostCents: number }[] = [];
    for (const l of raw) {
      const pid = l?.productId;
      if (!pid) throw withCode(new InventoryError(400, 'Each line needs a product'), 'LINE_PRODUCT_REQUIRED');
      await this.product(ctx, pid); // tenant ownership + existence
      const qty = parseInt(l?.quantityOrdered, 10) || 0;
      if (qty < 1) throw withCode(new InventoryError(400, 'Each line needs a quantity of at least 1'), 'LINE_QUANTITY_INVALID');
      if (qty > 100000) throw withCode(new InventoryError(400, 'Line quantity is too large'), 'QUANTITY_TOO_LARGE');
      clean.push({ productId: pid, quantityOrdered: qty, unitCostCents: Math.max(0, parseInt(l?.unitCostCents, 10) || 0) });
    }
    const shipping = Math.max(0, parseInt(b?.shippingCents, 10) || 0);
    const tax = Math.max(0, parseInt(b?.taxCents, 10) || 0);
    const totals = poTotals(clean, shipping, tax);
    const poNum = 'PO-' + Date.now().toString(36).toUpperCase();
    // the vendor must be THIS salon's (it was stored unchecked); the PO, its lines and the audit row are one transaction (a failure
    // part-way left a PO without lines)
    const vendorId = b?.vendorId ? String(b.vendorId) : null;
    if (vendorId && !(await sql`SELECT 1 FROM inventory_vendors WHERE id = ${vendorId} AND tenant_id = ${ctx.tenantId}`.execute(this.need()).catch(() => ({ rows: [] }))).rows.length) {
      throw withCode(new InventoryError(404, 'That vendor was not found.'), 'VENDOR_NOT_FOUND');
    }
    // the supplier's pack size is copied onto each line (audit D9): N purchase units received = N × pack bottles
    const packs = new Map<string, number>();
    if (vendorId) for (const r of (await sql<any>`SELECT product_id, units_per_purchase_unit FROM inventory_vendor_products WHERE tenant_id = ${ctx.tenantId} AND vendor_id = ${vendorId}`.execute(this.need())).rows) packs.set(String(r.product_id), Math.max(1, Number(r.units_per_purchase_unit) || 1));
    const poId = await this.need().transaction().execute(async (trx) => {
      const r = await sql<{ id: string }>`INSERT INTO purchase_orders
        (tenant_id, branch_id, vendor_id, po_number, status, expected_date, notes, subtotal_cents, shipping_cents, tax_cents, total_cents, created_by_user_id)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${vendorId}, ${poNum}, 'draft', ${b?.expectedDate ?? null}, ${b?.notes ?? null}, ${totals.subtotalCents}, ${shipping}, ${tax}, ${totals.totalCents}, ${ACTOR_UUID.test(ctx.userId) ? ctx.userId : null}) RETURNING id`.execute(trx);
      const id = r.rows[0].id;
      for (const l of clean) {
        await sql`INSERT INTO purchase_order_lines (tenant_id, purchase_order_id, product_id, quantity_ordered, unit_cost_cents, units_per_purchase_unit)
          VALUES (${ctx.tenantId}, ${id}, ${l.productId}, ${l.quantityOrdered}, ${l.unitCostCents}, ${packs.get(l.productId) ?? 1})`.execute(trx);
      }
      await this.audit(ctx, 'inventory_po_created', null, null, { id, poNumber: poNum, lines: clean.length, totalCents: totals.totalCents }, trx as unknown as Kysely<DB>);
      return id;
    });
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
    if (po.status !== 'draft') throw withCode(new InventoryError(409, `Cannot approve a ${po.status} purchase order`), 'PO_STATE_INVALID');
    // Phase 12 (#27): conditional on the state just read — a concurrent cancel is not overwritten (409 instead)
    await transitionStatus(this.need(), PURCHASE_ORDER, { where: { id, tenant_id: ctx.tenantId }, from: 'draft', to: 'approved', set: { approved_by_user_id: ctx.userId, approved_at: sql`now()`, ordered_at: sql`now()`, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_po_approved', null, null, { id });
    return this.getPurchaseOrder(ctx, id);
  }

  async cancelPurchaseOrder(ctx: InvCtx, id: string, note?: string) {
    const po = await this.po(ctx, id);
    if (po.status === 'received' || po.status === 'cancelled' || po.status === 'closed') throw withCode(new InventoryError(409, `Cannot cancel a ${po.status} purchase order`), 'PO_STATE_INVALID');
    // Phase 12 (#27): a receive that lands first wins — the cancel is refused (409), never written over a received PO
    await transitionStatus(this.need(), PURCHASE_ORDER, { where: { id, tenant_id: ctx.tenantId }, from: po.status, to: 'cancelled', set: { cancelled_at: sql`now()`, notes: sql`coalesce(${note ?? null}, notes)`, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_po_cancelled', null, null, { id });
    return { ok: true };
  }

  /** Receive against a PO. Claim-first per line (guarded UPDATE) so the same line can never be received
   *  twice; physical stock is only added after the claim succeeds. Status recomputes to partial/received. */
  async receivePurchaseOrder(ctx: InvCtx, id: string, b: any) {
    const po = await this.po(ctx, id);
    if (!canReceivePO(po.status)) throw withCode(new InventoryError(409, `Cannot receive a ${po.status} purchase order`), 'PO_STATE_INVALID');
    const reqLines: { lineId: string; quantity: number; lotNumber?: string; expirationDate?: string }[] = Array.isArray(b?.lines) ? b.lines : [];
    if (reqLines.length === 0) throw withCode(new InventoryError(400, 'Nothing to receive'), 'NOTHING_TO_RECEIVE');
    // D10 Suppliers (Nov 3 2026): the line claim and the stock it creates were separate writes — a failure after the claim
    // left the line "received" with no stock. The whole receipt (claims, units, movements, status, audit) is now one transaction.
    const newStatus = await this.need().transaction().execute(async (trx0) => {
    const trx = trx0 as unknown as Kysely<DB>;
    let receivedAny = false;
    for (const rl of reqLines) {
      const want = parseInt(rl?.quantity as any, 10) || 0;
      if (want <= 0) continue;
      const lineRow = await sql<any>`SELECT id, product_id, quantity_ordered, quantity_received, unit_cost_cents, units_per_purchase_unit, lot_number, expiration_date, storage_location
        FROM purchase_order_lines WHERE id = ${rl.lineId} AND purchase_order_id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(trx);
      const line = lineRow.rows[0];
      if (!line) throw withCode(new InventoryError(404, 'Purchase order line not found'), 'PO_LINE_NOT_FOUND');
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
        RETURNING id`.execute(trx);
      if (!claim.rows[0]) continue; // lost the race — another receiver already took it
      // only AFTER the claim do we create physical stock (units + 'purchase_received' movement + recompute)
      // `take` is in purchase units (cases); the shelf gets bottles — each at the line cost ÷ pack (audit D9)
      const pack = Math.max(1, Number(line.units_per_purchase_unit) || 1);
      const bottleCost = line.unit_cost_cents ? Math.round(Number(line.unit_cost_cents) / pack) : 0;
      let remaining = take * pack;
      while (remaining > 0) {
        const chunk = Math.min(1000, remaining);
        await this.addStock(ctx, line.product_id, {
          quantity: chunk, costCents: bottleCost || undefined,
          lotNumber: rl?.lotNumber ?? line.lot_number ?? null, expirationDate: rl?.expirationDate ?? line.expiration_date ?? null,
          storageLocation: line.storage_location ?? null, purchaseOrderId: id, note: 'PO ' + (po.po_number || id),
        }, { fromPo: true, exec: trx });
        remaining -= chunk;
      }
      receivedAny = true;
    }
    if (!receivedAny) throw withCode(new InventoryError(409, 'Those lines are already fully received'), 'PO_ALREADY_RECEIVED');
    const allLines = await sql<any>`SELECT quantity_ordered AS "quantityOrdered", quantity_received AS "quantityReceived" FROM purchase_order_lines WHERE purchase_order_id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(trx);
    const st = poReceivingStatus(allLines.rows) === 'received' ? 'received' : 'partial';
    // Phase 12 (#27): only from a receivable state — a PO cancelled while these lines were received is NOT flipped back
    // to received (it was, before: the unconditional update overwrote the cancel)
    await transitionStatus(trx, PURCHASE_ORDER, { where: { id, tenant_id: ctx.tenantId }, from: ['approved', 'ordered', 'partial'], to: st, set: { received_at: st === 'received' ? sql`now()` : sql`received_at`, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_po_received', null, null, { id, status: st }, trx);
    return st;
    });
    return this.getPurchaseOrder(ctx, id);
  }

  // ---- branch transfers (§19) — move stock between branches in the same tenant ----
  private async branch(ctx: InvCtx, id: string) {
    const r = await sql<{ id: string; name: string }>`SELECT id, name FROM branches WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND deleted_at IS NULL`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Branch not found'), 'BRANCH_NOT_FOUND');
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
    if (!h.rows[0]) throw withCode(new InventoryError(404, 'Transfer not found'), 'TRANSFER_NOT_FOUND');
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
    if (!toBranchId) throw withCode(new InventoryError(400, 'A destination branch is required'), 'DESTINATION_BRANCH_REQUIRED');
    if (toBranchId === ctx.branchId) throw withCode(new InventoryError(400, 'Source and destination branches must differ'), 'TRANSFER_SAME_BRANCH');
    await this.branch(ctx, toBranchId); // destination belongs to this tenant
    const raw = Array.isArray(b?.lines) ? b.lines : [];
    if (raw.length === 0) throw withCode(new InventoryError(400, 'A transfer needs at least one product line'), 'TRANSFER_LINES_REQUIRED');
    // validate every line before anything is written
    const lines: { pid: string; want: number }[] = [];
    for (const l of raw) {
      const pid = l?.productId;
      if (!pid) throw withCode(new InventoryError(400, 'Each line needs a product'), 'LINE_PRODUCT_REQUIRED');
      await this.product(ctx, pid); // tenant ownership + existence
      const want = parseInt(l?.quantity, 10) || 0;
      if (want < 1) throw withCode(new InventoryError(400, 'Each line needs a quantity of at least 1'), 'LINE_QUANTITY_INVALID');
      lines.push({ pid, want });
    }

    const destCtx: InvCtx = { ...ctx, branchId: toBranchId };
    const transferNumber = 'TR-' + Date.now().toString(36).toUpperCase();
    // audit D9 (Nov 4 2026): the header, every line, the bottle moves, both ledgers and the audit are ONE transaction under
    // the stock lock of both locations (taken in branch order, so two opposite transfers cannot deadlock) — a failure part
    // way used to leave bottles moved with no ledger, or a transfer with half its lines
    const out = await this.need().transaction().execute(async (trx) => {
      const pids = lines.map((l) => l.pid);
      for (const c of [ctx, destCtx].sort((a, z) => String(a.branchId).localeCompare(String(z.branchId)))) await this.lockStock(c, pids, trx);
      const th = await sql<{ id: string }>`INSERT INTO inventory_transfers
        (tenant_id, from_branch_id, to_branch_id, transfer_number, status, notes, created_by_user_id)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${toBranchId}, ${transferNumber}, 'completed', ${b?.notes ?? null}, ${ctx.userId}) RETURNING id`.execute(trx);
      const transferId = th.rows[0].id;
      let itemCount = 0, unitCount = 0;
      for (const { pid, want } of lines) {
        const srcBefore = (await this.recompute(ctx, pid, trx)).onHand;
        const destBefore = (await this.recompute(destCtx, pid, trx)).onHand;
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
          FROM picked WHERE u.id = picked.id RETURNING u.id`.execute(trx);
        const movedCount = moved.rows.length;
        const srcAfter = (await this.recompute(ctx, pid, trx)).onHand;
        const destAfter = (await this.recompute(destCtx, pid, trx)).onHand;
        await sql`INSERT INTO inventory_transfer_lines (tenant_id, transfer_id, product_id, quantity_requested, quantity_moved)
          VALUES (${ctx.tenantId}, ${transferId}, ${pid}, ${want}, ${movedCount})`.execute(trx);
        if (movedCount > 0) {
          await this.move(ctx, pid, null, 'transfer_out', srcBefore, -movedCount, srcAfter, 'Transfer ' + transferNumber, { type: 'transfer', id: transferId }, trx);
          await this.move(destCtx, pid, null, 'transfer_in', destBefore, movedCount, destAfter, 'Transfer ' + transferNumber, { type: 'transfer', id: transferId }, trx);
          itemCount += 1; unitCount += movedCount;
        }
      }
      // nothing was available — the transaction rolls back, so no empty transfer is left behind
      if (unitCount === 0) throw withCode(new InventoryError(409, 'No stock was available to transfer for the selected products'), 'NO_STOCK_TO_TRANSFER');
      await sql`UPDATE inventory_transfers SET item_count = ${itemCount}, unit_count = ${unitCount}, updated_at = now() WHERE id = ${transferId} AND tenant_id = ${ctx.tenantId}`.execute(trx);
      await this.audit(ctx, 'inventory_transfer_created', null, null, { id: transferId, transferNumber, toBranchId, items: itemCount, units: unitCount }, trx);
      return transferId;
    });
    return this.getTransfer(ctx, out);
  }

  // ---- physical inventory counts (§20) — snapshot, enter, reconcile to system of record ----
  private async count(ctx: InvCtx, id: string) {
    const r = await sql<any>`SELECT * FROM inventory_counts WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Count not found'), 'COUNT_NOT_FOUND');
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
    if (scopeType !== 'all' && !scopeId) throw withCode(new InventoryError(400, 'A category or brand is required for a scoped count'), 'INVENTORY_COUNT_SCOPE_REQUIRED');
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
    if (products.rows.length === 0) throw withCode(new InventoryError(400, 'No products to count for that scope'), 'NO_PRODUCTS_TO_COUNT');
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
    if (c.status !== 'in_progress') throw withCode(new InventoryError(409, `Cannot enter counts on a ${c.status} count`), 'COUNT_STATE_INVALID');
    const reqLines: { lineId: string; countedQty: number | null }[] = Array.isArray(b?.lines) ? b.lines : (b?.lineId ? [{ lineId: b.lineId, countedQty: b.countedQty }] : []);
    if (reqLines.length === 0) throw withCode(new InventoryError(400, 'Nothing to record'), 'NOTHING_TO_RECORD');
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
    if (c.status !== 'in_progress') throw withCode(new InventoryError(409, `Cannot submit a ${c.status} count`), 'COUNT_STATE_INVALID');
    await transitionStatus(this.need(), INVENTORY_COUNT, { where: { id, tenant_id: ctx.tenantId }, from: 'in_progress', to: 'submitted', set: { updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_count_submitted', null, null, { id });
    return this.getCount(ctx, id);
  }

  async cancelCount(ctx: InvCtx, id: string) {
    const c = await this.count(ctx, id);
    if (c.status === 'reconciled' || c.status === 'cancelled') throw withCode(new InventoryError(409, `Cannot cancel a ${c.status} count`), 'COUNT_STATE_INVALID');
    await transitionStatus(this.need(), INVENTORY_COUNT, { where: { id, tenant_id: ctx.tenantId }, from: c.status, to: 'cancelled', set: { cancelled_at: sql`now()`, updated_at: sql`now()` } });
    await this.audit(ctx, 'inventory_count_cancelled', null, null, { id });
    return { ok: true };
  }

  /** Reconcile: correct the system to the counted quantities. For each counted line, recompute the live
   *  on-hand and apply the delta — add unopened units for a surplus, mark units 'missing' for shrinkage —
   *  writing an adjustment_increase / adjustment_decrease movement. Uncounted lines are skipped. */
  async reconcileCount(ctx: InvCtx, id: string) {
    const c = await this.count(ctx, id);
    if (c.status !== 'in_progress' && c.status !== 'submitted') throw withCode(new InventoryError(409, `Cannot reconcile a ${c.status} count`), 'COUNT_STATE_INVALID');
    // audit D9 (Nov 4 2026): (1) the claim, every adjustment, the ledger, the variance and the audit are ONE transaction under
    // the stock lock — a failure part way used to leave the count "reconciled" with only some products adjusted; (2) the
    // variance is counted − the quantity SNAPSHOT when the count started (expected_qty), applied to today's stock — setting
    // stock to the counted number undid every sale / receipt made between the count and its reconciliation
    await this.need().transaction().execute(async (trx) => {
      // Phase 12 (#27): CLAIM the transition first — a second reconcile of the same count is refused (409)
      await transitionStatus(trx as unknown as Parameters<typeof transitionStatus>[0], INVENTORY_COUNT, { where: { id, tenant_id: ctx.tenantId }, from: c.status, to: 'reconciled', set: { reconciled_by_user_id: ctx.userId, reconciled_at: sql`now()`, updated_at: sql`now()` } });
      const lines = await sql<any>`SELECT id, product_id, counted_qty, expected_qty FROM inventory_count_lines
        WHERE count_id = ${id} AND tenant_id = ${ctx.tenantId} AND is_counted = true AND counted_qty IS NOT NULL`.execute(trx);
      await this.lockStock(ctx, lines.rows.map((l: any) => String(l.product_id)), trx);
      let absVariance = 0;
      for (const l of lines.rows) {
        const counted = clampCount(l.counted_qty);
        const delta = counted - Math.max(0, Number(l.expected_qty) || 0);
        if (delta === 0) continue;
        const cur = (await this.recompute(ctx, l.product_id, trx)).onHand;
        if (delta > 0) {
          for (let k = 0; k < delta; k++) {
            await sql`INSERT INTO inventory_units (tenant_id, branch_id, product_id, status)
              VALUES (${ctx.tenantId}, ${ctx.branchId}, ${l.product_id}, ${'unopened'})`.execute(trx);
          }
        } else {
          // mark |delta| movable bottles 'missing' (never more than are on hand now)
          await sql`
            WITH picked AS (
              SELECT id FROM inventory_units
              WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${l.product_id}
                AND status IN ('unopened', 'opened', 'low')
              ORDER BY CASE status WHEN 'low' THEN 0 WHEN 'opened' THEN 1 ELSE 2 END
              LIMIT ${-delta} FOR UPDATE SKIP LOCKED
            )
            UPDATE inventory_units u SET status = 'missing', updated_at = now() FROM picked WHERE u.id = picked.id`.execute(trx);
        }
        const after = (await this.recompute(ctx, l.product_id, trx)).onHand;
        const applied = after - cur;
        if (applied !== 0) {
          await this.move(ctx, l.product_id, null, applied > 0 ? 'adjustment_increase' : 'adjustment_decrease', cur, applied, after, 'Count ' + (c.count_number || id), { type: 'inventory_count', id }, trx,
            { countedQty: counted, expectedAtCount: Number(l.expected_qty) || 0 });
          absVariance += Math.abs(applied);
        }
      }
      await sql`UPDATE inventory_counts SET variance_units = ${absVariance}, updated_at = now() WHERE id = ${id} AND tenant_id = ${ctx.tenantId}`.execute(trx);
      await this.audit(ctx, 'inventory_count_reconciled', null, null, { id, varianceUnits: absVariance }, trx);
    });
    return this.getCount(ctx, id);
  }

  // ---- service recipes (§13) — products a service consumes; deduction writes service_usage movements ----
  private async service(ctx: InvCtx, id: string) {
    const branchId = await this.resolveBranchId(ctx);
    const r = await sql<{ id: string; name: string }>`SELECT id, name FROM services WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR branch_id = ${branchId}) AND archived_at IS NULL`.execute(this.need());
    if (!r.rows[0]) throw withCode(new InventoryError(404, 'Service not found'), 'SERVICE_NOT_FOUND');
    return r.rows[0];
  }

  async listServicesForRecipes(ctx: InvCtx) {
    const branchId = await this.resolveBranchId(ctx);
    const rows = await sql<any>`
      SELECT s.id, s.name, s.price_cents, COALESCE(r.n, 0) AS recipe_lines, COALESCE(r.units, 0) AS recipe_units
      FROM services s
      LEFT JOIN (SELECT service_id, count(*)::int AS n, COALESCE(sum(quantity), 0)::float8 AS units FROM service_product_recipes WHERE tenant_id = ${ctx.tenantId} GROUP BY service_id) r ON r.service_id = s.id
      WHERE s.tenant_id = ${ctx.tenantId} AND (${branchId}::uuid IS NULL OR s.branch_id = ${branchId}) AND s.archived_at IS NULL AND s.status = 'active'
      ORDER BY s.sort_order, s.name`.execute(this.need());
    return { services: rows.rows };
  }

  async getServiceRecipe(ctx: InvCtx, serviceId: string): Promise<ServiceRecipe> {
    const s = await this.service(ctx, serviceId);
    const lines = await sql<any>`
      SELECT r.id, r.product_id, r.quantity::float8 AS quantity, p.name AS product_name, p.color_number, p.cost_cents
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
      if (!pid || seen.has(pid)) continue;
      // audit D9: an exact amount with up to two decimals (0.1 bottle); it was floored to whole bottles (minimum 1)
      const h = parseQuantity(l?.quantity);
      if (h == null) throw withCode(new InventoryError(400, 'Enter how much was used — a positive amount with up to two decimals.'), 'USAGE_QUANTITY_INVALID');
      const p = await sql<{ id: string; unit_type: string | null }>`SELECT id, unit_type FROM inventory_products WHERE id = ${pid} AND tenant_id = ${ctx.tenantId} AND archived_at IS NULL`.execute(this.need());
      if (!p.rows[0]) throw withCode(new InventoryError(400, 'A selected product no longer exists'), 'PRODUCT_NOT_FOUND');
      if (!allowsFraction(p.rows[0].unit_type) && h % HUNDREDTHS !== 0) throw withCode(new InventoryError(400, 'This product is counted in whole units only.'), 'USAGE_FRACTION_NOT_ALLOWED');
      seen.add(pid); clean.push({ productId: pid, quantity: h / HUNDREDTHS });
    }
    await sql`DELETE FROM service_product_recipes WHERE service_id = ${serviceId} AND tenant_id = ${ctx.tenantId}`.execute(this.need());
    for (const l of clean) {
      await sql`INSERT INTO service_product_recipes (tenant_id, service_id, product_id, quantity) VALUES (${ctx.tenantId}, ${serviceId}, ${l.productId}, ${l.quantity})`.execute(this.need());
    }
    await this.audit(ctx, 'service_recipe_set', null, null, { serviceId, lines: clean.length });
    return this.getServiceRecipe(ctx, serviceId);
  }

  /** Deduct a service's recipe from stock (e.g. when the service is performed). For each line, take quantity × multiplier
   *  (hundredths of the product's unit) from the bottles — open bottles first — and write a service_usage movement whose
   *  metadata carries the exact amount. Deducts only what's on hand (reports any shortfall) — never goes negative. */
  async consumeServiceRecipe(ctx: InvCtx, serviceId: string, multiplier = 1, opts: { exec?: Kysely<DB>; related?: { type: string; id: string }; reason?: string; audit?: string } = {}): Promise<{ serviceId: string; multiplier: number; deducted: { productId: string; requested: number; deducted: number }[] }> {
    // audit D9: a manual call (no caller transaction) is ONE transaction — the stock lock taken below then holds until the
    // bottles, ledger and audit are written (outside a transaction it was released at once and a failure left half a deduction)
    if (!opts.exec) return this.need().transaction().execute((trx) => this.consumeServiceRecipe(ctx, serviceId, multiplier, { ...opts, exec: trx as unknown as Kysely<DB> }));
    await this.service(ctx, serviceId);
    const exec = opts.exec;
    const mult = Math.max(1, Math.floor(multiplier || 1));
    // product_id order, and the stock rows locked in that order BEFORE the first count (M4 lanes — see lockStock): the
    // "before" count is then taken after every concurrent deduction of these products has committed, so before − after
    // is exactly what THIS call emptied; and two services sharing products never lock them in opposite orders.
    const lines = await sql<any>`SELECT product_id, quantity FROM service_product_recipes WHERE service_id = ${serviceId} AND tenant_id = ${ctx.tenantId} ORDER BY product_id`.execute(exec);
    await this.lockStock(ctx, lines.rows.map((l: any) => String(l.product_id)), exec);
    const result: { productId: string; requested: number; deducted: number }[] = [];
    for (const l of lines.rows) {
      // audit D9: the recipe amount (hundredths of the unit) is TAKEN from the bottles like a recorded use — the open bottle's
      // remaining % goes down, a sealed one is opened only when needed; it used to empty one whole bottle per unit
      const want = Math.max(0, Math.round(Number(l.quantity) * HUNDREDTHS) * mult);
      if (want <= 0) { result.push({ productId: l.product_id, requested: 0, deducted: 0 }); continue; }
      const bottles = (await sql<{ id: string; status: BottleStatus; estimated_remaining_percent: number | null; created_at: string; expires_on: string | null }>`
        SELECT id, status, estimated_remaining_percent, created_at::text AS created_at, to_char(expiration_date, 'YYYY-MM-DD') AS expires_on FROM inventory_units
         WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${l.product_id} AND status IN ('unopened', 'opened', 'low')
           -- an expired bottle is never used on a client; sealed bottles soonest-expiring first
           AND (expiration_date IS NULL OR expiration_date >= (now() AT TIME ZONE 'UTC')::date)
         ORDER BY created_at, id FOR UPDATE`.execute(exec)).rows.map((b): BottleRow => ({ id: b.id, status: b.status, remainingPercent: b.estimated_remaining_percent == null ? null : Number(b.estimated_remaining_percent), createdAt: String(b.created_at), expiresOn: b.expires_on }));
      const plan = allocate(bottles, want);   // never negative: what the bottles cannot cover is the shortfall
      const taken = want - plan.short;
      const before = (await this.recompute(ctx, l.product_id, exec)).onHand;
      for (const t of plan.takes) await this.applyBottle(ctx, t.unitId, t.toStatus, t.remainingAfter, t.fromStatus, exec);
      const after = (await this.recompute(ctx, l.product_id, exec)).onHand;
      if (taken > 0) await this.move(ctx, l.product_id, plan.takes.length === 1 ? plan.takes[0].unitId : null, 'service_usage', before, after - before, after, opts.reason ?? 'Service usage', opts.related ?? { type: 'service', id: serviceId }, exec,
        { quantityHundredths: taken, requestedHundredths: want, shortHundredths: plan.short, takes: plan.takes });
      result.push({ productId: l.product_id, requested: want / HUNDREDTHS, deducted: taken / HUNDREDTHS });
    }
    await this.audit(ctx, opts.audit ?? 'service_recipe_consumed', null, null, { serviceId, multiplier: mult, lines: result.length, related: opts.related ?? null }, exec);
    return { serviceId, multiplier: mult, deducted: result };
  }

  /** D4 — recipes deducted at Service Done (Oct 22 2026, Kevin: "use the recommended"). Called by the service.completed
   *  consumer for every completed service line of the ticket, inside the consumer's transaction. Idempotent on the
   *  LINE: a `service_usage` movement related to this ticket line already existing means the line was deducted (a
   *  redelivery, a replay, or the second Service Done write path reaching the same line) — nothing moves twice.
   *  Deducts only what is on hand (never negative); the shortfall is in the result. A manager corrects a wrong
   *  deduction through the ordinary stock adjustment (its own audited movement), never by editing this one. */
  async consumeRecipeForTicketLine(ctx: InvCtx, line: { ticketId: string; lineId: string; serviceId: string; quantity?: number | null }, exec: Kysely<DB> = this.need()) {
    // two deliveries of the same Service Done (two consumers, a replay racing the original) used to both pass the "already
    // deducted?" check before either wrote its movement — the line was deducted twice. One transaction-scoped lock per line.
    await sql`SELECT pg_advisory_xact_lock(hashtext(${'inv-line:' + line.lineId}))`.execute(exec);
    const done = await sql<{ n: number }>`SELECT count(*)::int AS n FROM inventory_stock_movements
      WHERE tenant_id = ${ctx.tenantId} AND movement_type = 'service_usage' AND related_type = 'ticket_line' AND related_id = ${line.lineId}`.execute(exec);
    if (Number(done.rows[0]?.n ?? 0) > 0) return { serviceId: line.serviceId, multiplier: 0, deducted: [], alreadyDeducted: true as const };
    // a service with no recipe (most of a menu) is nothing to deduct and nothing to audit
    const recipe = await sql<{ n: number }>`SELECT count(*)::int AS n FROM service_product_recipes WHERE tenant_id = ${ctx.tenantId} AND service_id = ${line.serviceId}`.execute(exec);
    if (Number(recipe.rows[0]?.n ?? 0) === 0) return { serviceId: line.serviceId, multiplier: 0, deducted: [], alreadyDeducted: false as const };
    const r = await this.consumeServiceRecipe(ctx, line.serviceId, Math.max(1, Number(line.quantity ?? 1) || 1),
      { exec, related: { type: 'ticket_line', id: line.lineId }, reason: `Service done · ticket ${line.ticketId}`, audit: 'service_recipe_consumed_at_service_done' });
    return { ...r, alreadyDeducted: false as const };
  }

  // ── Stock Alerts + Technician Product Usage mandate (Oct 29 2026) ─────────────────────────────────────────────────────
  // A technician's product use is ONE confirmed event that consumes real bottles (product-usage-core decides which, and how
  // much of each), in ONE transaction under the product's stock-row lock, with exactly ONE stock movement (a unique index
  // refuses a second) and an audit row. A double tap / retry carries the same idempotency key and gets the first result
  // back. A recorded use is never edited: a correction is a signed adjustment that gives stock back to the bottles it came
  // from (or uses more), with its own reason, actor and movement. "Last Used By" reads these events by occurred_at.

  /** Stock Alerts screen actions (acknowledge, export) are audited through the service's one audit path. */
  async recordAudit(ctx: InvCtx, action: 'inventory_alert_acknowledged' | 'inventory_stock_alerts_exported' | 'inventory_products_exported', productId: string | null, meta: Record<string, unknown>) { await this.audit(ctx, action, productId, null, meta); }

  /** The technician a session user is (technicians.user_id), at this salon. */
  private async ownTechnician(ctx: InvCtx, exec: Kysely<DB>): Promise<{ id: string; name: string } | null> {
    const r = await sql<{ id: string; name: string }>`SELECT id, coalesce(nullif(full_name, ''), trim(first_name || ' ' || coalesce(last_name, ''))) AS name
      FROM technicians WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId} AND archived_at IS NULL ORDER BY created_at LIMIT 1`.execute(exec).catch(() => ({ rows: [] as { id: string; name: string }[] }));
    return r.rows[0] ?? null;
  }

  async recordProductUsage(ctx: InvCtx, body: {
    productId?: string | null; quantity?: unknown; technicianId?: string | null; occurredAt?: string | null; unitId?: string | null;
    serviceTicketId?: string | null; note?: string | null; onBehalfReason?: string | null; source?: string | null;
  }, idempotencyKey?: string | null) {
    const db = this.need();
    if (!ctx.branchId || !ACTOR_UUID.test(ctx.branchId)) throw withCode(new InventoryError(400, 'Choose a location first.'), 'LOCATION_REQUIRED');
    const productId = String(body?.productId ?? '');
    if (!ACTOR_UUID.test(productId)) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    const qty = parseQuantity(body?.quantity);
    if (qty == null) throw withCode(new InventoryError(400, 'Enter how much was used — a positive amount with up to two decimals.'), 'USAGE_QUANTITY_INVALID');
    const key = String(idempotencyKey ?? '').trim().slice(0, 200) || null;
    const replay = async () => key ? (await sql<{ id: string; product_id: string; technician_id: string; quantity_hundredths: number }>`SELECT id, product_id, technician_id, quantity_hundredths FROM product_usage_events
      WHERE tenant_id = ${ctx.tenantId} AND idempotency_key = ${key}`.execute(db)).rows[0] ?? null : null;
    const first = await replay();
    if (first) return this.replayed(ctx, first, productId, qty);

    const prod = (await sql<{ id: string; name: string; unit_type: string | null; active: boolean; archived_at: string | null; allow_negative_stock: boolean | null }>`
      SELECT id, name, unit_type, active, archived_at, allow_negative_stock FROM inventory_products WHERE id = ${productId} AND tenant_id = ${ctx.tenantId}`.execute(db)).rows[0];
    if (!prod) throw withCode(new InventoryError(404, 'Product not found'), 'PRODUCT_NOT_FOUND');
    if (!prod.active || prod.archived_at) throw withCode(new InventoryError(409, 'This product is inactive or archived.'), 'PRODUCT_INACTIVE');
    if (!allowsFraction(prod.unit_type) && qty % HUNDREDTHS !== 0) throw withCode(new InventoryError(400, 'This product is counted in whole units only.'), 'USAGE_FRACTION_NOT_ALLOWED');

    // who used it: yourself, or — with the stock-adjust permission and a reason — another technician of this salon
    const own = await this.ownTechnician(ctx, db);
    const asked = body?.technicianId ? String(body.technicianId) : null;
    let technicianId: string; let onBehalf: string | null = null;
    if (!asked || asked === own?.id) {
      if (!own) throw withCode(new InventoryError(400, 'Choose the technician who used the product.'), 'USAGE_TECHNICIAN_REQUIRED');
      technicianId = own.id;
    } else {
      if (!hasPermission(ctx as Parameters<typeof hasPermission>[0], 'inventory.stock.adjust')) throw withCode(new InventoryError(403, 'Your role can record only your own product use.'), 'USAGE_ON_BEHALF_FORBIDDEN');
      if (!ACTOR_UUID.test(asked)) throw withCode(new InventoryError(404, 'That technician could not be found at this salon.'), 'TECHNICIAN_NOT_FOUND');
      const t = (await sql<{ id: string }>`SELECT id FROM technicians WHERE id = ${asked} AND tenant_id = ${ctx.tenantId}`.execute(db)).rows[0];
      if (!t) throw withCode(new InventoryError(404, 'That technician could not be found at this salon.'), 'TECHNICIAN_NOT_FOUND');
      onBehalf = String(body?.onBehalfReason ?? '').trim().slice(0, 500);
      if (onBehalf.length < 3) throw withCode(new InventoryError(400, 'Say why you are recording this for another technician.'), 'USAGE_ON_BEHALF_REASON_REQUIRED');
      technicianId = t.id;
    }
    // when it was used: now, or earlier (never the future; older than 31 days is a stock count, not a usage entry)
    const nowMs = Date.parse(this.clock.iso());
    const occurredMs = body?.occurredAt ? Date.parse(String(body.occurredAt)) : nowMs;
    if (!Number.isFinite(occurredMs)) throw withCode(new InventoryError(400, 'Enter how much was used — a positive amount with up to two decimals.'), 'USAGE_QUANTITY_INVALID');
    if (occurredMs > nowMs + 5 * 60_000) throw withCode(new InventoryError(400, 'The time of use cannot be in the future.'), 'USAGE_OCCURRED_IN_FUTURE');
    if (occurredMs < nowMs - 31 * 86_400_000) throw withCode(new InventoryError(400, 'Product use older than 31 days must be corrected with a stock count instead.'), 'USAGE_OCCURRED_TOO_OLD');
    const occurredAt = new Date(Math.min(occurredMs, nowMs)).toISOString();
    const source = onBehalf ? 'manager' : (['front_desk', 'technician_app', 'scan'] as const).find((x) => x === body?.source) ?? 'front_desk';
    const unitId = body?.unitId && ACTOR_UUID.test(String(body.unitId)) ? String(body.unitId) : null;
    const ticketId = body?.serviceTicketId && ACTOR_UUID.test(String(body.serviceTicketId)) ? String(body.serviceTicketId) : null;
    const note = body?.note ? String(body.note).trim().slice(0, 1000) || null : null;

    try {
      return await db.transaction().execute(async (trx) => {
        await this.lockStock(ctx, [productId], trx);
        const again = key ? (await sql<{ id: string }>`SELECT id FROM product_usage_events WHERE tenant_id = ${ctx.tenantId} AND idempotency_key = ${key}`.execute(trx)).rows[0] : null;
        if (again) return { replay: true as const, eventId: again.id };
        const bottles = (await sql<{ id: string; status: BottleStatus; estimated_remaining_percent: number | null; created_at: string }>`
          SELECT id, status, estimated_remaining_percent, created_at::text AS created_at FROM inventory_units
           WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId} AND status IN ('unopened', 'opened', 'low')
           ORDER BY created_at, id FOR UPDATE`.execute(trx)).rows.map((b): BottleRow => ({ id: b.id, status: b.status, remainingPercent: b.estimated_remaining_percent == null ? null : Number(b.estimated_remaining_percent), createdAt: String(b.created_at) }));
        const stockBefore = stockHundredths(bottles);
        const plan = allocate(bottles, qty, unitId);
        if (plan.short > 0 && !prod.allow_negative_stock) throw withCode(new InventoryError(409, 'That is more than this location has in stock. Count the stock or record a smaller amount.', { availableHundredths: stockBefore, requestedHundredths: qty }), 'USAGE_EXCEEDS_STOCK');
        const before = (await this.recompute(ctx, productId, trx)).onHand;
        for (const t of plan.takes) await this.applyBottle(ctx, t.unitId, t.toStatus, t.remainingAfter, t.fromStatus, trx);
        const after = (await this.recompute(ctx, productId, trx)).onHand;
        const ev = (await sql<{ id: string }>`INSERT INTO product_usage_events
            (tenant_id, branch_id, product_id, technician_id, quantity_hundredths, unit, occurred_at, created_by_user_id, source, status, service_ticket_id, inventory_unit_id,
             note, on_behalf_reason, idempotency_key, consumed_json, short_hundredths, stock_before_hundredths, stock_after_hundredths, bottles_before, bottles_after)
          VALUES (${ctx.tenantId}, ${ctx.branchId}, ${productId}, ${technicianId}, ${qty}, ${prod.unit_type || 'unit'}, ${occurredAt}::timestamptz, ${systemActorOf(ctx.userId).userId}, ${source}, 'confirmed', ${ticketId}, ${unitId},
             ${note}, ${onBehalf}, ${key}, ${JSON.stringify(plan.takes)}::jsonb, ${plan.short}, ${stockBefore}, ${stockBefore - qty}, ${before}, ${after})
          RETURNING id`.execute(trx)).rows[0];
        await this.move(ctx, productId, plan.takes.length === 1 ? plan.takes[0].unitId : null, 'technician_usage', before, after - before, after, note ?? undefined,
          { type: 'product_usage_event', id: ev.id }, trx, { quantityHundredths: qty, technicianId, occurredAt, source, shortHundredths: plan.short, stockBeforeHundredths: stockBefore, stockAfterHundredths: stockBefore - qty });
        await this.audit(ctx, 'inventory_product_usage_recorded', productId, null, { eventId: ev.id, technicianId, quantityHundredths: qty, occurredAt, source, onBehalf: !!onBehalf, shortHundredths: plan.short }, trx);
        return { replay: false as const, eventId: ev.id };
      }).then(async (r) => ({ ...(await this.usageEvent(ctx, r.eventId)), replay: r.replay }));
    } catch (e: any) {
      // two submissions with one key racing past the first check: the unique index keeps one; the other replays it
      if (key && (e?.code === '23505' || /uq_product_usage_events_idem/.test(String(e?.message)))) { const w = await replay(); if (w) return this.replayed(ctx, w, productId, qty); }
      throw e;
    }
  }
  private async replayed(ctx: InvCtx, prior: { id: string; product_id: string; quantity_hundredths: number }, productId: string, qty: number) {
    if (String(prior.product_id) !== productId || Number(prior.quantity_hundredths) !== qty) throw withCode(new InventoryError(422, 'This request key was already used for a different request.'), 'IDEMPOTENCY_KEY_REUSED');
    return { ...(await this.usageEvent(ctx, prior.id)), replay: true };
  }
  /** One bottle after a use / a correction: status, remaining %, and who opened / emptied it. */
  private async applyBottle(ctx: InvCtx, unitId: string, to: BottleStatus, remaining: number, from: BottleStatus, exec: Kysely<DB>) {
    const opened = from === 'unopened' && to !== 'unopened' ? sql`, opened_at = coalesce(opened_at, now()), opened_by_user_id = coalesce(opened_by_user_id, ${systemActorOf(ctx.userId).userId})` : sql``;
    const emptied = to === 'empty' ? sql`, emptied_at = now(), emptied_by_user_id = ${systemActorOf(ctx.userId).userId}` : from === 'empty' ? sql`, emptied_at = NULL, emptied_by_user_id = NULL` : sql``;
    await sql`UPDATE inventory_units SET status = ${to}, estimated_remaining_percent = ${to === 'empty' ? 0 : to === 'unopened' ? null : remaining}, updated_at = now() ${opened} ${emptied}
      WHERE id = ${unitId} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(exec);
  }

  /** A correction of a recorded use. `delta` is signed (−0.5 = half of it was not used after all; +0.25 = more was used). */
  async adjustProductUsage(ctx: InvCtx, eventId: string, body: { delta?: unknown; reason?: string | null }, idempotencyKey?: string | null) {
    const db = this.need();
    if (!ACTOR_UUID.test(String(eventId))) throw withCode(new InventoryError(404, 'That product use could not be found.'), 'USAGE_EVENT_NOT_FOUND');
    const raw = String(body?.delta ?? '').trim(); const negative = raw.startsWith('-');
    const abs = parseQuantity(negative || raw.startsWith('+') ? raw.slice(1) : raw);
    if (abs == null) throw withCode(new InventoryError(400, 'Enter how much was used — a positive amount with up to two decimals.'), 'USAGE_QUANTITY_INVALID');
    const delta = negative ? -abs : abs;
    const reason = String(body?.reason ?? '').trim().slice(0, 500);
    if (reason.length < 3) throw withCode(new InventoryError(400, 'Say why this product use is being corrected.'), 'USAGE_ADJUST_REASON_REQUIRED');
    const key = String(idempotencyKey ?? '').trim().slice(0, 200) || null;
    if (key) {
      const prior = (await sql<{ id: string; usage_event_id: string; delta_hundredths: number }>`SELECT id, usage_event_id, delta_hundredths FROM product_usage_adjustments WHERE tenant_id = ${ctx.tenantId} AND idempotency_key = ${key}`.execute(db)).rows[0];
      if (prior) {
        if (String(prior.usage_event_id) !== String(eventId) || Number(prior.delta_hundredths) !== delta) throw withCode(new InventoryError(422, 'This request key was already used for a different request.'), 'IDEMPOTENCY_KEY_REUSED');
        return { ...(await this.usageEvent(ctx, String(eventId))), replay: true };
      }
    }
    const head = (await sql<{ product_id: string }>`SELECT product_id FROM product_usage_events WHERE id = ${eventId} AND tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId}`.execute(db)).rows[0];
    if (!head) throw withCode(new InventoryError(404, 'That product use could not be found.'), 'USAGE_EVENT_NOT_FOUND');
    const productId = String(head.product_id);
    await db.transaction().execute(async (trx) => {
      await this.lockStock(ctx, [productId], trx);
      const ev = (await sql<{ quantity_hundredths: number; consumed_json: Take[]; short_hundredths: number; status: string; technician_id: string }>`SELECT quantity_hundredths, consumed_json, short_hundredths, status, technician_id
        FROM product_usage_events WHERE id = ${eventId} AND tenant_id = ${ctx.tenantId} FOR UPDATE`.execute(trx)).rows[0];
      const adjs = (await sql<{ delta_hundredths: number; restored_json: any }>`SELECT delta_hundredths, restored_json FROM product_usage_adjustments
        WHERE tenant_id = ${ctx.tenantId} AND usage_event_id = ${eventId} ORDER BY created_at, id`.execute(trx)).rows;
      const effective = Number(ev.quantity_hundredths) + adjs.reduce((n, a) => n + Number(a.delta_hundredths), 0);
      if (effective <= 0) throw withCode(new InventoryError(409, 'This product use was already fully reversed.'), 'USAGE_ALREADY_REVERSED');
      if (effective + delta < 0) throw withCode(new InventoryError(409, 'A correction cannot give back more than was used.', { effectiveHundredths: effective }), 'USAGE_ADJUST_BELOW_ZERO');
      // every take this use made (the event's, and any "used more" corrections'), what corrections already gave back
      const takes: Take[] = [...(ev.consumed_json ?? [])]; let shortLeft = Number(ev.short_hundredths); const restoredSoFar: Record<string, number> = {};
      for (const a of adjs) {
        const j = a.restored_json ?? {};
        if (Number(a.delta_hundredths) > 0) { takes.push(...(j.takes ?? [])); shortLeft += Number(j.short ?? 0); }
        else { shortLeft -= Number(j.fromShort ?? 0); for (const r of j.restores ?? []) restoredSoFar[r.unitId] = (restoredSoFar[r.unitId] ?? 0) + Number(r.hundredths); }
      }
      const bottles = (await sql<{ id: string; status: BottleStatus; estimated_remaining_percent: number | null; created_at: string }>`
        SELECT id, status, estimated_remaining_percent, created_at::text AS created_at FROM inventory_units
         WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId} ORDER BY created_at, id FOR UPDATE`.execute(trx)).rows
        .map((b): BottleRow => ({ id: b.id, status: b.status, remainingPercent: b.estimated_remaining_percent == null ? null : Number(b.estimated_remaining_percent), createdAt: String(b.created_at) }));
      const stockBefore = stockHundredths(bottles);
      const before = (await this.recompute(ctx, productId, trx)).onHand;
      let restored: Record<string, unknown>;
      if (delta < 0) {
        const plan = planRestore(takes, Math.max(0, shortLeft), restoredSoFar, -delta);
        const applied: { unitId: string; hundredths: number }[] = [];
        for (const r of plan.restores) {
          const b = bottles.find((x) => x.id === r.unitId); if (!b) continue;
          const take = takes.find((t) => t.unitId === r.unitId);
          const now = b.status === 'empty' ? 0 : remainingOf(b);
          const next = restoredStatus(b.status, now, r.hundredths, take?.fromStatus === 'unopened' && (restoredSoFar[r.unitId] ?? 0) + r.hundredths >= (take?.takenHundredths ?? 0) && (take?.remainingBefore ?? 0) >= HUNDREDTHS);
          if (!next) continue;   // a bottle sold / damaged since cannot take stock back — the correction still records the use as smaller
          await this.applyBottle(ctx, r.unitId, next.status, next.remaining, b.status, trx); applied.push(r);
        }
        restored = { fromShort: plan.fromShort, restores: applied, uncovered: plan.uncovered };
      } else {
        const product = (await sql<{ allow_negative_stock: boolean | null }>`SELECT allow_negative_stock FROM inventory_products WHERE id = ${productId} AND tenant_id = ${ctx.tenantId}`.execute(trx)).rows[0];
        const plan = allocate(bottles.filter((b) => USABLE_STATUSES.includes(b.status)), delta);
        if (plan.short > 0 && !product?.allow_negative_stock) throw withCode(new InventoryError(409, 'That is more than this location has in stock. Count the stock or record a smaller amount.', { availableHundredths: stockBefore, requestedHundredths: delta }), 'USAGE_EXCEEDS_STOCK');
        for (const t of plan.takes) await this.applyBottle(ctx, t.unitId, t.toStatus, t.remainingAfter, t.fromStatus, trx);
        restored = { takes: plan.takes, short: plan.short };
      }
      const after = (await this.recompute(ctx, productId, trx)).onHand;
      const stockAfter = stockHundredths((await sql<{ id: string; status: BottleStatus; estimated_remaining_percent: number | null; created_at: string }>`SELECT id, status, estimated_remaining_percent, created_at::text AS created_at FROM inventory_units
        WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${productId}`.execute(trx)).rows.map((b): BottleRow => ({ id: b.id, status: b.status, remainingPercent: b.estimated_remaining_percent == null ? null : Number(b.estimated_remaining_percent), createdAt: String(b.created_at) })));
      const adj = (await sql<{ id: string }>`INSERT INTO product_usage_adjustments (tenant_id, branch_id, usage_event_id, delta_hundredths, reason, actor_user_id, idempotency_key, restored_json, stock_before_hundredths, stock_after_hundredths)
        VALUES (${ctx.tenantId}, ${ctx.branchId}, ${eventId}, ${delta}, ${reason}, ${systemActorOf(ctx.userId).userId}, ${key}, ${JSON.stringify(restored)}::jsonb, ${stockBefore}, ${stockAfter}) RETURNING id`.execute(trx)).rows[0];
      if (effective + delta === 0) {
        const rev = (await sql<{ id: string }>`UPDATE product_usage_events SET status = 'reversed' WHERE id = ${eventId} AND tenant_id = ${ctx.tenantId} AND ${canMoveToSql(PRODUCT_USAGE_EVENT, 'reversed')} RETURNING id`.execute(trx)).rows[0];
        if (!rev) throw withCode(new InventoryError(409, 'This product use was already fully reversed.'), 'USAGE_ALREADY_REVERSED');
      }
      await this.move(ctx, productId, null, 'usage_correction', before, after - before, after, reason, { type: 'product_usage_adjustment', id: adj.id }, trx,
        { usageEventId: eventId, deltaHundredths: delta, technicianId: ev.technician_id, effectiveHundredths: effective + delta, stockBeforeHundredths: stockBefore, stockAfterHundredths: stockAfter });
      await this.audit(ctx, 'inventory_product_usage_adjusted', productId, null, { eventId, adjustmentId: adj.id, deltaHundredths: delta, reason, effectiveHundredths: effective + delta }, trx);
    });
    return { ...(await this.usageEvent(ctx, String(eventId))), replay: false };
  }

  /** One usage event as the screens show it (effective quantity after corrections, the corrections themselves). */
  async usageEvent(ctx: InvCtx, eventId: string) {
    const db = this.need();
    const e = (await sql<any>`SELECT e.id, e.product_id, p.name AS product_name, p.sku, e.technician_id,
        coalesce(nullif(t.full_name, ''), trim(t.first_name || ' ' || coalesce(t.last_name, ''))) AS technician_name,
        e.quantity_hundredths, e.unit, e.occurred_at, e.created_at, e.created_by_user_id, e.source, e.status, e.service_ticket_id, e.note, e.on_behalf_reason,
        e.short_hundredths, e.stock_before_hundredths, e.stock_after_hundredths, e.bottles_before, e.bottles_after,
        e.quantity_hundredths + coalesce((SELECT sum(a.delta_hundredths) FROM product_usage_adjustments a WHERE a.tenant_id = e.tenant_id AND a.usage_event_id = e.id), 0)::int AS effective_hundredths
      FROM product_usage_events e JOIN inventory_products p ON p.id = e.product_id AND p.tenant_id = e.tenant_id
      LEFT JOIN technicians t ON t.id = e.technician_id AND t.tenant_id = e.tenant_id
      WHERE e.id = ${eventId} AND e.tenant_id = ${ctx.tenantId} AND e.branch_id = ${ctx.branchId}`.execute(db)).rows[0];
    if (!e) throw withCode(new InventoryError(404, 'That product use could not be found.'), 'USAGE_EVENT_NOT_FOUND');
    const adjustments = (await sql<any>`SELECT id, delta_hundredths, reason, actor_user_id, created_at, stock_before_hundredths, stock_after_hundredths FROM product_usage_adjustments
      WHERE tenant_id = ${ctx.tenantId} AND usage_event_id = ${eventId} ORDER BY created_at, id`.execute(db)).rows;
    const stock = (await sql<{ quantity_on_hand: number }>`SELECT quantity_on_hand FROM inventory_location_stock WHERE tenant_id = ${ctx.tenantId} AND branch_id = ${ctx.branchId} AND product_id = ${e.product_id}`.execute(db)).rows[0];
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString());
    return {
      event: {
        id: String(e.id), productId: String(e.product_id), productName: e.product_name, sku: e.sku ?? null, technicianId: String(e.technician_id), technicianName: e.technician_name ?? null,
        quantity: formatQuantity(Number(e.quantity_hundredths)), quantityHundredths: Number(e.quantity_hundredths), effectiveQuantity: formatQuantity(Number(e.effective_hundredths)), effectiveHundredths: Number(e.effective_hundredths),
        unit: e.unit, occurredAt: iso(e.occurred_at), recordedAt: iso(e.created_at), recordedByUserId: e.created_by_user_id ?? null, source: e.source, status: e.status,
        serviceTicketId: e.service_ticket_id ?? null, note: e.note ?? null, onBehalfReason: e.on_behalf_reason ?? null, shortHundredths: Number(e.short_hundredths),
        stockBefore: formatQuantity(Number(e.stock_before_hundredths)), stockAfter: formatQuantity(Number(e.stock_after_hundredths)), bottlesBefore: Number(e.bottles_before), bottlesAfter: Number(e.bottles_after),
        adjustments: adjustments.map((a: any) => ({ id: String(a.id), delta: formatQuantity(Number(a.delta_hundredths)), deltaHundredths: Number(a.delta_hundredths), reason: a.reason, actorUserId: a.actor_user_id ?? null, at: iso(a.created_at),
          stockBefore: formatQuantity(Number(a.stock_before_hundredths)), stockAfter: formatQuantity(Number(a.stock_after_hundredths)) })),
      },
      onHand: Number(stock?.quantity_on_hand ?? 0),
    };
  }
}
