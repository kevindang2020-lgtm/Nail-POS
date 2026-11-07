/**
 * tech.service.ts — Technician-mobile orchestration & authorization.
 *
 * Why this exists separately from the POS services: the TECHNICIAN role intentionally lacks the fine-grained
 * permissions the POS services enforce (e.g. pos.serving.start), so this service authorizes tech actions itself —
 * specifically, a technician may only act on a ticket assigned to THEM — and applies the same state guards the POS
 * flow uses, then delegates persistence to the injected TechDataPort. Dashboard/earnings reads compose the pure
 * tech-dashboard.core assembler. All logic here is unit-tested against a fake port.
 */
import { resolveEarningsWindow, technicianEarningsSummary, ticketEarningsReceipt, type TechEarningsSummary, type TechTicketReceipt, type EarningsSnapshotRow, type SnapshotSums } from '@aipowersalon/workforce';
import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import type { TechDashboardState, TechEarningsSnapshot, TechnicianStatus, TechScheduleItem, EarningsPeriod } from './tech-dashboard.dto';
import { salesOnlySnapshot } from './tech-dashboard.dto';
export interface CompensationEarningsPort {
  sumByTechnicianPeriod(tenantId: string, technicianId: string, fromIso: string, toIso: string): Promise<SnapshotSums>;
  getByTicketForTechnician(tenantId: string, ticketId: string, technicianId: string): Promise<EarningsSnapshotRow[]>;
  /** merge Oct 12 2026 (PAY): the tenant/branch IANA zone for the earnings window, the payroll row behind pay_period, and
   *  per-line detail — all optional (fakes / older adapters fall back to UTC, no pay_period, no lines). */
  tenantTimezone?(tenantId: string, branchId?: string | null): Promise<string>;
  payrollPeriod?(tenantId: string, periodId: string): Promise<{ id: string; periodStart: string; periodEnd: string; status: string } | null>;
  linesByTechnicianPeriod?(tenantId: string, technicianId: string, fromIso: string, toIso: string): Promise<{ serviceName: string; lineTotalCents: number; commissionCents: number; completedAt: string; ticketId: string; ruleSource: string | null }[]>;
}
import { buildTechDashboardState } from './tech-dashboard.core';
import { TimeClockValidationError, TimeClockForbiddenError, TECH_METRIC_PERIODS, type TechMetricPeriod } from '@aipowersalon/workforce';
import type { TechContext, TechDataPort, TechTicketView, ServiceDoneBody, TechTicketListItem, TechQueueState, TechMoreState, NoteBody, CancelRequestBody, DeclineBody, TechAuditAction, AuditMeta, TechWorkingHoursDay, TechSkillsView, SkillChangeBody, SkillChangeRequest, PendingSkillChangeRequest, TechPayrollView, SkillReviewDecision } from './tech.repository';
import { SKILL_REVIEW_DECISIONS } from './tech.repository';

/** Narrow bridge into ServingService so the canonical service-line writer stays the single write path. */
export interface TechServingBridge {
  techAddOnSuggestions(ctx: any, ticketId: string): Promise<{ serviceId: string; serviceName: string; priceCents: number; source: string }[]>;
  techAddAddOn(ctx: any, ticketId: string, serviceId: string, technicianId: string): Promise<{ ok: true; serviceName: string; priceCents: number; serviceLineId?: string }>;
  techEditOptions(ctx: any, ticketId: string): Promise<unknown>;
  techAddService(ctx: any, ticketId: string, body: { serviceId: string; notes?: string }, technicianId: string): Promise<unknown>;
  techPatchLine(ctx: any, ticketId: string, lineId: string, patch: { notes?: string; status?: string }, technicianId: string): Promise<unknown>;
  techChangeService(ctx: any, ticketId: string, lineId: string, newServiceId: string, reason: string | undefined, technicianId: string): Promise<unknown>;
  techRemoveLine(ctx: any, ticketId: string, lineId: string, reason: string | undefined, technicianId: string): Promise<unknown>;
  techListChangeRequests(ctx: any, ticketId: string): Promise<unknown[]>;
  techWorkflowSettings(ctx: any): Promise<unknown>;
}

import { TechError, type TechErrorCode } from './tech-errors';
import { permissionsFor, type Role } from '@aipowersalon/permissions';
import { TechnicianEligibilityError, type TechnicianEligibilityService } from '@aipowersalon/workforce';
export { TechError, type TechErrorCode };

/** What the Technician App needs from the workforce time clock (TimeClockService satisfies it). */
export interface TechTimeClockPort {
  getState(ctx: { tenantId: string; branchId?: string; userId: string; role: string; permissions: string[] }): Promise<{ technicians: { technicianId: string; state: string; clockedInAt: string | null; lastClockOutAt: string | null; hoursToday: number }[] }>;
  /** Idempotent (one open punch): `created: false` when the technician was already clocked in. */
  clockIn(ctx: { tenantId: string; branchId?: string; userId: string; role: string; permissions: string[] }, technicianId: string): Promise<{ state: string; clockedInAt: string | null; lastClockOutAt: string | null; hoursToday: number; created?: boolean }>;
  clockOut(ctx: { tenantId: string; branchId?: string; userId: string; role: string; permissions: string[] }, technicianId: string): Promise<{ state: string; clockedInAt: string | null; lastClockOutAt: string | null; hoursToday: number }>;
}
import type { TechClockView } from '@aipowersalon/api-contracts/tenant';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English
export type { TechClockView };

/** Payroll wave 2: the technician's own payroll reads + questions (modules/workforce PayrollSelfService). */
export interface TechPayrollSelfPort {
  paidByPeriod(tenantId: string, technicianId: string): Promise<Map<string, number>>;
  payouts(tenantId: string, technicianId: string): Promise<unknown[]>;
  inquiries(tenantId: string, technicianId: string): Promise<unknown[]>;
  createInquiry(tenantId: string, branchId: string | null, technicianId: string, userId: string | null, b: { message: string; periodId?: string | null; subjectType?: string | null; subjectId?: string | null }): Promise<unknown>;
}

/** Weekly Paycheck mandate (Oct 21 2026, §15): the technician's own pay statements and cash confirmations
 *  (modules/workforce PayrollPaycheckService, bound by TechModule). The technician is resolved from the SESSION. */
