// service-done.kysely.repository.ts — production ServiceDoneRepositoryPort over Postgres (Kysely).
// Real, tenant/branch-scoped over tickets + ticket_service_lines (+ customers/technicians labels) and the technician
// roster. Technician assignment writes tickets.primary_technician_id; mark-ready/send writes tickets.status (and
// ready_checkout_at). Money math reuses the same dto helpers. Scope is session-derived.
//
// Schema notes (honest — tickets has no columns for these, so NOT faked — in-process per ticket within a running
// server): the quality status + checklist, internal + customer-visible notes, the helper technician, the customer-
// notified timestamp, the send-to-checkout idempotency key, and the finer checkout-status / service-done status
// vocabulary (not_ready / ready_for_checkout / sent_to_checkout / reopened). isVip=false (no flag); duration is
// derived from serving_started_at→service_done_at; paid is read from tickets.paid_at.
import { branchTimeZone, canMoveToSql } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM } from '@aipowersalon/appointments';
import { businessDate, dayStartMs } from '@aipowersalon/date-time';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ServiceDoneContext, ServiceDoneRepositoryPort, SDTicket } from './service-done.repository';
import { PosKpiSnapshots } from '@aipowersalon/reports';
import {
  POSServiceDoneFullState, POSServiceDoneTicketRow, POSServiceDoneTicketDetail, POSServiceDoneKpisFull, ServiceDoneFilters,
  QualityStatus, CheckoutStatus, ServiceDoneStatus, QualityChecklist, ServiceLine, ServiceDoneWorkflowSettings,
  DEFAULT_SERVICE_DONE_SETTINGS, subtotalFromLines, addOnRevenueFromTickets, computeRebookingRatePercent,
  ServiceDoneAnalytics, ReadyFinishingTech, ServiceDoneInsight, buildServiceMix, buildAddOnMix, buildTechPerformance, completionAccuracyPercent,
  buildRebookingSuggestion,
} from './service-done.dto';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';
import { projectionDeliversRealtime } from '@aipowersalon/config';

const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
const defChecklist = (): QualityChecklist => ({ allServicesCompleted: true, customerReady: true, servicesReviewed: false, noOpenIssues: true, notesCompleted: false });
const STATUS_MAP: Record<string, ServiceDoneStatus> = { service_done: 'completed', ready_checkout: 'ready_for_checkout', paid: 'completed' };
interface Overlay { qualityStatus?: QualityStatus; checklist?: QualityChecklist; notes?: string; customerVisibleNotes?: string; helperTechId?: string; helperTechName?: string; customerNotifiedAt?: string | null; checkoutStatus?: CheckoutStatus; status?: ServiceDoneStatus; sentKey?: string; }

export class KyselyServiceDoneRepository implements ServiceDoneRepositoryPort {
  private ov = new Map<string, Overlay>();
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
  private o(id: string): Overlay { if (!this.ov.has(id)) this.ov.set(id, {}); return this.ov.get(id)!; }
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

