// tech-appointments.repository.ts — persistence port + in-memory adapter for POS Tech Appointments.
// Tenant-scoped appointments grouped by technician for the day board (built to hold up to 25 technician columns).
// A different tenant sees its own (empty) data — isolation. Check-in / move-to-queue / move-to-tech-queue /
// start-service are idempotent (a retry never duplicates a downstream ticket).
import {
  Money, POSTechAppointmentsFullState, POSTechAppointmentItem, POSTechAppointmentTechnician, POSTechApptKpisFull,
  TechApptFilters, TAStatus, TASource, TADepositStatus, TAConflictStatus, TAWorkingStatus, TAService, TechApptSettings,
  DEFAULT_TA_SETTINGS, addMinutesToTime, durationOfServices, detectTechnicianConflict,
} from './tech-appointments.dto';
import { AppointmentSlotConflict, AppointmentVersionConflict } from '../appointments/appointment-slot-guard';

/** Options for any write that changes a technician's time (create / move / reassign / service change) — merge Oct 12 2026.
 *  allowOverbook writes a FLAGGED overbook row (482) instead of refusing; expectedVersion → VERSION_CONFLICT on a stale copy. */
export interface TASlotOpts { bufferMinutes?: number; allowOverbook?: boolean; overbookReason?: string; expectedVersion?: number | null; }

export interface TechApptContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

export interface TAItem {
  appointmentId: string; technicianId: string; customerId?: string; customerName: string; customerPhone?: string; isVip: boolean;
  source: TASource; services: TAService[]; date: string; startTime: string; endTime: string; status: TAStatus;
  depositStatus: TADepositStatus; notes: string; queueKey?: string; techQueueKey?: string; servingKey?: string; createdAt: string; updatedAt: string;
  /** optimistic-concurrency version (482/483) */ version?: number; /** written as an audited overbook (482) */ overbooked?: boolean;
}
interface TechRec { technicianId: string; displayName: string; firstName: string; workingStatus: TAWorkingStatus; skills: string[]; availableMinutes: number; }
interface SvcRec { serviceId: string; name: string; categoryName: string; durationMinutes: number; priceCents: Money; }

export interface TechApptRepositoryPort {
  /** Constitution 8: true when the repository writes domain events in its transactions. */
  emitsDomainEvents?(): boolean;
  settings(ctx: TechApptContext): Promise<TechApptSettings>;
  today(): string;
  /** The BRANCH's business day (audit bug 2: today() is a fixed default / the server's UTC date). */
  todayFor?(ctx: TechApptContext): Promise<string>;
  query(ctx: TechApptContext, f: TechApptFilters): Promise<POSTechAppointmentsFullState>;
  appointment(ctx: TechApptContext, id: string): Promise<TAItem | null>;
  detail(ctx: TechApptContext, id: string): Promise<POSTechAppointmentItem | null>;
  technicians(ctx: TechApptContext): Promise<TechRec[]>;
  serviceCatalog(ctx: TechApptContext): Promise<SvcRec[]>;
  existingForConflict(ctx: TechApptContext, date: string): Promise<{ appointmentId: string; technicianId: string; customerId?: string; startTime: string; endTime: string; status: TAStatus }[]>;
  create(ctx: TechApptContext, item: TAItem, opts?: TASlotOpts): Promise<POSTechAppointmentItem>;
  update(ctx: TechApptContext, id: string, patch: Partial<TAItem>, opts?: TASlotOpts): Promise<boolean>;
  setStatus(ctx: TechApptContext, id: string, st: TAStatus): Promise<boolean>;
  reschedule(ctx: TechApptContext, id: string, technicianId: string | undefined, startTime: string, date: string | undefined, opts?: TASlotOpts): Promise<boolean>;
  assign(ctx: TechApptContext, id: string, technicianId: string, opts?: TASlotOpts): Promise<boolean>;
  nextSeq(): number;
  getKey(ctx: TechApptContext, id: string, kind: 'queue' | 'techQueue' | 'serving'): Promise<string | undefined>;
  setKey(ctx: TechApptContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string): Promise<void>;
}

