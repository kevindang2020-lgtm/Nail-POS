// technician-help.service.ts — the Request-Help lifecycle engine (no HTTP surface yet; Phase 3b wires controllers + UI).
// A primary technician (or a manager) asks a QUALIFIED helper to take one specific service LINE on an open ticket.
// On accept, the service line's technician is reassigned to the helper — that reassignment is what carries the helper's
// per-line earnings, because the compensation engine already attributes production/commission by service line.
// Eligibility is dependency-inverted (HelpEligibilityPort) so it reuses the canonical technician_services gate
// (TechniciansService.isQualified) in production while staying unit-testable here.

export interface HelpActor {
  tenantId: string; branchId: string | null; technicianId: string; userId?: string | null; isManager?: boolean;
}
export type HelpStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export interface HelpRequest {
  id: string; tenantId: string; branchId: string | null; ticketId: string; serviceLineId: string; serviceId: string | null;
  primaryTechnicianId: string; helperTechnicianId: string; reason: string; note: string | null;
  status: HelpStatus; respondedAt: string | null; declineReason: string | null;
  createdByUserId: string | null; createdByTechnicianId: string | null; createdAt: string;
}
export interface CreateHelpInput {
  ticketId: string; serviceLineId: string; helperTechnicianId: string; reason: string; note?: string | null;
}
export interface ServiceLineRef { serviceLineId: string; ticketId: string; serviceId: string | null; technicianId: string | null; }

export interface QualifiedHelper { technicianId: string; displayName: string; workingStatus: string; shiftStatus: string; status: string; }
export interface HelpEligibilityPort {
  /** Is this technician qualified for this service in this tenant/branch? (canonical technician_services gate) */
  isQualified(tenantId: string, branchId: string | null, technicianId: string, serviceId: string): Promise<boolean>;
  /** Technicians qualified for a service (active), tenant/branch scoped — for the primary's helper picker. */
  listQualified(tenantId: string, branchId: string | null, serviceId: string): Promise<QualifiedHelper[]>;
}
export interface HelpRepositoryPort {
  /** true when help-request changes reach clients through the domain-event projection (outbox AND publisher on) */
  emitsDomainEvents?(): boolean;
  ticketIsOpen(a: HelpActor, ticketId: string): Promise<boolean>;
  loadServiceLine(a: HelpActor, ticketId: string, serviceLineId: string): Promise<ServiceLineRef | null>;
  hasOpenRequest(a: HelpActor, serviceLineId: string, helperTechnicianId: string): Promise<boolean>;
  insertRequest(a: HelpActor, row: Omit<HelpRequest, 'id' | 'createdAt' | 'status' | 'respondedAt' | 'declineReason'>): Promise<HelpRequest>;
  getRequest(a: HelpActor, id: string): Promise<HelpRequest | null>;
  /** Atomic status transition: succeeds only if the row is still in `from`. Returns false if it wasn't (race/duplicate). */
  transition(a: HelpActor, id: string, from: HelpStatus, to: HelpStatus, patch: { respondedAt?: string; declineReason?: string }): Promise<boolean>;
  assignLineTechnician(a: HelpActor, ticketId: string, serviceLineId: string, technicianId: string): Promise<void>;
  listForHelper(a: HelpActor, helperTechnicianId: string, statuses: HelpStatus[]): Promise<HelpRequest[]>;
  listForTicket(a: HelpActor, ticketId: string): Promise<HelpRequest[]>;
  writeAudit(a: HelpActor, action: string, entityId: string, metadata: unknown): Promise<void>;
}
export interface HelpRealtime {
  toTechnician(technicianId: string, event: string, payload?: unknown): void;
  toTenant(ctx: { tenantId: string; branchId: string }, event: string, payload?: unknown): void;
}

export class HelpError extends Error {
  constructor(msg: string, public status = 400, public code = 'help_error') { super(msg); }
}