  private async hydrate(ctx: ServiceDoneContext, t: any): Promise<SDTicket> {
    const ov = this.o(t.id);
    const rawLines = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('ticket_id', '=', t.id)
      .select(['id', 'service_id', 'service_name_snapshot', 'technician_id', 'price_cents_snapshot', 'line_total_cents', 'is_add_on']).execute().catch(() => []);
    const techIds = [...new Set([...rawLines.map((l: any) => l.technician_id), t.primary_technician_id, ov.helperTechId].filter(Boolean))];
    const tn: Record<string, string> = {};
    if (techIds.length) { const techs = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', 'in', techIds).select(['id', 'full_name']).execute().catch(() => []); for (const x of techs) tn[x.id] = x.full_name; }
    const lines: ServiceLine[] = rawLines.map((l: any) => ({ serviceLineId: l.id, serviceName: l.service_name_snapshot || l.service_id, serviceId: l.service_id || undefined, technicianId: l.technician_id || undefined, technicianName: l.technician_id ? tn[l.technician_id] : undefined, priceCents: Number(l.price_cents_snapshot ?? l.line_total_cents ?? 0), isAddOn: !!l.is_add_on }));
    let custName = '', phone: string | undefined;
    if (t.customer_id) { const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', t.customer_id).select(['full_name', 'phone_display']).executeTakeFirst().catch(() => undefined); if (c) { custName = (c as any).full_name || ''; phone = (c as any).phone_display || undefined; } }
    const dur = t.serving_started_at && t.service_done_at ? Math.max(0, Math.round((new Date(t.service_done_at).getTime() - new Date(t.serving_started_at).getTime()) / 60000)) : 0;
    return {
      ticketId: t.id, ticketNumber: '#' + String(t.id).slice(0, 6), customerId: t.customer_id || '', customerName: custName, customerPhone: phone, isVip: false, station: undefined,
      lines, primaryTechId: t.primary_technician_id || undefined, primaryTechName: t.primary_technician_id ? tn[t.primary_technician_id] : undefined, helperTechId: ov.helperTechId, helperTechName: ov.helperTechName,
      startedAt: t.serving_started_at ? iso(t.serving_started_at) : undefined, completedAt: t.service_done_at ? iso(t.service_done_at) : iso(t.updated_at), durationMinutes: dur,
      serviceDoneLocked: !!t.service_done_locked_at,
      checklist: ov.checklist || defChecklist(), qualityStatus: ov.qualityStatus || 'pending', notes: ov.notes || '', customerVisibleNotes: ov.customerVisibleNotes || '', customerNotifiedAt: ov.customerNotifiedAt ?? null,
      checkoutStatus: ov.checkoutStatus || (t.status === 'ready_checkout' ? 'ready_for_checkout' : t.status === 'paid' ? 'sent_to_checkout' : 'not_ready'), status: ov.status || STATUS_MAP[t.status] || 'completed', paid: !!t.paid_at, sentIdempotencyKey: ov.sentKey, updatedAt: iso(t.updated_at),
    };
  }
  private async load(ctx: ServiceDoneContext, id: string): Promise<SDTicket | null> {
    const t = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id).select(['id', 'customer_id', 'primary_technician_id', 'status', 'serving_started_at', 'service_done_at', 'paid_at', 'updated_at', 'service_done_locked_at']).executeTakeFirst().catch(() => undefined);
    return t ? this.hydrate(ctx, t) : null;
  }
  private completionTrend(tickets: { completedAt: string }[]): { hour: number; count: number }[] {
    const by: Record<number, number> = {};
    for (const t of tickets) { const d = new Date(t.completedAt); if (!isNaN(d.getTime())) { const h = d.getHours(); by[h] = (by[h] || 0) + 1; } }
    return Object.keys(by).map(Number).sort((a, b) => a - b).map((hour) => ({ hour, count: by[hour] }));
  }
  private _taxRatePercent(): number { return 0; }

  private async loadAll(ctx: ServiceDoneContext): Promise<SDTicket[]> {
    const rows = await this.scoped(this.db.selectFrom('tickets'), ctx).where('status', 'in', ['service_done', 'ready_checkout']).select(['id', 'customer_id', 'primary_technician_id', 'status', 'serving_started_at', 'service_done_at', 'paid_at', 'updated_at']).execute().catch(() => []);
    return Promise.all(rows.map((t: any) => this.hydrate(ctx, t)));
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
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter((t) => [t.ticketNumber, t.customerName, t.customerPhone, t.primaryTechName, t.station, ...t.lines.map((l) => l.serviceName)].some((x) => (x || '').toLowerCase().includes(q))); }
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
      .where('ready_checkout_at', '>=', (await this.dayStart(ctx)) as any)
      .select(sql<number>`coalesce(round(avg(extract(epoch from (ready_checkout_at - service_done_at)))), 0)`.as('secs'))
      .executeTakeFirst().catch(() => undefined);
    const averageTurnaroundSeconds = Math.max(0, Number((turnRow as any)?.secs || 0));
    const satRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('satisfaction_rating', 'is not', null).where('paid_at', '>=', (await this.dayStart(ctx)) as any)
      .select(sql<number>`coalesce(round(avg(satisfaction_rating)::numeric, 2), 0)`.as('avg'))
      .executeTakeFirst().catch(() => undefined);
    const customerSatisfactionAvg = Math.max(0, Number((satRow as any)?.avg || 0));
    const tipRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('paid_at', '>=', (await this.dayStart(ctx)) as any)
      .select(sql<number>`coalesce(sum(tip_cents), 0)`.as('cents'))
      .executeTakeFirst().catch(() => undefined);
    const tipsCapturedCents = Math.max(0, Math.round(Number((tipRow as any)?.cents || 0)));
    // Rebooking rate: distinct customers who completed a service today, then which of them hold a future booking.
    const completedTodayRows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('service_done_at', '>=', (await this.dayStart(ctx)) as any).where('customer_id', 'is not', null)
      .select('customer_id').distinct().execute().catch(() => []);
    const completedTodayCustomerIds = completedTodayRows.map((r: any) => r.customer_id).filter(Boolean);
    let rebookedCustomerIds: string[] = [];
    if (completedTodayCustomerIds.length) {
      const rb = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx)
        .where('customer_id', 'in', completedTodayCustomerIds)
        .where('appt_date', '>=', businessDate(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null), new Date(this.now())))   // the branch's day (Oct 3 2026)
        .where('status', 'not in', ['cancelled', 'canceled', 'no_show', 'no-show'])
        .select('customer_id').distinct().execute().catch(() => []);
      rebookedCustomerIds = rb.map((r: any) => r.customer_id).filter(Boolean);
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
      completionAccuracyPercent: completionAccuracyPercent(all.filter((t) => isToday(t.completedAt)).length, all.filter((t) => t.qualityStatus === 'issue_found').length),
    };
    // ---- Reference-module aggregations (real, fail-soft; honest gaps left empty/null where no backing column) ----
    // Per-ticket tips (entered now; finalized at checkout) for queue rows + tech performance + potential revenue.
    const allIds = all.map((t) => t.ticketId);
    const tipBy: Record<string, number> = {};
    if (allIds.length) { const tr = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', 'in', allIds).select(['id', 'tip_cents']).execute().catch(() => [] as any[]); for (const r of tr as any[]) tipBy[r.id] = Number(r.tip_cents || 0); }
    pageRows.forEach((r) => { r.tipCents = tipBy[r.ticketId] || 0; });
    // Real service categories for Service Mix: service_id -> category name.
    const serviceIds = [...new Set(all.flatMap((t) => t.lines.map((l) => l.serviceId).filter(Boolean)))] as string[];
    const catByService: Record<string, string> = {};
    if (serviceIds.length) {
      const svc = await this.scoped(this.db.selectFrom('services'), ctx).where('id', 'in', serviceIds).select(['id', 'category_id']).execute().catch(() => [] as any[]);
      const catIds = [...new Set((svc as any[]).map((x) => x.category_id).filter(Boolean))];
      const catNames: Record<string, string> = {};
      if (catIds.length) { const cats = await this.scoped(this.db.selectFrom('service_categories'), ctx).where('id', 'in', catIds).select(['id', 'name']).execute().catch(() => [] as any[]); for (const c of cats as any[]) catNames[c.id] = c.name; }
      for (const x of svc as any[]) catByService[x.id] = catNames[x.category_id] || '';
    }
    // Enrich each line with its category (so Service Mix groups by real category; falls back to service name).
    const enriched = all.map((t) => ({ ...t, tipCents: tipBy[t.ticketId] || 0, lines: t.lines.map((l) => ({ ...l, category: l.serviceId ? (catByService[l.serviceId] || undefined) : l.category })) }));
    const completedTodayTickets = enriched.filter((t) => isToday(t.completedAt));
    const analytics: ServiceDoneAnalytics = {
      completionTrend: this.completionTrend(completedTodayTickets),
      serviceMix: buildServiceMix(completedTodayTickets),
      addOnMix: buildAddOnMix(completedTodayTickets),
      funnel: { completed: kpis.completedServicesToday, inReview: kpis.ticketsReadyForReview, readyForCheckout: kpis.ticketsReadyForCheckout, sentToFrontDesk: all.filter((t) => t.status === 'sent_to_checkout').length },
      potentialRevenue: (() => { const serviceCents = salesReady.reduce((a, t) => a + subtotalFromLines(t.lines.filter((l) => !l.isAddOn)), 0); const addOnCents = addOnRevenueFromTickets(salesReady); const tipsEstCents = salesReady.reduce((a, t) => a + (tipBy[t.ticketId] || 0), 0); const taxesEstCents = Math.round((serviceCents + addOnCents) * (this._taxRatePercent() / 100)); return { serviceCents, addOnCents, tipsEstCents, taxesEstCents, totalCents: serviceCents + addOnCents + tipsEstCents + taxesEstCents }; })(),
      completionTrendDeltaPercent: null,
      potentialRevenueDeltaPercent: null,
    };
    // Real per-technician rating: average satisfaction over today's paid tickets, grouped by primary technician.
    const ratingByTech: Record<string, number | null> = {};
    const ratingRows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('satisfaction_rating', 'is not', null).where('paid_at', '>=', (await this.dayStart(ctx)) as any).where('primary_technician_id', 'is not', null)
      .select(['primary_technician_id', sql<number>`avg(satisfaction_rating)`.as('avg')]).groupBy('primary_technician_id').execute().catch(() => [] as any[]);
    for (const r of ratingRows as any[]) if (r.primary_technician_id != null) ratingByTech[r.primary_technician_id] = Math.round(Number(r.avg) * 10) / 10;
    const techPerformance = buildTechPerformance(completedTodayTickets.map((t) => ({ primaryTechId: t.primaryTechId, primaryTechName: t.primaryTechName, lines: t.lines, durationMinutes: t.durationMinutes, tipCents: tipBy[t.ticketId] || 0 })), ratingByTech);
    // Ready / Finishing technicians from live presence — the authoritative workforce state when bound (merge Oct 12 2026,
    // other chat's workforce audit), else the technician_statuses compat table (same source as Serving/Overview).
    const techRows = await this.scoped(this.db.selectFrom('technicians'), ctx).where('status', '!=', 'archived').select(['id', 'full_name', 'status']).execute().catch(() => [] as any[]);
    const techIds = (techRows as any[]).map((r) => r.id);
    // w4 sweep SW-11: technicians has no `specialties` column (selecting it emptied this whole panel) — the specialty is
    // the technician's own skill groups (technician_skills, the skills the Fair Turn engine routes on)
    const skillRows = techIds.length ? await this.db.selectFrom('technician_skills').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', techIds).select(['technician_id', 'skill_group']).orderBy('created_at').execute().catch(() => [] as any[]) : [];
    const skillsBy: Record<string, string[]> = {}; for (const k of skillRows as any[]) { const l = (skillsBy[k.technician_id] ??= []); if (!l.includes(k.skill_group)) l.push(k.skill_group); }
    let statBy: Record<string, string> = {};
    if (this.workforce && techIds.length) statBy = await this.workforce.legacyStatusMap(ctx.tenantId, ctx.branchId || null, techIds).catch(() => ({}));
    else {
      const statRows = techIds.length ? await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', techIds).select(['technician_id', 'status']).execute().catch(() => [] as any[]) : [];
      for (const sr of statRows as any[]) statBy[sr.technician_id] = sr.status;
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
    // Real insights: delayed-to-checkout tickets + a VIP awaiting review.
    const insights: ServiceDoneInsight[] = [];
    const delayed = all.filter((t) => t.checkoutStatus === 'ready_for_checkout').length;
    if (delayed > 0) insights.push({ id: 'delayed', text: `${delayed} completed guest${delayed === 1 ? '' : 's'} ready for checkout`, action: 'Review Now', route: '/service-done' });
    const vipReview = all.find((t) => t.isVip && (t.qualityStatus === 'pending' || t.qualityStatus === 'needs_review'));
    if (vipReview) insights.push({ id: 'vip', text: `${vipReview.customerName} is a VIP guest`, sub: 'Prompt rebooking before checkout.', action: 'Open Profile', route: '/customers' });
    // Real day-over-day trends: upsert today's KPI snapshot and compare against the latest prior business day.
    const kpiTrends = await new PosKpiSnapshots(this.db).snapshotAndTrends(ctx.tenantId, ctx.branchId, 'service_done', {
      completed: kpis.completedServicesToday, ready: kpis.ticketsReadyForCheckout, duration: kpis.averageServiceDurationMinutes,
      turnaround: kpis.averageTurnaroundSeconds, addon: kpis.addOnRevenueCents, tips: kpis.tipsCapturedCents,
      rebooking: kpis.rebookingRatePercent, satisfaction: kpis.customerSatisfactionAvg, accuracy: kpis.completionAccuracyPercent,
    }, ['duration', 'turnaround']);
    return {
      kpis, kpiTrends, analytics, techPerformance, staff, insights, tickets: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
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
      if (c) loyaltyPoints = Number((c as any).points_balance || 0);
      const agg = await this.scoped(this.db.selectFrom('tickets'), ctx).where('customer_id', '=', t.customerId).where('paid_at', 'is not', null)
        .select([sql<number>`count(*)`.as('visits'), sql<number>`coalesce(sum(total_cents), 0)`.as('spend')]).executeTakeFirst().catch(() => undefined);
      if (agg) { visitCount = Number((agg as any).visits || 0); totalSpendCents = Math.round(Number((agg as any).spend || 0)); }
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
      subtotalCents: sub, estimatedCommissionCents: null, checkoutStatus: t.checkoutStatus, status: t.status, serviceDoneLocked: t.serviceDoneLocked, rebooking, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }],
    };
  }

  async setQuality(ctx: ServiceDoneContext, id: string, status: QualityStatus, checklist?: Partial<QualityChecklist>) { const t = await this.load(ctx, id); if (!t) return false; const ov = this.o(id); ov.qualityStatus = status; if (checklist) ov.checklist = { ...(ov.checklist || t.checklist), ...checklist }; return true; }
  async setNotes(ctx: ServiceDoneContext, id: string, notes?: string, customerVisibleNotes?: string) { const t = await this.load(ctx, id); if (!t) return false; const ov = this.o(id); if (notes != null) { ov.notes = notes; ov.checklist = { ...(ov.checklist || t.checklist), notesCompleted: !!notes.trim() }; } if (customerVisibleNotes != null) ov.customerVisibleNotes = customerVisibleNotes; return true; }
  async assignTechnician(ctx: ServiceDoneContext, id: string, technicianId: string) {
    const tech = (await this._techs(ctx)).find((x) => x.technicianId === technicianId); if (!tech) return false;
    const res = await this.scoped(this.db.updateTable('tickets'), ctx).set({ primary_technician_id: technicianId, updated_at: sql`now()` } as any).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return Number((res as any)?.numUpdatedRows ?? 0) > 0;
  }
  async assignHelper(ctx: ServiceDoneContext, id: string, technicianId: string | null) {
    if (!(await this.load(ctx, id))) return false; const ov = this.o(id);
    if (technicianId === null) { ov.helperTechId = undefined; ov.helperTechName = undefined; return true; }
    const tech = (await this._techs(ctx)).find((x) => x.technicianId === technicianId); if (!tech) return false; ov.helperTechId = tech.technicianId; ov.helperTechName = tech.name; return true;
  }
  async setCheckoutStatus(ctx: ServiceDoneContext, id: string, cs: CheckoutStatus, st: ServiceDoneStatus) {
    if (!(await this.load(ctx, id))) return false; const ov = this.o(id); ov.checkoutStatus = cs; ov.status = st;
    const dbStatus = cs === 'ready_for_checkout' || cs === 'sent_to_checkout' ? 'ready_checkout' : st === 'reopened' ? 'serving' : null;
    if (dbStatus) {
      // §18/§67: the status change and the handoff fact commit together. Only the CHECKOUT-bound transitions are
      // a fact worth an event — a 'reopened' ticket going back to serving is not "ready for checkout".
      const readyForCheckout = cs === 'ready_for_checkout' || cs === 'sent_to_checkout';
      await this.db.transaction().execute(async (trx) => {
        await this.scoped(trx.updateTable('tickets'), ctx).set({ status: dbStatus, ...(cs === 'ready_for_checkout' ? { ready_checkout_at: sql`now()` } : {}), updated_at: sql`now()` } as any).where('id', '=', id).executeTakeFirst();
        // developer merge Sep 2026: the queue item and the technician appointment follow the ticket, in the same transaction
        const qStatus = st === 'reopened' ? 'in_service' : 'completed';   // Phase 12 (#27): was 'serving' — a ticket status, refused by the queue item's CHECK (swallowed)
        await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ status: qStatus, updated_at: sql`now()` } as any).where((eb: any) => eb.or([eb('id', '=', id), eb('ticket_id', '=', id)])).where(canMoveToSql(QUEUE_ITEM, qStatus) as any).executeTakeFirst().catch(() => undefined);
        const apptStatus = st === 'reopened' ? 'in_service' : 'completed';
        await this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ status: apptStatus, updated_at: sql`now()` } as any).where('id', '=', id).where(canMoveToSql(APPOINTMENT, apptStatus) as any).executeTakeFirst().catch(() => undefined);
        if (readyForCheckout && this.outbox) await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.TICKET_READY_FOR_CHECKOUT, tenantId: ctx.tenantId, branchId: ctx.branchId,
          aggregateType: 'ticket', aggregateId: id, actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${id}`,
          payload: { ticketId: id, checkoutStatus: cs },
        }));
      }).catch(() => undefined);
    }
    return true;
  }
  async markNotified(_ctx: ServiceDoneContext, id: string) { this.o(id).customerNotifiedAt = new Date().toISOString(); }
  async clearServiceDoneLockOnReopen(ctx: ServiceDoneContext, id: string, opts: { reason: string; byUserId?: string }) {
    const cur: any = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id).select(['service_done_locked_at']).executeTakeFirst().catch(() => undefined);
    if (!cur || cur.service_done_locked_at == null) return; // not formally locked → nothing to reconcile
    await this.db.transaction().execute(async (trx) => {
      const upd: any = await trx.updateTable('tickets').set({ service_done_locked_at: null, service_done_locked_by_user_id: null, service_done_locked_total_cents: null, version: sql`version + 1`, updated_at: sql`now()` } as any)
        .where('id', '=', id).where('tenant_id', '=', ctx.tenantId).returning(['version']).executeTakeFirst();
      const version = Number(upd?.version ?? 0);
      await trx.insertInto('ticket_revisions').values({
        ticket_id: id, tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, version, action: 'service_done_reopened',
        service_line_id: null, actor_user_id: opts.byUserId ?? null, actor_role: ctx.role ?? null, before: null,
        after: JSON.stringify({ reason: opts.reason }), summary: `Reopened from Service Done: ${opts.reason}`,
      } as any).execute();
    });
  }
  async setStatus(ctx: ServiceDoneContext, id: string, st: ServiceDoneStatus) { if (!(await this.load(ctx, id))) return false; this.o(id).status = st; return true; }
  async getSendKey(_ctx: ServiceDoneContext, id: string) { return this.o(id).sentKey; }
  async setSendKey(_ctx: ServiceDoneContext, id: string, key: string) { this.o(id).sentKey = key; }
}
