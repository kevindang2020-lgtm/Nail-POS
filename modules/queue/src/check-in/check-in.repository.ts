// check-in.repository.ts — persistence port + in-memory adapter for POS Check-In (the front-door intake).
// Tenant-scoped check-in records + a customer directory (for search and duplicate detection) + appointments ready to
// check in. A different tenant sees its own (empty) data — isolation. Appointment check-in and move-to-queue /
// move-to-tech-queue / start-service are idempotent (a retry never duplicates a record or a downstream ticket).
import {
  Money, POSCheckInFullState, POSCheckInRow, POSCheckInKpisFull, POSCheckInAppointmentRow, POSCheckInCustomerDetail,
  POSCheckInAppointmentDetail, CheckInFilters, CheckInStatus, CheckInSource, CheckInServiceLine, CheckInSettings,
  DEFAULT_CHECK_IN_SETTINGS, estimateWaitMinutes, checkInDurationMinutes, computeCheckInAggregates, computeCustomerMix,
} from './check-in.dto';
import { clampPageSize, clampPage } from '@aipowersalon/api-contracts';
import { rankQueue, type QueuePriority } from '../queue/queue.dto';

export interface CheckInContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface CIRecord {
  checkInId: string; customerId?: string; customerName: string; customerPhone?: string; avatarUrl?: string | null; isVip: boolean; appointmentId: string | null;
  source: CheckInSource; services: CheckInServiceLine[]; technicianId: string | null; technicianName: string | null; checkedInAtMs: number;
  quotedWaitMinutes?: number; status: CheckInStatus; notes: string; queueKey?: string; techQueueKey?: string; servingKey?: string; updatedAt: string;
}
export interface CustRec { customerId: string; fullName: string; phone?: string; email?: string; avatarUrl?: string | null; isVip?: boolean; loyaltyTier?: string; totalVisits: number; smsOptIn?: boolean; }
export interface ApptRec { appointmentId: string; customerId?: string; customerName: string; customerPhone?: string; avatarUrl?: string | null; startTime: string; technicianId?: string; technicianName?: string; serviceIds: string[]; serviceNames?: string[]; services?: any[]; source: CheckInSource; checkedIn: boolean; notes?: string; }
export interface TechRec { technicianId: string; name: string; available: boolean; avatarUrl?: string | null; skills: string[]; }
export interface SvcRec { serviceId: string; name: string; categoryName: string; durationMinutes: number; priceCents: Money; isAddon?: boolean; parentServiceId?: string; }

export interface CheckInRepositoryPort {
  /** §343: true when queue joins are delivered by the realtime projection (outbox wired and publisher on). */
  emitsDomainEvents?(): boolean;
  settings(ctx: CheckInContext): Promise<CheckInSettings>;
  query(ctx: CheckInContext, f: CheckInFilters): Promise<POSCheckInFullState>;
  record(ctx: CheckInContext, id: string): Promise<CIRecord | null>;
  detailRow(ctx: CheckInContext, id: string): Promise<POSCheckInRow | null>;
  /** The ACTIVE (not finished) check-in for an appointment, or for a walk-in customer — the one the database's partial
   *  unique indexes (migration 503) allow; null when there is none. */
  activeCheckIn(ctx: CheckInContext, by: { appointmentId?: string; customerId?: string }): Promise<{ checkInId: string } | null>;
  customerDirectory(ctx: CheckInContext): Promise<CustRec[]>;
  customerSearch(ctx: CheckInContext, q: string): Promise<POSCheckInCustomerDetail[]>;
  appointmentSearch(ctx: CheckInContext, q: string, date?: string): Promise<POSCheckInAppointmentRow[]>;
  appointmentsReady(ctx: CheckInContext): Promise<POSCheckInAppointmentRow[]>;
  appointment(ctx: CheckInContext, id: string): Promise<ApptRec | null>;
  technicians(ctx: CheckInContext): Promise<TechRec[]>;
  serviceCatalog(ctx: CheckInContext): Promise<SvcRec[]>;
  createRecord(ctx: CheckInContext, rec: CIRecord): Promise<POSCheckInRow>;
  /** Every appointment of a visit at once — all recorded, or none (Oct 6 2026). */
  createVisitRecords?(ctx: CheckInContext, recs: CIRecord[]): Promise<POSCheckInRow[]>;
  createCustomer(ctx: CheckInContext, c: CustRec): Promise<CustRec>;
  markAppointmentCheckedIn(ctx: CheckInContext, appointmentId: string): Promise<void>;
  update(ctx: CheckInContext, id: string, patch: Partial<CIRecord>): Promise<boolean>;
  setStatus(ctx: CheckInContext, id: string, st: CheckInStatus): Promise<boolean>;
  waitEstimate(ctx: CheckInContext, serviceIds: string[], technicianId?: string): Promise<{ configured: boolean; quotedWaitMinutes?: number; reason?: string }>;
  nextSeq(): number;
  getKey(ctx: CheckInContext, id: string, kind: 'queue' | 'techQueue' | 'serving'): Promise<string | undefined>;
  setKey(ctx: CheckInContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string): Promise<void>;
  enqueue(ctx: CheckInContext, rec: CIRecord): Promise<string>;
  // Kiosk-safe, tenant/branch-scoped: where this checked-in guest sits in the branch's waiting line (null once served).
  placeInLine(ctx: CheckInContext, checkInId: string): Promise<{ position: number; waitingAhead: number } | null>;
  findCheckInByIdempotencyKey?(ctx: CheckInContext, key: string): Promise<string | null>;
  setCheckInIdempotencyKey?(ctx: CheckInContext, key: string, checkInId: string): Promise<void>;
}

