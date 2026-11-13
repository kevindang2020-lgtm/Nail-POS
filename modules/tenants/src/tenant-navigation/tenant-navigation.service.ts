// tenant-navigation.service.ts — sidebar support data, tenant/branch-scoped. Raw SQL, each count fail-soft to 0
// so a missing table never breaks the sidebar. Source of truth for role/permission/feature/AI/subscription gating.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { openAlertCount } from '@aipowersalon/inventory';
import { logException } from '@aipowersalon/observability';
import type { BadgeSyncMonitor, BadgeSyncRecorded, StaffAlertList, StaffAlertMarkReadResponse } from '@aipowersalon/api-contracts/tenant';
import { badgeSyncMonitor, listStaffAlerts, markStaffAlertsRead, recordBadgeSync, unreadAlertCount, StaffAlertReadError } from './staff-alert-reads';

/** userId / sessionId: the verified session's person and session row (extras round 9 — per-person alert read state). */
export interface NavCtx { tenantId: string; branchId: string; role: string; permissions: string[]; userId?: string; sessionId?: string | null; }

/** One Help Center KPI: a real numeric `value`, or `null` with `connected:false` when no canonical
 * source exists yet. The frontend renders the number when connected and an honest "—/Not connected"
 * otherwise — never an invented figure. */
export type HelpKpi = { value: number | null; connected: boolean };
export interface HelpDashboard {
  kpis: {
    openTickets: HelpKpi;
    avgResponseMin: HelpKpi;
    helpArticles: HelpKpi;
    videoTutorials: HelpKpi;
    aiResolutionPct: HelpKpi;
    systemUptimePct: HelpKpi;
    activeGuides: HelpKpi;
    productUpdates: HelpKpi;
  };
  systemStatus: { healthy: boolean; label: string; version: string };
}

export class TenantNavigationService {
  constructor(private readonly db: Kysely<DB> | null) {}

  private async count(text: ReturnType<typeof sql>): Promise<number> {
    if (!this.db) return 0;
    try { const r = await text.execute(this.db); const row: any = (r as any).rows?.[0]; return Number(row?.n || 0); }
    catch { return 0; }
  }

  /** Role + permissions (from session) + feature/AI/subscription access (best-effort from existing tables). */
  async navigation(ctx: NavCtx) {
    const t = ctx.tenantId;
    let aiPackages: string[] = [];
    let subscriptionStatus = 'active';
    // The salon's own name, for the sidebar header. It lives in the generic per-category settings store under
    // category 'business-branch' (branch row first, tenant-wide row as fallback). It is served HERE, not from
    // /pos/settings/*, because every settings route requires `settings.view` and the sidebar renders for every
    // POS role — a technician would 403 and permanently see the placeholder. Fail-soft to null: the frontend
    // then shows its own fallback rather than an invented name.
    let salonName: string | null = null;
    if (this.db) {
      try {
        const r = await sql<{ salon_name: string | null }>`
          SELECT settings_json->>'salonName' AS salon_name
          FROM tenant_settings
          WHERE tenant_id = ${t} AND category = 'business-branch'
            AND (branch_id = ${ctx.branchId || null} OR branch_id IS NULL)
          ORDER BY branch_id NULLS LAST
          LIMIT 1`.execute(this.db);
        const n = r.rows[0]?.salon_name;
        salonName = n && String(n).trim() ? String(n).trim() : null;
        // nothing saved in the business settings yet (a new salon): the salon's REGISTERED name — its own, not invented
        // (wave 4: the POS header showed the placeholder "Your Salon" for every salon until the owner saved that form)
        if (!salonName) {
          const d = await sql<{ name: string | null }>`SELECT coalesce(nullif(trim(display_name), ''), nullif(trim(legal_name), '')) AS name FROM tenants WHERE id = ${t}`.execute(this.db);
          salonName = d.rows[0]?.name ?? null;
        }
      } catch { salonName = null; }
    }
    if (this.db) {
      // Active AI package codes (locked-by-default when unknown — spec: unsubscribed AI shows locked).
      try {
        const r = await sql<{ code: string }>`
          SELECT DISTINCT package_code AS code FROM tenant_ai_subscriptions
          WHERE tenant_id = ${t} AND status IN ('active','trialing')`.execute(this.db);
        aiPackages = r.rows.map((x) => x.code).filter(Boolean);
      } catch { aiPackages = []; }
      try {
        const r = await sql<{ status: string }>`SELECT status FROM tenant_subscriptions WHERE tenant_id = ${t} LIMIT 1`.execute(this.db);
        if (r.rows[0]?.status) subscriptionStatus = r.rows[0].status;
      } catch { /* default active */ }
    }
    return { role: ctx.role, permissions: ctx.permissions, features: [] as string[], aiPackages, subscriptionStatus, salonName };
  }