export interface TechPaycheckPort {
  myPayroll(ctx: { tenantId: string; userId?: string | null }, technicianId: string): Promise<unknown>;
  myStatement(ctx: { tenantId: string; userId?: string | null }, technicianId: string, statementId: string): Promise<unknown>;
  /** 17.5: the approved statement's pay stub (PDF bytes + file name) */
  myPayStub(ctx: { tenantId: string; userId?: string | null }, technicianId: string, statementId: string, opts?: { lang?: string | null }): Promise<{ filename: string; contentType: string; buffer: Buffer }>;
  acknowledgeCashByTechnician(ctx: { tenantId: string; userId?: string | null }, technicianId: string, payoutId: string, b?: { handoffCode?: string | null }): Promise<unknown>;
  disputeCash(ctx: { tenantId: string; userId?: string | null }, technicianId: string, payoutId: string, b: { reason: string }): Promise<unknown>;
}

export class TechService {
  /** bound by TechModule when the database is present */
  paychecks: TechPaycheckPort | null = null;
  // emitter is OPTIONAL so unit tests can construct the service with just a fake port; the module injects the real bus.
  constructor(private readonly repo: TechDataPort, private readonly realtime?: RealtimeEmitter, private readonly serving?: TechServingBridge, private readonly compReads?: CompensationEarningsPort, private readonly timeClock?: TechTimeClockPort, private readonly eligibility?: TechnicianEligibilityService | null,
              private readonly payrollSelf?: TechPayrollSelfPort | null) {}

  /** THE eligibility function (modules/workforce eligibility, Oct 12 2026 merge) applied to the technician's OWN accept /
   *  start: active, this branch, approved for every catalog service on the ticket, certification valid; on a fresh start
   *  no live service ELSEWHERE (`requireNotServing` — fix Oct 12 2026: NOT `requireAssignable`, which asks "may she take
   *  ANOTHER guest" and refused a technician who was not clocked in or already held this very ticket; neither was ever
   *  a refusal of her own start). No client override exists on the tech app. Skipped when the module is not bound. */
  private async assertEligible(ctx: TechContext, technicianId: string, t: TechTicketView, requireNotServing: boolean): Promise<void> {
    if (!this.eligibility) return;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const serviceIds = (t.services || []).map((l) => String(l.serviceId || '')).filter((id) => UUID.test(id));
    try {
      await this.eligibility.assert({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId, serviceIds, requireNotServing, actor: { userId: ctx.userId, role: String(ctx.role || 'TECHNICIAN'), permissions: ctx.permissions } });
    } catch (e: any) {
      if (e instanceof TechnicianEligibilityError) {
        await this.auditSafe(ctx, technicianId, 'technician_eligibility_refused', { ticketId: t.ticketId, data: { code: e.code, ...e.details } });
        throw new TechError(e.code === 'TECHNICIAN_ALREADY_SERVING' || e.code === 'SCHEDULE_CONFLICT' ? 'conflict' : e.code === 'TECHNICIAN_BRANCH_ACCESS_DENIED' ? 'forbidden' : 'invalid_state', e.message);
      }
      throw e;
    }
  }