const now = () => new Date().toISOString();

export class InMemoryCheckInRepository implements CheckInRepositoryPort {
  private store = new Map<string, CIRecord[]>();
  private customers = new Map<string, CustRec[]>();
  private appts = new Map<string, ApptRec[]>();
  private techs = new Map<string, TechRec[]>();
  private catalog = new Map<string, SvcRec[]>();
  private seq = 9000;
  nextSeq() { return ++this.seq; }

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); this.customers.set(tenantId, []); this.appts.set(tenantId, []); this.techs.set(tenantId, []); this.catalog.set(tenantId, []); return; }
    const mAgo = (m: number) => Date.now() - m * 60000;
    const cat: SvcRec[] = [
      { serviceId: 'svc_mani', name: 'Signature Manicure', categoryName: 'Manicure', durationMinutes: 45, priceCents: 5500 },
      { serviceId: 'svc_pedi', name: 'Spa Pedicure', categoryName: 'Pedicure', durationMinutes: 55, priceCents: 6500 },
      { serviceId: 'svc_gel', name: 'Gel Add-on', categoryName: 'Add-on', durationMinutes: 15, priceCents: 1500 },
      { serviceId: 'svc_wax', name: 'Eyebrow Wax', categoryName: 'Waxing', durationMinutes: 20, priceCents: 2200 },
    ];
    this.catalog.set(tenantId, cat);
    this.techs.set(tenantId, [
      { technicianId: 'tech_mia', name: 'Mia', available: true, skills: ['Manicure', 'Add-on'] },
      { technicianId: 'tech_ava', name: 'Ava', available: true, skills: ['Pedicure', 'Manicure'] },
      { technicianId: 'tech_leo', name: 'Leo', available: false, skills: ['Waxing', 'Manicure'] },
    ]);
    this.customers.set(tenantId, [
      { customerId: 'cust_grace', fullName: 'Grace Kim', phone: '+18565550101', email: 'grace@example.com', isVip: true, loyaltyTier: 'VIP Gold', totalVisits: 22 },
      { customerId: 'cust_nora', fullName: 'Nora Patel', phone: '+18565550102', email: 'nora@example.com', totalVisits: 6 },
      { customerId: 'cust_liv', fullName: 'Liv Chen', phone: '+18565550103', totalVisits: 3 },
      { customerId: 'cust_ivy', fullName: 'Ivy Park', phone: '+18565550104', totalVisits: 11 },
    ]);
    const svc = (id: string): CheckInServiceLine => { const s = cat.find((x) => x.serviceId === id)!; return { serviceId: s.serviceId, serviceName: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents }; };
    this.appts.set(tenantId, [
      { appointmentId: 'appt_5001', customerId: 'cust_grace', customerName: 'Grace Kim', customerPhone: '+18565550101', startTime: '10:00', technicianId: 'tech_mia', technicianName: 'Mia', serviceIds: ['svc_mani', 'svc_gel'], source: 'appointment', checkedIn: false },
      { appointmentId: 'appt_5002', customerId: 'cust_nora', customerName: 'Nora Patel', customerPhone: '+18565550102', startTime: '10:30', technicianId: 'tech_ava', technicianName: 'Ava', serviceIds: ['svc_pedi'], source: 'online', checkedIn: false },
      { appointmentId: 'appt_5003', customerId: 'cust_ivy', customerName: 'Ivy Park', customerPhone: '+18565550104', startTime: '11:00', technicianId: 'tech_leo', technicianName: 'Leo', serviceIds: ['svc_wax'], source: 'google', checkedIn: false },
    ]);
    const mk = (id: string, custId: string, cust: string, phone: string, vip: boolean, source: CheckInSource, serviceIds: string[], techId: string | null, techName: string | null, status: CheckInStatus, minAgo: number, apptId: string | null = null): CIRecord => {
      const services = serviceIds.map(svc);
      return { checkInId: id, customerId: custId, customerName: cust, customerPhone: phone, isVip: vip, appointmentId: apptId, source, services, technicianId: techId, technicianName: techName, checkedInAtMs: mAgo(minAgo), quotedWaitMinutes: 15, status, notes: '', updatedAt: now() };
    };
    this.store.set(tenantId, [
      mk('ci_6001', 'cust_liv', 'Liv Chen', '+18565550103', false, 'walk_in', ['svc_mani'], null, null, 'checked_in', 8),
      mk('ci_6002', 'cust_ivy', 'Ivy Park', '+18565550104', false, 'walk_in', ['svc_pedi'], 'tech_ava', 'Ava', 'sent_to_queue', 20),
      mk('ci_6003', 'cust_grace', 'Grace Kim', '+18565550101', true, 'appointment', ['svc_mani'], 'tech_mia', 'Mia', 'in_service', 40, 'appt_old'),
      mk('ci_6004', 'cust_nora', 'Nora Patel', '+18565550102', false, 'online', ['svc_gel'], null, null, 'cancelled', 60),
    ]);
  }
  private L(ctx: CheckInContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  private _record(ctx: CheckInContext, id: string) { return this.L(ctx).find((r) => r.checkInId === id) || null; }
  async record(ctx: CheckInContext, id: string) { return this._record(ctx, id); }
  private _settings() { return DEFAULT_CHECK_IN_SETTINGS; }
  async settings(_ctx: CheckInContext) { return this._settings(); }
  private _custDir(ctx: CheckInContext) { this.ensure(ctx.tenantId); return (this.customers.get(ctx.tenantId) || []).slice(); }
  async customerDirectory(ctx: CheckInContext) { return this._custDir(ctx); }
  private _techs(ctx: CheckInContext) { this.ensure(ctx.tenantId); return (this.techs.get(ctx.tenantId) || []).slice(); }
  async technicians(ctx: CheckInContext) { return this._techs(ctx); }
  private _catalog(ctx: CheckInContext) { this.ensure(ctx.tenantId); return (this.catalog.get(ctx.tenantId) || []).slice(); }
  async serviceCatalog(ctx: CheckInContext) { return this._catalog(ctx); }
  private _appointment(ctx: CheckInContext, id: string) { this.ensure(ctx.tenantId); return (this.appts.get(ctx.tenantId) || []).find((a) => a.appointmentId === id) || null; }
  async appointment(ctx: CheckInContext, id: string) { return this._appointment(ctx, id); }

  async customerSearch(ctx: CheckInContext, q: string) {
    const s = (q || '').trim().toLowerCase(); if (!s) return [];
    return this._custDir(ctx).filter((c) => c.fullName.toLowerCase().includes(s) || (c.phone || '').toLowerCase().includes(s) || (c.email || '').toLowerCase().includes(s) || c.customerId.toLowerCase().includes(s))
      .map((c) => ({ customerId: c.customerId, fullName: c.fullName, phone: c.phone, email: c.email, isVip: c.isVip, loyaltyTier: c.loyaltyTier, totalVisits: c.totalVisits }));
  }
  private apptRow(ctx: CheckInContext, a: ApptRec): POSCheckInAppointmentRow {
    const cat = this._catalog(ctx);
    return { appointmentId: a.appointmentId, customerId: a.customerId, customerName: a.customerName, customerPhone: a.customerPhone, startTime: a.startTime, technicianName: a.technicianName, serviceNames: a.serviceIds.map((id) => cat.find((s) => s.serviceId === id)?.name || id), source: a.source, alreadyCheckedIn: a.checkedIn };
  }
  async appointmentSearch(ctx: CheckInContext, q: string, _date?: string) {
    this.ensure(ctx.tenantId);
    const s = (q || '').trim().toLowerCase(); const all = (this.appts.get(ctx.tenantId) || []);
    const matched = !s ? all : all.filter((a) => a.customerName.toLowerCase().includes(s) || (a.customerPhone || '').toLowerCase().includes(s) || a.appointmentId.toLowerCase().includes(s) || (a.technicianName || '').toLowerCase().includes(s));
    return matched.map((a) => this.apptRow(ctx, a));
  }
  private _apptsReady(ctx: CheckInContext): POSCheckInAppointmentRow[] { this.ensure(ctx.tenantId); return (this.appts.get(ctx.tenantId) || []).filter((a) => !a.checkedIn).map((a) => this.apptRow(ctx, a)); }
  async appointmentsReady(ctx: CheckInContext) { return this._apptsReady(ctx); }

  private toRow(ctx: CheckInContext, r: CIRecord): POSCheckInRow {
    return { checkInId: r.checkInId, tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: r.customerId, customerName: r.customerName, customerPhone: r.customerPhone, isVip: r.isVip, appointmentId: r.appointmentId, source: r.source, services: r.services, technicianId: r.technicianId, technicianName: r.technicianName, checkedInAt: new Date(r.checkedInAtMs).toISOString(), quotedWaitMinutes: r.quotedWaitMinutes, status: r.status, notes: r.notes };
  }
  async activeCheckIn(ctx: CheckInContext, by: { appointmentId?: string; customerId?: string }) {
    const finished = new Set(['completed', 'done', 'cancelled', 'removed']);
    const all = this.L(ctx).filter((r: any) => !finished.has(r.status));
    const hit = by.appointmentId ? all.find((r: any) => r.appointmentId === by.appointmentId)
      : by.customerId ? all.find((r: any) => !r.appointmentId && r.customerId === by.customerId) : undefined;
    return hit ? { checkInId: (hit as any).checkInId } : null;
  }
  async detailRow(ctx: CheckInContext, id: string) { const r = this._record(ctx, id); return r ? this.toRow(ctx, r) : null; }

  private avgServiceMin(ctx: CheckInContext) { const cat = this._catalog(ctx); return cat.length ? Math.round(cat.reduce((a, s) => a + s.durationMinutes, 0) / cat.length) : 45; }
  private availTechs(ctx: CheckInContext) { return this._techs(ctx).filter((t) => t.available).length; }

  async query(ctx: CheckInContext, f: CheckInFilters) {
    const all = this.L(ctx);
    let rows = all.slice();
    if (f.search) { const s = f.search.toLowerCase(); rows = rows.filter((r) => [r.customerName, r.customerPhone, r.technicianName, ...r.services.map((x) => x.serviceName)].some((x) => (x || '').toLowerCase().includes(s))); }
    if (f.source) rows = rows.filter((r) => r.source === f.source);
    if (f.status) rows = rows.filter((r) => r.status === f.status);
    if (f.technicianId) rows = rows.filter((r) => r.technicianId === f.technicianId);
    const page = clampPage(f.page), pageSize = clampPageSize(f.pageSize, 20);
    const totalItems = rows.length, totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((r) => this.toRow(ctx, r));

    const waiting = all.filter((r) => r.status === 'checked_in' || r.status === 'sent_to_queue');
    const waits = waiting.map((r) => Math.max(0, Math.floor((Date.now() - r.checkedInAtMs) / 60000)));
    const kpis: POSCheckInKpisFull = {
      checkedInToday: all.length,
      appointmentsCheckedIn: all.filter((r) => r.source === 'appointment').length,
      walkInsCheckedIn: all.filter((r) => r.source === 'walk_in').length,
      waitingNow: waiting.length,
      sentToQueue: all.filter((r) => r.status === 'sent_to_queue').length,
      sentToTechQueue: all.filter((r) => r.status === 'sent_to_tech_queue').length,
      startedService: all.filter((r) => r.status === 'in_service').length,
      averageWaitMinutes: waits.length ? Math.round(waits.reduce((a, w) => a + w, 0) / waits.length) : 0,
      noShowsToday: 0,
      onlineArrivalsToday: all.filter((r) => ['online', 'google', 'ai', 'customer_app'].includes(r.source)).length,
    };
    const techs = this._techs(ctx);
    return {
      kpis, recentCheckIns: { items: pageRows, pagination: { page, pageSize, totalItems, totalPages } },
      appointmentsReadyForCheckIn: this._apptsReady(ctx),
      filters: {
        sources: ['appointment', 'walk_in', 'online', 'google', 'ai', 'customer_app', 'manual'],
        statuses: ['checked_in', 'sent_to_queue', 'sent_to_tech_queue', 'in_service', 'cancelled'],
        technicians: techs.map((t) => ({ technicianId: t.technicianId, name: t.name })),
        services: this._catalog(ctx).map((s) => ({ serviceId: s.serviceId, name: s.name })),
        branches: [{ branchId: ctx.branchId || 'br_cherryhill', name: 'Cherry Hill' }],
      },
      settings: this._settings(),
      aggregates: computeCheckInAggregates(all),
      customerMix: computeCustomerMix(all, Object.fromEntries(this._custDir(ctx).map((c) => [c.customerId, c.totalVisits]))),
    };
  }

  async createRecord(ctx: CheckInContext, rec: CIRecord) { this.L(ctx).push(rec); return this.toRow(ctx, rec); }
  async createVisitRecords(ctx: CheckInContext, recs: CIRecord[]) { const out: POSCheckInRow[] = []; for (const r of recs) { this.L(ctx).push(r); if (r.appointmentId) await this.markAppointmentCheckedIn(ctx, r.appointmentId); out.push(this.toRow(ctx, r)); } return out; }
  async createCustomer(ctx: CheckInContext, c: CustRec) { this.ensure(ctx.tenantId); (this.customers.get(ctx.tenantId) || []).push(c); return c; }
  async markAppointmentCheckedIn(ctx: CheckInContext, appointmentId: string) { const a = this._appointment(ctx, appointmentId); if (a) a.checkedIn = true; }
  async update(ctx: CheckInContext, id: string, patch: Partial<CIRecord>) { const r = this._record(ctx, id); if (!r) return false; Object.assign(r, patch); r.updatedAt = now(); if (r.appointmentId) { const a = this._appointment(ctx, r.appointmentId); if (a) a.checkedIn = true; } return true; }
  async setStatus(ctx: CheckInContext, id: string, st: CheckInStatus) { const r = this._record(ctx, id); if (!r) return false; r.status = st; r.updatedAt = now(); if (r.appointmentId) { const a = this._appointment(ctx, r.appointmentId); if (a) a.checkedIn = true; } return true; }
  async waitEstimate(ctx: CheckInContext, _serviceIds: string[], _technicianId?: string) {
    const settings = this._settings(); if (!settings.autoEstimateWait) return { configured: false, reason: 'Estimate unavailable — auto wait estimate is off.' };
    const waiting = this.L(ctx).filter((r) => r.status === 'checked_in' || r.status === 'sent_to_queue').length;
    return { configured: true, quotedWaitMinutes: estimateWaitMinutes(waiting, this.avgServiceMin(ctx), this.availTechs(ctx)) };
  }
  async getKey(ctx: CheckInContext, id: string, kind: 'queue' | 'techQueue' | 'serving') { const r = this._record(ctx, id); if (!r) return undefined; return kind === 'queue' ? r.queueKey : kind === 'techQueue' ? r.techQueueKey : r.servingKey; }
  async setKey(ctx: CheckInContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string) { const r = this._record(ctx, id); if (!r) return; if (kind === 'queue') r.queueKey = key; else if (kind === 'techQueue') r.techQueueKey = key; else r.servingKey = key; }
  async enqueue(_ctx: CheckInContext, rec: CIRecord) { const queueItemId = 'q_' + this.nextSeq(); this.queued.push({ checkInId: rec.checkInId, queueItemId }); return queueItemId; }
  async placeInLine(ctx: CheckInContext, checkInId: string) {
    const active = this.L(ctx).filter((r) => r.status === 'checked_in' || r.status === 'sent_to_queue');
    if (!active.some((r) => r.checkInId === checkInId)) return null;
    const ranked = rankQueue(active.map((r) => ({ queueItemId: r.checkInId, waitedMinutes: Math.max(0, (Date.now() - r.checkedInAtMs) / 60000), priority: (r.isVip ? 'vip' : 'normal') as QueuePriority })), true);
    const f = ranked.find((g) => g.queueItemId === checkInId);
    return f ? { position: f.position, waitingAhead: f.position - 1 } : null;
  }
  /** Test/diagnostic visibility: every Customer Queue entry created via enqueue(). */
  public queued: { checkInId: string; queueItemId: string }[] = [];
  private idemMap = new Map<string, string>();
  async findCheckInByIdempotencyKey(ctx: CheckInContext, key: string): Promise<string | null> {
    return this.idemMap.get(`${ctx.tenantId}:${key}`) ?? null;
  }
  async setCheckInIdempotencyKey(ctx: CheckInContext, key: string, checkInId: string): Promise<void> {
    this.idemMap.set(`${ctx.tenantId}:${key}`, checkInId);
  }
}
