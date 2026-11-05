// tech-queue.repository.ts — persistence port + in-memory adapter for POS Tech Queue.
// Tenant-scoped assigned tickets grouped into technician lanes, with server-time assigned-wait tracking. A different
// tenant sees its own (empty) data — isolation. move-to-serving is idempotent (a retry never duplicates a Serving ticket).
import {
  Money, POSTechQueueFullState, POSTechQueueTicketRow, POSTechQueueTicketDetail, POSTechQueueTechnicianLane, TechPerfRow,
  POSTechQueueKpisFull, TechQueueFilters, TQTicketStatus, TQPriority, TQSource, TQDelayStatus, TQWorkingStatus,
  TQRequestedService, TechQueueWorkflowSettings, DEFAULT_TQ_SETTINGS, deriveDelayStatus, workloadMinutes, offerIsExpired,
} from './tech-queue.dto';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';

export interface TechQueueContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

/** §12 — a tech-queue offer the sweep moved to 'expired' (returned for realtime fan-out + re-assignment by the desk). */
export interface ExpiredOffer { id: string; tenantId: string; branchId: string | null; technicianId: string | null; }

export interface TQTicket {
  techQueueTicketId: string; queueItemId?: string; ticketId?: string; customerId: string; customerName: string; customerPhone?: string; isVip: boolean;
  source: TQSource; appointmentId: string | null; services: TQRequestedService[]; priority: TQPriority; status: TQTicketStatus;
  assignedTechId: string; assignedTechName: string; station?: string; assignedAtMs: number; acceptedAtMs: number | null; startedAtMs: number | null; deadlineMs?: number | null;
  notes: string; delayStatus: TQDelayStatus; delayReason?: string; technicianNotifiedAt: string | null; customerNotifiedAt: string | null; servingKey?: string; createdAtMs: number; updatedAt: string;
}
interface TechRec { technicianId: string; name: string; workingStatus: TQWorkingStatus; skills: string[]; }
interface SvcRec { serviceId: string; name: string; categoryName: string; durationMinutes: number; priceCents: Money; }

export interface TechQueueRepositoryPort {
  settings(ctx: TechQueueContext): Promise<TechQueueWorkflowSettings>;
  query(ctx: TechQueueContext, f: TechQueueFilters): Promise<POSTechQueueFullState>;
  ticket(ctx: TechQueueContext, id: string): Promise<TQTicket | null>;
  detail(ctx: TechQueueContext, id: string): Promise<POSTechQueueTicketDetail | null>;
  lanes(ctx: TechQueueContext): Promise<POSTechQueueTechnicianLane[]>;
  technicians(ctx: TechQueueContext): Promise<TechRec[]>;
  /** users.id of the technician's login account (tenant-scoped), for push dispatch. Null when unlinked. */
  technicianUserId(ctx: TechQueueContext, technicianId: string): Promise<string | null>;
  /** developer merge (Oct 6 2026): the receiving technician's in-app feed row (the push above it never names the guest; the feed may). */
  insertTechNotification?(ctx: TechQueueContext, n: { technicianId: string; type: string; title: string; body?: string | null; reference?: string | null }): Promise<void>;
  serviceCatalog(ctx: TechQueueContext): Promise<SvcRec[]>;
  setStatus(ctx: TechQueueContext, id: string, st: TQTicketStatus): Promise<boolean>;
  /** Status-guarded accept; `expectedVersion` (the version the client saw) makes a stale click a no-op — merge Oct 12 2026 (tech-queue-offer.ts). */
  accept(ctx: TechQueueContext, id: string, readyToStart: boolean, expectedVersion?: number | null): Promise<boolean>;
  /** Guarded decline (shared with the Technician app's offer writer): only a pending offer flips; the reason lands on the ticket notes. */
  decline?(ctx: TechQueueContext, id: string, reason: string, expectedVersion?: number | null, reasonCode?: string | null): Promise<boolean>;
  /** Atomically move to 'in_service' ONLY from a startable state (never resurrect cancelled/declined/in_service). Returns false if the row's status changed underneath the caller. */
  startServing(ctx: TechQueueContext, id: string): Promise<boolean>;
  reassign(ctx: TechQueueContext, id: string, technicianId: string, reason?: string | null): Promise<boolean>;
  setServices(ctx: TechQueueContext, id: string, services: TQRequestedService[]): Promise<boolean>;
  setPriority(ctx: TechQueueContext, id: string, priority: TQPriority): Promise<boolean>;
  setDelay(ctx: TechQueueContext, id: string, ds: TQDelayStatus, reason?: string): Promise<boolean>;
  markTechNotified(ctx: TechQueueContext, id: string): Promise<void>;
  markCustomerNotified(ctx: TechQueueContext, id: string): Promise<void>;
  getServingKey(ctx: TechQueueContext, id: string): Promise<string | undefined>;
  setServingKey(ctx: TechQueueContext, id: string, key: string): Promise<void>;
  /** §12 system sweep (no ctx — platform-wide): move every past-deadline, still-unaccepted offer to 'expired'. */
  expireDueOffers(nowMs: number): Promise<ExpiredOffer[]>;
}