  /** Adapt the tech context for serving-layer reads/writes (tenant/branch scoping preserved). */
  private sctx(ctx: TechContext) { return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role || 'TECHNICIAN', permissions: [] as string[] }; }

  // Publish a tech-initiated change to BOTH the branch room (so POS / customer / queue screens update) and the
  // technician's own room (so the tech app's other screens update). No-op when no emitter is wired.
  private publish(ctx: TechContext, technicianId: string, event: typeof EVENTS[keyof typeof EVENTS], customerId?: string | null): void {
    try {
      if (this.repo.emitsDomainEvents?.()) return;   // §343: the repository recorded the fact; the projection broadcasts to branch, technician and customer
      this.realtime?.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId }, event);
      this.realtime?.toTechnician(technicianId, event);
      if (customerId && this.realtime?.toCustomer) {
        this.realtime.toCustomer(customerId, event);
      }
    } catch { /* a broken bus must not break the action */ }
  }

  // Granular permission gate (§23). FAILS CLOSED (Oct 12 2026 merge, workforce audit P0 #3): the required tech.* key must
  // be present. A session that predates these keys (legacy token, no tech.* key at all) does NOT pass for free any more —
  // its effective permissions are re-derived from the ROLE DEFAULTS (permissionsFor), which is exactly what a fresh login
  // would have minted. A token that carries tech.* keys is enforced per-key (a salon's revocation of one key holds).
  private effectivePermissions(ctx: TechContext): string[] {
    const perms = ctx.permissions || [];
    if (perms.some((p) => p.startsWith('tech.'))) return perms;
    const role = String(ctx.role || '') as Role;
    return role ? (permissionsFor(role) as string[]) : [];
  }
  private require(ctx: TechContext, key: string): void {
    if (this.effectivePermissions(ctx).includes(key)) return;
    throw withCode(new TechError('forbidden', `You don't have permission for this action (${key}).`), 'PERMISSION_DENIED');
  }
  // Manager/owner gate for approving technicians' skill-change requests and closing help messages. 'technicians.edit' is
  // held by MANAGER/OWNER (not TECHNICIAN), so a technician can never decide their own request. Not a tech.* key, so no
  // stale-token issue. The explicit role check (P0 #13) closes the door on a TECHNICIAN token that was ever handed the
  // key by a per-salon override.
  private requireManager(ctx: TechContext): void {
    if (!this.isManager(ctx)) throw withCode(new TechError('forbidden', 'This action requires manager permission.'), 'MANAGER_OVERRIDE_REQUIRED');
  }
  private isManager(ctx: TechContext): boolean {
    const role = String(ctx.role || '').toUpperCase();
    return role !== 'TECHNICIAN' && !!ctx.permissions && ctx.permissions.includes('technicians.edit');
  }
  private async auditSafe(ctx: TechContext, technicianId: string, action: TechAuditAction, meta?: AuditMeta): Promise<void> {
    try { await this.repo.recordAudit(ctx, technicianId, action, meta); } catch { /* a logging failure must never break the action */ }
  }
  // Tips attributed to this technician over a range (explicit allocation, else proportional). Guarded so a tips-query
  // failure degrades to 0 rather than breaking the dashboard/earnings read.
  private async requireTechnician(ctx: TechContext): Promise<string> {
    if (!(await this.repo.technicianAppEnabled(ctx))) throw withCode(new TechError('forbidden', 'The Technician App is not enabled for this salon.'), 'TECH_APP_NOT_ENABLED');
    const id = await this.repo.resolveTechnicianId(ctx);
    if (!id) throw withCode(new TechError('not_technician', 'No technician profile is linked to this account.'), 'NO_TECHNICIAN_PROFILE');
    // Per-technician switch (technician_app_settings.app_enabled) — a manager can turn the app off for ONE technician.
    // It was stored and never read (Oct 12 2026 merge, workforce audit P0 #3). Absent row = enabled (the column default).
    if (this.repo.technicianAppAccessEnabled && !(await this.repo.technicianAppAccessEnabled(ctx, id))) {
      throw withCode(new TechError('forbidden', 'The Technician App has been turned off for your account. Please see a manager.'), 'TECH_APP_TURNED_OFF');
    }
    return id;
  }

  private async ownedTicket(ctx: TechContext, technicianId: string, ticketId: string): Promise<TechTicketView> {
    const t = await this.repo.getTicket(ctx, ticketId);
    if (!t) throw withCode(new TechError('not_found', 'Ticket not found.'), 'TICKET_NOT_FOUND');
    if (t.technicianId !== technicianId) throw withCode(new TechError('forbidden', 'This ticket is not assigned to you.'), 'TICKET_NOT_ASSIGNED_TO_YOU');
    return t;
  }

  /** The REAL ticket behind one of the caller's queue tickets — refused (403 "not assigned to you") for anyone else's.
   *  Constitution 5 Step 8 audit (Oct 4 2026): the membership panel looked the customer up straight from the id it was
   *  given, with no assignment check (any technician could read any ticket's customer membership by its real ticket id),
   *  and the tech app passes the QUEUE ticket id, which never matches a real ticket — so the panel always said "no
   *  membership". Resolving through ownedTicket fixes both. */
  async ownedRealTicketId(ctx: TechContext, ticketId: string): Promise<string | null> {
    const t = await this.ownedTicket(ctx, await this.requireTechnician(ctx), ticketId);
    return t.realTicketId ?? null;
  }

  async getTicketDetail(ctx: TechContext, ticketId: string): Promise<TechTicketView> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.view');
    const t = await this.ownedTicket(ctx, technicianId, ticketId);
    if (t.status === 'serving' && this.serving && t.realTicketId) {
      t.addOnSuggestions = await this.serving.techAddOnSuggestions(this.sctx(ctx), t.realTicketId).catch(() => []);
    }
    await this.auditSafe(ctx, technicianId, 'technician_ticket_viewed', { ticketId });
    return t;
  }

  /** Tech Live Ticket Edit (build doc §5–§10). Ownership + tech.ticket.edit_lines enforced here; the §6 status gate
   *  (verbatim locked message), §7 approval matrix, single line-writer, and §12 events all live in ServingService. */
  private bridge(): TechServingBridge { if (!this.serving) throw withCode(new TechError('invalid_state', 'Live ticket editing is not available in this deployment.'), 'FEATURE_NOT_AVAILABLE'); return this.serving; }

  /** The Tech App addresses tickets by their tech-queue projection id (pos_tech_queue_tickets.id), but the shared
   *  serving bridge is keyed on the real tickets.id. Translate before crossing that boundary so line writes + recalc
   *  hit the actual ticket. Throws if no priced ticket exists yet (nothing to edit). */
  private servingTicketId(view: TechTicketView): string {
    if (!view.realTicketId) throw withCode(new TechError('invalid_state', 'This ticket has no active service to edit yet.'), 'NO_ACTIVE_SERVICE');
    return view.realTicketId;
  }

  async editOptions(ctx: TechContext, ticketId: string) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.view');
    const owned = await this.ownedTicket(ctx, technicianId, ticketId);
    return this.bridge().techEditOptions(this.sctx(ctx), this.servingTicketId(owned));
  }

  async addServiceLine(ctx: TechContext, ticketId: string, body: { serviceId: string; notes?: string }) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.edit_lines');
    const owned = await this.ownedTicket(ctx, technicianId, ticketId);
    const out = await this.bridge().techAddService(this.sctx(ctx), this.servingTicketId(owned), { serviceId: String(body?.serviceId ?? ''), notes: body?.notes }, technicianId);
    await this.auditSafe(ctx, technicianId, 'technician_service_added', { ticketId, serviceId: String(body?.serviceId ?? '') });
    return out;
  }

  async patchServiceLine(ctx: TechContext, ticketId: string, lineId: string, patch: { notes?: string; status?: string }) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.edit_lines');
    const owned = await this.ownedTicket(ctx, technicianId, ticketId);
    return this.bridge().techPatchLine(this.sctx(ctx), this.servingTicketId(owned), lineId, patch || {}, technicianId);
  }

  async changeServiceLine(ctx: TechContext, ticketId: string, lineId: string, newServiceId: string, reason?: string) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.edit_lines');
    const owned = await this.ownedTicket(ctx, technicianId, ticketId);
    return this.bridge().techChangeService(this.sctx(ctx), this.servingTicketId(owned), lineId, String(newServiceId ?? ''), reason, technicianId);
  }

  async removeServiceLine(ctx: TechContext, ticketId: string, lineId: string, reason?: string) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.edit_lines');
    const owned = await this.ownedTicket(ctx, technicianId, ticketId);
    return this.bridge().techRemoveLine(this.sctx(ctx), this.servingTicketId(owned), lineId, reason, technicianId);
  }

  async notifications(ctx: TechContext) {
    const technicianId = await this.requireTechnician(ctx);
    const items = await this.repo.listNotifications(ctx, technicianId);
    return { items, unread: items.filter((n) => !n.readAt).length };
  }

  async markNotificationsRead(ctx: TechContext, ids: string[] | 'all') {
    const technicianId = await this.requireTechnician(ctx);
    const marked = await this.repo.markNotificationsRead(ctx, technicianId, ids);
    return { ok: true as const, marked };
  }

  /** Settings screen: the salon's tech-app capability set (read-only — controlled by the salon + Super Admin). */
  async settings(ctx: TechContext) {
    await this.requireTechnician(ctx);
    return this.bridge().techWorkflowSettings(this.sctx(ctx));
  }

  async listChangeRequests(ctx: TechContext, ticketId: string) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.view');
    const owned = await this.ownedTicket(ctx, technicianId, ticketId);
    return this.bridge().techListChangeRequests(this.sctx(ctx), this.servingTicketId(owned));
  }

  /** Poster screen 4 "+ Add" on an add-on suggestion. Ownership + in-service + tech.ticket.add_addon enforced here;
   *  the salon-level allowServiceEditDuringServing gate and the Add-on-only restriction live in ServingService. */
  async addAddOn(ctx: TechContext, ticketId: string, serviceId: string) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.add_addon');
    const t = await this.ownedTicket(ctx, technicianId, ticketId);
    if (t.status !== 'serving') throw withCode(new TechError('invalid_state', 'Add-ons can only be added while the service is in progress.'), 'ADDONS_ONLY_IN_SERVICE');
    if (!this.serving) throw withCode(new TechError('invalid_state', 'Adding add-ons is not available in this deployment.'), 'FEATURE_NOT_AVAILABLE');
    const out = await this.serving.techAddAddOn(this.sctx(ctx), this.servingTicketId(t), String(serviceId), technicianId);
    await this.auditSafe(ctx, technicianId, 'technician_addon_added', { ticketId, serviceId });
    return out;
  }

  /** Oct 13 2026 (FLOW, duplicate D1 merged): today's money on the Tech App — dashboard tile AND /tech/earnings — comes
   *  from the compensation snapshot (the ONE payroll authority: discount allocation, authored rules, posted reversals,
   *  allocated tips) over the SALON-zone day. ONE-PAY (Oct 13 2026): there is NO fallback — the per-line "price × stamped
   *  rate" estimate is gone; without the snapshot (no DB / a failed read) commission and tips are null + a note, so the
   *  three Tech App reads and the payroll line can never disagree. Null ⇒ the authority could not be read. */
  private async todayFromSnapshot(ctx: TechContext, technicianId: string, nowMs?: number): Promise<TechEarningsSnapshot | null> {
    if (!this.compReads) return null;
    try {
      const tz = this.compReads.tenantTimezone ? await this.compReads.tenantTimezone(ctx.tenantId, ctx.branchId ?? null).catch(() => 'UTC') : 'UTC';
      const w = resolveEarningsWindow({ period: 'day', timezone: tz, nowMs });
      const sums = await this.compReads.sumByTechnicianPeriod(ctx.tenantId, technicianId, w.fromIso, w.toIso);
      const sum = technicianEarningsSummary(sums);
      return {
        todaySalesCents: Math.max(0, Math.round(Number(sums.grossServiceCents ?? 0))),
        tipsCents: sum.tipsCents,
        estimatedCommissionCents: sum.serviceCommissionCents + sum.retailCommissionCents + (sum.adjustmentsCents ?? 0),
      };
    } catch { return null; }
  }

  async getDashboard(ctx: TechContext, nowMs?: number): Promise<TechDashboardState> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.dashboard.view');
    const raw = await this.repo.dashboardRaw(ctx, technicianId, nowMs);
    const state = buildTechDashboardState({ ...raw, nowMs });
    const authority = await this.todayFromSnapshot(ctx, technicianId, nowMs);
    if (authority) state.earnings = authority;   // else: sales from the lines, commission + tips null + note (never estimated)
    return state;
  }

  /** F5 §73 (Nov 6 2026): the signed-in technician's Today / Week / Month metrics — their own only */
  async getMetrics(ctx: TechContext, period: unknown) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.earnings.view');
    const p = (TECH_METRIC_PERIODS as readonly string[]).includes(String(period)) ? String(period) as TechMetricPeriod : 'today';
    if (!this.repo.techMetrics) throw withCode(new TechError('invalid_state', 'This is temporarily unavailable. Please try again shortly.'), 'SERVICE_UNAVAILABLE');
    return this.repo.techMetrics(ctx, technicianId, p);
  }
  async getEarnings(ctx: TechContext): Promise<TechEarningsSnapshot> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.earnings.view');
    const authority = await this.todayFromSnapshot(ctx, technicianId);
    if (authority) return authority;
    const raw = await this.repo.dashboardRaw(ctx, technicianId);
    return salesOnlySnapshot(raw.todayLines);
  }

  async getPayroll(ctx: TechContext): Promise<TechPayrollView> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    const view = await this.repo.myPayroll(ctx, technicianId);
    if (!this.payrollSelf) return view;
    // Payroll wave 2 (§78/§89): PAID is what was actually paid out (recorded payouts), not "the period is marked paid" —
    // a partly-paid approved period shows its paid part and its outstanding part
    const paid = await this.payrollSelf.paidByPeriod(ctx.tenantId, technicianId);
    let paidCents = 0, unpaidCents = 0;
    const periods = view.periods.map((p) => { const pc = Math.min(p.payableCents, paid.get(p.periodId) ?? 0); paidCents += pc; unpaidCents += Math.max(0, p.payableCents - pc); return { ...p, paidCents: pc, outstandingCents: Math.max(0, p.payableCents - pc) }; });
    return { ...view, periods, paidCents, unpaidCents, totalCents: paidCents + unpaidCents };
  }

  /** §89 the technician's own payout history. */
  async getPayouts(ctx: TechContext) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    return this.payrollSelf ? this.payrollSelf.payouts(ctx.tenantId, technicianId) : [];
  }
  /** §152 the technician's own questions about her earnings (never another technician's). */
  async getPayrollInquiries(ctx: TechContext) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    return this.payrollSelf ? this.payrollSelf.inquiries(ctx.tenantId, technicianId) : [];
  }
  async createPayrollInquiry(ctx: TechContext, body: { message: string; periodId?: string | null; subjectType?: string | null; subjectId?: string | null }) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    if (!this.payrollSelf) throw withCode(new TechError('invalid_state', 'Payroll questions are not available right now.'), 'FEATURE_NOT_AVAILABLE');
    try { return await this.payrollSelf.createInquiry(ctx.tenantId, ctx.branchId || null, technicianId, ctx.userId ?? null, body); }
    catch (e: any) { throw new TechError(e?.status === 404 ? 'not_found' : 'invalid_state', e?.message || 'Could not send your question.'); }
  }

  // ── Weekly Paycheck (§15): statements (estimated until the owner approves), cash to confirm / dispute ───────────────
  private paycheckPort(): TechPaycheckPort {
    if (!this.paychecks) throw withCode(new TechError('invalid_state', 'Pay statements are not available right now.'), 'FEATURE_NOT_AVAILABLE');
    return this.paychecks;
  }
  private async paycheckCall<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e: any) {
      const st = Number(e?.status);
      // Oct 27 2026 (pilot 10e2): a payroll refusal that carries a REGISTRY code keeps its status + code (a wrong QR handoff
      // code is 401 HANDOFF_TOKEN_INVALID, not a generic 400) — an exposed client error the platform filter shows as it is
      if (st >= 400 && st < 500 && typeof e?.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(e.code)) {
        throw Object.assign(new Error(e?.message || 'Could not do that.'), { name: 'PayrollClientError', status: st, code: e.code, expose: true as const, ...(e?.details ? { details: e.details } : {}) });
      }
      if (st === 404) throw new TechError('not_found', e?.message || 'Not found.');
      if (st === 403) throw new TechError('forbidden', e?.message || 'Not allowed.');
      if (st === 409) throw new TechError('conflict', e?.message || 'That changed — reload and try again.');
      if (st && st < 500) throw new TechError('invalid_state', e?.message || 'Could not do that.');
      throw e;
    }
  }
  async getPayStatements(ctx: TechContext) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    return this.paycheckCall(() => this.paycheckPort().myPayroll(ctx, technicianId));
  }
  async getPayStatement(ctx: TechContext, statementId: string) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    return this.paycheckCall(() => this.paycheckPort().myStatement(ctx, technicianId, statementId));
  }
  /** 17.5 (Oct 27 2026): my approved statement's pay stub — the technician from the session, only her own statement */
  async getPayStub(ctx: TechContext, statementId: string, lang: string | null = null) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    return this.paycheckCall(() => this.paycheckPort().myPayStub(ctx, technicianId, statementId, { lang }));
  }
  async acknowledgeCash(ctx: TechContext, payoutId: string, handoffCode: string | null = null) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    return this.paycheckCall(() => this.paycheckPort().acknowledgeCashByTechnician(ctx, technicianId, payoutId, { handoffCode }));   // §11.5: with the manager's QR handoff code when scanned
  }
  async disputeCash(ctx: TechContext, payoutId: string, reason: string) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.payroll.view');
    return this.paycheckCall(() => this.paycheckPort().disputeCash(ctx, technicianId, payoutId, { reason }));
  }

  async getSchedule(ctx: TechContext, dateIso?: string): Promise<TechScheduleItem[]> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.schedule.view');
    const dateStr = dateIso && /^\d{4}-\d{2}-\d{2}/.test(dateIso) ? dateIso.slice(0, 10) : undefined;
    return this.repo.todaySchedule(ctx, technicianId, Date.now(), dateStr);
  }

  // GET /tech/earnings/detail (a UTC-window line read beside the canonical one) was REMOVED Oct 12 2026 (FE wave 2,
  // other chat): two earnings sources on one screen disagreed; the canonical read returns the lines itself.

  /** §17 THE canonical earnings read — summary (+ per-line detail when the adapter has it) from the immutable compensation
   *  snapshot (the SAME numbers the engine produced, posted adjustments included). Merge Oct 12 2026 (PAY, other chat's
   *  earnings-period.ts; Payroll mandate §126–§128): the window is resolved in the TENANT's timezone, half-open, custom
   *  ranges capped, and `pay_period` maps a payroll row. Scoped server-side to the authenticated technician (never trusts a
   *  client-supplied id, §31). */
  async getCanonicalEarnings(ctx: TechContext, period: EarningsPeriod | 'pay_period' = 'day', dateIso?: string, dateToIso?: string, payPeriodId?: string): Promise<(TechEarningsSummary & { period: string; dateFrom: string; dateTo: string; timezone: string; clamped?: boolean; payPeriodId?: string; linesUnavailable?: boolean; lines: { serviceName: string; lineTotalCents: number; commissionCents: number; completedAt: string; ticketId: string; ruleSource: string | null }[] }) | null> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.earnings.view');
    if (!this.compReads) return null; // honest: no snapshot source wired (e.g. no DB)
    const tz = this.compReads.tenantTimezone ? await this.compReads.tenantTimezone(ctx.tenantId, ctx.branchId ?? null).catch(() => 'UTC') : 'UTC';
    let payPeriod: { id: string; periodStart: string; periodEnd: string } | null = null;
    if (period === 'pay_period') {
      if (!payPeriodId) throw new TechError('invalid_state', 'payPeriodId is required for period=pay_period.');
      payPeriod = this.compReads.payrollPeriod ? await this.compReads.payrollPeriod(ctx.tenantId, payPeriodId) : null;
      if (!payPeriod) throw withCode(new TechError('not_found', 'Pay period not found.'), 'PAY_PERIOD_NOT_FOUND');
    }
    const p = period === 'week' || period === 'month' || period === 'custom' || period === 'pay_period' ? period : 'day';
    let w;
    try { w = resolveEarningsWindow({ period: p, dateIso, dateToIso, timezone: tz, payPeriod }); }
    catch (e: any) { throw new TechError('invalid_state', e?.message || 'Invalid earnings range.'); }
    const [sums, lines] = await Promise.all([
      this.compReads.sumByTechnicianPeriod(ctx.tenantId, technicianId, w.fromIso, w.toIso),
      // a failed line read is reported as unavailable beside the totals (an empty list read as "no work" under real totals)
      this.compReads.linesByTechnicianPeriod ? this.compReads.linesByTechnicianPeriod(ctx.tenantId, technicianId, w.fromIso, w.toIso).catch(() => null) : Promise.resolve([]),
    ]);
    await this.auditSafe(ctx, technicianId, 'technician_earnings_viewed', { data: { period: w.period, canonical: true } });
    return { ...technicianEarningsSummary(sums), period: w.period, dateFrom: w.fromIso, dateTo: w.toIso, timezone: w.timezone, clamped: w.clamped, payPeriodId: w.payPeriodId, lines: lines ?? [], linesUnavailable: lines === null };
  }

  /** §16 internal earnings receipt for one ticket — this technician's lines only (isolation). */
  async getTicketEarningsReceipt(ctx: TechContext, ticketId: string): Promise<TechTicketReceipt | null> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.earnings.view');
    if (!this.compReads) return null;
    const rows = await this.compReads.getByTicketForTechnician(ctx.tenantId, ticketId, technicianId);
    if (!rows.length) return null;
    return ticketEarningsReceipt(ticketId, rows);
  }

  async accept(ctx: TechContext, ticketId: string, expectedVersion?: number): Promise<TechTicketView> {
    const technicianId = await this.requireTechnician(ctx);
    const t = await this.ownedTicket(ctx, technicianId, ticketId);
    if (t.status !== 'assigned') throw withCode(new TechError('invalid_state', 'Only an assigned ticket can be accepted.'), 'ONLY_ASSIGNED_ACCEPT');
    this.require(ctx, 'tech.ticket.accept');
    await this.assertEligible(ctx, technicianId, t, false);
    const applied = await this.repo.accept(ctx, ticketId, expectedVersion);
    if (!applied) throw withCode(new TechError('conflict', 'This ticket has already been assigned to another technician.'), 'TICKET_ASSIGNED_TO_ANOTHER');
    if (!this.repo.emitsDomainEvents?.()) this.publish(ctx, technicianId, EVENTS.queueUpdated);   // §343: else the projection delivers tech_queue.offer_accepted
    await this.auditSafe(ctx, technicianId, 'technician_ticket_accepted', { ticketId });
    return (await this.repo.getTicket(ctx, ticketId)) ?? { ...t, status: 'accepted' };
  }

  async decline(ctx: TechContext, ticketId: string, body: DeclineBody): Promise<{ ok: true }> {
    const technicianId = await this.requireTechnician(ctx);
    const t = await this.ownedTicket(ctx, technicianId, ticketId); // ownership guard (tenant+branch+own-tech)
    if (t.status !== 'assigned') throw withCode(new TechError('invalid_state', 'Only a pending assignment offer can be declined.'), 'ONLY_PENDING_OFFER_DECLINE');
    const reason = (body?.reason || '').trim();
    if (!reason) throw withCode(new TechError('invalid_state', 'A decline reason is required.'), 'DECLINE_REASON_REQUIRED');
    this.require(ctx, 'tech.ticket.decline');
    await this.repo.decline(ctx, ticketId, { reason });
    // returns the customer to assignment-ready in the POS Tech/Customer Queue — same event the accept path emits
    if (!this.repo.emitsDomainEvents?.()) this.publish(ctx, technicianId, EVENTS.queueUpdated);   // §343: else the projection delivers tech_queue.offer_declined
    await this.auditSafe(ctx, technicianId, 'technician_ticket_declined', { ticketId, data: { reason } });
    return { ok: true };
  }

  async startService(ctx: TechContext, ticketId: string): Promise<TechTicketView> {
    const technicianId = await this.requireTechnician(ctx);
    const t = await this.ownedTicket(ctx, technicianId, ticketId);
    if (t.status !== 'accepted' && t.status !== 'paused') throw withCode(new TechError('invalid_state', 'Service can start only from an accepted (or paused) ticket.'), 'SERVICE_START_STATE_INVALID');
    this.require(ctx, 'tech.service.start');
    await this.assertEligible(ctx, technicianId, t, t.status === 'accepted');
    const started = await this.repo.start(ctx, ticketId);
    if (!started) throw withCode(new TechError('conflict', 'This ticket is no longer in a state where service can start — please refresh.'), 'TICKET_STATE_CHANGED');
    if (!this.repo.emitsDomainEvents?.()) this.publish(ctx, technicianId, EVENTS.serviceStarted, t.customerId);   // §343: else the projection delivers service.started
    await this.auditSafe(ctx, technicianId, 'technician_service_started', { ticketId });
    return (await this.repo.getTicket(ctx, ticketId)) ?? { ...t, status: 'serving' };
  }

  async pauseService(ctx: TechContext, ticketId: string): Promise<TechTicketView> {
    const technicianId = await this.requireTechnician(ctx);
    const t = await this.ownedTicket(ctx, technicianId, ticketId);
    if (t.status !== 'serving') throw withCode(new TechError('invalid_state', 'Only an in-service ticket can be paused.'), 'TICKET_NOT_IN_SERVICE');
    this.require(ctx, 'tech.service.pause');
    await this.repo.pause(ctx, ticketId);
    if (!this.repo.emitsDomainEvents?.()) this.publish(ctx, technicianId, EVENTS.servicePaused, t.customerId);   // §343: else the projection delivers service.paused
    await this.auditSafe(ctx, technicianId, 'technician_service_paused', { ticketId });
    return (await this.repo.getTicket(ctx, ticketId)) ?? { ...t, status: 'paused' };
  }

  async resumeService(ctx: TechContext, ticketId: string): Promise<TechTicketView> {
    const technicianId = await this.requireTechnician(ctx);
    const t = await this.ownedTicket(ctx, technicianId, ticketId);
    if (t.status !== 'paused') throw withCode(new TechError('invalid_state', 'Only a paused ticket can be resumed.'), 'TICKET_NOT_PAUSED');
    this.require(ctx, 'tech.service.pause');
    await this.repo.resume(ctx, ticketId);
    if (!this.repo.emitsDomainEvents?.()) this.publish(ctx, technicianId, EVENTS.serviceResumed, t.customerId);   // §343: else the projection delivers service.resumed
    await this.auditSafe(ctx, technicianId, 'technician_service_resumed', { ticketId });
    return (await this.repo.getTicket(ctx, ticketId)) ?? { ...t, status: 'serving' };
  }

  async serviceDone(ctx: TechContext, ticketId: string, body: ServiceDoneBody = {}): Promise<TechTicketView> {
    const technicianId = await this.requireTechnician(ctx);
    const t = await this.ownedTicket(ctx, technicianId, ticketId);
    if (t.status !== 'serving' && t.status !== 'nearly_finished') throw withCode(new TechError('invalid_state', 'Only a ticket in service can be marked done.'), 'TICKET_NOT_IN_SERVICE');
    this.require(ctx, 'tech.service.complete');
    await this.repo.complete(ctx, ticketId, body);
    this.publish(ctx, technicianId, EVENTS.serviceDone, t.customerId);
    await this.auditSafe(ctx, technicianId, 'technician_service_completed', { ticketId });
    return (await this.repo.getTicket(ctx, ticketId)) ?? { ...t, status: 'done' };
  }

  async getTickets(ctx: TechContext): Promise<TechTicketListItem[]> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.view');
    return this.repo.listTickets(ctx, technicianId);
  }

  async getServiceHistory(ctx: TechContext, service?: string) {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.ticket.view');
    return this.repo.serviceHistory(ctx, technicianId, service || undefined);
  }

  async getQueue(ctx: TechContext): Promise<TechQueueState> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.dashboard.view');
    return this.repo.queueState(ctx, technicianId);
  }

  async getMore(ctx: TechContext): Promise<TechMoreState> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.dashboard.view');
    return this.repo.moreState(ctx, technicianId);
  }

  async getSkills(ctx: TechContext): Promise<TechSkillsView> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.dashboard.view');
    const base = await this.repo.skills(ctx, technicianId);
    const [requestableServices, requests] = await Promise.all([
      this.repo.requestableServices(ctx, technicianId),
      this.repo.listSkillChangeRequests(ctx, technicianId),
    ]);
    return { ...base, requestableServices, requests };
  }

  async requestSkillChange(ctx: TechContext, body: SkillChangeBody): Promise<SkillChangeRequest> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.profile.edit');
    if (!body || !body.serviceId) throw withCode(new TechError('invalid_state', 'A service is required.'), 'SERVICE_REQUIRED');
    assertEvidenceLinks(body);
    const res = await this.repo.createSkillChangeRequest(ctx, technicianId, body);
    await this.auditSafe(ctx, technicianId, 'technician_skill_change_requested', { data: { serviceId: body.serviceId, requestType: body.requestType ?? 'add' } });
    return res;
  }

  async updateSkillChange(ctx: TechContext, requestId: string, body: SkillChangeBody): Promise<SkillChangeRequest> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.profile.edit');
    if (!body || !body.serviceId) throw withCode(new TechError('invalid_state', 'A service is required.'), 'SERVICE_REQUIRED');
    assertEvidenceLinks(body);
    const res = await this.repo.updateSkillChangeRequest(ctx, requestId, technicianId, body);
    await this.auditSafe(ctx, technicianId, 'technician_skill_change_updated', { data: { requestId, serviceId: body.serviceId, requestType: body.requestType ?? 'add' } });
    return res;
  }

  async mySkillChangeRequests(ctx: TechContext): Promise<SkillChangeRequest[]> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.dashboard.view');
    return this.repo.listSkillChangeRequests(ctx, technicianId);
  }

  async pendingSkillChangeRequests(ctx: TechContext): Promise<PendingSkillChangeRequest[]> {
    this.requireManager(ctx);
    return this.repo.listPendingSkillChangeRequests(ctx);
  }

  // Decision 7: the reviewer can start a review, ask for more information (a note is then required — the technician
  // has to know what to add), approve or reject. Which moves are allowed from the request's current state is checked
  // inside the repository's transaction (canReviewSkillRequest), so two reviewers cannot both decide one request.
  async decideSkillChange(ctx: TechContext, requestId: string, decision: SkillReviewDecision, reviewNotes?: string | null): Promise<PendingSkillChangeRequest> {
    this.requireManager(ctx);
    if (!SKILL_REVIEW_DECISIONS.includes(decision)) throw new TechError('invalid_state', 'Decision must be under review, more information required, approved or rejected.');
    const notes = typeof reviewNotes === 'string' && reviewNotes.trim() ? reviewNotes.trim().slice(0, 1000) : null;
    if (decision === 'more_information_required' && !notes) throw withCode(new TechError('invalid_state', 'Tell the technician what information is needed.'), 'INFO_REQUEST_NOTE_REQUIRED');
    const res = await this.repo.decideSkillChangeRequest(ctx, requestId, decision, ctx.userId, notes);
    await this.auditSafe(ctx, res.technicianId, 'technician_skill_change_decided', { data: { requestId, decision, hasNotes: !!notes } });
    return res;
  }

  // ── Functional Decision 9: clock in / out from the Technician App ────────────────────────────────────────────────
  // The SAME punches as the POS manager screen and the Go Check-In PIN kiosk (workforce TimeClockService over
  // technician_shifts), so there is one timecard however the technician clocks. Who is clocking is the signed-in
  // technician — never a technicianId from the client — and the time is the server's (TimeClockService stamps it).
  // Clock-out is refused mid-service, like the kiosk. Manager corrections stay on the POS (reason + original kept).
  private clockCtx(ctx: TechContext) {
    if (!this.timeClock) throw withCode(new TechError('not_found', 'The time clock is not available.'), 'FEATURE_NOT_AVAILABLE');
    if (!ctx.branchId) throw withCode(new TechError('invalid_state', 'Choose your salon location before clocking in.'), 'CLOCK_IN_BRANCH_REQUIRED');
    return { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: String(ctx.role), permissions: ctx.permissions ?? [] };
  }
  private clockView(row: { state: string; clockedInAt: string | null; lastClockOutAt: string | null; hoursToday: number } | undefined): TechClockView {
    const state = row?.state === 'clocked_in' ? 'clocked_in' : 'clocked_out';
    return { state, clockedInAt: state === 'clocked_in' ? (row?.clockedInAt ?? null) : null, lastClockOutAt: row?.lastClockOutAt ?? null, hoursToday: row?.hoursToday ?? 0, serverTime: new Date().toISOString() };
  }
  private async clockCall<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (e: any) {
      if (e instanceof TechError) throw e;
      if (e instanceof TimeClockValidationError) throw new TechError('invalid_state', e.message === 'Technician is already clocked in' ? 'You are already clocked in.' : e.message === 'Technician is not clocked in' ? 'You are not clocked in.' : String(e.message));
      if (e instanceof TimeClockForbiddenError) throw new TechError('forbidden', String(e.message));
      throw e;
    }
  }

  async myClock(ctx: TechContext): Promise<TechClockView> {
    const technicianId = await this.requireTechnician(ctx);
    const state = await this.clockCall(() => this.timeClock!.getState(this.clockCtx(ctx)));
    return this.clockView(state.technicians.find((t) => t.technicianId === technicianId));
  }

  async clockIn(ctx: TechContext): Promise<TechClockView> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.timeclock.punch');
    const cctx = this.clockCtx(ctx);
    const row = await this.clockCall(() => this.timeClock!.clockIn(cctx, technicianId));
    // The workforce clock is idempotent (a double tap returns the open punch, mandate §106); the Technician App still
    // tells the person plainly, and a repeat is never audited as a second clock-in.
    if (row.created === false) throw withCode(new TechError('invalid_state', 'You are already clocked in.'), 'ALREADY_CLOCKED_IN');
    await this.auditSafe(ctx, technicianId, 'technician_clocked_in', { data: { at: row.clockedInAt, source: 'technician_app' } });
    return this.clockView(row);
  }

  async clockOut(ctx: TechContext): Promise<TechClockView> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.timeclock.punch');
    const cctx = this.clockCtx(ctx);
    const { hasActiveService } = await this.repo.breakContext(ctx, technicianId);
    if (hasActiveService) throw withCode(new TechError('invalid_state', 'Finish your current service before clocking out.'), 'CLOCK_OUT_FINISH_SERVICE');
    const row = await this.clockCall(() => this.timeClock!.clockOut(cctx, technicianId));
    await this.auditSafe(ctx, technicianId, 'technician_clocked_out', { data: { at: row.lastClockOutAt, source: 'technician_app' } });
    return this.clockView(row);
  }

  async getWorkingHours(ctx: TechContext): Promise<TechWorkingHoursDay[]> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, 'tech.dashboard.view');
    return this.repo.workingHours(ctx, technicianId);
  }

  async addNote(ctx: TechContext, ticketId: string, body: NoteBody): Promise<TechTicketView> {
    const technicianId = await this.requireTechnician(ctx);
    await this.ownedTicket(ctx, technicianId, ticketId); // ownership guard
    this.require(ctx, 'tech.service.note_add');
    await this.repo.addNote(ctx, ticketId, body);
    await this.auditSafe(ctx, technicianId, 'technician_note_added', { ticketId });
    return (await this.repo.getTicket(ctx, ticketId))!;
  }

  async requestCancel(ctx: TechContext, ticketId: string, body: CancelRequestBody): Promise<{ ok: true }> {
    const technicianId = await this.requireTechnician(ctx);
    const t = await this.ownedTicket(ctx, technicianId, ticketId);
    if (t.status === 'done') throw withCode(new TechError('invalid_state', 'A completed ticket cannot be cancelled here.'), 'TICKET_COMPLETED_CANNOT_CANCEL');
    this.require(ctx, 'tech.ticket.cancel_request');
    await this.repo.requestCancel(ctx, ticketId, body);
    await this.auditSafe(ctx, technicianId, 'technician_ticket_cancel_requested', { ticketId });
    return { ok: true };
  }

  /** Explicit break start/stop (the picture's Queue screen has discrete Lunch/Short-break + End-break actions).
   *  There is NO client override here (Oct 12 2026 merge, workforce audit P0 #7): the technician app used to accept a
   *  `managerOverride` body flag that let a technician approve their own break mid-service. A technician on an active
   *  service cannot start a break — a manager does that from the POS, under their own session. */
  async setBreakState(ctx: TechContext, on: boolean): Promise<{ status: TechnicianStatus }> {
    const technicianId = await this.requireTechnician(ctx);
    this.require(ctx, on ? 'tech.break.start' : 'tech.break.end');
    const { hasActiveService } = await this.repo.breakContext(ctx, technicianId);
    if (on && hasActiveService) throw withCode(new TechError('invalid_state', 'Cannot start a break during an active service without manager approval.'), 'BREAK_DURING_SERVICE');
    const status = await this.repo.setBreak(ctx, technicianId, on, false);
    this.publish(ctx, technicianId, EVENTS.queueUpdated);
    await this.auditSafe(ctx, technicianId, on ? 'technician_break_started' : 'technician_break_ended');
    return { status };
  }

  async toggleBreak(ctx: TechContext): Promise<{ status: TechnicianStatus }> {
    const technicianId = await this.requireTechnician(ctx);
    const { status, hasActiveService } = await this.repo.breakContext(ctx, technicianId);
    const onBreak = status === 'on_break' || status === 'lunch';
    if (!onBreak) {
      // starting a break — never during an active service (no client override; see setBreakState)
      if (hasActiveService) throw withCode(new TechError('invalid_state', 'Cannot start a break during an active service without manager approval.'), 'BREAK_DURING_SERVICE');
    }
    this.require(ctx, !onBreak ? 'tech.break.start' : 'tech.break.end');
    const next = await this.repo.setBreak(ctx, technicianId, !onBreak, false);
    this.publish(ctx, technicianId, EVENTS.queueUpdated);
    await this.auditSafe(ctx, technicianId, !onBreak ? 'technician_break_started' : 'technician_break_ended');
    return { status: next };
  }

  async sendMessageToManager(ctx: TechContext, body: { topic: string; message: string }): Promise<{ ok: true; messageId: string }> {
    const technicianId = await this.requireTechnician(ctx);
    if (!body.message || !body.message.trim()) throw withCode(new TechError('invalid_state', 'Message cannot be empty.'), 'MESSAGE_REQUIRED');
    const d = await this.repo.dashboardRaw(ctx, technicianId);
    const techName = d.technician.fullName || 'Technician';
    const messageId = await this.repo.saveManagerMessage(ctx, {
      technicianId,
      technicianName: techName,
      topic: body.topic || 'General Question',
      message: body.message.trim(),
    });
    return { ok: true, messageId };
  }

  /** A technician sees ONLY their own help messages; a manager/owner (technicians.edit) sees the salon's inbox.
   *  (Oct 12 2026 merge, workforce audit P0 #13: this used to return every technician's messages, unguarded.) */
  async getManagerMessages(ctx: TechContext) {
    // the salon inbox: a manager, or the front desk / reception (a POS role that is NOT a technician and can see the team)
    // — wave 4: the desk was routed to the technician path and got 403 "No technician profile" on every POS screen
    const role = String(ctx.role || '').toUpperCase();
    if (this.isManager(ctx) || (role !== 'TECHNICIAN' && !!ctx.permissions?.includes('technicians.view'))) return this.repo.getManagerMessages(ctx);
    const technicianId = await this.requireTechnician(ctx);
    return this.repo.getManagerMessages(ctx, technicianId);
  }

  /** Resolving a help message is a MANAGER/OWNER act — a technician cannot close their own request. */
  async resolveManagerMessage(ctx: TechContext, messageId: string) {
    this.requireManager(ctx);
    await this.repo.resolveManagerMessage(ctx, messageId);
    await this.auditSafe(ctx, '', 'technician_manager_message_resolved', { data: { messageId } });
    return { ok: true };
  }
}

/** Security Deep Scan D4: a skill request's evidence links are shown to the manager as <a href> / <img src>. Only an
 *  https URL or a same-origin path ("/media/…") is stored — a `javascript:` / `data:` / `http:` link would run in (or
 *  leak from) the manager's POS. */
export function isSafeEvidenceLink(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (!s) return true;
  if (s.startsWith('/') && !s.startsWith('//') && !/[\\\s]/.test(s)) return true;
  if (!URL.canParse(s)) return false;
  const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password;
}
export function assertEvidenceLinks(body: { certificateEvidence?: string | null; supportingPhotos?: string[] | null }): void {
  const all = [body.certificateEvidence, ...(body.supportingPhotos ?? [])];
  if (!all.every(isSafeEvidenceLink)) throw withCode(new TechError('invalid_state', 'Evidence links must be https:// links or uploaded files.'), 'EVIDENCE_LINK_INVALID');
}
