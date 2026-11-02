// time-clock.service.ts — technician clock-in / clock-out / break + today's roster status. Reuses technician_shifts
// (the punch) and technician_breaks (580). Every clock change ALSO moves the ONE authoritative workforce state
// (WorkforceStatusService → technician_workforce_state + the legacy technician_statuses compat row), so a technician
// on break or clocked out disappears from AVAILABLE immediately (mandate §11, §147).
//
// Rules (Technician Profile merge, Oct 12 2026 — their workforce audit P1 #17, kept on top of our Oct 3 timezone rule):
//   • the DATE KEY is the branch-local day (branches.timezone), never UTC;
//   • split shifts are allowed (any number of punches per day; one OPEN punch per technician — partial unique 580);
//   • a double clock-in is ONE transition — the second call returns the existing open punch (idempotent, never a 500);
//   • clock-out finds the OPEN punch regardless of the date it started on (an overnight shift, a missed clock-out);
//   • server time only — no client-supplied timestamps on this path.
import { businessDate, addDays } from '@aipowersalon/date-time';
import { foldVi, clampPage, clampPageSize, withCode } from '@aipowersalon/api-contracts';
import { TIME_CLOCK_PAGE_SIZE_MAX, type TimeClockStateQuery } from '@aipowersalon/api-contracts/tenant';
import { type RealtimeEmitter, EVENTS } from '@aipowersalon/realtime-contracts';
import { buildTimeClockSummary, deriveTechClock, isActivePunch,
  type TimeClockContext, type TimeClockState, type TechnicianClockRow, type ShiftPunch, type BreakRow } from './time-clock.dto';
import type { TimeClockRepositoryPort } from './time-clock.repository';
import type { WorkforceStatusService } from '../workforce-status/workforce-status.service';
import { WorkforceStateError } from '../workforce-status/workforce-status-core';
import { classifyBreak, mergeBreakPolicy, validateBreakPolicy, DEFAULT_BREAK_POLICY, type BreakPolicy } from './break-policy';

export class TimeClockForbiddenError extends Error {}
export class TimeClockValidationError extends Error {}
/** The move is illegal in the technician's CURRENT state (e.g. break while clocked out). HTTP 409. */
export class TimeClockConflictError extends Error { constructor(msg: string, public readonly code = 'CLOCK_STATE_CONFLICT') { super(msg); } }

// shift_date is the BRANCH's day from Oct 3 2026 (it was the UTC day: an 8:30 pm New Jersey clock-in was filed under
// tomorrow). Rows written before then keep their UTC dates; the previous-day rule below covers both.
const DEFAULT_TZ = 'America/New_York';
const dayIn = (tz: string, iso: string) => businessDate(tz, new Date(iso));

export class TimeClockService {
  constructor(private readonly repo: TimeClockRepositoryPort, private readonly rt?: RealtimeEmitter | null, private readonly workforce?: WorkforceStatusService | null) {}
  private auth(ctx: TimeClockContext) { if (!ctx?.userId || !ctx?.tenantId) throw new TimeClockForbiddenError('Not authenticated'); }