const now = () => new Date().toISOString();

export class InMemoryTechQueueRepository implements TechQueueRepositoryPort {
  private store = new Map<string, TQTicket[]>();
  private techs = new Map<string, TechRec[]>();
  private catalog = new Map<string, SvcRec[]>();

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); this.techs.set(tenantId, []); this.catalog.set(tenantId, []); return; }
    const mAgo = (m: number) => Date.now() - m * 60000;
    const cat: SvcRec[] = [
      { serviceId: 'svc_mani', name: 'Signature Manicure', categoryName: 'Manicure', durationMinutes: 45, priceCents: 5500 },
      { serviceId: 'svc_pedi', name: 'Spa Pedicure', categoryName: 'Pedicure', durationMinutes: 55, priceCents: 6500 },
      { serviceId: 'svc_gel', name: 'Gel Add-on', categoryName: 'Add-on', durationMinutes: 15, priceCents: 1500 },
      { serviceId: 'svc_wax', name: 'Eyebrow Wax', categoryName: 'Waxing', durationMinutes: 20, priceCents: 2200 },
    ];
    this.catalog.set(tenantId, cat);
    const svc = (id: string): TQRequestedService => { const s = cat.find((x) => x.serviceId === id)!; return { serviceId: s.serviceId, serviceName: s.name, estimatedDurationMinutes: s.durationMinutes, priceCents: s.priceCents }; };
    this.techs.set(tenantId, [
      { technicianId: 'tech_mia', name: 'Mia', workingStatus: 'available', skills: ['Manicure', 'Add-on'] },
      { technicianId: 'tech_ava', name: 'Ava', workingStatus: 'in_service', skills: ['Pedicure', 'Manicure'] },
      { technicianId: 'tech_leo', name: 'Leo', workingStatus: 'on_break', skills: ['Waxing', 'Manicure'] },
    ]);
    const mk = (id: string, cust: string, phone: string, vip: boolean, source: TQSource, services: TQRequestedService[], priority: TQPriority, status: TQTicketStatus, techId: string, techName: string, assignedMinAgo: number, over: Partial<TQTicket> = {}): TQTicket => ({
      techQueueTicketId: id, queueItemId: 'q_' + id, ticketId: null as any, customerId: 'c_' + id, customerName: cust, customerPhone: phone, isVip: vip, source, appointmentId: source === 'appointment' ? 'appt_' + id : null,
      services, priority, status, assignedTechId: techId, assignedTechName: techName, station: undefined, assignedAtMs: mAgo(assignedMinAgo), acceptedAtMs: ['accepted', 'ready_to_start', 'in_service'].includes(status) ? mAgo(assignedMinAgo - 2) : null, startedAtMs: status === 'in_service' ? mAgo(assignedMinAgo - 5) : null,
      notes: '', delayStatus: status === 'delayed' ? 'late' : 'none', delayReason: status === 'delayed' ? 'Prior service overran' : undefined, technicianNotifiedAt: null, customerNotifiedAt: null, createdAtMs: mAgo(assignedMinAgo), updatedAt: now(), ...over,
    });
    this.store.set(tenantId, [
      mk('tq_6001', 'Grace Kim', '+18565550101', true, 'walk_in', [svc('svc_mani'), svc('svc_gel')], 'vip', 'waiting_for_acceptance', 'tech_mia', 'Mia', 12),
      mk('tq_6002', 'Nora Patel', '+18565550102', false, 'appointment', [svc('svc_pedi')], 'normal', 'accepted', 'tech_ava', 'Ava', 18),
      mk('tq_6003', 'Liv Chen', '+18565550103', false, 'walk_in', [svc('svc_mani')], 'normal', 'ready_to_start', 'tech_mia', 'Mia', 8),
      mk('tq_6004', 'Ivy Park', '+18565550104', false, 'online', [svc('svc_wax')], 'high', 'delayed', 'tech_leo', 'Leo', 35),
      mk('tq_6005', 'Mia Wong', '+18565550105', false, 'appointment', [svc('svc_mani'), svc('svc_pedi')], 'normal', 'assigned', 'tech_ava', 'Ava', 5),
      mk('tq_6006', 'Zoe Diaz', '+18565550106', false, 'walk_in', [svc('svc_gel')], 'normal', 'in_service', 'tech_leo', 'Leo', 40),
    ]);
  }
  private L(ctx: TechQueueContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  private _ticket(ctx: TechQueueContext, id: string) { return this.L(ctx).find((t) => t.techQueueTicketId === id) || null; }
  async ticket(ctx: TechQueueContext, id: string) { return this._ticket(ctx, id); }
  private _settings() { return DEFAULT_TQ_SETTINGS; }
  async settings(_ctx: TechQueueContext) { return this._settings(); }
  private _technicians(ctx: TechQueueContext) { this.ensure(ctx.tenantId); return (this.techs.get(ctx.tenantId) || []).slice(); }
  async technicians(ctx: TechQueueContext) { return this._technicians(ctx); }
  async technicianUserId(ctx: TechQueueContext, technicianId: string) { return (await this.technicians(ctx)).some((t) => t.technicianId === technicianId) ? 'user_' + technicianId : null; }
  techNotifications: { tenantId: string; technicianId: string; type: string; title: string; body: string | null; reference: string | null }[] = [];
  async insertTechNotification(ctx: TechQueueContext, n: { technicianId: string; type: string; title: string; body?: string | null; reference?: string | null }) { this.techNotifications.push({ tenantId: ctx.tenantId, technicianId: n.technicianId, type: n.type, title: n.title, body: n.body ?? null, reference: n.reference ?? null }); }
  private _serviceCatalog(ctx: TechQueueContext) { this.ensure(ctx.tenantId); return (this.catalog.get(ctx.tenantId) || []).slice(); }
  async serviceCatalog(ctx: TechQueueContext) { return this._serviceCatalog(ctx); }

  private assignedWait(t: TQTicket) { const end = t.acceptedAtMs || Date.now(); return Math.max(0, Math.floor((end - t.assignedAtMs) / 60000)); }
  private techEligible(ctx: TechQueueContext, t: TQTicket): boolean {
    const tech = this._technicians(ctx).find((x) => x.technicianId === t.assignedTechId); if (!tech) return false;
    const cats = new Set(this._serviceCatalog(ctx).filter((s) => t.services.some((rs) => rs.serviceId === s.serviceId)).map((s) => s.categoryName));
    return [...cats].every((c) => tech.skills.includes(c));
  }
  private syncDelay(ctx: TechQueueContext, t: TQTicket) { if (t.status === 'delayed') return; t.delayStatus = deriveDelayStatus(this.assignedWait(t), this._settings().delayAlertMinutes); }

  private toRow(ctx: TechQueueContext, t: TQTicket): POSTechQueueTicketRow {
    this.syncDelay(ctx, t);
    return {
      techQueueTicketId: t.techQueueTicketId, queueItemId: t.queueItemId, ticketId: t.ticketId || undefined, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: t.customerId, customerName: t.customerName, customerPhone: t.customerPhone, isVip: t.isVip,
      source: t.source, appointmentId: t.appointmentId, requestedServices: t.services, serviceCount: t.services.length, priority: t.priority, status: t.status,
      assignedTechnicianId: t.assignedTechId, assignedTechnicianName: t.assignedTechName, station: t.station, assignedAt: new Date(t.assignedAtMs).toISOString(),
      acceptedAt: t.acceptedAtMs ? new Date(t.acceptedAtMs).toISOString() : null, startedAt: t.startedAtMs ? new Date(t.startedAtMs).toISOString() : null,
      quotedWaitMinutes: this.assignedWait(t), assignedWaitMinutes: this.assignedWait(t), notes: t.notes, delayStatus: t.delayStatus, createdAt: new Date(t.createdAtMs).toISOString(), updatedAt: t.updatedAt,
    };
  }

  private filtered(ctx: TechQueueContext, f: TechQueueFilters): TQTicket[] {
    let rows = this.L(ctx).slice();
    if (f.search) { const s = f.search.toLowerCase(); rows = rows.filter((t) => [t.customerName, t.customerPhone, t.assignedTechName, t.notes, t.station, ...t.services.map((x) => x.serviceName)].some((x) => (x || '').toLowerCase().includes(s))); }
    if (f.status) rows = rows.filter((t) => t.status === f.status);
    if (f.source) rows = rows.filter((t) => t.source === f.source);
    if (f.priority) rows = rows.filter((t) => t.priority === f.priority);
    if (f.technicianId) rows = rows.filter((t) => t.assignedTechId === f.technicianId);
    if (f.serviceCategory) { const cat = this._serviceCatalog(ctx); rows = rows.filter((t) => t.services.some((rs) => cat.find((s) => s.serviceId === rs.serviceId)?.categoryName === f.serviceCategory)); }
    if (f.station) rows = rows.filter((t) => t.station === f.station);
    if (f.delayStatus) { rows.forEach((t) => this.syncDelay(ctx, t)); rows = rows.filter((t) => t.delayStatus === f.delayStatus); }
    return rows;
  }

  async lanes(ctx: TechQueueContext) { return this._lanes(ctx); }
  private _lanes(ctx: TechQueueContext): POSTechQueueTechnicianLane[] {
    const all = this.L(ctx); all.forEach((t) => this.syncDelay(ctx, t));
    return this._technicians(ctx).map((tech) => {
      const tickets = all.filter((t) => t.assignedTechId === tech.technicianId && !['cancelled', 'declined'].includes(t.status));
      return {
        technicianId: tech.technicianId, technicianName: tech.name, workingStatus: tech.workingStatus,
        activeTicketCount: tickets.filter((t) => !['in_service'].includes(t.status)).length,
        acceptedTicketCount: tickets.filter((t) => ['accepted', 'ready_to_start'].includes(t.status)).length,
        delayedTicketCount: tickets.filter((t) => t.status === 'delayed' || t.delayStatus === 'late' || t.delayStatus === 'critical').length,
        estimatedWorkloadMinutes: workloadMinutes(tickets.map((t) => ({ requestedServices: t.services, status: t.status }))),
        tickets: tickets.map((t) => this.toRow(ctx, t)),
      };
    });
  }

  async query(ctx: TechQueueContext, f: TechQueueFilters) {
    const all = this.L(ctx); all.forEach((t) => this.syncDelay(ctx, t));
    const matched = this.filtered(ctx, f);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = matched.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = matched.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((t) => this.toRow(ctx, t));

    const active = all.filter((t) => !['cancelled', 'declined', 'in_service'].includes(t.status));
    const waits = active.map((t) => this.assignedWait(t));
    const techs = this._technicians(ctx);
    const kpis: POSTechQueueKpisFull = {
      assignedTickets: active.length,
      waitingForAcceptance: all.filter((t) => ['assigned', 'waiting_for_acceptance'].includes(t.status)).length,
      acceptedTickets: all.filter((t) => t.status === 'accepted').length,
      readyToStart: all.filter((t) => t.status === 'ready_to_start').length,
      delayedTickets: all.filter((t) => t.status === 'delayed' || t.delayStatus === 'late' || t.delayStatus === 'critical').length,
      activeTechnicians: new Set(active.map((t) => t.assignedTechId)).size,
      availableTechnicians: techs.filter((t) => t.workingStatus === 'available').length,
      averageAssignedWaitMinutes: waits.length ? Math.round(waits.reduce((a, w) => a + w, 0) / waits.length) : 0,
      laborRevenueTodayCents: 0,
      utilizationTodayPercent: 0,
      upsellCapturePercent: 0,
      scheduledTechnicians: techs.length, servicesInProgress: all.filter((t) => t.status === 'in_service').length, waitingForAssignment: 0, avgTurnTimeMinutes: 0,
    };

    const techPerformanceToday: TechPerfRow[] = this._lanes(ctx).map((ln) => ({
      technicianId: ln.technicianId, technicianName: ln.technicianName, services: ln.tickets.length,
      revenueCents: ln.tickets.reduce((a, t) => a + (t.requestedServices || []).reduce((b, sv) => b + (sv.priceCents || 0), 0), 0),
      tipCents: 0, ratingAvg: null,
    })).filter((r) => r.services > 0).sort((a, b) => b.revenueCents - a.revenueCents);
    return {
      kpis, technicianLanes: this._lanes(ctx), tickets: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      filters: {
        statuses: ['assigned', 'waiting_for_acceptance', 'accepted', 'declined', 'ready_to_start', 'in_service', 'delayed', 'cancelled'],
        technicians: [...new Set(all.map((t) => t.assignedTechName))].filter(Boolean), serviceCategories: [...new Set(this._serviceCatalog(ctx).map((s) => s.categoryName))],
        sources: ['walk_in', 'appointment', 'online', 'google', 'ai', 'manual'], priorityLevels: ['normal', 'high', 'vip', 'urgent'], stations: [...new Set(all.map((t) => t.station || ''))].filter(Boolean),
      },
      workflowSettings: this._settings(),
      techPerformanceToday,
    };
  }

  async detail(ctx: TechQueueContext, id: string) {
    const t = this._ticket(ctx, id); if (!t) return null;
    return { ...this.toRow(ctx, t), technicianEligible: this.techEligible(ctx, t), technicianNotifiedAt: t.technicianNotifiedAt, customerNotifiedAt: t.customerNotifiedAt, delayReason: t.delayReason, auditSummary: [{ lastAction: 'updated', lastActorRole: ctx.role, lastAt: t.updatedAt }] };
  }

  async setStatus(ctx: TechQueueContext, id: string, st: TQTicketStatus) { const t = this._ticket(ctx, id); if (!t) return false; t.status = st; if (st === 'in_service') t.startedAtMs = Date.now(); t.updatedAt = now(); return true; }
  async accept(ctx: TechQueueContext, id: string, readyToStart: boolean, expectedVersion?: number | null) { const t = this._ticket(ctx, id); if (!t) return false; if (!['assigned', 'waiting_for_acceptance'].includes(t.status)) return false; if (typeof expectedVersion === 'number' && expectedVersion !== ((t as any).version ?? 0)) return false; t.acceptedAtMs = Date.now(); t.status = readyToStart ? 'ready_to_start' : 'accepted'; (t as any).version = ((t as any).version ?? 0) + 1; t.updatedAt = now(); return true; }
  async decline(ctx: TechQueueContext, id: string, reason: string, expectedVersion?: number | null) { const t = this._ticket(ctx, id); if (!t) return false; if (!['assigned', 'waiting_for_acceptance'].includes(t.status)) return false; if (typeof expectedVersion === 'number' && expectedVersion !== ((t as any).version ?? 0)) return false; t.status = 'declined'; t.notes = `${t.notes ? t.notes + '\n' : ''}[${now()}] (declined) ${reason}`; (t as any).version = ((t as any).version ?? 0) + 1; t.updatedAt = now(); return true; }
  async startServing(ctx: TechQueueContext, id: string) { const t = this._ticket(ctx, id); if (!t) return false; if (['cancelled', 'declined', 'in_service'].includes(t.status)) return false; t.status = 'in_service'; t.startedAtMs = Date.now(); t.updatedAt = now(); return true; }
  async reassign(ctx: TechQueueContext, id: string, technicianId: string) { const t = this._ticket(ctx, id); const tech = this._technicians(ctx).find((x) => x.technicianId === technicianId); if (!t || !tech) return false; t.assignedTechId = tech.technicianId; t.assignedTechName = tech.name; t.acceptedAtMs = null; if (!['cancelled', 'declined', 'in_service'].includes(t.status)) t.status = 'assigned'; t.updatedAt = now(); return true; }
  async setServices(ctx: TechQueueContext, id: string, services: TQRequestedService[]) { const t = this._ticket(ctx, id); if (!t) return false; t.services = services; t.updatedAt = now(); return true; }
  async setPriority(ctx: TechQueueContext, id: string, priority: TQPriority) { const t = this._ticket(ctx, id); if (!t) return false; t.priority = priority; t.updatedAt = now(); return true; }
  async setDelay(ctx: TechQueueContext, id: string, ds: TQDelayStatus, reason?: string) { const t = this._ticket(ctx, id); if (!t) return false; t.delayStatus = ds; t.delayReason = reason; if (ds === 'none') { if (t.status === 'delayed') t.status = 'accepted'; } else { t.status = 'delayed'; } t.updatedAt = now(); return true; }
  async markTechNotified(ctx: TechQueueContext, id: string) { const t = this._ticket(ctx, id); if (t) { t.technicianNotifiedAt = now(); t.updatedAt = now(); } }
  async markCustomerNotified(ctx: TechQueueContext, id: string) { const t = this._ticket(ctx, id); if (t) { t.customerNotifiedAt = now(); t.updatedAt = now(); } }
  async getServingKey(ctx: TechQueueContext, id: string) { return this._ticket(ctx, id)?.servingKey; }
  async setServingKey(ctx: TechQueueContext, id: string, key: string) { const t = this._ticket(ctx, id); if (t) t.servingKey = key; }
  async expireDueOffers(nowMs: number): Promise<ExpiredOffer[]> {
    const expired: ExpiredOffer[] = [];
    for (const [tenantId, list] of this.store.entries()) {
      for (const t of list) {
        if (offerIsExpired({ status: t.status, acceptedAtMs: t.acceptedAtMs, deadlineMs: t.deadlineMs ?? null }, nowMs)) {
          t.status = 'expired'; t.updatedAt = now();
          expired.push({ id: t.techQueueTicketId, tenantId, branchId: null, technicianId: t.assignedTechId || null });
        }
      }
    }
    return expired;
  }
}