// Event names (align with realtime-core EVENTS in Phase 3b wiring).
export const HELP_EVENTS = {
  requested: 'technician_help_requested', accepted: 'technician_help_accepted',
  declined: 'technician_help_declined', lineAssigned: 'ticket_line_technician_assigned',
} as const;

export class TechnicianHelpService {
  constructor(
    private readonly repo: HelpRepositoryPort,
    private readonly eligibility: HelpEligibilityPort,
    private readonly rt?: HelpRealtime,
  ) {}

  private emitTenant(a: HelpActor, event: string, payload: unknown) {
    if (this.repo.emitsDomainEvents?.()) return;   // §343: the repository recorded tech_help.*; the projection delivers it
    if (this.rt && a.branchId) { try { this.rt.toTenant({ tenantId: a.tenantId, branchId: a.branchId }, event, payload); } catch { /* best-effort */ } }
  }
  private emitTech(technicianId: string, event: string, payload: unknown) {
    if (this.repo.emitsDomainEvents?.()) return;   // §343: the repository recorded tech_help.*; the projection delivers it
    if (this.rt) { try { this.rt.toTechnician(technicianId, event, payload); } catch { /* best-effort */ } }
  }

  /** Primary technician (or manager) asks a qualified helper to take one service line. */
  async createRequest(a: HelpActor, input: CreateHelpInput): Promise<HelpRequest> {
    const reason = (input.reason || '').trim();
    if (!input.ticketId || !input.serviceLineId || !input.helperTechnicianId) throw new HelpError('ticketId, serviceLineId and helperTechnicianId are required.', 400, 'invalid_input');
    if (!reason) throw new HelpError('A reason is required to request help.', 400, 'reason_required');
    if (input.helperTechnicianId === a.technicianId) throw new HelpError('You cannot request help from yourself.', 400, 'self_help');

    if (!(await this.repo.ticketIsOpen(a, input.ticketId))) throw new HelpError('That ticket is not open for changes.', 409, 'ticket_closed');
    const line = await this.repo.loadServiceLine(a, input.ticketId, input.serviceLineId);
    if (!line) throw new HelpError('That service line was not found on this ticket.', 404, 'line_not_found');
    if (!line.serviceId) throw new HelpError('That line has no service to qualify against.', 400, 'no_service');

    // Backend-enforced eligibility — the helper MUST be qualified for the line's service (client cannot bypass).
    if (!(await this.eligibility.isQualified(a.tenantId, a.branchId, input.helperTechnicianId, line.serviceId))) {
      throw new HelpError('That technician is not qualified for this service.', 409, 'not_qualified');
    }
    if (await this.repo.hasOpenRequest(a, input.serviceLineId, input.helperTechnicianId)) {
      throw new HelpError('There is already an open help request for this service line and technician.', 409, 'duplicate_request');
    }

    const row = await this.repo.insertRequest(a, {
      tenantId: a.tenantId, branchId: a.branchId, ticketId: input.ticketId, serviceLineId: input.serviceLineId, serviceId: line.serviceId,
      primaryTechnicianId: a.technicianId, helperTechnicianId: input.helperTechnicianId, reason, note: input.note ?? null,
      createdByUserId: a.isManager ? (a.userId ?? null) : null, createdByTechnicianId: a.isManager ? null : a.technicianId,
    });
    await this.repo.writeAudit(a, 'technician_help_requested', row.id, { ticketId: row.ticketId, serviceLineId: row.serviceLineId, helper: row.helperTechnicianId, reason });
    this.emitTech(row.helperTechnicianId, HELP_EVENTS.requested, { requestId: row.id, ticketId: row.ticketId, serviceId: row.serviceId, from: row.primaryTechnicianId, reason });
    this.emitTenant(a, HELP_EVENTS.requested, { requestId: row.id, ticketId: row.ticketId });
    return row;
  }

