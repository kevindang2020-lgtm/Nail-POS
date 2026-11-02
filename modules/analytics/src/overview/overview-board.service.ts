// overview-board.service.ts — supplements the canonical /pos/overview/state with the live Overview modules the rich
// state doesn't carry: arrivals, live tech queue, the service-flow sublists, Customer Communications (reminders + the
// Unified Inbox's messages), Customer Retention, Inventory Alerts — each the top rows + its total. Composition only — it
// does NOT recompute KPIs/queue/serving/checkout (those stay owned by OverviewService). Tenant+branch scoped,
// raw SQL, each block fail-soft to a safe empty shape so a missing table never breaks Overview.
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, tenantTimeZone, safeZoneName, type DB } from '@aipowersalon/database';
import { OVERVIEW_TOP_ROWS, OVERVIEW_WAITING_STATUSES, OVERVIEW_CLOSED_TICKET_STATUSES, liveMinutesLeft, inventoryAlertStatus, inventoryAlertOrder } from './overview-floor';
import { dayStartMs } from '@aipowersalon/date-time';
import { VISIT_TICKET_STATUSES, RETURNING_MIN_VISITS, INACTIVE_DAYS } from '@aipowersalon/customers';

export interface BoardCtx { tenantId: string; branchId: string; /** communications.view — the Messages tab is the Unified Inbox's data */ canViewMessages?: boolean; }

export interface ReminderRow { customerName: string; service: string; whenLabel: string; channel: string; status: string; }
export interface OverviewArrivalRow { startTime: string; customerName: string; serviceName: string; status: string; waitMinutes: number | null; }
export interface OverviewTechRow { technicianName: string; serviceName: string; customerName: string; minutesLeft: number | null; status: string; }
export interface OverviewAssignRow { customerName: string; serviceName: string; requestedTech: string; }
export interface OverviewCheckoutRow { customerName: string; amountCents: number; }
export interface OverviewMessageRow { customerName: string; preview: string; unread: boolean; at: string | null; channel: string; }
/** Overview mandate §11–§15, §21: every list is the top rows; `totals` is the whole population, so a card says "+N more"
 *  instead of growing (and the screen never counts the rows it happened to receive). */
export interface OverviewBoardTotals { arrivals: number; liveTechQueue: number; readyForAssignment: number; readyForCheckout: number; inventoryAlerts: number; reminders: number; messages: number; unreadMessages: number }
export interface OverviewBoard {
  // `missedCalls` is declared but ALWAYS EMPTY, and honestly so (Jul 27, 2026 audit): NOTHING records a missed call today.
  // voice_call_outcomes deliberately stores no caller number (metadata only, consent/retention-gated), and the voice
  // pipeline never opens a communication_threads row with channel='call'/status='missed'. Until a caller-number capture
  // decision is made, this list cannot populate — so the Overview must NOT render it as a feed that looks live.
  // `messages` (Overview mandate, Oct 28 2026): the Unified Inbox's own threads (communication_threads — the guest's last
  // message, unread first), for a user who may read the inbox (`communications.view`); `messagesAvailable` false otherwise.
  communications: { reminders: ReminderRow[]; messages: OverviewMessageRow[]; missedCalls: { from: string; at: string; status: string }[]; missedCallsAvailable: boolean; messagesAvailable: boolean };
  customerRetention: { returningPercent: number; newPercent: number; inactivePercent: number } | null;
  inventoryAlerts: { product: string; stock: number; reorderLevel: number; status: 'low' | 'critical' | 'out' }[];
  // Live operational feeds (front-desk arrival queue + technicians currently serving + service-flow sublists). Sourced
  // from check-in / serving / queue; fail-soft to [] (the screen shows the card's empty state — it no longer re-derives
  // these lists from appointment statuses in the browser).
  arrivals: OverviewArrivalRow[];
  liveTechQueue: OverviewTechRow[];
  readyForAssignment: OverviewAssignRow[];
  readyForCheckout: OverviewCheckoutRow[];
  totals: OverviewBoardTotals;
  lastUpdatedAt: string;
}
/** a raw SQL row (the columns are named in the statement) */
type Row = Record<string, any>;
type Counted<T> = { rows: T[]; total: number };
const none = <T,>(): Counted<T> => ({ rows: [], total: 0 });
/** `count(*) over ()` rides on every row — one query gives the top rows AND the population */
const counted = <T,>(rows: any[]): Counted<T> => ({ rows: rows.map(({ total_count: _t, ...r }) => r as T), total: rows.length ? Number(rows[0].total_count || 0) : 0 });

