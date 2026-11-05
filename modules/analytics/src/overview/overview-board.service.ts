// overview-board.service.ts — supplements the canonical /pos/overview/state with the three Overview modules the
// rich state doesn't carry: Customer Communications, Customer Retention, Inventory Alerts. Composition only — it
// does NOT recompute KPIs/queue/serving/checkout (those stay owned by OverviewService). Tenant+branch scoped,
// raw SQL, each block fail-soft to a safe empty shape so a missing table never breaks Overview.
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, tenantTimeZone, type DB } from '@aipowersalon/database';
import { dayStartMs } from '@aipowersalon/date-time';
import { VISIT_TICKET_STATUSES, RETURNING_MIN_VISITS, INACTIVE_DAYS } from '@aipowersalon/customers';

export interface BoardCtx { tenantId: string; branchId: string; }

export interface ReminderRow { customerName: string; service: string; whenLabel: string; channel: string; status: string; }
export interface OverviewArrivalRow { startTime: string; customerName: string; serviceName: string; status: string; waitMinutes: number | null; }
export interface OverviewTechRow { technicianName: string; serviceName: string; customerName: string; minutesLeft: number | null; status: string; }
export interface OverviewAssignRow { customerName: string; serviceName: string; requestedTech: string; }
export interface OverviewCheckoutRow { customerName: string; amountCents: number; }
export interface OverviewBoard {
  // `messages` and `missedCalls` are declared but ALWAYS EMPTY, and honestly so (Jul 27, 2026 audit):
  //   • messages    — the Unified Inbox owns guest messaging; the Overview never sourced it.
  //   • missedCalls — NOTHING records a missed call today. voice_call_outcomes deliberately stores no caller
  //     number (metadata only, consent/retention-gated), and the voice pipeline never opens a
  //     communication_threads row with channel='call'/status='missed'. Until a caller-number capture decision
  //     is made, this list cannot populate — so the Overview must NOT render it as a feed that looks live.
  communications: { reminders: ReminderRow[]; messages: { customerName: string; preview: string; unread: boolean }[]; missedCalls: { from: string; at: string; status: string }[]; missedCallsAvailable: boolean };
  customerRetention: { returningPercent: number; newPercent: number; inactivePercent: number } | null;
  inventoryAlerts: { product: string; stock: number; reorderLevel: number; status: 'low' | 'critical' | 'out' }[];
  // Live operational feeds (front-desk arrival queue + technicians currently serving + service-flow sublists). Sourced
  // from check-in / serving / queue; fail-soft to [] so the Overview screen falls back to its schedulePreview projection.
  arrivals: OverviewArrivalRow[];
  liveTechQueue: OverviewTechRow[];
  readyForAssignment: OverviewAssignRow[];
  readyForCheckout: OverviewCheckoutRow[];
  lastUpdatedAt: string;
}

export class OverviewBoardService {
  constructor(private readonly db: Kysely<DB> | null) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;

  async getBoard(ctx: BoardCtx): Promise<OverviewBoard> {
    const [communications, customerRetention, inventoryAlerts, arrivals, liveTechQueue, readyForAssignment, readyForCheckout] = await Promise.all([
      this.communications(ctx), this.retention(ctx), this.inventory(ctx), this.arrivals(ctx), this.liveTechQueue(ctx), this.readyForAssignment(ctx), this.readyForCheckout(ctx),
    ]);
    return { communications, customerRetention, inventoryAlerts, arrivals, liveTechQueue, readyForAssignment, readyForCheckout, lastUpdatedAt: new Date().toISOString() };
  }

  // Checked-in guests awaiting technician assignment (Any Available); fail-soft to [].
  private async readyForAssignment(ctx: BoardCtx): Promise<OverviewAssignRow[]> {
    if (!this.db) return [];
    try {
      const branchCond = ctx.branchId ? sql`AND (q.branch_id = ${ctx.branchId} OR q.branch_id IS NULL)` : sql``;
      const r = await sql<any>`
        SELECT q.customer_name AS "customerName",
               COALESCE(q.requested_services->0->>'serviceName', '') AS "serviceName",
               COALESCE(t.full_name, 'Any Available') AS "requestedTech"
        FROM pos_queue_items q
        LEFT JOIN technicians t ON t.id = q.requested_technician_id AND t.tenant_id = q.tenant_id
        WHERE q.tenant_id = ${ctx.tenantId} ${branchCond} AND q.status IN ('waiting','ready_for_tech') AND q.assigned_technician_id IS NULL
        ORDER BY q.created_at ASC LIMIT 5`.execute(this.db);
      return r.rows as OverviewAssignRow[];
    } catch { return []; }
  }

