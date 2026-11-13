// serving.service.ts — tenant POS Serving. Resolves tenant/role from session; enforces per-action permissions;
// drives the timer state machine; service-line edits pull price from the catalog; mark-done + send-to-service-done
// are gated and idempotent; delays are tracked; everything is audited.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import { isAddOnCategory, coded, type CodedText, withCode } from '@aipowersalon/api-contracts';
import type { ServingActionReview, ServingActionReviewConflict, ServingReviewAction } from '@aipowersalon/api-contracts/tenant';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { randomUUID } from 'node:crypto';
import {
  POSServingFullState, ServingFilters, POSServingTicketRow, POSServingTicketDetailFull, UpdateServiceNotesRequest,
  AddServiceRequest, EditServiceLineRequest, RemoveServiceRequest, AssignServingTechnicianRequest,
  AssignServingHelperRequest, ReopenServiceDoneRequest, ReportDelayRequest, ClearDelayRequest, canMarkDone, canSendToServiceDone,
  buildServiceDoneIdempotencyKey, subtotalFromServingLines, ServiceOption, TechnicianOption,
  servingNextActions, SERVING_ACTION_PERMISSION, addOnLineIdFor, buildBalanceSuggestions, type ServingAction, type ServingBalanceSuggestion,
  serviceDoneReadiness, type ServiceDoneReadiness, type ServingWorkflowSettings,
} from './serving.dto';
import { createHash } from 'node:crypto';
import { ServingContext, ServingRepositoryPort, SVLine } from './serving.repository';
import { TechnicianEligibilityError, type TechnicianEligibilityService } from '@aipowersalon/workforce';
import { resolveManagerOverride, ManagerOverrideForbiddenError } from '@aipowersalon/appointments';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string, public readonly code?: string, public readonly params?: Record<string, unknown>) { super(msg); this.name = 'ValidationError'; } }   // V-5 (Oct 27 2026): an optional registry code + params beside the English
export class ConflictError extends Error { code?: string; constructor(msg: string, code?: string) { super(msg); this.name = 'ConflictError'; this.code = code; } }


export interface POSServingAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

/** The one thing serving needs from inventory. Kept structural so serving never imports the inventory module. */
/** B-19: a manager at the till allows a sale past the counted stock with her PIN. The port answers WHO (a manager of this
 *  salon whose PIN matched and who holds checkout.manage_overrides) or null — it never raises on a wrong PIN. */
export interface ManagerPinPort { verify(ctx: ServingContext, pin: string): Promise<{ userId: string; name?: string | null } | null> }
export interface RetailStockLike {
  recordRetailSale(ctx: any, productId: string, quantity: number, ticketId?: string, lineId?: string): Promise<{ consumed: number; shortBy: number; onHand: number }>;
  /** B-17: put the units a retail line took back on the shelf (the line removed before payment). Optional: an older stock
   *  adapter without it leaves the count to a manual adjustment, as before. */
  reverseRetailSale?(ctx: any, input: { ticketId: string; lineIds: string[] | null; reason: string }): Promise<{ returned: number; byProduct: Array<{ productId: string; returned: number; onHand: number }> }>;
}

export class ServingService {
  private audit: POSServingAuditLog[] = [];
  /** Optional, structural (no Nest coupling): the inventory side of a retail sale. Absent in unit tests and in
   *  any deployment without inventory — the sale still completes, it just doesn't move stock. */
  /** `eligibility` (merge Oct 12 2026) is THE ONE technician eligibility authority (@aipowersalon/workforce eligibility).
   *  Null without a database (in-memory dev) — the repository's tenant-membership check still applies. */
  constructor(private readonly repo: ServingRepositoryPort, private readonly realtime?: RealtimeEmitter, private readonly stock?: RetailStockLike, private readonly eligibility?: TechnicianEligibilityService | null, private readonly managerPins?: ManagerPinPort | null) {}

  /** Map an eligibility refusal to this module's error vocabulary (422 skills/active, 403 branch, 409 conflict/serving). */
  /** `requireNotServing` (fix Oct 12 2026): starting / being moved onto THIS ticket refuses only a live service elsewhere —
   *  not "not clocked in" (salons without the time clock) nor "already holds this ticket", which the broader
   *  requireAssignable ("may she take ANOTHER guest") refused and which no serving path ever refused before the merge. */
  private async assertEligible(ctx: ServingContext, technicianId: string, serviceIds: string[], requireNotServing: boolean, action: string, overrideConflicts = false) {
    if (!this.eligibility) return;
    try {
      await this.eligibility.assert({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId, serviceIds, requireNotServing, actor: { userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, overrideConflicts } });
    } catch (e: any) {
      if (e instanceof TechnicianEligibilityError) {
        this.log(ctx, 'technician_eligibility_refused', 'technician', technicianId, undefined, undefined, { action, code: e.code, ...e.details });
        if (e.code === 'TECHNICIAN_ALREADY_SERVING' || e.code === 'SCHEDULE_CONFLICT') throw new ConflictError(e.message, e.code);
        if (e.code === 'TECHNICIAN_BRANCH_ACCESS_DENIED') throw new ForbiddenError(e.message);
        throw new ValidationError(e.message);
      }
      throw e;
    }
  }
  /** Workforce state projection — best-effort, never load-bearing (the state machine owns its own refusals). */
  private async project(kind: 'serviceStarted' | 'servicePaused' | 'serviceCompleted', ctx: ServingContext, technicianId: string | null | undefined, ticketId: string) {
    if (!technicianId) return;
    try { await (this.eligibility?.workforce as any)?.[kind]?.(ctx.tenantId, technicianId, { ticketId }); } catch { /* best-effort */ }
  }
  /** Workforce audit P0 #7: `managerOverride` is honoured only with pos.booking.override_conflict (audited); a request
   *  that asks for it without the permission is refused (@aipowersalon/appointments manager-override). */
  private override(ctx: ServingContext, requested: unknown, action: string): boolean {
    try {
      return resolveManagerOverride(ctx as any, requested, (m) => this.log(ctx, 'manager_override_used', 'manager_override', undefined, undefined, undefined, { ...m }), action);
    } catch (e) { if (e instanceof ManagerOverrideForbiddenError) throw new ForbiddenError(e.message); throw e; }
  }
  /** The lines a ticket-level (primary / helper) technician performs: hers and the unowned ones. On a shared visit
   *  (multi-technician split, migration 569) another LINE technician's lines are that technician's, checked on her own
   *  start — never against the primary (fix Oct 12 2026, live-multitech-queue). */
  private ownServiceIdsOf(t: { lines: SVLine[] }, technicianId: string | null | undefined): string[] {
    return t.lines.filter((l) => !l.technicianId || !technicianId || l.technicianId === technicianId).map((l) => l.serviceId).filter((x) => !!x);
  }

