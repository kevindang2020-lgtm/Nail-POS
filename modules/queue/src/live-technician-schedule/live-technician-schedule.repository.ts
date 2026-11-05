// live-technician-schedule.repository.ts — persistence port + in-memory adapter for the Live Technician Schedule.
// The port is async (Postgres-backed in production). The in-memory adapter seeds one tenant ('luxe001') so the core
// spec can exercise the aggregation, KPI rollup, open-slot computation, status normalization, and the mutations
// (block-time / break) without a database.
import {
  LiveTechnicianScheduleState, LiveTechnicianScheduleKpis, LiveTechnicianDetail, LiveTechnicianColumn,
  LiveScheduleAppointment, LiveScheduleFilters, BlockTechnicianTimeRequest, LiveApptStatus, LiveApptSource,
  LiveShift, LIVE_STATUS_LABEL, LiveTechStatus,
  lsInitials, lsDayOfWeek, lsComputeOpenSlots, lsBookedMinutes, lsShiftMinutes, lsUtilization, lsNormalizeStatus, lsRollupKpis, lsMinutesOf,
} from './live-technician-schedule.dto';

export interface LiveScheduleContext { tenantId: string; branchId: string; userId: string; role: string; permissions: string[]; }

interface TechRec { technicianId: string; userId?: string; fullName: string; roleLabel: string; avatarUrl?: string; phone?: string; active: boolean; skills: string[]; }
interface ApptRec { appointmentId: string; technicianId: string | null; date: string; startTime: string; endTime: string; status: LiveApptStatus; source: LiveApptSource; customerName: string; customerId?: string; serviceSummary: string; ticketId?: string; }
interface BlockRec { blockId: string; technicianId: string; date: string; startTime: string; endTime: string; reason: string; note?: string; }
interface ShiftRec { startTime: string; endTime: string; lunchStart?: string; lunchEnd?: string; isWorking: boolean; }

const SLOT_MIN = 30;
const RANGE = { startTime: '09:00', endTime: '19:00', slotMinutes: SLOT_MIN };

export interface LiveScheduleRepositoryPort {
  /** The branch's day (YYYY-MM-DD) and its time of day in minutes — the branch's zone, not the server's. */
  today(ctx?: LiveScheduleContext): string | Promise<string>;
  nowMinutes(ctx?: LiveScheduleContext): number | Promise<number>;
  state(ctx: LiveScheduleContext, f: LiveScheduleFilters): Promise<LiveTechnicianScheduleState>;
  kpis(ctx: LiveScheduleContext, date: string): Promise<LiveTechnicianScheduleKpis>;
  detail(ctx: LiveScheduleContext, technicianId: string, date: string): Promise<LiveTechnicianDetail | null>;
  filtersData(ctx: LiveScheduleContext): Promise<{ statuses: { label: string; value: string }[]; skills: { label: string; value: string }[]; technicians: { label: string; value: string }[] }>;
  technicianExists(ctx: LiveScheduleContext, technicianId: string): Promise<boolean>;
  hasActiveService(ctx: LiveScheduleContext, technicianId: string): Promise<boolean>;
  blockTime(ctx: LiveScheduleContext, technicianId: string, req: BlockTechnicianTimeRequest): Promise<{ blockId: string } | null>;
  setBreak(ctx: LiveScheduleContext, technicianId: string, onBreak: boolean, reason: string | undefined, byUserId: string): Promise<boolean>;
  bookOpenSlot(ctx: LiveScheduleContext, slotId: string, body: { customerName?: string; serviceIds?: string[]; durationMinutes?: number; customerId?: string; serviceSummary?: string }): Promise<{ appointmentId: string } | null>;
}

