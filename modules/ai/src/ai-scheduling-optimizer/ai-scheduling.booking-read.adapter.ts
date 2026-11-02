// ai-scheduling.booking-read.adapter.ts — the PRODUCTION SchedDayReader (BUILD_PLAN Phase 7). Reads the branch day the
// optimizer reasons about from the canonical sources, tenant + branch scoped on every query:
//   • store hours, booking buffer, slot interval, clock      — booking repository (POS Settings → tenant_settings)
//   • technicians (active, skills = service categories)     — booking repository; branch membership = technicians.branch_id
//                                                              (NULL = every location of the salon) — not "the session branch"
//   • shift windows                                         — technician_shifts rows for the date override the weekly
//                                                              technician_schedules row (shifts jsonb / start-end); no row →
//                                                              store hours (the legacy rule booking keeps)
//   • breaks                                                — schedule breaks jsonb, else lunch; plus technician_blocked_times
//   • time off                                              — technician_time_off (approved) clipped to the day
//   • appointments (status, version, deposit, services)     — pos_tech_appointments; manual locks — appointment_schedule_locks
//   • durations                                             — approved service_duration_recommendations (tech → branch / salon)
//                                                              over the catalog; setup / cleanup / group — service_scheduling_profiles
//   • live booking holds                                    — booking_holds through the booking module's KyselyHoldRepository
// It re-implements no booking rule: the reader only gathers; ai-scheduling-day.ts judges; booking.service re-validates on apply.
import type { Kysely } from 'kysely';
import { type BookingRepositoryPort, type BookingContext, pbMinutesOf, KyselyHoldRepository } from '@aipowersalon/booking';
import { localDateTimeToEpochMs, addDays, zonedParts, utcDate } from '@aipowersalon/date-time';
import type { SchedCtx } from './ai-scheduling.ports';
import type { SchedDayReader, SchedApptRecord } from './ai-scheduling.data-adapter';
import type { DayData, DayTech, DayService, DayAppt } from './ai-scheduling-day';
import type { Range } from './ai-scheduling-core';
import { mergeRanges, intersect } from './ai-scheduling-core';