  // Completed tickets awaiting payment (Service Done → Checkout); fail-soft to [].
  private async readyForCheckout(ctx: BoardCtx): Promise<OverviewCheckoutRow[]> {
    if (!this.db) return [];
    try {
      const branchCond = ctx.branchId ? sql`AND (t.branch_id = ${ctx.branchId} OR t.branch_id IS NULL)` : sql``;
      const r = await sql<any>`
        SELECT COALESCE(c.full_name, '') AS "customerName", t.total_cents AS "amountCents"
        FROM tickets t
        LEFT JOIN customers c ON c.id = t.customer_id AND c.tenant_id = t.tenant_id
        WHERE t.tenant_id = ${ctx.tenantId} ${branchCond} AND t.ready_checkout_at IS NOT NULL AND t.paid_at IS NULL
        ORDER BY t.ready_checkout_at ASC LIMIT 5`.execute(this.db);
      return r.rows as OverviewCheckoutRow[];
    } catch { return []; }
  }

  // Live front-desk arrival queue (today, this branch) — checked-in / waiting / arriving guests with their wait time.
  // Reads the check-in feed; fail-soft to [] so the Overview screen falls back to its schedulePreview projection.
  private async arrivals(ctx: BoardCtx): Promise<OverviewArrivalRow[]> {
    if (!this.db) return [];
    try {
      const branchCond = ctx.branchId ? sql`AND (branch_id = ${ctx.branchId} OR branch_id IS NULL)` : sql``;
      // today = since the branch's midnight (Oct 6 2026 — was the UTC date: from 8 pm in New York the arrivals list emptied)
      const since = new Date(dayStartMs(ctx.branchId ? await branchTimeZone(this.db, ctx.tenantId, ctx.branchId) : await tenantTimeZone(this.db, ctx.tenantId), new Date(this.now())));
      const r = await sql<any>`
        SELECT checked_in_at AS "startTime", customer_name AS "customerName",
               COALESCE(requested_services->0->>'serviceName', '') AS "serviceName", status,
               GREATEST(0, EXTRACT(EPOCH FROM (now() - checked_in_at))/60)::int AS "waitMinutes"
        FROM pos_queue_items
        WHERE tenant_id = ${ctx.tenantId} ${branchCond}
          AND checked_in_at IS NOT NULL
          AND checked_in_at >= ${since}
          AND status IN ('waiting','called','assigned','ready_for_tech')
        ORDER BY checked_in_at DESC LIMIT 7`.execute(this.db);
      return r.rows as OverviewArrivalRow[];
    } catch { return []; }
  }

  // Technicians currently serving (live), with the in-progress service, guest, and estimated minutes left.
  private async liveTechQueue(ctx: BoardCtx): Promise<OverviewTechRow[]> {
    if (!this.db) return [];
    try {
      const branchCond = ctx.branchId ? sql`AND (q.branch_id = ${ctx.branchId} OR q.branch_id IS NULL)` : sql``;
      const r = await sql<any>`
        SELECT t.full_name AS "technicianName",
               COALESCE(q.requested_services->0->>'serviceName', '') AS "serviceName",
               q.customer_name AS "customerName",
               NULL::int AS "minutesLeft", q.status
        FROM pos_queue_items q JOIN technicians t ON t.id = q.assigned_technician_id AND t.tenant_id = q.tenant_id
        WHERE q.tenant_id = ${ctx.tenantId} ${branchCond} AND q.status = 'in_service' AND q.assigned_technician_id IS NOT NULL
        ORDER BY q.started_at ASC LIMIT 5`.execute(this.db);
      return r.rows as OverviewTechRow[];
    } catch { return []; }
  }

