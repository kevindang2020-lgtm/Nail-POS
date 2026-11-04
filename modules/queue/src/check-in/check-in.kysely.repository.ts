import { businessDate, localDateTimeToEpochMs } from '@aipowersalon/date-time';
import { branchTimeZone, canMoveToSql } from '@aipowersalon/database';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
// check-in.kysely.repository.ts — production CheckInRepositoryPort over Postgres (Kysely).
// The genuinely useful read side is REAL, tenant/branch-scoped: customer directory + duplicate detection (customers),
// appointment intake list/search/lookup (appointments + appointment_service_lines + customer/technician labels),
// technicians, and the service catalog (services + service_categories). New walk-in customers are written to the real
// `customers` table, and appointment check-in marks the real `appointments` row. Scope is session-derived.
//
// Schema note (honest): this schema has no dedicated POS check-in intake table (`public_check_in_sessions` is a thin
// kiosk-token link table without name/phone/services), so the transient check-in RECORDS themselves are held
// in-process per tenant within a running server. Idempotency keys ride on those in-process records. Technician `skills`
// have no table → empty (assignment eligibility then needs a manager override); totalVisits defaults to 0.
import { sql, type Kysely } from 'kysely';
import { toStoredCustomerPhone } from '@aipowersalon/customers';
import { rankQueue, type QueuePriority } from '../queue/queue.dto';
import type { DB } from '@aipowersalon/database';
import { recordAppointmentChanges, APPOINTMENT, QUEUE_ITEM, TECH_QUEUE_TICKET } from '@aipowersalon/appointments';
import type { CheckInContext, CheckInRepositoryPort, CIRecord, CustRec, ApptRec, TechRec, SvcRec } from './check-in.repository';
import { buildMediaUrl } from '@aipowersalon/media';
import {
  POSCheckInFullState, POSCheckInRow, POSCheckInKpisFull, POSCheckInAppointmentRow, POSCheckInCustomerDetail,
  CheckInFilters, CheckInStatus, CheckInSource, CheckInSettings, DEFAULT_CHECK_IN_SETTINGS, estimateWaitMinutes, computeCheckInAggregates, computeCustomerMix,
} from './check-in.dto';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';
import { KyselyQueueRepository } from '../queue/queue.kysely.repository';
import type { FloorTech } from '../queue/queue-floor';

const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
const parseServices = (v: any): any[] => { if (!v) return []; if (Array.isArray(v)) return v; try { const p = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(p) ? p : []; } catch { return []; } };

/**
 * A check-in's service line as the queue keeps it (pos_queue_items.requested_services). An add-on stays an add-on of its
 * service, and a manager's price change keeps its override and reason — _rowToCI reads all of them back. These used to
 * be dropped here (only id, name, minutes and price were written): a guest's "Nail Art" add-on reached the queue as a
 * plain service, and a POS walk-in's price override lost its reason. Found Oct 6 2026 by the Unit 7 live browser proof.
 */
export function queueLine(s: { serviceId: string; serviceName: string; durationMinutes: number; priceCents?: number; priceOverrideCents?: number; overrideReason?: string; isAddon?: boolean; parentServiceId?: string }) {
  return {
    serviceId: s.serviceId, serviceName: s.serviceName, estimatedDurationMinutes: s.durationMinutes, priceCents: s.priceCents,
    ...(s.priceOverrideCents !== undefined ? { priceOverrideCents: s.priceOverrideCents, ...(s.overrideReason ? { overrideReason: s.overrideReason } : {}) } : {}),
    ...(s.isAddon ? { isAddon: true } : {}), ...(s.parentServiceId ? { parentServiceId: s.parentServiceId } : {}),
  };
}