const now = () => new Date().toISOString();
const TODAY = '2026-06-06';

export class InMemoryTechApptRepository implements TechApptRepositoryPort {
  private store = new Map<string, TAItem[]>();
  private techs = new Map<string, TechRec[]>();
  private catalog = new Map<string, SvcRec[]>();
  private seq = 8000;
  nextSeq() { return ++this.seq; }
  today() { return TODAY; }

  private ensure(tenantId: string) {
    if (this.store.has(tenantId)) return;
    if (tenantId !== 'luxe001') { this.store.set(tenantId, []); this.techs.set(tenantId, []); this.catalog.set(tenantId, []); return; }
    const cat: SvcRec[] = [
      { serviceId: 'svc_mani', name: 'Signature Manicure', categoryName: 'Manicure', durationMinutes: 45, priceCents: 5500 },
      { serviceId: 'svc_pedi', name: 'Spa Pedicure', categoryName: 'Pedicure', durationMinutes: 55, priceCents: 6500 },
      { serviceId: 'svc_gel', name: 'Gel Add-on', categoryName: 'Add-on', durationMinutes: 15, priceCents: 1500 },
      { serviceId: 'svc_wax', name: 'Eyebrow Wax', categoryName: 'Waxing', durationMinutes: 20, priceCents: 2200 },
    ];
    this.catalog.set(tenantId, cat);
    const svc = (id: string): TAService => { const s = cat.find((x) => x.serviceId === id)!; return { serviceId: s.serviceId, serviceName: s.name, durationMinutes: s.durationMinutes, priceCents: s.priceCents }; };
    this.techs.set(tenantId, [
      { technicianId: 'tech_mia', displayName: 'Mia P.', firstName: 'Mia', workingStatus: 'available', skills: ['Manicure', 'Add-on'], availableMinutes: 600 },
      { technicianId: 'tech_ava', displayName: 'Ava L.', firstName: 'Ava', workingStatus: 'in_service', skills: ['Pedicure', 'Manicure'], availableMinutes: 600 },
      { technicianId: 'tech_leo', displayName: 'Leo R.', firstName: 'Leo', workingStatus: 'on_break', skills: ['Waxing', 'Manicure'], availableMinutes: 600 },
      { technicianId: 'tech_zoe', displayName: 'Zoe T.', firstName: 'Zoe', workingStatus: 'available', skills: ['Manicure', 'Pedicure'], availableMinutes: 600 },
      { technicianId: 'tech_kim', displayName: 'Kim N.', firstName: 'Kim', workingStatus: 'off_today', skills: ['Pedicure'], availableMinutes: 0 },
      { technicianId: 'tech_sam', displayName: 'Sam W.', firstName: 'Sam', workingStatus: 'scheduled_later', skills: ['Add-on', 'Manicure'], availableMinutes: 300 },
    ]);
    const mk = (id: string, techId: string, cust: string, phone: string, vip: boolean, source: TASource, serviceIds: string[], start: string, status: TAStatus, deposit: TADepositStatus = 'not_required'): TAItem => {
      const services = serviceIds.map(svc); const dur = durationOfServices(services);
      return { appointmentId: id, technicianId: techId, customerId: 'c_' + id, customerName: cust, customerPhone: phone, isVip: vip, source, services, date: TODAY, startTime: start, endTime: addMinutesToTime(start, dur), status, depositStatus: deposit, notes: '', createdAt: now(), updatedAt: now() };
    };
    this.store.set(tenantId, [
      mk('ta_7001', 'tech_mia', 'Grace Kim', '+18565550101', true, 'phone', ['svc_mani', 'svc_gel'], '10:00', 'booked'),
      mk('ta_7002', 'tech_ava', 'Nora Patel', '+18565550102', false, 'online', ['svc_pedi'], '09:30', 'in_service'),
      mk('ta_7003', 'tech_leo', 'Ivy Park', '+18565550104', false, 'google', ['svc_wax'], '11:00', 'confirmed'),
      mk('ta_7004', 'tech_zoe', 'Liv Chen', '+18565550103', false, 'ai', ['svc_mani'], '10:30', 'checked_in'),
      mk('ta_7005', 'tech_mia', 'Mia Wong', '+18565550105', false, 'walk_in', ['svc_mani'], '13:00', 'booked'),
      mk('ta_7006', 'tech_ava', 'Zoe Diaz', '+18565550106', false, 'customer_app', ['svc_pedi'], '14:00', 'completed'),
      mk('ta_7007', 'tech_zoe', 'Ada Brooks', '+18565550107', false, 'phone', ['svc_mani'], '15:00', 'cancelled'),
      mk('ta_7008', 'tech_leo', 'Bea Cruz', '+18565550108', false, 'online', ['svc_wax'], '16:00', 'no_show'),
    ]);
  }
  private L(ctx: TechApptContext) { this.ensure(ctx.tenantId); return this.store.get(ctx.tenantId)!; }
  private _appointment(ctx: TechApptContext, id: string) { return this.L(ctx).find((a) => a.appointmentId === id) || null; }
  async appointment(ctx: TechApptContext, id: string) { return this._appointment(ctx, id); }
  private _settings() { return DEFAULT_TA_SETTINGS; }
  async settings(_ctx: TechApptContext) { return this._settings(); }
  private _technicians(ctx: TechApptContext) { this.ensure(ctx.tenantId); return (this.techs.get(ctx.tenantId) || []).slice(); }
  async technicians(ctx: TechApptContext) { return this._technicians(ctx); }
  private _serviceCatalog(ctx: TechApptContext) { this.ensure(ctx.tenantId); return (this.catalog.get(ctx.tenantId) || []).slice(); }
  async serviceCatalog(ctx: TechApptContext) { return this._serviceCatalog(ctx); }
  private _existingForConflict(ctx: TechApptContext, date: string) { return this.L(ctx).filter((a) => a.date === date).map((a) => ({ appointmentId: a.appointmentId, technicianId: a.technicianId, customerId: a.customerId, startTime: a.startTime, endTime: a.endTime, status: a.status })); }
  async existingForConflict(ctx: TechApptContext, date: string) { return this._existingForConflict(ctx, date); }