  // Any clock change (manager path OR kiosk PIN path OR tech app — all go through here) refreshes the Staff-on-Duty /
  // Live Operations boards for that branch. Best-effort: a no-op if realtime or the branch is absent.
  private emitClockUpdate(ctx: TimeClockContext, technicianId: string, state: 'clocked_in' | 'clocked_out' | 'on_break', shiftId?: string | null) {
    if (!this.rt || !ctx.branchId) return;
    try {
      // §343: when the repository recorded technician.clocked_in/out the projection delivers time_clock_updated, and
      // technician_clock_updated rides technician.status_changed (the workforce CAS records it, the projection delivers it);
      // both direct pushes are the fallback when the projection is off.
      if (!this.repo.emitsDomainEvents?.()) {
        this.rt.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId }, EVENTS.timeClockUpdated, { technicianId, state });
        this.rt.toTenant({ tenantId: ctx.tenantId, branchId: ctx.branchId }, EVENTS.technicianClockUpdated, { technicianId, state, shiftId: shiftId ?? null });
      }
    } catch { /* realtime is best-effort */ }
  }

  // Workforce state is the authority for assignability; the punch row is the attendance record. If the two disagree
  // (e.g. the state row says clocked in but no open punch exists), the punch wins and the state is re-synced here.
  private async syncWorkforce(ctx: TimeClockContext, technicianId: string, move: 'clockIn' | 'clockOut' | 'breakStart' | 'breakEnd', extra: { openShiftId?: string | null; breakStartedAt?: string | null; created?: boolean } = {}) {
    if (!this.workforce) return;
    try {
      if (move === 'clockIn') await this.workforce.clockIn(ctx.tenantId, technicianId, { openShiftId: extra.openShiftId ?? null, branchId: ctx.branchId || undefined });
      else if (move === 'clockOut') await this.workforce.clockOut(ctx.tenantId, technicianId);
      else if (move === 'breakStart') await this.workforce.breakStart(ctx.tenantId, technicianId, { breakStartedAt: extra.breakStartedAt ?? new Date().toISOString() });
      else await this.workforce.breakEnd(ctx.tenantId, technicianId);
    } catch (e) {
      // Idempotent re-sync: "already clocked in" after we found/created the open punch is not an error; everything
      // else (a real illegal move) surfaces as a 409 so the caller never sees a half-applied state.
      if (e instanceof WorkforceStateError && e.code === 'CLOCK_STATE_CONFLICT') {
        const state = await this.workforce.getTechnicianState(ctx.tenantId, technicianId);
        const already = (move === 'clockIn' && state && state.clock !== 'CLOCKED_OUT') || (move === 'clockOut' && state && state.clock === 'CLOCKED_OUT')
          || (move === 'breakStart' && state && state.clock === 'ON_BREAK') || (move === 'breakEnd' && state && state.clock === 'CLOCKED_IN');
        // Fair Turn: a technician's FIRST touch seeds the workforce row from the punch this call just opened, so the
        // clock-in move is a no-op — the turn queue still has to follow it (an idempotent JOIN), or she never joins.
        // Only the call that opened the punch does it (a racing duplicate clock-in changes nothing). A technician clocked
        // in with no turn row otherwise is ranked as back-of-line by the engine and joined by a manager's Join or the next
        // day-start sweep.
        if (already) { if (move === 'clockIn' && extra.created) await this.workforce.syncTurnQueue?.(ctx.tenantId, technicianId, move); return; }
        throw new TimeClockConflictError(e.message, e.code);
      }
      throw e;
    }
  }

  // A shift can cross midnight (and older rows carry UTC dates), so the punches that count are the branch day's plus any
  // punch from the previous day that is still open or ended today; punches that ended yesterday stay out of today's
  // hours. (Before this rule an 8:15 pm EDT clock-out of a 4 pm shift found "no open punch" and the shift stayed open.)
  private async zone(ctx: TimeClockContext): Promise<string> { return (await this.repo.timeZone?.(ctx).catch(() => undefined)) || DEFAULT_TZ; }
  /** Branch-local date key for `now`. */
  async todayKey(ctx: TimeClockContext, now = new Date()): Promise<string> { return dayIn(await this.zone(ctx), now.toISOString()); }
  private async currentPunches(ctx: TimeClockContext, nowIso: string, tz?: string, technicianId?: string) {
    const z = tz || (await this.zone(ctx));
    const d = dayIn(z, nowIso);
    const [today, prev] = await Promise.all([this.repo.listTodayPunches(ctx, d, technicianId), this.repo.listTodayPunches(ctx, addDays(d, -1), technicianId)]);
    const seen = new Set(today.map((p) => p.id));
    return [...today, ...prev.filter((p) => !seen.has(p.id) && (isActivePunch(p) || (!!p.endTime && dayIn(z, p.endTime) === d)))];
  }
  private async currentBreaks(ctx: TimeClockContext, nowIso: string, tz: string, technicianId?: string): Promise<BreakRow[]> {
    return this.repo.listBreaksForDate(ctx, dayIn(tz, nowIso), tz, technicianId).catch(() => [] as BreakRow[]);
  }

  async getState(ctx: TimeClockContext, q: TimeClockStateQuery = {}): Promise<TimeClockState> {
    this.auth(ctx);
    const nowIso = new Date().toISOString();
    const tz = await this.zone(ctx);
    const [techs, punches, breaks] = await Promise.all([this.repo.listTechnicians(ctx), this.currentPunches(ctx, nowIso, tz), this.currentBreaks(ctx, nowIso, tz)]);
    const onClock = (s: string) => s === 'clocked_in' || s === 'on_break';
    const avatarOf = new Map(techs.map((t) => [t.technicianId, (t as { avatarUrl?: string | null }).avatarUrl ?? null]));
    const rows: TechnicianClockRow[] = techs
      .map((t) => deriveTechClock(t.technicianId, t.technicianName, punches, nowIso, breaks))
      // sort clocked-in (incl. on break) first, then by hours today desc
      .sort((a, b) => (onClock(a.state) ? 0 : 1) - (onClock(b.state) ? 0 : 1) || b.hoursToday - a.hoursToday);
    const kpis = buildTimeClockSummary(rows);
    if (q.page == null) return { kpis, technicians: rows };
    // 200-technician §2 (Oct 27 2026): ONE page of the roster (search by name, accent-insensitive; filter by clock state);
    // the KPIs above still count every technician
    const needle = foldVi(q.search || '');
    const hit = rows.filter((r) => (!q.state || (q.state === 'on_clock' ? onClock(r.state) : r.state === q.state)) && (!needle || foldVi(r.technicianName).includes(needle)));
    const pageSize = clampPageSize(q.pageSize, 25, TIME_CLOCK_PAGE_SIZE_MAX);
    const totalPages = Math.max(1, Math.ceil(hit.length / pageSize));
    const page = Math.min(clampPage(q.page), totalPages);
    const items = hit.slice((page - 1) * pageSize, page * pageSize).map((r) => ({ ...r, avatarUrl: avatarOf.get(r.technicianId) ?? null }));
    return { kpis, technicians: items, page: { page, pageSize, total: hit.length, totalPages, totalAll: rows.length } };
  }

  // `include` = a punch the caller just touched (e.g. a shift that started yesterday and was closed just now): it is
  // folded into the derivation so the response reflects the action even when the punch is not on today's key.
  private async rowFor(ctx: TimeClockContext, technicianId: string, nowIso: string, include?: ShiftPunch | null): Promise<TechnicianClockRow> {
    const tz = await this.zone(ctx);
    // M4: only THIS technician's punches and breaks — the row is derived from hers alone (deriveTechClock filters by
    // technician), and a 100-technician opening burst no longer reads the branch's whole day 100 times.
    const [fresh, breaks] = await Promise.all([this.currentPunches(ctx, nowIso, tz, technicianId), this.currentBreaks(ctx, nowIso, tz, technicianId)]);
    const punches = include && !fresh.some((p) => p.id === include.id) ? [...fresh, include] : fresh;
    return deriveTechClock(technicianId, null, punches, nowIso, breaks);
  }

  /** The technician's open punch: the repository's open-punch read (any date) first, today's window as a fallback. */
  private async openPunch(ctx: TimeClockContext, technicianId: string, nowIso: string): Promise<ShiftPunch | null> {
    const direct = await this.repo.findOpenPunch(ctx, technicianId).catch(() => null);
    if (direct && isActivePunch(direct)) return direct;
    const punches = await this.currentPunches(ctx, nowIso, undefined, technicianId);
    return punches.filter((p) => p.technicianId === technicianId).find(isActivePunch) ?? null;
  }

  /** Clock in. Idempotent: if the technician already has an OPEN punch the existing one is returned (`created=false`). */
  async clockIn(ctx: TimeClockContext, technicianId: string): Promise<TechnicianClockRow & { created: boolean; shiftId: string }> {
    this.auth(ctx);
    if (!technicianId) throw new TimeClockValidationError('technicianId is required');
    if (!(await this.repo.technicianExists(ctx, technicianId))) throw withCode(new TimeClockValidationError('Technician not found'), 'TECHNICIAN_NOT_FOUND');
    const nowIso = new Date().toISOString();
    const dateKey = await this.todayKey(ctx, new Date(nowIso));
    const { punch, created } = await this.repo.insertPunch(ctx, technicianId, dateKey, nowIso);   // partial unique → exactly one open punch
    await this.syncWorkforce(ctx, technicianId, 'clockIn', { openShiftId: punch.id, created });
    if (created) this.emitClockUpdate(ctx, technicianId, 'clocked_in', punch.id);
    return { ...(await this.rowFor(ctx, technicianId, nowIso, punch)), created, shiftId: punch.id };
  }

  /** Fair Turn §35–36: stamp the closed break's paid / unpaid minutes under the salon's break policy (603). */
  private async classify(ctx: TimeClockContext, brk: BreakRow | null, interrupted = false): Promise<void> {
    if (!brk || !brk.endedAt || !this.repo.classifyBreak) return;
    const layers = this.repo.breakPolicyLayers ? await this.repo.breakPolicyLayers(ctx).catch(() => ({ salon: null, branch: null, version: 0 })) : { salon: null, branch: null, version: 0 };
    const minutes = Math.max(0, Math.round((Date.parse(brk.endedAt) - Date.parse(brk.startedAt)) / 60000));
    const c = classifyBreak(mergeBreakPolicy(layers), { kind: brk.kind, minutes, interrupted });
    await this.repo.classifyBreak(ctx, brk.id, { ...c, policyVersion: layers.version });
  }
  async breakPolicy(ctx: TimeClockContext): Promise<{ policy: BreakPolicy; defaults: BreakPolicy; version: number; salon: unknown; branch: unknown }> {
    this.auth(ctx);
    const layers = this.repo.breakPolicyLayers ? await this.repo.breakPolicyLayers(ctx) : { salon: null, branch: null, version: 0 };
    return { policy: mergeBreakPolicy(layers), defaults: { ...DEFAULT_BREAK_POLICY }, version: layers.version, salon: layers.salon, branch: layers.branch };
  }
  async saveBreakPolicy(ctx: TimeClockContext, body: { scope?: string; policy?: unknown; reason?: string | null }) {
    this.auth(ctx);
    const scope = body?.scope === 'branch' ? 'branch' : 'salon';
    const problems = validateBreakPolicy(body?.policy);
    if (problems.length) throw new TimeClockValidationError(problems.join(' '));
    if (!this.repo.saveBreakPolicy) throw new TimeClockValidationError('Break policies need the database.');
    const r = await this.repo.saveBreakPolicy(ctx, scope, body!.policy as Record<string, unknown>, typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null);
    return { ...(await this.breakPolicy(ctx)), version: r.version };
  }
  /** §36 BREAK_INTERRUPTED: the technician is called back to work during a break — recorded, never a full meal. */
  async breakInterrupt(ctx: TimeClockContext, technicianId: string, reason: string | null | undefined): Promise<TechnicianClockRow> {
    this.auth(ctx);
    if (!technicianId) throw new TimeClockValidationError('technicianId is required');
    const why = (reason ?? '').trim();
    if (why.length < 3) throw withCode(new TimeClockValidationError('Say why the break was interrupted.'), 'BREAK_INTERRUPT_REASON_REQUIRED');
    if (!this.repo.interruptBreak) throw new TimeClockValidationError('Break interruption needs the database.');
    const nowIso = new Date().toISOString();
    const closed = await this.repo.interruptBreak(ctx, technicianId, nowIso, ctx.userId, why);
    if (!closed) throw withCode(new TimeClockConflictError('Technician is not on break'), 'TECHNICIAN_NOT_ON_BREAK');
    await this.classify(ctx, closed, true);
    await this.syncWorkforce(ctx, technicianId, 'breakEnd');
    this.emitClockUpdate(ctx, technicianId, 'clocked_in', closed.shiftId);
    return this.rowFor(ctx, technicianId, nowIso);
  }

  /** Clock out: closes the OPEN punch (whatever its date) and any open break. */
  async clockOut(ctx: TimeClockContext, technicianId: string): Promise<TechnicianClockRow> {
    this.auth(ctx);
    if (!technicianId) throw new TimeClockValidationError('technicianId is required');
    const nowIso = new Date().toISOString();
    const active = await this.openPunch(ctx, technicianId, nowIso);
    if (!active) throw withCode(new TimeClockValidationError('Technician is not clocked in'), 'TECHNICIAN_NOT_CLOCKED_IN');
    await this.classify(ctx, await this.repo.closeBreak(ctx, technicianId, nowIso, ctx.userId));   // a break cannot outlive its shift (classified, §35)
    const closed = await this.repo.closePunch(ctx, active.id, nowIso);          // CAS: only if still open
    if (!closed) throw withCode(new TimeClockValidationError('Technician is not clocked in'), 'TECHNICIAN_NOT_CLOCKED_IN');
    await this.syncWorkforce(ctx, technicianId, 'clockOut');
    this.emitClockUpdate(ctx, technicianId, 'clocked_out', active.id);
    return this.rowFor(ctx, technicianId, nowIso, closed);
  }

  /** Start a break (part of the clock). Requires an open punch; one OPEN break per technician. */
  async breakStart(ctx: TimeClockContext, technicianId: string, opts: { kind?: 'break' | 'lunch'; reason?: string | null } = {}): Promise<TechnicianClockRow> {
    this.auth(ctx);
    if (!technicianId) throw new TimeClockValidationError('technicianId is required');
    const nowIso = new Date().toISOString();
    const active = await this.openPunch(ctx, technicianId, nowIso);
    if (!active) throw withCode(new TimeClockConflictError('Technician must be clocked in to start a break'), 'CLOCK_IN_BEFORE_BREAK');
    const { brk } = await this.repo.openBreak(ctx, technicianId, active.id, nowIso, ctx.userId, opts.kind || 'break', opts.reason ?? null);
    await this.syncWorkforce(ctx, technicianId, 'breakStart', { breakStartedAt: brk.startedAt });
    this.emitClockUpdate(ctx, technicianId, 'on_break', active.id);
    return this.rowFor(ctx, technicianId, nowIso);
  }

  async breakEnd(ctx: TimeClockContext, technicianId: string): Promise<TechnicianClockRow> {
    this.auth(ctx);
    if (!technicianId) throw new TimeClockValidationError('technicianId is required');
    const nowIso = new Date().toISOString();
    const closed = await this.repo.closeBreak(ctx, technicianId, nowIso, ctx.userId);
    if (!closed) throw withCode(new TimeClockConflictError('Technician is not on break'), 'TECHNICIAN_NOT_ON_BREAK');
    await this.classify(ctx, closed);
    await this.syncWorkforce(ctx, technicianId, 'breakEnd');
    this.emitClockUpdate(ctx, technicianId, 'clocked_in', closed.shiftId);
    return this.rowFor(ctx, technicianId, nowIso);
  }
}
