// live-technician-schedule.service.ts — orchestrates the Live Technician Schedule: enforces per-action permissions,
// validates inputs, applies the break-while-in-service guard (manager override audited), and assembles the page
// state. All data access is async via the repository port (Postgres-backed in production). Everything is audited.
import { hasPermission, isStaffPrincipal, isPlatformPrincipal } from '@aipowersalon/permissions';
import { addDays } from '@aipowersalon/date-time';
import { AppointmentSlotConflict, resolveManagerOverride, ManagerOverrideForbiddenError } from '@aipowersalon/appointments';
import { TimeClockConflictError, TimeClockValidationError, TechnicianEligibilityError, type TimeClockService, type TechnicianEligibilityService } from '@aipowersalon/workforce';
import {
  LiveTechnicianSchedulePageState, LiveTechnicianScheduleKpis, LiveTechnicianDetail, LiveScheduleFilters,
  BlockTechnicianTimeRequest, BreakRequest, LiveTechnicianScheduleState,
} from './live-technician-schedule.dto';
import { LiveScheduleContext, LiveScheduleRepositoryPort } from './live-technician-schedule.repository';

export class ForbiddenError extends Error { constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError'; } }
export class ValidationError extends Error { constructor(msg: string) { super(msg); this.name = 'ValidationError'; } }
export class ConflictError extends Error { constructor(msg: string) { super(msg); this.name = 'ConflictError'; } }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface LiveScheduleAuditLog {
  tenantId: string; branchId: string; userId: string; role: string; technicianId?: string; appointmentId?: string;
  actionType: string; entityType: 'technician' | 'schedule' | 'appointment' | 'ticket' | 'blocked_time'; entityId?: string; metadata: Record<string, unknown>; createdAt: string;
}

export class LiveTechnicianScheduleService {
  private audit: LiveScheduleAuditLog[] = [];
  /** Merge Oct 12 2026: breaks are part of the TIME CLOCK (technician_breaks 580 + workforce state 579) — with TimeClockService
   *  wired, start / end break go through it (the repo's setBreak is the no-DB fallback). `eligibility` is the ONE technician
   *  eligibility authority (modules/workforce/src/eligibility; null without a DB) — consulted before "book this open slot". */
  constructor(private readonly repo: LiveScheduleRepositoryPort, private readonly timeClock?: Pick<TimeClockService, 'breakStart' | 'breakEnd'> | null, private readonly eligibility?: Pick<TechnicianEligibilityService, 'assert'> | null) {}

  private assertUser(ctx: LiveScheduleContext) {
    if (!ctx?.userId || !ctx?.tenantId) throw new ForbiddenError('Not authenticated');
    if (isPlatformPrincipal(ctx)) throw new ForbiddenError('Super Admin cannot access the live schedule outside support mode');
    if (!isStaffPrincipal(ctx, { allowPlatform: true })) throw new ForbiddenError('Not available for this role');
  }
  private need(ctx: LiveScheduleContext, perm: string) { this.assertUser(ctx); if (!hasPermission(ctx as any, perm)) throw new ForbiddenError('Missing ' + perm); }
  /** The ONE manager-override rule (appointments/manager-override.ts): honoured only with pos.booking.override_conflict (audited);
   *  requested without it → 403. Merge Oct 12 2026 (R1). */
  private override(ctx: LiveScheduleContext, requested: unknown, action: string): boolean {
    try { return resolveManagerOverride(ctx as any, requested, (m) => this.log(ctx, 'manager_override_used', 'technician', undefined, { ...m }), action); }
    catch (e) { if (e instanceof ManagerOverrideForbiddenError) throw new ForbiddenError(e.message); throw e; }
  }
  private log(ctx: LiveScheduleContext, actionType: string, entityType: LiveScheduleAuditLog['entityType'], entityId?: string, metadata: Record<string, unknown> = {}) {
    this.audit.push({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, actionType, entityType, entityId, metadata, createdAt: new Date().toISOString() });
  }
  auditLog(): LiveScheduleAuditLog[] { return this.audit.slice(); }

