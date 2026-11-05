/* owner.kysely.repository.ts — real aggregation over canonical tables (same records as the POS).
 * Money: integer cents. Scope: ALWAYS tenant_id from the session; branch optional (validated against the tenant).
 * Revenue/tips/avg-ticket = PAID tickets by paid_at; bookings = appointments by start_time; new clients = customers by
 * created_at; active technicians = latest technician_statuses status that is on-shift. No mock data. */
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate } from '@aipowersalon/date-time';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { projectionDeliversRealtime } from '@aipowersalon/config';
import { Kysely, sql } from 'kysely';
import { assertTransition, type DB } from '@aipowersalon/database';
import { OWNER_ALERT } from '../analytics-lifecycles';
import type { OwnerContext, OwnerDataPort, OwnerProfile } from './owner.repository';
import type { OwnerBranchListItem, OwnerAppointmentListItem, OwnerAppointmentDetail, OwnerAlert, OwnerAlertSeverity, OwnerAlertStatus, OwnerAuditEntry, OwnerExpense, OwnerExpenseInput } from './owner.dto';
import type { DateRange } from './owner.dto';
import type { OwnerTicketList, OwnerTicketDetail, OwnerTicketLine, OwnerTicketRevision, OwnerTicketFilters, OwnerTicketRow } from './owner.dto';
import type { OwnerLiveOperations, OwnerLiveTechRow, OwnerLiveQueueRow, OwnerLiveTeamRow } from './owner.dto';
import type { OwnerPayrollList, OwnerPayrollPeriodSummary, OwnerPayrollLine, OwnerPayrollPeriodDetail } from './owner.dto';
import type { OwnerCustomersOverview, OwnerTopSpender, OwnerLoyaltyTier, OwnerGiftCardReport } from './owner.dto';
import type { OwnerInventoryOverview, OwnerInventoryReorderItem, OwnerInventoryCategory } from './owner.dto';
import { stockStatus, reorderSuggestion } from '@aipowersalon/inventory';
import type { OwnerMarketingOverview, OwnerMarketingChannel, OwnerMarketingCampaign } from './owner.dto';
import { buildMediaUrl } from '@aipowersalon/media';
import { deriveKpis as deriveCampaignKpis, deriveMetrics as deriveCampaignMetrics, type CampaignRow } from '@aipowersalon/communications';
import type { OwnerPaymentsOverview, OwnerPaymentTxn, OwnerPaymentRefund } from './owner.dto';
import { hasTenantWideScope } from '@aipowersalon/permissions';

const n = (v: any): number => Number(v ?? 0);
function firstServiceLabel(v: any): string | null {
  let arr = v;
  if (typeof v === 'string') { try { arr = JSON.parse(v); } catch { return null; } }
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  if (typeof first === 'string') return first;
  return first?.name ?? first?.serviceName ?? first?.service_name ?? first?.label ?? null;
}

/** A Postgres DATE as 'YYYY-MM-DD'. node-postgres parses DATE into a JS Date at LOCAL midnight, so String(date) is
 *  "Thu Oct 15 2026 …" — read the local parts (same rule as workforce payroll.dto ymdOf). */
const ymdOfDate = (v: unknown): string => v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v ?? '').slice(0, 10);

export class KyselyOwnerRepository implements OwnerDataPort {
  constructor(private readonly db: Kysely<DB>, private readonly outbox?: OutboxWriter) {}
  /** Will an alert status change reach the owner's screens through the realtime projection? (outbox AND publisher on) */
  emitsDomainEvents(): boolean { return projectionDeliversRealtime(this.outbox != null); }

  async ownerProfile(ctx: OwnerContext): Promise<OwnerProfile | null> {
    const u = await this.db.selectFrom('users')
      .leftJoin('user_avatars', (join) => join
        .on((eb) => eb('user_avatars.user_id', '=', sql<string>`users.id::text`))
        .on((eb) => eb('user_avatars.tenant_id', '=', sql<string>`users.tenant_id::text`))
      )
      .select(['users.id', 'users.first_name', 'users.last_name', 'users.full_name', 'users.email', 'users.normalized_phone', 'users.avatar_url as user_avatar_url', 'user_avatars.data_url as legacy_avatar_url'])
      .where('users.id', '=', ctx.userId).where('users.tenant_id', '=', ctx.tenantId).executeTakeFirst();
    if (!u) return null;
    const full = u.full_name || [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Owner';
    const avKey = u.user_avatar_url || u.legacy_avatar_url;
    return { userId: u.id, fullName: full, firstName: u.first_name || full.split(' ')[0] || 'Owner', email: u.email ?? null, phone: u.normalized_phone ?? null, avatarUrl: avKey ? buildMediaUrl(avKey) : null };
  }

  async setAvatar(ctx: OwnerContext, key: string): Promise<void> {
    await this.db.updateTable('users')
      .set({ avatar_url: key, updated_at: new Date() })
      .where('id', '=', ctx.userId)
      .execute()
      .catch(() => {});
    await this.db.insertInto('user_avatars')
      .values({ tenant_id: ctx.tenantId, user_id: ctx.userId, data_url: key, updated_at: new Date() })
      .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doUpdateSet({ data_url: key, updated_at: new Date() }))
      .execute()
      .catch(() => {});
  }

  // Real tenant timezone + currency from the 'business-branch' settings (JSONB). Prefer a branch-level override when a
  // branch is selected, else the tenant-level row, else safe defaults. Persisted by the Settings Center.
  async tenantTimezoneCurrency(ctx: OwnerContext): Promise<{ timezone: string; currency: string }> {
    const rows = await this.db.selectFrom('tenant_settings').select(['branch_id', 'settings_json'])
      .where('tenant_id', '=', ctx.tenantId).where('category', '=', 'business-branch')
      .where((eb) => eb.or([eb('branch_id', 'is', null), ...(ctx.selectedBranchId ? [eb('branch_id', '=', ctx.selectedBranchId)] : [])]))
      .execute();
    const pick = (ctx.selectedBranchId ? rows.find((r) => r.branch_id === ctx.selectedBranchId) : undefined) ?? rows.find((r) => r.branch_id === null);
    const j = (pick?.settings_json ?? {}) as { timezone?: string; currency?: string };
    return { timezone: j.timezone || 'America/New_York', currency: j.currency || 'USD' };
  }

  async validateBranch(ctx: OwnerContext, branchId: string): Promise<boolean> {
    const b = await this.db.selectFrom('branches').select('id').where('id', '=', branchId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return !!b;
  }

  async branchSwitchPinHash(ctx: OwnerContext, branchId: string): Promise<string | null> {
    const b = await this.db.selectFrom('branches').select('switch_pin_hash').where('id', '=', branchId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return (b?.switch_pin_hash as string | null) ?? null;
  }

  async allowedBranchIds(ctx: OwnerContext): Promise<string[] | null> {
    const rows = await this.db.selectFrom('user_branch_access').select('branch_id')
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).execute();
    return rows.length ? rows.map((r) => r.branch_id as string) : null;
  }
  async ownerAccessRows(ctx: OwnerContext): Promise<{ branchId: string; accessLevel: string; isPrimaryOwner: boolean }[]> {
    const rows = await this.db.selectFrom('user_branch_access').select(['branch_id', 'access_level', 'is_primary_owner'])
      .where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).execute();
    return rows.map((r) => ({ branchId: r.branch_id as string, accessLevel: String(r.access_level), isPrimaryOwner: !!r.is_primary_owner }));
  }

  async activeTechsByBranch(ctx: OwnerContext): Promise<{ branchId: string; active: number }[]> {
    const rows = await sql<{ branch_id: string; c: number }>`
      SELECT branch_id, count(*)::int AS c FROM (
        SELECT DISTINCT ON (technician_id) technician_id, branch_id, status
        FROM technician_statuses
        WHERE tenant_id = ${ctx.tenantId} ${this.bSql(ctx, null)}
        ORDER BY technician_id, changed_at DESC
      ) latest
      WHERE latest.status NOT IN ('off','offline','off_shift','clocked_out','inactive')
      GROUP BY branch_id
    `.execute(this.db);
    return rows.rows.map((r) => ({ branchId: r.branch_id as string, active: n(r.c) }));
  }