export class InMemoryLiveScheduleRepository implements LiveScheduleRepositoryPort {
  private techs = new Map<string, TechRec[]>();
  private shifts = new Map<string, Record<string, ShiftRec[]>>(); // tenant -> techId -> [dow]
  private statuses = new Map<string, Record<string, string>>();    // tenant -> techId -> status
  private appts = new Map<string, ApptRec[]>();
  private blocks = new Map<string, BlockRec[]>();
  // ONE-PAY (Oct 13 2026): the day's money as the compensation snapshot would report it (sales / tips / commission cents) —
  // held verbatim, never derived from a rate.
  private sales = new Map<string, Record<string, { salesCents: number; tipsCents: number; commissionCents: number }>>();
  /** Seed one technician's snapshot day (tests / demo). */
  seedSnapshotDay(tenantId: string, technicianId: string, day: { salesCents: number; tipsCents: number; commissionCents: number }): void {
    this.ensure(tenantId); const m = this.sales.get(tenantId) || {}; m[technicianId] = { ...day }; this.sales.set(tenantId, m);
  }
  private seq = 7000;
  private fixedNow = 11 * 60; // 11:00 for deterministic tests
  today() { return '2026-06-08'; }
  nowMinutes() { return this.fixedNow; }

  private ensure(t: string) {
    if (this.techs.has(t)) return;
    if (t !== 'luxe001') { this.techs.set(t, []); this.shifts.set(t, {}); this.statuses.set(t, {}); this.appts.set(t, []); this.blocks.set(t, []); this.sales.set(t, {}); return; }
    this.techs.set(t, [
      { technicianId: 'tech_mia', userId: 'u_mia', fullName: 'Mia Rivera', roleLabel: 'Senior Technician', active: true, skills: ['Manicure', 'Pedicure'] },
      { technicianId: 'tech_ava', userId: 'u_ava', fullName: 'Ava Chen', roleLabel: 'Technician', active: true, skills: ['Manicure', 'Waxing'] },
      { technicianId: 'tech_leo', userId: 'u_leo', fullName: 'Leo Park', roleLabel: 'Technician', active: true, skills: ['Pedicure'] },
      { technicianId: 'tech_zoe', userId: 'u_zoe', fullName: 'Zoe Diaz', roleLabel: 'Junior Technician', active: true, skills: ['Manicure'] },
    ]);
    // all four work today (2026-06-08 is a Monday -> dow 1) except Zoe
    const sh: Record<string, ShiftRec[]> = {};
    const dow = lsDayOfWeek(this.today());
    const mk = (start: string, end: string, ls?: string, le?: string): ShiftRec[] => { const a: ShiftRec[] = []; a[dow] = { startTime: start, endTime: end, lunchStart: ls, lunchEnd: le, isWorking: true }; return a; };
    sh['tech_mia'] = mk('09:00', '17:00', '12:00', '12:30');
    sh['tech_ava'] = mk('10:00', '18:00');
    sh['tech_leo'] = mk('09:00', '15:00');
    sh['tech_zoe'] = []; // not working today
    this.shifts.set(t, sh);
    this.statuses.set(t, { tech_mia: 'in_service', tech_ava: 'available', tech_leo: 'on_break', tech_zoe: 'off_shift' });
    this.appts.set(t, [
      { appointmentId: 'a1', technicianId: 'tech_mia', date: this.today(), startTime: '10:30', endTime: '11:30', status: 'in_service', source: 'pos', customerName: 'Sophia Nguyen', serviceSummary: 'Gel Manicure', ticketId: 'tk1' },
      { appointmentId: 'a2', technicianId: 'tech_mia', date: this.today(), startTime: '13:00', endTime: '14:00', status: 'confirmed', source: 'online_booking', customerName: 'Grace Kim', serviceSummary: 'Spa Pedicure' },
      { appointmentId: 'a3', technicianId: 'tech_ava', date: this.today(), startTime: '11:00', endTime: '11:45', status: 'checked_in', source: 'customer_app', customerName: 'Liv Chen', serviceSummary: 'Manicure' },
      { appointmentId: 'a4', technicianId: 'tech_leo', date: this.today(), startTime: '09:30', endTime: '10:15', status: 'completed', source: 'pos', customerName: 'Nora Patel', serviceSummary: 'Pedicure' },
    ]);
    this.blocks.set(t, [{ blockId: 'b1', technicianId: 'tech_ava', date: this.today(), startTime: '15:00', endTime: '16:00', reason: 'training' }]);
    this.sales.set(t, { tech_mia: { salesCents: 12000, tipsCents: 2500, commissionCents: 4800 }, tech_ava: { salesCents: 4500, tipsCents: 800, commissionCents: 1575 }, tech_leo: { salesCents: 6000, tipsCents: 1000, commissionCents: 2100 }, tech_zoe: { salesCents: 0, tipsCents: 0, commissionCents: 0 } });   // demo snapshot figures
  }
  private T(ctx: LiveScheduleContext) { this.ensure(ctx.tenantId); return this.techs.get(ctx.tenantId)!; }