  private toItem(ctx: TechApptContext, a: TAItem): POSTechAppointmentItem {
    const conf = detectTechnicianConflict(this._existingForConflict(ctx, a.date), a.technicianId, a.startTime, a.endTime, this._settings().bufferMinutes, a.appointmentId);
    return {
      appointmentId: a.appointmentId, tenantId: ctx.tenantId, branchId: ctx.branchId, technicianId: a.technicianId, customerId: a.customerId, customerName: a.customerName, customerPhone: a.customerPhone, isVip: a.isVip,
      source: a.source, services: a.services, startTime: a.startTime, endTime: a.endTime, durationMinutes: durationOfServices(a.services), status: a.status,
      depositStatus: a.depositStatus, conflictStatus: conf.status, notes: a.notes, version: a.version ?? 1, ...(a.overbooked ? { overbooked: true } : {}),
    };
  }

  private techColumn(ctx: TechApptContext, t: TechRec, dayAppts: TAItem[]): POSTechAppointmentTechnician {
    const mine = dayAppts.filter((a) => a.technicianId === t.technicianId && !['cancelled', 'no_show'].includes(a.status));
    const scheduled = mine.reduce((acc, a) => acc + durationOfServices(a.services), 0);
    return { technicianId: t.technicianId, displayName: t.displayName, firstName: t.firstName, workingStatus: t.workingStatus, appointmentCount: mine.length, scheduledMinutes: scheduled, availableMinutes: t.availableMinutes, serviceSkillGroups: t.skills };
  }

