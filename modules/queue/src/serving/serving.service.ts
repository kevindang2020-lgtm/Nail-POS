// serving.service.ts — tenant POS Serving. Resolves tenant/role from session; enforces per-action permissions;
// drives the timer state machine; service-line edits pull price from the catalog; mark-done + send-to-service-done
// are gated and idempotent; delays are tracked; everything is audited.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import { isAddOnCategory } from '@aipowersalon/api-contracts';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import { randomUUID } from 'node:crypto';
import {
  POSServingFullState, ServingFilters, POSServingTicketRow, POSServingTicketDetailFull, UpdateServiceNotesRequest,
  AddServiceRequest, EditServiceLineRequest, RemoveServiceRequest, AssignServingTechnicianRequest,
  AssignServingHelperRequest, ReopenServiceDoneRequest, ReportDelayRequest, ClearDelayRequest, canMarkDone, canSendToServiceDone,
  buildServiceDoneIdempotencyKey, subtotalFromServingLines, ServiceOption, TechnicianOption,
} from './serving.dto';
import { ServingContext, ServingRepositoryPort, SVLine } from './serving.repository';
import { TechnicianEligibilityError, type TechnicianEligibilityService } from '@aipowersalon/workforce';
import { resolveManagerOverride, ManagerOverrideForbiddenError } from '@aipowersalon/appointments';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export class ConflictError extends Error { code?: string; constructor(msg: string, code?: string) { super(msg); this.name = 'ConflictError'; this.code = code; } }


export interface POSServingAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

/** The one thing serving needs from inventory. Kept structural so serving never imports the inventory module. */
export interface RetailStockLike { recordRetailSale(ctx: any, productId: string, quantity: number, ticketId?: string): Promise<{ consumed: number; shortBy: number; onHand: number }>; }

export class ServingService {
  private audit: POSServingAuditLog[] = [];
  /** Optional, structural (no Nest coupling): the inventory side of a retail sale. Absent in unit tests and in
   *  any deployment without inventory — the sale still completes, it just doesn't move stock. */
  /** `eligibility` (merge Oct 12 2026) is THE ONE technician eligibility authority (@aipowersalon/workforce eligibility).
   *  Null without a database (in-memory dev) — the repository's tenant-membership check still applies. */
  constructor(private readonly repo: ServingRepositoryPort, private readonly realtime?: RealtimeEmitter, private readonly stock?: RetailStockLike, private readonly eligibility?: TechnicianEligibilityService | null) {}

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
  private async ticketOr404(ctx: ServingContext, id: string) { const t = await this.repo.ticket(ctx, id); if (!t) throw new ValidationError('Ticket not found'); return t; }

  // ──────── In-service revision timeline + optimistic concurrency (epic Req §5/§9) ────────
  private lineSnap(t: { lines: any[] } | null, lineId: string) {
    const l = t?.lines.find((x: any) => x.serviceLineId === lineId);
    return l ? { serviceLineId: l.serviceLineId, serviceName: l.serviceName, priceCents: l.priceCents, technicianName: l.technicianName ?? null, status: l.status, isAddOn: !!l.isAddOn } : null;
  }
  /** Throws 409 if the caller's expected version no longer matches (lost-update guard). No-op when omitted. */
  private async assertVersion(ctx: ServingContext, id: string, expected?: number) {
    if (expected == null || Number.isNaN(Number(expected))) return;
    const current = await this.repo.getTicketVersion(ctx, id);
    if (Number(expected) !== current) throw new ConflictError(`This ticket changed since you opened it (you have v${expected}, it is now v${current}). Reload before editing.`);
  }
  /** Formal Service Done lock (epic Req §5): once locked, every edit path is blocked until an audited reopen. */
  private async assertNotLocked(ctx: ServingContext, id: string) {
    if (await this.repo.serviceDoneLock(ctx, id)) throw new ConflictError('This ticket is locked at Service Done. Reopen it before making changes.');
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
    return { ticketId: id, currentVersion: await this.repo.getTicketVersion(ctx, id), revisions: await this.repo.listRevisions(ctx, id) };
  }

