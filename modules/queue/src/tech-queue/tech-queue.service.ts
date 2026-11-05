// tech-queue.service.ts — tenant POS Tech Queue. Resolves tenant/role from session; enforces per-action permissions;
import { resolveCatalogLines, CatalogLineError, resolveManagerOverride, ManagerOverrideForbiddenError } from '@aipowersalon/appointments';
import { skillMatch } from '@aipowersalon/workforce';
// accept/decline drive the acceptance gate; reassignment checks tenant + availability + skill eligibility; move to
// Serving is idempotent and respects the acceptance gate; notifications are honest; delays tracked; audits everything.
// ASYNC: the repository is async (Postgres/Kysely or in-memory), so every use-case awaits the repo.
import { hasPermission, isStaffPrincipal } from '@aipowersalon/permissions';
import {
  POSTechQueueFullState, TechQueueFilters, POSTechQueueTicketRow, POSTechQueueTicketDetail, POSTechQueueTechnicianLane,
  AcceptTicketRequest, DeclineTicketRequest, ReassignTechnicianRequest, UpdateServicesRequest, UpdatePriorityRequest,
  NotifyTechnicianRequest, NotifyCustomerRequest, ReportDelayRequest, ClearDelayRequest, CancelTicketRequest,
  TQRequestedService, canAccept, canMoveToServing, buildServingIdempotencyKey,
} from './tech-queue.dto';
import { TechQueueContext, TechQueueRepositoryPort, ExpiredOffer } from './tech-queue.repository';
import { resolveRecommender, type QueueRecommenderSource } from '../queue/queue-recommender';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }


export interface POSTechQueueAuditLog {
  tenantId: string; branchId?: string; userId: string; role: string; actionType: string; entityType: string;
  entityId?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; createdAt: string;
}

/** Structural push port (kept minimal so Nest-free specs can pass a plain object). */
export type TechQueuePushLike = { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body?: string; data?: Record<string, string>; reference?: string; category?: string }): Promise<unknown> };

export class TechQueueService {
  private audit: POSTechQueueAuditLog[] = [];
  constructor(private readonly repo: TechQueueRepositoryPort, private readonly push?: TechQueuePushLike, private readonly recommender?: QueueRecommenderSource) {}

  private assertUser(ctx: TechQueueContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (!isStaffPrincipal(ctx)) throw new ForbiddenError('Tech Queue is not available for this role');
  }
  private need(ctx: TechQueueContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  /** The ONE manager-override rule (appointments/manager-override.ts): honoured only with pos.booking.override_conflict (audited);
   *  requested without it → 403. It bypasses availability / the acceptance gate — never skills. Merge Oct 12 2026. */
  private override(ctx: TechQueueContext, requested: unknown, action: string): boolean {
    try { return resolveManagerOverride(ctx, requested, (m) => this.log(ctx, 'manager_override_used', 'manager_override', undefined, undefined, undefined, { ...m }), action); }
    catch (e) { if (e instanceof ManagerOverrideForbiddenError) throw new ForbiddenError(e.message); throw e; }
  }
  private log(ctx: TechQueueContext, actionType: string, entityType: string, entityId?: string, before?: any, after?: any, metadata?: any) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, before, after, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): POSTechQueueAuditLog[] { return this.audit.slice(); }
  private async ticketOr404(ctx: TechQueueContext, id: string) { const t = await this.repo.ticket(ctx, id); if (!t) throw new ValidationError('Tech Queue ticket not found'); return t; }
  // Oct 1 2026: the ONE shared rule (@aipowersalon/appointments resolveCatalogLines). The Sep 28 developer tree saved an
  // unknown id as a $0, 30-minute "Archived/Custom Service". Unknown ids are refused now, except one already on this
  // record (an archived service stays exactly as it was); a catalog service takes the catalog's name, duration and price.
  private async resolveServices(ctx: TechQueueContext, ids: string[], existing: TQRequestedService[] = []): Promise<TQRequestedService[]> {
    const catalog = (await this.repo.serviceCatalog(ctx)).map((c: any) => ({ serviceId: c.serviceId, name: c.name, durationMinutes: c.durationMinutes, priceCents: c.priceCents }));
    const kept = existing.map((e) => ({ ...e, durationMinutes: e.estimatedDurationMinutes, priceCents: e.priceCents ?? 0 }));
    try {
      return resolveCatalogLines({ catalog, ids, mayOverride: false, existing: kept as any })
        .map(({ durationMinutes, ...rest }) => ({ ...rest, estimatedDurationMinutes: durationMinutes }) as TQRequestedService);
    } catch (e) { if (e instanceof CatalogLineError) throw new ValidationError(e.message); throw e; }
  }

