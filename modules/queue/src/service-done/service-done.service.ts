// service-done.service.ts — tenant POS Service Done. Resolves tenant/role from session; enforces per-action
// permissions; validates the quality/notes workflow; send-to-checkout is idempotent; notifications are honest
// (no faked delivery); reopen requires a reason + permission; audits everything.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import {
  POSServiceDoneFullState, ServiceDoneFilters, POSServiceDoneTicketRow, POSServiceDoneTicketDetail,
  QualityCheckRequest, UpdateNotesRequest, AssignTechnicianRequest, AssignHelperRequest, NotifyCustomerRequest,
  ReopenServiceRequest, buildSendIdempotencyKey, subtotalFromLines, QualityStatus,
} from './service-done.dto';
import { ServiceDoneContext, ServiceDoneRepositoryPort, type CheckoutTransitionResult } from './service-done.repository';
import type { AuditService } from '@aipowersalon/audit';
import { withCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string, public readonly code?: string, public readonly params?: Record<string, unknown>) { super(msg); this.name = 'ValidationError'; } }   // V-5 (Oct 27 2026): an optional registry code + params beside the English


export interface POSServiceDoneAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

export class ServiceDoneService {
  private audit: POSServiceDoneAuditLog[] = [];
  constructor(private readonly repo: ServiceDoneRepositoryPort, private readonly realtime?: RealtimeEmitter, private readonly auditSvc?: AuditService) {}