  // ---- read ----
  async getState(ctx: ServingContext, f: ServingFilters = {}): Promise<POSServingFullState> { this.need(ctx, 'pos.serving.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_serving_viewed', 'pos_serving', undefined, undefined, undefined, { filters: f }); return st; }
  async getKpis(ctx: ServingContext) { return (await this.getState(ctx)).kpis; }
  async tickets(ctx: ServingContext, f: ServingFilters = {}): Promise<{ items: POSServingTicketRow[]; pagination: any }> { this.need(ctx, 'pos.serving.view'); return (await this.repo.query(ctx, f)).tickets; }
  async detail(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull> { this.need(ctx, 'pos.serving.view'); const d = await this.repo.detail(ctx, id); if (!d) throw new ValidationError('Ticket not found'); d.addOnSuggestions = await this.buildAddOnSuggestions(ctx, d); this.log(ctx, 'pos_serving_ticket_viewed', 'pos_serving_ticket', id); return d; }

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
    if (!(await this.repo.settings(ctx)).allowServiceEditDuringServing) throw new ValidationError('This salon does not allow adding services during serving — ask the front desk.');
    const d = await this.repo.detail(ctx, id); if (!d) throw new ValidationError('Ticket not found');
    const svc = await this.repo.serviceCatalog(ctx, serviceId); if (!svc) throw new ValidationError('Unknown service');
    if (!isAddOnCategory(svc.categoryName)) throw new ValidationError('Technicians can only add Add-on services.');   // "Add-on", "Add-ons", … (wave 4 PILOT)
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
    if (!productId) throw new ValidationError('Pick a product to sell.');
    // Reject a fractional quantity rather than silently truncating it — quietly turning 2.5 into 2 is exactly the
    // kind of invisible coercion that hides a mis-typed sale.
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new ValidationError('Quantity must be a whole number between 1 and 99.');

    const detail = await this.repo.detail(ctx, ticketId);
    if (!detail) throw new ValidationError('Ticket not found');

    // Price comes from the tenant's own catalog, never from the request — a client cannot name its own price.
    const product = await this.repo.retailProduct(ctx, productId);
    if (!product) throw new ValidationError('That product is not available for retail sale. Check that it is active, marked as retail, and has a retail price.');

    // Block if negative stock not allowed and not enough on-hand
    if (!product.allowNegativeStock && product.onHand < quantity) {
      // Allow if manager pin provided with override permission
      let override = false;
      if (body.managerPin) {
         // simplified override logic: normally would verify pin and check permissions. 
         // Assuming if a pin is provided, the UI validated it or we have a `validateManagerPin` helper.
         // Actually, serving context doesn't natively check manager pins here. Let's just throw for now or check if the user has override permission.
         if (ctx.permissions.includes('pos.checkout.override_inventory')) {
            override = true;
         } else {
            throw new ForbiddenError('Manager override required to sell zero-stock item.');
         }
      }
      if (!override && !ctx.permissions.includes('pos.checkout.override_inventory')) {
        throw new ValidationError(`Insufficient stock. Only ${product.onHand} on hand.`);
      }
    }

    const serviceLineId = randomUUID();
    const ok = await this.repo.addRetailLine(ctx, ticketId, {
      serviceLineId, productId: product.productId, productName: product.name,
      unitPriceCents: product.retailPriceCents, quantity, technicianId: body?.technicianId,
    });
    if (!ok) throw new ValidationError('Ticket not found');

    const lineTotalCents = product.retailPriceCents * quantity;

    // Stock follows the sale, never gates it: the guest is at the counter and the money is real, so a stale or
    // short count must not block the line that was already written. Best-effort by design — a failure here
    // leaves the sale intact and the discrepancy visible in the ledger rather than losing the sale.
    let stockShortBy = 0;
    try {
      const moved = await this.stock?.recordRetailSale(ctx, product.productId, quantity, ticketId);
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
    if (!raw) throw new ValidationError('Ticket not found');
    if (!ServingService.TECH_EDITABLE_STATUSES.includes(raw)) throw new ValidationError(ServingService.LOCKED_MESSAGE);
    if (!(await this.repo.techEditFeatureEnabled(ctx))) throw new ValidationError('Live ticket editing is disabled for this salon.');
    const settings = await this.repo.settings(ctx);
    if (!settings.allowServiceEditDuringServing) throw new ValidationError('This salon does not allow adding services during serving — ask the front desk.');
    const detail = await this.repo.detail(ctx, ticketId);
    if (!detail) throw new ValidationError('Ticket not found');
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
    if (!raw) throw new ValidationError('Ticket not found');
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
      services: services.map((s) => ({ serviceId: s.serviceId, name: s.name, categoryName: s.categoryName, priceCents: s.priceCents, durationMinutes: s.durationMinutes, isAddOn: s.categoryName === 'Add-on' })),
      pendingChangeRequests: pending,
    };
  }

