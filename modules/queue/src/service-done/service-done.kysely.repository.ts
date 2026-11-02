// service-done.kysely.repository.ts — production ServiceDoneRepositoryPort over Postgres (Kysely).
// Real, tenant/branch-scoped over tickets + ticket_service_lines (+ customers/technicians labels) and the technician
// roster. Technician assignment writes tickets.primary_technician_id; mark-ready/send writes tickets.status (and
// ready_checkout_at). Money math reuses the same dto helpers. Scope is session-derived.
//
// Service Done mandate (Oct 28 2026, §22–§37, §99–§110, §113): the workflow state lives in the ticket's OWN columns
// (migration 025 + 707): service_done_quality_status, service_done_checklist, service_done_checkout_status,
// service_done_notes, service_done_customer_visible_notes, service_done_customer_notified_at,
// service_done_send_idempotency_key, helper_technician_id. Before this file kept every one of them in a Map in the API
// process: two stations on two API instances disagreed, a restart forgot every quality approval and every "sent" key, and
// payroll / Serving never saw a helper set here. The handoff to Checkout is one compare-and-set UPDATE (transitionToCheckout).
// The board reads in a fixed number of queries (tickets, then lines / technicians / customers for ALL of them at once) —
// no per-row loop. isVip=false (no flag); duration is serving_started_at→service_done_at; paid is tickets.paid_at.
import { taxCents } from '@aipowersalon/money';
import { branchTimeZone, canMoveToSql } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM } from '@aipowersalon/appointments';
import { SERVICE_DONE_CHECKOUT, SERVICE_DONE_QUALITY } from '../queue-lifecycles';
import { businessDate, dayStartMs } from '@aipowersalon/date-time';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { checkoutTransitionDecision, type ServiceDoneContext, type ServiceDoneRepositoryPort, type SDTicket, type CheckoutTransitionInput, type CheckoutTransitionResult } from './service-done.repository';
import { PosKpiSnapshots } from '@aipowersalon/reports';
import {
  capReadyStaff,
  POSServiceDoneFullState, POSServiceDoneTicketRow, POSServiceDoneTicketDetail, POSServiceDoneKpisFull, ServiceDoneFilters,
  QualityStatus, CheckoutStatus, ServiceDoneStatus, QualityChecklist, ServiceLine, ServiceDoneWorkflowSettings,
  DEFAULT_SERVICE_DONE_SETTINGS, subtotalFromLines, addOnRevenueFromTickets, computeRebookingRatePercent,
  ServiceDoneAnalytics, ReadyFinishingTech, ServiceDoneInsight, buildServiceMix, buildAddOnMix, buildTechPerformance, completionAccuracyPercent,
  buildRebookingSuggestion,
} from './service-done.dto';
import { clampPageSize, clampPage, foldVi } from '@aipowersalon/api-contracts';
import { projectionDeliversRealtime } from '@aipowersalon/config';

const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
const defChecklist = (): QualityChecklist => ({ allServicesCompleted: true, customerReady: true, servicesReviewed: false, noOpenIssues: true, notesCompleted: false });
const STATUS_MAP: Record<string, ServiceDoneStatus> = { service_done: 'completed', ready_checkout: 'ready_for_checkout', paid: 'completed' };
const TICKET_COLS = ['id', 'ticket_number', 'customer_id', 'primary_technician_id', 'helper_technician_id', 'status', 'serving_started_at', 'service_done_at', 'paid_at', 'updated_at', 'service_done_locked_at', 'station_label', 'version', 'tip_cents',
  'service_done_quality_status', 'service_done_checkout_status', 'service_done_notes', 'service_done_customer_visible_notes', 'service_done_customer_notified_at', 'service_done_send_idempotency_key', 'service_done_checklist'] as const;
/** §19 / §93: the board's active window — the newest completions first; older unpaid ones stay reachable by search / filter */
const BOARD_LIMIT = 300;
const parseChecklist = (v: unknown): QualityChecklist | null => { let o: any = v; if (typeof v === 'string') { try { o = JSON.parse(v); } catch { o = null; } } return o && typeof o === 'object' ? { ...defChecklist(), ...o } : null; };
/** the Service Done checkout vocabulary from the row (a pre-707 row that reached ready_checkout without the column set reads as ready) */
const checkoutStatusOf = (t: any): CheckoutStatus => { const cs = String(t.service_done_checkout_status || 'not_ready') as CheckoutStatus; return cs === 'not_ready' && t.status === 'ready_checkout' ? 'ready_for_checkout' : cs; };
const statusOf = (t: any, cs: CheckoutStatus): ServiceDoneStatus => (cs === 'sent_to_checkout' ? 'sent_to_checkout' : cs === 'ready_for_checkout' ? 'ready_for_checkout' : cs === 'reopened' ? 'reopened' : STATUS_MAP[t.status] || 'completed');