  private filtered(ctx: TechApptContext, f: TechApptFilters): TAItem[] {
    const date = f.date || TODAY;
    let rows = this.L(ctx).filter((a) => a.date === date);
    if (f.search) { const s = f.search.toLowerCase(); rows = rows.filter((a) => [a.customerName, a.customerPhone, a.notes, ...a.services.map((x) => x.serviceName)].some((x) => (x || '').toLowerCase().includes(s))); }
    if (f.technicianId) rows = rows.filter((a) => a.technicianId === f.technicianId);
    if (f.status) rows = rows.filter((a) => a.status === f.status);
    if (f.source) rows = rows.filter((a) => a.source === f.source);
    if (f.serviceCategory) { const cat = this._serviceCatalog(ctx); rows = rows.filter((a) => a.services.some((rs) => cat.find((s) => s.serviceId === rs.serviceId)?.categoryName === f.serviceCategory)); }
    if (f.depositStatus) rows = rows.filter((a) => a.depositStatus === f.depositStatus);
    if (f.conflictOnly) { const buf = this._settings().bufferMinutes; rows = rows.filter((a) => detectTechnicianConflict(this._existingForConflict(ctx, date), a.technicianId, a.startTime, a.endTime, buf, a.appointmentId).status !== 'none'); }
    return rows;
  }

  async query(ctx: TechApptContext, f: TechApptFilters) {
    const date = f.date || TODAY;
    const dayAll = this.L(ctx).filter((a) => a.date === date);
    const matched = this.filtered(ctx, f);
    const buf = this._settings().bufferMinutes;
    const conflictCount = dayAll.filter((a) => detectTechnicianConflict(this._existingForConflict(ctx, date), a.technicianId, a.startTime, a.endTime, buf, a.appointmentId).status !== 'none').length;
    const kpis: POSTechApptKpisFull = {
      totalAppointmentsToday: dayAll.length,
      bookedAppointments: dayAll.filter((a) => ['booked', 'confirmed'].includes(a.status)).length,
      checkedInAppointments: dayAll.filter((a) => a.status === 'checked_in').length,
      inServiceAppointments: dayAll.filter((a) => a.status === 'in_service').length,
      completedAppointments: dayAll.filter((a) => a.status === 'completed').length,
      cancelledAppointments: dayAll.filter((a) => a.status === 'cancelled').length,
      noShowAppointments: dayAll.filter((a) => a.status === 'no_show').length,
      onlineBookings: dayAll.filter((a) => a.source === 'online' || a.source === 'customer_app').length,
      aiBookings: dayAll.filter((a) => a.source === 'ai').length,
      googleBookings: dayAll.filter((a) => a.source === 'google').length,
      conflictCount,
    };
    const techs = this._technicians(ctx);
    return {
      kpis, date,
      technicians: techs.map((t) => this.techColumn(ctx, t, dayAll)),
      appointments: matched.map((a) => this.toItem(ctx, a)),
      filters: {
        statuses: ['booked', 'confirmed', 'arrived', 'checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'],
        sources: ['walk_in', 'phone', 'online', 'google', 'ai', 'customer_app', 'manual'],
        serviceCategories: [...new Set(this._serviceCatalog(ctx).map((s) => s.categoryName))],
        technicians: techs.map((t) => ({ technicianId: t.technicianId, name: t.displayName })),
        branches: [{ branchId: ctx.branchId || 'br_cherryhill', name: 'Cherry Hill' }],
      },
      settings: this._settings(),
    };
  }

  async detail(ctx: TechApptContext, id: string) { const a = this._appointment(ctx, id); return a ? this.toItem(ctx, a) : null; }