const bctx = (ctx: SchedCtx, branchId: string | null): BookingContext => ({ tenantId: ctx.tenantId, branchId: branchId ?? '', userId: ctx.userId, role: ctx.role, permissions: ctx.permissions });
const dowOf = (date: string): number => new Date(String(date).slice(0, 10) + 'T00:00:00Z').getUTCDay();
const ymd = (v: unknown): string => (v instanceof Date ? utcDate(v) : String(v ?? '').slice(0, 10));   // pg DATE → a UTC-midnight Date
const hm = (v: unknown): string => String(v ?? '').slice(0, 5);
const parseJson = (v: unknown): any => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; };
const serviceIdsOf = (v: unknown): string[] => { const a = parseJson(v); return Array.isArray(a) ? a.map((s: any) => String(s?.serviceId ?? s?.service_id ?? '')).filter(Boolean) : []; };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BookingServiceReadAdapter implements SchedDayReader {
  constructor(private readonly repo: BookingRepositoryPort, private readonly db: Kysely<any> | null) {}

  async clock(ctx: SchedCtx, branchId: string) { return this.repo.clock(bctx(ctx, branchId)); }

  /** Local minute-of-day of an instant on `date` in `tz`, clamped to [0, 1440]. */
  private minuteOn(date: string, tz: string, instant: unknown): number {
    const d = instant instanceof Date ? instant : new Date(String(instant));
    const p = zonedParts(d, tz);
    const local = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    if (local < date) return 0;
    if (local > date) return 1440;
    return p.hour * 60 + p.minute;
  }

  async loadDay(ctx: SchedCtx, branchId: string, date: string): Promise<DayData> {
    const b = bctx(ctx, branchId);
    const [settings, clk, scheds, blocks, techRecs, catalog] = await Promise.all([
      this.repo.settings(b), this.repo.clock(b), this.repo.techSchedules(b, dowOf(date), date), this.repo.blockedTimes(b, date), this.repo.technicians(b), this.repo.serviceCatalog(b),
    ]);
    const tz = clk.timeZone;
    const open = pbMinutesOf(settings.openTime), close = pbMinutesOf(settings.closeTime);
    const hours: Range | null = close > open ? { start: open, end: close } : null;
    const clampToHours = (r: Range): Range | null => (hours ? intersect(r, hours) : null);
    const dayStartMs = localDateTimeToEpochMs(date, '00:00', tz), dayEndMs = localDateTimeToEpochMs(addDays(date, 1), '00:00', tz);
    const techIds = techRecs.map((t) => t.technicianId).filter((id) => UUID_RE.test(id));
    const db = this.db as any;

    // ── optimizer inputs that live outside the booking repository (database only) ──
    const [membership, dated, timeOff, apptRows, durations, profiles, holds, approvedRows] = this.db ? await Promise.all([
      techIds.length ? db.selectFrom('technicians').where('tenant_id', '=', ctx.tenantId).where('id', 'in', techIds).select(['id', 'branch_id', 'service_eligibility_mode']).execute() : [],
      techIds.length ? db.selectFrom('technician_shifts').where('tenant_id', '=', ctx.tenantId).where('shift_date', '=', date).where('technician_id', 'in', techIds)
        .where((eb: any) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)])).where('status', '!=', 'cancelled')
        .select(['technician_id', 'start_time', 'end_time']).execute() : [],
      techIds.length ? db.selectFrom('technician_time_off').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', techIds).where('status', '=', 'approved')
        .where((eb: any) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]))
        .where('starts_at', '<', new Date(dayEndMs)).where('ends_at', '>', new Date(dayStartMs))
        .select(['technician_id', 'starts_at', 'ends_at']).execute() : [],
      db.selectFrom('pos_tech_appointments').where('tenant_id', '=', ctx.tenantId).where('appt_date', '=', date)
        .where((eb: any) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]))
        .select(['id', 'branch_id', 'technician_id', 'customer_id', 'status', 'source', 'appt_date', 'start_time', 'end_time', 'version', 'deposit_status', 'services']).execute(),
      db.selectFrom('service_duration_recommendations').where('tenant_id', '=', ctx.tenantId).where('status', '=', 'approved').where('suggested_min', 'is not', null)
        .where((eb: any) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]))
        .select(['service_id', 'technician_id', 'branch_id', 'suggested_min', 'decided_at', 'created_at']).execute(),
      db.selectFrom('service_scheduling_profiles').where('tenant_id', '=', ctx.tenantId).select(['service_id', 'setup_min', 'cleanup_min', 'max_group_size']).execute(),
      new KyselyHoldRepository(this.db).liveHolds(ctx.tenantId, branchId, dayStartMs, dayEndMs),
      // B-82 (Oct 23 2026): the EXACT services each technician is approved for — the AI receptionist and the optimizer used
      // the category, so with every service in one "Nails" category it offered a technician not approved for acrylic
      techIds.length ? db.selectFrom('technician_services').where('tenant_id', '=', ctx.tenantId).where('technician_id', 'in', techIds).select(['technician_id', 'service_id']).execute() : [],
    ]) : [[], [], [], [], [], [], [], []];

    const branchOf = new Map<string, string | null>((membership as any[]).map((r) => [String(r.id), r.branch_id ? String(r.branch_id) : null]));
    const approvedOf = new Map<string, string[]>();
    for (const r of approvedRows as { technician_id: unknown; service_id: unknown }[]) (approvedOf.get(String(r.technician_id)) ?? approvedOf.set(String(r.technician_id), []).get(String(r.technician_id))!).push(String(r.service_id));
    const datedBy = new Map<string, Range[]>();
    for (const r of dated) {
      const w = clampToHours({ start: this.minuteOn(date, tz, r.start_time), end: this.minuteOn(date, tz, r.end_time) });
      if (w) (datedBy.get(String(r.technician_id)) ?? datedBy.set(String(r.technician_id), []).get(String(r.technician_id))!).push(w);
    }
    const offBy = new Map<string, Range[]>();
    for (const r of timeOff) {
      const s = Math.max(0, Math.round((new Date(r.starts_at).getTime() - dayStartMs) / 60000)), e = Math.min(1440, Math.round((new Date(r.ends_at).getTime() - dayStartMs) / 60000));
      if (e > s) (offBy.get(String(r.technician_id)) ?? offBy.set(String(r.technician_id), []).get(String(r.technician_id))!).push({ start: s, end: e });
    }

    const techs: DayTech[] = techRecs.map((t) => {
      const sched = scheds[t.technicianId] ?? null;
      let shifts: Range[];
      const datedRows = datedBy.get(t.technicianId);
      if (datedRows?.length) shifts = mergeRanges(datedRows);                                     // a dated shift overrides the week
      else if (!hours || (sched && sched.isWorking === false)) shifts = [];
      else if (sched && sched.isWorking === true && sched.shifts?.length) shifts = sched.shifts.map((s) => clampToHours({ start: pbMinutesOf(s.startTime), end: pbMinutesOf(s.endTime) })).filter((x): x is Range => !!x);
      else if (sched && sched.isWorking === true && sched.startTime && sched.endTime) shifts = [clampToHours({ start: pbMinutesOf(hm(sched.startTime)), end: pbMinutesOf(hm(sched.endTime)) })].filter((x): x is Range => !!x);
      else shifts = [hours];                                                                     // no row → store hours (legacy)
      const breaks: Range[] = [];
      if (sched?.breaks?.length) for (const br of sched.breaks) breaks.push({ start: pbMinutesOf(hm(br.startTime)), end: pbMinutesOf(hm(br.endTime)) });
      else if (sched?.lunchStartTime && sched?.lunchEndTime) breaks.push({ start: pbMinutesOf(hm(sched.lunchStartTime)), end: pbMinutesOf(hm(sched.lunchEndTime)) });
      for (const bl of blocks[t.technicianId] ?? []) breaks.push({ start: pbMinutesOf(bl.startTime), end: pbMinutesOf(bl.endTime) });
      const home = branchOf.has(t.technicianId) ? branchOf.get(t.technicianId)! : branchId;
      return {
        technicianId: t.technicianId, name: t.name, available: !!t.available, skills: t.skills,
        // exact approvals when the database answered (a legacy technician with no mapping keeps the category rule — migration 631)
        ...(this.db ? { approvedServiceIds: approvedOf.get(t.technicianId) ?? [] } : {}),   // §24 (Kevin, Oct 27): empty = no services set up → the workforce category fallback
        branchIds: home ? [home] : [branchId], shifts, breaks: breaks.filter((r) => r.end > r.start), timeOff: offBy.get(t.technicianId) ?? [],
      };
    });

    const profileBy = new Map<string, any>((profiles as any[]).map((p) => [String(p.service_id), p]));
    const services: Record<string, DayService> = {};
    for (const s of catalog) {
      const p = profileBy.get(s.serviceId);
      services[s.serviceId] = { serviceId: s.serviceId, name: s.name, categoryName: s.categoryName, durationMin: s.durationMinutes,
        setupMin: Number(p?.setup_min ?? 0), cleanupMin: Number(p?.cleanup_min ?? 0), maxGroupSize: p?.max_group_size != null ? Number(p.max_group_size) : null };
    }
    // newest approved row wins; a branch row beats the salon-wide (NULL branch) row
    const durationByTechService: Record<string, number> = {}, durationByService: Record<string, number> = {};
    const stamp = (r: any) => new Date(r.decided_at ?? r.created_at ?? 0).getTime();
    const sorted = [...durations].sort((a, b) => (Number(!!a.branch_id) - Number(!!b.branch_id)) || (stamp(a) - stamp(b)));
    for (const r of sorted) {
      const min = Number(r.suggested_min); if (!(min > 0)) continue;
      if (r.technician_id) durationByTechService[`${r.technician_id}:${r.service_id}`] = min; else durationByService[String(r.service_id)] = min;
    }

    const ids = (apptRows as any[]).map((r) => String(r.id));
    const locked = new Set(ids.length && this.db ? ((await db.selectFrom('appointment_schedule_locks').where('tenant_id', '=', ctx.tenantId).where('appointment_id', 'in', ids).select(['appointment_id']).execute()) as any[]).map((r) => String(r.appointment_id)) : []);
    const appts: DayAppt[] = (apptRows as any[]).map((r) => this.toAppt(r, locked.has(String(r.id))));

    return {
      date, branchId, timeZone: tz, branchHours: hours, bufferMin: Math.max(0, Number(settings.bufferMinutes) || 0), slotIntervalMin: Number(settings.slotIntervalMinutes) || 15,
      techs, services, durationByTechService, durationByService, appts,
      holds: holds.map((h) => ({ technicianId: h.technicianId ?? null, range: { start: Math.max(0, Math.round((h.startsAt - dayStartMs) / 60000)), end: Math.min(1440, Math.round((h.endsAt - dayStartMs) / 60000)) } })),
      nowMin: date === clk.today ? clk.nowMinute : null,
      isPast: date < clk.today,
    };
  }

  private toAppt(r: any, manualLock: boolean): SchedApptRecord {
    return {
      id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null, technicianId: r.technician_id ? String(r.technician_id) : null,
      customerId: r.customer_id ? String(r.customer_id) : null, status: String(r.status), source: r.source ?? null, date: ymd(r.appt_date),
      startTime: hm(r.start_time), endTime: hm(r.end_time), startMin: pbMinutesOf(hm(r.start_time)), endMin: pbMinutesOf(hm(r.end_time)),
      version: Number(r.version ?? 1), depositStatus: r.deposit_status ?? null, serviceIds: serviceIdsOf(r.services), manualLock,
    };
  }

  async appointment(ctx: SchedCtx, appointmentId: string): Promise<SchedApptRecord | null> {
    if (!UUID_RE.test(appointmentId)) return null;
    if (!this.db) {
      const a = await this.repo.booking(bctx(ctx, ctx.branchId), appointmentId);
      if (!a) return null;
      return { id: a.appointmentId, branchId: ctx.branchId, technicianId: a.technicianId, customerId: a.customerId ?? null, status: a.status, source: a.source, date: a.date,
        startTime: a.startTime, endTime: a.endTime, startMin: pbMinutesOf(a.startTime), endMin: pbMinutesOf(a.endTime), version: a.version ?? 1, depositStatus: a.depositStatus ?? null,
        serviceIds: a.services.map((s) => s.serviceId), manualLock: false };
    }
    const db = this.db;
    const r = await db.selectFrom('pos_tech_appointments').where('tenant_id', '=', ctx.tenantId).where('id', '=', appointmentId)
      .select(['id', 'branch_id', 'technician_id', 'customer_id', 'status', 'source', 'appt_date', 'start_time', 'end_time', 'version', 'deposit_status', 'services']).executeTakeFirst();
    if (!r) return null;
    const lock = await db.selectFrom('appointment_schedule_locks').where('tenant_id', '=', ctx.tenantId).where('appointment_id', '=', appointmentId).select(['id']).executeTakeFirst();
    return this.toAppt(r, !!lock);
  }

  async technicianIdForUser(ctx: SchedCtx): Promise<string | null> {
    if (ctx.technicianId) return ctx.technicianId;
    if (!this.db || !UUID_RE.test(ctx.userId)) return null;
    const r = await this.db.selectFrom('technicians').where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('status', '!=', 'archived').select(['id']).executeTakeFirst();
    return r ? String(r.id) : null;
  }
  async technicianExists(ctx: SchedCtx, technicianId: string): Promise<boolean> {
    if (!this.db) return (await this.repo.technicians(bctx(ctx, ctx.branchId))).some((t) => t.technicianId === technicianId);
    if (!UUID_RE.test(technicianId)) return false;
    return !!(await this.db.selectFrom('technicians').where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId).select(['id']).executeTakeFirst());
  }
  async serviceExists(ctx: SchedCtx, serviceId: string): Promise<boolean> {
    if (!this.db) return (await this.repo.serviceCatalog(bctx(ctx, ctx.branchId))).some((s) => s.serviceId === serviceId);
    if (!UUID_RE.test(serviceId)) return false;
    return !!(await this.db.selectFrom('services').where('tenant_id', '=', ctx.tenantId).where('id', '=', serviceId).select(['id']).executeTakeFirst());
  }
}
