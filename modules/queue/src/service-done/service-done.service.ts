// service-done.service.ts — tenant POS Service Done. Resolves tenant/role from session; enforces per-action
// permissions; validates the quality/notes workflow; send-to-checkout is idempotent; notifications are honest
// (no faked delivery); reopen requires a reason + permission; audits everything.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import {
  POSServiceDoneFullState, ServiceDoneFilters, POSServiceDoneTicketRow, POSServiceDoneTicketDetail,
  QualityCheckRequest, UpdateNotesRequest, AssignTechnicianRequest, AssignHelperRequest, NotifyCustomerRequest,
  ReopenServiceRequest, canSendToCheckout, buildSendIdempotencyKey, subtotalFromLines, QualityStatus,
} from './service-done.dto';
import { ServiceDoneContext, ServiceDoneRepositoryPort } from './service-done.repository';
import type { AuditService } from '@aipowersalon/audit';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }


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
  private async ticketOr404(ctx: ServiceDoneContext, id: string) { const t = await this.repo.ticket(ctx, id); if (!t) throw new ValidationError('Ticket not found'); return t; }

  // ---- read ----
  async getState(ctx: ServiceDoneContext, f: ServiceDoneFilters = {}): Promise<POSServiceDoneFullState> { this.need(ctx, 'pos.service_done.view'); const st = await this.repo.query(ctx, f); this.log(ctx, 'pos_service_done_viewed', 'pos_service_done', undefined, undefined, undefined, { filters: f }); return st; }
  async getKpis(ctx: ServiceDoneContext) { return (await this.getState(ctx)).kpis; }
  async tickets(ctx: ServiceDoneContext, f: ServiceDoneFilters = {}): Promise<{ items: POSServiceDoneTicketRow[]; pagination: any }> { this.need(ctx, 'pos.service_done.view'); return (await this.repo.query(ctx, f)).tickets; }
  async detail(ctx: ServiceDoneContext, id: string): Promise<POSServiceDoneTicketDetail> { this.need(ctx, 'pos.service_done.view'); const d = await this.repo.detail(ctx, id); if (!d) throw new ValidationError('Ticket not found'); this.log(ctx, 'pos_service_done_ticket_viewed', 'pos_service_done_ticket', id); return d; }

  // ---- quality ----
  async qualityCheck(ctx: ServiceDoneContext, id: string, body: QualityCheckRequest): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.quality_check'); await this.ticketOr404(ctx, id);
    if (!body?.result) throw new ValidationError('A quality result is required');
    const status: QualityStatus = body.result;
    await this.repo.setQuality(ctx, id, status, body.checklist);
    this.log(ctx, 'pos_service_done_quality_checked', 'pos_service_quality_check', id, undefined, undefined, { result: status });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- notes ----
  async updateNotes(ctx: ServiceDoneContext, id: string, body: UpdateNotesRequest): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.update_notes'); await this.ticketOr404(ctx, id);
    await this.repo.setNotes(ctx, id, body.notes, body.customerVisibleNotes);
    this.log(ctx, 'pos_service_done_notes_updated', 'pos_service_notes', id, undefined, undefined, { hasCustomerVisible: !!body.customerVisibleNotes });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- technician / helper ----
  async technicians(ctx: ServiceDoneContext) { this.need(ctx, 'pos.service_done.view'); return this.repo.technicians(ctx); }
  async assignTechnician(ctx: ServiceDoneContext, id: string, body: AssignTechnicianRequest): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.assign_technician'); await this.ticketOr404(ctx, id);
    if (!body?.technicianId) throw new ValidationError('A technician is required');
    if (!(await this.repo.assignTechnician(ctx, id, body.technicianId))) throw new ValidationError('Technician not found in this tenant');
    this.log(ctx, 'pos_service_done_technician_assigned', 'pos_service_technician_assignment', id, undefined, undefined, { technicianId: body.technicianId });
    return (await this.repo.detail(ctx, id))!;
  }
  async assignHelper(ctx: ServiceDoneContext, id: string, body: AssignHelperRequest): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.assign_technician'); await this.ticketOr404(ctx, id);
    if (!(await this.repo.assignHelper(ctx, id, body?.technicianId ?? null))) throw new ValidationError('Helper technician not found in this tenant');
    this.log(ctx, 'pos_service_done_helper_assigned', 'pos_service_technician_assignment', id, undefined, undefined, { technicianId: body?.technicianId ?? null });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- mark ready / send to checkout (idempotent) ----
  async markReady(ctx: ServiceDoneContext, id: string): Promise<POSServiceDoneTicketDetail> {
    this.need(ctx, 'pos.service_done.send_to_checkout'); const t = await this.ticketOr404(ctx, id); const settings = await this.repo.settings(ctx);
    if (settings.requireQualityCheckBeforeCheckout && t.qualityStatus !== 'approved') throw new ValidationError('Quality must be approved before this ticket can be marked ready');
    if (settings.requireServiceNotes && !(t.notes || '').trim()) throw new ValidationError('Service notes are required before this ticket can be marked ready');
    await this.repo.setCheckoutStatus(ctx, id, 'ready_for_checkout', 'ready_for_checkout');
    this.log(ctx, 'pos_service_done_marked_ready_for_checkout', 'pos_service_done_ticket', id);
    return (await this.repo.detail(ctx, id))!;
  }
  async sendToCheckout(ctx: ServiceDoneContext, id: string): Promise<{ sent: boolean; duplicate: boolean; checkoutTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.service_done.send_to_checkout'); this.need(ctx, 'pos.checkout.view'); const t = await this.ticketOr404(ctx, id);
    const settings = await this.repo.settings(ctx);
    const subtotal = subtotalFromLines(t.lines); const key = buildSendIdempotencyKey(id, subtotal);
    const existing = await this.repo.getSendKey(ctx, id);
    if (existing === key && t.status === 'sent_to_checkout') { this.log(ctx, 'pos_service_done_sent_to_checkout', 'pos_checkout_transfer', id, undefined, undefined, { duplicate: true, idempotencyKey: key }); return { sent: true, duplicate: true, checkoutTicketId: id, idempotencyKey: key }; }
    const gate = canSendToCheckout({ status: t.status, qualityStatus: t.qualityStatus, notes: t.notes, settings });
    if (!gate.ok) throw new ValidationError('Cannot send to checkout: ' + gate.reason);
    await this.repo.setCheckoutStatus(ctx, id, 'sent_to_checkout', 'sent_to_checkout'); await this.repo.setSendKey(ctx, id, key);
    this.log(ctx, 'pos_service_done_sent_to_checkout', 'pos_checkout_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key, subtotalCents: subtotal });
    // Constitution 8: projected from ticket.ready_for_checkout when the repository emits events.
    if (!this.repo.emitsDomainEvents?.()) this.realtime?.toTenant(ctx, EVENTS.ticketReadyCheckout, { ticketId: id });
    return { sent: true, duplicate: false, checkoutTicketId: id, idempotencyKey: key };
  }

  // ---- customer notification (honest) ----
  async notifyCustomer(ctx: ServiceDoneContext, id: string, body: NotifyCustomerRequest): Promise<{ channel: string; configured: boolean; disabledReason?: string }> {
    this.need(ctx, 'pos.service_done.notify_customer'); const t = await this.ticketOr404(ctx, id); const channel = body?.channel || 'front_desk';
    if (channel === 'sms') { if (!t.customerPhone) throw new ValidationError('A valid phone is required for an SMS notification'); this.log(ctx, 'pos_service_done_customer_notified', 'pos_customer_notification', id, undefined, undefined, { channel, status: 'not_configured' }); return { channel, configured: false, disabledReason: 'SMS provider is not configured yet.' }; }
    if (channel === 'app') { if (!t.customerId) throw new ValidationError('A customer app profile is required for an app notification'); }
    await this.repo.markNotified(ctx, id); this.log(ctx, 'pos_service_done_customer_notified', 'pos_customer_notification', id, undefined, undefined, { channel }); return { channel, configured: true };
  }

  // ---- reopen ----
  async reopen(ctx: ServiceDoneContext, id: string, body: ReopenServiceRequest): Promise<POSServiceDoneTicketDetail> {
    this.needAny(ctx, ['pos.service_done.reopen', 'pos.serving.reopen']); const t = await this.ticketOr404(ctx, id);
    if (!(await this.repo.settings(ctx)).allowReopenService) throw new ValidationError('Reopen is disabled for this tenant');
    if (!body?.reason?.trim()) throw new ValidationError('Reopen requires a reason');
    if (t.paid) throw new ValidationError('This ticket is already paid — use the refund/void workflow in Checkout');
    await this.repo.setCheckoutStatus(ctx, id, 'reopened', 'reopened');
    await this.repo.clearServiceDoneLockOnReopen(ctx, id, { reason: body.reason.trim(), byUserId: ctx.userId });
    this.log(ctx, 'pos_service_done_reopened', 'pos_service_done_ticket', id, undefined, undefined, { reason: body.reason });
    return (await this.repo.detail(ctx, id))!;
  }
}