  /** Live badge counts — tenant + current location scoped. Each query fail-soft to 0. */
  async badges(ctx: NavCtx) {
    const t = ctx.tenantId, b = ctx.branchId;
    const [
      customerQueue, checkIn, techQueue, serviceDone, checkout,
      lowStock, pendingReports, aiUsageAlerts, setupHealthAlerts, alertsUnread,
    ] = await Promise.all([
      this.count(sql`SELECT count(*)::int AS n FROM pos_queue_items WHERE tenant_id=${t} AND branch_id=${b} AND status='waiting'`),
      this.count(sql`SELECT count(*)::int AS n FROM pos_queue_items WHERE tenant_id=${t} AND branch_id=${b} AND status IN ('waiting','called')`),
      this.count(sql`SELECT count(*)::int AS n FROM pos_tech_queue_tickets WHERE tenant_id=${t} AND branch_id=${b} AND status NOT IN ('completed','cancelled','removed')`),
      // ── Service Done ────────────────────────────────────────────────────────────────────────────────────
      // WAS: `select count(*) from ticket_service_lines where status = 'sent_to_service_done'`. That badge was
      // permanently 0, and nothing ever said so:
      //
      //   * WRONG TABLE. `sent_to_service_done` is a SERVING TICKET status, not a service-line status.
      //     `ticket_service_lines.status` only ever holds assigned / in_progress / paused.
      //   * WRONG VALUE. `sent_to_service_done` is domain VOCABULARY — serving.kysely.repository maps it down to
      //     `tickets.status = 'service_done'` before writing. The literal string is never stored in the database
      //     at ALL, in any table.
      //
      // So the predicate could not match a row under any circumstances. And because every badge count is wrapped
      // in `.catch(() => 0)` — correct in principle, so a missing count never breaks the sidebar — it failed
      // SILENTLY and looked exactly like "no tickets are ready", forever. No error, no failing test.
      //
      // The authority for this state is the service-done module itself, which reads
      // `tickets.status in ('service_done','ready_checkout')`. This now matches it, so the badge and the screen
      // it links to can no longer disagree.
      this.count(sql`SELECT count(*)::int AS n FROM tickets WHERE tenant_id=${t} AND branch_id=${b} AND status = 'service_done'`),
      this.count(sql`SELECT count(*)::int AS n FROM tickets WHERE tenant_id=${t} AND branch_id=${b} AND paid_at IS NULL AND status <> 'cancelled'`),
      // Inventory low-stock (per current location), joined to the product reorder threshold.
      // Stock Alerts mandate (Oct 29 2026): the ONE alert scope (live state, branch overrides, unacknowledged) — the
      // number the Stock Alerts page shows as Open Alerts. It was a base-level-only count the page never agreed with (11 vs 0).
      this.count(openAlertCount(t, b)),
      // Technician inventory reports still awaiting approval.
      this.count(sql`SELECT count(*)::int AS n FROM inventory_technician_reports
                     WHERE tenant_id=${t} AND branch_id=${b} AND status='pending'`),
      // AI Usage & Limits guide §10: unacknowledged 80 / 90 / 100 % alerts of the CURRENT billing periods (salon-wide)
      this.count(sql`SELECT count(*)::int AS n FROM ai_usage_alerts a JOIN tenant_ai_subscriptions s ON s.tenant_id = a.tenant_id AND s.package_code = a.package_code
                     AND a.period_start = s.current_period_starts_at WHERE a.tenant_id=${t} AND a.acknowledged_at IS NULL`),
      // Four-Module Completion Guide §13: open, unacknowledged high / critical Setup Health alerts (salon-wide)
      this.count(sql`SELECT count(*)::int AS n FROM health_check_alerts WHERE tenant_id=${t} AND status='open' AND severity IN ('high','critical') AND acknowledged_at IS NULL`),
      // extras round 9 (AI BUSINESS ALERTS 05 / Global Loyalty Rewards 08): salon alerts THIS person has not read yet —
      // per-person read state (staff_alert_reads), separate from the alert lifecycle. 0 without owner.alerts.view.
      this.alertsUnreadFor(ctx),
    ]);
    // notifications = actionable, tenant-safe operational signals (NOT super-admin platform alerts).
    const inventoryAlerts = lowStock;
    const notifications = lowStock + pendingReports;
    // messages: the staff Communications inbox isn't built yet, so this is a genuine 0 (NOT fabricated demo data).
    // It will light up automatically once a tenant-staff message/conversation source exists.
    const messages = 0;
    return {
      checkIn, techQueue, customerQueue, serviceDone, checkout,
      notifications, messages, inventoryAlerts, techReportsPending: pendingReports,
      reviews: 0, payrollPending: 0, billingAlerts: 0, aiUsageAlerts, setupHealthAlerts, supportTickets: 0, alertsUnread,
    };
  }