  private shiftFor(ctx: LiveScheduleContext, techId: string, date: string): LiveShift | undefined {
    const dow = lsDayOfWeek(date); const rec = (this.shifts.get(ctx.tenantId) || {})[techId]?.[dow];
    if (!rec || !rec.isWorking) return undefined;
    return { startTime: rec.startTime, endTime: rec.endTime, breakStartTime: rec.lunchStart, breakEndTime: rec.lunchEnd };
  }
  private apptsFor(ctx: LiveScheduleContext, techId: string, date: string): ApptRec[] {
    return (this.appts.get(ctx.tenantId) || []).filter((a) => a.technicianId === techId && a.date === date).sort((x, y) => lsMinutesOf(x.startTime) - lsMinutesOf(y.startTime));
  }
  private blocksFor(ctx: LiveScheduleContext, techId: string, date: string): BlockRec[] {
    return (this.blocks.get(ctx.tenantId) || []).filter((b) => b.technicianId === techId && b.date === date);
  }
  private toAppt(a: ApptRec): LiveScheduleAppointment {
    return { appointmentId: a.appointmentId, customerId: a.customerId, customerName: a.customerName, customerInitials: lsInitials(a.customerName), serviceSummary: a.serviceSummary, startTime: a.startTime, endTime: a.endTime, status: a.status, source: a.source, ticketId: a.ticketId };
  }
  private column(ctx: LiveScheduleContext, t: TechRec, date: string): LiveTechnicianColumn {
    const shift = this.shiftFor(ctx, t.technicianId, date);
    const appts = this.apptsFor(ctx, t.technicianId, date);
    const blocks = this.blocksFor(ctx, t.technicianId, date);
    const rawStatus = (this.statuses.get(ctx.tenantId) || {})[t.technicianId];
    const status = lsNormalizeStatus(rawStatus, !!shift, appts, blocks, this.nowMinutes());
    const busy = [...appts.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show').map((a) => ({ startTime: a.startTime, endTime: a.endTime })), ...blocks.map((b) => ({ startTime: b.startTime, endTime: b.endTime }))];
    const openSlots = lsComputeOpenSlots(t.technicianId, shift, busy, RANGE.slotMinutes);
    const bookedMin = lsBookedMinutes(appts);
    const active = appts.find((a) => a.status === 'in_service');
    return {
      technicianId: t.technicianId, userId: t.userId, fullName: t.fullName, initials: lsInitials(t.fullName), avatarUrl: t.avatarUrl, roleLabel: t.roleLabel,
      status, shift, skills: t.skills, appointments: appts.map((a) => this.toAppt(a)), openSlots,
      blocks: blocks.map((b) => ({ blockId: b.blockId, startTime: b.startTime, endTime: b.endTime, reason: b.reason, note: b.note })),
      activeTicket: active ? { ticketId: active.ticketId || active.appointmentId, serviceSummary: active.serviceSummary, customerName: active.customerName } : undefined,
      bookedHours: Math.round((bookedMin / 60) * 10) / 10, utilizationPercent: lsUtilization(bookedMin, lsShiftMinutes(shift)),
    };
  }

  async state(ctx: LiveScheduleContext, f: LiveScheduleFilters): Promise<LiveTechnicianScheduleState> {
    const date = f.date || this.today();
    let cols = this.T(ctx).filter((t) => t.active).map((t) => this.column(ctx, t, date));
    if (f.status) cols = cols.filter((c) => c.status === f.status);
    if (f.skill) cols = cols.filter((c) => c.skills.includes(f.skill!));
    if (f.search) { const q = f.search.toLowerCase(); cols = cols.filter((c) => [c.fullName, c.roleLabel, ...c.skills].some((x) => (x || '').toLowerCase().includes(q))); }
    return { date, branchId: ctx.branchId, timeRange: RANGE, technicians: cols };
  }
  async kpis(ctx: LiveScheduleContext, date: string): Promise<LiveTechnicianScheduleKpis> {
    const cols = this.T(ctx).filter((t) => t.active).map((t) => this.column(ctx, t, date || this.today()));
    return lsRollupKpis(cols);
  }
  async detail(ctx: LiveScheduleContext, technicianId: string, date: string): Promise<LiveTechnicianDetail | null> {
    const t = this.T(ctx).find((x) => x.technicianId === technicianId); if (!t) return null;
    const col = this.column(ctx, t, date || this.today());
    const sale = (this.sales.get(ctx.tenantId) || {})[technicianId] || { salesCents: 0, tipsCents: 0, commissionCents: 0 };
    const next = col.appointments.find((a) => lsMinutesOf(a.startTime) >= this.nowMinutes() && a.status !== 'cancelled' && a.status !== 'no_show' && a.status !== 'completed');
    return {
      technicianId, userId: t.userId, fullName: t.fullName, initials: col.initials, avatarUrl: t.avatarUrl, roleLabel: t.roleLabel, phone: t.phone,
      status: col.status, shift: col.shift, skills: col.skills, appointments: col.appointments, openSlots: col.openSlots, blocks: col.blocks,
      activeTicket: col.activeTicket, nextAppointment: next, bookedHours: col.bookedHours, utilizationPercent: col.utilizationPercent,
      salesTodayCents: sale.salesCents, tipsTodayCents: sale.tipsCents, commissionPreviewCents: sale.commissionCents,
    };
  }
  async filtersData(ctx: LiveScheduleContext) {
    const techs = this.T(ctx);
    const skills = [...new Set(techs.flatMap((t) => t.skills))].sort();
    return {
      statuses: (Object.keys(LIVE_STATUS_LABEL) as LiveTechStatus[]).map((v) => ({ label: LIVE_STATUS_LABEL[v], value: v })),
      skills: skills.map((s) => ({ label: s, value: s })),
      technicians: techs.map((t) => ({ label: t.fullName, value: t.technicianId })),
    };
  }
  async technicianExists(ctx: LiveScheduleContext, technicianId: string) { return this.T(ctx).some((t) => t.technicianId === technicianId); }
  async hasActiveService(ctx: LiveScheduleContext, technicianId: string) { return this.apptsFor(ctx, technicianId, this.today()).some((a) => a.status === 'in_service'); }

  async blockTime(ctx: LiveScheduleContext, technicianId: string, req: BlockTechnicianTimeRequest) {
    if (!this.T(ctx).some((t) => t.technicianId === technicianId)) return null;
    const blockId = 'blk_' + ++this.seq;
    (this.blocks.get(ctx.tenantId) || this.blocks.set(ctx.tenantId, []).get(ctx.tenantId)!).push({ blockId, technicianId, date: req.date || this.today(), startTime: req.startTime, endTime: req.endTime, reason: req.reason || 'unavailable', note: req.note });
    return { blockId };
  }
  async setBreak(ctx: LiveScheduleContext, technicianId: string, onBreak: boolean, _reason: string | undefined, _byUserId: string) {
    if (!this.T(ctx).some((t) => t.technicianId === technicianId)) return false;
    const map = this.statuses.get(ctx.tenantId) || {}; map[technicianId] = onBreak ? 'on_break' : 'available'; this.statuses.set(ctx.tenantId, map); return true;
  }
  async bookOpenSlot(ctx: LiveScheduleContext, slotId: string, body: { customerName?: string; durationMinutes?: number; customerId?: string; serviceSummary?: string }) {
    const [technicianId, startMin] = slotId.split(':'); if (!technicianId || startMin === undefined) return null;
    if (!this.T(ctx).some((t) => t.technicianId === technicianId)) return null;
    const start = Number(startMin); const dur = body.durationMinutes || RANGE.slotMinutes;
    const appointmentId = 'ls_' + ++this.seq;
    (this.appts.get(ctx.tenantId)!).push({ appointmentId, technicianId, date: this.today(), startTime: lsToHHMMlocal(start), endTime: lsToHHMMlocal(start + dur), status: 'confirmed', source: 'pos', customerName: body.customerName || 'Walk In', customerId: body.customerId, serviceSummary: body.serviceSummary || 'Service' });
    return { appointmentId };
  }
}
function lsToHHMMlocal(total: number): string { const h = Math.floor(total / 60), m = total % 60; return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