export class OverviewBoardService {
  constructor(private readonly db: Kysely<DB> | null) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;

  async getBoard(ctx: BoardCtx): Promise<OverviewBoard> {
    // the branch's day (the salon's for an all-branches view) — arrivals and reminders are "today" in the salon's zone
    const tz = this.db ? safeZoneName(ctx.branchId ? await branchTimeZone(this.db, ctx.tenantId, ctx.branchId) : await tenantTimeZone(this.db, ctx.tenantId)) : 'America/New_York';
    const since = new Date(dayStartMs(tz, new Date(this.now())));
    const [reminders, messages, customerRetention, inventory, arrivals, liveTechQueue, readyForAssignment, readyForCheckout] = await Promise.all([
      this.reminders(ctx, since, tz), this.messages(ctx), this.retention(ctx), this.inventory(ctx), this.arrivals(ctx, since), this.liveTechQueue(ctx), this.readyForAssignment(ctx), this.readyForCheckout(ctx),
    ]);
    return {
      communications: { reminders: reminders.rows, messages: messages.rows, missedCalls: [], missedCallsAvailable: false, messagesAvailable: !!ctx.canViewMessages && !!this.db },
      customerRetention, inventoryAlerts: inventory.rows, arrivals: arrivals.rows, liveTechQueue: liveTechQueue.rows, readyForAssignment: readyForAssignment.rows, readyForCheckout: readyForCheckout.rows,
      totals: { arrivals: arrivals.total, liveTechQueue: liveTechQueue.total, readyForAssignment: readyForAssignment.total, readyForCheckout: readyForCheckout.total, inventoryAlerts: inventory.total, reminders: reminders.total, messages: messages.total, unreadMessages: (messages as Counted<OverviewMessageRow> & { unread?: number }).unread ?? 0 },
      lastUpdatedAt: new Date(this.now()).toISOString(),
    };
  }

  // Waiting or called guests with no technician (the Customer Queue's "Ready for Assignment"); fail-soft.
  private async readyForAssignment(ctx: BoardCtx): Promise<Counted<OverviewAssignRow>> {
    if (!this.db) return none();
    try {
      const branchCond = ctx.branchId ? sql`AND (q.branch_id = ${ctx.branchId} OR q.branch_id IS NULL)` : sql``;
      const r = await sql<any>`
        SELECT q.customer_name AS "customerName",
               COALESCE(q.requested_services->0->>'serviceName', '') AS "serviceName",
               COALESCE(t.full_name, 'Any Available') AS "requestedTech", count(*) OVER () AS total_count
        FROM pos_queue_items q
        LEFT JOIN technicians t ON t.id = q.requested_technician_id AND t.tenant_id = q.tenant_id
        WHERE q.tenant_id = ${ctx.tenantId} ${branchCond} AND q.status IN ('waiting','called') AND q.assigned_technician_id IS NULL
        ORDER BY q.checked_in_at ASC NULLS LAST, q.id LIMIT ${OVERVIEW_TOP_ROWS.readyForAssignment}`.execute(this.db);
      return counted(r.rows);
    } catch { return none(); }
  }

  // Tickets at checkout now (the Checkout board's open tickets: not paid, not closed, not removed); fail-soft.
  private async readyForCheckout(ctx: BoardCtx): Promise<Counted<OverviewCheckoutRow>> {
    if (!this.db) return none();
    try {
      const branchCond = ctx.branchId ? sql`AND (t.branch_id = ${ctx.branchId} OR t.branch_id IS NULL)` : sql``;
      const r = await sql<any>`
        SELECT COALESCE(c.full_name, '') AS "customerName", COALESCE(t.locked_total_cents, t.total_cents, 0)::int AS "amountCents", count(*) OVER () AS total_count
        FROM tickets t
        LEFT JOIN customers c ON c.id = t.customer_id AND c.tenant_id = t.tenant_id
        WHERE t.tenant_id = ${ctx.tenantId} ${branchCond} AND t.ready_checkout_at IS NOT NULL AND t.paid_at IS NULL AND t.removed_at IS NULL
          AND t.status NOT IN (${sql.join(OVERVIEW_CLOSED_TICKET_STATUSES.map((x) => sql`${x}`))})
        ORDER BY t.ready_checkout_at ASC, t.id LIMIT ${OVERVIEW_TOP_ROWS.readyForCheckout}`.execute(this.db);
      return counted(r.rows);
    } catch { return none(); }
  }

