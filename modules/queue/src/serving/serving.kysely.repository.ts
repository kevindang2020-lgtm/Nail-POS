// serving.kysely.repository.ts — production ServingRepositoryPort over Postgres (Kysely).
// Real, tenant/branch-scoped over tickets + ticket_service_lines (+ customers/technicians for labels) and the service
// catalog (services + service_categories). Service-line add/edit/remove are REAL writes to ticket_service_lines;
// technician assignment writes tickets.primary_technician_id; starting service stamps tickets.serving_started_at.
// Timer math reuses the same dto helpers. Scope is session-derived.
//
// Schema notes (honest — tickets has no columns for these, so NOT faked — in-process per ticket within a running
// server): pause/accumulated-paused timer state, delay status/reason, internal + customer-visible notes, the helper
// technician, the send-to-service-done idempotency key, and the serving-specific status overlay (the serving status
// vocabulary — not_started/paused/delayed/sent_to_service_done — is wider than the tickets.status enum). isVip=false
// (no flag in schema). started time comes from the real serving_started_at unless start() set it this session.
import { escapeLike } from '@aipowersalon/database';   // Security Deep Scan D8: wildcard-escaped LIKE input
import { loadTechUtilization, resolveLineCommission, pickLineCommission, defaultCommissionForTenant , turnServiceStart } from '@aipowersalon/workforce';
import { completeServiceDone, ServiceDoneTransitionError, type ServiceDoneSource, type ServiceDoneWorkforcePort } from '../service-done/service-done-transition';
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { readAppFlag } from '@aipowersalon/customers';
import { sql, type Kysely } from 'kysely';
import { branchTimeZone, canMoveToSql } from '@aipowersalon/database';
import { APPOINTMENT, QUEUE_ITEM } from '@aipowersalon/appointments';
import { TICKET_CHANGE_REQUEST, TICKET_SERVICE_SESSION, SERVING_DELAY } from '../queue-lifecycles';
import { dayStartMs } from '@aipowersalon/date-time';
import type { DB } from '@aipowersalon/database';
import type { ServingContext, ServingRepositoryPort, SVTicket, SVLine, RevisionInput, RevisionRecord } from './serving.repository';
import { computeServingAddOnMetrics, buildFloorProjection, type RetailLineIn } from './serving.repository';
import {
  POSServingFullState, POSServingTicketRow, POSServingTicketDetailFull, POSServingKpisFull, ServingFilters,
  ServingTicketStatus, DelayStatus, ServiceLineStatus, ServingWorkflowSettings, DEFAULT_SERVING_SETTINGS, Pagination,
  ServiceOption, TechnicianOption, computeElapsedMinutes, deriveDelayStatus, subtotalFromServingLines, computeOnTimeCompletionPercent,
  ServingAnalytics, ServingStaffRow, servingStageLabel, buildServingServiceMix, buildServingAddOnMix, buildServingTechPerformance, FINISHING_SOON_FRACTION,
} from './serving.dto';
import { PosKpiSnapshots } from '@aipowersalon/reports';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';
import { projectionDeliversRealtime } from '@aipowersalon/config';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ms = (v: any) => (v ? new Date(v).getTime() : null);
/** a selected row (the adapter's reads are column lists, not the generated table types) */
type Row = Record<string, any>;
// DURABLE STATE (migration 586 — merge Oct 12 2026, workforce audit P1 #19): nothing lives in process memory any more.
// The serving status overlay is DERIVED from tickets.status + the ticket's live ticket_service_sessions row + the
// Service Done lock; the pause clock is tickets.serving_paused_at / accumulated_paused_ms (156); delay is
// tickets.serving_delay_status/_reason (586); notes are tickets.service_done_notes / service_done_customer_visible_notes
// (025); the helper is tickets.helper_technician_id (025); the send-to-Service-Done idempotency key is the primary
// session's idempotency_key. A new repository instance (restart, second replica) sees exactly the same state.
const LIVE = ['STARTED', 'PAUSED'];
/** Thrown by start/assign when the technician already holds a live session on ANOTHER ticket (partial unique index). */
export class ServingSessionConflict extends Error { constructor(msg = 'Technician is already serving another guest') { super(msg); this.name = 'ServingSessionConflict'; } }
const isUniqueViolation = (e: any) => String(e?.code) === '23505' || /duplicate key|unique/i.test(String(e?.message || ''));
const TICKET_COLS = ['id', 'customer_id', 'primary_technician_id', 'helper_technician_id', 'status', 'serving_started_at', 'serving_paused_at', 'accumulated_paused_ms', 'serving_delay_status', 'serving_delay_reason', 'service_done_notes', 'service_done_customer_visible_notes', 'service_done_locked_at', 'ticket_number', 'station_label', 'updated_at'];