  // ---- reads ----
  async pageState(ctx: LiveScheduleContext, f: LiveScheduleFilters): Promise<LiveTechnicianSchedulePageState> {
    this.need(ctx, 'pos.technicians.view');
    const date = f.date || (await this.repo.today(ctx));
    const [schedule, kpis, filters] = await Promise.all([this.repo.state(ctx, { ...f, date }), this.repo.kpis(ctx, date), this.repo.filtersData(ctx)]);
    this.log(ctx, 'live_technician_schedule_viewed', 'schedule', undefined, { date, view: f.view || 'day' });
    return {
      context: { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions || [] },
      kpis, schedule, filters,
    };
  }
  /** Week view (merge Oct 12 2026 — the other chat's live-schedule week screen): the 7 salon-local days starting Monday of
   *  the week containing `date`, one board per day. The FE wave wires GET live-schedule/week + the screen. */
  async week(ctx: LiveScheduleContext, f: LiveScheduleFilters): Promise<{ weekStart: string; days: { date: string; board: LiveTechnicianScheduleState }[] }> {
    this.need(ctx, 'pos.technicians.view');
    const anchor = f.date || (await this.repo.today(ctx));
    const days = weekDates(anchor);
    const boards = await Promise.all(days.map((date) => this.repo.state(ctx, { ...f, date })));
    this.log(ctx, 'live_technician_schedule_viewed', 'schedule', undefined, { date: anchor, view: 'week' });
    return { weekStart: days[0], days: days.map((date, i) => ({ date, board: boards[i] })) };
  }
  async board(ctx: LiveScheduleContext, f: LiveScheduleFilters): Promise<LiveTechnicianScheduleState> { this.need(ctx, 'pos.technicians.view'); return this.repo.state(ctx, { ...f, date: f.date || (await this.repo.today(ctx)) }); }
  async kpis(ctx: LiveScheduleContext, date?: string): Promise<LiveTechnicianScheduleKpis> { this.need(ctx, 'pos.technicians.view'); return this.repo.kpis(ctx, date || (await this.repo.today(ctx))); }
  async detail(ctx: LiveScheduleContext, technicianId: string, date?: string): Promise<LiveTechnicianDetail> {
    this.need(ctx, 'pos.technicians.view');
    const d = await this.repo.detail(ctx, technicianId, date || (await this.repo.today(ctx)));
    if (!d) throw new ValidationError('Technician not found');
    this.log(ctx, 'live_technician_detail_viewed', 'technician', technicianId, { date: date || (await this.repo.today(ctx)) });
    return d;
  }

  // ---- block time ----
  async blockTime(ctx: LiveScheduleContext, technicianId: string, req: BlockTechnicianTimeRequest): Promise<{ blockId: string }> {
    this.need(ctx, 'pos.technicians.block_time');
    if (!(await this.repo.technicianExists(ctx, technicianId))) throw new ValidationError('Technician not found in this tenant');
    if (!req?.startTime || !req?.endTime) throw new ValidationError('Start and end time are required');
    if (!HHMM.test(req.startTime) || !HHMM.test(req.endTime)) throw new ValidationError('Times must be HH:MM (24h)');
    if (req.endTime <= req.startTime) throw new ValidationError('End time must be after start time');
    const res = await this.repo.blockTime(ctx, technicianId, req);
    if (!res) throw new ValidationError('Could not create the block');
    this.log(ctx, 'technician_block_time_created', 'blocked_time', res.blockId, { technicianId, startTime: req.startTime, endTime: req.endTime, reason: req.reason || 'unavailable' });
    return res;
  }

  // ---- break (start / end) ----
  async startBreak(ctx: LiveScheduleContext, technicianId: string, body: BreakRequest = {}): Promise<{ status: string }> {
    this.need(ctx, 'pos.technicians.manage_status');
    if (!(await this.repo.technicianExists(ctx, technicianId))) throw new ValidationError('Technician not found in this tenant');
    const override = this.override(ctx, body.managerOverride, 'live_schedule.start_break');
    if (await this.repo.hasActiveService(ctx, technicianId) && !override) throw new ConflictError('Technician is in an active service — a manager override is required to start a break');
    await this.clockBreak(ctx, technicianId, true, body.reason);
    this.log(ctx, 'technician_break_started', 'technician', technicianId, { reason: body.reason, override });
    return { status: 'on_break' };
  }
  async endBreak(ctx: LiveScheduleContext, technicianId: string): Promise<{ status: string }> {
    this.need(ctx, 'pos.technicians.manage_status');
    if (!(await this.repo.technicianExists(ctx, technicianId))) throw new ValidationError('Technician not found in this tenant');
    await this.clockBreak(ctx, technicianId, false);
    this.log(ctx, 'technician_break_ended', 'technician', technicianId, {});
    return { status: 'available' };
  }