  private async communications(ctx: BoardCtx): Promise<OverviewBoard['communications']> {
    const empty = { reminders: [] as ReminderRow[], messages: [], missedCalls: [], missedCallsAvailable: false };
    if (!this.db) return empty;
    try {
      // Reminder attempts today from the reminders module, joined to the appointment for guest + service.
      const r = await sql<any>`
        SELECT a.customer_name AS "customerName",
               COALESCE(a.services->0->>'serviceName', a.services->>0, '') AS service,
               to_char(ra.created_at, 'Mon DD, HH12:MI AM') AS "whenLabel",
               ra.channel, ra.status
        FROM appointment_reminder_attempts ra
        JOIN pos_tech_appointments a ON a.id = ra.appointment_id AND a.tenant_id = ra.tenant_id
        WHERE ra.tenant_id = ${ctx.tenantId}
        ORDER BY ra.created_at DESC LIMIT 8`.execute(this.db);
      return { ...empty, reminders: r.rows as ReminderRow[] };
    } catch { return empty; }
  }

  private async retention(ctx: BoardCtx): Promise<OverviewBoard['customerRetention']> {
    if (!this.db) return null;
    try {
      // Same definitions as the Customers page (shared customer-segments): a "visit" is a closed/paid ticket;
      // returning = >=RETURNING_MIN_VISITS visits, inactive = no visit in INACTIVE_DAYS days, new = a single recent
      // visit. Tenant + branch scoped (the Customers page scopes the same way). Clean 3-way partition.
      const branchCond = ctx.branchId ? sql`AND (t.branch_id = ${ctx.branchId} OR t.branch_id IS NULL)` : sql``;
      const r = await sql<{ returning: number; fresh: number; inactive: number }>`
        WITH c AS (
          SELECT t.customer_id,
                 count(*) AS visits,
                 max(t.created_at) AS last_visit
          FROM tickets t
          WHERE t.tenant_id = ${ctx.tenantId}
            ${branchCond}
            AND t.customer_id IS NOT NULL
            AND t.status IN (${sql.join(VISIT_TICKET_STATUSES.map((s) => sql`${s}`))})
          GROUP BY t.customer_id
        )
        SELECT
          count(*) FILTER (WHERE last_visit >= now() - (${INACTIVE_DAYS} * interval '1 day') AND visits >= ${RETURNING_MIN_VISITS})::int AS returning,
          count(*) FILTER (WHERE last_visit >= now() - (${INACTIVE_DAYS} * interval '1 day') AND visits <  ${RETURNING_MIN_VISITS})::int AS fresh,
          count(*) FILTER (WHERE last_visit <  now() - (${INACTIVE_DAYS} * interval '1 day'))::int AS inactive
        FROM c`.execute(this.db);
      const row = r.rows[0]; const total = (row?.returning || 0) + (row?.fresh || 0) + (row?.inactive || 0);
      if (!row || total === 0) return null;
      const pct = (n: number) => Math.round((n / total) * 1000) / 10;
      return { returningPercent: pct(row.returning), newPercent: pct(row.fresh), inactivePercent: pct(row.inactive) };
    } catch { return null; }
  }

  private async inventory(ctx: BoardCtx): Promise<OverviewBoard['inventoryAlerts']> {
    if (!this.db) return [];
    try {
      // Canonical source: the Inventory Management system (inventory_products + per-branch inventory_location_stock),
      // NOT the legacy `products`/`inventory_items` tables. Stock is per-branch (UNIQUE branch_id+product_id ⇒ ≤1 row
      // per product after the join), and only products with a configured reorder_level alert. Same low/critical/out
      // thresholds as inventory-core.stockStatus (critical at ≤ ceil(reorder/2)).
      const r = await sql<any>`
        SELECT p.name AS product,
               coalesce(s.quantity_on_hand, 0) AS stock,
               p.reorder_level AS "reorderLevel"
        FROM inventory_products p
        LEFT JOIN inventory_location_stock s
          ON s.product_id = p.id AND s.tenant_id = p.tenant_id AND s.branch_id = ${ctx.branchId}
        WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL
          AND p.reorder_level > 0 AND coalesce(s.quantity_on_hand, 0) <= p.reorder_level
        ORDER BY coalesce(s.quantity_on_hand, 0) ASC LIMIT 8`.execute(this.db);
      return r.rows.map((x: any) => {
        const stock = Number(x.stock || 0); const reorderLevel = Number(x.reorderLevel || 0);
        return {
          product: x.product, stock, reorderLevel,
          status: (stock <= 0 ? 'out' : stock <= Math.ceil(reorderLevel / 2) ? 'critical' : 'low') as 'low' | 'critical' | 'out',
        };
      });
    } catch { return []; }
  }
}