  /** In-memory mirror of appointment-slot-guard: refuse an overlapping slot unless the overbook is allowed (then flag the
   *  row); a stale expectedVersion is refused; every write bumps the version (as migration 483's trigger does). */
  private guardSlot(ctx: TechApptContext, a: TAItem | null, technicianId: string | null, date: string, startTime: string, endTime: string, opts?: TASlotOpts, excludeId?: string): boolean {
    if (a && opts?.expectedVersion != null && Number(opts.expectedVersion) !== (a.version ?? 1)) throw new AppointmentVersionConflict(a.version ?? 1);
    if (!technicianId) return false;
    const conf = detectTechnicianConflict(this._existingForConflict(ctx, date), technicianId, startTime, endTime, opts?.bufferMinutes ?? 0, excludeId);
    if (conf.status !== 'conflict') return false;
    if (!opts?.allowOverbook) throw new AppointmentSlotConflict(conf.conflictingAppointmentId);
    return true;
  }
  private bump(a: TAItem) { a.version = (a.version ?? 1) + 1; a.updatedAt = now(); }
  async create(ctx: TechApptContext, item: TAItem, opts?: TASlotOpts) {
    const overlaps = this.guardSlot(ctx, null, item.technicianId, item.date, item.startTime, item.endTime, opts);
    const row: TAItem = { ...item, version: 1, ...(overlaps ? { overbooked: true } : {}) };
    this.L(ctx).push(row); return this.toItem(ctx, row);
  }
  async update(ctx: TechApptContext, id: string, patch: Partial<TAItem>, opts?: TASlotOpts) {
    const a = this._appointment(ctx, id); if (!a) return false;
    const endTime = patch.services ? addMinutesToTime(a.startTime, durationOfServices(patch.services)) : a.endTime;
    const slotChanges = !!patch.services || (patch.technicianId !== undefined && patch.technicianId !== a.technicianId);
    const overlaps = this.guardSlot(ctx, a, slotChanges ? (patch.technicianId ?? a.technicianId) : null, a.date, a.startTime, endTime, opts, id);
    Object.assign(a, patch); if (patch.services) a.endTime = endTime; if (overlaps) a.overbooked = true; this.bump(a); return true;
  }
  async setStatus(ctx: TechApptContext, id: string, st: TAStatus) { const a = this._appointment(ctx, id); if (!a) return false; a.status = st; a.updatedAt = now(); return true; }
  async reschedule(ctx: TechApptContext, id: string, technicianId: string | undefined, startTime: string, date: string | undefined, opts?: TASlotOpts) {
    const a = this._appointment(ctx, id); if (!a) return false;
    const endTime = addMinutesToTime(startTime, durationOfServices(a.services));
    const overlaps = this.guardSlot(ctx, a, technicianId || a.technicianId, date || a.date, startTime, endTime, opts, id);
    if (technicianId) a.technicianId = technicianId; if (date) a.date = date; a.startTime = startTime; a.endTime = endTime; a.status = a.status === 'no_show' || a.status === 'cancelled' ? 'booked' : a.status;
    a.overbooked = overlaps; this.bump(a); return true;
  }
  async assign(ctx: TechApptContext, id: string, technicianId: string, opts?: TASlotOpts) {
    const a = this._appointment(ctx, id); const tech = this._technicians(ctx).find((x) => x.technicianId === technicianId); if (!a || !tech) return false;
    const overlaps = this.guardSlot(ctx, a, tech.technicianId, a.date, a.startTime, a.endTime, opts, id);
    a.technicianId = tech.technicianId; a.overbooked = overlaps; this.bump(a); return true;
  }
  async getKey(ctx: TechApptContext, id: string, kind: 'queue' | 'techQueue' | 'serving') { const a = this._appointment(ctx, id); if (!a) return undefined; return kind === 'queue' ? a.queueKey : kind === 'techQueue' ? a.techQueueKey : a.servingKey; }
  async setKey(ctx: TechApptContext, id: string, kind: 'queue' | 'techQueue' | 'serving', key: string) { const a = this._appointment(ctx, id); if (!a) return; if (kind === 'queue') a.queueKey = key; else if (kind === 'techQueue') a.techQueueKey = key; else a.servingKey = key; }
}