  // a technician (non-manager) may only act on their own tickets unless they have the reassign (supervisory) permission
  private assertOwnsOrSupervisor(ctx: TechQueueContext, techId: string) {
    // BUILD_PLAN Phase 9: the supervisory key decides — pos.tech_queue.reassign (→ queue.manage, which every front-of-house
    // role holds and a technician does not) — not a list of role names. (The exact
    // permissions.includes('pos.tech_queue.reassign') it sat next to matched nothing a real session carries.)
    if (hasPermission(ctx as any, 'pos.tech_queue.reassign')) return;
    if (ctx.userId !== techId) throw new ForbiddenError('Technicians can only act on their own assigned tickets');
  }

  // ---- read ----
  async getState(ctx: TechQueueContext, f: TechQueueFilters = {}): Promise<POSTechQueueFullState> {
    this.need(ctx, 'pos.tech_queue.view'); const st = await this.repo.query(ctx, f);
    await this.fillBestMatch(ctx, st);
    this.log(ctx, 'pos_tech_queue_viewed', 'pos_tech_queue', undefined, undefined, undefined, { filters: f }); return st;
  }
  /** BUILD_PLAN Phase 6: the waiting guests' best match comes from the AI engine only; none bound → no suggestion. */
  private async fillBestMatch(ctx: TechQueueContext, st: POSTechQueueFullState): Promise<void> {
    const rec = resolveRecommender(this.recommender); const guests = (st as any).waitingGuests as { queueItemId?: string; bestMatchTechnicianName?: string; bestMatchTechnicianId?: string; bestMatchAvatarUrl?: string | null }[] | undefined;
    if (!rec || !guests?.length) return;
    try {
      const m = await rec.suggest(ctx as any, guests.map((g) => g.queueItemId).filter(Boolean) as string[]);
      const avatars = new Map(((st as any).technicianRows || []).map((t: any) => [t.technicianId, t.avatarUrl ?? null]));
      for (const g of guests) { const s = g.queueItemId ? m?.[g.queueItemId] : undefined; if (s?.technicianId && s.name) { g.bestMatchTechnicianId = s.technicianId; g.bestMatchTechnicianName = s.name; g.bestMatchAvatarUrl = (avatars.get(s.technicianId) as string | null) ?? null; } }
    } catch { /* the board never fails because the engine could not answer */ }
  }
  async getKpis(ctx: TechQueueContext) { return (await this.getState(ctx)).kpis; }
  async lanes(ctx: TechQueueContext): Promise<POSTechQueueTechnicianLane[]> { this.need(ctx, 'pos.tech_queue.view'); return this.repo.lanes(ctx); }
  async tickets(ctx: TechQueueContext, f: TechQueueFilters = {}): Promise<{ items: POSTechQueueTicketRow[]; pagination: any }> { this.need(ctx, 'pos.tech_queue.view'); return (await this.repo.query(ctx, f)).tickets; }
  async detail(ctx: TechQueueContext, id: string): Promise<POSTechQueueTicketDetail> { this.need(ctx, 'pos.tech_queue.view'); const d = await this.repo.detail(ctx, id); if (!d) throw new ValidationError('Tech Queue ticket not found'); this.log(ctx, 'pos_tech_queue_ticket_viewed', 'pos_tech_queue_ticket', id); return d; }
  async technicians(ctx: TechQueueContext) { this.need(ctx, 'pos.tech_queue.view'); return (await this.repo.technicians(ctx)).map((t) => ({ technicianId: t.technicianId, name: t.name, workingStatus: t.workingStatus })); }