export class KyselyServingRepository implements ServingRepositoryPort {
  private seq = Date.now() % 1000000;
  // Constitution 8 §18: service.started / service.completed are written INSIDE the ticket status transaction;
  // service.paused / service.resumed ride the durable pause marker's transaction (an event sits on a fact, §3).
  // `deps.workforce` is the structural workforce-state projection (the Technician Profile work) — optional.
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null, private readonly deps: { workforce?: ServiceDoneWorkforcePort | null } = {}) {}
  /** The ticket's live PRIMARY session, if any. */
  private async liveSession(ctx: ServingContext, ticketId: string) {
    return this.db.selectFrom('ticket_service_sessions').select(['id', 'technician_id', 'status', 'idempotency_key', 'paused_at', 'started_at', 'completed_at']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('is_helper', '=', false).where('status', 'in', LIVE).executeTakeFirst().catch(() => undefined) as Promise<any>;
  }
  private async latestPrimarySession(ctx: ServingContext, ticketId: string) {
    return this.db.selectFrom('ticket_service_sessions').select(['id', 'technician_id', 'status', 'idempotency_key', 'paused_at', 'started_at', 'completed_at']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('is_helper', '=', false).orderBy('created_at', 'desc').executeTakeFirst().catch(() => undefined) as Promise<any>;
  }
  /** Any live primary session this technician holds in this tenant — the "one active service per technician" read. */
  async technicianActiveSession(ctx: ServingContext, technicianId: string): Promise<{ ticketId: string; status: string } | null> {
    const r: any = await this.db.selectFrom('ticket_service_sessions').select(['ticket_id', 'status']).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('is_helper', '=', false).where('status', 'in', LIVE).executeTakeFirst().catch(() => undefined);
    return r ? { ticketId: String(r.ticket_id), status: String(r.status) } : null;
  }
  /** One live session per (ticket, technician): a PAUSED row resumes, a missing one is inserted. The partial unique
   *  index (one active primary session per technician) makes a second guest a ServingSessionConflict. */
  private async openOrResumeSession(ctx: ServingContext, ticketId: string, technicianId: string, isHelper: boolean): Promise<void> {
    const live: any = await this.db.selectFrom('ticket_service_sessions').select(['id', 'status']).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId).where('technician_id', '=', technicianId).where('status', 'in', LIVE).executeTakeFirst().catch(() => undefined);
    if (live) {
      if (live.status === 'PAUSED') await this.db.updateTable('ticket_service_sessions').set({ status: 'STARTED', accumulated_paused_ms: sql`accumulated_paused_ms + coalesce((extract(epoch from (now() - paused_at)) * 1000)::bigint, 0)`, paused_at: null, version: sql`version + 1`, updated_at: sql`now()` } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', live.id).where(canMoveToSql(TICKET_SERVICE_SESSION, 'STARTED') as any).execute();
      return;
    }
    try {
      await this.db.insertInto('ticket_service_sessions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, ticket_id: ticketId, technician_id: technicianId, is_helper: isHelper, status: 'STARTED' }).execute();
    } catch (e: any) {
      if (isUniqueViolation(e)) throw new ServingSessionConflict();
      throw e;
    }
  }
  /** The clock (tests set it). */
  now: () => number = Date.now;
  /** The instant the BRANCH's day began, at its own midnight — "today" for every KPI below. the database's UTC midnight
   *  was the database's UTC day: after 8 pm in New York the evening's tickets dropped out of today (Oct 6 2026). */
  private async dayStart(ctx: { tenantId: string; branchId?: string | null }): Promise<Date> {
    return new Date(dayStartMs(await branchTimeZone(this.db, ctx.tenantId, ctx.branchId ?? null), new Date(this.now())));
  }
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }
  /** service.paused / service.resumed on the canonical ticket (both the POS and the tech-app paths record it). */
  private async pauseFact(trx: any, ctx: ServingContext, type: string, ticketId: string, technicianId: string | null): Promise<void> {
    if (!this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({ eventType: type as any, tenantId: ctx.tenantId, branchId: ctx.branchId || undefined, aggregateType: 'ticket', aggregateId: ticketId,
      actorId: ctx.userId || undefined, actorType: 'user', correlationId: `ticket:${ticketId}`, payload: { ticketId, technicianId, source: 'pos' } }));
  }   // not merely "has an outbox": the publisher must be ON
  private scoped(qb: any, ctx: ServingContext, a?: string): any {
    const col = (n: string) => (a ? `${a}.${n}` : n);
    let q = qb.where(col('tenant_id'), '=', ctx.tenantId);
    if (ctx.branchId) q = q.where((eb: any) => eb.or([eb(col('branch_id'), '=', ctx.branchId), eb(col('branch_id'), 'is', null)]));
    return q;
  }
  private _settings(): ServingWorkflowSettings { return DEFAULT_SERVING_SETTINGS; }
  async settings(ctx: ServingContext) {
    // tenant overlay (build doc §27): the technicianApp settings category refines the workflow defaults
    const base = this._settings();
    const row: any = await this.db.selectFrom('tenant_settings').where('tenant_id', '=', ctx.tenantId)
      .where('category', '=', 'technician-app')
      .where((eb: any) => eb.or([eb('branch_id', '=', ctx.branchId || ''), eb('branch_id', 'is', null)]))
      .select(['settings_json']).executeTakeFirst().catch(() => undefined);
    if (!row?.settings_json) return base;
    try {
      const v = typeof row.settings_json === 'string' ? JSON.parse(row.settings_json) : row.settings_json;
      return { ...base, ...['techCanAddService', 'techCanChangeService', 'techCanRemoveLine', 'requireApprovalForChangeService', 'requireApprovalForRemoveLine'].reduce((o: any, k) => (typeof v[k] === 'boolean' ? ((o[k] = v[k]), o) : o), {}) };
    } catch { return base; }
  }

  async techEditFeatureEnabled(ctx: ServingContext): Promise<boolean> {
    return readAppFlag(this.db, ctx.tenantId, 'tech_live_ticket_edit');
  }

  async rawTicketStatus(ctx: ServingContext, ticketId: string): Promise<string | null> {
    const r: any = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', ticketId).select(['status']).executeTakeFirst().catch(() => undefined);
    return r ? String(r.status) : null;
  }

  async insertTechNotification(ctx: ServingContext, n: { technicianId: string; type: string; title: string; body?: string | null; reference?: string | null }): Promise<void> {
    await this.db.insertInto('technician_notifications').values({
      tenant_id: ctx.tenantId, technician_id: n.technicianId, type: n.type, title: n.title, body: n.body ?? null, reference: n.reference ?? null,
    }).execute().catch(() => {});
  }

  /** Serving mandate §72: the guest's customer-app feed — the communications path Send Update uses (never an SMS call). */
  async insertCustomerNotification(ctx: ServingContext, n: { customerId: string; type: string; title: string; body?: string | null; reference?: string | null }): Promise<void> {
    await this.db.insertInto('customer_notifications').values({ tenant_id: ctx.tenantId, customer_id: n.customerId, type: n.type, title: n.title, body: n.body ?? null, reference: n.reference ?? null }).execute();
  }

  async insertChangeRequest(ctx: ServingContext, row: import('./serving.repository').ChangeRequestInsert): Promise<string> {
    // §18: the request row and ticket.change_request_created commit together (this was a bare INSERT).
    return this.db.transaction().execute(async (trx) => {
      const r: any = await trx.insertInto('ticket_change_requests').values({
        tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, ticket_id: row.ticketId, line_id: row.lineId ?? null,
        request_type: row.requestType, old_value_json: JSON.stringify(row.oldValue ?? null), new_value_json: JSON.stringify(row.newValue ?? null),
        reason: row.reason ?? null, requested_by_user_id: row.requestedByUserId ?? null, requested_by_technician_id: row.requestedByTechnicianId ?? null,
      }).returning('id').executeTakeFirst();
      const id = String(r.id);
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.TICKET_CHANGE_REQUEST_CREATED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'ticket_change_request', aggregateId: id,
        actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${row.ticketId}`,
        // §95: ids + the request TYPE — the old/new value snapshots stay in the row, not in the event
        payload: { requestId: id, ticketId: row.ticketId, lineId: row.lineId ?? null, requestType: row.requestType, requestedByTechnicianId: row.requestedByTechnicianId ?? null, hasReason: !!row.reason },
      }));
      return id;
    });
  }

  async listChangeRequests(ctx: ServingContext, f: { ticketId?: string; status?: string }) {
    let q: any = this.scoped(this.db.selectFrom('ticket_change_requests'), ctx).selectAll().orderBy('created_at', 'desc');
    if (f.ticketId) q = q.where('ticket_id', '=', f.ticketId);
    if (f.status) q = q.where('status', '=', f.status);
    const rows: any[] = await q.execute().catch(() => []);
    const j = (x: any) => { try { return typeof x === 'string' ? JSON.parse(x) : x; } catch { return x; } };
    return rows.map((r) => ({ id: r.id, ticketId: r.ticket_id, lineId: r.line_id, requestType: r.request_type, oldValue: j(r.old_value_json), newValue: j(r.new_value_json), reason: r.reason, requestedByUserId: r.requested_by_user_id, requestedByTechnicianId: r.requested_by_technician_id, status: r.status, approvedByUserId: r.approved_by_user_id, approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null, rejectedByUserId: r.rejected_by_user_id, rejectedAt: r.rejected_at ? new Date(r.rejected_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString() }));
  }

  async updateChangeRequest(ctx: ServingContext, id: string, patch: any) {
    const set: any = { updated_at: sql`now()` };
    if (patch.status) set.status = patch.status;
    if (patch.approvedByUserId !== undefined) set.approved_by_user_id = patch.approvedByUserId;
    if (patch.approvedAt !== undefined) set.approved_at = patch.approvedAt;
    if (patch.rejectedByUserId !== undefined) set.rejected_by_user_id = patch.rejectedByUserId;
    if (patch.rejectedAt !== undefined) set.rejected_at = patch.rejectedAt;
    // §18/§67: the decision and its past-tense event commit together. Only approved/rejected are facts worth an
    // event — a patch that only touches timestamps emits nothing.
    const decision = patch.status === 'approved' ? DOMAIN_EVENTS.TICKET_CHANGE_REQUEST_APPROVED
      : patch.status === 'rejected' ? DOMAIN_EVENTS.TICKET_CHANGE_REQUEST_REJECTED : null;
    const res: any = await this.db.transaction().execute(async (trx) => {
      // Phase 12 (#27): a decision moves only a request the TICKET_CHANGE_REQUEST machine allows (a decided request is final)
      const r: any = await this.scoped(trx.updateTable('ticket_change_requests'), ctx).set(set).where('id', '=', id).where(set.status ? canMoveToSql(TICKET_CHANGE_REQUEST, set.status) : sql<boolean>`true`).executeTakeFirst();
      if (!r || Number(r.numUpdatedRows ?? 0) === 0) return r;
      if (decision && this.outbox) {
        const cur: any = await trx.selectFrom('ticket_change_requests').select(['ticket_id', 'requested_by_technician_id']).where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst();
        await this.outbox.write(trx, createDomainEvent({
          eventType: decision, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'ticket_change_request', aggregateId: id,
          actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${cur?.ticket_id ?? id}`,
          payload: { requestId: id, ticketId: cur?.ticket_id ?? null, requestedByTechnicianId: cur?.requested_by_technician_id ?? null, status: patch.status },
        }));
      }
      return r;
    }).catch(() => undefined);
    if (!res || Number(res.numUpdatedRows ?? 0) === 0) return null;
    const list = await this.listChangeRequests(ctx, {});
    return list.find((r) => r.id === id) ?? null;
  }

  private async _techs(ctx: ServingContext): Promise<TechnicianOption[]> {
    const rows = await this.scoped(this.db.selectFrom('technicians'), ctx).where('status', '!=', 'archived').select(['id', 'full_name', 'status']).execute().catch(() => []);
    const ids = rows.map((r: any) => r.id);
    const stat = ids.length ? await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', ids).select(['technician_id', 'status']).execute().catch(() => []) : [];
    const by: Record<string, string> = {}; for (const s of stat) by[s.technician_id] = s.status;
    return rows.map((r: any) => ({ technicianId: r.id, name: r.full_name || r.id, role: 'Technician', available: by[r.id] ? by[r.id] === 'available' : r.status === 'active' }));
  }
  async technicians(ctx: ServingContext) { return this._techs(ctx); }
  private async _catalog(ctx: ServingContext): Promise<ServiceOption[]> {
    const rows = await this.scoped(this.db.selectFrom('services as s'), ctx, 's').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .select(['s.id as serviceId', 's.name as name', 'c.name as categoryName', 's.duration_minutes as dur', 's.price_cents as price']).execute().catch(() => []);
    return rows.map((r: any) => ({ serviceId: r.serviceId, name: r.name, categoryName: r.categoryName || 'General', durationMinutes: Number(r.dur || 0), priceCents: Number(r.price || 0) }));
  }
  async services(ctx: ServingContext) { return this._catalog(ctx); }
  async serviceCatalog(ctx: ServingContext, serviceId: string) { return (await this._catalog(ctx)).find((s) => s.serviceId === serviceId) || null; }

  /** The serving status vocabulary (wider than tickets.status), derived from durable columns only. */
  private deriveStatus(t: any, session: any | null): ServingTicketStatus {
    const raw = String(t.status);
    if (raw === 'service_done') return t.service_done_locked_at ? 'sent_to_service_done' : 'completed';
    if (raw === 'accepted' && !t.serving_started_at) return 'not_started';
    if (t.serving_paused_at || session?.status === 'PAUSED') return 'paused';
    if (String(t.serving_delay_status || 'none') !== 'none') return 'delayed';
    return 'in_service';
  }
  /** Serving mandate §108 (Oct 28 2026): the floor is hydrated in FOUR batch queries (latest primary sessions, live lines,
   *  technician names, customers) for any number of tickets — it was 3–4 queries PER ticket (a 100-guest floor ran ~400). */
  private async hydrateMany(ctx: ServingContext, tickets: any[]): Promise<SVTicket[]> {
    if (tickets.length === 0) return [];
    const ids = tickets.map((t) => t.id);
    // Nov 6 2026: no catch on these two — a failed read made a ticket look like it had no lines ("Service line not found",
    // a wrong serving status). The name / customer label reads below may still degrade to blanks.
    const [sessions, rawLines] = await Promise.all([
      this.db.selectFrom('ticket_service_sessions').select(['ticket_id', 'id', 'technician_id', 'status', 'idempotency_key', 'created_at'])
        .where('tenant_id', '=', ctx.tenantId).where('ticket_id', 'in', ids).where('is_helper', '=', false).orderBy('created_at', 'desc').execute(),
      this.scoped(this.db.selectFrom('ticket_service_lines'), ctx).where('ticket_id', 'in', ids).where('removed_at', 'is', null)
        .select(['id', 'ticket_id', 'service_id', 'service_name_snapshot', 'technician_id', 'price_cents_snapshot', 'line_total_cents', 'duration_minutes_snapshot', 'status', 'is_add_on', 'category_snapshot', 'created_at']).orderBy('created_at').execute(),
    ]);
    const sessionBy: Record<string, Row> = {}; for (const x of sessions as Row[]) if (!sessionBy[x.ticket_id]) sessionBy[x.ticket_id] = x;   // latest first
    const linesBy: Record<string, Row[]> = {}; for (const l of rawLines as Row[]) (linesBy[l.ticket_id] ??= []).push(l);
    const techIds = [...new Set([...(rawLines as Row[]).map((l) => l.technician_id), ...tickets.flatMap((t) => [t.primary_technician_id, t.helper_technician_id])].filter(Boolean))];
    const custIds = [...new Set(tickets.map((t) => t.customer_id).filter(Boolean))];
    const [techs, custs] = await Promise.all([
      techIds.length ? this.scoped(this.db.selectFrom('technicians'), ctx).where('id', 'in', techIds).select(['id', 'full_name']).execute().catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
      custIds.length ? this.scoped(this.db.selectFrom('customers'), ctx).where('id', 'in', custIds).select(['id', 'full_name', 'phone_display', 'avatar_url']).execute().catch(() => [] as Row[]) : Promise.resolve([] as Row[]),
    ]);
    const tn: Record<string, string> = {}; for (const x of techs as Row[]) tn[x.id] = x.full_name;
    const cust: Record<string, Row> = {}; for (const c of custs as Row[]) cust[c.id] = c;
    return tickets.map((t) => {
      const session = sessionBy[t.id] ?? null;
      const lines: SVLine[] = (linesBy[t.id] || []).map((l: any) => ({ serviceLineId: l.id, serviceId: l.service_id, serviceName: l.service_name_snapshot || l.service_id, category: l.category_snapshot || undefined, priceCents: Number(l.price_cents_snapshot ?? l.line_total_cents ?? 0), technicianId: l.technician_id || undefined, technicianName: tn[l.technician_id] || undefined, status: (l.status || 'serving') as ServiceLineStatus, isAddOn: !!l.is_add_on, estDurationMin: Number(l.duration_minutes_snapshot || 0) }));
      const c = t.customer_id ? cust[t.customer_id] : undefined;
      // §32: the estimate is the ticket's OWN lines' duration snapshots — no universal default (it was `|| 45`): a ticket
      // with no durations is never "finishing" or "delayed" by a guessed clock
      const estBase = lines.reduce((a, l) => a + (l.estDurationMin || 0), 0);
      const status = this.deriveStatus(t, session);
      return {
        ticketId: t.id, ticketNumber: t.ticket_number ? String(t.ticket_number) : '#' + String(t.id).slice(0, 6), customerId: t.customer_id || '', customerName: c?.full_name || '', customerPhone: c?.phone_display || undefined, avatarUrl: c?.avatar_url || undefined, isVip: false, loyaltyTier: undefined,
        station: t.station_label || undefined, lines, primaryTechId: t.primary_technician_id || undefined, primaryTechName: t.primary_technician_id ? tn[t.primary_technician_id] : undefined, helperTechId: t.helper_technician_id || undefined, helperTechName: t.helper_technician_id ? tn[t.helper_technician_id] : undefined,
        startedAtMs: ms(t.serving_started_at), pausedAtMs: ms(t.serving_paused_at), accumulatedPausedMs: Number(t.accumulated_paused_ms || 0), estimatedDurationMinutes: estBase,
        status, delayStatus: (t.serving_delay_status || 'none') as DelayStatus, delayReason: t.serving_delay_reason || undefined, notes: t.service_done_notes || '', customerVisibleNotes: t.service_done_customer_visible_notes || '',
        sentIdempotencyKey: t.service_done_locked_at && session?.idempotency_key ? String(session.idempotency_key) : undefined, updatedAt: t.updated_at ? new Date(t.updated_at).toISOString() : new Date().toISOString(),
      };
    });
  }
  private async load(ctx: ServingContext, id: string): Promise<SVTicket | null> {
    const t = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id).select(TICKET_COLS).executeTakeFirst().catch(() => undefined);
    return t ? (await this.hydrateMany(ctx, [t]))[0] : null;
  }
  /** The floor: in service + at Service Done, and (§4 / §24) guests ASSIGNED to a technician and not started yet — the
   *  "Ready to Start" column Start Service acts on (an accepted ticket with no technician is still the Customer Queue's). */
  private async loadAll(ctx: ServingContext): Promise<SVTicket[]> {
    const rows = await this.scoped(this.db.selectFrom('tickets'), ctx).where('removed_at', 'is', null)
      .where((eb: any) => eb.or([eb('status', 'in', ['serving', 'service_done']), eb.and([eb('status', '=', 'accepted'), eb('primary_technician_id', 'is not', null)])]))
      .select(TICKET_COLS).orderBy('created_at').execute().catch(() => []);
    return this.hydrateMany(ctx, rows as Row[]);
  }
  async ticket(ctx: ServingContext, id: string) { return this.load(ctx, id); }

  private elapsed(t: SVTicket) { return computeElapsedMinutes({ startedAtMs: t.startedAtMs, pausedAtMs: t.pausedAtMs, accumulatedPausedMs: t.accumulatedPausedMs, nowMs: Date.now() }); }
  private estEnd(t: SVTicket): string | null { return t.startedAtMs ? new Date(t.startedAtMs + t.accumulatedPausedMs + t.estimatedDurationMinutes * 60000).toISOString() : null; }
  private derivedDelay(t: SVTicket): DelayStatus { return t.delayStatus !== 'none' ? t.delayStatus : deriveDelayStatus(this.elapsed(t), t.estimatedDurationMinutes, this._settings().delayAlertMinutes); }
  private toRow(ctx: ServingContext, t: SVTicket): POSServingTicketRow {
    const sub = subtotalFromServingLines(t.lines); const el = this.elapsed(t);
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: t.customerId, customerName: t.customerName, customerPhone: t.customerPhone, customerAvatarUrl: t.avatarUrl, isVip: t.isVip,
      station: t.station, serviceCount: t.lines.length, serviceNames: t.lines.map((l) => l.serviceName), stage: servingStageLabel(t.status, el, t.estimatedDurationMinutes), addOnsLabel: t.lines.filter((l) => l.isAddOn).map((l) => l.serviceName).join(", ") || undefined, primaryTechnicianId: t.primaryTechId, primaryTechnicianName: t.primaryTechName, helperTechnicianId: t.helperTechId, helperTechnicianName: t.helperTechName,
      startedAt: t.startedAtMs ? new Date(t.startedAtMs).toISOString() : undefined, pausedAt: t.pausedAtMs ? new Date(t.pausedAtMs).toISOString() : null, estimatedEndAt: this.estEnd(t),
      elapsedMinutes: el, estimatedDurationMinutes: t.estimatedDurationMinutes, subtotalCents: sub, estimatedCommissionCents: null, status: t.status, delayStatus: this.derivedDelay(t), notes: t.notes,
      technicianNames: [...new Set([t.primaryTechName, ...t.lines.map((l) => l.technicianName)].filter((x): x is string => !!x))],
    };
  }

  async query(ctx: ServingContext, f: ServingFilters): Promise<POSServingFullState> {
    const all = await this.loadAll(ctx);
    let rows = all.slice();
    if (f.search) { const q = f.search.toLowerCase(); rows = rows.filter((t) => [t.ticketNumber, t.customerName, t.customerPhone, t.primaryTechName, t.station, ...t.lines.map((l) => l.serviceName)].some((x) => (x || '').toLowerCase().includes(q))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.technicianId) rows = rows.filter((t) => t.primaryTechId === f.technicianId || t.helperTechId === f.technicianId);
    if (f.serviceCategory) rows = rows.filter((t) => t.lines.some((l) => l.category === f.serviceCategory));
    if (f.station) rows = rows.filter((t) => t.station === f.station);
    if (f.delayStatus) rows = rows.filter((t) => this.derivedDelay(t) === f.delayStatus);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((t) => this.toRow(ctx, t));
    const pagination: Pagination = { page, pageSize, totalItems, totalPages };
    const active = all.filter((t) => ['in_service', 'paused', 'delayed'].includes(t.status));
    const durations = active.map((t) => this.elapsed(t)).filter((d) => d > 0);
    // Customer satisfaction (same source as Service Done): avg rating over today's paid tickets.
    const satRow = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('satisfaction_rating', 'is not', null).where('paid_at', '>=', (await this.dayStart(ctx)))
      .select(sql<number>`round(avg(satisfaction_rating)::numeric, 2)`.as('avg'))
      .executeTakeFirst().catch(() => undefined);
    // §85: no rating today → null ("Not enough data"); coalesce(…, 0) showed a 0.0 score nobody gave
    const customerSatisfactionAvg = satRow?.avg != null ? Math.max(0, Number(satRow.avg)) : null;
    // On-time completion: of tickets completed today, the share whose actual duration did not exceed the estimate
    // (estimate = sum of the ticket's service-line duration snapshots).
    const otRows = await this.scoped(this.db.selectFrom('tickets'), ctx)
      .where('service_done_at', '>=', (await this.dayStart(ctx))).where('serving_started_at', 'is not', null)
      .select('id').select(sql<number>`extract(epoch from (service_done_at - serving_started_at)) / 60.0`.as('actual'))
      .execute().catch(() => []);
    let onTimeCompletionPercent: number | null = null;
    const otIds = (otRows as any[]).map((r) => r.id).filter(Boolean);
    if (otIds.length) {
      const estRows = await this.scoped(this.db.selectFrom('ticket_service_lines'), ctx)
        .where('ticket_id', 'in', otIds)
        .select('ticket_id').select(sql<number>`coalesce(sum(duration_minutes_snapshot), 0)`.as('est')).groupBy('ticket_id')
        .execute().catch(() => []);
      const estByTicket: Record<string, number> = {};
      for (const r of estRows) estByTicket[r.ticket_id] = Number(r.est || 0);
      onTimeCompletionPercent = computeOnTimeCompletionPercent((otRows as any[]).map((r) => ({ actualMinutes: Number(r.actual || 0), estimatedMinutes: estByTicket[r.id] || 0 })));
    }
    // §16 servicesCompletedToday: tickets that reached Service Done since the branch's local midnight (it counted the
    // tickets STILL at service_done — a guest who moved on to checkout dropped out of "today")
    const doneToday = await this.scoped(this.db.selectFrom('tickets'), ctx).where('service_done_at', '>=', (await this.dayStart(ctx)))
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: Row | undefined) => Number(r?.c || 0)).catch(() => (otRows as Row[]).length);
    const kpis: POSServingKpisFull = {
      servingNow: all.filter((t) => t.status === 'in_service').length, activeTickets: active.length,
      delayedServices: all.filter((t) => t.status === 'delayed' || this.derivedDelay(t) === 'late' || this.derivedDelay(t) === 'critical').length,
      nearingCompletion: active.filter((t) => t.estimatedDurationMinutes > 0 && this.elapsed(t) >= t.estimatedDurationMinutes * FINISHING_SOON_FRACTION).length,
      averageServiceDurationMinutes: durations.length ? Math.round(durations.reduce((a, d) => a + d, 0) / durations.length) : null,
      totalInServiceSalesCents: active.reduce((a, t) => a + subtotalFromServingLines(t.lines), 0), techniciansInService: 0,   // set from the floor projection below
      servicesCompletedToday: doneToday,
      ...computeServingAddOnMetrics(all.filter((t) => t.status !== 'not_started')),
      customerSatisfactionAvg,
      onTimeCompletionPercent,
      techniciansTotal: await this.scoped(this.db.selectFrom('technicians'), ctx).where('status', '!=', 'archived').select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => Math.max(0, Number(r?.c || 0))).catch(() => 0),
    };
    // ---- Reference-module aggregations (real, fail-soft) ----
    // Real service categories for Service Mix (service_id -> category name; same join as Service Done).
    const serviceIds = [...new Set(all.flatMap((t) => t.lines.map((l) => l.serviceId).filter(Boolean)))] as string[];
    const catByService: Record<string, string> = {};
    if (serviceIds.length) {
      const svc = await this.scoped(this.db.selectFrom('services'), ctx).where('id', 'in', serviceIds).select(['id', 'category_id']).execute().catch(() => [] as any[]);
      const catIds = [...new Set((svc as any[]).map((x) => x.category_id).filter(Boolean))];
      const catNames: Record<string, string> = {};
      if (catIds.length) { const cats = await this.scoped(this.db.selectFrom('service_categories'), ctx).where('id', 'in', catIds).select(['id', 'name']).execute().catch(() => [] as any[]); for (const c of cats as any[]) catNames[c.id] = c.name; }
      for (const x of svc) catByService[x.id] = catNames[x.category_id] || '';
    }
    const enrich = (t: SVTicket) => ({ ...t, lines: t.lines.map((l) => ({ serviceId: l.serviceId, serviceName: l.serviceName, category: l.serviceId ? (catByService[l.serviceId] || l.category) : l.category, isAddOn: l.isAddOn, priceCents: l.priceCents })) });
    const activeEnriched = active.map(enrich);
    const isFinishing = (t: SVTicket) => t.estimatedDurationMinutes > 0 && this.elapsed(t) >= t.estimatedDurationMinutes * FINISHING_SOON_FRACTION;
    // Service Time Trend: average elapsed (min) of active services bucketed by start hour.
    const trendBy: Record<number, { sum: number; n: number }> = {};
    for (const t of active) { if (!t.startedAtMs) continue; const h = new Date(t.startedAtMs).getHours(); const e = (trendBy[h] ||= { sum: 0, n: 0 }); e.sum += this.elapsed(t); e.n += 1; }
    const serviceTimeTrend = Object.keys(trendBy).map(Number).sort((a, b) => a - b).map((hour) => ({ hour, minutes: Math.round(trendBy[hour].sum / trendBy[hour].n) }));
    // §66–§67: the funnel is a projection of the canonical statuses on the floor — Started (has a server start), Finishing
    // (active and past the finishing fraction), Service Done (completed today)
    const startedCount = all.filter((t) => t.startedAtMs).length;
    const analytics: ServingAnalytics = {
      serviceTimeTrend,
      serviceMix: buildServingServiceMix(activeEnriched),
      addOnMix: buildServingAddOnMix(activeEnriched),
      funnel: { started: startedCount, finishing: active.filter(isFinishing).length, serviceDone: kpis.servicesCompletedToday, completionRatePercent: startedCount > 0 ? Math.round((kpis.servicesCompletedToday / startedCount) * 1000) / 10 : 0 },
      potentialRevenue: { inServiceCents: 0, addOnsPendingCents: 0, finishingSoonCents: 0, readyToCompleteCents: 0, totalCents: 0 },   // set from the floor projection below (one rule for both adapters)
      potentialRevenueDeltaPercent: null,
    };
    // Per-tech rating (today's paid tickets) — same source as Service Done.
    const ratingByTech: Record<string, number | null> = {};
    const ratingRows = await this.scoped(this.db.selectFrom('tickets'), ctx).where('satisfaction_rating', 'is not', null).where('paid_at', '>=', (await this.dayStart(ctx))).where('primary_technician_id', 'is not', null)
      .select(['primary_technician_id', sql<number>`avg(satisfaction_rating)`.as('avg')]).groupBy('primary_technician_id').execute().catch(() => [] as any[]);
    for (const r of ratingRows) if (r.primary_technician_id != null) ratingByTech[r.primary_technician_id] = Math.round(Number(r.avg) * 10) / 10;
    const techPerformance = buildServingTechPerformance(active.map((t) => ({ primaryTechId: t.primaryTechId, primaryTechName: t.primaryTechName, lines: t.lines, elapsedMinutes: this.elapsed(t) })), ratingByTech);
    // Canonical technician utilization (shared with Overview/Dashboard) — busy appt minutes / available minutes.
    const utilMap = await loadTechUtilization(this.db, { tenantId: ctx.tenantId, branchId: ctx.branchId });
    for (const tp of techPerformance) if (tp.technicianId) tp.utilizationPercent = utilMap.get(tp.technicianId) ?? null;
    // Available / Finishing technicians — live presence + specialties + active-line load (same as Service Done).
    const techRows = await this.scoped(this.db.selectFrom('technicians'), ctx).where('status', '!=', 'archived').select(['id', 'full_name', 'status']).execute().catch(() => [] as any[]);
    const techIds = (techRows as any[]).map((r) => r.id);
    // w4 sweep SW-11: technicians has no `specialties` column (selecting it emptied this whole panel) — the specialty is
    // the technician's own skill groups (technician_skills, the skills the Fair Turn engine routes on)
    const skillRows = techIds.length ? await this.db.selectFrom('technician_skills').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', techIds).select(['technician_id', 'skill_group']).orderBy('created_at').execute().catch(() => [] as any[]) : [];
    const skillsBy: Record<string, string[]> = {}; for (const k of skillRows) { const l = (skillsBy[k.technician_id] ??= []); if (!l.includes(k.skill_group)) l.push(k.skill_group); }
    const statRows = techIds.length ? await this.scoped(this.db.selectFrom('technician_statuses'), ctx).where('technician_id', 'in', techIds).select(['technician_id', 'status']).execute().catch(() => [] as any[]) : [];
    const statBy: Record<string, string> = {}; for (const sr of statRows) statBy[sr.technician_id] = sr.status;
    const specOf = (raw: unknown): string | undefined => { let arr: any = raw; if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch { arr = []; } } return Array.isArray(arr) && arr.length ? arr.slice(0, 2).map(String).join(', ') : undefined; };
    const SV_STATUS: Record<string, string> = { available: 'Available', busy: 'Busy', serving: 'Busy', finishing: 'Finishing Soon', on_break: 'Break', break: 'Break' };
    // §59–§60: the authoritative technician status (technician_statuses — clocked in / break / serving) decides who is on
    // duty; `active=true` alone is not availability (a technician with no status row is not shown as free)
    const staffRows: ServingStaffRow[] = (techRows as Row[]).map((r) => { const raw = statBy[r.id]; const label = raw ? SV_STATUS[String(raw).toLowerCase()] : undefined; if (!label) return null; return { technicianId: r.id, name: r.full_name || r.id, specialty: specOf(skillsBy[r.id]), currentLoad: 0, nextAvailable: label === 'Available' ? 'Now' : label === 'Finishing Soon' ? 'Soon' : '—', status: label }; }).filter(Boolean) as ServingStaffRow[];
    // §62 / §17: capped panel + counts for everyone, stage counts over all tickets, line-owner-aware busy count, insights
    const floor = buildFloorProjection(all, (t) => this.elapsed(t), staffRows, Number(kpis.techniciansTotal || 0));
    kpis.techniciansInService = floor.techniciansInService;
    kpis.techniciansOnDuty = staffRows.length || Number(kpis.techniciansTotal || 0);
    kpis.readyToStart = floor.readyToStart;
    analytics.potentialRevenue = floor.potentialRevenue;
    const staff = floor.staff; const insights = floor.insights;
    // Real day-over-day KPI trends via the shared snapshot helper.
    // a KPI with no population today is not snapshotted (a null must not become a 0 baseline for tomorrow's trend)
    const snap: Record<string, number> = {};
    for (const [k, v] of Object.entries({ active: kpis.servingNow, readyToFinish: kpis.nearingCompletion, avgTime: kpis.averageServiceDurationMinutes, techsBusy: kpis.techniciansInService,
      addOnConversion: kpis.addOnAttachRatePercent, delayed: kpis.delayedServices, upsellRevenue: kpis.addOnRevenueCents, satisfaction: kpis.customerSatisfactionAvg, onTime: kpis.onTimeCompletionPercent })) if (v != null) snap[k] = v;
    const kpiTrends = await new PosKpiSnapshots(this.db).snapshotAndTrends(ctx.tenantId, ctx.branchId, 'serving', snap, ['avgTime', 'delayed']);
    return {
      kpis, kpiTrends, analytics, techPerformance, staff, staffSummary: floor.staffSummary, insights, stageCounts: floor.stageCounts, tickets: { items: pageRows, pagination },
      filters: {
        statuses: ['not_started', 'in_service', 'paused', 'delayed', 'completed', 'sent_to_service_done'], technicians: [...new Set(all.map((t) => t.primaryTechName || ''))].filter(Boolean),
        serviceCategories: [...new Set(all.flatMap((t) => t.lines.map((l) => l.category || '')))].filter(Boolean), stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean), delayStatuses: ['none', 'warning', 'late', 'critical'],
      },
      workflowSettings: this._settings(),
    };
  }

  async detail(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull | null> {
    const t = await this.load(ctx, id); if (!t) return null; const sub = subtotalFromServingLines(t.lines);
    // Real guest summary: loyalty points + preferred technician name (Guest Service Details).
    let loyaltyPoints: number | undefined, preferredTechName: string | undefined;
    if (t.customerId) {
      // w4 sweep SW-08: points live on customer_loyalty_profiles (one per tenant + customer), not on customers — selecting
      // customers.points_balance failed the whole statement and hid BOTH fields
      const c = await this.scoped(this.db.selectFrom('customers'), ctx).where('id', '=', t.customerId).select(['preferred_technician_id']).executeTakeFirst().catch(() => undefined);
      const lp = await this.db.selectFrom('customer_loyalty_profiles').select(['points_balance']).where('tenant_id', '=', ctx.tenantId).where('customer_id', '=', t.customerId).executeTakeFirst().catch(() => undefined);
      loyaltyPoints = lp ? Number(lp.points_balance || 0) : undefined;
      if (c) {
        const ptid = c.preferred_technician_id;
        if (ptid) { const pt = await this.scoped(this.db.selectFrom('technicians'), ctx).where('id', '=', ptid).select(['full_name']).executeTakeFirst().catch(() => undefined); preferredTechName = pt?.full_name || undefined; }
      }
    }
    return {
      ticketId: t.ticketId, ticketNumber: t.ticketNumber, customer: { customerId: t.customerId, fullName: t.customerName, phone: t.customerPhone, isVip: t.isVip, loyaltyTier: t.loyaltyTier, loyaltyPoints, preferredTechName },
      station: t.station, services: t.lines.map((l) => ({ serviceLineId: l.serviceLineId, serviceId: l.serviceId, serviceName: l.serviceName, category: l.category, priceCents: l.priceCents, technicianId: l.technicianId, technicianName: l.technicianName, status: l.status, isAddOn: l.isAddOn })),
      primaryTechnician: t.primaryTechId ? { technicianId: t.primaryTechId, name: t.primaryTechName! } : undefined, helperTechnician: t.helperTechId ? { technicianId: t.helperTechId, name: t.helperTechName! } : null,
      startedAt: t.startedAtMs ? new Date(t.startedAtMs).toISOString() : undefined, pausedAt: t.pausedAtMs ? new Date(t.pausedAtMs).toISOString() : null, estimatedEndAt: this.estEnd(t),
      elapsedMinutes: this.elapsed(t), estimatedDurationMinutes: t.estimatedDurationMinutes, delayStatus: this.derivedDelay(t), delayReason: t.delayReason, notes: t.notes, customerVisibleNotes: t.customerVisibleNotes,
      subtotalCents: sub, estimatedCommissionCents: null, status: t.status, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }],
    };
  }

  // ---- timer (durable: tickets.serving_started_at / serving_paused_at + ticket_service_sessions) ----
  /** Serving mandate §25–§26, §101: the start is a compare-and-set on `serving_started_at IS NULL` — two stations starting
   *  the same guest produce ONE start time (the server's now()), ONE service.started, ONE Fair Turn move; the loser answers
   *  'duplicate'. A database failure is no longer swallowed (it returned true with nothing written). */
  async start(ctx: ServingContext, id: string): Promise<boolean | 'duplicate'> {
    const t = await this.load(ctx, id); if (!t || !['not_started', 'paused'].includes(t.status)) return false;
    if (!t.startedAtMs) {
      const won = await this.db.transaction().execute(async (trx) => {
        const cas: any = await this.scoped(trx.updateTable('tickets'), ctx).set({ serving_started_at: sql`now()`, status: 'serving', updated_at: sql`now()` }).where('id', '=', id).where('serving_started_at', 'is', null).where('status', 'in', ['accepted', 'serving']).executeTakeFirst();
        if (Number(cas?.numUpdatedRows ?? 0) === 0) return false;
        // Developer (Sep 2026): the queue item and the linked appointment follow the serving start — same transaction.
        await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ status: 'in_service', started_at: sql`now()`, updated_at: sql`now()` })   /* 'serving' is a ticket status; the queue item's is in_service */.where((eb: any) => eb.or([eb('id', '=', id), eb('ticket_id', '=', id)])).where(canMoveToSql(QUEUE_ITEM, 'in_service')).executeTakeFirst().catch(() => undefined);
        await this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ status: 'in_service', updated_at: sql`now()` }).where('id', '=', id).where(canMoveToSql(APPOINTMENT, 'in_service')).executeTakeFirst().catch(() => undefined);
        if (this.outbox) await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.SERVICE_STARTED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'ticket', aggregateId: id,
          actorId: ctx.userId, actorType: 'user', payload: { ticketId: id, technicianId: (t as any).technicianId ?? null } }));
        // Fair Turn Engine §86: the technicians on this ticket are SERVING in the turn queue (same transaction)
        const tk: any = await this.scoped(trx.selectFrom('tickets'), ctx).select(['branch_id', 'queue_item_id']).where('id', '=', id).executeTakeFirst();
        const techs = [t.primaryTechId, t.helperTechId].filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
        if (tk?.branch_id && techs.length) await turnServiceStart(trx, { tenantId: ctx.tenantId, branchId: String(tk.branch_id), technicianIds: techs, queueItemId: tk.queue_item_id ?? null, ticketId: id,
          actor: { userId: /^[0-9a-f-]{36}$/i.test(String(ctx.userId ?? '')) ? ctx.userId : null } }, { outbox: this.outbox });
        return true;
      });
      if (!won) return 'duplicate';
    }
    if (t.pausedAtMs) {
      // a start from PAUSED is a resume: close the paused span on the canonical ticket (service.resumed rides it)
      await this.db.transaction().execute(async (trx) => {
        const r: any = await this.scoped((trx as unknown as Kysely<DB>).updateTable('tickets'), ctx).set({ accumulated_paused_ms: sql`accumulated_paused_ms + (extract(epoch from (now() - serving_paused_at)) * 1000)::bigint`, serving_paused_at: null, status: 'serving', updated_at: sql`now()` }).where('id', '=', id).where('serving_paused_at', 'is not', null).executeTakeFirst();
        if (Number(r?.numUpdatedRows ?? 0) > 0) await this.pauseFact(trx, ctx, DOMAIN_EVENTS.SERVICE_RESUMED, id, t.primaryTechId ?? null);
      }).catch(() => undefined);
    }
    // the durable session rows: ONE live primary session per technician (586 partial unique index → ServingSessionConflict)
    if (t.primaryTechId) await this.openOrResumeSession(ctx, id, t.primaryTechId, false);
    if (t.helperTechId) await this.openOrResumeSession(ctx, id, t.helperTechId, true).catch(() => undefined);
    return true;
  }
  async pause(ctx: ServingContext, id: string): Promise<boolean> {
    const t = await this.load(ctx, id); if (!t || t.status !== 'in_service') return false;
    // Durable pause marker on the canonical ticket (survives restart, visible cross-replica). Guarded so a re-pause does
    // not reset the clock; service.paused is recorded only on a REAL pause (the marker was clear), in its transaction.
    await this.db.transaction().execute(async (trx) => {
      const r: any = await this.scoped((trx as unknown as Kysely<DB>).updateTable('tickets'), ctx).set({ serving_paused_at: sql`now()`, updated_at: sql`now()` }).where('id', '=', id).where('serving_paused_at', 'is', null).executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) > 0) await this.pauseFact(trx, ctx, DOMAIN_EVENTS.SERVICE_PAUSED, id, t.primaryTechId ?? null);
    }).catch(() => undefined);
    await this.db.updateTable('ticket_service_sessions').set({ status: 'PAUSED', paused_at: sql`now()`, version: sql`version + 1`, updated_at: sql`now()` } as any).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', id).where('status', '=', 'STARTED').where(canMoveToSql(TICKET_SERVICE_SESSION, 'PAUSED') as any).execute().catch(() => undefined);
    return true;
  }
  async resume(ctx: ServingContext, id: string): Promise<boolean> {
    const t = await this.load(ctx, id); if (!t || t.status !== 'paused') return false;
    await this.db.transaction().execute(async (trx) => {
      const r: any = await this.scoped((trx as unknown as Kysely<DB>).updateTable('tickets'), ctx).set({ accumulated_paused_ms: sql`accumulated_paused_ms + (extract(epoch from (now() - serving_paused_at)) * 1000)::bigint`, serving_paused_at: null, updated_at: sql`now()` }).where('id', '=', id).where('serving_paused_at', 'is not', null).executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) > 0) await this.pauseFact(trx, ctx, DOMAIN_EVENTS.SERVICE_RESUMED, id, t.primaryTechId ?? null);
    }).catch(() => undefined);
    await this.db.updateTable('ticket_service_sessions').set({ status: 'STARTED', accumulated_paused_ms: sql`accumulated_paused_ms + coalesce((extract(epoch from (now() - paused_at)) * 1000)::bigint, 0)`, paused_at: null, version: sql`version + 1`, updated_at: sql`now()` } as any).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', id).where('status', '=', 'PAUSED').where(canMoveToSql(TICKET_SERVICE_SESSION, 'STARTED') as any).execute().catch(() => undefined);
    return true;
  }

  async setNotes(ctx: ServingContext, id: string, notes?: string, customerVisibleNotes?: string): Promise<boolean> {
    const set: any = { updated_at: sql`now()` };
    if (notes != null) set.service_done_notes = String(notes).slice(0, 4000);
    if (customerVisibleNotes != null) set.service_done_customer_visible_notes = String(customerVisibleNotes).slice(0, 4000);
    const res: any = await this.scoped(this.db.updateTable('tickets'), ctx).set(set).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  // ---- service lines (REAL writes to ticket_service_lines) ----
  async addService(ctx: ServingContext, id: string, lineIn: SVLine): Promise<boolean | 'duplicate'> {
    if (!(await this.load(ctx, id))) return false;
    // Snapshot the service's commission rate onto the line (see queue.createTicketFromQueueItem) so tech earnings are
    // computed from the rate at creation time; otherwise the *_snapshot columns stay NULL and commission reads as $0.
    const comm = (await this.db.selectFrom('services as s').leftJoin('service_categories as c', 'c.id', 's.category_id')
      .where('s.tenant_id', '=', ctx.tenantId).where('s.id', '=', lineIn.serviceId)
      .select(['s.commission_type as commission_type', 's.commission_value as commission_value', 'c.name as category']).executeTakeFirst().catch(() => undefined));
    // §4 precedence, the SAME as queue visit-ticket creation / stampCommissionOnLine (Payroll mandate §11): authored rule
    // (resolved with the service's REAL category — the caller's label only when the catalog has none) → the service's
    // own rate → the tenant default. Never a NULL snapshot. Resolved as-of now and baked onto the line, so adding a future
    // rule never moves historical tickets (§5/§14); policy_id / rule_source carry the provenance (migration 587).
    const category: string | null = comm?.category ?? lineIn.category ?? null;
    const [resolvedComm, tenantDefault] = await Promise.all([
      resolveLineCommission(this.db, { tenantId: ctx.tenantId, branchId: ctx.branchId, technicianId: lineIn.technicianId || null, serviceId: lineIn.serviceId, serviceCategory: category }),
      defaultCommissionForTenant(this.db, ctx.tenantId),
    ]);
    const picked = pickLineCommission(resolvedComm, comm ?? null, tenantDefault);
    // §18/§67: the line and ticket.service_line_added commit together — the guest's bill changed, and that is a fact.
    try { await this.db.transaction().execute(async (trx) => {
  await trx.insertInto('ticket_service_lines').values({ ...(UUID_RE.test(lineIn.serviceLineId ?? '') ? { id: lineIn.serviceLineId } : {}), tenant_id: ctx.tenantId, branch_id: ctx.branchId, ticket_id: id, service_id: (lineIn.serviceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lineIn.serviceId)) ? lineIn.serviceId : '00000000-0000-0000-0000-000000000000' /* developer: ad-hoc (non-catalog) lines */, technician_id: lineIn.technicianId || null, service_name_snapshot: lineIn.serviceName, price_cents_snapshot: lineIn.priceCents, duration_minutes_snapshot: lineIn.estDurationMin, commission_type_snapshot: picked.commissionType, commission_value_snapshot: picked.commissionValue, supply_method_snapshot: picked.supplyMethod, supply_value_snapshot: picked.supplyValue, policy_id: picked.policyId, rule_source: picked.source, line_total_cents: lineIn.priceCents, status: lineIn.status, category_snapshot: category, is_add_on: !!lineIn.isAddOn, quantity: 1, notes: (lineIn as any).notes ?? null, added_by_user_id: ctx.userId || null, added_by_role: ctx.role || null } as any).executeTakeFirst();   // §103: no swallow — a failed insert wrote the event and answered success
      if (this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.TICKET_SERVICE_LINE_ADDED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'ticket', aggregateId: id,
        actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${id}`,
        payload: { ticketId: id, serviceId: lineIn.serviceId, technicianId: lineIn.technicianId || null, priceCents: lineIn.priceCents ?? null, estDurationMin: lineIn.estDurationMin ?? null },
      }));
    }); } catch (e: any) { if (isUniqueViolation(e)) return 'duplicate'; throw e; }   // the same logical add-on (deterministic line id) — one line
    return true;
  }
  /** Retail catalog lookup. Sellable means: this tenant's product, active, flagged is_retail, and actually priced.
   *  An unpriced retail product is NOT sellable — we refuse rather than invent a price or sell it for $0. */
  async retailProduct(ctx: ServingContext, productId: string) {
    const r: any = await this.db.selectFrom('inventory_products as p')
      .leftJoin('inventory_location_stock as s', (join: any) => join.onRef('s.product_id', '=', 'p.id').onRef('s.tenant_id', '=', 'p.tenant_id').on('s.branch_id', '=', sql`${ctx.branchId}`))
      .select(['p.id', 'p.name', 'p.retail_price_cents', 'p.allow_negative_stock', 's.quantity_on_hand'])
      .where('p.tenant_id', '=', ctx.tenantId).where('p.id', '=', productId)
      .where('p.active', '=', true).where('p.is_retail', '=', true)
      .executeTakeFirst().catch(() => undefined);
    if (!r || r.retail_price_cents == null || Number(r.retail_price_cents) <= 0) return null;
    return { productId: String(r.id), name: String(r.name), retailPriceCents: Number(r.retail_price_cents), allowNegativeStock: Boolean(r.allow_negative_stock), onHand: Number(r.quantity_on_hand || 0) };
  }

  /** The sellable retail catalog. Same rule as retailProduct (tenant + active + is_retail + priced) so the picker
   *  can never show something the sale would then refuse. Returns ONLY id/name/price — cost never leaves here. */
  async retailCatalog(ctx: ServingContext, search?: string) {
    const q = (search || '').trim().toLowerCase();
    let query = this.db.selectFrom('inventory_products')
      .select(['id', 'name', 'retail_price_cents'])
      .where('tenant_id', '=', ctx.tenantId)
      .where('active', '=', true).where('is_retail', '=', true)
      .where('archived_at', 'is', null)
      .where('retail_price_cents', '>', 0);
    if (q) query = query.where(sql`lower(name)` as any, 'like', `%${escapeLike(q)}%`);
    const rows: any[] = await query.orderBy('name').limit(100).execute().catch(() => []);
    return rows.map((r) => ({ productId: String(r.id), name: String(r.name), retailPriceCents: Number(r.retail_price_cents) }));
  }

  /** Write one retail line. Deliberately NOT routed through addService: that path resolves commission by
   *  service/category and bumps the ticket's duration estimate, neither of which is right for a product.
   *  service_id stays NULL (mig 423 allows it), product_id is set, line_kind='retail' — which is what the
   *  compensation engine and Checkout's retail/upsell reporting already key on. */
  async addRetailLine(ctx: ServingContext, ticketId: string, line: RetailLineIn): Promise<boolean> {
    if (!(await this.load(ctx, ticketId))) return false;
    const total = line.unitPriceCents * line.quantity;
    await this.db.insertInto('ticket_service_lines').values({
      tenant_id: ctx.tenantId, branch_id: ctx.branchId, ticket_id: ticketId,
      service_id: null, product_id: line.productId,
      technician_id: line.technicianId || null,
      service_name_snapshot: line.productName,
      price_cents_snapshot: line.unitPriceCents,
      duration_minutes_snapshot: 0,          // a product adds no time to the appointment
      line_total_cents: total,
      status: 'done',                        // a sold product is done the moment it is added
      line_kind: 'retail',
      is_add_on: false,
      quantity: line.quantity,
      added_by_user_id: ctx.userId || null, added_by_role: ctx.role || null,
    } as any).executeTakeFirst();   // Serving mandate: no swallow — a failed insert answered "sold" with no line on the bill
    return true;
  }

  async editService(ctx: ServingContext, id: string, lineId: string, patch: Partial<SVLine>): Promise<boolean> {
    const set: any = { updated_at: sql`now()` };
    if (patch.priceCents != null) { set.price_cents_snapshot = patch.priceCents; set.line_total_cents = patch.priceCents; }
    if (patch.technicianId != null) set.technician_id = patch.technicianId;
    if (patch.status != null) set.status = patch.status;
    const withNotes = patch as Partial<SVLine> & { notes?: string };
    if (withNotes.notes !== undefined) set.notes = withNotes.notes;
    if (patch.serviceId != null) set.service_id = patch.serviceId;
    if (patch.serviceName != null) set.service_name_snapshot = patch.serviceName;
    if (patch.category !== undefined) set.category_snapshot = patch.category ?? null;
    if (patch.isAddOn !== undefined) set.is_add_on = !!patch.isAddOn;
    if (patch.estDurationMin != null) set.duration_minutes_snapshot = patch.estDurationMin;
    const res = await this.db.transaction().execute(async (trx) => {
      const r = await this.scoped(trx.updateTable('ticket_service_lines'), ctx).set(set).where('id', '=', lineId).where('ticket_id', '=', id).executeTakeFirst();
      if (Number(r?.numUpdatedRows ?? 0) > 0 && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.TICKET_SERVICE_LINE_UPDATED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'ticket', aggregateId: id,
        actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${id}`,
        payload: { ticketId: id, serviceLineId: lineId, changedFields: Object.keys(set).filter((k) => k !== 'updated_at') },   // names, not values (§95)
      }));
      return r;
    }).catch(() => undefined);
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }
  async removeService(ctx: ServingContext, id: string, lineId: string): Promise<boolean> {
    const res = await this.db.transaction().execute(async (trx) => {
      const r = await this.scoped(trx.deleteFrom('ticket_service_lines'), ctx).where('id', '=', lineId).where('ticket_id', '=', id).executeTakeFirst();
      if (Number(r?.numDeletedRows ?? 0) > 0 && this.outbox) await this.outbox.write(trx, createDomainEvent({
        eventType: DOMAIN_EVENTS.TICKET_SERVICE_LINE_REMOVED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'ticket', aggregateId: id,
        actorId: ctx.userId, actorType: 'user', correlationId: `ticket:${id}`, payload: { ticketId: id, serviceLineId: lineId },
      }));
      return r;
    }).catch(() => undefined);
    return Number(res?.numDeletedRows ?? 0) > 0;
  }
  // ---- technician (primary + helper both durable on tickets; live sessions follow the assignment) ----
  async assignTechnician(ctx: ServingContext, id: string, technicianId: string): Promise<boolean> {
    const tech = (await this._techs(ctx)).find((x) => x.technicianId === technicianId); if (!tech) return false;
    const res = await this.scoped(this.db.updateTable('tickets'), ctx).set({ primary_technician_id: technicianId, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    if (Number(res?.numUpdatedRows ?? 0) === 0) return false;
    const live = await this.liveSession(ctx, id);
    if (live && live.technician_id !== technicianId) {
      // §105–§106: a mid-service reassignment CLOSES the previous technician's session (her minutes stay hers — service
      // history, commission and performance read them) and opens one for the new technician; it rewrote technician_id on
      // the live row, moving the work already performed to someone who did not do it
      try {
        await this.db.transaction().execute(async (trx) => {
          await trx.updateTable('ticket_service_sessions').set({ status: 'COMPLETED', completed_at: sql`now()`, completion_source: 'reassigned', version: sql`version + 1`, updated_at: sql`now()` } as Row)
            .where('tenant_id', '=', ctx.tenantId).where('id', '=', live.id).where(canMoveToSql(TICKET_SERVICE_SESSION, 'COMPLETED') as never).execute();
          await trx.insertInto('ticket_service_sessions').values({ tenant_id: ctx.tenantId, branch_id: ctx.branchId || null, ticket_id: id, technician_id: technicianId, is_helper: false, status: live.status === 'PAUSED' ? 'PAUSED' : 'STARTED', ...(live.status === 'PAUSED' ? { paused_at: sql`now()` } : {}) } as any).execute();
        });
      } catch (e: any) { if (isUniqueViolation(e)) throw new ServingSessionConflict(); throw e; }
    }
    return true;
  }
  async assignHelper(ctx: ServingContext, id: string, technicianId: string | null): Promise<boolean> {
    const t = await this.load(ctx, id); if (!t) return false;
    if (technicianId !== null) { const tech = (await this._techs(ctx)).find((x) => x.technicianId === technicianId); if (!tech) return false; }
    await this.scoped(this.db.updateTable('tickets'), ctx).set({ helper_technician_id: technicianId, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    // a helper leaving mid-service closes her helper session; one arriving on an in-service ticket opens one
    await this.db.updateTable('ticket_service_sessions').set({ status: 'COMPLETED', completed_at: sql`now()`, completion_source: 'helper_unassigned', version: sql`version + 1`, updated_at: sql`now()` })
      .where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', id).where('is_helper', '=', true).where('status', 'in', LIVE).where(canMoveToSql(TICKET_SERVICE_SESSION, 'COMPLETED') as any).where((eb: any) => technicianId ? eb('technician_id', '!=', technicianId) : sql<boolean>`true`).execute().catch(() => undefined);
    if (technicianId && ['in_service', 'paused', 'delayed'].includes(t.status)) await this.openOrResumeSession(ctx, id, technicianId, true).catch(() => undefined);
    return true;
  }
  /** Status writes OTHER than Service Done (the in-service vocabulary); a done status goes through completeServiceDone. */
  async setStatus(ctx: ServingContext, id: string, st: ServingTicketStatus): Promise<boolean> {
    if (!(await this.load(ctx, id))) return false;
    const dbStatus = st === 'completed' || st === 'sent_to_service_done' ? 'service_done' : st === 'in_service' || st === 'paused' || st === 'delayed' ? 'serving' : null;
    if (dbStatus) {
      const done = st === 'completed' || st === 'sent_to_service_done';
      await this.db.transaction().execute(async (trx) => {
        await this.scoped(trx.updateTable('tickets'), ctx).set({ status: dbStatus, ...(done ? { service_done_at: sql`now()` } : {}), updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst();
        // Developer (Sep 2026): the queue item and the linked appointment follow the status — same transaction.
        const qStatus = dbStatus === 'serving' ? 'in_service' : 'completed';   // queue-item vocabulary (migration 480)
        await this.scoped(trx.updateTable('pos_queue_items'), ctx).set({ status: qStatus, updated_at: sql`now()` }).where((eb: any) => eb.or([eb('id', '=', id), eb('ticket_id', '=', id)])).where(canMoveToSql(QUEUE_ITEM, qStatus)).executeTakeFirst().catch(() => undefined);
        const apptStatus = dbStatus === 'serving' ? 'in_service' : 'completed';
        await this.scoped(trx.updateTable('pos_tech_appointments'), ctx).set({ status: apptStatus, updated_at: sql`now()` }).where('id', '=', id).where(canMoveToSql(APPOINTMENT, apptStatus)).executeTakeFirst().catch(() => undefined);
        if (done && this.outbox) await this.outbox.write(trx, createDomainEvent({
          eventType: DOMAIN_EVENTS.SERVICE_COMPLETED, tenantId: ctx.tenantId, branchId: ctx.branchId, aggregateType: 'ticket', aggregateId: id,
          actorId: ctx.userId, actorType: 'user', payload: { ticketId: id, status: st } }));
      }).catch(() => undefined);
    }
    return true;
  }
  async setDelay(ctx: ServingContext, id: string, ds: DelayStatus, reason?: string): Promise<boolean> {
    const res: any = await this.scoped(this.db.updateTable('tickets'), ctx).set({ serving_delay_status: ds, serving_delay_reason: ds === 'none' ? null : (reason ?? null), updated_at: sql`now()` }).where('id', '=', id).where(canMoveToSql(SERVING_DELAY, ds)).executeTakeFirst().catch(() => undefined);
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }
  async getSendKey(ctx: ServingContext, id: string) {
    const t: any = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id).select(['service_done_locked_at']).executeTakeFirst().catch(() => undefined);
    if (!t?.service_done_locked_at) return undefined;
    const s = await this.latestPrimarySession(ctx, id);
    return s?.idempotency_key ? String(s.idempotency_key) : undefined;
  }
  async setSendKey(ctx: ServingContext, id: string, key: string) {
    const s = await this.latestPrimarySession(ctx, id);
    if (s) await this.db.updateTable('ticket_service_sessions').set({ idempotency_key: key, version: sql`version + 1`, updated_at: sql`now()` }).where('tenant_id', '=', ctx.tenantId).where('id', '=', s.id).execute().catch(() => undefined);
  }
  /** THE Service Done implementation (service-done/service-done-transition.ts) — shared with the tech app. */
  async completeServiceDone(ctx: ServingContext, id: string, opts: { lock: boolean; source: ServiceDoneSource; technicianId?: string | null; notes?: string | null }) {
    try {
      return await completeServiceDone(this.db, { outbox: this.outbox, workforce: this.deps.workforce ?? null }, { tenantId: ctx.tenantId, branchId: ctx.branchId || null, ticketId: id, actor: { userId: ctx.userId, role: ctx.role }, source: opts.source, technicianId: opts.technicianId ?? null, lock: opts.lock, notes: opts.notes ?? null });
    } catch (e: any) {
      if (e instanceof ServiceDoneTransitionError) return { error: e.code as 'TICKET_NOT_FOUND' | 'INVALID_STATUS' | 'NOT_ASSIGNED', message: e.message };
      throw e;
    }
  }
  async getTicketVersion(ctx: ServingContext, id: string): Promise<number> {
    const r: any = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id).select(['version']).executeTakeFirst().catch(() => undefined);
    return Number(r?.version ?? 0);
  }
  async appendRevision(ctx: ServingContext, id: string, rev: RevisionInput): Promise<number> {
    return this.db.transaction().execute(async (trx) => {
      const upd: any = await trx.updateTable('tickets').set({ version: sql`version + 1`, updated_at: sql`now()` })
        .where('id', '=', id).where('tenant_id', '=', ctx.tenantId).returning(['version']).executeTakeFirst();
      const version = Number(upd?.version ?? 0);
      await trx.insertInto('ticket_revisions').values({
        ticket_id: id, tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, version,
        action: rev.action, service_line_id: rev.serviceLineId ?? null, actor_user_id: rev.actorUserId ?? null, actor_role: rev.actorRole ?? null,
        before: rev.before != null ? JSON.stringify(rev.before) : null, after: rev.after != null ? JSON.stringify(rev.after) : null, summary: rev.summary ?? null,
      }).execute();
      return version;
    });
  }
  async listRevisions(ctx: ServingContext, id: string): Promise<RevisionRecord[]> {
    const rows: any[] = await this.db.selectFrom('ticket_revisions').where('ticket_id', '=', id).where('tenant_id', '=', ctx.tenantId)
      .orderBy('version', 'asc').selectAll().execute().catch(() => []);
    return rows.map((r) => ({ action: r.action, serviceLineId: r.service_line_id, actorUserId: r.actor_user_id, actorRole: r.actor_role, before: r.before, after: r.after, summary: r.summary, version: Number(r.version), createdAt: new Date(r.created_at).toISOString() }));
  }
  async lockServiceDone(ctx: ServingContext, id: string, byUserId: string, lockedTotalCents: number): Promise<void> {
    await this.scoped(this.db.updateTable('tickets'), ctx).set({ service_done_locked_at: sql`now()`, service_done_locked_by_user_id: byUserId, service_done_locked_total_cents: lockedTotalCents, updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst().catch(() => undefined);
  }
  async reopenServiceDone(ctx: ServingContext, id: string): Promise<void> {
    await this.scoped(this.db.updateTable('tickets'), ctx).set({ service_done_locked_at: null, service_done_locked_by_user_id: null, service_done_locked_total_cents: null, status: 'serving', updated_at: sql`now()` }).where('id', '=', id).executeTakeFirst().catch(() => undefined);
    // re-open the primary session so the technician reads as SERVING again; if she has since started another guest the
    // partial unique index refuses and the ticket simply re-enters serving without a live session (assign resolves it).
    const last = await this.latestPrimarySession(ctx, id);
    if (last && last.status === 'COMPLETED') {
      await this.db.updateTable('ticket_service_sessions').set({ status: 'STARTED', completed_at: null, completion_source: null, version: sql`version + 1`, updated_at: sql`now()` } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', last.id).where(canMoveToSql(TICKET_SERVICE_SESSION, 'STARTED') as any).execute().catch(() => undefined);
    }
  }
  async serviceDoneLock(ctx: ServingContext, id: string): Promise<{ lockedAt: string; lockedByUserId: string | null; lockedTotalCents: number | null } | null> {
    const r: any = await this.scoped(this.db.selectFrom('tickets'), ctx).where('id', '=', id).select(['service_done_locked_at', 'service_done_locked_by_user_id', 'service_done_locked_total_cents']).executeTakeFirst().catch(() => undefined);
    return r?.service_done_locked_at ? { lockedAt: new Date(r.service_done_locked_at).toISOString(), lockedByUserId: r.service_done_locked_by_user_id ?? null, lockedTotalCents: r.service_done_locked_total_cents != null ? Number(r.service_done_locked_total_cents) : null } : null;
  }
}