const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class KyselyCheckInRepository implements CheckInRepositoryPort {
  private store = new Map<string, CIRecord[]>(); // intake records (no POS table — see header note)
  private seq = Date.now() % 1000000;
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) { }
  /** The clock (tests set it). */
  now: () => number = Date.now;
  /** The instant the BRANCH's day began, at its own midnight. `date_trunc('day', now())` is the database's UTC day: after
   *  8 pm in New Jersey it dropped the morning's waiting guests from today's check-ins — the waiting count, and with it
   *  the queue engine's wait estimate a guest is shown (23-inch spec §27), and the day's KPIs (found Oct 6 2026). */
  private async branchDayStart(ctx: CheckInContext): Promise<Date> {
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId);
    return new Date(localDateTimeToEpochMs(businessDate(tz, new Date(this.now())), '00:00', tz));
  }
  /** §343: will a queue join reach the boards through the realtime projection? */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  nextSeq() { return ++this.seq; }

  private scoped(qb: any, ctx: CheckInContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }
  private L(ctx: CheckInContext) { if (!this.store.has(ctx.tenantId)) this.store.set(ctx.tenantId, []); return this.store.get(ctx.tenantId)!; }
  private _settings(): CheckInSettings { return DEFAULT_CHECK_IN_SETTINGS; }
  async settings(_ctx: CheckInContext) { return this._settings(); }

  // ---- customers (real) ----
  private async _custDir(ctx: CheckInContext): Promise<CustRec[]> {
    const rows = await this.scoped(this.db.selectFrom('customers'), ctx).select(['id', 'full_name', 'phone_display', 'email']).execute().catch(() => []);
    // real visit counts = paid tickets per customer
    const paid = await this.scoped(this.db.selectFrom('tickets'), ctx).where('paid_at', 'is not', null).select(['customer_id']).execute().catch(() => []);
    const visits: Record<string, number> = {};
    for (const t of paid) { if (t.customer_id) visits[t.customer_id] = (visits[t.customer_id] || 0) + 1; }
    return rows.map((c: any) => ({ customerId: c.id, fullName: c.full_name || '', phone: c.phone_display || undefined, email: c.email || undefined, totalVisits: visits[c.id] || 0 }));
  }
  async customerDirectory(ctx: CheckInContext) { return this._custDir(ctx); }
  /** Check-In mandate §23, §112–§113 (Oct 28 2026): ONE indexed query, this tenant (and branch) only, top 20 — phone by
   *  its digits (normalized_phone, trigram index), name by vi_fold (Nguyen finds Nguyễn), email. It used to read the
   *  tenant's WHOLE customer directory and every paid ticket, then filter in JavaScript, on every keystroke search. */
  async customerSearch(ctx: CheckInContext, q: string): Promise<POSCheckInCustomerDetail[]> {
    const s = (q || '').trim(); if (!s) return [];
    const digits = s.replace(/\D/g, ''); const like = '%' + s.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const rows: any[] = await this.scoped(this.db.selectFrom('customers'), ctx)
      // a phone-shaped query (digits, spaces, + - ( ) .) searches the phone index ONLY; anything else the name + email
      // indexes. One OR over all three left the plan to the estimate of the inlined vi_fold expression: on 50,000
      // customers PostgreSQL 16 chose a sequential scan once (1,044 ms) and a BitmapOr on later runs (0.34 ms); each half
      // alone is always an index scan (0.06–0.07 ms) — EXPLAIN ANALYZE in the Check-In status doc
      .where((eb: any) => (/^[\d\s()+.\-]+$/.test(s) && digits.length >= 3)
        ? eb('normalized_phone', 'like', '%' + digits + '%')
        : eb.or([sql<boolean>`vi_fold(full_name) LIKE vi_fold(${like})`, eb('email', 'ilike', like)]))
      .select(['id', 'full_name', 'phone_display', 'email']).orderBy('full_name').limit(20).execute();   // a failed search is an error, not "no customer"
    const ids = rows.map((r) => r.id);
    const visits: Record<string, number> = {};
    if (ids.length) {
      const v: any[] = await this.scoped(this.db.selectFrom('tickets'), ctx).where('customer_id', 'in', ids).where('paid_at', 'is not', null)
        .select(['customer_id', sql<number>`count(*)::int`.as('n')]).groupBy('customer_id').execute();
      for (const r of v) visits[r.customer_id] = Number(r.n) || 0;
    }
    return rows.map((c) => ({ customerId: c.id, fullName: c.full_name || '', phone: c.phone_display || undefined, email: c.email || undefined, totalVisits: visits[c.id] || 0 }));
  }
  /** §112: the walk-in duplicate check by the stored phone (indexed) — no directory read. */
  async findCustomerByPhone(ctx: CheckInContext, phone: string | undefined): Promise<string | null> {
    const stored = toStoredCustomerPhone(phone); if (!stored) return null;
    const r: any = await this.db.selectFrom('customers').where('tenant_id', '=', ctx.tenantId).where('normalized_phone', '=', stored).select('id').limit(1).executeTakeFirst();   // §28: a failed duplicate check must not create a second customer
    return r?.id ?? null;
  }
  async createCustomer(ctx: CheckInContext, c: CustRec): Promise<CustRec> {
    // customers requires first_name/last_name/status + marketing flags (NOT NULL). Split fullName like the customers module.
    const full = (c.fullName || '').trim(); const sp = full.indexOf(' ');
    const first = (sp === -1 ? full : full.slice(0, sp)) || 'Guest';
    const last = sp === -1 ? '' : full.slice(sp + 1);
    const ins = await this.db.insertInto('customers').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId, first_name: first, last_name: last, full_name: full, status: 'active', marketing_sms_opt_in: c.smsOptIn ?? false, marketing_email_opt_in: false, phone_display: c.phone || null, normalized_phone: toStoredCustomerPhone(c.phone), email: c.email || null } as any).returning(['id']).executeTakeFirstOrThrow();
    return { ...c, customerId: ins.id };
  }

  // Materialize the check-in into the queue: insert a pos_queue_items row the queue module reads by id.
  async enqueue(ctx: CheckInContext, rec: CIRecord): Promise<string> {
    // Idempotent: createRecord() already persists the check-in to pos_queue_items, so if this record exists, reuse it
    // (moveToQueue calls enqueue on an existing record — don't create a duplicate row).
    // SW-19: a temporary 'ci_<n>' intake id is not a uuid and cannot be a queue row — never sent to PostgreSQL.
    if (rec.checkInId && UUID_ID.test(rec.checkInId)) { const ex = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', rec.checkInId).select('id').executeTakeFirst().catch(() => undefined); if (ex) return ex.id; }
    return this.db.transaction().execute((trx) => this.insertQueueItem(trx as unknown as Kysely<DB>, ctx, rec));
  }
  /** One queue item and its queue.customer_joined event, on the given executor (a transaction). */
  private async insertQueueItem(trx: Kysely<DB>, ctx: CheckInContext, rec: CIRecord): Promise<string> {
    const services = (rec.services || []).map(queueLine);
    const row = await trx.insertInto('pos_queue_items').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, customer_id: rec.customerId || null, customer_name: rec.customerName,
      customer_phone: rec.customerPhone || null, is_vip: !!rec.isVip, source: rec.source === 'customer_app' || (rec.source as string) === 'phone' ? 'online' : rec.source, appointment_id: rec.appointmentId || null,
      requested_services: JSON.stringify(services), priority: 'normal', status: 'waiting', assigned_technician_id: rec.technicianId || null,
      checked_in_at: new Date(rec.checkedInAtMs || Date.now()).toISOString(), notes: rec.notes || null,
      check_in_idempotency_key: rec.checkInIdempotencyKey || null,   // mandate §31 (migration 665)
    }).returning(['id']).executeTakeFirstOrThrow();
    // §63: the guest joined the queue — recorded with the insert; the projection broadcasts it (§343)
    if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.QUEUE_CUSTOMER_JOINED, tenantId: ctx.tenantId, branchId: ctx.branchId,
      aggregateType: 'queue_item', aggregateId: String(row.id), actorId: ctx.userId, actorType: 'user', payload: { queueItemId: String(row.id), source: rec.source, checkInId: rec.checkInId ?? null } }));
    return String(row.id);
  }

  /** A visit of several appointments, checked in ALL OR NOTHING (Oct 6 2026): every queue item, every appointment's
   *  "checked in" and its change-log line commit in one transaction. It used to be one appointment at a time, so a
   *  failure between two left the visit half checked in until the guest tapped again. A refusal of the one-active-entry
   *  index (another device checking the same visit in at the same moment) rolls the whole visit back and propagates —
   *  the caller re-reads what the other device recorded. */
  async createVisitRecords(ctx: CheckInContext, recs: CIRecord[]): Promise<POSCheckInRow[]> {
    return this.db.transaction().execute(async (trx) => {
      const k = trx as unknown as Kysely<DB>;
      const rows: POSCheckInRow[] = [];
      for (const rec of recs) {
        const id = await this.insertQueueItem(k, ctx, rec);
        if (rec.appointmentId) {
          const before: any = await this.scoped(k.selectFrom('pos_tech_appointments'), ctx).where('id', '=', rec.appointmentId).select('status').executeTakeFirst();
          const moved: any = await this.scoped(k.updateTable('pos_tech_appointments'), ctx).set({ status: 'checked_in', updated_at: sql`now()` }).where('id', '=', rec.appointmentId).where(canMoveToSql(APPOINTMENT, 'checked_in')).executeTakeFirst();
          await this.appointmentCheckedInEvent(k, ctx, rec.appointmentId, before?.status, moved, { customerId: rec.customerId ?? null, checkInId: id });
          // the change log is best-effort (it never fails a check-in): inside a savepoint, so a refused line cannot abort
          // the visit's transaction
          await sql`savepoint visit_change_log`.execute(k);
          await recordAppointmentChanges(k,
            { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, actorType: ctx.role ?? null, actorId: ctx.userId ?? null, source: 'check_in' },
            rec.appointmentId, 'status_changed', [{ field: 'status', old: before?.status, new: 'checked_in' }]);
          await sql`release savepoint visit_change_log`.execute(k).catch(() => sql`rollback to savepoint visit_change_log`.execute(k));
        }
        rows.push(this.toRow(ctx, { ...rec, checkInId: id }));
      }
      return rows;
    });
  }

  // ---- technicians (real; skills empty — see header note) ----
  private async _techs(ctx: CheckInContext): Promise<TechRec[]> {
    const rows = await this.scoped(this.db.selectFrom('technicians as tech'), ctx, 'tech')
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
    const ids = rows.map((r: any) => r.id);
    const stat = ids.length ? await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', ids).select(['technician_id', 'status']).execute().catch(() => []) : [];
    const by: Record<string, string> = {}; for (const s of stat) by[s.technician_id] = s.status;
    return rows.map((r: any) => ({
      technicianId: r.id,
      name: r.full_name || r.id,
      available: by[r.id] ? by[r.id] === 'available' : r.status === 'active',
      avatarUrl: buildMediaUrl(r.tech_avatar_url || r.gtp_avatar_url || r.user_avatar_url),
      skills: [],
    }));
  }
  async placeInLine(ctx: CheckInContext, checkInId: string) {
    const rows: any[] = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('status', '=', 'waiting').select(['id', 'priority', 'checked_in_at']).execute().catch(() => []);
    if (!rows.some((r) => r.id === checkInId)) return null;
    const now = Date.now();
    const ranked = rankQueue(rows.map((r) => ({ queueItemId: r.id, waitedMinutes: Math.max(0, (now - new Date(r.checked_in_at).getTime()) / 60000), priority: (r.priority || 'normal') as QueuePriority })), true);
    const f = ranked.find((g) => g.queueItemId === checkInId);
    return f ? { position: f.position, waitingAhead: f.position - 1 } : null;
  }

  async technicians(ctx: CheckInContext) { return this._techs(ctx); }

  // ---- service catalog (real) ----
  private async _catalog(ctx: CheckInContext): Promise<SvcRec[]> {
    // Qualify the scope columns (s.*) — service_categories also has tenant_id/branch_id, so the generic scoped() helper
    // would make the WHERE ambiguous after the join (the error was being swallowed by the catch → empty catalog).
    // Service catalog is loaded tenant-wide (no branch filter) so that cross-branch bookings
    // (e.g. customer books in branch A, POS checks in from branch B) always resolve correctly.
    let q = this.db.selectFrom('services as s').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .where('s.tenant_id', '=', ctx.tenantId);
    const rows = await q
      .select(['s.id as serviceId', 's.name as name', 'c.name as categoryName', 's.duration_minutes as dur', 's.price_cents as price'])
      .execute()
      .catch((err) => {
        console.error('[check-in] _catalog failed:', err);
        return [];
      });
    return rows.map((r: any) => ({ serviceId: r.serviceId, name: r.name, categoryName: r.categoryName || 'General', durationMinutes: Number(r.dur || 0), priceCents: Number(r.price || 0) }));
  }
  async serviceCatalog(ctx: CheckInContext) { return this._catalog(ctx); }

  // ---- appointments (real) ----
  private async loadAppt(ctx: CheckInContext, a: any, labels?: { cust: Map<string, any>; tech: Map<string, string>; svc: Map<string, string> }): Promise<ApptRec> {
    let custName = '', phone: string | undefined, avatarUrl: string | undefined;
    if (a.customer_id) { const c = labels ? labels.cust.get(a.customer_id) : await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', a.customer_id).select(['full_name', 'phone_display', 'avatar_url']).executeTakeFirst().catch(() => undefined); if (c) { custName = c.full_name || ''; phone = c.phone_display || undefined; avatarUrl = c.avatar_url || undefined; } }
    let techName: string | undefined;
    if (a.technician_id) { if (labels) techName = labels.tech.get(a.technician_id) || undefined; else { const t = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', a.technician_id).select('full_name').executeTakeFirst().catch(() => undefined); techName = t?.full_name || undefined; } }
    const isHandled = ['checked_in', 'in_service', 'serving', 'completed', 'service_done', 'assigned'].includes(a.status);
    const rawServices = parseServices(a.services);
    const serviceIds = rawServices.map((s: any) => s.serviceId).filter(Boolean);
    let serviceNames: string[] | undefined;
    if (serviceIds.length > 0) {
      const svcs = labels ? serviceIds.filter((id: string) => labels.svc.has(id)).map((id: string) => ({ id, name: labels.svc.get(id) })) : await this.db.selectFrom('services').where('tenant_id', '=', ctx.tenantId).where('id', 'in', serviceIds).select(['id', 'name']).execute().catch(() => []);
      serviceNames = serviceIds.map((id: string) => {
        const found = svcs.find((s: any) => s.id === id);
        if (found?.name) return found.name;
        const fromRaw = rawServices.find((s: any) => s.serviceId === id);
        return fromRaw?.serviceName || fromRaw?.name || id;
      });
    }
    return { appointmentId: a.id, customerId: a.customer_id || undefined, customerName: custName, customerPhone: phone, avatarUrl, startTime: a.start_time || '', technicianId: a.technician_id || undefined, technicianName: techName, serviceIds, serviceNames, services: rawServices, source: (a.source as CheckInSource) || 'appointment', checkedIn: isHandled, notes: a.notes || undefined };
  }
  private apptRow(a: ApptRec, cat: SvcRec[]): POSCheckInAppointmentRow {
    return { appointmentId: a.appointmentId, customerId: a.customerId, customerName: a.customerName, customerPhone: a.customerPhone, avatarUrl: a.avatarUrl, startTime: a.startTime, technicianName: a.technicianName, serviceNames: a.serviceNames || a.serviceIds.map((id) => cat.find((s) => s.serviceId === id)?.name || id), source: a.source, alreadyCheckedIn: a.checkedIn };
  }
  async appointment(ctx: CheckInContext, id: string): Promise<ApptRec | null> {
    const a = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('id', '=', id).select(['id', 'customer_id', 'technician_id', 'start_time', 'status', 'source', 'notes', 'services']).executeTakeFirst().catch(() => undefined);
    return a ? this.loadAppt(ctx, a) : null;
  }
  private async _apptsRaw(ctx: CheckInContext): Promise<ApptRec[]> {
    const branchToday = businessDate(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId));   // the BRANCH's today, not the database's UTC date (Oct 2 2026)
    const rows = await this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('status', 'not in', ['cancelled', 'no_show', 'completed', 'service_done']).where('appt_date', '=', branchToday).select(['id', 'customer_id', 'technician_id', 'start_time', 'status', 'source', 'notes', 'services']).orderBy('start_time').execute().catch(() => []);
    // Check-In mandate §110 (Oct 28 2026): the labels in three batched reads — it was three queries PER appointment
    const custIds = [...new Set(rows.map((a: any) => a.customer_id).filter(Boolean))] as string[];
    const techIds = [...new Set(rows.map((a: any) => a.technician_id).filter(Boolean))] as string[];
    const svcIds = [...new Set(rows.flatMap((a: any) => parseServices(a.services).map((x: any) => x.serviceId)).filter(Boolean))] as string[];
    const [custs, techs, svcs] = await Promise.all([
      custIds.length ? this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', custIds).select(['id', 'full_name', 'phone_display', 'avatar_url']).execute() : Promise.resolve([]),
      techIds.length ? this.scoped(this.db.selectFrom('technicians'), ctx).where('id', 'in', techIds).select(['id', 'full_name']).execute() : Promise.resolve([]),
      svcIds.length ? this.db.selectFrom('services').where('tenant_id', '=', ctx.tenantId).where('id', 'in', svcIds).select(['id', 'name']).execute() : Promise.resolve([]),
    ]);
    type Lbl = { id: string; full_name?: string | null; name?: string | null };
    const lc: Lbl[] = custs, lt: Lbl[] = techs, ls: Lbl[] = svcs;
    const labels = { cust: new Map(lc.map((c) => [c.id, c])), tech: new Map(lt.map((t) => [t.id, t.full_name || ''])), svc: new Map(ls.map((x) => [x.id, x.name || ''])) };
    return Promise.all(rows.map((a: any) => this.loadAppt(ctx, a, labels)));   // loadAppt is async: without Promise.all the list was an array of promises and every row read as empty
  }
  async appointmentSearch(ctx: CheckInContext, q: string, _date?: string): Promise<POSCheckInAppointmentRow[]> {
    const cat = await this._catalog(ctx); const all = await this._apptsRaw(ctx); const s = (q || '').trim().toLowerCase();
    const matched = !s ? all : all.filter((a) => a.customerName.toLowerCase().includes(s) || (a.customerPhone || '').toLowerCase().includes(s) || a.appointmentId.toLowerCase().includes(s) || (a.technicianName || '').toLowerCase().includes(s));
    return matched.map((a) => this.apptRow(a, cat));
  }
  async appointmentsReady(ctx: CheckInContext): Promise<POSCheckInAppointmentRow[]> {
    const cat = await this._catalog(ctx); const all = await this._apptsRaw(ctx);
    return all.filter((a) => !a.checkedIn).map((a) => this.apptRow(a, cat));
  }
  async markAppointmentCheckedIn(ctx: CheckInContext, appointmentId: string): Promise<void> {
    // B-14 (Oct 20 2026): the status write and its checkin.customer_checked_in commit together (§18/§60)
    await this.db.transaction().execute(async (trx) => {
    const k = trx as unknown as Kysely<DB>;
    let before: any;
    try { before = await this.scoped(k.selectFrom('pos_tech_appointments'), ctx).where('id', '=', appointmentId).select(['status', 'customer_id']).executeTakeFirst(); } catch { before = undefined; }
    const moved: any = await this.scoped(k.updateTable('pos_tech_appointments'), ctx).set({ status: 'checked_in', updated_at: sql`now()` }).where('id', '=', appointmentId).where(canMoveToSql(APPOINTMENT, 'checked_in')).executeTakeFirst().catch(() => undefined);
    await this.appointmentCheckedInEvent(k, ctx, appointmentId, before?.status, moved, { customerId: before?.customer_id ?? null, checkInId: null });
    await recordAppointmentChanges(
      k,
      { tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, actorType: ctx.role ?? null, actorId: ctx.userId ?? null, source: 'check_in' },
      appointmentId, 'status_changed', [{ field: 'status', old: before?.status, new: 'checked_in' }],
    );
    });
  }
  /** B-14: the appointment moved to checked_in → checkin.customer_checked_in on the appointment (the same event the Booking
   *  board and the Technician app record), on the executor of the status write. Nothing when the row did not move (already
   *  checked in, or a status the machine refuses) — the first check-in's event stands. */
  private async appointmentCheckedInEvent(k: Kysely<DB>, ctx: CheckInContext, appointmentId: string, previousStatus: string | undefined, moved: any, extra: { customerId: string | null; checkInId: string | null }) {
    if (!this.outbox || Number(moved?.numUpdatedRows ?? 0) <= 0 || previousStatus === 'checked_in') return;   // (the machine allows checked_in → checked_in; that is not a second check-in)
    await this.outbox.write(k, createDomainEvent({ eventType: DOMAIN_EVENTS.CUSTOMER_CHECKED_IN, tenantId: ctx.tenantId, branchId: ctx.branchId,
      aggregateType: 'appointment', aggregateId: appointmentId, actorId: ctx.userId, actorType: 'user',
      payload: { appointmentId, previousStatus: previousStatus ?? null, status: 'checked_in', customerId: extra.customerId, checkInId: extra.checkInId, source: 'check_in' } }));
  }

  // ---- intake records (in-process — see header note) ----
  async record(ctx: CheckInContext, id: string) { const r = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('id', '=', id).select(KyselyCheckInRepository.QCOLS).executeTakeFirst().catch(() => undefined); return r ? this._rowToCI(r, await this._techNameMap(ctx)) : null; }
  private toRow(ctx: CheckInContext, r: CIRecord): POSCheckInRow {
    return { checkInId: r.checkInId, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: r.customerId, customerName: r.customerName, customerPhone: r.customerPhone, avatarUrl: r.avatarUrl, isVip: r.isVip, appointmentId: r.appointmentId, source: r.source, services: r.services, technicianId: r.technicianId, technicianName: r.technicianName, checkedInAt: new Date(r.checkedInAtMs).toISOString(), quotedWaitMinutes: r.quotedWaitMinutes, status: r.status, notes: r.notes };
  }
  async byCheckInKey(ctx: CheckInContext, key: string) {
    const r: any = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('check_in_idempotency_key', '=', key).select('id').executeTakeFirst();
    return r?.id ? { checkInId: String(r.id) } : null;
  }
  async activeCheckIn(ctx: CheckInContext, by: { appointmentId?: string; customerId?: string }) {
    let q = this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('status', 'not in', ['completed', 'done', 'cancelled', 'removed']);
    if (by.appointmentId) q = q.where('appointment_id', '=', by.appointmentId);
    else if (by.customerId) q = q.where('appointment_id', 'is', null).where('customer_id', '=', by.customerId);
    else return null;
    const r: any = await q.select('id').orderBy('created_at', 'desc').executeTakeFirst().catch(() => undefined);
    return r?.id ? { checkInId: r.id } : null;
  }
  async detailRow(ctx: CheckInContext, id: string) { const r = await this.record(ctx, id); return r ? this.toRow(ctx, r) : null; }
  async createRecord(ctx: CheckInContext, rec: CIRecord) { const id = await this.enqueue(ctx, rec); return this.toRow(ctx, { ...rec, checkInId: id }); }
  async update(ctx: CheckInContext, id: string, patch: Partial<CIRecord>) {
    const set: any = {};
    if (patch.technicianId !== undefined) set.assigned_technician_id = patch.technicianId || null;
    if (patch.services !== undefined) set.requested_services = JSON.stringify((patch.services || []).map(queueLine));
    if (patch.notes !== undefined) set.notes = patch.notes || null;
    if (patch.status !== undefined) set.status = KyselyCheckInRepository.CI_TO_QUEUE_STATUS[patch.status] || 'waiting';
    if (Object.keys(set).length === 0) return true; set.updated_at = sql`now()`;
    // Phase 12 (#27): a status in the patch moves only through the QUEUE_ITEM machine (a cancelled visit is not revived)
    const res = await this.scoped(this.db.updateTable('pos_queue_items'), ctx).set(set).where('id', '=', id).where(set.status ? canMoveToSql(QUEUE_ITEM, set.status) : sql<boolean>`true`).returning('appointment_id').executeTakeFirst().catch(() => undefined);
    const apptId = res?.appointment_id;
    if (apptId && patch.status) {
      const apptStatus = patch.status === 'in_service' ? 'in_service' : patch.status === 'cancelled' ? 'cancelled' : (patch.status as string) === 'completed' ? 'completed' : 'checked_in';
      await this.scoped(this.db.updateTable('pos_tech_appointments'), ctx).set({ status: apptStatus, updated_at: sql`now()` }).where('id', '=', apptId).where(canMoveToSql(APPOINTMENT, apptStatus)).executeTakeFirst().catch(() => undefined);
    }
    return !!res;
  }
  async setStatus(ctx: CheckInContext, id: string, st: CheckInStatus) {
    const qStatus = KyselyCheckInRepository.CI_TO_QUEUE_STATUS[st] || 'waiting';
    const res: any = await this.scoped(this.db.updateTable('pos_queue_items'), ctx).set({ status: qStatus, updated_at: sql`now()` }).where('id', '=', id).where(canMoveToSql(QUEUE_ITEM, qStatus)).returning('appointment_id').executeTakeFirst().catch(() => undefined);
    const apptId = res?.appointment_id;
    if (apptId) {
      const apptStatus = st === 'in_service' ? 'in_service' : st === 'cancelled' ? 'cancelled' : (st as string) === 'completed' ? 'completed' : 'checked_in';
      await this.scoped(this.db.updateTable('pos_tech_appointments'), ctx).set({ status: apptStatus, updated_at: sql`now()` }).where('id', '=', apptId).where(canMoveToSql(APPOINTMENT, apptStatus)).executeTakeFirst().catch(() => undefined);
    }
    if (st === 'cancelled') {
      await this.scoped(this.db.updateTable('pos_tech_queue_tickets'), ctx).set({ status: 'cancelled', updated_at: sql`now()` }).where(canMoveToSql(TECH_QUEUE_TICKET, 'cancelled')).where((eb: any) => eb.or([eb('id', '=', id), eb('queue_item_id', '=', id), apptId ? eb('appointment_id', '=', apptId) : eb('id', '=', id)])).executeTakeFirst().catch(() => undefined);
      await this.scoped(this.db.updateTable('tickets'), ctx).set({ status: 'cancelled', updated_at: sql`now()` }).where((eb: any) => eb.or([eb('id', '=', id), eb('queue_item_id', '=', id)])).executeTakeFirst().catch(() => undefined);
    }
    return !!res;
  }
  async getKey(ctx: CheckInContext, id: string, kind: 'queue' | 'techQueue' | 'serving') { const r = this.L(ctx).find((x) => x.checkInId === id); if (!r) return undefined; return kind === 'queue' ? r.queueKey : kind === 'techQueue' ? r.techQueueKey : r.servingKey; }
  async setKey(ctx: CheckInContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string) { const r = this.L(ctx).find((x) => x.checkInId === id); if (!r) return; if (kind === 'queue') r.queueKey = key; else if (kind === 'techQueue') r.techQueueKey = key; else r.servingKey = key; }

  private avgServiceMin(cat: SvcRec[]) { return cat.length ? Math.round(cat.reduce((a, s) => a + s.durationMinutes, 0) / cat.length) : 45; }
  async waitEstimate(ctx: CheckInContext, _serviceIds: string[], _technicianId?: string) {
    const settings = this._settings(); if (!settings.autoEstimateWait) return { configured: false, reason: 'Estimate unavailable — auto wait estimate is off.' };
    const cat = await this._catalog(ctx); const techs = await this._techs(ctx);
    const waiting = (await this._intake(ctx)).filter((r) => r.status === 'checked_in' || r.status === 'sent_to_queue').length;
    return { configured: true, quotedWaitMinutes: estimateWaitMinutes(waiting, this.avgServiceMin(cat), techs.filter((t) => t.available).length) };
  }

  // Today's check-in intake, read from the persisted queue (pos_queue_items) so arrivals/waiting/KPIs/source-mix/
  // customer-type survive restarts and are consistent across instances. createRecord() persists every check-in here
  // (there is no separate intake table), so a fresh walk-in/appointment check-in is a durable row. Single-table
  // scoped() queries (no join) — no ambiguous columns.
  private static QUEUE_TO_CI_STATUS: Record<string, CheckInStatus> = {
    waiting: 'checked_in', assigned: 'sent_to_tech_queue', called: 'sent_to_tech_queue', serving: 'in_service', in_service: 'in_service', cancelled: 'cancelled', completed: 'completed', service_done: 'completed',
  };
  private static CI_TO_QUEUE_STATUS: Record<string, string> = {
    // Phase 12 (#27): in_service → 'in_service' (was 'serving', a TICKET status the queue item's CHECK refuses — the write was swallowed)
    checked_in: 'waiting', sent_to_queue: 'waiting', sent_to_tech_queue: 'assigned', in_service: 'in_service', cancelled: 'cancelled', completed: 'completed', service_done: 'completed',
  };
  private static QCOLS = ['id', 'customer_id', 'customer_name', 'customer_phone', 'is_vip', 'appointment_id', 'source', 'requested_services', 'assigned_technician_id', 'checked_in_at', 'status', 'notes'] as const;
  private async _techNameMap(ctx: CheckInContext): Promise<Record<string, string>> {
    const techRows = await this.scoped(this.db.selectFrom('technicians'), ctx).select(['id', 'full_name']).execute().catch(() => []);
    const m: Record<string, string> = {}; for (const t of techRows) m[t.id] = t.full_name || ''; return m;
  }
  private _rowToCI(r: any, techName: Record<string, string>, custAvatars: Record<string, string> = {}): CIRecord {
    let services: CIRecord['services'] = [];
    try { const arr = typeof r.requested_services === 'string' ? JSON.parse(r.requested_services) : (r.requested_services || []); services = (arr || []).map((s: any) => ({ serviceId: s.serviceId, serviceName: s.serviceName, durationMinutes: s.estimatedDurationMinutes ?? s.durationMinutes ?? 0, priceCents: s.priceCents ?? 0, priceOverrideCents: s.priceOverrideCents, overrideReason: s.overrideReason, isAddon: !!s.isAddon, parentServiceId: s.parentServiceId })); } catch { services = []; }
    const ms = r.checked_in_at ? new Date(r.checked_in_at).getTime() : Date.now();
    return {
      checkInId: r.id, customerId: r.customer_id || undefined, customerName: r.customer_name || '', customerPhone: r.customer_phone || undefined,
      avatarUrl: (r.customer_id && custAvatars[r.customer_id]) ? buildMediaUrl(custAvatars[r.customer_id]) : undefined,
      isVip: !!r.is_vip, appointmentId: r.appointment_id || null, source: (r.source || 'walk_in') as CheckInSource, services,
      technicianId: r.assigned_technician_id || null, technicianName: r.assigned_technician_id ? (techName[r.assigned_technician_id] || null) : null,
      checkedInAtMs: ms, quotedWaitMinutes: 0, status: KyselyCheckInRepository.QUEUE_TO_CI_STATUS[r.status] || 'checked_in',
      notes: r.notes || '', updatedAt: new Date(ms).toISOString(),
    } as CIRecord;
  }
  private async _intake(ctx: CheckInContext): Promise<CIRecord[]> {
    const rows = await this.scoped(this.db.selectFrom('pos_queue_items'), ctx)
      .where('checked_in_at', '>=', await this.branchDayStart(ctx))
      .select(KyselyCheckInRepository.QCOLS).orderBy('checked_in_at', 'desc').execute().catch(() => []);
    const techName = await this._techNameMap(ctx);
    const customerIds = Array.from(new Set((rows as any[]).map((r) => r.customer_id).filter(Boolean)));
    const custAvatars: Record<string, string> = {};
    if (customerIds.length) {
      const custRows = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', customerIds).select(['id', 'avatar_url']).execute().catch(() => []);
      for (const c of custRows) { if (c.id && c.avatar_url) custAvatars[c.id] = c.avatar_url; }
    }
    return (rows as any[]).map((r) => this._rowToCI(r, techName, custAvatars));
  }

  async query(ctx: CheckInContext, f: CheckInFilters): Promise<POSCheckInFullState> {
    const all = await this._intake(ctx);
    let rows = all.slice();
    if (f.search) { const s = f.search.toLowerCase(); rows = rows.filter((r) => [r.customerName, r.customerPhone, r.technicianName, ...r.services.map((x) => x.serviceName)].some((x) => (x || '').toLowerCase().includes(s))); }
    if (f.source) rows = rows.filter((r) => r.source === f.source);
    if (f.status) rows = rows.filter((r) => r.status === f.status);
    if (f.technicianId) rows = rows.filter((r) => r.technicianId === f.technicianId);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((r) => this.toRow(ctx, r));
    const waiting = all.filter((r) => r.status === 'checked_in' || r.status === 'sent_to_queue');
    const waits = waiting.map((r) => Math.max(0, Math.floor((Date.now() - r.checkedInAtMs) / 60000)));
    const kpis: POSCheckInKpisFull = {
      checkedInToday: all.length, appointmentsCheckedIn: all.filter((r) => r.source === 'appointment').length, walkInsCheckedIn: all.filter((r) => r.source === 'walk_in').length,
      waitingNow: waiting.length, sentToQueue: all.filter((r) => r.status === 'sent_to_queue').length, sentToTechQueue: all.filter((r) => r.status === 'sent_to_tech_queue').length, startedService: all.filter((r) => r.status === 'in_service').length,
      averageWaitMinutes: waits.length ? Math.round(waits.reduce((a, w) => a + w, 0) / waits.length) : 0, noShowsToday: 0, onlineArrivalsToday: all.filter((r) => ['online', 'google', 'ai', 'customer_app'].includes(r.source)).length,
    };
    const techs = await this._techs(ctx); const cat = await this._catalog(ctx); const apptsReady = await this.appointmentsReady(ctx);
    // Check-In mandate (Oct 28 2026): the branch's clock, the trend baseline, today's real no-shows and the on-duty signals
    const tz = await branchTimeZone(this.db, ctx.tenantId, ctx.branchId); const nowMs = this.now();
    const dayStart = await this.branchDayStart(ctx);
    const local = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(nowMs)).split(':');
    const branchNowMinutes = Number(local[0]) * 60 + Number(local[1]);
    const ydayStart = new Date(dayStart.getTime() - 86400000); const ydaySameTime = new Date(nowMs - 86400000);
    const [ydayRow, noShowRow] = await Promise.all([
      this.scoped(this.db.selectFrom('pos_queue_items'), ctx).where('checked_in_at', '>=', ydayStart).where('checked_in_at', '<', ydaySameTime).select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
      this.scoped(this.db.selectFrom('pos_tech_appointments'), ctx).where('appt_date', '=', businessDate(tz, new Date(nowMs))).where('status', 'in', ['no_show', 'noshow']).select(sql<number>`count(*)::int`.as('n')).executeTakeFirst(),
    ]);
    kpis.noShowsToday = Number(noShowRow?.n || 0);
    const activeRows = all.filter((r) => !['cancelled', 'completed', 'service_done'].includes(r.status as string)).map((r) => this.toRow(ctx, r));
    const staffLoad: Record<string, number> = {}; for (const r of all) if (r.technicianId && r.status !== 'in_service' && r.status !== 'cancelled' && (r.status as string) !== 'completed') staffLoad[r.technicianId] = (staffLoad[r.technicianId] ?? 0) + 1;
    const avatarBy = new Map(techs.map((t) => [t.technicianId, t.avatarUrl ?? null]));
    // the queue's own technician signals — a failure is an error on the page, never "nobody available"
    const signals = await new KyselyQueueRepository(this.db).techSignals({ ...ctx });
    const staffTechs: FloorTech[] = signals.map((t) => ({ technicianId: t.technicianId, name: t.name, avatarUrl: avatarBy.get(t.technicianId) ?? null, skills: t.skills, activeAssignments: t.activeAssignments, rotationIndex: t.rotationIndex,
      signals: { status: t.signals.status, availableInMinutes: t.signals.availableInMinutes, onBreak: t.signals.onBreak } }));
    const satRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('satisfaction_rating', 'is not', null).where('paid_at', '>=', await this.branchDayStart(ctx))
      .select(sql<number>`coalesce(round(avg(satisfaction_rating)::numeric, 2), 0)`.as('avg'))
      .executeTakeFirst().catch(() => undefined);
    const satisfactionAvg = Math.max(0, Number(satRow?.avg || 0));
    return {
      kpis, recentCheckIns: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } }, appointmentsReadyForCheckIn: apptsReady,
      filters: {
        sources: ['appointment', 'walk_in', 'online', 'google', 'ai', 'customer_app', 'manual'], statuses: ['checked_in', 'sent_to_queue', 'sent_to_tech_queue', 'in_service', 'cancelled'],
        technicians: techs.map((t) => ({ technicianId: t.technicianId, name: t.name, avatarUrl: t.avatarUrl || null })), services: cat.map((s) => ({ serviceId: s.serviceId, name: s.name })), branches: [{ branchId: ctx.branchId || 'br_cherryhill', name: 'Cherry Hill' }],
      },
      settings: this._settings(),
      aggregates: computeCheckInAggregates(all),
      customerMix: computeCustomerMix(all, await this._visitsByCustomer(ctx, all.map((r) => r.customerId || ''))),
      satisfactionAvg,
      activeRows, staffTechs, staffLoad, branchNowMinutes, checkInsYesterdaySameTime: Number(ydayRow?.n || 0),
    };
  }

  /** Check-In mandate §109–§111 (Oct 28 2026): paid visits for TODAY's check-in customers only — it read the tenant's whole
   *  customer directory and every paid ticket on every /state call. */
  private async _visitsByCustomer(ctx: CheckInContext, customerIds: string[] = []): Promise<Record<string, number>> {
    const ids = [...new Set(customerIds.filter((x) => UUID_ID.test(x)))]; const m: Record<string, number> = {};
    if (!ids.length) return m;
    const v: any[] = await this.scoped(this.db.selectFrom('tickets'), ctx).where('customer_id', 'in', ids).where('paid_at', 'is not', null)
      .select(['customer_id', sql<number>`count(*)::int`.as('n')]).groupBy('customer_id').execute();
    for (const r of v) m[r.customer_id] = Number(r.n) || 0;
    return m;
  }
}