  private readCtx(ctx: NavCtx) { return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId ?? '', permissions: ctx.permissions }; }
  private need(): Kysely<any> { if (!this.db) throw new StaffAlertReadError('Alert read state needs the database.', 'SERVICE_UNAVAILABLE', 503); return this.db as unknown as Kysely<any>; }
  private async alertsUnreadFor(ctx: NavCtx): Promise<number> {
    if (!this.db) return 0;
    return unreadAlertCount(this.db as unknown as Kysely<any>, this.readCtx(ctx)).catch((e: unknown) => { logException(e, { where: 'tenant-navigation.badges.alertsUnread' }); return 0; });   // fail-soft like every badge, but logged
  }
  /** The bell panel's alert list: newest first, unread first, each with my read time and the alert's own lifecycle. */
  staffAlerts(ctx: NavCtx, q: { category?: string | null; limit?: number }): Promise<StaffAlertList> { return listStaffAlerts(this.need(), this.readCtx(ctx), q); }
  /** Mark alerts read for ME only — the alert lifecycle (acknowledge / resolve) is untouched. */
  markAlertsRead(ctx: NavCtx, alertIds: unknown): Promise<StaffAlertMarkReadResponse> { return markStaffAlertsRead(this.need(), this.readCtx(ctx), alertIds, ctx.sessionId ?? null); }
  /** This session applied a fresh unread count. */
  recordBadgeSync(ctx: NavCtx, body: { unread?: unknown; surface?: unknown }): Promise<BadgeSyncRecorded> { return recordBadgeSync(this.need(), this.readCtx(ctx), ctx.sessionId ?? null, body); }
  /** My live sessions with their last badge sync vs the count now (read-only). */
  badgeSyncMonitor(ctx: NavCtx): Promise<BadgeSyncMonitor> { return badgeSyncMonitor(this.need(), this.readCtx(ctx), ctx.sessionId ?? null); }

  /** Real platform health for the bottom status card. */
  async systemStatus() {
    let healthy = true;
    if (this.db) { try { await sql`SELECT 1`.execute(this.db); } catch { healthy = false; } }
    return { healthy, label: healthy ? 'All Systems Operational' : 'Service degraded', version: process.env.APP_VERSION || 'v2.4.1' };
  }

  /**
   * Read-only Help Center KPI aggregate, tenant-scoped (ctx kept for the per-tenant feeds wired in later
   * phases). Every support feed — open tickets, avg response, help articles, video tutorials, AI-resolution
   * rate, uptime %, active guides, product updates — has no canonical source table yet (the existing
   * `ticket*` tables are POS sale tickets, not support tickets), so each is reported honestly as
   * { value: null, connected: false }. Real figures plug in here as the §36 backend lands; nothing is
   * invented. System health is real (reused from systemStatus).
   */
  async helpDashboard(_ctx: NavCtx): Promise<HelpDashboard> {
    const systemStatus = await this.systemStatus();
    const notConnected = (): HelpKpi => ({ value: null, connected: false });
    return {
      kpis: {
        openTickets: notConnected(),
        avgResponseMin: notConnected(),
        helpArticles: notConnected(),
        videoTutorials: notConnected(),
        aiResolutionPct: notConnected(),
        systemUptimePct: notConnected(),
        activeGuides: notConnected(),
        productUpdates: notConnected(),
      },
      systemStatus,
    };
  }
}