  private assertUser(ctx: ServingContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Serving is not available for this role');
  }
  private need(ctx: ServingContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private log(ctx: ServingContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): POSServingAuditLog[] { return this.audit.slice(); }
  private async ticketOr404(ctx: ServingContext, id: string) { const t = await this.repo.ticket(ctx, id); if (!t) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND'); return t; }

  // ──────── In-service revision timeline + optimistic concurrency (epic Req §5/§9) ────────
  private lineSnap(t: { lines: any[] } | null, lineId: string) {
    const l = t?.lines.find((x: any) => x.serviceLineId === lineId);
    return l ? { serviceLineId: l.serviceLineId, serviceName: l.serviceName, priceCents: l.priceCents, technicianName: l.technicianName ?? null, status: l.status, isAddOn: !!l.isAddOn } : null;
  }
  /** Throws 409 if the caller's expected version no longer matches (lost-update guard). No-op when omitted. */
  private async assertVersion(ctx: ServingContext, id: string, expected?: number) {
    if (expected == null || Number.isNaN(Number(expected))) return;
    const current = await this.repo.getTicketVersion(ctx, id);
    if (Number(expected) !== current) throw withCode(new ConflictError(`This ticket changed since you opened it (you have v${expected}, it is now v${current}). Reload before editing.`), 'TICKET_CHANGED_RELOAD');
  }
  /** Formal Service Done lock (epic Req §5): once locked, every edit path is blocked until an audited reopen. */
  private async assertNotLocked(ctx: ServingContext, id: string) {
    if (await this.repo.serviceDoneLock(ctx, id)) throw withCode(new ConflictError('This ticket is locked at Service Done. Reopen it before making changes.'), 'TICKET_LOCKED_AT_SERVICE_DONE');
  }
  /** ticket_revisions.service_line_id is uuid: a synthetic/temporary id (a requested line not yet on a ticket) is not sent. */
  private async recordRevision(ctx: ServingContext, id: string, action: string, before: any, after: any, lineId?: string | null, summary?: string) {
    try { await this.repo.appendRevision(ctx, id, { action, serviceLineId: lineId && UUID_RE.test(lineId) ? lineId : null, actorUserId: ctx.userId, actorRole: ctx.role, before, after, summary: summary ?? null }); } catch { /* revision logging must never break the edit */ }
  }
  private revSummary(kind: 'added' | 'updated' | 'removed', before: any, after: any): string {
    if (kind === 'added') return `Added ${after?.serviceName ?? 'a service'}`;
    if (kind === 'removed') return `Removed ${before?.serviceName ?? 'a service'}`;
    const parts: string[] = [];
    if (before && after) {
      if (before.priceCents !== after.priceCents) parts.push(`price ${before.priceCents}→${after.priceCents}¢`);
      if ((before.technicianName ?? null) !== (after.technicianName ?? null)) parts.push(`tech ${before.technicianName ?? '—'}→${after.technicianName ?? '—'}`);
      if (before.status !== after.status) parts.push(`status ${before.status}→${after.status}`);
    }
    return parts.length ? `Updated ${after?.serviceName ?? 'service'}: ${parts.join(', ')}` : `Updated ${after?.serviceName ?? 'a service'}`;
  }
  /** GET /pos/serving/tickets/:id/revisions — the append-only in-service edit history. */
  async getRevisions(ctx: ServingContext, id: string) {
    this.need(ctx, 'pos.serving.view'); await this.ticketOr404(ctx, id);
    // summaryCoded (Vietnamese POS §21): the stored English summary as code + vars, derived at READ time from the stored
    // action + before / after — so revisions written before this change are worded in the cashier's language too.
    const revisions = (await this.repo.listRevisions(ctx, id)).map((r) => ({ ...r, summaryCoded: revisionSummaryCoded(r.action, r.before, r.after, r.summary ?? null) }));
    return { ticketId: id, currentVersion: await this.repo.getTicketVersion(ctx, id), revisions };
  }

  /** §31: the legal next actions for this user — canonical status ∩ workflow settings ∩ the user's permissions. */
  private actionsFor(ctx: ServingContext, status: POSServingTicketRow['status'], settings: { allowPauseResume: boolean }): ServingAction[] {
    return servingNextActions(status, settings).filter((a) => hasPermission(ctx as Parameters<typeof hasPermission>[0], SERVING_ACTION_PERMISSION[a]));
  }
  /** Serving 05: the Service Done readiness of one visit for THIS person — THE gates + this person's permissions (read only) */
  private readinessFor(ctx: ServingContext, d: POSServingTicketDetailFull, settings: ServingWorkflowSettings): ServiceDoneReadiness {
    const can = (k: string) => hasPermission(ctx as Parameters<typeof hasPermission>[0], k);
    return serviceDoneReadiness({ status: d.status, notes: d.notes, settings, lines: d.services || [], canMarkReady: can(SERVING_ACTION_PERMISSION.mark_ready), canSend: can(SERVING_ACTION_PERMISSION.send_to_service_done) && can('pos.service_done.view') });
  }
  // ---- read ----
  async getState(ctx: ServingContext, f: ServingFilters = {}): Promise<POSServingFullState> {
    this.need(ctx, 'pos.serving.view'); const st = await this.repo.query(ctx, f);
    for (const r of st.tickets.items) r.allowedActions = this.actionsFor(ctx, r.status, st.workflowSettings);
    this.log(ctx, 'pos_serving_viewed', 'pos_serving', undefined, undefined, undefined, { filters: f }); return st;
  }
  async getKpis(ctx: ServingContext) { return (await this.getState(ctx)).kpis; }
  async tickets(ctx: ServingContext, f: ServingFilters = {}): Promise<{ items: POSServingTicketRow[]; pagination: any }> { this.need(ctx, 'pos.serving.view'); return (await this.repo.query(ctx, f)).tickets; }
  async detail(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull> { this.need(ctx, 'pos.serving.view'); const d = await this.repo.detail(ctx, id); if (!d) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND'); d.addOnSuggestions = await this.buildAddOnSuggestions(ctx, d); const settings = await this.repo.settings(ctx); d.allowedActions = this.actionsFor(ctx, d.status, settings); d.serviceDoneReadiness = this.readinessFor(ctx, d, settings); this.log(ctx, 'pos_serving_ticket_viewed', 'pos_serving_ticket', id); return d; }

  /** Serving 07 — Touch Safe Action Review: what an impactful action would touch and every refusal ITS OWN gates would raise,
   *  for THIS person, before they confirm. The same checks the action runs (canMarkDone, the Service Done lock, the workflow
   *  settings, the manager-override authority, THE eligibility authority) — a conflict here is the refusal the action would
   *  answer, never a second rule. Read only: nothing is written, moved, priced, sent or audited to the database. */
  async actionReview(ctx: ServingContext, id: string, q: { action?: string; technicianId?: string; serviceId?: string; priceCents?: string | number }): Promise<ServingActionReview> {
    this.need(ctx, 'pos.serving.view');
    const action = q?.action as ServingReviewAction;
    if (!['mark_ready', 'assign_technician', 'add_service'].includes(action)) throw withCode(new ValidationError('Unknown action to review'), 'VALIDATION_FAILED');
    const t = await this.ticketOr404(ctx, id); const d = (await this.repo.detail(ctx, id))!; const settings = await this.repo.settings(ctx);
    const can = (k: string) => hasPermission(ctx as Parameters<typeof hasPermission>[0], k);
    const OVERRIDE = 'pos.booking.override_conflict';
    const conflicts: ServingActionReviewConflict[] = [];
    const locked = action !== 'mark_ready' && !!(await this.repo.serviceDoneLock(ctx, id));
    if (locked) conflicts.push({ code: 'TICKET_LOCKED_AT_SERVICE_DONE', severity: 'block' });
    const lineOut = (l: SVLine, isNew = false) => ({ serviceLineId: isNew ? null : l.serviceLineId, serviceName: l.serviceName, technicianName: l.technicianName ?? t.primaryTechName ?? null, priceCents: l.priceCents, isNew });
    const remaining = d.estimatedDurationMinutes && d.estimatedDurationMinutes > 0 ? Math.max(0, d.estimatedDurationMinutes - (d.elapsedMinutes ?? 0)) : null;
    // the technician's next booking today vs the time this visit still needs (+ an add-on's own length) — a warning, never a block
    const bookingSoon = async (technicianId: string | undefined, name: string | null | undefined, extraMinutes: number) => {
      if (!technicianId || remaining == null || !this.repo.nextBookingMinutes) return;
      const until = (await this.repo.nextBookingMinutes(ctx))[technicianId];
      if (until != null && remaining + extraMinutes > until) conflicts.push({ code: 'BOOKING_SOON', severity: 'warn', vars: { name: name || '—', minutes: until, needs: remaining + extraMinutes } });
    };
    const eligibilityConflict = async (technicianId: string, serviceIds: string[], requireNotServing: boolean, overrideConflicts: boolean) => {
      if (!this.eligibility) return;
      try { await this.eligibility.assert({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId, serviceIds, requireNotServing, actor: { userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, overrideConflicts } }); }
      catch (e) { if (!(e instanceof TechnicianEligibilityError)) throw e; conflicts.push({ code: e.code, severity: 'block', ...(e.details && typeof e.details.serviceName === 'string' ? { vars: { service: e.details.serviceName } } : {}) }); }
    };
    let affected: ServingActionReview['affected'] = []; let change: ServingActionReview['change'] = null; let permission: ServingActionReview['permission'];
    if (action === 'mark_ready') {
      permission = { key: SERVING_ACTION_PERMISSION.mark_ready, allowed: can(SERVING_ACTION_PERMISSION.mark_ready) };
      affected = t.lines.map((l) => lineOut(l));
      if (t.status === 'completed' || t.status === 'sent_to_service_done') conflicts.push({ code: 'ALREADY_DONE', severity: 'block' });
      else { const gate = canMarkDone(t.status, t.notes, settings); if (!gate.ok) conflicts.push({ code: gate.reason || 'CANNOT_MARK_DONE', severity: 'block' }); }
      const open = t.lines.filter((l) => l.status !== 'done').length;
      if (open > 0 && t.status !== 'completed' && t.status !== 'sent_to_service_done') conflicts.push({ code: 'OPEN_SERVICE_LINES', severity: 'info', vars: { n: open } });   // information only — the gate does not require it
    } else if (action === 'assign_technician') {
      permission = { key: 'pos.serving.assign_technician', allowed: can('pos.serving.assign_technician'), overrideKey: OVERRIDE, overrideAllowed: can(OVERRIDE) };
      const to = q?.technicianId ? (await this.repo.technicians(ctx)).find((x) => x.technicianId === q.technicianId) : undefined;
      if (!q?.technicianId) throw new ValidationError('A technician is required', 'TECHNICIAN_REQUIRED');
      affected = t.lines.filter((l) => !l.technicianId || !t.primaryTechId || l.technicianId === t.primaryTechId).map((l) => lineOut(l));
      change = { fromTechnicianName: t.primaryTechName ?? null, toTechnicianName: to?.name ?? null };
      if (!to) conflicts.push({ code: 'TECHNICIAN_NOT_FOUND', severity: 'block' });
      else if (to.technicianId === t.primaryTechId) conflicts.push({ code: 'SAME_TECHNICIAN', severity: 'warn' });
      else {
        const live = ['in_service', 'paused', 'delayed'].includes(t.status);
        await eligibilityConflict(to.technicianId, this.ownServiceIdsOf(t, t.primaryTechId), live, false);
        await bookingSoon(to.technicianId, to.name, 0);
      }
    } else {
      permission = { key: 'pos.serving.edit_services', allowed: can('pos.serving.edit_services'), overrideKey: OVERRIDE, overrideAllowed: can(OVERRIDE) };
      if (!q?.serviceId) throw withCode(new ValidationError('A service is required'), 'VALIDATION_FAILED');
      const svc = await this.repo.serviceCatalog(ctx, String(q.serviceId)); if (!svc) throw withCode(new ValidationError('Unknown service'), 'SERVICE_UNKNOWN');
      const asked = q.priceCents === undefined || q.priceCents === '' ? null : Number(q.priceCents);
      if (asked != null && (!Number.isInteger(asked) || asked < 0)) throw withCode(new ValidationError('The price must be whole cents'), 'VALIDATION_FAILED');
      const manual = asked != null && asked !== svc.priceCents;
      const price = asked ?? svc.priceCents;
      const tech = q.technicianId ? (await this.repo.technicians(ctx)).find((x) => x.technicianId === q.technicianId) : t.primaryTechId ? { technicianId: t.primaryTechId, name: t.primaryTechName ?? '' } : undefined;
      affected = [{ serviceLineId: null, serviceName: svc.name, technicianName: tech?.name ?? null, priceCents: price, isNew: true }];
      change = { catalogPriceCents: svc.priceCents, priceCents: price, priceSource: manual ? 'manual' : 'catalog' };
      // the same two refusals addService answers: editing during service needs the override; a manual price needs it too
      if (!settings.allowServiceEditDuringServing) conflicts.push({ code: 'MANAGER_OVERRIDE_REQUIRED', severity: can(OVERRIDE) ? 'warn' : 'block' });
      if (manual) conflicts.push(can(OVERRIDE) ? { code: 'MANUAL_PRICE', severity: 'warn', vars: { catalogCents: svc.priceCents, priceCents: price } } : { code: 'PRICE_OVERRIDE_NOT_PERMITTED', severity: 'block' });
      if (q.technicianId && !tech) conflicts.push({ code: 'TECHNICIAN_NOT_FOUND', severity: 'block' });
      if (t.lines.some((l) => l.serviceId === svc.serviceId)) conflicts.push({ code: 'ALREADY_ON_TICKET', severity: 'warn', vars: { service: svc.name } });
      if (q.technicianId && tech) await eligibilityConflict(tech.technicianId, [svc.serviceId], false, false);
      await bookingSoon(tech?.technicianId, tech?.name, svc.durationMinutes || 0);
    }
    return {
      ticketId: id, action, guest: { customerName: d.customer?.fullName ?? t.customerName, ticketNumber: d.ticketNumber, isVip: !!t.isVip },
      affected, change, permission, conflicts,
      canProceed: permission.allowed && !conflicts.some((c) => c.severity === 'block'),
      needsConfirmation: action !== 'mark_ready' || !permission.allowed || conflicts.some((c) => c.severity !== 'info'),
    };
  }

  /** Canonical add-on suggestion builder (master doc §Serving "Add-ons"): active catalog services in the 'Add-on'
   *  category that are not already on the ticket. Used by BOTH the POS detail above and the tech app read below —
   *  one source, no duplication. (The dto field existed but was never populated anywhere until now.) */
  private async buildAddOnSuggestions(ctx: ServingContext, d: POSServingTicketDetailFull) {
    const onTicket = new Set((d.services || []).map((l: any) => String(l.serviceId)));
    const all = await this.repo.services(ctx).catch(() => [] as any[]);
    return (all as any[])
      .filter((sv) => isAddOnCategory(sv.categoryName) && !onTicket.has(String(sv.serviceId)))   // the floor's ONE add-on test (kiosk too)
      .slice(0, 6)
      .map((sv) => ({ serviceId: sv.serviceId, serviceName: sv.name, priceCents: sv.priceCents, source: 'service_category' as const }));
  }

  /** Tech app read: suggestions for the technician's own in-service ticket (tenant/branch scoping comes from ctx;
   *  ownership + tech.* permission are enforced by TechService before calling). */
  async techAddOnSuggestions(ctx: ServingContext, id: string) {
    const d = await this.repo.detail(ctx, id);
    if (!d) return [];
    return this.buildAddOnSuggestions(ctx, d);
  }

  /** Tech app action: a deliberately NARROWER entry than addService — no manager-override path, the salon's
   *  allowServiceEditDuringServing setting is the gate, and ONLY 'Add-on' category services may be added. The line
   *  write reuses the same repo.addService snapshot path (single writer). */
  async techAddAddOn(ctx: ServingContext, id: string, serviceId: string, technicianId: string) {
    if (!(await this.repo.settings(ctx)).allowServiceEditDuringServing) throw new ValidationError('This salon does not allow adding services during serving — ask the front desk.', 'SERVING_ADD_SERVICE_OFF');
    const d = await this.repo.detail(ctx, id); if (!d) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');
    const svc = await this.repo.serviceCatalog(ctx, serviceId); if (!svc) throw withCode(new ValidationError('Unknown service'), 'SERVICE_UNKNOWN');
    if (!isAddOnCategory(svc.categoryName)) throw withCode(new ValidationError('Technicians can only add Add-on services.'), 'ADDONS_ONLY_FOR_TECHNICIANS');   // "Add-on", "Add-ons", … (wave 4 PILOT)
    const line = await this.writeTechLine(ctx, id, svc, technicianId, undefined);
    this.log(ctx, 'technician_addon_added', 'pos_serving_service_line', id, undefined, undefined, { serviceId: svc.serviceId, priceCents: svc.priceCents, technicianId });
    this.emitLineEvents(ctx, id, EVENTS.ticketServiceLineAdded);
    return { ok: true as const, serviceName: svc.name, priceCents: svc.priceCents, serviceLineId: line.serviceLineId };
  }

  // ════════ Retail sale (Jul 27, 2026) ════════
  // The salon could stock, price and REPORT on retail, but had no way to sell it: the only line writer inserts a
  // service line. This is that missing write path. It is deliberately narrow — one product, one quantity, priced
  // from the catalog at the moment of sale, never from the client.
  /** The product picker's list. Same permission as the sale, and only id/name/price — a picker never needs cost. */
  async retailCatalog(ctx: ServingContext, search?: string) {
    this.need(ctx, 'pos.serving.edit_services');
    return { products: await this.repo.retailCatalog(ctx, search) };
  }

  async addRetail(ctx: ServingContext, ticketId: string, body: { productId?: string; quantity?: number; technicianId?: string; managerPin?: string }) {
    const productId = String(body?.productId || '').trim();
    const quantity = Number(body?.quantity ?? 1);
    if (!productId) throw withCode(new ValidationError('Pick a product to sell.'), 'PRODUCT_REQUIRED');
    // Reject a fractional quantity rather than silently truncating it — quietly turning 2.5 into 2 is exactly the
    // kind of invisible coercion that hides a mis-typed sale.
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw withCode(new ValidationError('Quantity must be a whole number between 1 and 99.'), 'QUANTITY_INVALID');

    const detail = await this.repo.detail(ctx, ticketId);
    if (!detail) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');

    // Price comes from the tenant's own catalog, never from the request — a client cannot name its own price.
    const product = await this.repo.retailProduct(ctx, productId);
    if (!product) throw withCode(new ValidationError('That product is not available for retail sale. Check that it is active, marked as retail, and has a retail price.'), 'PRODUCT_NOT_FOR_RETAIL');

    // B-19 (Oct 22 2026): selling past the counted stock needs a MANAGER — the signed-in user holding
    // pos.checkout.override_inventory (→ checkout.manage_overrides, like a void), or a manager at the till typing her PIN
    // (ManagerPinPort: a manager of this salon whose PIN matches). Either way an audit row names who allowed it, the
    // product, the count and the quantity. Without one: refused with a code the POS turns into the PIN prompt.
    if (!product.allowNegativeStock && product.onHand < quantity) {
      const shortBy = quantity - Math.max(0, product.onHand);
      const meta = { productId: product.productId, productName: product.name, onHand: product.onHand, quantity, shortBy, ticketId };
      if (hasPermission(ctx as any, 'pos.checkout.override_inventory')) {
        this.log(ctx, 'manager_override_used', 'manager_override', ticketId, undefined, undefined, { action: 'inventory.negative_stock', by: 'session', managerUserId: ctx.userId, ...meta });
      } else if (String(body?.managerPin ?? '').trim()) {
        const mgr = this.managerPins ? await this.managerPins.verify(ctx, String(body.managerPin).trim()) : null;
        if (!mgr) throw new ForbiddenError('Manager PIN not recognised — a manager of this salon must allow selling past the counted stock.');
        this.log(ctx, 'manager_override_used', 'manager_override', ticketId, undefined, undefined, { action: 'inventory.negative_stock', by: 'manager_pin', managerUserId: mgr.userId, managerName: mgr.name ?? null, ...meta });
      } else {
        const e: any = new ValidationError(`Insufficient stock. Only ${product.onHand} on hand — a manager can allow the sale.`, 'INSUFFICIENT_STOCK', { onHand: product.onHand });
        e.code = 'INSUFFICIENT_STOCK'; e.details = { onHand: product.onHand, quantity, shortBy, managerOverride: 'pin_or_permission' };
        throw e;
      }
    }

    const serviceLineId = randomUUID();
    const ok = await this.repo.addRetailLine(ctx, ticketId, {
      serviceLineId, productId: product.productId, productName: product.name,
      unitPriceCents: product.retailPriceCents, quantity, technicianId: body?.technicianId,
    });
    if (!ok) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');

    const lineTotalCents = product.retailPriceCents * quantity;

    // Stock follows the sale, never gates it: the guest is at the counter and the money is real, so a stale or
    // short count must not block the line that was already written. Best-effort by design — a failure here
    // leaves the sale intact and the discrepancy visible in the ledger rather than losing the sale.
    let stockShortBy = 0;
    try {
      const moved = await this.stock?.recordRetailSale(ctx, product.productId, quantity, ticketId, serviceLineId);   // B-17: the units are stamped with this line
      stockShortBy = moved?.shortBy ?? 0;
    } catch { /* inventory is not load-bearing for taking money */ }

    this.log(ctx, 'retail_line_added', 'pos_serving_service_line', ticketId, undefined, undefined,
      { productId: product.productId, productName: product.name, unitPriceCents: product.retailPriceCents, quantity, lineTotalCents, technicianId: body?.technicianId ?? null });
    this.emitLineEvents(ctx, ticketId, EVENTS.ticketServiceLineAdded);
    // stockShortBy > 0 means we sold more than the system believed was on hand — surfaced, not swallowed.
    return { ok: true as const, serviceLineId, productName: product.name, unitPriceCents: product.retailPriceCents, quantity, lineTotalCents, stockShortBy };
  }

  // ════════ Tech Live Ticket Edit (build doc §5–§9, §12) ════════
  // §6 gate: editable raw ticket statuses; everything else gets the VERBATIM locked message.
  private static readonly TECH_EDITABLE_STATUSES = ['accepted', 'serving'];
  private static readonly LOCKED_MESSAGE = 'This ticket is already locked for checkout or payment. Please contact the front desk.';

  /** Status + master-setting gate shared by every tech edit entry. Throws ValidationError with the §6 verbatim message. */
  private async gateTechEdit(ctx: ServingContext, ticketId: string) {
    const raw = await this.repo.rawTicketStatus(ctx, ticketId);
    if (!raw) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');
    if (!ServingService.TECH_EDITABLE_STATUSES.includes(raw)) throw new ValidationError(ServingService.LOCKED_MESSAGE);
    if (!(await this.repo.techEditFeatureEnabled(ctx))) throw withCode(new ValidationError('Live ticket editing is disabled for this salon.'), 'LIVE_EDITING_DISABLED');
    const settings = await this.repo.settings(ctx);
    if (!settings.allowServiceEditDuringServing) throw new ValidationError('This salon does not allow adding services during serving — ask the front desk.', 'SERVING_ADD_SERVICE_OFF');
    const detail = await this.repo.detail(ctx, ticketId);
    if (!detail) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');
    return { settings, detail };
  }

  /** Single shared line writer for every tech add path (techAddAddOn + techAddService). */
  private async writeTechLine(ctx: ServingContext, ticketId: string, svc: ServiceOption, technicianId: string, notes?: string) {
    const tech = (await this.repo.technicians(ctx)).find((x) => x.technicianId === technicianId);
    const line: SVLine & { notes?: string } = { serviceLineId: randomUUID(), serviceId: svc.serviceId, serviceName: svc.name, category: svc.categoryName, priceCents: svc.priceCents, technicianId, technicianName: tech?.name, status: 'serving', isAddOn: svc.categoryName === 'Add-on', estDurationMin: svc.durationMinutes, notes };
    await this.repo.addService(ctx, ticketId, line);
    const added = this.lineSnap(await this.repo.ticket(ctx, ticketId), line.serviceLineId);
    await this.recordRevision(ctx, ticketId, 'service_added', null, added, line.serviceLineId, this.revSummary('added', null, added));
    return line;
  }

  /** §12 fan-out: tenant+branch room (POS Serving/Checkout/Display/Reports refetch) + the ticket room (Customer App). */
  private emitLineEvents(ctx: ServingContext, ticketId: string, event: (typeof EVENTS)[keyof typeof EVENTS]) {
    // Constitution 8: when the repository emits ticket.service_line_*, the projection consumer publishes the line
    // event AND the recalculated total to the tenant room. The TICKET room (Customer App) is not something the
    // projection covers yet — it is per-ticket, not per-tenant — so that one push stays here on purpose.
    // Constitution 8: when the repository emits ticket.service_line_*, the projection consumer now publishes ALL
    // THREE — the line event and the recalculated total to the tenant room, and the line event to this ticket's
    // own room (the Customer App). The legacy in-process path below is kept for in-memory / DB-less modes.
    if (!this.repo.emitsDomainEvents?.()) {
      this.realtime?.toTenant(ctx as any, event, { ticketId });
      this.realtime?.toTenant(ctx as any, EVENTS.ticketTotalRecalculated, { ticketId });
      this.realtime?.toTicket?.(ticketId, event, { ticketId });
    }
  }

  /** GET edit-options (§10): editability + verbatim lock reason + the full active catalog + the §7 permission matrix. */
  async techEditOptions(ctx: ServingContext, ticketId: string) {
    const raw = await this.repo.rawTicketStatus(ctx, ticketId);
    if (!raw) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');
    const settings = await this.repo.settings(ctx);
    const locked = !ServingService.TECH_EDITABLE_STATUSES.includes(raw);
    const featureOff = !(await this.repo.techEditFeatureEnabled(ctx));
    const masterOff = !settings.allowServiceEditDuringServing;
    const services = await this.repo.services(ctx);
    const categories = Array.from(new Set(services.map((s) => s.categoryName))).sort();
    const pending = await this.repo.listChangeRequests(ctx, { ticketId, status: 'pending' });
    return {
      editable: !locked && !masterOff && !featureOff,
      lockedReason: locked ? ServingService.LOCKED_MESSAGE : featureOff ? 'Live ticket editing is disabled for this salon.' : masterOff ? 'This salon does not allow adding services during serving — ask the front desk.' : null,
      ticketStatus: raw,
      can: { addService: settings.techCanAddService, changeService: settings.techCanChangeService, removeLine: settings.techCanRemoveLine },
      approvalRequiredFor: [
        ...(settings.requireApprovalForChangeService ? ['change_service'] : []),
        ...(settings.requireApprovalForRemoveLine ? ['remove_line'] : []),
        'completed_line_change', 'completed_line_remove',
      ],
      categories,
      services: services.map((s) => ({ serviceId: s.serviceId, name: s.name, categoryName: s.categoryName, priceCents: s.priceCents, durationMinutes: s.durationMinutes, isAddOn: isAddOnCategory(s.categoryName) })),
      pendingChangeRequests: pending,
    };
  }

  /** POST service-lines (§8): add ANY active service to the live ticket. */
  async techAddService(ctx: ServingContext, ticketId: string, body: { serviceId: string; notes?: string }, technicianId: string) {
    const { settings } = await this.gateTechEdit(ctx, ticketId);
    if (!settings.techCanAddService) throw withCode(new ValidationError('You do not have permission to add this service.'), 'PERMISSION_DENIED');
    const svc = await this.repo.serviceCatalog(ctx, String(body.serviceId)); if (!svc) throw withCode(new ValidationError('Service is inactive.'), 'SERVICE_INACTIVE');
    const line = await this.writeTechLine(ctx, ticketId, svc, technicianId, body.notes ? String(body.notes).slice(0, 500) : undefined);
    this.log(ctx, 'technician_service_added', 'pos_serving_service_line', ticketId, undefined, undefined, { serviceId: svc.serviceId, priceCents: svc.priceCents, technicianId });
    this.emitLineEvents(ctx, ticketId, EVENTS.ticketServiceLineAdded);
    return { ok: true as const, serviceLineId: line.serviceLineId, serviceName: svc.name, priceCents: svc.priceCents, message: 'Service added to ticket.' };
  }

  /** PATCH service-lines/:lineId — notes and serving|done status only (price changes go through change-service). */
  async techPatchLine(ctx: ServingContext, ticketId: string, lineId: string, patch: { notes?: string; status?: string }, technicianId: string) {
    const { detail } = await this.gateTechEdit(ctx, ticketId);
    const line = (detail.services as any[]).find((l) => l.serviceLineId === lineId);
    if (!line) throw withCode(new ValidationError('Service line not found'), 'SERVICE_LINE_NOT_FOUND');
    const set: Partial<SVLine> & { notes?: string } = {};
    if (patch.notes !== undefined) set.notes = String(patch.notes).slice(0, 500);
    if (patch.status !== undefined) {
      if (!['serving', 'done'].includes(String(patch.status))) throw withCode(new ValidationError('Line status must be serving or done.'), 'LINE_STATUS_INVALID');
      set.status = patch.status as SVLine['status'];
    }
    if (Object.keys(set).length === 0) throw withCode(new ValidationError('Nothing to update.'), 'NOTHING_TO_UPDATE');
    await this.repo.editService(ctx, ticketId, lineId, set);
    this.log(ctx, 'technician_line_updated', 'pos_serving_service_line', ticketId, undefined, undefined, { lineId, ...set, technicianId } as any);
    this.emitLineEvents(ctx, ticketId, EVENTS.ticketServiceLineUpdated);
    return { ok: true as const };
  }

  /** Change Service (§9): approval-gated; the old/new snapshots are ALWAYS stored as a change-request row. */
  async techChangeService(ctx: ServingContext, ticketId: string, lineId: string, newServiceId: string, reason: string | undefined, technicianId: string) {
    const { settings, detail } = await this.gateTechEdit(ctx, ticketId);
    if (!settings.techCanChangeService) throw withCode(new ValidationError('You do not have permission to change this service.'), 'PERMISSION_DENIED');
    const line = (detail.services as any[]).find((l) => l.serviceLineId === lineId);
    if (!line) throw withCode(new ValidationError('Service line not found'), 'SERVICE_LINE_NOT_FOUND');
    const newSvc = await this.repo.serviceCatalog(ctx, String(newServiceId)); if (!newSvc) throw withCode(new ValidationError('Service is inactive.'), 'SERVICE_INACTIVE');
    const oldSnap = { serviceId: line.serviceId, serviceName: line.serviceName, priceCents: line.priceCents, category: line.category, status: line.status };
    const newSnap = { serviceId: newSvc.serviceId, serviceName: newSvc.name, priceCents: newSvc.priceCents, category: newSvc.categoryName, durationMinutes: newSvc.durationMinutes };
    const needsApproval = settings.requireApprovalForChangeService || line.status === 'done';
    const reqId = await this.repo.insertChangeRequest(ctx, { ticketId, lineId, requestType: 'change_service', oldValue: oldSnap, newValue: newSnap, reason: reason ? String(reason).slice(0, 500) : null, requestedByUserId: ctx.userId, requestedByTechnicianId: technicianId });
    if (needsApproval) {
      this.log(ctx, 'ticket_change_requested', 'ticket_change_request', reqId, undefined, undefined, { ticketId, lineId, type: 'change_service', technicianId });
      if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx as any, EVENTS.ticketChangeRequestCreated as any, { ticketId, requestId: reqId });
      return { ok: true as const, pendingApproval: true as const, requestId: reqId, message: 'This service requires manager approval.' };
    }
    await this.repo.editService(ctx, ticketId, lineId, { serviceId: newSvc.serviceId, serviceName: newSvc.name, category: newSvc.categoryName, priceCents: newSvc.priceCents, estDurationMin: newSvc.durationMinutes, isAddOn: newSvc.categoryName === 'Add-on' });
    await this.repo.updateChangeRequest(ctx, reqId, { status: 'applied' });
    this.log(ctx, 'technician_service_changed', 'pos_serving_service_line', ticketId, undefined, undefined, { lineId, old: oldSnap, new: newSnap, technicianId } as any);
    this.emitLineEvents(ctx, ticketId, EVENTS.ticketServiceLineUpdated);
    return { ok: true as const, pendingApproval: false as const, message: 'Service updated.', priceDeltaCents: newSvc.priceCents - line.priceCents };
  }

  /** DELETE service-lines/:lineId — approval-gated removal; old line is always snapshotted in the request row. */
  async techRemoveLine(ctx: ServingContext, ticketId: string, lineId: string, reason: string | undefined, technicianId: string) {
    const { settings, detail } = await this.gateTechEdit(ctx, ticketId);
    if (!settings.techCanRemoveLine) throw withCode(new ValidationError('You do not have permission to remove this service.'), 'PERMISSION_DENIED');
    const line = (detail.services as any[]).find((l) => l.serviceLineId === lineId);
    if (!line) throw withCode(new ValidationError('Service line not found'), 'SERVICE_LINE_NOT_FOUND');
    const oldSnap = { serviceId: line.serviceId, serviceName: line.serviceName, priceCents: line.priceCents, category: line.category, status: line.status };
    const needsApproval = settings.requireApprovalForRemoveLine || line.status === 'done';
    const reqId = await this.repo.insertChangeRequest(ctx, { ticketId, lineId, requestType: 'remove_line', oldValue: oldSnap, reason: reason ? String(reason).slice(0, 500) : null, requestedByUserId: ctx.userId, requestedByTechnicianId: technicianId });
    if (needsApproval) {
      this.log(ctx, 'ticket_change_requested', 'ticket_change_request', reqId, undefined, undefined, { ticketId, lineId, type: 'remove_line', technicianId });
      if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx as any, EVENTS.ticketChangeRequestCreated as any, { ticketId, requestId: reqId });
      return { ok: true as const, pendingApproval: true as const, requestId: reqId, message: 'This service requires manager approval.' };
    }
    await this.repo.removeService(ctx, ticketId, lineId);
    await this.repo.updateChangeRequest(ctx, reqId, { status: 'applied' });
    this.log(ctx, 'technician_line_removed', 'pos_serving_service_line', ticketId, undefined, undefined, { lineId, old: oldSnap, technicianId } as any);
    this.emitLineEvents(ctx, ticketId, EVENTS.ticketServiceLineRemoved);
    return { ok: true as const, pendingApproval: false as const, message: 'Service removed.' };
  }

  /** §27 capability view for the tech Settings screen — what THIS salon allows. */
  async techWorkflowSettings(ctx: ServingContext) {
    const s = await this.repo.settings(ctx);
    return {
      liveEditEnabled: await this.repo.techEditFeatureEnabled(ctx),
      allowServiceEditDuringServing: s.allowServiceEditDuringServing,
      techCanAddService: s.techCanAddService, techCanChangeService: s.techCanChangeService, techCanRemoveLine: s.techCanRemoveLine,
      requireApprovalForChangeService: s.requireApprovalForChangeService, requireApprovalForRemoveLine: s.requireApprovalForRemoveLine,
    };
  }

  async techListChangeRequests(ctx: ServingContext, ticketId: string) {
    return this.repo.listChangeRequests(ctx, { ticketId });
  }

  /** POS/manager side (§7): pending queue + approve/reject. Approval APPLIES the change through the same writers. */
  async pendingChangeRequests(ctx: ServingContext) {
    this.need(ctx, 'pos.serving.edit_services');
    return this.repo.listChangeRequests(ctx, { status: 'pending' });
  }

  async decideChangeRequest(ctx: ServingContext, requestId: string, decision: 'approve' | 'reject') {
    this.need(ctx, 'pos.serving.edit_services');
    const all = await this.repo.listChangeRequests(ctx, {});
    const req = all.find((r) => r.id === requestId);
    if (!req) throw withCode(new ValidationError('Change request not found'), 'CHANGE_REQUEST_NOT_FOUND');
    if (req.status !== 'pending') throw withCode(new ValidationError('This change request was already decided.'), 'CHANGE_REQUEST_DECIDED');
    const oldName = (req.oldValue as any)?.serviceName || 'service';
    const newName = (req.newValue as any)?.serviceName;
    if (decision === 'reject') {
      await this.repo.updateChangeRequest(ctx, requestId, { status: 'rejected', rejectedByUserId: ctx.userId, rejectedAt: new Date().toISOString() });
      this.log(ctx, 'ticket_change_rejected', 'ticket_change_request', requestId, undefined, undefined, { ticketId: req.ticketId });
      if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx as any, EVENTS.ticketChangeRequestRejected as any, { ticketId: req.ticketId, requestId });
      if (req.requestedByTechnicianId) {
        await this.repo.insertTechNotification(ctx, { technicianId: req.requestedByTechnicianId, type: 'change_request_rejected', title: 'Service change rejected', body: req.requestType === 'remove_line' ? `Removing ${oldName} was not approved.` : `Changing ${oldName}${newName ? ` to ${newName}` : ''} was not approved.`, reference: req.ticketId });
        if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTechnician?.(req.requestedByTechnicianId, EVENTS.ticketChangeRequestRejected as any, { ticketId: req.ticketId, requestId });
      }
      return { ok: true as const, status: 'rejected' as const };
    }
    // approve → apply through the SAME single writers, then mark applied
    const raw = await this.repo.rawTicketStatus(ctx, req.ticketId);
    if (!raw || !ServingService.TECH_EDITABLE_STATUSES.includes(raw)) throw new ValidationError(ServingService.LOCKED_MESSAGE);
    if (req.requestType === 'change_service' && req.lineId) {
      const nv: any = req.newValue || {};
      await this.repo.editService(ctx, req.ticketId, req.lineId, { serviceId: nv.serviceId, serviceName: nv.serviceName, category: nv.category, priceCents: nv.priceCents, estDurationMin: nv.durationMinutes, isAddOn: nv.category === 'Add-on' });
      this.emitLineEvents(ctx, req.ticketId, EVENTS.ticketServiceLineUpdated);
    } else if (req.requestType === 'remove_line' && req.lineId) {
      await this.repo.removeService(ctx, req.ticketId, req.lineId);
      this.emitLineEvents(ctx, req.ticketId, EVENTS.ticketServiceLineRemoved);
    } else {
      throw withCode(new ValidationError('This change request type cannot be auto-applied.'), 'CHANGE_REQUEST_NOT_AUTO');
    }
    await this.repo.updateChangeRequest(ctx, requestId, { status: 'applied', approvedByUserId: ctx.userId, approvedAt: new Date().toISOString() });
    this.log(ctx, 'ticket_change_approved', 'ticket_change_request', requestId, undefined, undefined, { ticketId: req.ticketId });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx as any, EVENTS.ticketChangeRequestApproved as any, { ticketId: req.ticketId, requestId });
    if (req.requestedByTechnicianId) {
      await this.repo.insertTechNotification(ctx, { technicianId: req.requestedByTechnicianId, type: 'change_request_approved', title: 'Service change approved', body: req.requestType === 'remove_line' ? `${oldName} was removed from the ticket.` : `${oldName}${newName ? ` is now ${newName}` : ''} — the ticket total updated.`, reference: req.ticketId });
      if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTechnician?.(req.requestedByTechnicianId, EVENTS.ticketChangeRequestApproved as any, { ticketId: req.ticketId, requestId });
    }
    return { ok: true as const, status: 'applied' as const };
  }