  /** The helper accepts → the service line is reassigned to them (carrying their per-line earnings). */
  async accept(a: HelpActor, id: string): Promise<HelpRequest> {
    const req = await this.mustPending(a, id);
    if (req.helperTechnicianId !== a.technicianId) throw new HelpError('Only the requested technician can accept this.', 403, 'not_helper');
    // Defensive re-check: the helper must still be qualified at accept time.
    if (req.serviceId && !(await this.eligibility.isQualified(a.tenantId, a.branchId, a.technicianId, req.serviceId))) {
      throw new HelpError('You are no longer qualified for this service.', 409, 'not_qualified');
    }
    const ok = await this.repo.transition(a, id, 'pending', 'accepted', { respondedAt: new Date().toISOString() });
    if (!ok) throw new HelpError('This request was already handled.', 409, 'already_handled');   // lost the race / duplicate accept
    await this.repo.assignLineTechnician(a, req.ticketId, req.serviceLineId, a.technicianId);
    await this.repo.writeAudit(a, 'technician_help_accepted', id, { ticketId: req.ticketId, serviceLineId: req.serviceLineId, helper: a.technicianId });
    this.emitTenant(a, HELP_EVENTS.accepted, { requestId: id, ticketId: req.ticketId, helper: a.technicianId });
    this.emitTenant(a, HELP_EVENTS.lineAssigned, { ticketId: req.ticketId, serviceLineId: req.serviceLineId, technicianId: a.technicianId });
    this.emitTech(req.primaryTechnicianId, HELP_EVENTS.accepted, { requestId: id, ticketId: req.ticketId, helper: a.technicianId });
    return { ...req, status: 'accepted' };
  }

  /** The helper declines → the primary is notified and can ask someone else. */
  async decline(a: HelpActor, id: string, declineReason?: string): Promise<HelpRequest> {
    const req = await this.mustPending(a, id);
    if (req.helperTechnicianId !== a.technicianId) throw new HelpError('Only the requested technician can decline this.', 403, 'not_helper');
    const ok = await this.repo.transition(a, id, 'pending', 'declined', { respondedAt: new Date().toISOString(), declineReason: (declineReason || '').trim() || undefined });
    if (!ok) throw new HelpError('This request was already handled.', 409, 'already_handled');
    await this.repo.writeAudit(a, 'technician_help_declined', id, { ticketId: req.ticketId, helper: a.technicianId, reason: declineReason ?? null });
    this.emitTech(req.primaryTechnicianId, HELP_EVENTS.declined, { requestId: id, ticketId: req.ticketId, helper: a.technicianId, reason: declineReason ?? null });
    this.emitTenant(a, HELP_EVENTS.declined, { requestId: id, ticketId: req.ticketId });
    return { ...req, status: 'declined' };
  }

  async listForHelper(a: HelpActor, statuses: HelpStatus[] = ['pending']): Promise<HelpRequest[]> {
    return this.repo.listForHelper(a, a.technicianId, statuses);
  }
  async listForTicket(a: HelpActor, ticketId: string): Promise<HelpRequest[]> {
    return this.repo.listForTicket(a, ticketId);
  }

  /** Helper picker for the primary: technicians qualified for the given line's service, excluding the requester. */
  async qualifiedForLine(a: HelpActor, ticketId: string, serviceLineId: string): Promise<QualifiedHelper[]> {
    const line = await this.repo.loadServiceLine(a, ticketId, serviceLineId);
    if (!line || !line.serviceId) return [];
    const list = await this.eligibility.listQualified(a.tenantId, a.branchId, line.serviceId);
    return list.filter((t) => t.technicianId !== a.technicianId);
  }

  private async mustPending(a: HelpActor, id: string): Promise<HelpRequest> {
    const req = await this.repo.getRequest(a, id);
    if (!req) throw new HelpError('Help request not found.', 404, 'not_found');
    if (req.status !== 'pending') throw new HelpError('This request has already been handled.', 409, 'already_handled');
    return req;
  }
}