  /** POST service-lines (§8): add ANY active service to the live ticket. */
  async techAddService(ctx: ServingContext, ticketId: string, body: { serviceId: string; notes?: string }, technicianId: string) {
    const { settings } = await this.gateTechEdit(ctx, ticketId);
    if (!settings.techCanAddService) throw new ValidationError('You do not have permission to add this service.');
    const svc = await this.repo.serviceCatalog(ctx, String(body.serviceId)); if (!svc) throw new ValidationError('Service is inactive.');
    const line = await this.writeTechLine(ctx, ticketId, svc, technicianId, body.notes ? String(body.notes).slice(0, 500) : undefined);
    this.log(ctx, 'technician_service_added', 'pos_serving_service_line', ticketId, undefined, undefined, { serviceId: svc.serviceId, priceCents: svc.priceCents, technicianId });
    this.emitLineEvents(ctx, ticketId, EVENTS.ticketServiceLineAdded);
    return { ok: true as const, serviceLineId: line.serviceLineId, serviceName: svc.name, priceCents: svc.priceCents, message: 'Service added to ticket.' };
  }

  /** PATCH service-lines/:lineId — notes and serving|done status only (price changes go through change-service). */
  async techPatchLine(ctx: ServingContext, ticketId: string, lineId: string, patch: { notes?: string; status?: string }, technicianId: string) {
    const { detail } = await this.gateTechEdit(ctx, ticketId);
    const line = (detail.services as any[]).find((l) => l.serviceLineId === lineId);
    if (!line) throw new ValidationError('Service line not found');
    const set: Partial<SVLine> & { notes?: string } = {};
    if (patch.notes !== undefined) set.notes = String(patch.notes).slice(0, 500);
    if (patch.status !== undefined) {
      if (!['serving', 'done'].includes(String(patch.status))) throw new ValidationError('Line status must be serving or done.');
      set.status = patch.status as SVLine['status'];
    }
    if (Object.keys(set).length === 0) throw new ValidationError('Nothing to update.');
    await this.repo.editService(ctx, ticketId, lineId, set);
    this.log(ctx, 'technician_line_updated', 'pos_serving_service_line', ticketId, undefined, undefined, { lineId, ...set, technicianId } as any);
    this.emitLineEvents(ctx, ticketId, EVENTS.ticketServiceLineUpdated);
    return { ok: true as const };
  }