  // Live front-desk arrival queue (today, this branch) — checked-in guests still in the queue, newest first; fail-soft.
  private async arrivals(ctx: BoardCtx, since: Date): Promise<Counted<OverviewArrivalRow>> {
    if (!this.db) return none();
    try {
      const branchCond = ctx.branchId ? sql`AND (branch_id = ${ctx.branchId} OR branch_id IS NULL)` : sql``;
      // today = since the branch's midnight (Oct 6 2026 — was the UTC date: from 8 pm in New York the arrivals list emptied)
      const r = await sql<any>`
        SELECT checked_in_at AS "startTime", customer_name AS "customerName",
               COALESCE(requested_services->0->>'serviceName', '') AS "serviceName", status,
               GREATEST(0, EXTRACT(EPOCH FROM (now() - checked_in_at))/60)::int AS "waitMinutes", count(*) OVER () AS total_count
        FROM pos_queue_items
        WHERE tenant_id = ${ctx.tenantId} ${branchCond}
          AND checked_in_at IS NOT NULL
          AND checked_in_at >= ${since}
          AND status IN (${sql.join(OVERVIEW_WAITING_STATUSES.map((x) => sql`${x}`))})
        ORDER BY checked_in_at DESC, id LIMIT ${OVERVIEW_TOP_ROWS.arrivals}`.execute(this.db);
      return counted(r.rows);
    } catch { return none(); }
  }

  // Technicians serving now — the Serving floor's tickets (a service started from the Tech Queue has no queue row, so the
  // queue's in_service rows missed it), with the visit's own line durations → minutes left (it was always NULL); fail-soft.
  private async liveTechQueue(ctx: BoardCtx): Promise<Counted<OverviewTechRow>> {
    if (!this.db) return none();
    try {
      const branchCond = ctx.branchId ? sql`AND (k.branch_id = ${ctx.branchId} OR k.branch_id IS NULL)` : sql``;
      const r = await sql<any>`
        SELECT t.full_name AS "technicianName",
               COALESCE((SELECT l.service_name_snapshot FROM ticket_service_lines l WHERE l.ticket_id = k.id AND l.tenant_id = k.tenant_id AND l.removed_at IS NULL ORDER BY l.created_at, l.id LIMIT 1), '') AS "serviceName",
               COALESCE(c.full_name, q.customer_name, '') AS "customerName",
               (SELECT COALESCE(sum(l.duration_minutes_snapshot), 0) FROM ticket_service_lines l WHERE l.ticket_id = k.id AND l.tenant_id = k.tenant_id AND l.removed_at IS NULL)::int AS duration,
               k.serving_started_at AS started, COALESCE(k.accumulated_paused_ms, 0)::bigint AS paused, (k.serving_paused_at IS NOT NULL) AS is_paused,
               count(*) OVER () AS total_count
        FROM tickets k
        JOIN technicians t ON t.id = k.primary_technician_id AND t.tenant_id = k.tenant_id
        LEFT JOIN customers c ON c.id = k.customer_id AND c.tenant_id = k.tenant_id
        LEFT JOIN pos_queue_items q ON q.id = k.queue_item_id AND q.tenant_id = k.tenant_id
        WHERE k.tenant_id = ${ctx.tenantId} ${branchCond} AND k.status = 'serving' AND k.removed_at IS NULL
          AND k.serving_started_at IS NOT NULL AND k.service_done_at IS NULL
        ORDER BY k.serving_started_at ASC, k.id LIMIT ${OVERVIEW_TOP_ROWS.liveTechQueue}`.execute(this.db);
      const nowMs = this.now();
      const rows = (r.rows as Row[]).map((x) => ({ technicianName: x.technicianName, serviceName: x.serviceName, customerName: x.customerName, total_count: x.total_count,
        minutesLeft: liveMinutesLeft(x.started ? new Date(x.started).getTime() : null, Number(x.paused || 0), Number(x.duration || 0), nowMs), status: x.is_paused ? 'paused' : 'in_service' }));
      return counted(rows);
    } catch { return none(); }
  }

  // Today's reminder attempts for THIS branch's appointments (it read every branch of the salon, and printed the time in
  // the database server's zone); fail-soft.
  private async reminders(ctx: BoardCtx, since: Date, tz: string): Promise<Counted<ReminderRow>> {
    if (!this.db) return none();
    try {
      const branchCond = ctx.branchId ? sql`AND (a.branch_id = ${ctx.branchId} OR a.branch_id IS NULL)` : sql``;
      const r = await sql<any>`
        SELECT a.customer_name AS "customerName",
               COALESCE(a.services->0->>'serviceName', a.services->>0, '') AS service,
               to_char(ra.created_at AT TIME ZONE ${tz}, 'Mon DD, HH12:MI AM') AS "whenLabel",
               ra.channel, ra.status, count(*) OVER () AS total_count
        FROM appointment_reminder_attempts ra
        JOIN pos_tech_appointments a ON a.id = ra.appointment_id AND a.tenant_id = ra.tenant_id
        WHERE ra.tenant_id = ${ctx.tenantId} ${branchCond} AND ra.created_at >= ${since}
        ORDER BY ra.created_at DESC, ra.id LIMIT ${OVERVIEW_TOP_ROWS.reminders}`.execute(this.db);
      return counted(r.rows);
    } catch { return none(); }
  }