  async services(ctx: ServingContext): Promise<ServiceOption[]> { this.need(ctx, 'pos.serving.view'); return this.repo.services(ctx); }
  async technicians(ctx: ServingContext): Promise<TechnicianOption[]> { this.need(ctx, 'pos.serving.view'); return this.repo.technicians(ctx); }

  // ---- timer ----
  /** Start checks the TECHNICIAN too (merge Oct 12 2026): a fresh start needs an assigned technician who is not already in
   *  a live service — ONE active session per technician, enforced at the service (409 TECHNICIAN_ALREADY_SERVING) AND by
   *  the 586 partial unique index. Resuming a PAUSED ticket re-enters the technician's own session. */
  /** Serving mandate §24–§26, §101: Start is idempotent — a second tap (or a second station) on a ticket already in service
   *  answers the same authoritative state with `duplicate: true` and no second business effect (no second session, no
   *  second service.started, no second revision / audit); the start time is the server's (serving_started_at = now()). */
  async start(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull & { duplicate?: boolean }> {
    this.need(ctx, 'pos.serving.start'); const t = await this.ticketOr404(ctx, id);
    if (t.status === 'in_service' || t.status === 'delayed') return { ...(await this.repo.detail(ctx, id))!, duplicate: true };
    if (t.status === 'completed' || t.status === 'sent_to_service_done') throw withCode(new ValidationError('Service can only be started from not-started or paused'), 'SERVICE_START_STATE_INVALID');
    const fresh = t.status === 'not_started';
    // skills / certification / branch / employment first (never bypassable), then "is she free right now" (fresh only)
    if (t.primaryTechId) await this.assertEligible(ctx, t.primaryTechId, this.ownServiceIdsOf(t, t.primaryTechId), fresh, 'serving.start');
    if (fresh && this.repo.technicianActiveSession) {
      if (!t.primaryTechId) throw withCode(new ValidationError('Assign a technician before starting service'), 'TECHNICIAN_REQUIRED');
      const active = await this.repo.technicianActiveSession(ctx, t.primaryTechId);
      if (active && active.ticketId !== id) throw new ConflictError('This technician is already serving another guest.', 'TECHNICIAN_ALREADY_SERVING');
    }
    let started: boolean | 'duplicate';
    try { started = await this.repo.start(ctx, id); }
    catch (e: any) { if (e?.name === 'ServingSessionConflict') throw new ConflictError('This technician is already serving another guest.', 'TECHNICIAN_ALREADY_SERVING'); throw e; }
    if (started === 'duplicate') return { ...(await this.repo.detail(ctx, id))!, duplicate: true };
    if (!started) {
      // lost the race to another station: the other start is the one business effect — answer it, idempotently
      const now = await this.repo.ticket(ctx, id);
      if (now && (now.status === 'in_service' || now.status === 'delayed')) return { ...(await this.repo.detail(ctx, id))!, duplicate: true };
      throw withCode(new ValidationError('Service can only be started from not-started or paused'), 'SERVICE_START_STATE_INVALID');
    }
    this.log(ctx, fresh ? 'pos_serving_started' : 'pos_serving_resumed', 'pos_serving_timer', id, { status: t.status }, { status: 'in_service' }, { technicianId: t.primaryTechId ?? null });
    await this.project('serviceStarted', ctx, t.primaryTechId, id);
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx as Parameters<RealtimeEmitter['toTenant']>[0], fresh ? EVENTS.serviceStarted : EVENTS.serviceResumed, { ticketId: id });   // §343 exempt: projected from service.started when the repo emits events
    const d = (await this.repo.detail(ctx, id))!; await this.recordRevision(ctx, id, fresh ? 'service_started' : 'service_resumed', null, { status: d.status, startedAt: d.startedAt ?? null }, null, fresh ? 'Service started' : 'Service resumed'); return d;
  }
  async pause(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull> { this.need(ctx, 'pos.serving.pause_resume'); if (!(await this.repo.settings(ctx)).allowPauseResume) throw withCode(new ValidationError('Pause/resume is disabled for this tenant'), 'PAUSE_DISABLED'); await this.ticketOr404(ctx, id); if (!(await this.repo.pause(ctx, id))) throw withCode(new ValidationError('Only an in-service ticket can be paused'), 'TICKET_NOT_IN_SERVICE'); this.log(ctx, 'pos_serving_paused', 'pos_serving_timer', id); await this.project('servicePaused', ctx, (await this.repo.ticket(ctx, id))?.primaryTechId, id); if (!this.repo.emitsDomainEvents?.()) { try { this.realtime?.toTenant(ctx as any, EVENTS.servicePaused, { ticketId: id }); } catch { /* best-effort */ } } const d = (await this.repo.detail(ctx, id))!; await this.recordRevision(ctx, id, 'service_paused', null, { status: d.status, elapsedMinutes: d.elapsedMinutes, pausedAt: d.pausedAt ?? null }, null, `Paused after ${d.elapsedMinutes} min`); return d; }
  async resume(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull> { this.need(ctx, 'pos.serving.pause_resume'); if (!(await this.repo.settings(ctx)).allowPauseResume) throw withCode(new ValidationError('Pause/resume is disabled for this tenant'), 'PAUSE_DISABLED'); await this.ticketOr404(ctx, id); if (!(await this.repo.resume(ctx, id))) throw withCode(new ValidationError('Only a paused ticket can be resumed'), 'TICKET_NOT_PAUSED'); this.log(ctx, 'pos_serving_resumed', 'pos_serving_timer', id); await this.project('serviceStarted', ctx, (await this.repo.ticket(ctx, id))?.primaryTechId, id); if (!this.repo.emitsDomainEvents?.()) { try { this.realtime?.toTenant(ctx as any, EVENTS.serviceResumed, { ticketId: id }); } catch { /* best-effort */ } } const d = (await this.repo.detail(ctx, id))!; await this.recordRevision(ctx, id, 'service_resumed', null, { status: d.status, elapsedMinutes: d.elapsedMinutes }, null, 'Service resumed'); return d; }

  // ---- notes ----
  async updateNotes(ctx: ServingContext, id: string, body: UpdateServiceNotesRequest & { customerVisibleNotes?: string }): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.update_notes'); await this.ticketOr404(ctx, id);
    await this.repo.setNotes(ctx, id, body.notes, body.customerVisibleNotes); this.log(ctx, 'pos_serving_notes_updated', 'pos_serving_notes', id);
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- service lines ----
  async addService(ctx: ServingContext, id: string, body: AddServiceRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.edit_services'); await this.ticketOr404(ctx, id);
    await this.assertNotLocked(ctx, id);
    body = { ...body, managerOverride: this.override(ctx, body?.managerOverride, 'serving.add_service') };
    if (!(await this.repo.settings(ctx)).allowServiceEditDuringServing && !body.managerOverride) throw withCode(new ValidationError('Editing services during serving requires manager override'), 'MANAGER_OVERRIDE_REQUIRED');
    const svc = await this.repo.serviceCatalog(ctx, body.serviceId); if (!svc) throw withCode(new ValidationError('Unknown service'), 'SERVICE_UNKNOWN');
    const tech = body.technicianId ? (await this.repo.technicians(ctx)).find((x) => x.technicianId === body.technicianId) : undefined;
    const price = body.priceOverrideCents != null ? body.priceOverrideCents : svc.priceCents;
    // §48: a manual price is an AUTHORIZED override — the same manager authority as the rest of serving's overrides
    // (pos.booking.override_conflict via resolveManagerOverride above); without it the catalog price stands. (It checked
    // pos.serving.edit_services — the permission every caller of this method already holds — so any desk user could price.)
    if (body.priceOverrideCents != null && body.priceOverrideCents !== svc.priceCents && !body.managerOverride) throw new ForbiddenError('Price override not permitted');
    if (body.technicianId && !tech) throw withCode(new ValidationError('Technician not found in this tenant'), 'TECHNICIAN_NOT_FOUND');
    // §49: the technician who performs an added service owns its line (eligibility: exact skill / branch / certification)
    if (tech) await this.assertEligible(ctx, tech.technicianId, [svc.serviceId], false, 'serving.add_service');
    // w4 SQL: the line's REAL id. §103: with a clientRequestId the id is derived from (ticket, request) — the same logical
    // add-on submitted from two terminals (or twice) writes the same primary key, so the second is a duplicate, not a line
    const crid = String((body as AddServiceRequest & { clientRequestId?: string })?.clientRequestId ?? '').trim();
    const newLineId = crid ? addOnLineIdFor(id, crid, (x) => createHash('sha256').update(x).digest('hex')) : randomUUID();
    const wrote = await this.repo.addService(ctx, id, { serviceLineId: newLineId, serviceId: svc.serviceId, serviceName: svc.name, category: svc.categoryName, priceCents: price, technicianId: tech?.technicianId, technicianName: tech?.name, status: 'serving', isAddOn: isAddOnCategory(svc.categoryName), estDurationMin: svc.durationMinutes });
    if (wrote === 'duplicate') { this.log(ctx, 'pos_serving_service_add_duplicate', 'pos_serving_service_line', id, undefined, undefined, { serviceLineId: newLineId, clientRequestId: crid }); return Object.assign((await this.repo.detail(ctx, id))!, { duplicate: true }); }
    if (!wrote) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');
    const added = this.lineSnap(await this.repo.ticket(ctx, id), newLineId);
    await this.recordRevision(ctx, id, 'service_added', null, added, newLineId, this.revSummary('added', null, added));
    this.log(ctx, 'pos_serving_service_added', 'pos_serving_service_line', id, undefined, added, { serviceId: svc.serviceId, priceCents: price, priceSource: body.priceOverrideCents != null ? 'manager_override' : 'catalog', isAddOn: isAddOnCategory(svc.categoryName), durationMinutes: svc.durationMinutes, technicianId: tech?.technicianId ?? null });
    this.emitLineEvents(ctx, id, EVENTS.ticketServiceLineAdded);
    return (await this.repo.detail(ctx, id))!;
  }
  async editService(ctx: ServingContext, id: string, lineId: string, body: EditServiceLineRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.edit_services'); const t = await this.ticketOr404(ctx, id);
    await this.assertNotLocked(ctx, id);
    await this.assertVersion(ctx, id, (body as any)?.expectedVersion);
    const before = this.lineSnap(t, lineId);
    const patch = { priceCents: body.priceOverrideCents, technicianId: body.technicianId, status: body.status };
    if (!(await this.repo.editService(ctx, id, lineId, patch))) throw withCode(new ValidationError('Service line not found'), 'SERVICE_LINE_NOT_FOUND');
    const after = this.lineSnap(await this.repo.ticket(ctx, id), lineId);
    await this.recordRevision(ctx, id, 'service_updated', before, after, lineId, this.revSummary('updated', before, after));
    this.log(ctx, 'pos_serving_service_updated', 'pos_serving_service_line', id, before, after, { serviceLineId: lineId });
    this.emitLineEvents(ctx, id, EVENTS.ticketServiceLineUpdated);
    return (await this.repo.detail(ctx, id))!;
  }
  async removeService(ctx: ServingContext, id: string, body: RemoveServiceRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.edit_services'); const t = await this.ticketOr404(ctx, id);
    if (!body?.serviceLineId) throw withCode(new ValidationError('A service line is required'), 'SERVICE_LINE_REQUIRED');
    await this.assertNotLocked(ctx, id);
    await this.assertVersion(ctx, id, (body as any)?.expectedVersion);
    const before = this.lineSnap(t, body.serviceLineId);
    if (!(await this.repo.removeService(ctx, id, body.serviceLineId))) throw withCode(new ValidationError('Service line not found'), 'SERVICE_LINE_NOT_FOUND');
    // B-17 (Oct 20 2026): a removed RETAIL line puts its units back (stock moved when the line was added). Best-effort like
    // the sale itself — the line is already gone; a stock hiccup is a ledger discrepancy, never a failed removal.
    let stockReturned = 0;
    try { stockReturned = (await this.stock?.reverseRetailSale?.(ctx, { ticketId: id, lineIds: [body.serviceLineId], reason: `line removed: ${body.reason || 'no reason given'}` }))?.returned ?? 0; } catch { /* inventory is not load-bearing */ }
    await this.recordRevision(ctx, id, 'service_removed', before, null, body.serviceLineId, this.revSummary('removed', before, null));
    this.log(ctx, 'pos_serving_service_removed', 'pos_serving_service_line', id, before, undefined, { serviceLineId: body.serviceLineId, reason: body.reason, ...(stockReturned ? { stockReturned } : {}) });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- technician / helper ----
  async assignTechnician(ctx: ServingContext, id: string, body: AssignServingTechnicianRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.assign_technician'); const t = await this.ticketOr404(ctx, id);
    if (!body?.technicianId) throw new ValidationError('A technician is required', 'TECHNICIAN_REQUIRED');
    await this.assertNotLocked(ctx, id);
    const beforeTech = (t as any).primaryTechName ?? null;
    // Eligibility (ONE function): active, this branch, approved for EVERY line, certification valid; assignable when the
    // ticket is live (a reassignment mid-service must not land on a technician already serving someone else).
    const live = ['in_service', 'paused', 'delayed'].includes(t.status);
    await this.assertEligible(ctx, body.technicianId, this.ownServiceIdsOf(t, t.primaryTechId), live && body.technicianId !== t.primaryTechId, 'serving.assign_technician', this.override(ctx, (body as any)?.managerOverride, 'serving.assign_technician'));
    let assigned: boolean;
    try { assigned = await this.repo.assignTechnician(ctx, id, body.technicianId); }
    catch (e: any) { if (e?.name === 'ServingSessionConflict') throw new ConflictError('This technician is already serving another guest.', 'TECHNICIAN_ALREADY_SERVING'); throw e; }
    if (!assigned) throw withCode(new ValidationError('Technician not found in this tenant'), 'TECHNICIAN_NOT_FOUND');
    if (live) { await this.project('serviceStarted', ctx, body.technicianId, id); if (t.primaryTechId && t.primaryTechId !== body.technicianId) await this.project('serviceCompleted', ctx, t.primaryTechId, id); }
    const afterTech = ((await this.repo.ticket(ctx, id)) as any)?.primaryTechName ?? null;
    await this.recordRevision(ctx, id, 'technician_assigned', { technicianName: beforeTech }, { technicianName: afterTech }, null, `Technician ${beforeTech ?? '—'} → ${afterTech ?? '—'}`);
    this.log(ctx, 'pos_serving_technician_assigned', 'pos_serving_technician_assignment', id, { technicianName: beforeTech }, { technicianName: afterTech }, { technicianId: body.technicianId });
    return (await this.repo.detail(ctx, id))!;
  }
  async assignHelper(ctx: ServingContext, id: string, body: AssignServingHelperRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.assign_helper'); const t = await this.ticketOr404(ctx, id);
    if (!(await this.repo.settings(ctx)).allowHelperTechnician) throw withCode(new ValidationError('Helper technicians are disabled for this tenant'), 'HELPERS_DISABLED');
    await this.assertNotLocked(ctx, id);
    const beforeHelper = (t as any).helperTechName ?? null;
    if (body?.technicianId) {
      if (body.technicianId === t.primaryTechId) throw withCode(new ValidationError('The helper must be a different technician from the primary'), 'HELPER_SAME_AS_PRIMARY');
      // a helper must be eligible for the ticket's services too; a helper session is a TEAM session, so "already serving"
      // does not apply (requireAssignable=false)
      await this.assertEligible(ctx, body.technicianId, this.ownServiceIdsOf(t, t.primaryTechId), false, 'serving.assign_helper');
    }
    if (!(await this.repo.assignHelper(ctx, id, body?.technicianId ?? null))) throw withCode(new ValidationError('Helper technician not found in this tenant'), 'HELPER_TECHNICIAN_NOT_FOUND');
    const afterHelper = ((await this.repo.ticket(ctx, id)) as any)?.helperTechName ?? null;
    await this.recordRevision(ctx, id, 'helper_assigned', { technicianName: beforeHelper }, { technicianName: afterHelper }, null, `Helper ${beforeHelper ?? '—'} → ${afterHelper ?? '—'}`);
    this.log(ctx, 'pos_serving_helper_assigned', 'pos_serving_technician_assignment', id, { technicianName: beforeHelper }, { technicianName: afterHelper }, { technicianId: body?.technicianId ?? null });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- mark done / send to service done (idempotent) ----
  async markDone(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull | { sent: boolean; duplicate: boolean; serviceDoneTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.serving.mark_done'); const t = await this.ticketOr404(ctx, id); const settings = await this.repo.settings(ctx);
    // §36, §104, §141: Mark Ready is ONE canonical transition — a repeat (or a second station) on a visit already at Service
    // Done answers it, idempotently: no second revision, event, workforce projection or Service Done entry
    if (t.status === 'completed' || t.status === 'sent_to_service_done') { this.log(ctx, 'pos_serving_marked_done', 'pos_serving_ticket', id, undefined, undefined, { duplicate: true }); return Object.assign((await this.repo.detail(ctx, id))!, { duplicate: true }); }
    // §30: a guest who was never started cannot jump to Service Done
    const gate = canMarkDone(t.status, t.notes, settings); if (!gate.ok) throw withCode(new ValidationError('Cannot mark done: ' + gate.reason), 'CANNOT_MARK_DONE');
    // BOTH mark-done and send converge on THE Service Done implementation (service-done/service-done-transition.ts)
    // when the adapter has it (Postgres): transactional, status-guarded, idempotent by the completion key, commission
    // stamped, visit / queue / checkout readiness updated, service.completed recorded. The in-memory adapter keeps the
    // status-flip path.
    if (this.repo.completeServiceDone) {
      const r = await this.repo.completeServiceDone(ctx, id, { lock: false, source: 'serving_mark_done' });
      if ('error' in r) throw withCode(new ValidationError('Cannot mark done: ' + r.message), 'CANNOT_MARK_DONE');
      this.log(ctx, 'pos_serving_marked_done', 'pos_serving_ticket', id, { status: t.status }, { status: 'completed' }, { duplicate: r.duplicate, idempotencyKey: r.idempotencyKey });
      if (r.duplicate) return Object.assign((await this.repo.detail(ctx, id))!, { duplicate: true });
    } else {
      if (!(await this.repo.setStatus(ctx, id, 'completed'))) return Object.assign((await this.repo.detail(ctx, id))!, { duplicate: true });   // lost the race: the other station's transition stands
      this.log(ctx, 'pos_serving_marked_done', 'pos_serving_ticket', id, { status: t.status }, { status: 'completed' });
    }
    await this.project('serviceCompleted', ctx, t.primaryTechId, id);   // §37: the technician's availability recalculates
    const dDone = (await this.repo.detail(ctx, id))!;
    await this.recordRevision(ctx, id, 'service_marked_done', null, { status: dDone.status, elapsedMinutes: dDone.elapsedMinutes, estimatedDurationMinutes: dDone.estimatedDurationMinutes ?? null }, null, `Marked done \u00b7 ${dDone.elapsedMinutes} min active`);
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.serviceDone, { ticketId: id });   // Constitution 8: projected from service.completed when the repo emits events
    if (settings.autoSendToServiceDone) return this.sendToServiceDone(ctx, id);
    return dDone;
  }
  async sendToServiceDone(ctx: ServingContext, id: string): Promise<{ sent: boolean; duplicate: boolean; serviceDoneTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.serving.send_to_service_done'); this.need(ctx, 'pos.service_done.view'); const t = await this.ticketOr404(ctx, id);
    const subtotal = subtotalFromServingLines(t.lines); const key = buildServiceDoneIdempotencyKey(id, subtotal);
    // §104: a visit already handed off answers the handoff it had (any key) — one Service Done entry, never an error
    if (t.status === 'sent_to_service_done') { const had = (await this.repo.getSendKey(ctx, id)) ?? key; this.log(ctx, 'pos_serving_sent_to_service_done', 'pos_service_done_transfer', id, undefined, undefined, { duplicate: true, idempotencyKey: had }); return { sent: true, duplicate: true, serviceDoneTicketId: id, idempotencyKey: had }; }
    const gate = canSendToServiceDone(t.status);
    if (!gate.ok && gate.reason === 'ALREADY_SENT') return { sent: true, duplicate: true, serviceDoneTicketId: id, idempotencyKey: (await this.repo.getSendKey(ctx, id)) ?? key };   // another station won the race
    if (!gate.ok) throw withCode(new ValidationError('Cannot send to Service Done: ' + gate.reason), 'CANNOT_SEND_TO_SERVICE_DONE');
    if (this.repo.completeServiceDone) {
      const r = await this.repo.completeServiceDone(ctx, id, { lock: true, source: 'serving_send' });
      if ('error' in r) throw withCode(new ValidationError('Cannot send to Service Done: ' + r.message), 'CANNOT_SEND_TO_SERVICE_DONE');
      await this.recordRevision(ctx, id, 'service_done_locked', null, { lockedTotalCents: r.subtotalCents }, null, `Locked at Service Done (subtotal ${r.subtotalCents}¢)`);
      this.log(ctx, 'pos_serving_sent_to_service_done', 'pos_service_done_transfer', id, undefined, undefined, { duplicate: r.duplicate, idempotencyKey: r.idempotencyKey, subtotalCents: r.subtotalCents });
      if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.serviceDone, { ticketId: id });
      return { sent: true, duplicate: r.duplicate, serviceDoneTicketId: id, idempotencyKey: r.idempotencyKey };
    }
    if (!(await this.repo.setStatus(ctx, id, 'sent_to_service_done'))) return { sent: true, duplicate: true, serviceDoneTicketId: id, idempotencyKey: key };   // §104: one handoff
    await this.repo.setSendKey(ctx, id, key);
    await this.repo.lockServiceDone(ctx, id, ctx.userId, subtotal);
    await this.recordRevision(ctx, id, 'service_done_locked', null, { lockedTotalCents: subtotal }, null, `Locked at Service Done (subtotal ${subtotal}¢)`);
    this.log(ctx, 'pos_serving_sent_to_service_done', 'pos_service_done_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key, subtotalCents: subtotal });
    return { sent: true, duplicate: false, serviceDoneTicketId: id, idempotencyKey: key };
  }

  /** POST /pos/serving/tickets/:id/reopen — audited reopen of a Service-Done-locked ticket back to serving (epic Req §5). */
  async reopenServiceDone(ctx: ServingContext, id: string, body: ReopenServiceDoneRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.send_to_service_done'); await this.ticketOr404(ctx, id);
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw withCode(new ValidationError('A reason is required to reopen a locked ticket.'), 'REOPEN_REASON_REQUIRED');
    const lock = await this.repo.serviceDoneLock(ctx, id);
    if (!lock) throw withCode(new ValidationError('This ticket is not locked at Service Done.'), 'TICKET_NOT_LOCKED');
    await this.repo.reopenServiceDone(ctx, id);
    await this.recordRevision(ctx, id, 'service_done_reopened', { lockedAt: lock.lockedAt, lockedByUserId: lock.lockedByUserId, lockedTotalCents: lock.lockedTotalCents }, { reopenedByUserId: ctx.userId, reason }, null, `Reopened from Service Done: ${reason}`);
    this.log(ctx, 'pos_serving_service_done_reopened', 'pos_serving_ticket', id, { lockedAt: lock.lockedAt }, { reason }, { reason });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx as any, EVENTS.serviceDone as any, { ticketId: id });   // Constitution 8: projected from service.completed
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- §72 Send Update — a guest status update through the communications path ----
  /** The customer-app feed (customer_notifications) is the channel this salon has; SMS answers configured:false honestly
   *  (no Serving component calls an SMS provider). A communication failure never touches the service state. Audited. */
  async notifyCustomer(ctx: ServingContext, id: string, body: { channel?: string; kind?: string }): Promise<{ channel: string; configured: boolean; delivered: boolean; disabledReason?: string }> {
    this.need(ctx, 'pos.communications.send'); const t = await this.ticketOr404(ctx, id);
    const channel = body?.channel === 'sms' ? 'sms' : 'app';
    const kind = ['running_late', 'almost_done', 'ready', 'status'].includes(String(body?.kind)) ? String(body?.kind) : 'status';
    if (channel === 'sms') {
      this.log(ctx, 'pos_serving_customer_update', 'pos_customer_notification', id, undefined, undefined, { channel, kind, status: 'not_configured' });
      return { channel, configured: false, delivered: false, disabledReason: 'SMS provider is not configured yet.' };
    }
    if (!t.customerId) throw withCode(new ValidationError('A customer app profile is required for an app notification'), 'APP_PROFILE_REQUIRED');
    const d = (await this.repo.detail(ctx, id))!;
    const finish = d.estimatedEndAt ? new Date(d.estimatedEndAt) : null;
    const mins = finish ? Math.max(0, Math.round((finish.getTime() - Date.now()) / 60000)) : null;
    const text = kind === 'running_late' ? { title: 'Your service is running a little late', body: mins != null ? `We now expect to finish in about ${mins} min. Thank you for your patience.` : 'Thank you for your patience — we will be with you shortly.' }
      : kind === 'almost_done' ? { title: 'Almost done', body: mins != null ? `Your service should finish in about ${mins} min.` : 'Your service is nearly finished.' }
      : kind === 'ready' ? { title: 'Your service is finished', body: 'Please come to the front desk when you are ready.' }
      : { title: 'Service update', body: d.status === 'paused' ? 'Your service is paused for a moment.' : mins != null ? `Your service is in progress — about ${mins} min to go.` : 'Your service is in progress.' };
    let delivered = false;
    try {
      if (this.repo.insertCustomerNotification) { await this.repo.insertCustomerNotification(ctx, { customerId: t.customerId, type: 'service_update', title: text.title, body: text.body, reference: id }); delivered = true; }
      this.realtime?.toTicket?.(id, EVENTS.ticketServiceLineUpdated, { ticketId: id, kind });   // the Customer App's own ticket room refreshes
    } catch (e: any) { this.log(ctx, 'pos_serving_customer_update_failed', 'pos_customer_notification', id, undefined, undefined, { channel, kind, error: String(e?.message || e).slice(0, 200) }); }
    this.log(ctx, 'pos_serving_customer_update', 'pos_customer_notification', id, undefined, undefined, { channel, kind, delivered });
    return { channel, configured: true, delivered };
  }

  // ---- §58 Send Staff Alert — an internal notice to one technician of THIS salon ----
  async staffAlert(ctx: ServingContext, body: { technicianId?: string; ticketId?: string; message?: string }): Promise<{ ok: true; technicianId: string }> {
    this.need(ctx, 'pos.serving.assign_technician');
    const technicianId = String(body?.technicianId ?? '').trim();
    if (!technicianId) throw withCode(new ValidationError('A technician is required'), 'TECHNICIAN_REQUIRED');
    const tech = (await this.repo.technicians(ctx)).find((x) => x.technicianId === technicianId);   // tenant / branch scoped roster
    if (!tech) throw withCode(new ValidationError('Technician not found in this tenant'), 'TECHNICIAN_NOT_FOUND');
    const message = String(body?.message ?? '').trim().slice(0, 500);
    if (!message) throw withCode(new ValidationError('Type the message first'), 'MESSAGE_REQUIRED');
    const ticketId = body?.ticketId ? String(body.ticketId) : null;
    if (ticketId) await this.ticketOr404(ctx, ticketId);   // a reference to another salon's ticket is refused, not echoed
    await this.repo.insertTechNotification(ctx, { technicianId, type: 'staff_alert', title: 'Front desk alert', body: message, reference: ticketId });
    // the technician app reads technician_notifications on its own refresh (it subscribes to no notification event)
    this.log(ctx, 'pos_serving_staff_alert_sent', 'technician_notification', technicianId, undefined, undefined, { ticketId, length: message.length });
    return { ok: true, technicianId };
  }

  // ---- §56–§57 Auto Balance Floor — analyze + recommend; a person applies a suggestion through assign-technician ----
  async balanceSuggestions(ctx: ServingContext): Promise<{ suggestions: ServingBalanceSuggestion[]; appliesAutomatically: false }> {
    this.need(ctx, 'pos.serving.view');
    const st = await this.repo.query(ctx, { pageSize: 200 });
    const tickets = await Promise.all(st.tickets.items.filter((r) => r.status !== 'completed' && r.status !== 'sent_to_service_done').map((r) => this.repo.ticket(ctx, r.ticketId)));
    const live = tickets.filter((t): t is NonNullable<typeof t> => !!t);
    const suggestions = buildBalanceSuggestions(live.map((t) => ({ ticketId: t.ticketId, ticketNumber: t.ticketNumber, customerName: t.customerName, status: t.status, primaryTechId: t.primaryTechId, primaryTechName: t.primaryTechName, lines: t.lines })), st.staffSummary ? await this.fullStaff(ctx, st) : st.staff);
    this.log(ctx, 'pos_serving_balance_analyzed', 'pos_serving', undefined, undefined, undefined, { suggestions: suggestions.length });
    return { suggestions, appliesAutomatically: false };
  }
  /** the panel is capped (§62) — balancing looks at every technician on duty, so it reads the roster's status rows again */
  private async fullStaff(ctx: ServingContext, st: POSServingFullState) {
    const roster = await this.repo.technicians(ctx);
    const shown = new Map(st.staff.map((s) => [s.technicianId, s.status]));
    return roster.map((r) => ({ technicianId: r.technicianId, name: r.name, status: shown.get(r.technicianId) ?? (r.available ? 'Available' : 'Busy') }));
  }

  // ---- delay ----
  async reportDelay(ctx: ServingContext, id: string, body: ReportDelayRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.report_delay'); await this.ticketOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('A delay reason is required', 'DELAY_REASON_REQUIRED');
    const severity = (body.extraMinutes || 0) > 30 ? 'critical' : (body.extraMinutes || 0) > 10 ? 'late' : 'warning';
    await this.repo.setDelay(ctx, id, severity, body.reason);
    this.log(ctx, 'pos_serving_delay_reported', 'pos_serving_delay', id, undefined, undefined, { reason: body.reason, extraMinutes: body.extraMinutes, customerNotified: body.customerNotified, managerReviewNeeded: body.managerReviewNeeded });
    return (await this.repo.detail(ctx, id))!;
  }
  async clearDelay(ctx: ServingContext, id: string, body: ClearDelayRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.report_delay'); await this.ticketOr404(ctx, id);
    if (!body?.note?.trim()) throw new ValidationError('Clearing a delay requires a note', 'DELAY_CLEAR_NOTE_REQUIRED');
    await this.repo.setDelay(ctx, id, 'none', undefined);
    this.log(ctx, 'pos_serving_delay_cleared', 'pos_serving_delay', id, undefined, undefined, { note: body.note });
    return (await this.repo.detail(ctx, id))!;
  }
}

/** Vietnamese POS §21 (Oct 27 2026): a serving revision's summary as code + vars (srv.SERVING_REV.*), from the stored
 *  action and before / after JSON. Mirrors the English the service writes (recordRevision / revSummary); null when the
 *  action has no summary or the stored data cannot be read (the POS then shows the stored English). Service names,
 *  technician names and a reopen reason are user content and go in as typed. Pure; exported for tests. */
export function revisionSummaryCoded(action: string, beforeRaw: unknown, afterRaw: unknown, summary: string | null): CodedText | null {
  // stored before / after are jsonb (an object); a string is parsed only when it looks like JSON (no try / catch needed)
  const obj = (v: unknown): Record<string, any> | null => {
    if (v == null) return null;
    if (typeof v === 'string') { const t = v.trim(); return t.startsWith('{') && t.endsWith('}') ? safeJson(t) : null; }
    return typeof v === 'object' ? (v as Record<string, any>) : null;
  };
  const before = obj(beforeRaw), after = obj(afterRaw);
  const dash = (v: unknown) => (v == null || v === '' ? '—' : String(v));
  switch (action) {
    case 'service_added': return after?.serviceName ? coded('SERVING_REV.ADDED', { service: after.serviceName }) : coded('SERVING_REV.ADDED_ANY');
    case 'service_removed': return before?.serviceName ? coded('SERVING_REV.REMOVED', { service: before.serviceName }) : coded('SERVING_REV.REMOVED_ANY');
    case 'service_updated': {
      const parts: CodedText[] = [];
      if (before && after) {
        if (before.priceCents !== after.priceCents) parts.push(coded('SERVING_REV.PART_PRICE', { from: before.priceCents, to: after.priceCents }));
        if ((before.technicianName ?? null) !== (after.technicianName ?? null)) parts.push(coded('SERVING_REV.PART_TECH', { from: dash(before.technicianName), to: dash(after.technicianName) }));
        if (before.status !== after.status) parts.push(coded('SERVING_REV.PART_STATUS', { from: '@status.techTicket.' + before.status, to: '@status.techTicket.' + after.status }));
      }
      if (!parts.length) return after?.serviceName ? coded('SERVING_REV.UPDATED', { service: after.serviceName }) : coded('SERVING_REV.UPDATED_ANY');
      // up to three parts, each a nested "@key#pN" reference whose own vars travel as pN_<name>
      const vars: Record<string, string | number> = { service: after?.serviceName ?? '', n: parts.length };
      parts.forEach((p, i) => { vars['p' + i] = '@srv.' + p.code + '#p' + i; for (const [k, v] of Object.entries(p.vars ?? {})) if (v != null) vars[`p${i}_${k}`] = v; });
      return coded('SERVING_REV.UPDATED_PARTS_' + parts.length, vars);
    }
    case 'technician_assigned': return coded('SERVING_REV.TECHNICIAN', { from: dash(before?.technicianName), to: dash(after?.technicianName) });
    case 'helper_assigned': return coded('SERVING_REV.HELPER', { from: dash(before?.technicianName), to: dash(after?.technicianName) });
    case 'service_started': return coded('SERVING_REV.STARTED');
    case 'service_resumed': return coded('SERVING_REV.RESUMED');
    case 'service_paused': return typeof after?.elapsedMinutes === 'number' ? coded('SERVING_REV.PAUSED', { minutes: after.elapsedMinutes }) : null;
    case 'service_marked_done': return typeof after?.elapsedMinutes === 'number' ? coded('SERVING_REV.MARKED_DONE', { minutes: after.elapsedMinutes }) : null;
    case 'service_done_locked': return after?.lockedTotalCents != null ? coded('SERVING_REV.LOCKED', { cents: after.lockedTotalCents }) : null;
    case 'service_done_reopened': return coded('SERVING_REV.REOPENED', { reason: after?.reason ?? '' });
    default: void summary; return null;
  }
}

/** JSON.parse that answers null for a malformed revision payload (logged — never silently swallowed) */
function safeJson(t: string): Record<string, any> | null {
  try { const o = JSON.parse(t); return o && typeof o === 'object' ? o : null; }
  catch (e) { console.warn('[serving] unreadable revision payload', (e as Error)?.message); return null; }
}