export class KyselyServiceDoneRepository implements ServiceDoneRepositoryPort {
  // Constitution 8 §18: ticket.ready_for_checkout commits with the status change. Optional and null-safe.
  /** `workforce` (merge Oct 12 2026): the ONE authoritative technician state (WorkforceStatusService.legacyStatusMap);
   *  absent (tests / no module) → the technician_statuses compat table, as before. Structural — no Nest coupling. */
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null, private readonly workforce: { legacyStatusMap(tenantId: string, branchId: string | null, ids: string[]): Promise<Record<string, string>> } | null = null) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;
  /** The instant the BRANCH's day began, at its own midnight — "today" for every KPI below. the database's UTC midnight
   *  was the database's UTC day: after 8 pm in New York the evening's tickets dropped out of today (Oct 6 2026). */
  private async dayStart(ctx: { tenantId: string; branchId?: string | null }): Promise<Date> {
    return new Date(dayStartMs(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null), new Date(this.now())));
  }
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }   // not merely "has an outbox": the publisher must be ON
  private scoped(qb: any, ctx: ServiceDoneContext): any {
    let q = qb.where('tenant_id', '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId), eb('branch_id', 'is', null)]));
    return q;
  }
  private _settings(): ServiceDoneWorkflowSettings { return DEFAULT_SERVICE_DONE_SETTINGS; }
  async settings(_ctx: ServiceDoneContext) { return this._settings(); }
  private async _techs(ctx: ServiceDoneContext): Promise<{ technicianId: string; name: string }[]> {
    const rows = await this.scoped(this.db.selectFrom('technicians'), ctx).where('status', '!=', 'archived').select(['id', 'full_name']).execute().catch(() => []);
    return rows.map((r: any) => ({ technicianId: r.id, name: r.full_name || r.id }));
  }
  async technicians(ctx: ServiceDoneContext) { return this._techs(ctx); }

  /** §113: every ticket of the board hydrated with THREE queries in total (lines, technician names, customers) — the old
   *  per-ticket loop ran three queries per row (90+ for a busy board). */
  private async hydrateMany(ctx: ServiceDoneContext, rows: any[]): Promise<SDTicket[]> {
    if (!rows.length) return [];
    const ids = rows.map((t) => t.id);
    const rawLines: any[] = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('ticket_id', 'in', ids).where('removed_at', 'is', null)
      .select(['id', 'ticket_id', 'service_id', 'service_name_snapshot', 'technician_id', 'price_cents_snapshot', 'line_total_cents', 'is_add_on', 'status', 'completed_at']).orderBy('created_at').execute();
    const techIds = [...new Set([...rawLines.map((l) => l.technician_id), ...rows.map((t) => t.primary_technician_id), ...rows.map((t) => t.helper_technician_id)].filter(Boolean))];
    const tn: Record<string, string> = {};
    if (techIds.length) for (const x of await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', 'in', techIds).select(['id', 'full_name']).execute()) tn[x.id] = x.full_name;
    const custIds = [...new Set(rows.map((t) => t.customer_id).filter(Boolean))];
    const cust: Record<string, { name: string; phone?: string }> = {};
    if (custIds.length) for (const c of await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', custIds).select(['id', 'full_name', 'phone_display']).execute()) cust[c.id] = { name: c.full_name || '', phone: c.phone_display || undefined };
    const linesBy = new Map<string, ServiceLine[]>();
    for (const l of rawLines) {
      if (['cancelled', 'removed', 'voided'].includes(String(l.status || ''))) continue;
      // §38: each line keeps the technician who did it — never re-pooled under the ticket's primary
      (linesBy.get(l.ticket_id) ?? linesBy.set(l.ticket_id, []).get(l.ticket_id)!).push({ serviceLineId: l.id, serviceName: l.service_name_snapshot || l.service_id, serviceId: l.service_id || undefined, technicianId: l.technician_id || undefined, technicianName: l.technician_id ? tn[l.technician_id] : undefined, priceCents: Number(l.line_total_cents ?? l.price_cents_snapshot ?? 0), isAddOn: !!l.is_add_on });
    }
    return rows.map((t) => {
      const dur = t.serving_started_at && t.service_done_at ? Math.max(0, Math.round((new Date(t.service_done_at).getTime() - new Date(t.serving_started_at).getTime()) / 60000)) : 0;
      const cs = checkoutStatusOf(t); const c = t.customer_id ? cust[t.customer_id] : undefined;
      return {
        ticketId: t.id, ticketNumber: t.ticket_number ? '#' + String(t.ticket_number).replace(/^#/, '') : '#' + String(t.id).slice(0, 6), customerId: t.customer_id || '', customerName: c?.name || '', customerPhone: c?.phone, isVip: false, station: t.station_label || undefined,
        lines: linesBy.get(t.id) ?? [], primaryTechId: t.primary_technician_id || undefined, primaryTechName: t.primary_technician_id ? tn[t.primary_technician_id] : undefined,
        helperTechId: t.helper_technician_id || undefined, helperTechName: t.helper_technician_id ? tn[t.helper_technician_id] : undefined,
        startedAt: t.serving_started_at ? iso(t.serving_started_at) : undefined, completedAt: t.service_done_at ? iso(t.service_done_at) : iso(t.updated_at), durationMinutes: dur,
        serviceDoneLocked: !!t.service_done_locked_at,
        checklist: parseChecklist(t.service_done_checklist) || defChecklist(), qualityStatus: (t.service_done_quality_status || 'pending') as QualityStatus,
        notes: t.service_done_notes || '', customerVisibleNotes: t.service_done_customer_visible_notes || '', customerNotifiedAt: t.service_done_customer_notified_at ? iso(t.service_done_customer_notified_at) : null,
        checkoutStatus: cs, status: statusOf(t, cs), paid: !!t.paid_at, sentIdempotencyKey: t.service_done_send_idempotency_key || undefined, updatedAt: iso(t.updated_at),
        version: Number(t.version ?? 1), tipCents: Number(t.tip_cents || 0),
      };
    });
  }
  private async load(ctx: ServiceDoneContext, id: string): Promise<SDTicket | null> {
    const t = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id).select(TICKET_COLS).executeTakeFirst();
    return t ? (await this.hydrateMany(ctx, [t]))[0] : null;
  }
  private completionTrend(tickets: { completedAt: string }[]): { hour: number; count: number }[] {
    const by: Record<number, number> = {};
    for (const t of tickets) { const d = new Date(t.completedAt); if (!isNaN(d.getTime())) { const h = d.getHours(); by[h] = (by[h] || 0) + 1; } }
    return Object.keys(by).map(Number).sort((a, b) => a - b).map((hour) => ({ hour, count: by[hour] }));
  }
  private _taxRatePercent(): number { return 0; }

  /** The board: completed, unpaid visits (Just Finished → Sent to Front Desk). A paid ticket has left Service Done (§100);
   *  a reopened one is back in Serving. A read failure is an error (the screen keeps its last state), never an empty board. */
  private async loadAll(ctx: ServiceDoneContext): Promise<SDTicket[]> {
    const rows = await this.scoped(this.db.selectFrom('tickets'), ctx).where('status', 'in', ['service_done', 'ready_checkout']).where('paid_at', 'is', null)
      .select(TICKET_COLS).orderBy('service_done_at', 'desc').limit(BOARD_LIMIT).execute();
    return this.hydrateMany(ctx, rows);
  }
  async ticket(ctx: ServiceDoneContext, id: string) { return this.load(ctx, id); }

  private toRow(ctx: ServiceDoneContext, t: SDTicket): POSServiceDoneTicketRow {
    const sub = subtotalFromLines(t.lines);
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: t.customerId, customerName: t.customerName, customerPhone: t.customerPhone, isVip: t.isVip,
      station: t.station, serviceCount: t.lines.length, serviceNames: t.lines.map((l) => l.serviceName), addOnsLabel: t.lines.filter((l) => l.isAddOn).map((l) => l.serviceName).join(", ") || undefined, primaryTechnicianId: t.primaryTechId, primaryTechnicianName: t.primaryTechName, helperTechnicianId: t.helperTechId, helperTechnicianName: t.helperTechName,
      startedAt: t.startedAt, completedAt: t.completedAt, durationMinutes: t.durationMinutes, subtotalCents: sub, estimatedCommissionCents: null,
      qualityStatus: t.qualityStatus, checkoutStatus: t.checkoutStatus, customerNotifiedAt: t.customerNotifiedAt, notes: t.notes, status: t.status,
    };
  }

  async query(ctx: ServiceDoneContext, f: ServiceDoneFilters): Promise<POSServiceDoneFullState> {
    // completed TODAY = since the branch's midnight (Oct 6 2026 — was the server's UTC date, which rolled over at 8 pm in New York)
    const since = (await this.dayStart(ctx)).getTime(); const isToday = (at: string | null | undefined) => !!at && Date.parse(at) >= since;
    const all = await this.loadAll(ctx);
    let rows = all.slice();
    if (f.search) { const q = foldVi(f.search);   /* accent-insensitive (Vietnamese POS §41) */ rows = rows.filter((t) => [t.ticketNumber, t.customerName, t.customerPhone, t.primaryTechName, t.station, ...t.lines.map((l) => l.serviceName)].some((x) => foldVi(x).includes(q))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.qualityStatus) rows = rows.filter((t) => t.qualityStatus === f.qualityStatus);
    if (f.checkoutStatus) rows = rows.filter((t) => t.checkoutStatus === f.checkoutStatus);
    if (f.technicianId) rows = rows.filter((t) => t.primaryTechId === f.technicianId || t.helperTechId === f.technicianId);
    if (f.station) rows = rows.filter((t) => t.station === f.station);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((t) => this.toRow(ctx, t));
    const durations = all.map((t) => t.durationMinutes).filter((d) => d > 0);
    const salesReady = all.filter((t) => t.status !== 'sent_to_checkout');
    const turnRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('service_done_at', 'is not', null).where('ready_checkout_at', 'is not', null)
      .where('ready_checkout_at', '>=', (await this.dayStart(ctx)))
      .select(sql<number>`coalesce(round(avg(extract(epoch from (ready_checkout_at - service_done_at)))), 0)`.as('secs'))
      .executeTakeFirst().catch(() => undefined);
    const averageTurnaroundSeconds = Math.max(0, Number(turnRow?.secs || 0));
    const satRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('satisfaction_rating', 'is not', null).where('paid_at', '>=', (await this.dayStart(ctx)))
      .select([sql<number>`round(avg(satisfaction_rating)::numeric, 2)`.as('avg'), sql<number>`count(*)`.as('n')])
      .executeTakeFirst().catch(() => undefined);
    const customerSatisfactionCount = Number(satRow?.n || 0);
    const customerSatisfactionAvg = customerSatisfactionCount > 0 ? Math.max(0, Number(satRow?.avg || 0)) : null;   // §55: no rating = no number
    const tipRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('paid_at', '>=', (await this.dayStart(ctx)))
      .select(sql<number>`coalesce(sum(tip_cents), 0)`.as('cents'))
      .executeTakeFirst().catch(() => undefined);
    const tipsCapturedCents = Math.max(0, Math.round(Number(tipRow?.cents || 0)));
    // Rebooking rate (§57): distinct customers who completed a service today; of them, who BOOKED AGAIN after it — an
    // appointment created after their service_done_at, dated today or later, not cancelled / no-show. A booking that
    // already existed before the service is not a rebooking (it used to count).
    const completedTodayRows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('service_done_at', '>=', (await this.dayStart(ctx))).where('customer_id', 'is not', null)
      .select(['customer_id', sql<string>`min(service_done_at)`.as('done_at')]).groupBy('customer_id').execute().catch(() => []);
    const completedTodayCustomerIds = completedTodayRows.map((r: any) => r.customer_id).filter(Boolean);
    let rebookedCustomerIds: string[] = [];
    if (completedTodayCustomerIds.length) {
      const doneAt: Record<string, number> = {}; for (const r of completedTodayRows) doneAt[r.customer_id] = Date.parse(iso(r.done_at));
      const rb = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx)
        .where('customer_id', 'in', completedTodayCustomerIds)
        .where('appt_date', '>=', businessDate(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null), new Date(this.now())))   // the branch's day (Oct 3 2026)
        .where('status', 'not in', ['cancelled', 'canceled', 'no_show', 'no-show'])
        .where('created_at', '>=', (await this.dayStart(ctx)))
        .select(['customer_id', 'created_at']).execute().catch(() => []);
      rebookedCustomerIds = [...new Set<string>(rb.filter((r: any) => Date.parse(iso(r.created_at)) >= (doneAt[r.customer_id] ?? Infinity)).map((r: any) => String(r.customer_id)))];
    }
    const rebookingRatePercent = computeRebookingRatePercent(completedTodayCustomerIds, rebookedCustomerIds);
    const kpis: POSServiceDoneKpisFull = {
      completedServicesToday: all.filter((t) => isToday(t.completedAt)).length, ticketsReadyForReview: all.filter((t) => t.qualityStatus === 'pending' || t.qualityStatus === 'needs_review').length,
      ticketsReadyForCheckout: all.filter((t) => t.checkoutStatus === 'ready_for_checkout').length, qualityIssuesCount: all.filter((t) => t.qualityStatus === 'issue_found').length,
      reopenedServicesToday: all.filter((t) => t.status === 'reopened').length, averageServiceDurationMinutes: durations.length ? Math.round(durations.reduce((a, d) => a + d, 0) / durations.length) : 0,
      estimatedSalesCents: salesReady.reduce((a, t) => a + subtotalFromLines(t.lines), 0), estimatedCommissionCents: null,
      addOnRevenueCents: addOnRevenueFromTickets(all),
      averageTurnaroundSeconds,
      customerSatisfactionAvg,
      tipsCapturedCents,
      rebookingRatePercent,
      completionAccuracyPercent: completionAccuracyPercent(all.filter((t) => isToday(t.completedAt)).length, all.filter((t) => isToday(t.completedAt) && t.qualityStatus === 'issue_found').length),
      customerSatisfactionCount, rebookingEligible: completedTodayCustomerIds.length,
    };
    // ---- Reference-module aggregations (real, fail-soft; honest gaps left empty/null where no backing column) ----
    // Per-ticket tips (entered now; finalized at checkout) for queue rows + tech performance + potential revenue.
    const allIds = all.map((t) => t.ticketId);
    const tipBy: Record<string, number> = {}; for (const t of all) tipBy[t.ticketId] = t.tipCents ?? 0;   // read with the tickets (no extra query)
    void allIds;
    pageRows.forEach((r) => { r.tipCents = tipBy[r.ticketId] || 0; });
    // Real service categories for Service Mix: service_id -> category name.
    const serviceIds = [...new Set(all.flatMap((t) => t.lines.map((l) => l.serviceId).filter(Boolean)))] as string[];
    const catByService: Record<string, string> = {};
    if (serviceIds.length) {
      const svc = await this.scoped(this.db.selectFrom('services'), ctx).where('id', 'in', serviceIds).select(['id', 'category_id']).execute().catch(() => [] as any[]);
      const catIds = [...new Set((svc as any[]).map((x) => x.category_id).filter(Boolean))];
      const catNames: Record<string, string> = {};
      if (catIds.length) { const cats = await this.scoped(this.db.selectFrom('service_categories'), ctx).where('id', 'in', catIds).select(['id', 'name']).execute().catch(() => [] as any[]); for (const c of cats as any[]) catNames[c.id] = c.name; }
      for (const x of svc) catByService[x.id] = catNames[x.category_id] || '';
    }
    // Enrich each line with its category (so Service Mix groups by real category; falls back to service name).
    const enriched = all.map((t) => ({ ...t, tipCents: tipBy[t.ticketId] || 0, lines: t.lines.map((l) => ({ ...l, category: l.serviceId ? (catByService[l.serviceId] || undefined) : l.category })) }));
    const completedTodayTickets = enriched.filter((t) => isToday(t.completedAt));
    const analytics: ServiceDoneAnalytics = {
      completionTrend: this.completionTrend(completedTodayTickets),
      serviceMix: buildServiceMix(completedTodayTickets),
      addOnMix: buildAddOnMix(completedTodayTickets),
      funnel: { completed: kpis.completedServicesToday, inReview: kpis.ticketsReadyForReview, readyForCheckout: kpis.ticketsReadyForCheckout, sentToFrontDesk: all.filter((t) => t.status === 'sent_to_checkout').length },
      potentialRevenue: (() => { const serviceCents = salesReady.reduce((a, t) => a + subtotalFromLines(t.lines.filter((l) => !l.isAddOn)), 0); const addOnCents = addOnRevenueFromTickets(salesReady); const tipsEstCents = salesReady.reduce((a, t) => a + (tipBy[t.ticketId] || 0), 0); const taxesEstCents = taxCents(serviceCents + addOnCents, this._taxRatePercent()); return { serviceCents, addOnCents, tipsEstCents, taxesEstCents, totalCents: serviceCents + addOnCents + tipsEstCents + taxesEstCents }; })(),
      completionTrendDeltaPercent: null,
      potentialRevenueDeltaPercent: null,
    };
    // Real per-technician rating: average satisfaction over today's paid tickets, grouped by primary technician.
    const ratingByTech: Record<string, number | null> = {};
    const ratingRows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('satisfaction_rating', 'is not', null).where('paid_at', '>=', (await this.dayStart(ctx))).where('primary_technician_id', 'is not', null)
      .select(['primary_technician_id', sql<number>`avg(satisfaction_rating)`.as('avg')]).groupBy('primary_technician_id').execute().catch(() => [] as any[]);
    for (const r of ratingRows) if (r.primary_technician_id != null) ratingByTech[r.primary_technician_id] = Math.round(Number(r.avg) * 10) / 10;
    const techPerformance = buildTechPerformance(completedTodayTickets.map((t) => ({ primaryTechId: t.primaryTechId, primaryTechName: t.primaryTechName, lines: t.lines, durationMinutes: t.durationMinutes, tipCents: tipBy[t.ticketId] || 0 })), ratingByTech);
    // Ready / Finishing technicians from live presence — the authoritative workforce state when bound (merge Oct 12 2026,
    // other chat's workforce audit), else the technician_statuses compat table (same source as Serving/Overview).
    const techRows = await this.scoped(this.db.selectFrom('technicians'), ctx).where('status', '!=', 'archived').select(['id', 'full_name', 'status']).execute().catch(() => [] as any[]);
    const techIds = (techRows as any[]).map((r) => r.id);
    // w4 sweep SW-11: technicians has no `specialties` column (selecting it emptied this whole panel) — the specialty is
    // the technician's own skill groups (technician_skills, the skills the Fair Turn engine routes on)
    const skillRows = techIds.length ? await this.db.selectFrom('technician_skills').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', techIds).select(['technician_id', 'skill_group']).orderBy('created_at').execute().catch(() => [] as any[]) : [];
    const skillsBy: Record<string, string[]> = {}; for (const k of skillRows) { const l = (skillsBy[k.technician_id] ??= []); if (!l.includes(k.skill_group)) l.push(k.skill_group); }
    let statBy: Record<string, string> = {};
    if (this.workforce && techIds.length) statBy = await this.workforce.legacyStatusMap(ctx.tenantId, ctx.branchId || null, techIds).catch(() => ({}));
    else {
      const statRows = techIds.length ? await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', techIds).select(['technician_id', 'status']).execute().catch(() => [] as any[]) : [];
      for (const sr of statRows) statBy[sr.technician_id] = sr.status;
    }
    // Real current load: count of each technician's actively in-progress service lines.
    const loadBy: Record<string, number> = {};
    if (techIds.length) { const lr = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('technician_id', 'in', techIds).where('status', '=', 'in_progress').select(['technician_id', sql<number>`count(*)`.as('c')]).groupBy('technician_id').execute().catch(() => [] as any[]); for (const x of lr as any[]) if (x.technician_id) loadBy[x.technician_id] = Number(x.c || 0); }
    const specOf = (raw: unknown): string | undefined => { let arr: any = raw; if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } } return Array.isArray(arr) && arr.length ? arr.slice(0, 2).map(String).join(', ') : undefined; };
    const SD_STATUS: Record<string, string> = { available: 'Available', busy: 'Busy', serving: 'Busy', finishing: 'Finishing Soon', on_break: 'Break', break: 'Break' };
    const staff: ReadyFinishingTech[] = (techRows as any[]).map((r) => {
      const raw = statBy[r.id] || (r.status === 'active' ? 'available' : r.status); const label = SD_STATUS[String(raw).toLowerCase()];
      if (!label) return null;
      const next = label === 'Available' ? 'Now' : label === 'Finishing Soon' ? 'Soon' : '—';
      return { technicianId: r.id, name: r.full_name || r.id, specialty: specOf(skillsBy[r.id]), currentLoadBusy: loadBy[r.id] ?? 0, status: label, nextAvailable: next };
    }).filter(Boolean) as ReadyFinishingTech[];
    const { staff: staffShown, staffSummary } = capReadyStaff(staff, techRows.length);   // §44: never 200 cards
    // Real insights: delayed-to-checkout tickets + a VIP awaiting review.
    const insights: ServiceDoneInsight[] = [];
    const delayed = all.filter((t) => t.checkoutStatus === 'ready_for_checkout').length;
    if (delayed > 0) insights.push({ id: 'delayed', text: `${delayed} completed guest${delayed === 1 ? '' : 's'} ready for checkout`, action: 'Review Now', route: '/service-done', vars: { count: delayed } });
    // §66: advisory — a quality issue holding checkout (the board shows it; nothing is changed by the insight)
    const issues = all.filter((t) => t.qualityStatus === 'issue_found').length;
    if (issues > 0) insights.push({ id: 'quality', text: `${issues} quality issue${issues === 1 ? '' : 's'} holding checkout`, severity: 'warn', vars: { count: issues } });
    const vipReview = all.find((t) => t.isVip && (t.qualityStatus === 'pending' || t.qualityStatus === 'needs_review'));
    if (vipReview) insights.push({ id: 'vip', text: `${vipReview.customerName} is a VIP guest`, sub: 'Prompt rebooking before checkout.', action: 'Open Profile', route: '/customers', vars: { name: vipReview.customerName } });
    // Real day-over-day trends: upsert today's KPI snapshot and compare against the latest prior business day.
    const kpiTrends = await new PosKpiSnapshots(this.db).snapshotAndTrends(ctx.tenantId, ctx.branchId, 'service_done', {
      completed: kpis.completedServicesToday, ready: kpis.ticketsReadyForCheckout, duration: kpis.averageServiceDurationMinutes,
      turnaround: kpis.averageTurnaroundSeconds, addon: kpis.addOnRevenueCents, tips: kpis.tipsCapturedCents,
      // a KPI with no data yet (null) snapshots as 0; the POS shows no trend for a value it shows as "—"
      rebooking: kpis.rebookingRatePercent ?? 0, satisfaction: kpis.customerSatisfactionAvg ?? 0, accuracy: kpis.completionAccuracyPercent ?? 0,
    }, ['duration', 'turnaround']);
    return {
      kpis, kpiTrends, analytics, techPerformance, staff: staffShown, staffSummary, insights, tickets: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      filters: {
        statuses: ['completed', 'ready_for_checkout', 'sent_to_checkout', 'reopened'], technicians: [...new Set(all.map((t) => t.primaryTechName || ''))].filter(Boolean),
        serviceCategories: [...new Set(all.flatMap((t) => t.lines.map((l) => l.category || '')))].filter(Boolean), qualityStatuses: ['pending', 'approved', 'issue_found', 'needs_review'], stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean),
      },
      workflowSettings: this._settings(),
    };
  }

  async detail(ctx: ServiceDoneContext, id: string): Promise<POSServiceDoneTicketDetail | null> {
    const t = await this.load(ctx, id); if (!t) return null; const sub = subtotalFromLines(t.lines);
    // Real guest summary: loyalty from the guest's loyalty profile (one per tenant + customer — w4 sweep SW-08b: it read
    // customers.points_balance, which does not exist, and was always blank); visits + lifetime spend from paid tickets.
    let loyaltyPoints: number | undefined, visitCount: number | undefined, totalSpendCents: number | undefined;
    if (t.customerId) {
      const c = await this.db.selectFrom('customer_loyalty_profiles').where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', t.customerId).select(['points_balance']).executeTakeFirst().catch(() => undefined);
      if (c) loyaltyPoints = Number(c.points_balance || 0);
      const agg = await this.scoped(this.db.selectFrom('tickets'), ctx).where('customer_id', '=', t.customerId).where('paid_at', 'is not', null)
        .select([sql<number>`count(*)`.as('visits'), sql<number>`coalesce(sum(total_cents), 0)`.as('spend')]).executeTakeFirst().catch(() => undefined);
      if (agg) { visitCount = Number(agg.visits || 0); totalSpendCents = Math.round(Number(agg.spend || 0)); }
    }
    // Rebooking suggestion from the guest's own paid-visit cadence (null when <2 visits — honest, no guess).
    let rebooking: { label: string; window: string } | null = null;
    if (t.customerId) {
      const visits = await this.scoped(this.db.selectFrom('tickets'), ctx).where('customer_id', '=', t.customerId).where('paid_at', 'is not', null)
        .select(['paid_at']).orderBy('paid_at', 'asc').limit(24).execute().catch(() => [] as any[]);
      rebooking = buildRebookingSuggestion((visits as any[]).map((v) => v.paid_at));
    }
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, customer: { customerId: t.customerId, fullName: t.customerName, phone: t.customerPhone, isVip: t.isVip, loyaltyPoints, visitCount, totalSpendCents },
      station: t.station, services: t.lines, primaryTechnician: t.primaryTechId ? { technicianId: t.primaryTechId, name: t.primaryTechName! } : undefined,
      helperTechnician: t.helperTechId ? { technicianId: t.helperTechId, name: t.helperTechName! } : null, startedAt: t.startedAt, completedAt: t.completedAt, durationMinutes: t.durationMinutes,
      qualityChecklist: t.checklist, qualityStatus: t.qualityStatus, notes: t.notes, customerVisibleNotes: t.customerVisibleNotes, customerNotifiedAt: t.customerNotifiedAt,
      subtotalCents: sub, estimatedCommissionCents: null, checkoutStatus: t.checkoutStatus, status: t.status, serviceDoneLocked: t.serviceDoneLocked, rebooking, version: t.version, tipCents: t.tipCents, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }],
    };
  }

  async setQuality(ctx: ServiceDoneContext, id: string, status: QualityStatus, checklist?: Partial<QualityChecklist>, expectedVersion?: number): Promise<boolean | 'conflict'> {
    const t = await this.load(ctx, id); if (!t) return false;
    // the checklist is merged key by key (the known boolean items only) — a request body never reaches the row whole
    const CHECK_KEYS = ['allServicesCompleted', 'customerReady', 'servicesReviewed', 'noOpenIssues', 'notesCompleted'] as const;
    const merged: QualityChecklist = { ...t.checklist };
    for (const key of CHECK_KEYS) { const v = checklist?.[key]; if (typeof v === 'boolean') merged[key] = v; }
    const checklistJson = checklist ? JSON.stringify(merged) : null;
    let q = this.scoped(this.db.updateTable('tickets'), ctx).set({ service_done_quality_status: status, ...(checklistJson ? { service_done_checklist: checklistJson } : {}), version: sql`version + 1`, updated_at: sql`now()`, updated_by: ctx.userId ?? null }).where('id', '=', id).where(canMoveToSql(SERVICE_DONE_QUALITY, status));
    if (expectedVersion != null) q = q.where('version', '=', expectedVersion);   // §108: a newer edit is never overwritten
    const r = await q.executeTakeFirst();
    return Number(r?.numUpdatedRows ?? 0) > 0 ? true : expectedVersion != null ? 'conflict' : false;
  }
  async setNotes(ctx: ServiceDoneContext, id: string, notes?: string, customerVisibleNotes?: string) {
    const t = await this.load(ctx, id); if (!t) return false;
    // field by field (the allow-list): the two notes and the checklist's notesCompleted — nothing else reaches the row
    const r = await this.scoped(this.db.updateTable('tickets'), ctx).set({
      updated_at: sql`now()`, updated_by: ctx.userId ?? null,
      ...(notes != null ? { service_done_notes: notes.slice(0, 2000), service_done_checklist: JSON.stringify({ ...t.checklist, notesCompleted: !!notes.trim() }) } : {}),
      ...(customerVisibleNotes != null ? { service_done_customer_visible_notes: customerVisibleNotes.slice(0, 2000) } : {}),
    }).where('id', '=', id).executeTakeFirst();
    return Number(r?.numUpdatedRows ?? 0) > 0;
  }
  async assignTechnician(ctx: ServiceDoneContext, id: string, technicianId: string) {
    const tech = (await this._techs(ctx)).find((x) => x.technicianId === technicianId); if (!tech) return false;
    const res = await this.scoped(this.db.updateTable('tickets'), ctx).set({ primary_technician_id: technicianId, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }
  async assignHelper(ctx: ServiceDoneContext, id: string, technicianId: string | null) {
    if (!(await this.load(ctx, id))) return false;
    if (technicianId !== null && !(await this._techs(ctx)).some((x) => x.technicianId === technicianId)) return false;
    // the ticket's helper column (Serving's completion + payroll read the same one — the old in-memory helper was invisible to them)
    const r = await this.scoped(this.db.updateTable('tickets'), ctx).set({ helper_technician_id: technicianId, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst();
    return Number(r?.numUpdatedRows ?? 0) > 0;
  }
  /** Reopen (and the legacy paths): the status change, the queue item and the appointment commit together. Errors propagate. */
  async setCheckoutStatus(ctx: ServiceDoneContext, id: string, cs: CheckoutStatus, st: ServiceDoneStatus) {
    if (!(await this.load(ctx, id))) return false;
    const dbStatus = cs === 'ready_for_checkout' || cs === 'sent_to_checkout' ? 'ready_checkout' : st === 'reopened' ? 'serving' : null;
    const readyForCheckout = cs === 'ready_for_checkout' || cs === 'sent_to_checkout';
    await this.db.transaction().execute(async (trx) => {
      await this.scoped(trx.updateTable('tickets'), ctx).set({ service_done_checkout_status: cs, ...(dbStatus ? { status: dbStatus } : {}), ...(cs === 'ready_for_checkout' ? { ready_checkout_at: sql`now()` } : {}), version: sql`version + 1`, updated_at: sql`now()` }).where('id', '=', id).where(canMoveToSql(SERVICE_DONE_CHECKOUT, cs)).executeTakeFirst();
      if (dbStatus) {
        const qStatus = st === 'reopened' ? 'in_service' : 'completed';
        await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ status: qStatus, updated_at: sql`now()` }).where((eb: any) => eb.or([eb('id', '=', id), eb('ticket_id', '=', id)])).where(canMoveToSql(QUEUE_ITEM, qStatus)).executeTakeFirst();
        const apptStatus = st === 'reopened' ? 'in_service' : 'completed';
        await this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ status: apptStatus, updated_at: sql`now()` }).where('id', '=', id).where(canMoveToSql(APPOINTMENT, apptStatus)).executeTakeFirst();
      }
      if (readyForCheckout && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.TICKET_READY_FOR_CHECKOUT, tenantId: ctx.tenantId, branchId: ctx.branchId,
        aggregateType: 'ticket', aggregateId: id, actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${id}`,
        payload: { ticketId: id, checkoutStatus: cs },
      }));
    });
    return true;
  }
  /**
   * §32–§37, §99–§100, §107, §110: ONE compare-and-set UPDATE decides the handoff. The WHERE clause IS the readiness rule
   * (completed, unpaid, not reopened, not already at/after the target, quality approved / notes present when required), so
   * two stations racing cannot both move it: Postgres re-checks the row under its lock and the second UPDATE matches 0
   * rows. The loser re-reads and reports 'already' (idempotent success) or the real reason. The outbox fact
   * (ticket.ready_for_checkout → Checkout board, customer "bill ready" notice) is written in the SAME transaction and only
   * when the UPDATE moved the row. Database errors propagate — the old path swallowed them and answered "sent".
   */
  async transitionToCheckout(ctx: ServiceDoneContext, id: string, input: CheckoutTransitionInput): Promise<CheckoutTransitionResult> {
    const moved = await this.db.transaction().execute(async (trx) => {
      let q = this.scoped(trx.updateTable('tickets'), ctx).set({
        status: 'ready_checkout', service_done_checkout_status: input.target,
        ready_checkout_at: sql`coalesce(ready_checkout_at, now())`,
        ...(input.idempotencyKey ? { service_done_send_idempotency_key: input.idempotencyKey } : {}),
        version: sql`version + 1`, updated_at: sql`now()`, updated_by: ctx.userId ?? null,
      }).where('id', '=', id).where('status', 'in', ['service_done', 'ready_checkout']).where('paid_at', 'is', null)
        .where('service_done_checkout_status', 'not in', input.target === 'sent_to_checkout' ? ['sent_to_checkout', 'reopened'] : ['ready_for_checkout', 'sent_to_checkout', 'reopened'])
        .where(canMoveToSql(SERVICE_DONE_CHECKOUT, input.target));
      if (input.requireApproved) q = q.where('service_done_quality_status', '=', 'approved');
      if (input.requireNotes) q = q.where(sql`coalesce(btrim(service_done_notes), '')`, '<>', '');
      const r: any = await q.returning(['id']).executeTakeFirst();
      if (!r) return false;
      await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ status: 'completed', updated_at: sql`now()` }).where((eb: any) => eb.or([eb('id', '=', id), eb('ticket_id', '=', id)])).where(canMoveToSql(QUEUE_ITEM, 'completed')).executeTakeFirst();
      await this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ status: 'completed', updated_at: sql`now()` }).where('id', '=', id).where(canMoveToSql(APPOINTMENT, 'completed')).executeTakeFirst();
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.TICKET_READY_FOR_CHECKOUT, tenantId: ctx.tenantId, branchId: ctx.branchId,
        aggregateType: 'ticket', aggregateId: id, actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${id}`,
        payload: { ticketId: id, checkoutStatus: input.target, ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) },
      }));
      return true;
    });
    if (moved) return { outcome: 'moved', idempotencyKey: input.idempotencyKey };
    const t = await this.load(ctx, id); if (!t) return { outcome: 'not_found' };
    const d = checkoutTransitionDecision(t, input);
    if (d) return d.outcome === 'already' ? { outcome: 'already', idempotencyKey: t.sentIdempotencyKey } : d;
    return { outcome: 'blocked', reason: 'NOT_COMPLETED' };   // e.g. the ticket is back in Serving
  }
  async markNotified(ctx: ServiceDoneContext, id: string) { await this.scoped(this.db.updateTable('tickets'), ctx).set({ service_done_customer_notified_at: sql`now()`, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst(); }
  async clearServiceDoneLockOnReopen(ctx: ServiceDoneContext, id: string, opts: { reason: string; byUserId?: string }) {
    const cur: any = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id).select(['service_done_locked_at']).executeTakeFirst().catch(() => undefined);
    if (!cur || cur.service_done_locked_at == null) return; // not formally locked → nothing to reconcile
    await this.db.transaction().execute(async (trx) => {
      const upd: any = await trx.updateTable('tickets').set({ service_done_locked_at: null, service_done_locked_by_user_id: null, service_done_locked_total_cents: null, version: sql`version + 1`, updated_at: sql`now()` })
        .where('id', '=', id).where('tenant_id', '=', ctx.tenantId).returning(['version']).executeTakeFirst();
      const version = Number(upd?.version ?? 0);
      await trx.insertInto('ticket_revisions').values({
        ticket_id: id, tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, version, action: 'service_done_reopened',
        service_line_id: null, actor_user_id: opts.byUserId ?? null, actor_role: ctx.role ?? null, before: null,
        after: JSON.stringify({ reason: opts.reason }), summary: `Reopened from Service Done: ${opts.reason}`,
      }).execute();
    });
  }
  async setStatus(ctx: ServiceDoneContext, id: string, st: ServiceDoneStatus) { const cs: CheckoutStatus | null = st === 'reopened' ? 'reopened' : st === 'ready_for_checkout' ? 'ready_for_checkout' : st === 'sent_to_checkout' ? 'sent_to_checkout' : null; if (!(await this.load(ctx, id))) return false; if (cs) await this.scoped(this.db.updateTable('tickets'), ctx).set({ service_done_checkout_status: cs, updated_at: sql`now()` }).where('id', '=', id).where(canMoveToSql(SERVICE_DONE_CHECKOUT, cs)).executeTakeFirst(); return true; }
  async getSendKey(ctx: ServiceDoneContext, id: string) { return (await this.load(ctx, id))?.sentIdempotencyKey; }
  async setSendKey(ctx: ServiceDoneContext, id: string, key: string) { await this.scoped(this.db.updateTable('tickets'), ctx).set({ service_done_send_idempotency_key: key, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst(); }
}