  // The Unified Inbox's threads for this branch — unread first, then the latest message (the tab was always empty).
  private async messages(ctx: BoardCtx): Promise<Counted<OverviewMessageRow> & { unread: number }> {
    if (!this.db || !ctx.canViewMessages) return { ...none<OverviewMessageRow>(), unread: 0 };
    try {
      const branchCond = ctx.branchId ? sql`AND (branch_id = ${ctx.branchId} OR branch_id IS NULL)` : sql``;
      const r = await sql<any>`
        SELECT COALESCE(customer_name, customer_contact, '') AS "customerName", COALESCE(last_message_preview, '') AS preview,
               (COALESCE(unread_count, 0) > 0) AS unread, last_message_at AS at, channel,
               count(*) OVER () AS total_count, count(*) FILTER (WHERE COALESCE(unread_count, 0) > 0) OVER () AS unread_count_all
        FROM communication_threads
        WHERE tenant_id = ${ctx.tenantId} ${branchCond} AND COALESCE(status, 'open') NOT IN ('archived', 'closed', 'spam')
        ORDER BY (COALESCE(unread_count, 0) > 0) DESC, last_message_at DESC NULLS LAST, id LIMIT ${OVERVIEW_TOP_ROWS.messages}`.execute(this.db);
      const rows = r.rows as Row[];
      return { ...counted<OverviewMessageRow>(rows.map(({ unread_count_all: _u, ...x }) => ({ ...x, at: x.at ? new Date(x.at).toISOString() : null }))), unread: rows.length ? Number(rows[0].unread_count_all || 0) : 0 };
    } catch { return { ...none<OverviewMessageRow>(), unread: 0 }; }
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

  private async inventory(ctx: BoardCtx): Promise<Counted<OverviewBoard['inventoryAlerts'][number]>> {
    if (!this.db) return none();
    try {
      // Canonical source: the Inventory Management system (inventory_products + per-branch inventory_location_stock),
      // NOT the legacy `products`/`inventory_items` tables. The branch's reorder / critical overrides win (they were
      // ignored), archived / inactive products never alert, and the severity is Inventory's own stockStatus. The card shows
      // the most urgent rows; `total` is every product at or below its reorder point (100 low items = a count, not 100 rows).
      const branchJoin = ctx.branchId ? sql`AND s.branch_id = ${ctx.branchId}` : sql``;
      const r = await sql<any>`
        WITH x AS (
          SELECT p.name AS product, coalesce(sum(s.quantity_on_hand), 0)::numeric AS stock,
                 coalesce(max(s.reorder_level_override), p.reorder_level, 0)::numeric AS reorder_level,
                 coalesce(max(s.critical_level_override), p.critical_level)::numeric AS critical_level
          FROM inventory_products p
          LEFT JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id ${branchJoin}
          WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL AND p.active IS NOT FALSE
          GROUP BY p.id, p.name, p.reorder_level, p.critical_level
        )
        SELECT product, stock, reorder_level AS "reorderLevel", critical_level AS "criticalLevel", count(*) OVER () AS total_count
        FROM x WHERE reorder_level > 0 AND stock <= reorder_level
        ORDER BY (stock <= 0) DESC, stock / NULLIF(reorder_level, 0) ASC, product LIMIT ${OVERVIEW_TOP_ROWS.inventoryAlerts * 3}`.execute(this.db);
      const rows = (r.rows as Row[]).map((x) => {
        const stock = Number(x.stock || 0); const reorderLevel = Number(x.reorderLevel || 0); const crit = x.criticalLevel == null ? null : Number(x.criticalLevel);
        return { product: String(x.product), stock, reorderLevel, status: (inventoryAlertStatus(stock, reorderLevel, crit) || 'low') as 'low' | 'critical' | 'out', total_count: x.total_count };
      }).sort(inventoryAlertOrder).slice(0, OVERVIEW_TOP_ROWS.inventoryAlerts);
      return counted(rows);
    } catch { return none(); }
  }
}