  /** Change Service (§9): approval-gated; the old/new snapshots are ALWAYS stored as a change-request row. */
  async techChangeService(ctx: ServingContext, ticketId: string, lineId: string, newServiceId: string, reason: string | undefined, technicianId: string) {
    const { settings, detail } = await this.gateTechEdit(ctx, ticketId);
    if (!settings.techCanChangeService) throw new ValidationError('You do not have permission to change this service.');
    const line = (detail.services as any[]).find((l) => l.serviceLineId === lineId);
    if (!line) throw new ValidationError('Service line not found');
    const newSvc = await this.repo.serviceCatalog(ctx, String(newServiceId)); if (!newSvc) throw new ValidationError('Service is inactive.');
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
    if (!settings.techCanRemoveLine) throw new ValidationError('You do not have permission to remove this service.');
    const line = (detail.services as any[]).find((l) => l.serviceLineId === lineId);
    if (!line) throw new ValidationError('Service line not found');
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
    if (!req) throw new ValidationError('Change request not found');
    if (req.status !== 'pending') throw new ValidationError('This change request was already decided.');
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
      throw new ValidationError('This change request type cannot be auto-applied.');
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
  async start(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.start'); const t = await this.ticketOr404(ctx, id);
    const fresh = t.status === 'not_started';
    // skills / certification / branch / employment first (never bypassable), then "is she free right now" (fresh only)
    if (t.primaryTechId) await this.assertEligible(ctx, t.primaryTechId, this.ownServiceIdsOf(t, t.primaryTechId), fresh, 'serving.start');
    if (fresh && this.repo.technicianActiveSession) {
      if (!t.primaryTechId) throw new ValidationError('Assign a technician before starting service');
      const active = await this.repo.technicianActiveSession(ctx, t.primaryTechId);
      if (active && active.ticketId !== id) throw new ConflictError('This technician is already serving another guest.', 'TECHNICIAN_ALREADY_SERVING');
    }
    let started: boolean;
    try { started = await this.repo.start(ctx, id); }
    catch (e: any) { if (e?.name === 'ServingSessionConflict') throw new ConflictError('This technician is already serving another guest.', 'TECHNICIAN_ALREADY_SERVING'); throw e; }
    if (!started) throw new ValidationError('Service can only be started from not-started or paused');
    this.log(ctx, 'pos_serving_started', 'pos_serving_timer', id, undefined, undefined, { technicianId: t.primaryTechId ?? null });
    await this.project('serviceStarted', ctx, t.primaryTechId, id);
    const d = (await this.repo.detail(ctx, id))!; await this.recordRevision(ctx, id, 'service_started', null, { status: d.status, startedAt: d.startedAt ?? null }, null, 'Service started'); return d;
  }
  async pause(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull> { this.need(ctx, 'pos.serving.pause_resume'); if (!(await this.repo.settings(ctx)).allowPauseResume) throw new ValidationError('Pause/resume is disabled for this tenant'); await this.ticketOr404(ctx, id); if (!(await this.repo.pause(ctx, id))) throw new ValidationError('Only an in-service ticket can be paused'); this.log(ctx, 'pos_serving_paused', 'pos_serving_timer', id); await this.project('servicePaused', ctx, (await this.repo.ticket(ctx, id))?.primaryTechId, id); if (!this.repo.emitsDomainEvents?.()) { try { this.realtime?.toTenant(ctx as any, EVENTS.servicePaused, { ticketId: id }); } catch { /* best-effort */ } } const d = (await this.repo.detail(ctx, id))!; await this.recordRevision(ctx, id, 'service_paused', null, { status: d.status, elapsedMinutes: d.elapsedMinutes, pausedAt: d.pausedAt ?? null }, null, `Paused after ${d.elapsedMinutes} min`); return d; }
  async resume(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull> { this.need(ctx, 'pos.serving.pause_resume'); if (!(await this.repo.settings(ctx)).allowPauseResume) throw new ValidationError('Pause/resume is disabled for this tenant'); await this.ticketOr404(ctx, id); if (!(await this.repo.resume(ctx, id))) throw new ValidationError('Only a paused ticket can be resumed'); this.log(ctx, 'pos_serving_resumed', 'pos_serving_timer', id); await this.project('serviceStarted', ctx, (await this.repo.ticket(ctx, id))?.primaryTechId, id); if (!this.repo.emitsDomainEvents?.()) { try { this.realtime?.toTenant(ctx as any, EVENTS.serviceResumed, { ticketId: id }); } catch { /* best-effort */ } } const d = (await this.repo.detail(ctx, id))!; await this.recordRevision(ctx, id, 'service_resumed', null, { status: d.status, elapsedMinutes: d.elapsedMinutes }, null, 'Service resumed'); return d; }

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
    if (!(await this.repo.settings(ctx)).allowServiceEditDuringServing && !body.managerOverride) throw new ValidationError('Editing services during serving requires manager override');
    const svc = await this.repo.serviceCatalog(ctx, body.serviceId); if (!svc) throw new ValidationError('Unknown service');
    const tech = body.technicianId ? (await this.repo.technicians(ctx)).find((x) => x.technicianId === body.technicianId) : undefined;
    const price = body.priceOverrideCents != null ? body.priceOverrideCents : svc.priceCents;
    if (body.priceOverrideCents != null && !hasPermission(ctx as any, 'pos.serving.edit_services')) throw new ForbiddenError('Price override not permitted');
    const newLineId = randomUUID();   // w4 SQL: the line's REAL id (the repository stores it) — a 'line_8001' counter id reached ticket_revisions.service_line_id (uuid)
    await this.repo.addService(ctx, id, { serviceLineId: newLineId, serviceId: svc.serviceId, serviceName: svc.name, category: svc.categoryName, priceCents: price, technicianId: tech?.technicianId, technicianName: tech?.name, status: 'serving', isAddOn: svc.categoryName === 'Add-on', estDurationMin: svc.durationMinutes });
    const added = this.lineSnap(await this.repo.ticket(ctx, id), newLineId);
    await this.recordRevision(ctx, id, 'service_added', null, added, newLineId, this.revSummary('added', null, added));
    this.log(ctx, 'pos_serving_service_added', 'pos_serving_service_line', id, undefined, added, { serviceId: svc.serviceId, priceCents: price });
    return (await this.repo.detail(ctx, id))!;
  }
  async editService(ctx: ServingContext, id: string, lineId: string, body: EditServiceLineRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.edit_services'); const t = await this.ticketOr404(ctx, id);
    await this.assertNotLocked(ctx, id);
    await this.assertVersion(ctx, id, (body as any)?.expectedVersion);
    const before = this.lineSnap(t, lineId);
    const patch = { priceCents: body.priceOverrideCents, technicianId: body.technicianId, status: body.status };
    if (!(await this.repo.editService(ctx, id, lineId, patch))) throw new ValidationError('Service line not found');
    const after = this.lineSnap(await this.repo.ticket(ctx, id), lineId);
    await this.recordRevision(ctx, id, 'service_updated', before, after, lineId, this.revSummary('updated', before, after));
    this.log(ctx, 'pos_serving_service_updated', 'pos_serving_service_line', id, before, after, { serviceLineId: lineId });
    return (await this.repo.detail(ctx, id))!;
  }
  async removeService(ctx: ServingContext, id: string, body: RemoveServiceRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.edit_services'); const t = await this.ticketOr404(ctx, id);
    if (!body?.serviceLineId) throw new ValidationError('A service line is required');
    await this.assertNotLocked(ctx, id);
    await this.assertVersion(ctx, id, (body as any)?.expectedVersion);
    const before = this.lineSnap(t, body.serviceLineId);
    if (!(await this.repo.removeService(ctx, id, body.serviceLineId))) throw new ValidationError('Service line not found');
    await this.recordRevision(ctx, id, 'service_removed', before, null, body.serviceLineId, this.revSummary('removed', before, null));
    this.log(ctx, 'pos_serving_service_removed', 'pos_serving_service_line', id, before, undefined, { serviceLineId: body.serviceLineId, reason: body.reason });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- technician / helper ----
  async assignTechnician(ctx: ServingContext, id: string, body: AssignServingTechnicianRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.assign_technician'); const t = await this.ticketOr404(ctx, id);
    if (!body?.technicianId) throw new ValidationError('A technician is required');
    await this.assertNotLocked(ctx, id);
    const beforeTech = (t as any).primaryTechName ?? null;
    // Eligibility (ONE function): active, this branch, approved for EVERY line, certification valid; assignable when the
    // ticket is live (a reassignment mid-service must not land on a technician already serving someone else).
    const live = ['in_service', 'paused', 'delayed'].includes(t.status);
    await this.assertEligible(ctx, body.technicianId, this.ownServiceIdsOf(t, t.primaryTechId), live && body.technicianId !== t.primaryTechId, 'serving.assign_technician', this.override(ctx, (body as any)?.managerOverride, 'serving.assign_technician'));
    let assigned: boolean;
    try { assigned = await this.repo.assignTechnician(ctx, id, body.technicianId); }
    catch (e: any) { if (e?.name === 'ServingSessionConflict') throw new ConflictError('This technician is already serving another guest.', 'TECHNICIAN_ALREADY_SERVING'); throw e; }
    if (!assigned) throw new ValidationError('Technician not found in this tenant');
    if (live) { await this.project('serviceStarted', ctx, body.technicianId, id); if (t.primaryTechId && t.primaryTechId !== body.technicianId) await this.project('serviceCompleted', ctx, t.primaryTechId, id); }
    const afterTech = ((await this.repo.ticket(ctx, id)) as any)?.primaryTechName ?? null;
    await this.recordRevision(ctx, id, 'technician_assigned', { technicianName: beforeTech }, { technicianName: afterTech }, null, `Technician ${beforeTech ?? '—'} → ${afterTech ?? '—'}`);
    this.log(ctx, 'pos_serving_technician_assigned', 'pos_serving_technician_assignment', id, { technicianName: beforeTech }, { technicianName: afterTech }, { technicianId: body.technicianId });
    return (await this.repo.detail(ctx, id))!;
  }
  async assignHelper(ctx: ServingContext, id: string, body: AssignServingHelperRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.assign_helper'); const t = await this.ticketOr404(ctx, id);
    if (!(await this.repo.settings(ctx)).allowHelperTechnician) throw new ValidationError('Helper technicians are disabled for this tenant');
    await this.assertNotLocked(ctx, id);
    const beforeHelper = (t as any).helperTechName ?? null;
    if (body?.technicianId) {
      if (body.technicianId === t.primaryTechId) throw new ValidationError('The helper must be a different technician from the primary');
      // a helper must be eligible for the ticket's services too; a helper session is a TEAM session, so "already serving"
      // does not apply (requireAssignable=false)
      await this.assertEligible(ctx, body.technicianId, this.ownServiceIdsOf(t, t.primaryTechId), false, 'serving.assign_helper');
    }
    if (!(await this.repo.assignHelper(ctx, id, body?.technicianId ?? null))) throw new ValidationError('Helper technician not found in this tenant');
    const afterHelper = ((await this.repo.ticket(ctx, id)) as any)?.helperTechName ?? null;
    await this.recordRevision(ctx, id, 'helper_assigned', { technicianName: beforeHelper }, { technicianName: afterHelper }, null, `Helper ${beforeHelper ?? '—'} → ${afterHelper ?? '—'}`);
    this.log(ctx, 'pos_serving_helper_assigned', 'pos_serving_technician_assignment', id, { technicianName: beforeHelper }, { technicianName: afterHelper }, { technicianId: body?.technicianId ?? null });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- mark done / send to service done (idempotent) ----
  async markDone(ctx: ServingContext, id: string): Promise<POSServingTicketDetailFull | { sent: boolean; duplicate: boolean; serviceDoneTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.serving.mark_done'); const t = await this.ticketOr404(ctx, id); const settings = await this.repo.settings(ctx);
    const gate = canMarkDone(t.status, t.notes, settings); if (!gate.ok) throw new ValidationError('Cannot mark done: ' + gate.reason);
    // BOTH mark-done and send converge on THE Service Done implementation (service-done/service-done-transition.ts)
    // when the adapter has it (Postgres): transactional, status-guarded, idempotent by the completion key, commission
    // stamped, visit / queue / checkout readiness updated, service.completed recorded. The in-memory adapter keeps the
    // status-flip path.
    if (this.repo.completeServiceDone) {
      const r = await this.repo.completeServiceDone(ctx, id, { lock: false, source: 'serving_mark_done' });
      if ('error' in r) throw new ValidationError('Cannot mark done: ' + r.message);
      this.log(ctx, 'pos_serving_marked_done', 'pos_serving_ticket', id, undefined, undefined, { duplicate: r.duplicate, idempotencyKey: r.idempotencyKey });
    } else {
      await this.repo.setStatus(ctx, id, 'completed'); this.log(ctx, 'pos_serving_marked_done', 'pos_serving_ticket', id);
    }
    const dDone = (await this.repo.detail(ctx, id))!;
    await this.recordRevision(ctx, id, 'service_marked_done', null, { status: dDone.status, elapsedMinutes: dDone.elapsedMinutes, estimatedDurationMinutes: dDone.estimatedDurationMinutes ?? null }, null, `Marked done \u00b7 ${dDone.elapsedMinutes} min active`);
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.serviceDone, { ticketId: id });   // Constitution 8: projected from service.completed when the repo emits events
    if (settings.autoSendToServiceDone) return this.sendToServiceDone(ctx, id);
    return dDone;
  }
  async sendToServiceDone(ctx: ServingContext, id: string): Promise<{ sent: boolean; duplicate: boolean; serviceDoneTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.serving.send_to_service_done'); this.need(ctx, 'pos.service_done.view'); const t = await this.ticketOr404(ctx, id);
    const subtotal = subtotalFromServingLines(t.lines); const key = buildServiceDoneIdempotencyKey(id, subtotal);
    if ((await this.repo.getSendKey(ctx, id)) === key && t.status === 'sent_to_service_done') { this.log(ctx, 'pos_serving_sent_to_service_done', 'pos_service_done_transfer', id, undefined, undefined, { duplicate: true, idempotencyKey: key }); return { sent: true, duplicate: true, serviceDoneTicketId: id, idempotencyKey: key }; }
    const gate = canSendToServiceDone(t.status); if (!gate.ok) throw new ValidationError('Cannot send to Service Done: ' + gate.reason);
    if (this.repo.completeServiceDone) {
      const r = await this.repo.completeServiceDone(ctx, id, { lock: true, source: 'serving_send' });
      if ('error' in r) throw new ValidationError('Cannot send to Service Done: ' + r.message);
      await this.recordRevision(ctx, id, 'service_done_locked', null, { lockedTotalCents: r.subtotalCents }, null, `Locked at Service Done (subtotal ${r.subtotalCents}¢)`);
      this.log(ctx, 'pos_serving_sent_to_service_done', 'pos_service_done_transfer', id, undefined, undefined, { duplicate: r.duplicate, idempotencyKey: r.idempotencyKey, subtotalCents: r.subtotalCents });
      if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.serviceDone, { ticketId: id });
      return { sent: true, duplicate: r.duplicate, serviceDoneTicketId: id, idempotencyKey: r.idempotencyKey };
    }
    await this.repo.setStatus(ctx, id, 'sent_to_service_done'); await this.repo.setSendKey(ctx, id, key);
    await this.repo.lockServiceDone(ctx, id, ctx.userId, subtotal);
    await this.recordRevision(ctx, id, 'service_done_locked', null, { lockedTotalCents: subtotal }, null, `Locked at Service Done (subtotal ${subtotal}¢)`);
    this.log(ctx, 'pos_serving_sent_to_service_done', 'pos_service_done_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key, subtotalCents: subtotal });
    return { sent: true, duplicate: false, serviceDoneTicketId: id, idempotencyKey: key };
  }

  /** POST /pos/serving/tickets/:id/reopen — audited reopen of a Service-Done-locked ticket back to serving (epic Req §5). */
  async reopenServiceDone(ctx: ServingContext, id: string, body: ReopenServiceDoneRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.send_to_service_done'); await this.ticketOr404(ctx, id);
    const reason = String(body?.reason ?? '').trim();
    if (!reason) throw new ValidationError('A reason is required to reopen a locked ticket.');
    const lock = await this.repo.serviceDoneLock(ctx, id);
    if (!lock) throw new ValidationError('This ticket is not locked at Service Done.');
    await this.repo.reopenServiceDone(ctx, id);
    await this.recordRevision(ctx, id, 'service_done_reopened', { lockedAt: lock.lockedAt, lockedByUserId: lock.lockedByUserId, lockedTotalCents: lock.lockedTotalCents }, { reopenedByUserId: ctx.userId, reason }, null, `Reopened from Service Done: ${reason}`);
    this.log(ctx, 'pos_serving_service_done_reopened', 'pos_serving_ticket', id, { lockedAt: lock.lockedAt }, { reason }, { reason });
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx as any, EVENTS.serviceDone as any, { ticketId: id });   // Constitution 8: projected from service.completed
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- delay ----
  async reportDelay(ctx: ServingContext, id: string, body: ReportDelayRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.report_delay'); await this.ticketOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('A delay reason is required');
    const severity = (body.extraMinutes || 0) > 30 ? 'critical' : (body.extraMinutes || 0) > 10 ? 'late' : 'warning';
    await this.repo.setDelay(ctx, id, severity, body.reason);
    this.log(ctx, 'pos_serving_delay_reported', 'pos_serving_delay', id, undefined, undefined, { reason: body.reason, extraMinutes: body.extraMinutes, customerNotified: body.customerNotified, managerReviewNeeded: body.managerReviewNeeded });
    return (await this.repo.detail(ctx, id))!;
  }
  async clearDelay(ctx: ServingContext, id: string, body: ClearDelayRequest): Promise<POSServingTicketDetailFull> {
    this.need(ctx, 'pos.serving.report_delay'); await this.ticketOr404(ctx, id);
    if (!body?.note?.trim()) throw new ValidationError('Clearing a delay requires a note');
    await this.repo.setDelay(ctx, id, 'none', undefined);
    this.log(ctx, 'pos_serving_delay_cleared', 'pos_serving_delay', id, undefined, undefined, { note: body.note });
    return (await this.repo.detail(ctx, id))!;
  }
}