  // ---- accept / decline ----
  async accept(ctx: TechQueueContext, id: string, _body: AcceptTicketRequest = {}): Promise<POSTechQueueTicketDetail> {
    this.need(ctx, 'pos.tech_queue.accept'); const t = await this.ticketOr404(ctx, id); this.assertOwnsOrSupervisor(ctx, t.assignedTechId);
    const gate = canAccept(t.status); if (!gate.ok) throw new ValidationError('Cannot accept: ' + gate.reason);
    const settings = await this.repo.settings(ctx); const accepted = await this.repo.accept(ctx, id, !settings.technicianMustAcceptTicket || true, typeof _body?.expectedVersion === 'number' ? _body.expectedVersion : undefined);
    if (!accepted) throw new ValidationError('Cannot accept: ticket state changed — please refresh');
    this.log(ctx, 'pos_tech_queue_ticket_accepted', 'pos_tech_queue_ticket', id); return (await this.repo.detail(ctx, id))!;
  }
  async decline(ctx: TechQueueContext, id: string, body: DeclineTicketRequest): Promise<POSTechQueueTicketDetail> {
    this.need(ctx, 'pos.tech_queue.decline'); const t = await this.ticketOr404(ctx, id); this.assertOwnsOrSupervisor(ctx, t.assignedTechId);
    if (!body?.reason?.trim()) throw new ValidationError('Declining requires a reason');
    // ONE guarded decline write shared with the Technician App (tech-queue-offer.ts): only a pending offer flips, the reason
    // lands on the ticket notes, a stale version is a no-op (merge Oct 12 2026 — the POS path had neither guard nor reason).
    if (this.repo.decline) {
      const ok = await this.repo.decline(ctx, id, body.reason.trim(), typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined, body.reasonCode ?? null);
      if (!ok) throw new ValidationError('Cannot decline: only a pending offer can be declined — please refresh');
    } else {
      if (!['assigned', 'waiting_for_acceptance'].includes(t.status)) throw new ValidationError('Cannot decline: only a pending offer can be declined — please refresh');
      await this.repo.setStatus(ctx, id, 'declined');
    }
    this.log(ctx, 'pos_tech_queue_ticket_declined', 'pos_tech_queue_ticket', id, undefined, undefined, { reason: body.reason });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- reassign (eligibility) ----
  async reassign(ctx: TechQueueContext, id: string, body: ReassignTechnicianRequest): Promise<POSTechQueueTicketDetail> {
    this.need(ctx, 'pos.tech_queue.reassign'); const t = await this.ticketOr404(ctx, id);
    if (!(await this.repo.settings(ctx)).allowReassignTechnician) throw new ValidationError('Reassignment is disabled for this tenant');
    if (!body?.technicianId) throw new ValidationError('A technician is required');
    if (!body?.reason?.trim()) throw new ValidationError('Reassignment requires a reason');
    const tech = (await this.repo.technicians(ctx)).find((x) => x.technicianId === body.technicianId);
    if (!tech) throw new ValidationError('Technician not found in this tenant');
    const override = this.override(ctx, body.managerOverride, 'tech_queue.reassign');   // R1
    if (tech.workingStatus !== 'available' && !override) throw new ValidationError('Technician is not available — manager override required');
    const cat = await this.repo.serviceCatalog(ctx);
    const cats = new Set(cat.filter((s) => t.services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    const eligible = skillMatch(tech.skills, [...cats]);
    if (!eligible) throw new ValidationError('Technician is not skilled for the requested services');   // R2: never overridable
    await this.repo.reassign(ctx, id, body.technicianId, body.reason.trim());
    this.log(ctx, 'pos_tech_queue_technician_reassigned', 'pos_tech_queue_assignment', id, undefined, undefined, { technicianId: body.technicianId, reason: body.reason, override });
    const d = (await this.repo.detail(ctx, id))!;
    // Reassignment is a new assignment for the receiving technician — their in-app feed row (developer merge, Oct 6
    // 2026; the Technician app's Notifications screen and Home bell read it), then a push to their device. Best-effort.
    try { await this.repo.insertTechNotification?.(ctx, { technicianId: body.technicianId, type: 'assignment', title: 'Ticket reassigned to you', body: `${d.customerName || 'A guest'} — take over this ticket.`, reference: id }); } catch { /* best-effort */ }
    if (this.push) {
      try {
        const uid = await this.repo.technicianUserId(ctx, body.technicianId);
        if (uid) await this.push.dispatchToUser(ctx.tenantId, uid, { title: 'Ticket reassigned to you', body: 'Take over this ticket in your queue.', data: { kind: 'tech_queue_reassigned', techQueueTicketId: id }, reference: 'tech_queue_reassigned', category: 'QUEUE_ASSIGNMENT' } /* §61 (Phase 13 D): no customer name */);
      } catch { /* best-effort */ }
    }
    return d;
  }

  // ---- services / priority ----
  async updateServices(ctx: TechQueueContext, id: string, body: UpdateServicesRequest): Promise<POSTechQueueTicketDetail> {
    this.need(ctx, 'pos.tech_queue.update_services'); await this.ticketOr404(ctx, id);
    if (!body?.serviceIds?.length) throw new ValidationError('At least one service is required');
    await this.repo.setServices(ctx, id, await this.resolveServices(ctx, body.serviceIds, (await this.repo.ticket(ctx, id))?.services ?? []));
    this.log(ctx, 'pos_tech_queue_services_updated', 'pos_tech_queue_services', id, undefined, undefined, { serviceIds: body.serviceIds });
    return (await this.repo.detail(ctx, id))!;
  }
  async updatePriority(ctx: TechQueueContext, id: string, body: UpdatePriorityRequest): Promise<POSTechQueueTicketDetail> {
    this.need(ctx, 'pos.tech_queue.update_priority'); await this.ticketOr404(ctx, id);
    if (!body?.priority) throw new ValidationError('A priority is required');
    await this.repo.setPriority(ctx, id, body.priority);
    this.log(ctx, 'pos_tech_queue_priority_updated', 'pos_tech_queue_priority', id, undefined, undefined, { priority: body.priority, reason: body.reason });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- notifications (honest) ----
  async notifyTechnician(ctx: TechQueueContext, id: string, body: NotifyTechnicianRequest = {}): Promise<{ channel: string; configured: boolean; disabledReason?: string }> {
    this.need(ctx, 'pos.tech_queue.notify_technician'); await this.ticketOr404(ctx, id); const channel = body?.channel || 'push';
    // technician push / SMS providers are not configured in this package — honest, never faked
    this.log(ctx, 'pos_tech_queue_technician_notified', 'pos_technician_notification', id, undefined, undefined, { channel, status: 'not_configured' });
    return { channel, configured: false, disabledReason: 'Notification provider is not configured yet.' };
  }
  async notifyCustomer(ctx: TechQueueContext, id: string, body: NotifyCustomerRequest): Promise<{ channel: string; configured: boolean; disabledReason?: string }> {
    this.need(ctx, 'pos.tech_queue.notify_customer'); const t = await this.ticketOr404(ctx, id); const channel = body?.channel || 'front_desk';
    if (channel === 'sms') { if (!t.customerPhone) throw new ValidationError('A valid phone is required for an SMS notification'); this.log(ctx, 'pos_tech_queue_customer_notified', 'pos_customer_notification', id, undefined, undefined, { channel, status: 'not_configured' }); return { channel, configured: false, disabledReason: 'Notification provider is not configured yet.' }; }
    if (channel === 'app') { if (!t.customerId) throw new ValidationError('A customer app profile is required'); }
    await this.repo.markCustomerNotified(ctx, id); this.log(ctx, 'pos_tech_queue_customer_notified', 'pos_customer_notification', id, undefined, undefined, { channel }); return { channel, configured: true };
  }

  // ---- delay ----
  async reportDelay(ctx: TechQueueContext, id: string, body: ReportDelayRequest): Promise<POSTechQueueTicketDetail> {
    this.need(ctx, 'pos.tech_queue.report_delay'); await this.ticketOr404(ctx, id);
    if (!body?.reason?.trim()) throw new ValidationError('A delay reason is required');
    const severity = (body.extraMinutes || 0) > 30 ? 'critical' : (body.extraMinutes || 0) > 10 ? 'late' : 'warning';
    await this.repo.setDelay(ctx, id, severity, body.reason);
    this.log(ctx, 'pos_tech_queue_delay_reported', 'pos_tech_queue_delay', id, undefined, undefined, { reason: body.reason, extraMinutes: body.extraMinutes, customerNotified: body.customerNotified, managerReviewNeeded: body.managerReviewNeeded });
    return (await this.repo.detail(ctx, id))!;
  }
  async clearDelay(ctx: TechQueueContext, id: string, body: ClearDelayRequest): Promise<POSTechQueueTicketDetail> {
    this.need(ctx, 'pos.tech_queue.report_delay'); await this.ticketOr404(ctx, id);
    if (!body?.note?.trim()) throw new ValidationError('Clearing a delay requires a note');
    await this.repo.setDelay(ctx, id, 'none', undefined); this.log(ctx, 'pos_tech_queue_delay_cleared', 'pos_tech_queue_delay', id, undefined, undefined, { note: body.note });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- start service / move to serving (idempotent, acceptance-gated) ----
  startService(ctx: TechQueueContext, id: string, managerOverride = false) { return this.moveToServing(ctx, id, managerOverride); }
  async moveToServing(ctx: TechQueueContext, id: string, managerOverride = false): Promise<{ moved: boolean; duplicate: boolean; servingTicketId: string; idempotencyKey: string }> {
    this.need(ctx, 'pos.tech_queue.move_to_serving'); this.need(ctx, 'pos.serving.view'); const t = await this.ticketOr404(ctx, id); this.assertOwnsOrSupervisor(ctx, t.assignedTechId);
    managerOverride = this.override(ctx, managerOverride, 'tech_queue.move_to_serving');   // R1
    const settings = await this.repo.settings(ctx); const key = buildServingIdempotencyKey(id);
    if ((await this.repo.getServingKey(ctx, id)) === key && t.status === 'in_service') { this.log(ctx, 'pos_tech_queue_moved_to_serving', 'pos_serving_transfer', id, undefined, undefined, { duplicate: true }); return { moved: true, duplicate: true, servingTicketId: id, idempotencyKey: key }; }
    const gate = canMoveToServing({ status: t.status, hasTechnician: !!t.assignedTechId, serviceCount: t.services.length, allowWithoutTech: settings.allowMoveToServingWithoutTech, mustAccept: settings.technicianMustAcceptTicket, allowStartWithoutAcceptance: settings.allowStartWithoutAcceptance, managerOverride });
    if (!gate.ok) throw new ValidationError('Cannot start service: ' + gate.reason);
    const started = await this.repo.startServing(ctx, id);
    if (!started) throw new ValidationError('Cannot start service: ticket state changed — please refresh');
    await this.repo.setServingKey(ctx, id, key);
    this.log(ctx, 'pos_tech_queue_started_service', 'pos_serving_transfer', id, undefined, undefined, { idempotencyKey: key });
    this.log(ctx, 'pos_tech_queue_moved_to_serving', 'pos_serving_transfer', id, undefined, undefined, { duplicate: false, idempotencyKey: key });
    return { moved: true, duplicate: false, servingTicketId: id, idempotencyKey: key };
  }

  // ---- cancel (supervisory) ----
  async cancel(ctx: TechQueueContext, id: string, body: CancelTicketRequest): Promise<POSTechQueueTicketDetail> {
    this.need(ctx, 'pos.tech_queue.reassign'); await this.ticketOr404(ctx, id); // cancel is a supervisory action, gated with reassign
    if (!body?.reason?.trim()) throw new ValidationError('Cancelling requires a reason');
    await this.repo.setStatus(ctx, id, 'cancelled'); this.log(ctx, 'pos_tech_queue_cancelled', 'pos_tech_queue_ticket', id, undefined, undefined, { reason: body.reason });
    return (await this.repo.detail(ctx, id))!;
  }

  // ---- §12 acceptance-timeout sweep (system job; no ctx/RBAC — the scheduler is the only caller) ----
  // The server is authoritative for expiry: it flips past-deadline, still-unaccepted offers to 'expired' so the desk
  // (or Auto Balance) re-assigns them. Returns the affected offers so the scheduler can fan out realtime per tenant.
  /** Does the repository record expiries as domain events that the projection delivers? (the sweep then skips its pushes) */
  emitsDomainEvents(): boolean { return !!(this.repo as any).emitsDomainEvents?.(); }
  async expireDueOffers(nowMs: number = Date.now()): Promise<{ expired: number; offers: ExpiredOffer[] }> {
    const offers = await this.repo.expireDueOffers(nowMs);
    return { expired: offers.length, offers };
  }
}
