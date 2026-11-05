// tech-appointments.kysely.repository.ts — production TechApptRepositoryPort over Postgres (Kysely).
// This is a near-fully-real adapter: pos_tech_appointments maps 1:1 to the model, so all appointment CRUD,
// reschedule/assign/status, the services array (JSONB), and the three idempotency keys (queue / tech-queue / serving)
// are REAL, persisted columns. The technician board reads the real technicians roster, and technician SKILL CATEGORIES
// are derived REAL from technician_services → services → service_categories (so skill-gated create/assign work without
// a manager override). The service catalog is real (services + service_categories). Scope is session-derived.
//
// Minor honest fallbacks (documented): technician availableMinutes uses a fixed per-day default (no per-day capacity
// table is consulted here); workingStatus is mapped from technician_statuses when present, else 'available'; today()
// is the server's current date.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, assertTransition, canMoveToSql, InvalidStateTransitionError, type DB } from '@aipowersalon/database';
import { APPOINTMENT } from '../appointments/front-desk-lifecycles';
import { businessDate, localDateTimeToEpochMs } from '@aipowersalon/date-time';
import { recordAppointmentChanges } from '../appointments/appointment-change-log';
import { writeAppointmentSlot, overbookColumns } from '../appointments/appointment-slot-guard';
import type { TechApptContext, TechApptRepositoryPort, TAItem, TASlotOpts } from './tech-appointments.repository';
import {
  POSTechAppointmentsFullState, POSTechAppointmentItem, POSTechAppointmentTechnician, POSTechApptKpisFull, TechApptFilters,
  TAStatus, TASource, TADepositStatus, TAWorkingStatus, TAService, TechApptSettings, DEFAULT_TA_SETTINGS,
  addMinutesToTime, durationOfServices, detectTechnicianConflict,
} from './tech-appointments.dto';
import { projectionDeliversRealtime } from '@aipowersalon/config';

import { buildMediaUrl } from '@aipowersalon/media';

const DEFAULT_AVAIL_MIN = 600;
const WORKING: TAWorkingStatus[] = ['available', 'in_service', 'on_break', 'off_today', 'scheduled_later'];
const parseServices = (v: any): TAService[] => { if (!v) return []; if (Array.isArray(v)) return v as TAService[]; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };
type ExRow = { appointmentId: string; technicianId: string; customerId?: string; startTime: string; endTime: string; status: TAStatus };