  private async clockBreak(ctx: LiveScheduleContext, technicianId: string, on: boolean, reason?: string): Promise<void> {
    if (!this.timeClock) { await this.repo.setBreak(ctx, technicianId, on, reason, ctx.userId); return; }
    const tc = { tenantId: ctx.tenantId, branchId: ctx.branchId || undefined, userId: ctx.userId, role: ctx.role, permissions: ctx.permissions || [] } as any;
    try { if (on) await this.timeClock.breakStart(tc, technicianId, { reason: reason ?? null }); else await this.timeClock.breakEnd(tc, technicianId); }
    catch (e) {
      if (e instanceof TimeClockConflictError) throw new ConflictError(e.message);
      if (e instanceof TimeClockValidationError) throw new ValidationError(e.message);
      throw e;
    }
  }

  // ---- book an open slot (creates a pos_tech_appointments row via the repo; reuses the shared appointment table) ----
  async bookOpenSlot(ctx: LiveScheduleContext, slotId: string, body: { customerName?: string; serviceIds?: string[]; durationMinutes?: number; customerId?: string; serviceSummary?: string }): Promise<{ appointmentId: string }> {
    this.need(ctx, 'pos.booking.create');
    if (!slotId) throw new ValidationError('A slot is required');
    // Eligibility (merge Oct 12 2026 — NONE existed on this path): the slot id is `<technicianId>:<minute>`; the technician
    // must be active, employed at this branch, approved for every requested service (certification valid) and free per her
    // real schedule (shift / lunch / approved time off / blocked time / live break). No override on this path.
    const idx = slotId.lastIndexOf(':'); const slotTech = idx > 0 ? slotId.slice(0, idx) : ''; const startMin = idx > 0 ? Number(slotId.slice(idx + 1)) : NaN;
    if (this.eligibility && slotTech && Number.isFinite(startMin)) {
      const startTime = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`;
      try {
        await this.eligibility.assert({ tenantId: ctx.tenantId, branchId: ctx.branchId || null, technicianId: slotTech, serviceIds: (body?.serviceIds || []).filter(Boolean), at: { dateIso: await this.repo.today(ctx), startTime }, durationMin: body?.durationMinutes || 30, actor: { userId: ctx.userId, role: ctx.role, permissions: ctx.permissions, overrideConflicts: false } });
      } catch (e: any) {
        if (e instanceof TechnicianEligibilityError) {
          this.log(ctx, 'technician_eligibility_refused', 'technician', slotTech, { action: 'live_schedule.book_slot', code: e.code });
          if (e.code === 'SCHEDULE_CONFLICT' || e.code === 'TECHNICIAN_NOT_AVAILABLE' || e.code === 'TECHNICIAN_ALREADY_SERVING') throw new ConflictError(e.message);
          if (e.code === 'TECHNICIAN_BRANCH_ACCESS_DENIED') throw new ForbiddenError(e.message);
          throw new ValidationError(e.message);
        }
        throw e;
      }
    }
    // Merge Oct 12 2026: the repository writes through the shared appointment-slot-guard — a slot taken on another device
    // since the board was drawn is a 409, not a swallowed insert reported as "could not book".
    const res = await this.repo.bookOpenSlot(ctx, slotId, body || {}).catch((e) => {
      if (e instanceof AppointmentSlotConflict) throw new ConflictError('That slot was just booked on another device — pick another time');
      throw e;
    });
    if (!res) throw new ValidationError('Could not book that slot');
    this.log(ctx, 'technician_open_slot_booked', 'appointment', res.appointmentId, { slotId });
    return res;
  }
}

/** Monday..Sunday (YYYY-MM-DD) of the week containing `date`. Pure calendar arithmetic on the date string (no TZ). */
export function weekDates(date: string): string[] {
  const [y, m, d] = date.split('-').map((x) => parseInt(x, 10));
  const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();   // 0 = Sunday
  const monday = addDays(date, -((dow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