  async waitingGuestsByBranch(ctx: OwnerContext): Promise<{ branchId: string; waiting: number }[]> {
    let q = this.db.selectFrom('pos_queue_items')
      .select((eb) => ['branch_id', eb.fn.countAll().as('c')])
      .where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['waiting', 'called']);
    q = this.bScope(q, ctx, null);
    const rows = await q.groupBy('branch_id').execute();
    return rows.filter((x: any) => x.branch_id).map((x: any) => ({ branchId: x.branch_id as string, waiting: n(x.c) }));
  }

  // Branch scope for a Kysely query: explicit branch → '='; else restrict to the owner's assigned subset (primed on
  // ctx by the service) via 'in'; else no branch filter (whole tenant — legacy owner / super-admin).
  private bScope<Q extends { where(c: any, o: any, v: any): Q }>(q: Q, ctx: OwnerContext, branchId: string | null, col: any = 'branch_id'): Q {
    if (branchId) return q.where(col, '=', branchId);
    const allowed = (ctx as unknown as { __allowedBranchIds?: string[] | null }).__allowedBranchIds;
    if (allowed && allowed.length) return q.where(col, 'in', allowed);
    return q;
  }
  // Raw-SQL branch clause with an optional column prefix (e.g. 't.', 'r.', 'ta.').
  private bSql(ctx: OwnerContext, branchId: string | null, prefix = ''): ReturnType<typeof sql> {
    if (branchId) return sql`AND ${sql.raw(prefix)}branch_id = ${branchId}`;
    const allowed = (ctx as unknown as { __allowedBranchIds?: string[] | null }).__allowedBranchIds;
    if (allowed && allowed.length) return sql`AND ${sql.raw(prefix)}branch_id IN (${sql.join(allowed.map((b) => sql`${b}`), sql`, `)})`;
    return sql``;
  }

  // The user's assigned branch (users.branch_id). Used to scope branch-restricted roles (e.g. MANAGER) to one branch.
  async userHomeBranch(ctx: OwnerContext): Promise<string | null> {
    const u = await this.db.selectFrom('users').select('branch_id').where('id', '=', ctx.userId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return u?.branch_id ?? null;
  }

  async paidRevenueCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number> {
    let q = this.db.selectFrom('tickets').select((eb) => eb.fn.sum('total_cents').as('s'))
      .where('tenant_id', '=', ctx.tenantId).where('status', '=', 'paid').where('paid_at', '>=', r.fromIso as any).where('paid_at', '<', r.toIso as any);
    q = this.bScope(q, ctx, branchId);
    return n((await q.executeTakeFirst())?.s);
  }

  async paidSalesCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number> {
    let q: any = this.db.selectFrom('ticket_service_lines as l').innerJoin('tickets as t', 't.id', 'l.ticket_id')
      .select((eb: any) => eb.fn.sum('l.line_total_cents').as('s'))
      .where('t.tenant_id', '=', ctx.tenantId).where('l.tenant_id', '=', ctx.tenantId).where('t.status', '=', 'paid').where('l.removed_at', 'is', null)
      .where('t.paid_at', '>=', r.fromIso as any).where('t.paid_at', '<', r.toIso as any);
    q = this.bScope(q, ctx, branchId, 't.branch_id');
    return n((await q.executeTakeFirst())?.s);
  }

  // Top revenue services in the period: service lines on PAID tickets (same paid-in-window filter as revenue), summed
  // by service name, highest first. Fails safe to [] so the finance summary never breaks if the join is unavailable.
  async topServices(ctx: OwnerContext, branchId: string | null, r: DateRange, limit: number): Promise<{ name: string; revenueCents: number }[]> {
    let q: any = this.db.selectFrom('ticket_service_lines as l')
      .innerJoin('tickets as t', 't.id', 'l.ticket_id')
      .where('l.tenant_id', '=', ctx.tenantId).where('t.status', '=', 'paid')
      .where('t.paid_at', '>=', r.fromIso as any).where('t.paid_at', '<', r.toIso as any)
      .select((eb: any) => ['l.service_name_snapshot as name', eb.fn.sum('l.line_total_cents').as('rev')]);
    q = this.bScope(q, ctx, branchId, 't.branch_id');
    const rows: any[] = await q.groupBy('l.service_name_snapshot').orderBy((eb: any) => eb.fn.sum('l.line_total_cents'), 'desc').limit(limit).execute().catch(() => []);
    return rows.map((x) => ({ name: x.name ?? 'Service', revenueCents: n(x.rev) }));
  }

  async paidTicketCount(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number> {
    let q = this.db.selectFrom('tickets').select((eb) => eb.fn.countAll().as('c'))
      .where('tenant_id', '=', ctx.tenantId).where('status', '=', 'paid').where('paid_at', '>=', r.fromIso as any).where('paid_at', '<', r.toIso as any);
    q = this.bScope(q, ctx, branchId);
    return n((await q.executeTakeFirst())?.c);
  }

  async tipsCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number> {
    let q = this.db.selectFrom('tickets').select((eb) => eb.fn.sum('tip_cents').as('s'))
      .where('tenant_id', '=', ctx.tenantId).where('status', '=', 'paid').where('paid_at', '>=', r.fromIso as any).where('paid_at', '<', r.toIso as any);
    q = this.bScope(q, ctx, branchId);
    return n((await q.executeTakeFirst())?.s);
  }

  // Bookings = canonical pos_tech_appointments by appt_date (a DATE). Window is inclusive of the last day in range
  // (the week's toIso is "now", whose date must still count), so we derive lastDate from toIso - 1ms.
  async bookingsCount(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number> {
    const { fromDate, lastDate } = this.apptWindow(r);
    let q = this.db.selectFrom('pos_tech_appointments').select((eb) => eb.fn.countAll().as('c'))
      .where('tenant_id', '=', ctx.tenantId).where('appt_date', '>=', fromDate).where('appt_date', '<=', lastDate);
    q = this.bScope(q, ctx, branchId);
    return n((await q.executeTakeFirst())?.c);
  }

  async newCustomersCount(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number> {
    let q = this.db.selectFrom('customers').select((eb) => eb.fn.countAll().as('c'))
      .where('tenant_id', '=', ctx.tenantId).where('created_at', '>=', r.fromIso as any).where('created_at', '<', r.toIso as any);
    q = this.bScope(q, ctx, branchId);
    return n((await q.executeTakeFirst())?.c);
  }

  async activeTechnicianCount(ctx: OwnerContext, branchId: string | null): Promise<{ active: number; scheduled: number }> {
    const branchClause = this.bSql(ctx, branchId);
    const activeRow = await sql<{ c: number }>`
      SELECT count(*)::int AS c FROM (
        SELECT DISTINCT ON (technician_id) technician_id, status
        FROM technician_statuses
        WHERE tenant_id = ${ctx.tenantId} ${branchClause}
        ORDER BY technician_id, changed_at DESC
      ) latest
      WHERE latest.status NOT IN ('off','offline','off_shift','clocked_out','inactive')
    `.execute(this.db);
    const active = n(activeRow.rows?.[0]?.c);
    let sq = this.db.selectFrom('technicians').select((eb) => eb.fn.countAll().as('c')).where('tenant_id', '=', ctx.tenantId).where('is_active', '=', true);
    sq = this.bScope(sq, ctx, branchId);
    return { active, scheduled: n((await sq.executeTakeFirst())?.c) };
  }

  async listBranches(ctx: OwnerContext): Promise<OwnerBranchListItem[]> {
    let q = this.db.selectFrom('branches').select(['id', 'name', 'status', 'city', 'address', 'state', 'switch_pin_hash']).where('tenant_id', '=', ctx.tenantId);
    q = this.bScope(q, ctx, null, 'id');
    const rows = await q.orderBy('name').execute();
    return rows.map((b) => ({ branchId: b.id, branchName: b.name, status: b.status, city: b.city ?? null, address: b.address ?? null, state: b.state ?? null, hasSwitchPin: !!b.switch_pin_hash }));
  }

  // Grouped paid-ticket revenue + count per branch (one query). branch_id is NOT NULL on tickets.
  async revenueByBranch(ctx: OwnerContext, r: DateRange): Promise<{ branchId: string; revenueCents: number; ticketCount: number }[]> {
    let q = this.db.selectFrom('tickets')
      .select((eb) => ['branch_id', eb.fn.sum('total_cents').as('rev'), eb.fn.countAll().as('c'),
        // wave 4 pilot: each branch's SALES (lines, not removed) — the average ticket's basis, as on the POS reports
        sql<number>`coalesce(sum((select sum(l.line_total_cents) from ticket_service_lines l where l.ticket_id = tickets.id and l.tenant_id = tickets.tenant_id and l.removed_at is null)), 0)`.as('sales')])
      .where('tenant_id', '=', ctx.tenantId).where('status', '=', 'paid').where('paid_at', '>=', r.fromIso as any).where('paid_at', '<', r.toIso as any);
    q = this.bScope(q, ctx, null);
    const rows = await q.groupBy('branch_id').execute();
    return rows.map((x: any) => ({ branchId: x.branch_id as string, revenueCents: n(x.rev), ticketCount: n(x.c), salesCents: n(x.sales) }));
  }

  // Grouped bookings per branch over the inclusive appt_date window (NULL-branch appts excluded).
  async bookingsByBranch(ctx: OwnerContext, r: DateRange): Promise<{ branchId: string; bookingCount: number }[]> {
    const { fromDate, lastDate } = this.apptWindow(r);
    let q = this.db.selectFrom('pos_tech_appointments')
      .select((eb) => ['branch_id', eb.fn.countAll().as('c')])
      .where('tenant_id', '=', ctx.tenantId).where('appt_date', '>=', fromDate).where('appt_date', '<=', lastDate).where('branch_id', 'is not', null);
    q = this.bScope(q, ctx, null);
    const rows = await q.groupBy('branch_id').execute();
    return rows.map((x: any) => ({ branchId: x.branch_id as string, bookingCount: n(x.c) }));
  }

  // ---- Module 3: Booking Overview (pos_tech_appointments by appt_date; statuses completed/cancelled/no_show) ----
  // prefer the tenant-local date bounds the range carries (appt_date is salon-local); fall back to UTC slice for safety.
  private apptWindow(r: DateRange) { return { fromDate: r.fromDate ?? r.fromIso.slice(0, 10), lastDate: r.toDate ?? new Date(Date.parse(r.toIso) - 1).toISOString().slice(0, 10) }; }
  private dstr(v: any): string { return typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10); }

  async bookingStatusCounts(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ total: number; completed: number; cancelled: number; noShow: number }> {
    const { fromDate, lastDate } = this.apptWindow(r);
    let q = this.db.selectFrom('pos_tech_appointments').select((eb) => ['status', eb.fn.countAll().as('c')])
      .where('tenant_id', '=', ctx.tenantId).where('appt_date', '>=', fromDate).where('appt_date', '<=', lastDate);
    q = this.bScope(q, ctx, branchId);
    const rows = await q.groupBy('status').execute();
    let total = 0, completed = 0, cancelled = 0, noShow = 0;
    for (const x of rows as any[]) { const c = n(x.c); total += c; if (x.status === 'completed') completed = c; else if (x.status === 'cancelled') cancelled = c; else if (x.status === 'no_show') noShow = c; }
    return { total, completed, cancelled, noShow };
  }

  async bookingSourceCounts(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ source: string; count: number }[]> {
    const { fromDate, lastDate } = this.apptWindow(r);
    let q = this.db.selectFrom('pos_tech_appointments').select((eb) => ['source', eb.fn.countAll().as('c')])
      .where('tenant_id', '=', ctx.tenantId).where('appt_date', '>=', fromDate).where('appt_date', '<=', lastDate);
    q = this.bScope(q, ctx, branchId);
    const rows = await q.groupBy('source').execute().catch(() => [] as any[]);
    return (rows as any[]).map((x) => ({ source: x.source ?? 'unknown', count: n(x.c) }));
  }

  async bookingsByDate(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ date: string; count: number }[]> {
    const { fromDate, lastDate } = this.apptWindow(r);
    let q = this.db.selectFrom('pos_tech_appointments').select((eb) => ['appt_date', eb.fn.countAll().as('c')])
      .where('tenant_id', '=', ctx.tenantId).where('appt_date', '>=', fromDate).where('appt_date', '<=', lastDate);
    q = this.bScope(q, ctx, branchId);
    const rows = await q.groupBy('appt_date').execute();
    return rows.map((x: any) => ({ date: this.dstr(x.appt_date), count: n(x.c) }));
  }

  async listAppointments(ctx: OwnerContext, branchId: string | null, r: DateRange, opts: { status?: string; source?: string; limit?: number }): Promise<OwnerAppointmentListItem[]> {
    const { fromDate, lastDate } = this.apptWindow(r);
    let q = this.db.selectFrom('pos_tech_appointments').select(['id', 'customer_name', 'branch_id', 'technician_id', 'appt_date', 'start_time', 'end_time', 'status', 'source'])
      .where('tenant_id', '=', ctx.tenantId).where('appt_date', '>=', fromDate).where('appt_date', '<=', lastDate);
    q = this.bScope(q, ctx, branchId);
    if (opts.status) q = q.where('status', '=', opts.status);
    if (opts.source) q = q.where('source', '=', opts.source);
    const rows = await q.orderBy('appt_date', 'desc').orderBy('start_time', 'desc').limit(Math.min(opts.limit ?? 50, 200)).execute();
    return rows.map((x) => ({ appointmentId: x.id, customerName: x.customer_name ?? '', branchId: x.branch_id, technicianId: x.technician_id, apptDate: this.dstr(x.appt_date), startTime: x.start_time, endTime: x.end_time, status: x.status, source: x.source }));
  }

  async getAppointmentDetail(ctx: OwnerContext, appointmentId: string): Promise<OwnerAppointmentDetail | null> {
    let aq = this.db.selectFrom('pos_tech_appointments').selectAll().where('id', '=', appointmentId).where('tenant_id', '=', ctx.tenantId);
    aq = this.bScope(aq, ctx, null); // restrict to the caller's allowed branches (no-op for full owners)
    const x = await aq.executeTakeFirst();
    if (!x) return null;
    return { appointmentId: x.id, customerName: x.customer_name ?? '', branchId: x.branch_id, technicianId: x.technician_id, apptDate: this.dstr(x.appt_date), startTime: x.start_time, endTime: x.end_time, status: x.status, source: x.source, customerPhone: x.customer_phone ?? null, durationMinutes: x.duration_minutes, depositStatus: x.deposit_status, isVip: x.is_vip, notes: x.notes ?? null, services: x.services };
  }

  // ---- Module 4: Staff / Technician Performance ----
  async listTechnicians(ctx: OwnerContext, branchId: string | null): Promise<{ technicianId: string; fullName: string; status: string; isActive: boolean }[]> {
    let q = this.db.selectFrom('technicians').select(['id', 'full_name', 'first_name', 'status', 'is_active']).where('tenant_id', '=', ctx.tenantId);
    q = this.bScope(q, ctx, branchId);
    const rows = await q.execute();
    return rows.map((t) => ({ technicianId: t.id, fullName: t.full_name || t.first_name || 'Technician', status: t.status, isActive: !!t.is_active }));
  }

  async validateTechnician(ctx: OwnerContext, technicianId: string): Promise<boolean> {
    let tq = this.db.selectFrom('technicians').select('id').where('id', '=', technicianId).where('tenant_id', '=', ctx.tenantId);
    tq = this.bScope(tq, ctx, null); // restrict to the caller's allowed branches (no-op for full owners)
    const t = await tq.executeTakeFirst();
    return !!t;
  }

  // Per-technician services + sales + busy minutes from service lines on PAID tickets; commission from the compensation
  // SNAPSHOT (the one payroll authority: rules, discount allocation) plus posted/approved ledger adjustments (reversals).
  // Oct 13 2026 (FLOW duplicate D5 merged): it used to re-price the lines in floating point (line_total × stamped rate /
  // 100.0), which disagreed with payroll after any authored rule, discount or refund.
  async staffSales(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ technicianId: string; servicesCompleted: number; salesCents: number; commissionCents: number; busyMinutes: number }[]> {
    const bc = this.bSql(ctx, branchId, 't.');
    const rows = await sql<{ tid: string; services: number; sales: number; busy: number }>`
      SELECT tsl.technician_id AS tid, COUNT(*)::int AS services,
             COALESCE(SUM(tsl.line_total_cents), 0)::bigint AS sales,
             COALESCE(SUM(tsl.duration_minutes_snapshot), 0)::int AS busy
      FROM ticket_service_lines tsl JOIN tickets t ON t.id = tsl.ticket_id
      WHERE t.tenant_id = ${ctx.tenantId} AND t.status = 'paid' AND t.paid_at >= ${r.fromIso} AND t.paid_at < ${r.toIso} AND tsl.technician_id IS NOT NULL ${bc}
      GROUP BY tsl.technician_id
    `.execute(this.db);
    const sc = this.bSql(ctx, branchId, 's.'), ac = this.bSql(ctx, branchId, 'a.');
    const comm = await sql<{ tid: string; commission: number }>`
      SELECT tid, SUM(cents)::bigint AS commission FROM (
        SELECT s.technician_id AS tid, COALESCE(SUM(s.tech_service_earnings_cents + s.retail_commission_cents), 0) AS cents
        FROM ticket_compensation_snapshots s
        WHERE s.tenant_id = ${ctx.tenantId} AND s.snapshot_at >= ${r.fromIso} AND s.snapshot_at < ${r.toIso} ${sc}
        GROUP BY s.technician_id
        UNION ALL
        SELECT a.technician_id AS tid, COALESCE(SUM(a.amount_cents), 0) AS cents
        FROM compensation_adjustments a
        WHERE a.tenant_id = ${ctx.tenantId} AND a.status IN ('posted', 'approved', 'applied') AND a.category <> 'tip_correction'
          AND a.created_at >= ${r.fromIso} AND a.created_at < ${r.toIso} ${ac}
        GROUP BY a.technician_id
      ) u GROUP BY tid
    `.execute(this.db);
    const commission = new Map(comm.rows.map((x) => [x.tid, n(x.commission)]));
    const out = rows.rows.map((x) => ({ technicianId: x.tid, servicesCompleted: n(x.services), salesCents: n(x.sales), commissionCents: commission.get(x.tid) ?? 0, busyMinutes: n(x.busy) }));
    // a technician with only ledger money in the window (a reversal after her last sale) still appears
    for (const [tid, cents] of commission) if (!out.some((o) => o.technicianId === tid)) out.push({ technicianId: tid, servicesCompleted: 0, salesCents: 0, commissionCents: cents, busyMinutes: 0 });
    return out;
  }

  // Rating per technician = average of reviews on tickets the technician worked (reviews have no technician_id; joined via
  // service lines). All-time (reputation metric, not period-bound).
  async ratingsByTechnician(ctx: OwnerContext, branchId: string | null): Promise<{ technicianId: string; rating: number; reviewCount: number }[]> {
    const bc = this.bSql(ctx, branchId, 'r.');
    const rows = await sql<{ tid: string; rating: number; reviews: number }>`
      SELECT tt.technician_id AS tid, AVG(r.rating)::float AS rating, COUNT(*)::int AS reviews
      FROM reviews r
      JOIN (SELECT DISTINCT ticket_id, technician_id FROM ticket_service_lines WHERE technician_id IS NOT NULL) tt ON tt.ticket_id = r.ticket_id
      WHERE r.tenant_id = ${ctx.tenantId} ${bc}
      GROUP BY tt.technician_id
    `.execute(this.db);
    return rows.rows.map((x) => ({ technicianId: x.tid, rating: Math.round(n(x.rating) * 10) / 10, reviewCount: n(x.reviews) }));
  }

  async tipsByTechnician(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ technicianId: string; tipsCents: number }[]> {
    const bc = this.bSql(ctx, branchId, 'ta.');
    const rows = await sql<{ tid: string; tips: number }>`
      SELECT ta.technician_id AS tid, COALESCE(SUM(ta.tip_cents), 0)::bigint AS tips
      FROM ticket_tip_allocations ta JOIN tickets t ON t.id = ta.ticket_id
      WHERE ta.tenant_id = ${ctx.tenantId} AND t.status = 'paid' AND t.paid_at >= ${r.fromIso} AND t.paid_at < ${r.toIso} ${bc}
      GROUP BY ta.technician_id
    `.execute(this.db);
    return rows.rows.map((x) => ({ technicianId: x.tid, tipsCents: n(x.tips) }));
  }

  // Scheduled minutes per technician from dated shifts in the window (utilization denominator).
  async scheduledMinutesByTechnician(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ technicianId: string; minutes: number }[]> {
    const bc = this.bSql(ctx, branchId);
    const rows = await sql<{ tid: string; minutes: number }>`
      SELECT technician_id AS tid, COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0)::int AS minutes
      FROM technician_shifts
      WHERE tenant_id = ${ctx.tenantId} AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time >= ${r.fromIso} AND start_time < ${r.toIso} ${bc}
      GROUP BY technician_id
    `.execute(this.db);
    return rows.rows.map((x) => ({ technicianId: x.tid, minutes: n(x.minutes) }));
  }

  async attendanceSnapshot(ctx: OwnerContext, branchId: string | null): Promise<{ clockedIn: number; onBreak: number; offShift: number; scheduledToday: number }> {
    const bc = this.bSql(ctx, branchId);
    const statusRows = await sql<{ status: string; c: number }>`
      SELECT status, COUNT(*)::int AS c FROM (
        SELECT DISTINCT ON (technician_id) technician_id, status FROM technician_statuses
        WHERE tenant_id = ${ctx.tenantId} ${bc} ORDER BY technician_id, changed_at DESC
      ) latest GROUP BY status
    `.execute(this.db);
    let clockedIn = 0, onBreak = 0, offShift = 0;
    const ON = ['available', 'in_service', 'ready_to_start', 'accepted', 'assigned', 'serving', 'waiting', 'delayed'];
    const BREAK = ['on_break', 'break', 'lunch'];
    for (const x of statusRows.rows) { const c = n(x.c); if (BREAK.includes(x.status)) onBreak += c; else if (ON.includes(x.status)) clockedIn += c; else offShift += c; }
    const shiftDay = businessDate(await branchTimeZone(this.db, ctx.tenantId, (ctx as any).branchId ?? null));   // the branch's day (Oct 3 2026)
    const sched = await sql<{ c: number }>`SELECT COUNT(*)::int AS c FROM technician_shifts WHERE tenant_id = ${ctx.tenantId} AND shift_date = ${shiftDay}::date ${bc}`.execute(this.db);
    return { clockedIn, onBreak, offShift, scheduledToday: n(sched.rows?.[0]?.c) };
  }

  async technicianBookingCount(ctx: OwnerContext, technicianId: string, r: DateRange): Promise<number> {
    const { fromDate, lastDate } = this.apptWindow(r);
    const row = await this.db.selectFrom('pos_tech_appointments').select((eb) => eb.fn.countAll().as('c'))
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('appt_date', '>=', fromDate).where('appt_date', '<=', lastDate).executeTakeFirst();
    return n(row?.c);
  }

  // ---- Module 5: Finance & Reports ----
  async taxAndDiscountCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ taxCents: number; discountCents: number }> {
    let q = this.db.selectFrom('tickets').select((eb) => [eb.fn.sum('tax_cents').as('tax'), eb.fn.sum('discount_cents').as('disc')])
      .where('tenant_id', '=', ctx.tenantId).where('status', '=', 'paid').where('paid_at', '>=', r.fromIso as any).where('paid_at', '<', r.toIso as any);
    q = this.bScope(q, ctx, branchId);
    const row = await q.executeTakeFirst();
    return { taxCents: n((row as any)?.tax), discountCents: n((row as any)?.disc) };
  }

  // Payment mix by method, over successful payments (status set matches the existing dashboard module).
  async paymentMix(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ method: string; amountCents: number; count: number }[]> {
    const PAID = ['completed', 'paid', 'captured', 'approved', 'settled', 'succeeded'];
    let q = this.db.selectFrom('payments').select((eb) => ['method', eb.fn.sum('amount_cents').as('amt'), eb.fn.countAll().as('c')])
      .where('tenant_id', '=', ctx.tenantId).where('status', 'in', PAID).where('created_at', '>=', r.fromIso as any).where('created_at', '<', r.toIso as any);
    q = this.bScope(q, ctx, branchId);
    const rows = await q.groupBy('method').execute();
    return (rows as any[]).map((x) => ({ method: x.method || 'other', amountCents: n(x.amt), count: n(x.c) }));
  }

  async revenueByDate(ctx: OwnerContext, branchId: string | null, r: DateRange, timeZone = 'UTC'): Promise<{ date: string; revenueCents: number; transactions: number }[]> {
    const bc = this.bSql(ctx, branchId);
    const rows = await sql<{ d: string; rev: number; c: number }>`
      SELECT to_char(paid_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS d, COALESCE(SUM(total_cents), 0)::bigint AS rev, COUNT(*)::int AS c
      FROM tickets WHERE tenant_id = ${ctx.tenantId} AND status = 'paid' AND paid_at >= ${r.fromIso} AND paid_at < ${r.toIso} ${bc}
      GROUP BY 1 ORDER BY 1
    `.execute(this.db);
    return rows.rows.map((x) => ({ date: x.d, revenueCents: n(x.rev), transactions: n(x.c) }));
  }

  // ---- Module 6: Alerts / More / Settings ----
  async tenantName(ctx: OwnerContext): Promise<string> {
    const r = await sql<{ name: string }>`SELECT COALESCE(display_name, legal_name, 'My Business') AS name FROM tenants WHERE id = ${ctx.tenantId}`.execute(this.db);
    return r.rows?.[0]?.name ?? 'My Business';
  }

  private mapAlert(x: any): OwnerAlert {
    let meta: any = {};
    try { meta = typeof x.metadata === 'string' ? JSON.parse(x.metadata) : (x.metadata ?? {}); } catch { meta = {}; }
    const ref = (meta && (meta.appointmentId || meta.ticketId || meta.queueItemId)) || null;
    return {
      id: x.id, branchId: x.branch_id, category: x.category, severity: x.severity as OwnerAlertSeverity, status: x.status as OwnerAlertStatus,
      title: x.title, body: x.body ?? null,
      metadata: meta,
      reference: ref,
      createdAt: new Date(x.created_at).toISOString(), resolvedAt: x.resolved_at ? new Date(x.resolved_at).toISOString() : null,
    };
  }

  /** Migration 457: an owner-only alert (e.g. a fraud finding that names an employee — possibly a manager) is invisible to
   *  every non-OWNER role on EVERY path — list, counts, detail and status change — so it cannot be read, or acknowledged
   *  away, by the person it is about. */
  private audience<Q extends { where: (...a: any[]) => any }>(q: Q, ctx: OwnerContext): Q { return hasTenantWideScope(ctx as any) ? q : (q.where('audience', '=', 'all') as Q); }   // Phase 9: owner-audience notices follow the owner-level view, not the role name

  async listAlerts(ctx: OwnerContext, branchId: string | null, opts: { status?: string; severity?: string; limit?: number }): Promise<OwnerAlert[]> {
    let q = this.audience(this.db.selectFrom('owner_alerts').selectAll().where('tenant_id', '=', ctx.tenantId), ctx);
    if (branchId) {
      q = q.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    } else {
      q = this.bScope(q, ctx, null);
    }
    if (opts.status === 'open') {
      q = q.where('status', 'not in', ['resolved', 'dismissed']);
    } else if (opts.status) {
      q = q.where('status', '=', opts.status);
    }
    if (opts.severity) q = q.where('severity', '=', opts.severity);
    const rows = await q.orderBy('created_at', 'desc').limit(Math.min(opts.limit ?? 50, 200)).execute();
    const mapped = rows.map((r) => this.mapAlert(r));

    let nq = (this.db as any).selectFrom('owner_notifications').selectAll().where('tenant_id', '=', ctx.tenantId);
    if (opts.status === 'open' || opts.status === 'new') {
      nq = nq.where('read_at', 'is', null);
    } else if (opts.status === 'acknowledged' || opts.status === 'read') {
      nq = nq.where('read_at', 'is not', null);
    }
    let notifRows: any[] = [];
    try {
      notifRows = await nq.orderBy('created_at', 'desc').limit(Math.min(opts.limit ?? 50, 100)).execute();
    } catch { /* best-effort */ }
    const mappedNotifs: OwnerAlert[] = notifRows.map((r: any) => ({
      id: r.id,
      branchId: null,
      category: r.type || 'booking',
      severity: (r.type === 'appointment_cancelled' ? 'warning' : 'info') as OwnerAlertSeverity,
      status: (r.read_at ? 'acknowledged' : 'new') as OwnerAlertStatus,
      title: r.title,
      body: r.body ?? null,
      metadata: r.reference ? { appointmentId: r.reference } : {},
      reference: r.reference || null,
      createdAt: new Date(r.created_at).toISOString(),
      resolvedAt: r.read_at ? new Date(r.read_at).toISOString() : null,
    }));

    const combined = [...mapped, ...mappedNotifs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const seenRefs = new Set<string>();
    const deduplicated: OwnerAlert[] = [];
    for (const item of combined) {
      const ref = (item as any).reference || (item as any).metadata?.appointmentId || (item as any).metadata?.ticketId || (item as any).metadata?.queueItemId;
      if (ref) {
        const titleNorm = String(item.title || item.category || '').toLowerCase();
        const action = titleNorm.includes('cancel') ? 'cancelled' : titleNorm.includes('resched') ? 'rescheduled' : 'booked';
        const dedupeKey = `${ref}:${action}`;
        if (seenRefs.has(dedupeKey)) continue;
        seenRefs.add(dedupeKey);
      }
      deduplicated.push(item);
    }
    return deduplicated.slice(0, Math.min(opts.limit ?? 50, 200));
  }

  async alertCounts(ctx: OwnerContext, branchId: string | null): Promise<{ total: number; unread: number; bySeverity: Record<string, number>; byStatus: Record<string, number> }> {
    let q = this.audience(this.db.selectFrom('owner_alerts').select((eb) => ['severity', 'status', eb.fn.countAll().as('c')]).where('tenant_id', '=', ctx.tenantId), ctx);
    if (branchId) {
      q = q.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    } else {
      q = this.bScope(q, ctx, null);
    }
    const rows = await q.groupBy(['severity', 'status']).execute();
    const bySeverity: Record<string, number> = { info: 0, warning: 0, high: 0, critical: 0 };
    const byStatus: Record<string, number> = { new: 0, acknowledged: 0, in_progress: 0, resolved: 0, dismissed: 0 };
    let total = 0;
    for (const x of rows as any[]) { const c = n(x.c); total += c; if (x.severity in bySeverity) bySeverity[x.severity] += c; if (x.status in byStatus) byStatus[x.status] += c; }

    try {
      const existingRefs = new Set<string>();
      const alertRows = await this.audience(this.db.selectFrom('owner_alerts').select(['metadata']).where('tenant_id', '=', ctx.tenantId).where('status', 'not in', ['resolved', 'dismissed']), ctx).execute();
      for (const r of alertRows as any[]) {
        const meta = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
        const ref = meta?.appointmentId || meta?.ticketId || meta?.queueItemId;
        if (ref) existingRefs.add(String(ref));
      }
      const notifsUnreadRows = await (this.db as any).selectFrom('owner_notifications')
        .select(['reference'])
        .where('tenant_id', '=', ctx.tenantId)
        .where('read_at', 'is', null)
        .execute();
      let extraUnread = 0;
      for (const nRow of notifsUnreadRows as any[]) {
        if (!nRow.reference || !existingRefs.has(String(nRow.reference))) {
          extraUnread++;
        }
      }
      total += extraUnread;
      byStatus.new += extraUnread;
      bySeverity.info += extraUnread;
    } catch { /* best-effort */ }

    return { total, unread: byStatus.new, bySeverity, byStatus };
  }

  async getAlert(ctx: OwnerContext, alertId: string): Promise<OwnerAlert | null> {
    const x = await this.audience(this.db.selectFrom('owner_alerts').selectAll().where('id', '=', alertId).where('tenant_id', '=', ctx.tenantId), ctx).executeTakeFirst();
    if (x) return this.mapAlert(x);
    try {
      const nRow: any = await (this.db as any).selectFrom('owner_notifications').selectAll().where('id', '=', alertId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
      if (nRow) {
        return {
          id: nRow.id, branchId: null, category: nRow.type || 'booking', severity: 'info' as OwnerAlertSeverity,
          status: (nRow.read_at ? 'acknowledged' : 'new') as OwnerAlertStatus,
          title: nRow.title, body: nRow.body ?? null,
          createdAt: new Date(nRow.created_at).toISOString(), resolvedAt: nRow.read_at ? new Date(nRow.read_at).toISOString() : null,
        };
      }
    } catch { /* best-effort */ }
    return null;
  }

  async updateAlertStatus(ctx: OwnerContext, alertId: string, status: string, userId: string, markResolved: boolean): Promise<OwnerAlert | null> {
    // Check if alertId is in owner_notifications first
    try {
      const nRow: any = await (this.db as any).selectFrom('owner_notifications').selectAll().where('id', '=', alertId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
      if (nRow) {
        await (this.db as any).updateTable('owner_notifications').set({ read_at: sql`now()` }).where('id', '=', alertId).where('tenant_id', '=', ctx.tenantId).execute();
        return {
          id: nRow.id, branchId: null, category: nRow.type || 'booking', severity: 'info' as OwnerAlertSeverity,
          status: 'acknowledged' as OwnerAlertStatus,
          title: nRow.title, body: nRow.body ?? null,
          createdAt: new Date(nRow.created_at).toISOString(), resolvedAt: new Date().toISOString(),
        };
      }
    } catch { /* best-effort */ }

    // Scope existence to the caller's allowed branches (mirrors the read path): a restricted manager cannot transition an
    // alert outside their assigned branches even with its id. bScope is a no-op for full owners / super admins.
    let eq = this.audience(this.db.selectFrom('owner_alerts').select(['id']).where('id', '=', alertId).where('tenant_id', '=', ctx.tenantId), ctx);
    eq = this.bScope(eq, ctx, null);
    const exists = await eq.executeTakeFirst();
    if (!exists) return null;
    const set: any = { status, updated_at: sql`now()` };
    if (markResolved) { set.resolved_at = sql`now()`; set.resolved_by_user_id = userId; }
    await this.db.transaction().execute(async (trx) => {
      const prev: any = await trx.selectFrom('owner_alerts').select(['status', 'branch_id', 'metadata'] as any).where('id', '=', alertId).where('tenant_id', '=', ctx.tenantId).forUpdate().executeTakeFirst();
      if (!prev) return;
      // Phase 12 (#27): the one owner_alert transition table (a resolved / dismissed alert is closed); the row is locked
      // FOR UPDATE above and the write stays conditional on the state read
      assertTransition(OWNER_ALERT, String(prev.status), status);
      await trx.updateTable('owner_alerts').set(set).where('id', '=', alertId).where('tenant_id', '=', ctx.tenantId).where('status', '=', prev.status).execute();
      // Also mark corresponding owner_notifications read if this alert references an appointment/ticket
      try {
        const meta = typeof prev.metadata === 'string' ? JSON.parse(prev.metadata) : prev.metadata;
        const ref = meta?.appointmentId || meta?.ticketId;
        if (ref && (status === 'acknowledged' || status === 'resolved' || status === 'dismissed')) {
          await (this.db as any).updateTable('owner_notifications').set({ read_at: sql`now()` }).where('reference', '=', String(ref)).where('tenant_id', '=', ctx.tenantId).where('read_at', 'is', null).execute();
        }
      } catch { /* best-effort */ }
      // owner_alert.status_changed — only when the status actually changed (acknowledging twice records nothing)
      if (this.outbox && prev && String(prev.status) !== status) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.OWNER_ALERT_STATUS_CHANGED, tenantId: ctx.tenantId,
        branchId: (prev.branch_id as string) ?? undefined, aggregateType: 'owner_alert', aggregateId: alertId, actorId: userId || undefined, actorType: 'user',
        payload: { alertId, status, previousStatus: String(prev.status) } }));
    });
    return this.getAlert(ctx, alertId);
  }

  // ---- Cross-cutting: append-only owner audit log ----
  async writeAudit(ctx: OwnerContext, e: { action: string; entityType?: string | null; entityId?: string | null; branchId?: string | null; metadata?: unknown }): Promise<void> {
    await this.db.insertInto('owner_audit_log').values({
      tenant_id: ctx.tenantId, branch_id: e.branchId ?? null, user_id: ctx.userId, role: ctx.role,
      action: e.action, entity_type: e.entityType ?? null, entity_id: e.entityId ?? null,
      metadata: JSON.stringify(e.metadata ?? {}) as unknown as object,
    } as any).execute();
  }

  async listAudit(ctx: OwnerContext, limit = 50): Promise<OwnerAuditEntry[]> {
    const rows = await this.db.selectFrom('owner_audit_log').selectAll().where('tenant_id', '=', ctx.tenantId).orderBy('created_at', 'desc').limit(Math.min(limit, 200)).execute();
    return rows.map((r: any) => ({ id: r.id, userId: r.user_id, role: r.role, action: r.action, entityType: r.entity_type, entityId: r.entity_id, metadata: r.metadata, createdAt: new Date(r.created_at).toISOString() }));
  }

  // Owner Access Code — scoped by ctx.userId AND ctx.tenantId, the SAME shape ownerProfile() uses for the owner's
  // own user row: read and write are consistent (the read gates the write), and this provisioning lives inside the
  // profile screen that already loads under that scope. Raw sql keeps the new nullable column out of the generated
  // Kysely types (same approach as findOwnerForLogin).
  async ownerPasswordHash(ctx: OwnerContext): Promise<string | null> {
    const res: any = await sql`select password_hash from users where id = ${ctx.userId} and tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    return res?.rows?.[0]?.password_hash ?? null;
  }
  async ownerAccessCodeConfigured(ctx: OwnerContext): Promise<boolean> {
    const res: any = await sql`select (owner_access_code_hash is not null) as configured from users where id = ${ctx.userId} and tenant_id = ${ctx.tenantId} limit 1`.execute(this.db);
    return !!res?.rows?.[0]?.configured;
  }
  async setOwnerAccessCodeHash(ctx: OwnerContext, hash: string | null): Promise<void> {
    await sql`update users set owner_access_code_hash = ${hash} where id = ${ctx.userId} and tenant_id = ${ctx.tenantId}`.execute(this.db);
  }

  // ---- Expenses (operating costs; incurred_on is a salon-local DATE, so windows compare against local date bounds) ----
  private mapExpense(x: any): OwnerExpense { return { id: x.id, branchId: x.branch_id, category: x.category, amountCents: n(x.amount_cents), description: x.description ?? null, vendor: x.vendor ?? null, incurredOn: this.dstr(x.incurred_on), createdAt: new Date(x.created_at).toISOString() }; }

  async createExpense(ctx: OwnerContext, e: OwnerExpenseInput): Promise<OwnerExpense> {
    const row = await this.db.insertInto('expenses').values({
      tenant_id: ctx.tenantId, branch_id: e.branchId ?? null, category: e.category, amount_cents: e.amountCents,
      description: e.description ?? null, vendor: e.vendor ?? null, incurred_on: e.incurredOn, created_by: ctx.userId,
    } as any).returningAll().executeTakeFirstOrThrow();
    return this.mapExpense(row);
  }

  async listExpenses(ctx: OwnerContext, branchId: string | null, r: DateRange, limit = 100): Promise<OwnerExpense[]> {
    const { fromDate, lastDate } = this.apptWindow(r);
    let q = this.db.selectFrom('expenses').selectAll().where('tenant_id', '=', ctx.tenantId).where('incurred_on', '>=', fromDate).where('incurred_on', '<=', lastDate);
    q = this.bScope(q, ctx, branchId);
    const rows = await q.orderBy('incurred_on', 'desc').orderBy('created_at', 'desc').limit(Math.min(limit, 500)).execute();
    return rows.map((x) => this.mapExpense(x));
  }

  async getExpense(ctx: OwnerContext, id: string): Promise<OwnerExpense | null> {
    const row = await this.db.selectFrom('expenses').selectAll().where('id', '=', id).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return row ? this.mapExpense(row) : null;
  }

  async updateExpense(ctx: OwnerContext, id: string, patch: Partial<OwnerExpenseInput>): Promise<OwnerExpense | null> {
    const set: any = { updated_at: new Date() };
    if (patch.category !== undefined) set.category = patch.category;
    if (patch.amountCents !== undefined) set.amount_cents = patch.amountCents;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.vendor !== undefined) set.vendor = patch.vendor;
    if (patch.incurredOn !== undefined) set.incurred_on = patch.incurredOn;
    if (patch.branchId !== undefined) set.branch_id = patch.branchId;
    await this.db.updateTable('expenses').set(set).where('id', '=', id).where('tenant_id', '=', ctx.tenantId).execute();
    return this.getExpense(ctx, id);
  }

  async deleteExpense(ctx: OwnerContext, id: string): Promise<boolean> {
    const res = await this.db.deleteFrom('expenses').where('id', '=', id).where('tenant_id', '=', ctx.tenantId).executeTakeFirst();
    return Number(res?.numDeletedRows ?? 0) > 0;
  }

  async expensesTotalCents(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<number> {
    const { fromDate, lastDate } = this.apptWindow(r);
    const bc = this.bSql(ctx, branchId);
    const res = await sql<{ s: number }>`SELECT COALESCE(SUM(amount_cents),0)::bigint AS s FROM expenses WHERE tenant_id = ${ctx.tenantId} AND incurred_on >= ${fromDate} AND incurred_on <= ${lastDate} ${bc}`.execute(this.db);
    return n(res.rows?.[0]?.s);
  }

  async expensesByCategory(ctx: OwnerContext, branchId: string | null, r: DateRange): Promise<{ category: string; amountCents: number; count: number }[]> {
    const { fromDate, lastDate } = this.apptWindow(r);
    let q = this.db.selectFrom('expenses').select((eb) => ['category', eb.fn.sum('amount_cents').as('amt'), eb.fn.countAll().as('c')])
      .where('tenant_id', '=', ctx.tenantId).where('incurred_on', '>=', fromDate).where('incurred_on', '<=', lastDate);
    q = this.bScope(q, ctx, branchId);
    const rows = await q.groupBy('category').orderBy('amt', 'desc').execute();
    return rows.map((x: any) => ({ category: x.category, amountCents: n(x.amt), count: n(x.c) }));
  }

  // ---- Owner Ticket Oversight (read-only) — ALWAYS tenant_id from session + owner-branch scope via bScope ----
  private oiso(v: any): string { return v == null ? '' : new Date(v).toISOString(); }
  private oisoN(v: any): string | null { return v == null ? null : new Date(v).toISOString(); }
  private ownerTicketBase(ctx: OwnerContext, f: OwnerTicketFilters) {
    let q: any = this.db.selectFrom('tickets as t')
      .leftJoin('customers as c', 'c.id', 't.customer_id')
      .leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id')
      .where('t.tenant_id', '=', ctx.tenantId);
    q = this.bScope(q, ctx, f.branchId || null, 't.branch_id');
    if (f.status) q = q.where('t.status', '=', f.status);
    if (f.search) { const like = `%${f.search.replace(/[%_]/g, (m: string) => '\\' + m)}%`; q = q.where((eb: any) => eb.or([eb('t.ticket_number', 'ilike', like), eb('c.full_name', 'ilike', like), eb('tech.full_name', 'ilike', like)])); }
    if (f.dateFrom) q = q.where('t.created_at', '>=', sql`((${f.dateFrom})::date)::timestamp AT TIME ZONE ${f.tz || 'UTC'}`);
    if (f.dateTo) q = q.where('t.created_at', '<', sql`(((${f.dateTo})::date) + 1)::timestamp AT TIME ZONE ${f.tz || 'UTC'}`);
    return q;
  }
  async ownerTicketsList(ctx: OwnerContext, f: Required<Pick<OwnerTicketFilters, 'page' | 'pageSize'>> & OwnerTicketFilters): Promise<OwnerTicketList> {
    const total = await this.ownerTicketBase(ctx, f).select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => Number(r?.c || 0)).catch(() => 0);
    const rows: any[] = await this.ownerTicketBase(ctx, f)
      .select(['t.id as id', 't.ticket_number as ticket_number', 't.branch_id as branch_id', 't.status as status', 'c.full_name as customer_name', 'tech.full_name as technician_name', 't.total_cents as total_cents', 't.version as version', 't.service_done_locked_at as locked_at', 't.created_at as created_at', 't.paid_at as paid_at', 't.removed_at as removed_at'])
      .orderBy('t.created_at', 'desc').limit(f.pageSize).offset((f.page - 1) * f.pageSize).execute().catch(() => []);
    const tickets: OwnerTicketRow[] = rows.map((r) => ({ ticketId: r.id, ticketNumber: r.ticket_number ?? null, branchId: r.branch_id ?? null, status: r.status, customerName: r.customer_name ?? null, technicianName: r.technician_name ?? null, totalCents: Number(r.total_cents ?? 0), version: Number(r.version ?? 0), serviceDoneLocked: !!r.locked_at, createdAt: this.oiso(r.created_at), paidAt: this.oisoN(r.paid_at), removedAt: this.oisoN(r.removed_at) }));
    return { tickets, total, page: f.page, pageSize: f.pageSize };
  }
  async ownerTicket(ctx: OwnerContext, ticketId: string): Promise<OwnerTicketDetail | null> {
    let q: any = this.db.selectFrom('tickets as t').leftJoin('customers as c', 'c.id', 't.customer_id').leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id').where('t.tenant_id', '=', ctx.tenantId).where('t.id', '=', ticketId);
    q = this.bScope(q, ctx, null, 't.branch_id');
    const r: any = await q.select(['t.id as id', 't.ticket_number as ticket_number', 't.branch_id as branch_id', 't.status as status', 'c.full_name as customer_name', 'tech.full_name as technician_name', 't.total_cents as total_cents', 't.version as version', 't.service_done_locked_at as locked_at', 't.created_at as created_at', 't.paid_at as paid_at', 't.removed_at as removed_at', 't.subtotal_cents as subtotal_cents', 't.tax_cents as tax_cents', 't.discount_cents as discount_cents', 't.tip_cents as tip_cents', 't.serving_started_at as serving_started_at', 't.service_done_at as service_done_at']).executeTakeFirst().catch(() => undefined);
    if (!r) return null;
    return { ticketId: r.id, ticketNumber: r.ticket_number ?? null, branchId: r.branch_id ?? null, status: r.status, customerName: r.customer_name ?? null, technicianName: r.technician_name ?? null, totalCents: Number(r.total_cents ?? 0), version: Number(r.version ?? 0), serviceDoneLocked: !!r.locked_at, createdAt: this.oiso(r.created_at), paidAt: this.oisoN(r.paid_at), removedAt: this.oisoN(r.removed_at), subtotalCents: Number(r.subtotal_cents ?? 0), taxCents: Number(r.tax_cents ?? 0), discountCents: Number(r.discount_cents ?? 0), tipCents: Number(r.tip_cents ?? 0), servingStartedAt: this.oisoN(r.serving_started_at), serviceDoneAt: this.oisoN(r.service_done_at) };
  }
  async ownerTicketLines(ctx: OwnerContext, ticketId: string): Promise<OwnerTicketLine[]> {
    const rows: any[] = await this.db.selectFrom('ticket_service_lines as l').leftJoin('technicians as tech', 'tech.id', 'l.technician_id').where('l.ticket_id', '=', ticketId).where('l.tenant_id', '=', ctx.tenantId).select(['l.service_name_snapshot as name', 'l.price_cents_snapshot as price', 'l.line_total_cents as line_total', 'tech.full_name as technician_name', 'l.status as status', 'l.is_add_on as is_add_on']).orderBy('l.created_at', 'asc').execute().catch(() => []);
    return rows.map((r) => ({ serviceName: r.name, priceCents: Number(r.price ?? 0), lineTotalCents: Number(r.line_total ?? 0), technicianName: r.technician_name ?? null, status: r.status, isAddOn: !!r.is_add_on }));
  }
  async ownerTicketRevisions(ctx: OwnerContext, ticketId: string): Promise<OwnerTicketRevision[]> {
    const rows: any[] = await this.db.selectFrom('ticket_revisions').where('ticket_id', '=', ticketId).where('tenant_id', '=', ctx.tenantId).orderBy('version', 'asc').selectAll().execute().catch(() => []);
    return rows.map((r) => ({ version: Number(r.version), action: r.action, actorRole: r.actor_role ?? null, summary: r.summary ?? null, createdAt: this.oiso(r.created_at) }));
  }

  async ownerLiveOperations(ctx: OwnerContext, branchId: string | null, tz: string): Promise<OwnerLiveOperations> {
    // salon-local "today" boundaries as timestamptz instants (same AT TIME ZONE idiom as the ticket date filters)
    const dayStart = sql`date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`;
    const dayEnd = sql`(date_trunc('day', now() AT TIME ZONE ${tz}) + interval '1 day') AT TIME ZONE ${tz}`;

    // ── counts (each resolves to a number) ──
    const waitingP: Promise<number> = this.bScope(this.db.selectFrom('pos_queue_items').where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['waiting', 'called']) as any, ctx, branchId)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const servingP: Promise<number> = this.bScope(this.db.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId).where('status', '=', 'in_service') as any, ctx, branchId)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const completedP: Promise<number> = this.bScope(this.db.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId) as any, ctx, branchId)
      .where('service_done_at', '>=', dayStart).where('service_done_at', '<', dayEnd)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const readyP: Promise<number> = this.bScope(this.db.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId).where('ready_checkout_at', 'is not', null).where('paid_at', 'is', null) as any, ctx, branchId)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const walkInsP: Promise<number> = this.bScope(this.db.selectFrom('pos_queue_items').where('tenant_id', '=', ctx.tenantId).where('source', '=', 'walk_in') as any, ctx, branchId)
      .where('checked_in_at', '>=', dayStart).where('checked_in_at', '<', dayEnd)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const delayedP: Promise<number> = this.bScope(this.db.selectFrom('pos_tech_appointments').where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['booked', 'confirmed']) as any, ctx, branchId)
      .where(sql`(appt_date::date + start_time::time)`, '<', sql`((now() AT TIME ZONE ${tz}) - interval '15 minutes')`)
      .where(sql`appt_date::date`, '=', sql`(date_trunc('day', now() AT TIME ZONE ${tz}))::date`)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);

    // ── tech queue (active services = in_service tickets) ──
    const techRows: any[] = await this.bScope(
      this.db.selectFrom('tickets as t')
        .leftJoin('technicians as tech', 'tech.id', 't.primary_technician_id')
        .leftJoin('pos_queue_items as q', 'q.id', 't.queue_item_id')
        .where('t.tenant_id', '=', ctx.tenantId).where('t.status', '=', 'in_service') as any,
      ctx, branchId, 't.branch_id')
      .select(['t.id as ticket_id', 't.primary_technician_id as tech_id', 'tech.full_name as tech_name', 't.serving_started_at as started_at', 't.serving_paused_at as paused_at', 't.accumulated_paused_ms as paused_ms', 'q.customer_name as customer_name'])
      .orderBy('t.serving_started_at', 'asc').limit(40).execute().catch(() => []);
    // resolve one service label per active ticket (first line)
    const ids = techRows.map((r) => r.ticket_id);
    const labelMap = new Map<string, string>();
    if (ids.length) {
      const lines: any[] = await this.db.selectFrom('ticket_service_lines').where('ticket_id', 'in', ids).where('tenant_id', '=', ctx.tenantId)
        .select(['ticket_id', 'service_name_snapshot', 'created_at']).orderBy('created_at', 'asc').execute().catch(() => []);
      for (const l of lines) { if (!labelMap.has(l.ticket_id)) labelMap.set(l.ticket_id, l.service_name_snapshot); }
    }
    const now = Date.now();
    const techQueue: OwnerLiveTechRow[] = techRows.filter((r) => r.tech_id).map((r) => {
      const startedMs = r.started_at ? new Date(r.started_at).getTime() : now;
      const elapsedMs = Math.max(0, now - startedMs - n(r.paused_ms));
      return { technicianId: r.tech_id, technicianName: r.tech_name ?? '—', serviceLabel: labelMap.get(r.ticket_id) ?? null, customerName: r.customer_name ?? null, elapsedMinutes: Math.floor(elapsedMs / 60000), paused: r.paused_at != null };
    });

    // ── live customer queue (waiting/called) ──
    const queueRows: any[] = await this.bScope(
      this.db.selectFrom('pos_queue_items as q')
        .leftJoin('technicians as tech', 'tech.id', 'q.requested_technician_id')
        .where('q.tenant_id', '=', ctx.tenantId).where('q.status', 'in', ['waiting', 'called']) as any,
      ctx, branchId, 'q.branch_id')
      .select(['q.id as id', 'q.customer_name as customer_name', 'q.is_vip as is_vip', 'q.requested_services as requested_services', 'q.status as status', 'q.checked_in_at as checked_in_at', 'tech.full_name as requested_tech_name'])
      .orderBy('q.checked_in_at', 'asc').limit(40).execute().catch(() => []);
    const liveQueue: OwnerLiveQueueRow[] = queueRows.map((r) => {
      const inMs = r.checked_in_at ? new Date(r.checked_in_at).getTime() : now;
      return { queueItemId: r.id, customerName: r.customer_name ?? '—', isVip: !!r.is_vip, serviceLabel: firstServiceLabel(r.requested_services), requestedTechnicianName: r.requested_tech_name ?? null, waitMinutes: Math.max(0, Math.floor((now - inMs) / 60000)), status: r.status };
    });

    // ── team (Oct 12 2026 merge, workforce audit #28): every active technician in scope + the authoritative live state
    // (technician_workforce_state, 579) + today's money from the immutable compensation snapshots (never re-derived) ──
    const teamRows: any[] = await this.bScope(
      this.db.selectFrom('technicians as tech')
        .leftJoin('technician_workforce_state as w', (j: any) => j.onRef('w.technician_id', '=', 'tech.id').onRef('w.tenant_id', '=', 'tech.tenant_id'))
        .where('tech.tenant_id', '=', ctx.tenantId).where('tech.is_active', '=', true) as any,
      ctx, branchId, 'tech.branch_id')
      .select(['tech.id as id', 'tech.full_name as name', 'w.queue_status as queue_status', 'w.clock_status as clock_status'])
      .orderBy('tech.full_name', 'asc').limit(200).execute().catch(() => []);
    const money = new Map<string, { sales: number; tips: number }>();
    if (teamRows.length) {
      const snaps: any[] = await this.bScope(
        (this.db as any).selectFrom('ticket_compensation_snapshots').where('tenant_id', '=', ctx.tenantId)
          .where('snapshot_at', '>=', dayStart).where('snapshot_at', '<', dayEnd)
          .where('technician_id', 'in', teamRows.map((r) => r.id)) as any, ctx, branchId)
        .select(['technician_id', sql<number>`sum(gross_price_cents - discount_cents)`.as('sales'), sql<number>`sum(card_tip_cents + cash_tip_cents)`.as('tips')])
        .groupBy('technician_id').execute().catch(() => []);
      for (const r of snaps) money.set(r.technician_id, { sales: n(r.sales), tips: n(r.tips) });
    }
    const servingBy = new Map(techQueue.map((t) => [t.technicianId, t.customerName]));
    const team: OwnerLiveTeamRow[] = teamRows.map((r) => ({
      technicianId: r.id, technicianName: r.name ?? '—', queueStatus: r.queue_status ?? null, clockStatus: r.clock_status ?? null,
      currentCustomerName: servingBy.get(r.id) ?? null, salesTodayCents: money.get(r.id)?.sales ?? 0, tipsTodayCents: money.get(r.id)?.tips ?? 0,
    }));

    const [waiting, serving, completedToday, readyForCheckout, walkIns, delayedAppointments] = await Promise.all([waitingP, servingP, completedP, readyP, walkInsP, delayedP]);
    return {
      branchId,
      counts: { waiting, serving, completedToday },
      techQueue, liveQueue, team,
      todaySoFar: { servicesDone: completedToday, walkIns },
      signals: { readyForCheckout, delayedAppointments },
      generatedAt: new Date().toISOString(),
    };
  }

  // Lightweight live-floor counts for the Home dashboard — the same scoped predicates Live Operations uses, but without
  // the tech/customer queue arrays so the dashboard stays one cheap call. Salon-local "today"; each count fails safe to 0.
  async ownerFloorCounts(ctx: OwnerContext, branchId: string | null, tz: string): Promise<{ waiting: number; serving: number; servicesToday: number; readyToCheckout: number; checkInsToday: number }> {
    const dayStart = sql`date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}`;
    const dayEnd = sql`(date_trunc('day', now() AT TIME ZONE ${tz}) + interval '1 day') AT TIME ZONE ${tz}`;
    const waitingP: Promise<number> = this.bScope(this.db.selectFrom('pos_queue_items').where('tenant_id', '=', ctx.tenantId).where('status', 'in', ['waiting', 'called']) as any, ctx, branchId)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const servingP: Promise<number> = this.bScope(this.db.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId).where('status', '=', 'in_service') as any, ctx, branchId)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const servicesTodayP: Promise<number> = this.bScope(this.db.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId) as any, ctx, branchId)
      .where('service_done_at', '>=', dayStart).where('service_done_at', '<', dayEnd)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const readyP: Promise<number> = this.bScope(this.db.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId).where('ready_checkout_at', 'is not', null).where('paid_at', 'is', null) as any, ctx, branchId)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const checkInsP: Promise<number> = this.bScope(this.db.selectFrom('pos_queue_items').where('tenant_id', '=', ctx.tenantId) as any, ctx, branchId)
      .where('checked_in_at', '>=', dayStart).where('checked_in_at', '<', dayEnd)
      .select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const [waiting, serving, servicesToday, readyToCheckout, checkInsToday] = await Promise.all([waitingP, servingP, servicesTodayP, readyP, checkInsP]);
    return { waiting, serving, servicesToday, readyToCheckout, checkInsToday };
  }

  // ── Commission & Payroll (read-only): the engine's stored payroll_periods + payroll_lines, scoped to the owner's
  // allowed branches via bScope (payroll is org-level, so we scope by the allowed SET rather than the single selector). ──
  private mapPeriod(r: any): OwnerPayrollPeriodSummary {
    return { periodId: r.id, branchId: r.branch_id ?? null, label: r.label ?? null, periodStart: ymdOfDate(r.period_start), periodEnd: ymdOfDate(r.period_end), status: (r.status as OwnerPayrollPeriodSummary['status']), finalizedAt: this.oisoN(r.finalized_at), paidAt: this.oisoN(r.paid_at), totalPayableCents: n(r.total_payable_cents), totalCommissionCents: n(r.total_commission_cents), totalTipsCents: n(r.total_tips_cents) };
  }

  async ownerPayrollList(ctx: OwnerContext): Promise<OwnerPayrollList> {
    const periodRows: any[] = await this.bScope(this.db.selectFrom('payroll_periods').where('tenant_id', '=', ctx.tenantId) as any, ctx, null)
      .selectAll().orderBy('period_start', 'desc').orderBy('created_at', 'desc').limit(60).execute().catch(() => []);
    const periods = periodRows.map((r) => this.mapPeriod(r));
    const agg: any = await this.bScope(this.db.selectFrom('payroll_periods').where('tenant_id', '=', ctx.tenantId) as any, ctx, null)
      .select([
        sql<number>`count(*)`.as('total'),
        sql<number>`count(*) filter (where status <> 'paid')`.as('open'),
        sql<number>`coalesce(sum(total_payable_cents) filter (where status <> 'paid'), 0)`.as('unpaid'),
        sql<number>`coalesce(sum(total_commission_cents), 0)`.as('commission'),
        sql<number>`coalesce(sum(total_tips_cents), 0)`.as('tips'),
      ]).executeTakeFirst().catch(() => undefined);
    const kpis = {
      totalPeriods: n(agg?.total), openPeriods: n(agg?.open), unpaidPayableCents: n(agg?.unpaid),
      latestPeriodPayableCents: periods.length ? periods[0].totalPayableCents : 0,
      lifetimeCommissionCents: n(agg?.commission), lifetimeTipsCents: n(agg?.tips),
    };
    return { periods, kpis };
  }

  async ownerPayrollPeriod(ctx: OwnerContext, periodId: string): Promise<OwnerPayrollPeriodDetail | null> {    const pr: any = await this.bScope(this.db.selectFrom('payroll_periods').where('tenant_id', '=', ctx.tenantId).where('id', '=', periodId) as any, ctx, null)
      .selectAll().executeTakeFirst().catch(() => undefined);
    if (!pr) return null; // not found OR outside the owner's allowed branches
    const lineRows: any[] = await this.db.selectFrom('payroll_lines').where('tenant_id', '=', ctx.tenantId).where('period_id', '=', periodId)
      .selectAll().orderBy('payable_cents', 'desc').execute().catch(() => []);
    const lines: OwnerPayrollLine[] = lineRows.map((r) => ({
      technicianId: r.technician_id, technicianName: r.technician_name ?? null, servicesCount: n(r.services_count), grossSalesCents: n(r.gross_sales_cents),
      commissionType: r.commission_type, commissionValue: n(r.commission_value), commissionCents: n(r.commission_cents), retailCommissionCents: n(r.retail_commission_cents),
      cardTipCents: n(r.card_tip_cents), cashTipCents: n(r.cash_tip_cents), tipsCents: n(r.tips_cents), guaranteeTopupCents: n(r.guarantee_topup_cents),
      adjustmentCents: n(r.adjustment_cents), payableCents: n(r.payable_cents),
    }));
    const sum = (f: (l: OwnerPayrollLine) => number) => lines.reduce((a, l) => a + f(l), 0);
    const totals = {
      grossSalesCents: n(pr.total_gross_cents), commissionCents: n(pr.total_commission_cents), tipsCents: n(pr.total_tips_cents), payableCents: n(pr.total_payable_cents),
      retailCommissionCents: sum((l) => l.retailCommissionCents), cardTipCents: sum((l) => l.cardTipCents), cashTipCents: sum((l) => l.cashTipCents),
      guaranteeTopupCents: sum((l) => l.guaranteeTopupCents), adjustmentCents: sum((l) => l.adjustmentCents), technicianCount: lines.length,
    };
    return { period: this.mapPeriod(pr), totals, lines };
  }

  async ownerUserPinHash(ctx: OwnerContext): Promise<string | null> {
    const u = await this.db.selectFrom('users').select('pin_hash').where('id', '=', ctx.userId).where('tenant_id', '=', ctx.tenantId).executeTakeFirst().catch(() => undefined);
    return (u?.pin_hash as string | null) ?? null;
  }

  // ── Customers & Loyalty (read-only): aggregate analytics over canonical customer tables, branch-scoped via bScope.
  // Spend is business analytics (lifetime paid totals); no payment-instrument data is read or returned. ──
  async ownerCustomersOverview(ctx: OwnerContext, branchId: string | null, from: DateRange, prev: DateRange): Promise<OwnerCustomersOverview> {
    const cust = (extra?: (q: any) => any) => { let q: any = this.db.selectFrom('customers').where('tenant_id', '=', ctx.tenantId); if (extra) q = extra(q); return this.bScope(q, ctx, branchId); };
    const loyalty = () => this.bScope(this.db.selectFrom('customer_loyalty_profiles').where('tenant_id', '=', ctx.tenantId) as any, ctx, branchId);
    const paidTickets = () => this.bScope(this.db.selectFrom('tickets').where('tenant_id', '=', ctx.tenantId).where('status', '=', 'paid').where('customer_id', 'is not', null) as any, ctx, branchId);

    const totalP: Promise<number> = cust((q) => q.where('archived_at', 'is', null)).select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const newP: Promise<number> = cust((q) => q.where('created_at', '>=', from.fromIso as any).where('created_at', '<', from.toIso as any)).select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const loyP: Promise<any> = loyalty().select([
      sql<number>`count(*)`.as('members'), sql<number>`count(*) filter (where vip_since is not null)`.as('vip'),
      sql<number>`coalesce(sum(total_earned_points),0)`.as('issued'), sql<number>`coalesce(sum(total_redeemed_points),0)`.as('redeemed'), sql<number>`coalesce(sum(points_balance),0)`.as('outstanding'),
    ]).executeTakeFirst().catch(() => undefined);
    const tierP: Promise<any[]> = loyalty().select(['loyalty_tier as tier', sql<number>`count(*)`.as('c')]).groupBy('loyalty_tier').orderBy('c', 'desc').execute().catch(() => []);
    const giftP: Promise<any> = this.bScope(this.db.selectFrom('gift_cards').where('tenant_id', '=', ctx.tenantId) as any, ctx, branchId).select([sql<number>`coalesce(sum(balance_cents),0)`.as('bal'), sql<number>`count(*) filter (where balance_cents > 0)`.as('cnt')]).executeTakeFirst().catch(() => undefined);
    const revP: Promise<any> = this.bScope(this.db.selectFrom('reviews').where('tenant_id', '=', ctx.tenantId).where('is_hidden_by_manager', '=', false) as any, ctx, branchId).select([sql<number>`coalesce(avg(rating),0)`.as('avg'), sql<number>`count(*)`.as('cnt')]).executeTakeFirst().catch(() => undefined);
    const redeemP: Promise<number> = this.bScope(this.db.selectFrom('loyalty_redemptions as lr').innerJoin('customers as c', 'c.id', 'lr.customer_id').where('lr.tenant_id', '=', ctx.tenantId).where('lr.created_at', '>=', from.fromIso as any).where('lr.created_at', '<', from.toIso as any) as any, ctx, branchId, 'c.branch_id').select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const oneVisitP: Promise<number> = paidTickets().select(sql<number>`count(distinct customer_id)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const repeatP: Promise<number> = this.db.selectFrom(paidTickets().select('customer_id').groupBy('customer_id').having(sql`count(*)`, '>=', 2).as('x')).select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);
    const prevIdsP: Promise<any[]> = paidTickets().where('paid_at', '>=', prev.fromIso as any).where('paid_at', '<', prev.toIso as any).select('customer_id').distinct().execute().catch(() => []);
    const currIdsP: Promise<any[]> = paidTickets().where('paid_at', '>=', from.fromIso as any).where('paid_at', '<', from.toIso as any).select('customer_id').distinct().execute().catch(() => []);
    const spendersP: Promise<any[]> = this.bScope(this.db.selectFrom('tickets as t').innerJoin('customers as c', 'c.id', 't.customer_id').where('t.tenant_id', '=', ctx.tenantId).where('t.status', '=', 'paid') as any, ctx, branchId, 't.branch_id')
      .select(['t.customer_id as id', sql<string>`max(c.full_name)`.as('name'), sql<number>`coalesce(sum(t.total_cents),0)`.as('spend'), sql<number>`count(*)`.as('visits')])
      .groupBy('t.customer_id').orderBy('spend', 'desc').limit(5).execute().catch(() => []);

    const [total, newCust, loy, tiers, gift, rev, redeem, oneVisit, repeat, prevIds, currIds, spenders] = await Promise.all([totalP, newP, loyP, tierP, giftP, revP, redeemP, oneVisitP, repeatP, prevIdsP, currIdsP, spendersP]);

    const currSet = new Set((currIds as any[]).map((r) => r.customer_id));
    let retained = 0; for (const r of (prevIds as any[])) { if (currSet.has(r.customer_id)) retained++; }
    const pct1 = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

    return {
      range: { from: from.fromIso, to: from.toIso },
      kpis: {
        totalCustomers: total, newCustomers: newCust,
        retentionRatePercent: pct1(retained, (prevIds as any[]).length), repeatRatePercent: pct1(repeat, oneVisit),
        vipCustomers: n(loy?.vip), loyaltyMembers: n(loy?.members),
        giftCardOutstandingCents: n(gift?.bal), giftCardCount: n(gift?.cnt),
        reviewAverage: Math.round(Number(rev?.avg ?? 0) * 10) / 10, reviewCount: n(rev?.cnt),
      },
      loyalty: {
        pointsIssued: n(loy?.issued), pointsRedeemed: n(loy?.redeemed), pointsOutstanding: n(loy?.outstanding),
        rewardRedemptionCount: redeem,
        tiers: (tiers as any[]).map((t): OwnerLoyaltyTier => ({ tier: t.tier ?? '—', customers: n(t.c) })),
      },
      topSpenders: (spenders as any[]).map((s): OwnerTopSpender => ({ customerId: s.id, name: s.name ?? '—', lifetimeSpendCents: n(s.spend), visits: n(s.visits) })),
      generatedAt: new Date().toISOString(),
    };
  }

  // Gift-card liability & activity. Outstanding = current remaining balances (branch-scoped like the customers-overview
  // metric). Issued/redeemed = period value movements from the ledger (issue+activate in; redeem out), joined to
  // gift_cards for branch scope. Decision-independent of the parked revenue-recognition question.
  async ownerGiftCardReport(ctx: OwnerContext, branchId: string | null, from: DateRange): Promise<OwnerGiftCardReport> {
    const stateQ = this.bScope(this.db.selectFrom('gift_cards').where('tenant_id', '=', ctx.tenantId) as any, ctx, branchId)
      .select([
        sql<number>`coalesce(sum(balance_cents),0)`.as('bal'),
        sql<number>`count(*) filter (where balance_cents > 0 and status in ('active','partially_redeemed'))`.as('active'),
        sql<number>`count(*)`.as('total'),
      ]);
    const actQ = this.bScope(
      this.db.selectFrom('gift_card_transactions as t').innerJoin('gift_cards as g', 'g.id', 't.gift_card_id')
        .where('t.tenant_id', '=', ctx.tenantId).where('t.created_at', '>=', from.fromIso as any).where('t.created_at', '<', from.toIso as any) as any,
      ctx, branchId, 'g.branch_id')
      .select([
        sql<number>`coalesce(sum(t.amount_cents) filter (where t.type in ('issue','activate')),0)`.as('iss'),
        sql<number>`count(*) filter (where t.type in ('issue','activate'))`.as('isscnt'),
        sql<number>`coalesce(sum(t.amount_cents) filter (where t.type = 'redeem'),0)`.as('red'),
        sql<number>`count(*) filter (where t.type = 'redeem')`.as('redcnt'),
      ]);
    const [st, act] = await Promise.all([stateQ.executeTakeFirst().catch(() => undefined), actQ.executeTakeFirst().catch(() => undefined)]);
    return {
      range: { from: from.fromIso, to: from.toIso },
      outstandingCents: n((st as any)?.bal), activeCount: n((st as any)?.active), totalCards: n((st as any)?.total),
      issuedCents: n((act as any)?.iss), issuedCount: n((act as any)?.isscnt),
      redeemedCents: n((act as any)?.red), redeemedCount: n((act as any)?.redcnt),
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Inventory & Products (read-only): aggregate over the canonical inventory tables (raw SQL — these tables are not in
  // the Kysely type map). Status is computed by REUSING inventory-core's stockStatus/reorderSuggestion (no duplicated
  // threshold logic). Branch scope is applied to the per-branch stock rows; cost/retail valuation is summed but only
  // surfaced to finance-permitted owners (the service nulls it otherwise). ──
  async ownerInventoryOverview(ctx: OwnerContext, branchIds: string[] | null): Promise<OwnerInventoryOverview> {
    const db = this.db;
    const branchFilter = branchIds === null ? sql`` : sql`AND s.branch_id = ANY(${branchIds})`;
    const rowsRes: any = await sql<any>`
      SELECT p.id AS product_id, p.name, p.cost_cents, p.retail_price_cents, p.reorder_level, p.critical_level, p.maximum_stock, p.reorder_quantity,
             c.name AS category_name, s.branch_id, br.name AS branch_name, s.quantity_on_hand
      FROM inventory_products p
      JOIN inventory_location_stock s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
      LEFT JOIN inventory_categories c ON c.id = p.category_id
      LEFT JOIN branches br ON br.id = s.branch_id
      WHERE p.tenant_id = ${ctx.tenantId} AND p.archived_at IS NULL ${branchFilter}
    `.execute(db).catch(() => ({ rows: [] as any[] }));
    const rows: any[] = rowsRes.rows ?? [];

    const [prodCnt, brandCnt, vendorCnt, catCnt] = await Promise.all([
      sql<any>`SELECT count(*)::int AS c FROM inventory_products WHERE tenant_id = ${ctx.tenantId} AND archived_at IS NULL`.execute(db).then((r: any) => n(r.rows[0]?.c)).catch(() => 0),
      sql<any>`SELECT count(*)::int AS c FROM inventory_brands WHERE tenant_id = ${ctx.tenantId} AND active = true`.execute(db).then((r: any) => n(r.rows[0]?.c)).catch(() => 0),
      sql<any>`SELECT count(*)::int AS c FROM inventory_vendors WHERE tenant_id = ${ctx.tenantId} AND active = true`.execute(db).then((r: any) => n(r.rows[0]?.c)).catch(() => 0),
      sql<any>`SELECT count(*)::int AS c FROM inventory_categories WHERE tenant_id = ${ctx.tenantId} AND active = true`.execute(db).then((r: any) => n(r.rows[0]?.c)).catch(() => 0),
    ]);

    const counts = { inStock: 0, low: 0, critical: 0, outOfStock: 0, overstock: 0 };
    let stockValue = 0, retailValue = 0;
    const catMap = new Map<string, { products: Set<string>; value: number }>();
    const reorder: OwnerInventoryReorderItem[] = [];
    for (const r of rows) {
      const onHand = n(r.quantity_on_hand);
      const st = stockStatus(onHand, n(r.reorder_level), r.maximum_stock ?? null, r.critical_level ?? null);
      if (st === 'in_stock') counts.inStock++; else if (st === 'low') counts.low++; else if (st === 'critical') counts.critical++; else if (st === 'out_of_stock') counts.outOfStock++; else if (st === 'overstock') counts.overstock++;
      const cost = n(r.cost_cents) * onHand;
      stockValue += cost; retailValue += n(r.retail_price_cents) * onHand;
      const cat = r.category_name ?? 'Uncategorized';
      let cm = catMap.get(cat); if (!cm) { cm = { products: new Set(), value: 0 }; catMap.set(cat, cm); }
      cm.products.add(r.product_id); cm.value += cost;
      if (st === 'low' || st === 'critical' || st === 'out_of_stock') {
        reorder.push({ productId: r.product_id, name: r.name ?? '—', branchId: r.branch_id ?? null, branchName: r.branch_name ?? '—', onHand, reorderLevel: n(r.reorder_level), status: st, suggestedQty: reorderSuggestion(onHand, n(r.reorder_level), n(r.reorder_quantity)) });
      }
    }
    const rank: Record<string, number> = { out_of_stock: 0, critical: 1, low: 2 };
    reorder.sort((a, b) => (rank[a.status] - rank[b.status]) || (a.onHand - b.onHand));
    const topCategories: OwnerInventoryCategory[] = [...catMap.entries()].map(([category, v]) => ({ category, products: v.products.size, stockValueCents: v.value as number | null })).sort((a, b) => (Number(b.stockValueCents) || 0) - (Number(a.stockValueCents) || 0)).slice(0, 5);

    return {
      totalProducts: prodCnt, stockPositions: rows.length,
      statusCounts: counts, needsReorderCount: counts.low + counts.critical + counts.outOfStock,
      stockValueCents: stockValue, retailValueCents: retailValue,
      brandsCount: brandCnt, vendorsCount: vendorCnt, categoriesCount: catCnt,
      topCategories, reorderList: reorder.slice(0, 8),
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Marketing & Growth (read-only): aggregate over canonical campaigns, REUSING the campaigns module's deriveKpis /
  // deriveMetrics (no duplicated marketing math). Branch-scoped views also include tenant-wide (null-branch) campaigns,
  // which apply to every branch. Referrals are counted (codes) — there is no conversion schema, so none is fabricated. ──
  async ownerMarketingOverview(ctx: OwnerContext, branchIds: string[] | null): Promise<OwnerMarketingOverview> {
    let cq: any = this.db.selectFrom('campaigns').selectAll().where('tenant_id', '=', ctx.tenantId);
    if (branchIds !== null) cq = cq.where((eb: any) => eb.or([eb('branch_id', 'in', branchIds), eb('branch_id', 'is', null)]));
    const raw: any[] = await cq.execute().catch(() => []);
    const rows: CampaignRow[] = raw.map((r) => ({
      id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, name: r.name, offer: r.offer ?? null,
      channel: r.channel, audienceLabel: r.audience_label ?? null, audienceSize: n(r.audience_size), status: r.status,
      scheduledAt: this.oisoN(r.scheduled_at), sentCount: n(r.sent_count), openCount: n(r.open_count), clickCount: n(r.click_count),
      replyCount: n(r.reply_count), bookingCount: n(r.booking_count), revenueCents: n(r.revenue_cents), costCents: n(r.cost_cents),
      createdAt: this.oiso(r.created_at), updatedAt: this.oiso(r.updated_at),
    }) as CampaignRow);

    const k = deriveCampaignKpis(rows);
    const clickSum = rows.reduce((a, r) => a + r.clickCount, 0);
    const bookingSum = rows.reduce((a, r) => a + r.bookingCount, 0);
    const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

    // channel breakdown
    const chMap = new Map<string, { campaigns: number; sent: number; revenue: number }>();
    for (const r of rows) {
      let c = chMap.get(r.channel); if (!c) { c = { campaigns: 0, sent: 0, revenue: 0 }; chMap.set(r.channel, c); }
      c.campaigns++; c.sent += r.sentCount; c.revenue += r.revenueCents;
    }
    const channels: OwnerMarketingChannel[] = [...chMap.entries()].map(([channel, v]) => ({ channel, campaigns: v.campaigns, sent: v.sent, revenueCents: v.revenue })).sort((a, b) => b.revenueCents - a.revenueCents);

    // top campaigns by revenue (metrics derived via the canonical helper)
    const topCampaigns: OwnerMarketingCampaign[] = rows.map((r) => deriveCampaignMetrics(r))
      .sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 6)
      .map((r) => ({ id: r.id, name: r.name, channel: r.channel, status: r.status, audienceLabel: r.audienceLabel, sent: r.sentCount, openRate: r.openRate ?? 0, clickRate: r.clickRate ?? 0, bookingRate: r.bookingRate ?? 0, revenueCents: r.revenueCents, costCents: r.costCents, roi: r.roi ?? 0, scheduledAt: r.scheduledAt }));

    // referrals (codes) — branch-scoped via the owning customer when a subset is in effect
    let refQ: any = this.db.selectFrom('customer_referrals as cr').where('cr.tenant_id', '=', ctx.tenantId);
    if (branchIds !== null) refQ = refQ.innerJoin('customers as c', 'c.id', 'cr.customer_id').where('c.branch_id', 'in', branchIds);
    const referrals = await refQ.select(sql<number>`count(*)`.as('c')).executeTakeFirst().then((r: any) => n(r?.c)).catch(() => 0);

    return {
      kpis: {
        activeCampaigns: k.activeCampaigns, totalCampaigns: k.totalCampaigns, totalSent: k.totalSent,
        openRatePercent: k.avgOpenRate, clickRatePercent: rate(clickSum, k.totalSent), conversionRatePercent: rate(bookingSum, k.totalSent),
        campaignRevenueCents: k.campaignRevenueCents, campaignCostCents: k.totalCostCents, roi: k.avgRoi, referrals,
      },
      channels, topCampaigns, generatedAt: new Date().toISOString(),
    };
  }

  // ── Payments & Money (read-only): payment-level oversight over canonical payments / payment_refunds, branch-scoped.
  // Uses the same PAID status set as the payment-mix roll-up. Rows carry no card/PAN data — only method, a short gateway
  // reference, and amounts — so nothing sensitive is exposed. ──
  async ownerPaymentsOverview(ctx: OwnerContext, branchId: string | null, from: DateRange): Promise<OwnerPaymentsOverview> {
    const PAID = ['completed', 'paid', 'captured', 'approved', 'settled', 'succeeded'];
    const inPeriod = (q: any, col: string) => q.where(col, '>=', from.fromIso as any).where(col, '<', from.toIso as any);
    const shortRef = (v: any): string | null => (v ? '•••' + String(v).slice(-4) : null);
    const idRef = (v: any): string | null => (v ? '#' + String(v).slice(0, 8) : null);

    const sumP: any = this.bScope(inPeriod(this.db.selectFrom('payments').where('tenant_id', '=', ctx.tenantId).where('status', 'in', PAID), 'created_at') as any, ctx, branchId)
      .select([sql<number>`coalesce(sum(amount_cents),0)`.as('gross'), sql<number>`coalesce(sum(tip_cents),0)`.as('tips'), sql<number>`count(*)`.as('c')]).executeTakeFirst().catch(() => undefined);
    const refSumP: any = this.bScope(inPeriod(this.db.selectFrom('payment_refunds').where('tenant_id', '=', ctx.tenantId), 'created_at') as any, ctx, branchId)
      .select([sql<number>`coalesce(sum(amount_cents),0)`.as('amt'), sql<number>`count(*)`.as('c')]).executeTakeFirst().catch(() => undefined);
    const byMethodP = this.paymentMix(ctx, branchId, from).catch(() => []);
    const txnP: Promise<any[]> = this.bScope(inPeriod(this.db.selectFrom('payments').where('tenant_id', '=', ctx.tenantId), 'created_at') as any, ctx, branchId)
      .select(['id', 'amount_cents', 'tip_cents', 'method', 'status', 'ticket_id', 'processor_transaction_id', 'created_at']).orderBy('created_at', 'desc').limit(40).execute().catch(() => []);
    const refListP: Promise<any[]> = this.bScope(inPeriod(this.db.selectFrom('payment_refunds').where('tenant_id', '=', ctx.tenantId), 'created_at') as any, ctx, branchId)
      .select(['id', 'amount_cents', 'reason', 'status', 'payment_id', 'created_at']).orderBy('created_at', 'desc').limit(20).execute().catch(() => []);

    const [sum, refSum, byMethod, txns, refs] = await Promise.all([sumP, refSumP, byMethodP, txnP, refListP]);
    const gross = n(sum?.gross); const refunds = n(refSum?.amt);

    return {
      range: { from: from.fromIso, to: from.toIso },
      summary: { grossCents: gross, tipsCents: n(sum?.tips), refundsCents: refunds, netCents: gross - refunds, transactionCount: n(sum?.c), refundCount: n(refSum?.c), byMethod },
      transactions: (txns as any[]).map((t): OwnerPaymentTxn => ({ id: t.id, amountCents: n(t.amount_cents), tipCents: n(t.tip_cents), method: t.method || 'other', status: t.status, ticketRef: idRef(t.ticket_id), processorRef: shortRef(t.processor_transaction_id), at: this.oiso(t.created_at) })),
      refunds: (refs as any[]).map((r): OwnerPaymentRefund => ({ id: r.id, amountCents: n(r.amount_cents), reason: r.reason ?? null, status: r.status, paymentRef: idRef(r.payment_id), at: this.oiso(r.created_at) })),
      generatedAt: new Date().toISOString(),
    };
  }
}