export class KyselyTechApptRepository implements TechApptRepositoryPort {
  private seq = Date.now() % 1000000;
  // Constitution 8 §18/§60: this repository writes the SAME pos_tech_appointments table as the booking repo,
  // so it emits the SAME appointment.* events — one vocabulary for one fact, whichever screen caused it.
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null) {}
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }   // not merely "has an outbox": the publisher must be ON
  nextSeq() { return ++this.seq; }
  /** The clock (tests set it). */
  now: () => number = Date.now;
  /** Legacy: the server's UTC date. Every read below uses todayFor(ctx) — the BRANCH's day. */
  today() { return new Date(this.now()).toISOString().slice(0, 10); }
  /** BUILD_PLAN Phase 6, audit bug 2: the board and the AI's appointment lookup used the server's UTC date — after
   *  5 pm in Los Angeles that is already tomorrow, and the day's appointments vanished from the engine. */
  async todayFor(ctx: TechApptContext): Promise<string> { return businessDate(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId || null), new Date(this.now())); }
  /** appt_date + 'HH:MM' on the branch's wall clock → an ISO instant (null when either is missing / malformed). */
  private startAt(date: unknown, time: unknown, tz: string): string | null {
    const d = String(date ?? '').slice(0, 10), m = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !m) return null;
    const ms = localDateTimeToEpochMs(d, m[1].padStart(2, '0') + ':' + m[2], tz);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }

  private scoped(qb: any, ctx: TechApptContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }
  private _settings(): TechApptSettings { return DEFAULT_TA_SETTINGS; }
  async settings(_ctx: TechApptContext) { return this._settings(); }

  // ---- service catalog (real) ----
  private async _catalog(ctx: TechApptContext): Promise<{ serviceId: string; name: string; categoryName: string; durationMinutes: number; priceCents: number }[]> {
    // Service catalog is loaded tenant-wide (no branch filter) so cross-branch bookings always resolve correctly.
    const rows = await this.db.selectFrom('services as s').where('s.tenant_id', '=', ctx.tenantId).leftJoin('service_categories as c', 'c.id', 's.category_id')
      .select(['s.id as serviceId', 's.name as name', 'c.name as categoryName', 's.duration_minutes as dur', 's.price_cents as price']).execute().catch(() => []);
    return rows.map((r: any) => ({ serviceId: r.serviceId, name: r.name, categoryName: r.categoryName || 'General', durationMinutes: Number(r.dur || 0), priceCents: Number(r.price || 0) }));
  }
  async serviceCatalog(ctx: TechApptContext) { return this._catalog(ctx); }

  // ---- technicians (real roster + real skill categories via technician_services) ----
  private async _technicians(ctx: TechApptContext): Promise<{ technicianId: string; displayName: string; firstName: string; avatarUrl?: string | null; workingStatus: TAWorkingStatus; skills: string[]; availableMinutes: number }[]> {
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
    const skillBy: Record<string, Set<string>> = {}; for (const l of links) { (skillBy[l.tid] ||= new Set()).add(l.cat || 'General'); }
    const statBy: Record<string, string> = {}; for (const s of stat) statBy[s.technician_id] = s.status;
    return techs.map((t: any) => {
      const first = (t.full_name || '').split(' ')[0] || t.id; const ws = WORKING.includes(statBy[t.id] as TAWorkingStatus) ? (statBy[t.id] as TAWorkingStatus) : 'available';
      const rawPhoto = t.tech_avatar_url || t.gtp_avatar_url || t.user_avatar_url || null;
      return { technicianId: t.id, displayName: t.full_name || t.id, firstName: first, avatarUrl: rawPhoto ? buildMediaUrl(rawPhoto) : null, workingStatus: ws, skills: [...(skillBy[t.id] || [])], availableMinutes: ws === 'off_today' ? 0 : DEFAULT_AVAIL_MIN };
    });
  }
  async technicians(ctx: TechApptContext) { return this._technicians(ctx); }

  // ---- appointment rows (fully real over pos_tech_appointments) ----
  private rowToItem(ctx: TechApptContext, r: any, existing: ExRow[], custAvatarMap?: Record<string, string>, tz?: string): POSTechAppointmentItem {
    const services = parseServices(r.services);
    const conf = detectTechnicianConflict(existing, r.technician_id, r.start_time, r.end_time, this._settings().bufferMinutes, r.id);
    const custPhoto = r.customer_id ? custAvatarMap?.[r.customer_id] : null;
    return {
      appointmentId: r.id, tenantId: ctx.tenantId, branchId: ctx.branchId, technicianId: r.technician_id, customerId: r.customer_id || undefined, customerName: r.customer_name || '',
      customerAvatarUrl: custPhoto ? buildMediaUrl(custPhoto) : null, avatarUrl: custPhoto ? buildMediaUrl(custPhoto) : null,
      customerPhone: r.customer_phone || undefined, isVip: !!r.is_vip,
      source: r.source as TASource, services, startTime: r.start_time, endTime: r.end_time, durationMinutes: Number(r.duration_minutes || durationOfServices(services)), status: r.status as TAStatus,
      depositStatus: r.deposit_status as TADepositStatus, conflictStatus: conf.status, notes: r.notes || '',
      date: r.appt_date != null ? String(r.appt_date).slice(0, 10) : undefined, startAt: tz ? this.startAt(r.appt_date, r.start_time, tz) : undefined,
      // Smooth Refresh §15/§59 + §11: the optimistic-concurrency version (send back as expectedVersion) and the audited overbook flag (482)
      ...(r.version != null ? { version: Number(r.version) } : {}), ...(r.overbook_ok ? { overbooked: true } : {}),
    };
  }
  private rowToTAItem(r: any): TAItem {
    return { appointmentId: r.id, technicianId: r.technician_id, customerId: r.customer_id || undefined, customerName: r.customer_name || '', customerPhone: r.customer_phone || undefined, isVip: !!r.is_vip, source: r.source, services: parseServices(r.services), date: r.appt_date, startTime: r.start_time, endTime: r.end_time, status: r.status, depositStatus: r.deposit_status, notes: r.notes || '', queueKey: r.queue_idempotency_key || undefined, techQueueKey: r.tech_queue_idempotency_key || undefined, servingKey: r.serving_idempotency_key || undefined, createdAt: '', updatedAt: '', ...(r.version != null ? { version: Number(r.version) } : {}) };
  }
  // appt_date read as TEXT: a DATE parsed into a JS Date shifts with the server's zone
  private cols = ['id', 'technician_id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'source', 'services', sql<string>`appt_date::text`.as('appt_date'), 'start_time', 'end_time', 'duration_minutes', 'status', 'deposit_status', 'notes', 'queue_idempotency_key', 'tech_queue_idempotency_key', 'serving_idempotency_key', 'version', 'overbook_ok'] as const;

  async appointment(ctx: TechApptContext, id: string): Promise<TAItem | null> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.cols as any).executeTakeFirst().catch(() => undefined);
    return r ? this.rowToTAItem(r) : null;
  }
  async existingForConflict(ctx: TechApptContext, date: string): Promise<ExRow[]> {
    const rows = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', date).select(['id', 'technician_id', 'customer_id', 'start_time', 'end_time', 'status']).execute().catch(() => []);
    return rows.map((a: any) => ({ appointmentId: a.id, technicianId: a.technician_id, customerId: a.customer_id || undefined, startTime: a.start_time, endTime: a.end_time, status: a.status as TAStatus }));
  }
  async detail(ctx: TechApptContext, id: string): Promise<POSTechAppointmentItem | null> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.cols as any).executeTakeFirst().catch(() => undefined);
    if (!r) return null; const existing = await this.existingForConflict(ctx, (r as any).appt_date);
    return this.rowToItem(ctx, r, existing, undefined, await branchTimeZone(this.db, ctx.tenantId, ctx.branchId || null));
  }

  private techColumn(t: any, dayRows: any[]): POSTechAppointmentTechnician {
    const mine = dayRows.filter((a) => a.technician_id === t.technicianId && !['cancelled', 'no_show'].includes(a.status));
    const scheduled = mine.reduce((acc, a) => acc + Number(a.duration_minutes || durationOfServices(parseServices(a.services))), 0);
    return { technicianId: t.technicianId, displayName: t.displayName, firstName: t.firstName, workingStatus: t.workingStatus, appointmentCount: mine.length, scheduledMinutes: scheduled, availableMinutes: t.availableMinutes, serviceSkillGroups: t.skills };
  }

  async query(ctx: TechApptContext, f: TechApptFilters): Promise<POSTechAppointmentsFullState> {
    const date = f.date || await this.todayFor(ctx);   // the BRANCH's day (audit bug 2)
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId || null);
    const dayRows = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', date).select(this.cols as any).execute().catch(() => []);
    const existing: ExRow[] = dayRows.map((a: any) => ({ appointmentId: a.id, technicianId: a.technician_id, customerId: a.customer_id || undefined, startTime: a.start_time, endTime: a.end_time, status: a.status as TAStatus }));
    const cat = await this._catalog(ctx); const buf = this._settings().bufferMinutes;
    let rows = dayRows.slice();
    if (f.search) { const s = f.search.toLowerCase(); rows = rows.filter((a: any) => [a.customer_name, a.customer_phone, a.notes, ...parseServices(a.services).map((x) => x.serviceName)].some((x) => (x || '').toLowerCase().includes(s))); }
    if (f.technicianId) rows = rows.filter((a: any) => a.technician_id === f.technicianId);
    if (f.status) rows = rows.filter((a: any) => a.status === f.status);
    if (f.source) rows = rows.filter((a: any) => a.source === f.source);
    if (f.serviceCategory) rows = rows.filter((a: any) => parseServices(a.services).some((rs) => cat.find((s) => s.serviceId === rs.serviceId)?.categoryName === f.serviceCategory));
    if (f.depositStatus) rows = rows.filter((a: any) => a.deposit_status === f.depositStatus);
    if (f.conflictOnly) rows = rows.filter((a: any) => detectTechnicianConflict(existing, a.technician_id, a.start_time, a.end_time, buf, a.id).status !== 'none');
    const conflictCount = dayRows.filter((a: any) => detectTechnicianConflict(existing, a.technician_id, a.start_time, a.end_time, buf, a.id).status !== 'none').length;
    const kpis: POSTechApptKpisFull = {
      totalAppointmentsToday: dayRows.length, bookedAppointments: dayRows.filter((a: any) => ['booked', 'confirmed'].includes(a.status)).length, checkedInAppointments: dayRows.filter((a: any) => a.status === 'checked_in').length,
      inServiceAppointments: dayRows.filter((a: any) => a.status === 'in_service').length, completedAppointments: dayRows.filter((a: any) => a.status === 'completed').length, cancelledAppointments: dayRows.filter((a: any) => a.status === 'cancelled').length,
      noShowAppointments: dayRows.filter((a: any) => a.status === 'no_show').length, onlineBookings: dayRows.filter((a: any) => a.source === 'online' || a.source === 'customer_app').length, aiBookings: dayRows.filter((a: any) => a.source === 'ai').length,
      googleBookings: dayRows.filter((a: any) => a.source === 'google').length, conflictCount,
    };
    const techs = await this._technicians(ctx);
    const custIds = [...new Set(dayRows.map((a: any) => a.customer_id).filter(Boolean))];
    const custRows = custIds.length ? await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', custIds).select(['id', 'avatar_url']).execute().catch(() => []) : [];
    const custAvatarMap: Record<string, string> = {};
    for (const c of custRows as any[]) { if (c.id && c.avatar_url) custAvatarMap[c.id] = c.avatar_url; }
    return {
      kpis, date, technicians: techs.map((t) => this.techColumn(t, dayRows)), appointments: rows.map((a: any) => this.rowToItem(ctx, a, existing, custAvatarMap, tz)),
      filters: {
        statuses: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'], sources: ['walk_in', 'phone', 'online', 'google', 'ai', 'customer_app', 'manual'],
        serviceCategories: [...new Set(cat.map((s) => s.categoryName))], technicians: techs.map((t) => ({ technicianId: t.technicianId, name: t.displayName })), branches: [{ branchId: ctx.branchId || 'br_cherryhill', name: 'Cherry Hill' }],
      },
      settings: this._settings(),
    };
  }

  /** Merge Oct 12 2026 (booking concurrency): this surface wrote pos_tech_appointments with NO lock and no re-check — the
   *  Booking board, the customer app and this screen could all pass their pre-checks and insert the same slot. Every
   *  time-changing write now goes through the shared appointment-slot-guard (technician+day advisory lock, in-transaction
   *  re-check, 23P01 → AppointmentSlotConflict), and an allowed overbook is written FLAGGED (482) instead of unguarded. */
  async create(ctx: TechApptContext, item: TAItem, opts?: TASlotOpts): Promise<POSTechAppointmentItem> {
    const ins = await writeAppointmentSlot(this.db, {
      tenantId: ctx.tenantId, technicianId: item.technicianId, date: item.date, startTime: item.startTime, endTime: item.endTime,
      bufferMinutes: opts?.bufferMinutes ?? 0, allowOverbook: !!opts?.allowOverbook,
      write: async (trx, overlap) => {
        const r = await trx.insertInto('pos_tech_appointments').values({
          tenant_id: ctx.tenantId, branch_id: ctx.branchId, technician_id: item.technicianId, customer_id: item.customerId || null, customer_name: item.customerName, customer_phone: item.customerPhone || null, is_vip: item.isVip,
          source: item.source, services: JSON.stringify(item.services) as any, appt_date: item.date, start_time: item.startTime, end_time: item.endTime, duration_minutes: durationOfServices(item.services), status: item.status, deposit_status: item.depositStatus, notes: item.notes || null,
          ...(overlap.overlaps ? overbookColumns(overlap, opts?.overbookReason, ctx.userId) : {}),
        } as any).returning(['id']).executeTakeFirstOrThrow();
        if (this.outbox) await this.outbox.write(trx as any, createDomainEvent({
          eventType: DOMAIN_EVENTS.APPOINTMENT_CREATED, tenantId: ctx.tenantId, branchId: ctx.branchId,
          aggregateType: 'appointment', aggregateId: (r as any).id, actorId: ctx.userId, actorType: 'user',
          // §95: ids + scheduling facts; the customer's name and phone stay in the row
          payload: { appointmentId: (r as any).id, technicianId: item.technicianId, customerId: item.customerId || null,
                     date: item.date, startTime: item.startTime, endTime: item.endTime, source: item.source, serviceCount: (item.services || []).length },
        }));
        return r;
      },
    });
    const id = (ins as any).id; const existing = await this.existingForConflict(ctx, item.date);
    return this.rowToItem(ctx, { id, technician_id: item.technicianId, customer_id: item.customerId, customer_name: item.customerName, customer_phone: item.customerPhone, is_vip: item.isVip, source: item.source, services: item.services, appt_date: item.date, start_time: item.startTime, end_time: item.endTime, duration_minutes: durationOfServices(item.services), status: item.status, deposit_status: item.depositStatus, notes: item.notes }, existing, undefined, await branchTimeZone(this.db, ctx.tenantId, ctx.branchId || null));
  }
  async update(ctx: TechApptContext, id: string, patch: Partial<TAItem>, opts?: TASlotOpts): Promise<boolean> {
    const cur = await this.appointment(ctx, id); if (!cur) return false;
    const set: any = { updated_at: sql`now()` };
    if (patch.customerName !== undefined) set.customer_name = patch.customerName;
    if (patch.customerPhone !== undefined) set.customer_phone = patch.customerPhone || null;
    if (patch.notes !== undefined) set.notes = patch.notes || null;
    if (patch.isVip !== undefined) set.is_vip = patch.isVip;
    if (patch.technicianId !== undefined) set.technician_id = patch.technicianId;
    if (patch.services) { set.services = JSON.stringify(patch.services); set.duration_minutes = durationOfServices(patch.services); set.end_time = addMinutesToTime(cur.startTime, durationOfServices(patch.services)); }
    // A service change can lengthen the visit into the next booking, and a technician change puts it in another day:
    // same lock + re-check as a move. Errors are never swallowed — a refused write must not report success.
    const slotChanges = !!patch.services || (patch.technicianId !== undefined && patch.technicianId !== cur.technicianId);
    await writeAppointmentSlot(this.db, {
      tenantId: ctx.tenantId, appointmentId: id, technicianId: slotChanges ? (patch.technicianId ?? cur.technicianId) : null, date: cur.date, startTime: cur.startTime,
      endTime: set.end_time ?? cur.endTime, bufferMinutes: opts?.bufferMinutes ?? 0, allowOverbook: !!opts?.allowOverbook, expectedVersion: opts?.expectedVersion,
      write: async (trx, overlap) => {
        const r: any = await this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ ...set, ...(overlap.overlaps ? overbookColumns(overlap, opts?.overbookReason, ctx.userId) : {}) }).where('id', '=', id).executeTakeFirst();
        if (Number(r?.numUpdatedRows ?? 0) === 0) throw new Error('Appointment vanished during the update');
      },
    });
    return true;
  }
  // Best-effort, append-only change recorder for Super Admin → Change History. Uses the query builder (never raw
  // SQL in a tenant repo) and swallows all errors: audit logging must NEVER break or roll back a real mutation.
  private async recordChanges(ctx: TechApptContext, appointmentId: string, changeType: string, changes: { field: string; old: unknown; new: unknown }[]): Promise<void> {
    await recordAppointmentChanges(
      this.db,
      { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, actorType: ctx.role ?? null, actorId: ctx.userId ?? null, source: 'tech_app' },
      appointmentId, changeType, changes,
    );
  }

  async setStatus(ctx: TechApptContext, id: string, st: TAStatus): Promise<boolean> {
    const before = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(['status']).executeTakeFirst().catch(() => undefined);
    const STATUS_EVENT: Partial<Record<string, typeof DOMAIN_EVENTS[keyof typeof DOMAIN_EVENTS]>> = {
      confirmed: DOMAIN_EVENTS.APPOINTMENT_CONFIRMED, completed: DOMAIN_EVENTS.APPOINTMENT_COMPLETED,
      cancelled: DOMAIN_EVENTS.APPOINTMENT_CANCELED, no_show: DOMAIN_EVENTS.APPOINTMENT_NO_SHOW,
      checked_in: DOMAIN_EVENTS.CUSTOMER_CHECKED_IN,
    };
    // Phase 12 (#27): the move goes through the APPOINTMENT machine (409 on a move it does not list — e.g. cancelling a
    // completed visit), and the UPDATE is conditional on the status read: a concurrent writer gets 409, not a lost update.
    const from = (before as any)?.status as string | undefined;
    if (from) assertTransition(APPOINTMENT, from, st);
    let raced = false;
    const done = await this.db.transaction().execute(async (trx) => {
      let q = this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ status: st, updated_at: sql`now()` } as any).where('id', '=', id).where(canMoveToSql(APPOINTMENT, st) as any);
      if (from) q = q.where('status', '=', from);
      const res = await q.executeTakeFirst();
      const ok = Number((res as any)?.numUpdatedRows ?? 0) > 0;
      if (!ok) { raced = !!from; return false; }
      await this.recordChanges(ctx, id, 'status_changed', [{ field: 'status', old: (before as any)?.status, new: st }]);
      const eventType = STATUS_EVENT[st];
      if (eventType && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'appointment', aggregateId: id,
        actorId: ctx.userId, actorType: 'user', payload: { appointmentId: id, previousStatus: (before as any)?.status ?? null, status: st },
      }));
      return true;
    }).catch(() => false);
    if (raced) { const now: any = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(['status']).executeTakeFirst().catch(() => undefined); if (now) throw new InvalidStateTransitionError(APPOINTMENT, now.status, st, 'concurrent'); }
    return done;
  }
  async reschedule(ctx: TechApptContext, id: string, technicianId: string | undefined, startTime: string, date: string | undefined, opts?: TASlotOpts): Promise<boolean> {
    const cur = await this.appointment(ctx, id); if (!cur) return false;
    const endTime = addMinutesToTime(startTime, durationOfServices(cur.services));
    // a cancelled / no-show visit that is rescheduled is booked again (the one revival the APPOINTMENT machine lists);
    // any other status is kept — and only re-written (through the machine, conditional on it) when it changes
    const newStatus = cur.status === 'no_show' || cur.status === 'cancelled' ? 'booked' : cur.status;
    const move: any = { start_time: startTime, end_time: endTime, updated_at: sql`now()` };
    if (technicianId) move.technician_id = technicianId; if (date) move.appt_date = date;
    if (newStatus !== cur.status) assertTransition(APPOINTMENT, cur.status, newStatus);
    // Moving a booking is guarded exactly like creating one (spec §7: conflicts blocked at create AND move time). An
    // allowed overbook is written FLAGGED; moving an overbooked row to a clear slot clears the flag again (482).
    await writeAppointmentSlot(this.db, {
      tenantId: ctx.tenantId, appointmentId: id, technicianId: technicianId || cur.technicianId, date: date || cur.date, startTime, endTime,
      bufferMinutes: opts?.bufferMinutes ?? 0, allowOverbook: !!opts?.allowOverbook, expectedVersion: opts?.expectedVersion,
      write: async (trx, overlap) => {
        const set = { ...move, ...overbookColumns(overlap, opts?.overbookReason, ctx.userId) };
        const q = newStatus !== cur.status
          ? this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ ...set, status: newStatus }).where('id', '=', id).where('status', '=', cur.status).where(canMoveToSql(APPOINTMENT, newStatus) as any)
          : this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set(set).where('id', '=', id);
        const r: any = await q.executeTakeFirst();
        if (Number(r?.numUpdatedRows ?? 0) === 0) throw new InvalidStateTransitionError(APPOINTMENT, cur.status, newStatus, 'concurrent');
        await recordAppointmentChanges(trx, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, actorType: ctx.role ?? null, actorId: ctx.userId ?? null, source: 'tech_app' }, id, 'rescheduled', [
          { field: 'start_time', old: cur.startTime, new: startTime },
          ...(technicianId ? [{ field: 'technician_id', old: cur.technicianId, new: technicianId }] : []),
          ...(date ? [{ field: 'appt_date', old: cur.date, new: date }] : []),
        ]);
      },
    });
    return true;
  }
  async assign(ctx: TechApptContext, id: string, technicianId: string, opts?: TASlotOpts): Promise<boolean> {
    const tech = (await this._technicians(ctx)).find((x) => x.technicianId === technicianId); if (!tech) return false;
    const cur = await this.appointment(ctx, id); if (!cur) return false;
    // Reassigning puts the booking in ANOTHER technician's day — lock + re-check that day before writing (it was an
    // unchecked UPDATE whose database refusal was swallowed).
    return writeAppointmentSlot(this.db, {
      tenantId: ctx.tenantId, appointmentId: id, technicianId, date: cur.date, startTime: cur.startTime, endTime: cur.endTime,
      bufferMinutes: opts?.bufferMinutes ?? 0, allowOverbook: !!opts?.allowOverbook, expectedVersion: opts?.expectedVersion,
      write: async (trx, overlap) => {
        const ob = overbookColumns(overlap, opts?.overbookReason, ctx.userId);   // server-built (flag / reason / actor), field by field
        const res: any = await this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ technician_id: technicianId, overbook_ok: ob.overbook_ok, overbook_reason: ob.overbook_reason, overbook_by_user_id: ob.overbook_by_user_id, updated_at: sql`now()` } as any).where('id', '=', id).executeTakeFirst();
        const ok = Number(res?.numUpdatedRows ?? 0) > 0;
        if (ok) await recordAppointmentChanges(trx, { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, actorType: ctx.role ?? null, actorId: ctx.userId ?? null, source: 'tech_app' }, id, 'assigned', [{ field: 'technician_id', old: cur.technicianId, new: technicianId }]);
        return ok;
      },
    });
  }
  // idempotency keys are REAL columns
  private keyCol(kind: 'queue' | 'techQueue' | 'serving') { return kind === 'queue' ? 'queue_idempotency_key' : kind === 'techQueue' ? 'tech_queue_idempotency_key' : 'serving_idempotency_key'; }
  async getKey(ctx: TechApptContext, id: string, kind: 'queue' | 'techQueue' | 'serving'): Promise<string | undefined> {
    const r = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(this.keyCol(kind) as any).executeTakeFirst().catch(() => undefined);
    return r ? ((r as any)[this.keyCol(kind)] || undefined) : undefined;
  }
  async setKey(ctx: TechApptContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string): Promise<void> {
    await this.scoped(this.db.updateTable('pos_tech_appointments'), ctx).set({ [this.keyCol(kind)]: key, updated_at: sql`now()` } as any).where('id', '=', id).executeTakeFirst().catch(() => undefined);
  }
}