  private assertUser(ctx: ServiceDoneContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Service Done is not available for this role');
  }
  private need(ctx: ServiceDoneContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  private needAny(ctx: ServiceDoneContext, perms: string[]) { this.assertUser(ctx); if (!perms.some((p) => ctx.permissions?.includes(p))) throw new ForbiddenError('Missing one of ' + perms.join(', ')); }
  private log(ctx: ServiceDoneContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
    // Bridge to the durable, tenant-scoped audit trail (best-effort; record() never throws). Connects the existing
    // in-process action log to the unified audit_events store the S22 screen reads.
    void this.auditSvc?.record(
      { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role },
      { module: 'service-done', action: actionType, resourceType: entityType, resourceId: entityId, metadata },
    );
  }
  auditLog(): POSServiceDoneAuditLog[] { return this.audit.slice(); }
  /** §29 / §97 / §100: a paid visit belongs to Checkout (refund / void); a visit handed to the front desk is changed only
   *  through Reopen. */
  private assertNotHandedOff(t: { paid: boolean; checkoutStatus: string }) {
    if (t.paid) throw withCode(new ValidationError('This ticket is already paid — use the refund/void workflow in Checkout'), 'TICKET_PAID_USE_REFUND');
    if (t.checkoutStatus === 'sent_to_checkout') throw withCode(new ValidationError('This ticket is locked at Service Done. Reopen it before making changes.'), 'TICKET_LOCKED_AT_SERVICE_DONE');
  }
  /** §75 / §111: another POS on the same board refetches at once (it used to wait for the 15 s safety sync after a quality
   *  decision, a note or a reopen). */
  private changed(ctx: ServiceDoneContext, id: string, change: 'quality' | 'notes' | 'reopened' | 'technician'): void {
    // §343 exempt: a momentary screen signal (the Service Done board changed; refetch, ids only) — the audited write is the fact
    this.realtime?.toTenant(ctx, EVENTS.serviceDone, { ticketId: id, change });
  }
  private async ticketOr404(ctx: ServiceDoneContext, id: string) { const t = await this.repo.ticket(ctx, id); if (!t) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND'); return t; }

  // ---- read ----
  async getState(ctx: ServiceDoneContext, f: ServiceDoneFilters = {}): Promise<POSServiceDoneFullState> { this.need(ctx, 'pos.service_done.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_service_done_viewed', 'pos_service_done', undefined, undefined, undefined, { filters: f }); return st; }
  async getKpis(ctx: ServiceDoneContext) { return (await this.getState(ctx)).kpis; }
  async tickets(ctx: ServiceDoneContext, f: ServiceDoneFilters = {}): Promise<{ items: POSServiceDoneTicketRow[]; pagination: any }> { this.need(ctx, 'pos.service_done.view'); return (await this.repo.query(ctx, f)).tickets; }
  async detail(ctx: ServiceDoneContext, id: string): Promise<POSServiceDoneTicketDetail> { this.need(ctx, 'pos.service_done.view'); const d = await this.repo.detail(ctx, id); if (!d) throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND'); this.log(ctx, 'pos_service_done_ticket_viewed', 'pos_service_done_ticket', id); return d; }

  // ---- quality ----
  async qualityCheck(ctx: ServiceDoneContext, id: string, body: QualityCheckRequest): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.quality_check'); const t = await this.ticketOr404(ctx, id);
    if (!body?.result) throw withCode(new ValidationError('A quality result is required'), 'QUALITY_RESULT_REQUIRED');
    // §29 / §97: completed history is not silently rewritten — once the visit is paid or handed to the front desk, a
    // quality change goes through the explicit Reopen (reason + permission + audit), not an in-place edit
    this.assertNotHandedOff(t);
    const status: QualityStatus = body.result; const beforeQuality = t.qualityStatus;
    const r = await this.repo.setQuality(ctx, id, status, body.checklist, typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined);
    if (r === 'conflict') throw withCode(new ValidationError('This ticket changed since you opened it. Reload it before editing.'), 'TICKET_CHANGED_RELOAD');   // §108
    this.log(ctx, 'pos_service_done_quality_checked', 'pos_service_quality_check', id, { qualityStatus: beforeQuality }, { qualityStatus: status }, { result: status, ...(body.note ? { note: String(body.note).slice(0, 500) } : {}) });
    this.changed(ctx, id, 'quality');
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- notes ----
  async updateNotes(ctx: ServiceDoneContext, id: string, body: UpdateNotesRequest): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.update_notes'); await this.ticketOr404(ctx, id);
    await this.repo.setNotes(ctx, id, body.notes, body.customerVisibleNotes);
    this.log(ctx, 'pos_service_done_notes_updated', 'pos_service_notes', id, undefined, undefined, { hasCustomerVisible: !!body.customerVisibleNotes });
    this.changed(ctx, id, 'notes');
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- technician / helper ----
  async technicians(ctx: ServiceDoneContext) { this.need(ctx, 'pos.service_done.view'); return this.repo.technicians(ctx); }
  async assignTechnician(ctx: ServiceDoneContext, id: string, body: AssignTechnicianRequest): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.assign_technician'); const t = await this.ticketOr404(ctx, id);
    if (!body?.technicianId) throw new ValidationError('A technician is required', 'TECHNICIAN_REQUIRED');
    this.assertNotHandedOff(t);   // §38: ownership is not rewritten after the handoff
    if (!(await this.repo.assignTechnician(ctx, id, body.technicianId))) throw withCode(new ValidationError('Technician not found in this tenant'), 'TECHNICIAN_NOT_FOUND');
    this.log(ctx, 'pos_service_done_technician_assigned', 'pos_service_technician_assignment', id, { technicianId: t.primaryTechId ?? null }, { technicianId: body.technicianId }, { technicianId: body.technicianId });
    this.changed(ctx, id, 'technician');
    return (await this.repo.detail(ctx, id))!;
  }
  async assignHelper(ctx: ServiceDoneContext, id: string, body: AssignHelperRequest): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.assign_technician'); const t = await this.ticketOr404(ctx, id);
    this.assertNotHandedOff(t);
    if (!(await this.repo.assignHelper(ctx, id, body?.technicianId ?? null))) throw withCode(new ValidationError('Helper technician not found in this tenant'), 'HELPER_TECHNICIAN_NOT_FOUND');
    this.log(ctx, 'pos_service_done_helper_assigned', 'pos_service_technician_assignment', id, undefined, undefined, { technicianId: body?.technicianId ?? null });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- mark ready / send to checkout (idempotent) ----
  async markReady(ctx: ServiceDoneContext, id: string): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.send_to_checkout'); await this.ticketOr404(ctx, id); const settings = await this.repo.settings(ctx);
    const r = await this.repo.transitionToCheckout(ctx, id, { target: 'ready_for_checkout', requireApproved: settings.requireQualityCheckBeforeCheckout, requireNotes: settings.requireServiceNotes });
    this.refuse(r, 'ready');
    if (r.outcome === 'moved') {
      this.log(ctx, 'pos_service_done_marked_ready_for_checkout', 'pos_service_done_ticket', id, undefined, { checkoutStatus: 'ready_for_checkout' });
      if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.ticketReadyCheckout, { ticketId: id });
    }
    return (await this.repo.detail(ctx, id))!;
  }
  /**
   * Move to Checkout (§34–§37, §99–§100, §110): ONE atomic transition. Repeated taps, retries and a second station all
   * resolve to the same single handoff — the first caller moves it ('moved'), every other caller gets idempotent success
   * (duplicate: true). A paid ticket is never re-added; a reopened / unapproved one is refused with its reason.
   */
  async sendToCheckout(ctx: ServiceDoneContext, id: string): Promise<{ sent: boolean; duplicate: boolean; checkoutTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.service_done.send_to_checkout'); this.need(ctx, 'pos.checkout.view'); const t = await this.ticketOr404(ctx, id);
    const settings = await this.repo.settings(ctx);
    const subtotal = subtotalFromLines(t.lines); const key = buildSendIdempotencyKey(id, subtotal);
    const r = await this.repo.transitionToCheckout(ctx, id, { target: 'sent_to_checkout', idempotencyKey: key, requireApproved: settings.requireQualityCheckBeforeCheckout, requireNotes: settings.requireServiceNotes });
    this.refuse(r, 'send');
    const duplicate = r.outcome === 'already';
    const usedKey = (r.outcome === 'moved' || r.outcome === 'already') && r.idempotencyKey ? r.idempotencyKey : key;
    this.log(ctx, 'pos_service_done_sent_to_checkout', 'pos_checkout_transfer', id, undefined, undefined, { duplicate, idempotencyKey: usedKey, subtotalCents: subtotal });
    // Constitution 8: projected from ticket.ready_for_checkout when the repository emits events — only for a REAL move
    if (!duplicate) {
      // dual path: the domain event + projection deliver it whenever the publisher is on; this is the fallback
      if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.ticketReadyCheckout, { ticketId: id });
    }
    return { sent: true, duplicate, checkoutTicketId: id, idempotencyKey: usedKey };
  }
  private refuse(r: CheckoutTransitionResult, kind: 'ready' | 'send'): void {
    if (r.outcome === 'not_found') throw withCode(new ValidationError('Ticket not found'), 'TICKET_NOT_FOUND');
    if (r.outcome === 'paid') throw withCode(new ValidationError('This ticket is already paid — use the refund/void workflow in Checkout'), 'TICKET_PAID_USE_REFUND');
    if (r.outcome !== 'blocked') return;
    if (r.reason === 'QUALITY_NOT_APPROVED') throw withCode(new ValidationError(kind === 'ready' ? 'Quality must be approved before this ticket can be marked ready' : 'Cannot send to checkout: QUALITY_NOT_APPROVED'), kind === 'ready' ? 'QUALITY_APPROVAL_REQUIRED' : 'CANNOT_SEND_TO_CHECKOUT');
    if (r.reason === 'NOTES_REQUIRED') throw withCode(new ValidationError(kind === 'ready' ? 'Service notes are required before this ticket can be marked ready' : 'Cannot send to checkout: NOTES_REQUIRED'), kind === 'ready' ? 'SERVICE_NOTES_REQUIRED' : 'CANNOT_SEND_TO_CHECKOUT');
    throw withCode(new ValidationError('Cannot send to checkout: ' + r.reason), 'CANNOT_SEND_TO_CHECKOUT');
  }

  // ---- customer notification (honest) ----
  async notifyCustomer(ctx: ServiceDoneContext, id: string, body: NotifyCustomerRequest): Promise<{ channel: string; configured: boolean; disabledReason?: string }> {
    this.need(ctx, 'pos.service_done.notify_customer'); const t = await this.ticketOr404(ctx, id); const channel = body?.channel || 'front_desk';
    if (channel === 'sms') { if (!t.customerPhone) throw withCode(new ValidationError('A valid phone is required for an SMS notification'), 'SMS_PHONE_INVALID'); this.log(ctx, 'pos_service_done_customer_notified', 'pos_customer_notification', id, undefined, undefined, { channel, status: 'not_configured' }); return { channel, configured: false, disabledReason: 'SMS provider is not configured yet.' }; }
    if (channel === 'app') { if (!t.customerId) throw withCode(new ValidationError('A customer app profile is required for an app notification'), 'APP_PROFILE_REQUIRED'); }
    await this.repo.markNotified(ctx, id); this.log(ctx, 'pos_service_done_customer_notified', 'pos_customer_notification', id, undefined, undefined, { channel }); return { channel, configured: true };
  }

  // ---- reopen ----
  async reopen(ctx: ServiceDoneContext, id: string, body: ReopenServiceRequest): Promise<POSServiceDoneTicketDetail> {
    this.needAny(ctx, ['pos.service_done.reopen', 'pos.serving.reopen']); const t = await this.ticketOr404(ctx, id);
    if (!(await this.repo.settings(ctx)).allowReopenService) throw withCode(new ValidationError('Reopen is disabled for this tenant'), 'REOPEN_DISABLED');
    if (!body?.reason?.trim()) throw new ValidationError('Reopen requires a reason', 'REOPEN_REASON_REQUIRED');
    if (t.paid) throw withCode(new ValidationError('This ticket is already paid — use the refund/void workflow in Checkout'), 'TICKET_PAID_USE_REFUND');
    await this.repo.setCheckoutStatus(ctx, id, 'reopened', 'reopened');
    await this.repo.clearServiceDoneLockOnReopen(ctx, id, { reason: body.reason.trim(), byUserId: ctx.userId });
    this.log(ctx, 'pos_service_done_reopened', 'pos_service_done_ticket', id, undefined, undefined, { reason: body.reason });
    this.changed(ctx, id, 'reopened');
    return (await this.repo.detail(ctx, id))!;
  }
}
