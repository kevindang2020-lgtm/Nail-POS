// tech-queue.kysely.repository.ts — production TechQueueRepositoryPort over Postgres (Kysely).
// Near-fully-real: pos_tech_queue_tickets maps 1:1 to the model, so all ticket reads, accept/decline/reassign,
// services (requested_services JSONB), priority, delay state, notify timestamps, status, and the move-to-serving
// idempotency key (serving_idempotency_key) are REAL persisted columns. The technician lanes read the real technicians
// roster; technician SKILL CATEGORIES and the assigned-technician NAME are derived REAL from technicians +
// technician_services → services → service_categories (so skill-gated reassign works without a manager override). The
// service catalog is real. Delay math reuses the same dto helpers. Scope is session-derived.
//
// Minor honest fallback (documented): workingStatus is mapped from technician_statuses when present, else 'available'.
import { branchTimeZone, assertTransition, canMoveToSql } from '@aipowersalon/database';
import { TECH_QUEUE_TICKET } from '@aipowersalon/appointments';
import { acceptOffer, declineOffer } from './tech-queue-offer';
import { addDays, businessDate, localDateTimeToEpochMs, zonedParts } from '@aipowersalon/date-time';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { loadTechUtilization, turnDecline, turnServiceStart, turnUnassign, turnAssign, turnOfferTimeout, CompensationSnapshotRepository, readTurnDay, techQueueLaneStatus } from '@aipowersalon/workforce';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { TechQueueContext, TechQueueRepositoryPort, TQTicket, ExpiredOffer } from './tech-queue.repository';
import {
  POSTechQueueFullState, POSTechQueueTicketRow, POSTechQueueTicketDetail, POSTechQueueTechnicianLane, POSTechQueueKpisFull, TechPerfRow,
  TechQueueFilters, TQTicketStatus, TQPriority, TQSource, TQDelayStatus, TQWorkingStatus, TQRequestedService,
  TechQueueWorkflowSettings, DEFAULT_TQ_SETTINGS, deriveDelayStatus, workloadMinutes, computeUtilizationPercent, computeUpsellCapturePercent,
  TechQueueTechRow, TechQueueWaitingGuest, TechQueueAvailRow, TechQueueAnalytics, TechQueueServiceMixCol, TechQueueInsight, buildAssignmentSourceMix, deriveFinishingSoon, computeUtilizationTrend, TechQueueTrendPoint,
  type TechQueueWorkload, type TechQueueNextAvailable, type TechQueueThroughput, buildTechQueueThroughput,
} from './tech-queue.dto';
import { PosKpiSnapshots } from '@aipowersalon/reports';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';
import { pageTechQueueLanes, TECH_QUEUE_LANE_PAGE_SIZE_MAX } from '@aipowersalon/api-contracts/tenant';
/** 200-technician §2: a paged board's Workload Board columns carry this many technicians each (the screen shows 2) */
const WORKLOAD_PREVIEW = 4;
/** …and the Service Mix chart this many technician columns (the screen draws 6) */
const SERVICE_MIX_COLUMNS = 6;
const money = (c: number) => '$' + ((c||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

import { buildMediaUrl } from '@aipowersalon/media';
const ms = (v: any) => (v ? new Date(v).getTime() : null);
const WORKING: TQWorkingStatus[] = ['available', 'in_service', 'on_break', 'off_today'];
const parseServices = (v: any): TQRequestedService[] => { if (!v) return []; if (Array.isArray(v)) return v as TQRequestedService[]; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };
type TechInfo = { name: string; workingStatus: TQWorkingStatus; avatarUrl?: string | null; skills: string[] };

export class KyselyTechQueueRepository implements TechQueueRepositoryPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** The clock (tests set it). */
  now: () => number = Date.now;
  private async branchDay(ctx: { tenantId: string; branchId?: string | null }): Promise<{ today: string; start: Date; tz: string }> {
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null);
    const today = businessDate(tz, new Date(this.now()));
    return { today, start: new Date(localDateTimeToEpochMs(today, '00:00', tz)), tz };
  }
  /** Today's (branch day) tips per technician from the compensation snapshot + posted tip corrections. */
  private async snapshotTipsToday(ctx: { tenantId: string; branchId?: string | null }): Promise<Map<string, number>> {
    const bday = await this.branchDay(ctx);
    const next = localDateTimeToEpochMs(addDays(bday.today, 1), '00:00', bday.tz);
    const m = await new CompensationSnapshotRepository(this.db).commissionByTechnician(ctx.tenantId, bday.start.toISOString(), new Date(next).toISOString(), ctx.branchId ?? null);
    return new Map([...m.entries()].map(([k, v]) => [k, Math.max(0, v.tipsCents)]));
  }
  /** Will an expired offer reach clients through the realtime projection? (outbox AND publisher on — 6f3b0ed) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  private scoped(qb: any, ctx: TechQueueContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }
  private _settings(): TechQueueWorkflowSettings { return DEFAULT_TQ_SETTINGS; }
  async settings(_ctx: TechQueueContext) { return this._settings(); }

  private async _catalog(ctx: TechQueueContext): Promise<{ serviceId: string; name: string; categoryName: string; durationMinutes: number; priceCents: number }[]> {
    // Service catalog is loaded tenant-wide (no branch filter) so cross-branch bookings always resolve correctly.
    const rows = await this.db.selectFrom('services as s').where('s.tenant_id', '=', ctx.tenantId).leftJoin('service_categories as c', 'c.id', 's.category_id')
      .select(['s.id as serviceId', 's.name as name', 'c.name as categoryName', 's.duration_minutes as dur', 's.price_cents as price']).execute().catch(() => []);
    return rows.map((r: any) => ({ serviceId: r.serviceId, name: r.name, categoryName: r.categoryName || 'General', durationMinutes: Number(r.dur || 0), priceCents: Number(r.price || 0) }));
  }
  async serviceCatalog(ctx: TechQueueContext) { return this._catalog(ctx); }

  private async _techMap(ctx: TechQueueContext): Promise<Record<string, TechInfo>> {
    const techs = await this.scoped(this.db.selectFrom('technicians as tech'), ctx, 'tech')
      .leftJoin('users as u', 'u.id', 'tech.user_id')
      .leftJoin('global_tech_profiles as gtp', (join: any) =>
        join.on((eb: any) => eb.or([
          eb('gtp.id', '=', sql<string>`tech.global_tech_profile_id`),
          eb('gtp.user_id', '=', sql<string>`tech.user_id`)
        ]))
      )
      .where('tech.status', '!=', 'archived')
      .select(['tech.id', 'tech.full_name', 'tech.status', 'tech.avatar_url as tech_avatar_url', 'gtp.avatar_url as gtp_avatar_url', 'u.avatar_url as user_avatar_url'])
      .execute().catch(() => []);
    const ids = techs.map((t: any) => t.id);
    const links = ids.length ? await this.scoped(this.db.selectFrom('technician_services as ts'), ctx, 'ts').innerJoin('services as s', 's.id', 'ts.service_id').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .where('ts.technician_id', 'in', ids).select(['ts.technician_id as tid', 'c.name as cat']).execute().catch(() => []) : [];
    const stat = ids.length ? await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', ids).select(['technician_id', 'status']).execute().catch(() => []) : [];
    const skillBy: Record<string, Set<string>> = {}; for (const l of links) (skillBy[l.tid] ||= new Set()).add(l.cat || 'General');
    const statBy: Record<string, string> = {}; for (const s of stat) statBy[s.technician_id] = s.status;
    const map: Record<string, TechInfo> = {};
    for (const t of techs) {
      const photo = t.tech_avatar_url || t.gtp_avatar_url || t.user_avatar_url;
      map[t.id] = {
        name: t.full_name || t.id,
        workingStatus: WORKING.includes(statBy[t.id] as TQWorkingStatus) ? (statBy[t.id] as TQWorkingStatus) : 'available',
        avatarUrl: photo ? buildMediaUrl(photo) : null,
        skills: [...(skillBy[t.id] || [])],
      };
    }
    return map;
  }
  async technicianUserId(ctx: TechQueueContext, technicianId: string): Promise<string | null> {
    const r = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', technicianId).select(['user_id']).executeTakeFirst().catch(() => undefined);
    return r?.user_id ?? null;
  }
  async technicians(ctx: TechQueueContext) {
    const map = await this._techMap(ctx);
    return Object.entries(map).map(([technicianId, t]) => ({ technicianId, name: t.name, workingStatus: t.workingStatus, skills: t.skills }));
  }

  private rowToTicket(r: any, techMap: Record<string, TechInfo>): TQTicket {
    return {
      techQueueTicketId: r.id, queueItemId: r.queue_item_id || undefined, ticketId: r.ticket_id || undefined, customerId: r.customer_id || '', customerName: r.customer_name || '', customerPhone: r.customer_phone || undefined, isVip: !!r.is_vip,
      source: r.source as TQSource, appointmentId: r.appointment_id || null, services: parseServices(r.requested_services), priority: r.priority as TQPriority, status: r.status as TQTicketStatus,
      assignedTechId: r.assigned_technician_id || '', assignedTechName: techMap[r.assigned_technician_id]?.name || '', station: r.station || undefined, assignedAtMs: ms(r.assigned_at) || Date.now(), acceptedAtMs: ms(r.accepted_at), startedAtMs: ms(r.started_at),
      notes: r.notes || '', delayStatus: (r.delay_status as TQDelayStatus) || 'none', delayReason: r.delay_reason || undefined, technicianNotifiedAt: r.technician_notified_at ? new Date(r.technician_notified_at).toISOString() : null, customerNotifiedAt: r.customer_notified_at ? new Date(r.customer_notified_at).toISOString() : null, servingKey: r.serving_idempotency_key || undefined, createdAtMs: ms(r.created_at) || Date.now(), updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    };
  }
  private assignedWait(t: TQTicket) { const end = t.acceptedAtMs || Date.now(); return Math.max(0, Math.floor((end - t.assignedAtMs) / 60000)); }
  private effectiveDelay(t: TQTicket): TQDelayStatus { return t.status === 'delayed' ? (t.delayStatus === 'none' ? 'late' : t.delayStatus) : (t.delayStatus !== 'none' ? t.delayStatus : deriveDelayStatus(this.assignedWait(t), this._settings().delayAlertMinutes)); }
  private techEligible(t: TQTicket, cat: { serviceId: string; categoryName: string }[], techMap: Record<string, TechInfo>): boolean {
    const tech = techMap[t.assignedTechId]; if (!tech) return false;
    const cats = new Set(cat.filter((s) => t.services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    return [...cats].every((c) => tech.skills.includes(c));
  }
  private toRow(ctx: TechQueueContext, t: TQTicket, custAvatarMap?: Record<string, string>, techAvatarMap?: Record<string, string>): POSTechQueueTicketRow {
    const custPhoto = t.customerId ? custAvatarMap?.[t.customerId] : null;
    const techPhoto = t.assignedTechId ? techAvatarMap?.[t.assignedTechId] : null;
    return {
      techQueueTicketId: t.techQueueTicketId, queueItemId: t.queueItemId, ticketId: t.ticketId || undefined, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: t.customerId, customerName: t.customerName,
      customerAvatarUrl: custPhoto ? buildMediaUrl(custPhoto) : null, avatarUrl: custPhoto ? buildMediaUrl(custPhoto) : null,
      customerPhone: t.customerPhone, isVip: t.isVip,
      source: t.source, appointmentId: t.appointmentId, requestedServices: t.services, serviceCount: t.services.length, priority: t.priority, status: t.status,
      assignedTechnicianId: t.assignedTechId, assignedTechnicianName: t.assignedTechName,
      assignedTechnicianAvatarUrl: techPhoto ? buildMediaUrl(techPhoto) : null,
      station: t.station, assignedAt: new Date(t.assignedAtMs).toISOString(),
      acceptedAt: t.acceptedAtMs ? new Date(t.acceptedAtMs).toISOString() : null, startedAt: t.startedAtMs ? new Date(t.startedAtMs).toISOString() : null,
      quotedWaitMinutes: this.assignedWait(t), assignedWaitMinutes: this.assignedWait(t), notes: t.notes, delayStatus: this.effectiveDelay(t), createdAt: new Date(t.createdAtMs).toISOString(), updatedAt: t.updatedAt,
    };
  }

  private cols = ['id', 'queue_item_id', 'ticket_id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'source', 'appointment_id', 'requested_services', 'priority', 'status', 'assigned_technician_id', 'station', 'assigned_at', 'accepted_at', 'started_at', 'notes', 'delay_status', 'delay_reason', 'technician_notified_at', 'customer_notified_at', 'serving_idempotency_key', 'created_at', 'updated_at'] as const;

  async ticket(ctx: TechQueueContext, id: string): Promise<TQTicket | null> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('id', '=', id).select(this.cols).executeTakeFirst().catch(() => undefined);
    if (!r) return null; const techMap = await this._techMap(ctx); return this.rowToTicket(r, techMap);
  }
  /** The board's working set: every ticket still OPEN (whenever it was made) plus the closed ones of the branch's day.
   *  200-technician mandate §26/§33 (Oct 23 2026): it read EVERY ticket the tenant ever had, all time, on every board
   *  load and lane read — at 200 technicians that grows by thousands a week. Closed tickets of earlier days are history
   *  (reports read them), never the live board. Served by idx_pos_tech_queue_tickets_tenant_branch_status (+ created_at). */
  private async loadAll(ctx: TechQueueContext): Promise<TQTicket[]> {
    const day = await this.branchDay(ctx);
    const CLOSED = ['service_done', 'declined', 'expired', 'cancelled', 'no_show'];
    const rows = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx)
      .where((eb: any) => eb.or([eb('status', 'not in', CLOSED), eb('created_at', '>=', day.start), eb('updated_at', '>=', day.start)]))
      .select(this.cols).orderBy('assigned_at', 'asc').orderBy('id', 'asc').execute();   // a failed read is an error, never "an empty floor"
    const techMap = await this._techMap(ctx); return rows.map((r: any) => this.rowToTicket(r, techMap));
  }

  /** §33: per technician, her Fair Turn state today (HOLD + reason) and the minutes to her next appointment today; whether the
   *  salon's appointment protection is on. A salon without a branch (or without a turn day yet) has no holds. */
  private async laneSignals(ctx: TechQueueContext, ids: string[]): Promise<{ turn: Map<string, { status: string; holdReason: string | null }>; nextIn: Map<string, number>; protection: boolean }> {
    const turn = new Map<string, { status: string; holdReason: string | null }>(); const nextIn = new Map<string, number>();
    if (!ctx.branchId || !ids.length) return { turn, nextIn, protection: false };
    const nowMs = Date.now();
    const day = await readTurnDay(this.db, ctx.tenantId, ctx.branchId, nowMs);
    for (const r of day.rows) turn.set(r.technicianId, { status: r.status, holdReason: r.holdReason ?? null });
    const appts = await this.db.selectFrom('pos_tech_appointments').select(['technician_id', 'start_time']).where('tenant_id', '=', ctx.tenantId)
      .where('technician_id', 'in', ids).where('appt_date', '=', day.businessDate).where('status', 'in', ['confirmed', 'scheduled', 'booked', 'checked_in']).execute();
    for (const a of appts) {
      const at = localDateTimeToEpochMs(day.businessDate, String(a.start_time).slice(0, 5), day.timeZone);
      if (!Number.isFinite(at) || at < nowMs) continue;
      const m = Math.round((at - nowMs) / 60000); const tid = String(a.technician_id);
      if (!nextIn.has(tid) || m < nextIn.get(tid)!) nextIn.set(tid, m);
    }
    return { turn, nextIn, protection: !!day.ctx.policy.appointmentProtectionEnabled };
  }

  /** One lane per technician — or only the technicians in `only` (200-technician §2: a paged board builds its page's lanes). */
  async lanes(ctx: TechQueueContext, only?: Set<string>, loaded?: { all: TQTicket[]; techMap: Record<string, TechInfo> }): Promise<POSTechQueueTechnicianLane[]> {
    const all = loaded?.all ?? await this.loadAll(ctx); const techMap = loaded?.techMap ?? await this._techMap(ctx);
    return Object.entries(techMap).filter(([techId]) => !only || only.has(techId)).map(([techId, tech]) => {
      const tickets = all.filter((t) => t.assignedTechId === techId && !['cancelled', 'declined'].includes(t.status));
      return {
        technicianId: techId, technicianName: tech.name, workingStatus: tech.workingStatus,
        activeTicketCount: tickets.filter((t) => !['in_service'].includes(t.status)).length, acceptedTicketCount: tickets.filter((t) => ['accepted', 'ready_to_start'].includes(t.status)).length,
        delayedTicketCount: tickets.filter((t) => t.status === 'delayed' || this.effectiveDelay(t) === 'late' || this.effectiveDelay(t) === 'critical').length,
        estimatedWorkloadMinutes: workloadMinutes(tickets.map((t) => ({ requestedServices: t.services, status: t.status }))), tickets: tickets.map((t) => this.toRow(ctx, t)),
      };
    });
  }

  /** TECH QUEUE extras #11: today's throughput (salon day of the branch) — checked-in guests, completed services, service minutes */
  async throughput(ctx: TechQueueContext): Promise<TechQueueThroughput> {
    const bday = await this.branchDay(ctx);
    const end = new Date(localDateTimeToEpochMs(addDays(bday.today, 1), '00:00', bday.tz));
    const inRow = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('checked_in_at', '>=', bday.start).where('checked_in_at', '<', end)
      .select(sql<number>`count(*)`.as('n')).executeTakeFirst();
    const doneRow = await this.scoped(this.db.selectFrom('tickets'), ctx).where('service_done_at', '>=', bday.start).where('service_done_at', '<', end)
      .select([sql<number>`count(*)`.as('n'), sql<number>`count(*) filter (where serving_started_at is not null and serving_started_at <= service_done_at)`.as('timed'),
        sql<number>`coalesce(sum(extract(epoch from (service_done_at - serving_started_at)) / 60.0) filter (where serving_started_at is not null and serving_started_at <= service_done_at), 0)`.as('mins')])
      .executeTakeFirst();
    return buildTechQueueThroughput({ businessDate: bday.today, timeZone: bday.tz },
      { checkedInGuests: Number(inRow?.n ?? 0), completedServices: Number(doneRow?.n ?? 0), serviceMinutes: Number(doneRow?.mins ?? 0), timedServices: Number(doneRow?.timed ?? 0) });
  }

  // Hourly utilization trend for today (real, scoped): service sessions vs scheduled shift windows, bucketed per hour
  // from the first scheduled hour through the current hour (never future hours).
  private async utilizationTrend(ctx: TechQueueContext): Promise<TechQueueTrendPoint[]> {
    const bday = await this.branchDay(ctx);   // the BRANCH's day and its midnight (Oct 3 2026 — was the UTC day)
    const sessRows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('serving_started_at', 'is not', null).where('serving_started_at', '>=', bday.start)
      .select([sql<string>`serving_started_at`.as('s'), sql<string>`coalesce(service_done_at, now())`.as('e')]).execute().catch(() => []);
    const sessions = (sessRows as any[]).map((r) => ({ startMs: new Date(r.s).getTime(), endMs: new Date(r.e).getTime() })).filter((x) => x.endMs > x.startMs);
    const shiftRows = await this.scoped(this.db.selectFrom('technician_shifts'), ctx)
      .where(sql<boolean>`shift_date::date = ${bday.today}::date`).where('start_time', 'is not', null).where('end_time', 'is not', null).where('status', 'not in', ['cancelled', 'canceled'])
      .select(['start_time as s', 'end_time as e']).execute().catch(() => []);
    // a shift's start and end are clock-in/out INSTANTS; the hours are the branch's (Oct 6 2026 — the instants were cut to
    // their UTC time of day and laid on the date, and the hours were the server's UTC hours: a 9 am–5 pm shift in New
    // York charted as 1 pm–9 pm)
    const tz = bday.tz; const at = (d: string, hhmm: string) => localDateTimeToEpochMs(d, hhmm, tz); const hourOf = (ms: number) => zonedParts(new Date(ms), tz).hour;
    const shifts = (shiftRows as any[]).map((r) => ({ startMs: new Date(r.s).getTime(), endMs: new Date(r.e).getTime() })).filter((x) => x.endMs > x.startMs);
    if (!shifts.length) return [];
    const firstHour = Math.min(...shifts.map((s) => hourOf(s.startMs)));
    const nowHour = hourOf(this.now());
    const lastHour = Math.max(firstHour, Math.min(nowHour, Math.max(...shifts.map((s) => hourOf(s.endMs - 1)))));
    const hh = (h: number) => String(h).padStart(2, '0') + ':00';
    const windows: { hour: number; startMs: number; endMs: number }[] = [];
    for (let h = firstHour; h <= lastHour; h++) windows.push({ hour: h, startMs: at(bday.today, hh(h)), endMs: h < 23 ? at(bday.today, hh(h + 1)) : at(addDays(bday.today, 1), '00:00') });
    return computeUtilizationTrend(sessions, shifts, windows);
  }

  async query(ctx: TechQueueContext, f: TechQueueFilters): Promise<POSTechQueueFullState> {
    const all = await this.loadAll(ctx); const cat = await this._catalog(ctx); const techMap = await this._techMap(ctx);
    let rows = all.slice();
    if (f.search) { const s = f.search.toLowerCase(); rows = rows.filter((t) => [t.customerName, t.customerPhone, t.assignedTechName, t.notes, t.station, ...t.services.map((x) => x.serviceName)].some((x) => (x || '').toLowerCase().includes(s))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.source) rows = rows.filter((t) => t.source === f.source);
    if (f.priority) rows = rows.filter((t) => t.priority === f.priority);
    if (f.technicianId) rows = rows.filter((t) => t.assignedTechId === f.technicianId);
    if (f.serviceCategory) rows = rows.filter((t) => t.services.some((rs) => cat.find((s) => s.serviceId === rs.serviceId)?.categoryName === f.serviceCategory));
    if (f.station) rows = rows.filter((t) => t.station === f.station);
    if (f.delayStatus) rows = rows.filter((t) => this.effectiveDelay(t) === f.delayStatus);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageSlice = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    const pageCustIds = [...new Set(pageSlice.map((t) => t.customerId).filter(Boolean))];
    const pageCustRows = pageCustIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', pageCustIds).select(['id', 'avatar_url']).execute().catch(() => []) : [];
    const pageCustAvatarMap: Record<string, string> = {};
    for (const c of pageCustRows) { if (c.id && c.avatar_url) pageCustAvatarMap[c.id] = c.avatar_url; }
    const techAvatarMap: Record<string, string> = {};
    for (const [tid, info] of Object.entries(techMap)) { if (info.avatarUrl) techAvatarMap[tid] = info.avatarUrl; }
    const pageRows = pageSlice.map((t) => this.toRow(ctx, t, pageCustAvatarMap, techAvatarMap));
    const active = all.filter((t) => !['cancelled', 'declined', 'in_service'].includes(t.status));
    const waits = active.map((t) => this.assignedWait(t));
    const techVals = Object.values(techMap);
    // Day rollups (real, scoped) — each 0 when its source is empty so the UI shows "pending data", never a fake number.
    const laborRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('service_done_at', '>=', (await this.branchDay(ctx)).start)
      .select(sql<number>`coalesce(sum(subtotal_cents), 0)`.as('cents'))
      .executeTakeFirst().catch(() => undefined);
    const laborRevenueTodayCents = Math.max(0, Math.round(Number(laborRow?.cents || 0)));
    const doneTodayRows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('service_done_at', '>=', (await this.branchDay(ctx)).start)
      .select('id').execute().catch(() => []);
    const doneTodayIds = doneTodayRows.map((r: any) => r.id).filter(Boolean);
    let ticketsWithAddOn = 0;
    if (doneTodayIds.length) {
      const addonRows = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx)
        .where('ticket_id', 'in', doneTodayIds).where('is_add_on', '=', true)
        .select('ticket_id').distinct().execute().catch(() => []);
      ticketsWithAddOn = addonRows.length;
    }
    const upsellCapturePercent = computeUpsellCapturePercent(ticketsWithAddOn, doneTodayIds.length);
    const schedRow = await this.scoped(this.db.selectFrom('technician_shifts'), ctx)
      .where(sql<boolean>`shift_date::date = ${(await this.branchDay(ctx)).today}::date`)   // the branch's day
      .where('start_time', 'is not', null).where('end_time', 'is not', null)
      .where('status', 'not in', ['cancelled', 'canceled'])
      .select(sql<number>`coalesce(sum(extract(epoch from (end_time - start_time)) / 60.0), 0)`.as('mins'))
      .executeTakeFirst().catch(() => undefined);
    const scheduledMinutes = Math.max(0, Number(schedRow?.mins || 0));
    const actualRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('service_done_at', '>=', (await this.branchDay(ctx)).start).where('serving_started_at', 'is not', null)
      .select(sql<number>`coalesce(sum(extract(epoch from (service_done_at - serving_started_at)) / 60.0), 0)`.as('mins'))
      .executeTakeFirst().catch(() => undefined);
    const actualServiceMinutes = Math.max(0, Number(actualRow?.mins || 0));
    const utilizationTodayPercent = computeUtilizationPercent(actualServiceMinutes, scheduledMinutes);
    const kpis: POSTechQueueKpisFull = {
      assignedTickets: active.length, waitingForAcceptance: all.filter((t) => ['assigned', 'waiting_for_acceptance'].includes(t.status)).length, acceptedTickets: all.filter((t) => t.status === 'accepted').length,
      readyToStart: all.filter((t) => t.status === 'ready_to_start').length, delayedTickets: all.filter((t) => t.status === 'delayed' || this.effectiveDelay(t) === 'late' || this.effectiveDelay(t) === 'critical').length,
      activeTechnicians: new Set(active.map((t) => t.assignedTechId).filter(Boolean)).size, availableTechnicians: techVals.filter((t) => t.workingStatus === 'available').length,
      averageAssignedWaitMinutes: waits.length ? Math.round(waits.reduce((a, w) => a + w, 0) / waits.length) : 0,
      laborRevenueTodayCents,
      utilizationTodayPercent,
      upsellCapturePercent,
      scheduledTechnicians: 0, servicesInProgress: 0, waitingForAssignment: 0, avgTurnTimeMinutes: 0, // filled below
    };
    // ---- reference KPIs (real, scoped) ----
    kpis.servicesInProgress = all.filter((t) => t.status === 'in_service').length;
    kpis.avgTurnTimeMinutes = doneTodayIds.length ? Math.round(actualServiceMinutes / doneTodayIds.length) : 0;
    const schedTechRow = await this.scoped(this.db.selectFrom('technician_shifts'), ctx).where(sql<boolean>`shift_date::date = ${(await this.branchDay(ctx)).today}::date`).where('status', 'not in', ['cancelled', 'canceled']).select(sql<number>`count(distinct technician_id)`.as('n')).executeTakeFirst().catch(() => undefined);
    kpis.scheduledTechnicians = Math.max(kpis.activeTechnicians, Number(schedTechRow?.n || 0));
    // Customers awaiting tech assignment come from the authoritative Customer Queue (not a duplicate set).
    const cqWaiting = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('status', 'in', ['waiting', 'called']).where('assigned_technician_id', 'is', null).select(sql<number>`count(*)`.as('n')).executeTakeFirst().catch(() => undefined);
    kpis.waitingForAssignment = Number(cqWaiting?.n || 0);
    // Per-technician performance today (real, scoped): revenue/tips/rating/services attributed to each ticket's
    // primary technician for tickets serviced today. Empty when no completed work yet (UI shows nothing, never a fake).
    const perfRows = await this.scoped(this.db.selectFrom('tickets as t'), ctx, 't')
      .innerJoin('technicians as tk', 'tk.id', 't.primary_technician_id')
      .where('t.service_done_at', '>=', (await this.branchDay(ctx)).start)
      .select(['t.primary_technician_id as tid', 'tk.full_name as name',
        sql<number>`count(*)`.as('services'), sql<number>`coalesce(sum(t.subtotal_cents),0)`.as('rev'),
        sql<number>`avg(t.satisfaction_rating)`.as('rating')])
      .groupBy(['t.primary_technician_id', 'tk.full_name']).execute().catch(() => []);
    // ONE-PAY (Oct 13 2026): a technician's tips are HER share from the compensation snapshot (the one tip split) over the
    // branch day — the whole ticket tip used to be credited to the ticket's primary technician (a second tip allocation).
    const tipsBy = await this.snapshotTipsToday(ctx);
    const techPerformanceToday: TechPerfRow[] = (perfRows as any[]).map((r) => ({
      technicianId: r.tid, technicianName: r.name || '', avatarUrl: techMap[r.tid]?.avatarUrl ?? null, services: Number(r.services || 0), revenueCents: Math.max(0, Math.round(Number(r.rev || 0))),
      tipCents: tipsBy.get(String(r.tid)) ?? 0, ratingAvg: r.rating != null ? Math.round(Number(r.rating) * 10) / 10 : null,
    })).sort((a, b) => b.revenueCents - a.revenueCents);

    // ===== Reference (technician-centric) assembly — reuses lanes, perf, recommendation + utilization canon =====
    const techList = Object.entries(techMap).map(([technicianId, t]: any) => ({ technicianId, name: t.name, workingStatus: t.workingStatus, avatarUrl: t.avatarUrl || null, skills: t.skills }));
    // 200-technician §2 (Oct 27 2026): with lanePage the board's technician lists are ONE page (the lane rows, their lanes,
    // the available list, performance / mix rows) — the full roster is only counted, never shipped.
    const paged = f.lanePage != null;
    const lanePageSize = clampPageSize(f.lanePageSize, 10, TECH_QUEUE_LANE_PAGE_SIZE_MAX);
    const lanes = await this.lanes(ctx, undefined, { all, techMap });
    const utilMap = await loadTechUtilization(this.db, { tenantId: ctx.tenantId, branchId: ctx.branchId });
    const perfByTech = new Map(techPerformanceToday.map((p) => [p.technicianId, p]));
    const laneByTech = new Map(lanes.map((l) => [l.technicianId, l]));
    // order rotation: in_service first, then available, then break/offline
    const statusRank: Record<string, number> = { in_service: 0, available: 1, scheduled_later: 2, on_break: 3, off_today: 4 };
    const orderedTechs = techList.slice().sort((a, b) => (statusRank[a.workingStatus] ?? 9) - (statusRank[b.workingStatus] ?? 9) || a.name.localeCompare(b.name));
    const nextAvail = (ws: string) => (ws === 'available' ? 'Now' : ws === 'on_break' ? 'On break' : ws === 'off_today' ? 'Off' : 'Soon');
    // the code behind nextAvailableLabel — the POS labels it in the user's language (Vietnamese POS mandate)
    const nextAvailCode = (ws: string): TechQueueNextAvailable => (ws === 'available' ? 'now' : ws === 'on_break' ? 'on_break' : ws === 'off_today' ? 'off' : 'soon');
    // 200-technician §33 (Oct 26 2026): Hold and Appointment Soon, from the domain that owns them — the Fair Turn ledger's
    // HOLD (technician_turn_state, today) and her next appointment today inside the Fair Turn board's window
    // (APPOINTMENT_SOON_MINUTES, only when the salon's appointment protection is on). One read each for the whole branch.
    const signals = await this.laneSignals(ctx, techList.map((t) => t.technicianId));
    const technicianRows: TechQueueTechRow[] = orderedTechs.map((t, i) => {
      const lane = laneByTech.get(t.technicianId); const perf = perfByTech.get(t.technicianId);
      const inSvc = lane?.tickets?.find((tk) => tk.status === 'in_service' || tk.status === 'accepted' || tk.status === 'ready_to_start');
      const activeSvc = lane?.tickets?.find((tk) => tk.status === 'in_service' && tk.startedAt);
      let status: TQWorkingStatus | 'finishing_soon' = t.workingStatus;
      if (activeSvc) {
        const expected = (activeSvc.requestedServices || []).reduce((sum, rs) => sum + (rs.estimatedDurationMinutes || 0), 0);
        status = deriveFinishingSoon(activeSvc.startedAt ? new Date(activeSvc.startedAt).getTime() : null, expected, Date.now()) ? 'finishing_soon' : 'in_service';
      }
      const nextIn = signals.nextIn.get(t.technicianId) ?? null;
      const laneStatus = techQueueLaneStatus(status, { turnStatus: signals.turn.get(t.technicianId)?.status ?? null, nextAppointmentInMinutes: nextIn, protectionEnabled: signals.protection });
      return {
        rotationPosition: i + 1, technicianId: t.technicianId, technicianName: t.name, avatarUrl: t.avatarUrl || null, specialties: t.skills.slice(0, 3), status: laneStatus,
        nextAppointmentInMinutes: nextIn, holdReason: laneStatus === 'hold' ? (signals.turn.get(t.technicianId)?.holdReason ?? null) : null,
        guests: lane?.activeTicketCount ?? 0, currentServiceName: inSvc?.requestedServices?.[0]?.serviceName, currentServiceCustomer: inSvc?.customerName,
        nextAvailableLabel: nextAvail(t.workingStatus), nextAvailable: nextAvailCode(t.workingStatus), utilizationPercent: utilMap.get(t.technicianId) ?? null,
        tipsTodayCents: tipsBy.get(t.technicianId) ?? 0, revenueTodayCents: perf?.revenueCents ?? 0,
      };
    });
    // D1 Waiting Guests by Skill Match — from Customer Queue. "Best match" is NOT scored here any more (BUILD_PLAN Phase 6,
    // audit parallel implementation 1: this scorer ignored the requested technician, breaks, appointments and capacity).
    // TechQueueService fills it from the AI engine (QUEUE_RECOMMENDER); preferredTechName is the REQUESTED technician.
    const cqRows = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('status', 'in', ['waiting', 'called'])
      .select(['id', 'customer_id', 'customer_name', 'requested_services', 'priority', 'assigned_technician_id', 'requested_technician_id', 'checked_in_at', 'version']).orderBy('checked_in_at', 'asc').limit(8).execute().catch(() => []);
    const cqCustIds = [...new Set((cqRows as any[]).map((r) => r.customer_id).filter(Boolean))];
    const cqCustRows = cqCustIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', cqCustIds).select(['id', 'avatar_url']).execute().catch(() => []) : [];
    const cqAvatarMap: Record<string, string> = {};
    for (const c of cqCustRows) { if (c.id && c.avatar_url) cqAvatarMap[c.id] = c.avatar_url; }
    const waitingGuests: TechQueueWaitingGuest[] = (cqRows as any[]).map((r) => {
      const svcs = typeof r.requested_services === 'string' ? JSON.parse(r.requested_services || '[]') : (r.requested_services || []);
      const reqId = r.requested_technician_id || r.assigned_technician_id;
      const reqName = reqId ? (techMap[reqId]?.name) : undefined;
      const photo = r.customer_id ? cqAvatarMap[r.customer_id] : null;
      return {
        queueItemId: r.id, customerId: r.customer_id, customerName: r.customer_name || '', avatarUrl: photo ? buildMediaUrl(photo) : null, customerAvatarUrl: photo ? buildMediaUrl(photo) : null,
        serviceName: svcs?.[0]?.serviceName || '—', preferredTechName: reqName, priority: (['normal', 'high', 'vip', 'urgent'].includes(r.priority) ? r.priority : 'normal'),
        waitMinutes: Math.max(0, Math.floor((Date.now() - new Date(r.checked_in_at).getTime()) / 60000)),
        version: Number(r.version ?? 1), assignedTechnicianId: r.assigned_technician_id ?? null,
      };
    });
    // D3 Available Technicians
    const availableTechnicians: TechQueueAvailRow[] = techList.filter((t) => ['available', 'on_break', 'off_today'].includes(t.workingStatus))
      .map((t) => ({ technicianId: t.technicianId, technicianName: t.name, avatarUrl: t.avatarUrl || null, status: t.workingStatus, nextAvailableLabel: nextAvail(t.workingStatus), nextAvailable: nextAvailCode(t.workingStatus), specialties: t.skills.slice(0, 3) }));
    // E3 Assignment Source (real) + E4 Top Revenue Techs (real) + E2 Service Mix by tech (real) + E1 trend (snapshot-backed)
    const asrc = buildAssignmentSourceMix(all);
    const topRevenueTechs = techPerformanceToday.slice(0, 5).map((p) => ({ technicianId: p.technicianId, technicianName: p.technicianName, revenueCents: p.revenueCents }));
    let serviceMixByTechnician: TechQueueServiceMixCol[] = []; const mixCategories = new Set<string>();
    if (doneTodayIds.length) {
      const mixRows = await this.scoped(this.db.selectFrom('ticket_service_lines as l'), ctx, 'l')
        .innerJoin('tickets as t', 't.id', 'l.ticket_id').leftJoin('services as s', 's.id', 'l.service_id').leftJoin('service_categories as sc', 'sc.id', 's.category_id')
        .where('l.ticket_id', 'in', doneTodayIds)
        // Nov 6 2026: the technician who did the LINE (else the ticket's primary); a ticket with neither had a null column —
        // its name was null and the Tech Queue screen crashed on it ("Something went wrong on this screen")
        .where(sql<boolean>`coalesce(l.technician_id, t.primary_technician_id) is not null`)
        .select([sql<string>`coalesce(l.technician_id, t.primary_technician_id)`.as('tid'), sql<string>`coalesce(sc.name, 'Other')`.as('category'), sql<number>`count(*)`.as('cnt'), sql<number>`coalesce(sum(l.line_total_cents),0)`.as('rev')])
        .groupBy([sql`coalesce(l.technician_id, t.primary_technician_id)`, sql`coalesce(sc.name, 'Other')`]).execute().catch(() => []);
      const byTech = new Map<string, { category: string; count: number; revenueCents: number }[]>();
      for (const r of mixRows) { mixCategories.add(r.category); const arr = byTech.get(r.tid) || []; arr.push({ category: r.category, count: Number(r.cnt || 0), revenueCents: Math.round(Number(r.rev || 0)) }); byTech.set(r.tid, arr); }
      serviceMixByTechnician = [...byTech.entries()].map(([tid, cells]) => {
        const total = cells.reduce((a, c) => a + c.count, 0) || 1;
        return { technicianId: tid, technicianName: techMap[tid]?.name || '', cells: cells.map((c) => ({ category: c.category, count: c.count, revenueCents: c.revenueCents, percent: Math.round((c.count / total) * 100) })) };
      });
    }
    const analytics: TechQueueAnalytics = {
      utilizationTrend: await this.utilizationTrend(ctx), serviceMixByTechnician, serviceCategories: [...mixCategories], assignmentSource: asrc.slices, assignmentSourceTotal: asrc.total, topRevenueTechs,
      throughput: await this.throughput(ctx),
    };
    // Deterministic insights from current data
    const insights: TechQueueInsight[] = [];
    const overtime = technicianRows.filter((r) => (r.utilizationPercent ?? 0) >= 90).length;
    // `vars` carry the numbers / name so the POS writes the insight in the user's language (id = the insight's code)
    if (overtime > 0) insights.push({ id: 'ot', text: `${overtime} tech${overtime === 1 ? '' : 's'} nearing overtime`, sub: 'Monitor schedule to avoid overtime.', action: 'Review Now', route: '/tenant/team/members', severity: 'warn', vars: { count: overtime } });
    const topUp = techPerformanceToday[0];
    if (topUp) insights.push({ id: 'up', text: `${topUp.technicianName} leads revenue today`, sub: `${money(topUp.revenueCents)} from ${topUp.services} services.`, action: 'View', route: '/tenant/reports', vars: { name: topUp.technicianName, revenueCents: topUp.revenueCents, services: topUp.services } });
    if (kpis.waitingForAssignment > 0) insights.push({ id: 'wait', text: `${kpis.waitingForAssignment} guest${kpis.waitingForAssignment === 1 ? '' : 's'} waiting for assignment`, sub: 'Consider reassigning for a better skill match.', action: 'Auto Balance Queue', route: '/queue', vars: { count: kpis.waitingForAssignment } });
    const kpiTrends = await new PosKpiSnapshots(this.db).snapshotAndTrends(ctx.tenantId, ctx.branchId, 'tech_queue', {
      active: kpis.activeTechnicians, available: kpis.availableTechnicians, inProgress: kpis.servicesInProgress, waiting: kpis.waitingForAssignment,
      avgTurn: kpis.avgTurnTimeMinutes, utilization: kpis.utilizationTodayPercent, laborRevenue: kpis.laborRevenueTodayCents, upsell: kpis.upsellCapturePercent,
    }, ['avgTurn', 'waiting']);
    if (paged) {
      // the Workload Board columns are counted over every technician, but carry at most WORKLOAD_PREVIEW of each
      const col = (pred: (r: TechQueueTechRow) => boolean) => { const hit = technicianRows.filter(pred); return { count: hit.length, items: hit.slice(0, WORKLOAD_PREVIEW) }; };
      const workload: TechQueueWorkload = {
        available: col((r) => r.status === 'available'), inProgress: col((r) => r.status === 'in_service' && !!r.currentServiceName),
        finishing: col((r) => r.status === 'finishing_soon'), breakOffline: col((r) => r.status === 'on_break' || r.status === 'hold' || r.status === 'off_today'),
      };
      const pg = pageTechQueueLanes(technicianRows, f.laneSearch, f.laneStatus, f.lanePage, lanePageSize);
      const onPage = new Set(pg.items.map((r) => r.technicianId));
      const utilOf = (tid: string) => utilMap.get(tid) ?? null;
      analytics.serviceMixByTechnician = analytics.serviceMixByTechnician.slice(0, SERVICE_MIX_COLUMNS);
      return {
        kpis, kpiTrends, technicianRows: pg.items, waitingGuests, availableTechnicians: availableTechnicians.slice(0, lanePageSize), availableTechniciansTotal: availableTechnicians.length,
        analytics, insights, workload,
        lanes: { page: pg.page, pageSize: lanePageSize, total: pg.total, totalPages: pg.totalPages, totalAll: technicianRows.length },
        technicianLanes: lanes.filter((l) => onPage.has(l.technicianId)), tickets: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
        filters: {
          statuses: ['assigned', 'waiting_for_acceptance', 'accepted', 'declined', 'ready_to_start', 'in_service', 'delayed', 'cancelled'], technicians: f.roster === 'none' ? [] : techVals.map((t) => t.name).filter(Boolean),
          serviceCategories: [...new Set(cat.map((s) => s.categoryName))], sources: ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'], priorityLevels: ['normal', 'high', 'vip', 'urgent'], stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean),
        },
        workflowSettings: this._settings(),
        techPerformanceToday: techPerformanceToday.slice(0, lanePageSize).map((p) => ({ ...p, utilizationPercent: utilOf(p.technicianId) })),
      };
    }
    return {
      kpis, kpiTrends, technicianRows, waitingGuests, availableTechnicians, analytics, insights,
      technicianLanes: lanes, tickets: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      filters: {
        statuses: ['assigned', 'waiting_for_acceptance', 'accepted', 'declined', 'ready_to_start', 'in_service', 'delayed', 'cancelled'], technicians: f.roster === 'none' ? [] : techVals.map((t) => t.name).filter(Boolean),
        serviceCategories: [...new Set(cat.map((s) => s.categoryName))], sources: ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'], priorityLevels: ['normal', 'high', 'vip', 'urgent'], stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean),
      },
      workflowSettings: this._settings(),
      techPerformanceToday,
    };
  }

  async detail(ctx: TechQueueContext, id: string): Promise<POSTechQueueTicketDetail | null> {
    const t = await this.ticket(ctx, id); if (!t) return null; const cat = await this._catalog(ctx); const techMap = await this._techMap(ctx);
    return { ...this.toRow(ctx, t), technicianEligible: this.techEligible(t, cat, techMap), technicianNotifiedAt: t.technicianNotifiedAt, customerNotifiedAt: t.customerNotifiedAt, delayReason: t.delayReason, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }] };
  }

  // ---- mutations (REAL) ----
  private async upd(ctx: TechQueueContext, id: string, set: any): Promise<boolean> {
    // Phase 12 (#27): a status in the write moves only a ticket the TECH_QUEUE_TICKET machine allows (a cancelled or
    // service-done ticket is not re-assigned or delayed back into the flow)
    const res = await this.scoped(this.db.updateTable('pos_tech_queue_tickets'), ctx).set({ ...set, updated_at: sql`now()` }).where('id', '=', id).where(set.status ? canMoveToSql(TECH_QUEUE_TICKET, set.status) : sql<boolean>`true`).executeTakeFirst().catch(() => undefined);
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }
  async setStatus(ctx: TechQueueContext, id: string, st: TQTicketStatus) {
    // Phase 12 (#27): the desk's decline / cancel — 409 on a move the machine does not list (declining a ticket already in
    // service, cancelling a finished one), conditional on the status read
    const cur: any = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).select(['status']).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    if (cur?.status) assertTransition(TECH_QUEUE_TICKET, cur.status, st);
    return this.upd(ctx, id, { status: st, ...(st === 'in_service' ? { started_at: sql`now()` } : {}) });
  }
  async accept(ctx: TechQueueContext, id: string, readyToStart: boolean, expectedVersion?: number | null) {
    // ONE accept write shared with the Technician App (tech-queue-offer.ts): the canAccept precondition + the TECH_QUEUE_TICKET
    // machine are enforced IN the write (status guard), and the optional version guard makes a stale click a no-op.
    return (await acceptOffer(this.db, { tenantId: ctx.tenantId, ticketId: id, readyToStart, expectedVersion })).accepted;
  }
  async decline(ctx: TechQueueContext, id: string, reason: string, expectedVersion?: number | null, reasonCode?: string | null) {
    // Fair Turn Engine §64–66: the guarded decline and its turn consequence commit together
    return this.db.transaction().execute(async (trx) => {
      const ok = (await declineOffer(trx, { tenantId: ctx.tenantId, ticketId: id, reason, expectedVersion })).declined;
      if (!ok) return false;
      const t: any = await trx.selectFrom('pos_tech_queue_tickets').select(['branch_id', 'assigned_technician_id', 'queue_item_id', 'ticket_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst();
      if (t?.branch_id && t.assigned_technician_id) await turnDecline(trx, { tenantId: ctx.tenantId, branchId: String(t.branch_id), technicianId: String(t.assigned_technician_id), queueItemId: t.queue_item_id ?? null, ticketId: t.ticket_id ?? null,
        reasonCode: reasonCode ?? null, reasonText: reason, actor: { userId: /^[0-9a-f-]{36}$/i.test(String(ctx.userId ?? '')) ? ctx.userId : null } }, { outbox: this.outbox ?? null });
      return true;
    });
  }
  async startServing(ctx: TechQueueContext, id: string) {
    // Atomic guard mirroring canMoveToServing: never move a cancelled/declined ticket (or one already serving) into
    // 'in_service'. The JS gate stays for the settings-based acceptance rules; this closes the resurrection race.
    // Fair Turn Engine §86: the technician turns SERVING in the same transaction.
    return this.db.transaction().execute(async (trx) => {
      const row: any = await this.scoped(trx.updateTable('pos_tech_queue_tickets'), ctx)
        .set({ status: 'in_service', started_at: sql`now()`, updated_at: sql`now()`, version: sql`version + 1` })
        .where('id', '=', id).where('status', 'not in', ['cancelled', 'declined', 'in_service']).where(canMoveToSql(TECH_QUEUE_TICKET, 'in_service'))
        .returning(['branch_id', 'assigned_technician_id', 'queue_item_id', 'ticket_id']).executeTakeFirst();
      if (!row) return false;
      if (row.branch_id && row.assigned_technician_id) await turnServiceStart(trx, { tenantId: ctx.tenantId, branchId: String(row.branch_id), technicianIds: [String(row.assigned_technician_id)], queueItemId: row.queue_item_id ?? null, ticketId: row.ticket_id ?? null,
        actor: { userId: /^[0-9a-f-]{36}$/i.test(String(ctx.userId ?? '')) ? ctx.userId : null } }, { outbox: this.outbox ?? null });
      return true;
    }).catch(() => false);
  }
  async reassign(ctx: TechQueueContext, id: string, technicianId: string, reason?: string | null) {
    const map = await this._techMap(ctx); if (!map[technicianId]) return false;
    const cur = await this.ticket(ctx, id); if (!cur) return false;
    const timeoutS = Number(DEFAULT_TQ_SETTINGS.acceptanceTimeoutSeconds) || 0;
    const deadlineExpr = timeoutS > 0 ? sql`now() + (${timeoutS} * interval '1 second')` : null;
    const set: any = { assigned_technician_id: technicianId, accepted_at: null, acceptance_deadline: deadlineExpr, assigned_at: sql`now()` };
    if (!['cancelled', 'declined', 'in_service'].includes(cur.status)) set.status = 'assigned';
    const ok = await this.upd(ctx, id, set);
    // Fair Turn Engine §68–72: a reassignment is a CORRECTION for the previous technician and an assignment for the new
    // one (staff source, reason on the event) — recorded right after the reassignment lands
    if (ok) {
      const t: any = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).select(['branch_id', 'queue_item_id', 'ticket_id']).where('id', '=', id).executeTakeFirst().catch(() => undefined);
      if (t?.branch_id && (t.queue_item_id || t.ticket_id)) {
        await this.db.transaction().execute(async (trx) => {
          if (cur.assignedTechId && cur.assignedTechId !== technicianId && t.queue_item_id) await turnUnassign(trx, { tenantId: ctx.tenantId, branchId: String(t.branch_id), queueItemId: String(t.queue_item_id), technicianId: cur.assignedTechId, reason: reason ?? 'reassigned', actor: { userId: ctx.userId ?? null } }, { outbox: this.outbox ?? null });
          await turnAssign(trx, { tenantId: ctx.tenantId, branchId: String(t.branch_id), technicianId, queueItemId: t.queue_item_id ?? null, ticketId: t.ticket_id ?? null, source: 'staff', reasonText: reason ?? null,
            recommendedTechnicianId: cur.assignedTechId ?? null, overrideReasonCode: 'MANAGER_DECISION', actor: { userId: ctx.userId ?? null } }, { outbox: this.outbox ?? null });
        });
      }
    }
    return ok;
  }
  async setServices(ctx: TechQueueContext, id: string, services: TQRequestedService[]) { return this.upd(ctx, id, { requested_services: JSON.stringify(services) }); }
  async setPriority(ctx: TechQueueContext, id: string, priority: TQPriority) { return this.upd(ctx, id, { priority }); }
  async setDelay(ctx: TechQueueContext, id: string, ds: TQDelayStatus, reason?: string) {
    const cur = await this.ticket(ctx, id); if (!cur) return false;
    const set: any = { delay_status: ds, delay_reason: reason ?? null };
    if (ds === 'none') { if (cur.status === 'delayed') set.status = 'accepted'; } else set.status = 'delayed';
    return this.upd(ctx, id, set);
  }
  async markTechNotified(ctx: TechQueueContext, id: string) { await this.upd(ctx, id, { technician_notified_at: sql`now()` }); }
  async markCustomerNotified(ctx: TechQueueContext, id: string) { await this.upd(ctx, id, { customer_notified_at: sql`now()` }); }
  async getServingKey(ctx: TechQueueContext, id: string): Promise<string | undefined> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_queue_tickets'), ctx).where('id', '=', id).select('serving_idempotency_key').executeTakeFirst().catch(() => undefined);
    return r ? (r.serving_idempotency_key || undefined) : undefined;
  }
  async setServingKey(ctx: TechQueueContext, id: string, key: string) { await this.upd(ctx, id, { serving_idempotency_key: key }); }
  async expireDueOffers(_nowMs: number): Promise<ExpiredOffer[]> {
    // Platform-wide system sweep (no tenant scope): flip every past-deadline, still-unaccepted offer to 'expired'.
    // The WHERE is the guard — already-accepted/started/cancelled offers (accepted_at set or other status) are untouched,
    // so this is safe to run on a timer and idempotent (a second pass finds nothing left to expire).
    const rows: any[] = await this.db.transaction().execute(async (trx) => {
      const expired: any[] = await trx.updateTable('pos_tech_queue_tickets')
        .set({ status: 'expired', updated_at: sql`now()` })
        .where('status', 'in', ['assigned', 'waiting_for_acceptance']).where(canMoveToSql(TECH_QUEUE_TICKET, 'expired') as any)
        .where('accepted_at', 'is', null)
        .where('acceptance_deadline', 'is not', null)
        .where("acceptance_deadline", "<=", sql<Date>`now()`)
        .returning(['id', 'tenant_id', 'branch_id', 'assigned_technician_id', 'ticket_id', 'queue_item_id'])
        .execute();
      // Fair Turn Engine §152–153: each expired offer returns the technician's turn; the salon's timeout consequence applies
      for (const r of expired) if (r.branch_id && r.assigned_technician_id) await turnOfferTimeout(trx, { tenantId: String(r.tenant_id), branchId: String(r.branch_id), technicianId: String(r.assigned_technician_id), queueItemId: r.queue_item_id ?? null, ticketId: r.ticket_id ?? null }, { outbox: this.outbox ?? null });
      // tech_queue.offer_expired — one per offer this pass actually expired, in the same transaction (a second pass finds
      // nothing and records nothing). A system sweep: no actor; ids only.
      if (this.outbox) for (const r of expired) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.TECH_OFFER_EXPIRED, tenantId: String(r.tenant_id),
        branchId: r.branch_id ?? undefined, aggregateType: 'tech_queue_ticket', aggregateId: String(r.id), actorType: 'system',
        correlationId: r.ticket_id ? `ticket:${r.ticket_id}` : undefined, payload: { techQueueTicketId: String(r.id), technicianId: r.assigned_technician_id ?? null, ticketId: r.ticket_id ?? null } }));
      return expired;
    }).catch(() => []);
    return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, technicianId: r.assigned_technician_id ?? null }));
  }

  async insertTechNotification(ctx: TechQueueContext, n: { technicianId: string; type: string; title: string; body?: string | null; reference?: string | null }): Promise<void> {
    await this.db.insertInto('technician_notifications').values({
      tenant_id: ctx.tenantId, technician_id: n.technicianId, type: n.type, title: n.title, body: n.body ?? null, reference: n.reference ?? null,
    }).execute().catch(() => {});
  }
}
