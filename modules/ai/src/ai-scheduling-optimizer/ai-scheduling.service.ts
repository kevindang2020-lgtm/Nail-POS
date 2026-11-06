// ai-scheduling.service.ts — the AI Scheduling Optimizer ENGINE (BUILD_PLAN Phase 7, agent A). A deterministic optimizer
// over the real booking day (ai-scheduling-day.ts); an LLM only words an explanation of a result the engine already
// computed (SCHED_EXPLANATION_PORT). The workflow:
//   generate (server loads the appointment, chooses / validates the target on the REAL context, simulates server-side,
//   derives "touches a confirmed appointment") → stored review_required → accept / reject / return (each a conditional
//   update on the row's version, every transition recorded with before / after) → customer approval when required (the
//   ops half's proposal port) → apply THROUGH booking.service with the STORED proposed_state, the stored snapshot's
//   version and a versioned idempotency key → retry / rollback. Runs detect gaps / conflicts / understaffing and turn
//   technician-day moves into recommendations through the same generate path.
// Every public method re-checks permissions (need) so a non-HTTP caller is gated too; system / automation contexts pass
// only on the methods jobs and the ops half call (marked SYS below). Tenant / branch always come from ctx.
import { technicianDayContext, type DayContext } from './ai-scheduling-day-context';
import { randomUUID } from 'node:crypto';
import { hasPermission } from '@aipowersalon/permissions';
import { localDateTimeToEpochMs, addDays, isYmd } from '@aipowersalon/date-time';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import type {
  SchedRecommendation, SchedRecStatus, SchedOptionsRequest, SchedOptionsResponse, SchedHold, SchedGenerateRequest, SchedDecisionRequest,
  SchedApplyRequest, SchedApplyResponse, SchedApplication, SchedRecommendationFilters, SchedRecommendationList, SchedRunRequest, SchedRunDetail, SchedRun,
  SchedSettingsView, SchedSettingsUpdate, SchedSettingsLayer, SchedRuleVersion, SchedCalendarIndicators, SchedTimeOff, SchedTimeOffCreate, SchedLock,
  SchedServiceProfile, SchedProposalSummary, SchedConfig, SchedAppointmentSnapshot, SchedProposedChange, SchedVersions,
} from '@aipowersalon/api-contracts/tenant';
import { simulateChange, buildRecommendation } from './ai-scheduling-recommendation';
import { resolveSettings, sanitizeConfigPatch, type SettingsRow, type ResolvedSettings, type SchedulingConfig } from './ai-scheduling-settings';
import { transition, type RecState, type RecEvent } from './ai-scheduling-workflow';
import { snapshotDrift, applyKey, bookingErrorCode, type BookingPort } from './ai-scheduling-application';
import { detectUnderstaffing } from './ai-scheduling-detection';
import { optimizeTechnicianDay } from './ai-scheduling-optimizer';
import {
  type DayData, type MoveTarget, isLockedAppt, checkMove, dayMetrics, sumMetrics, withMove, detectDay, enumerateOptions, touchesConfirmed,
  hhmm, toMin, INACTIVE_STATUSES,
} from './ai-scheduling-day';
import { SchedError } from './ai-scheduling-errors';
import type { SchedStore } from './ai-scheduling.store';
import { LIVE_STATUSES, EXPIRABLE_STATUSES } from './ai-scheduling.store';
import type { SchedDayReader, SchedApptRecord } from './ai-scheduling.data-adapter';
import type { SchedCtx, SchedEventsPort, SchedProposalPort, SchedExplanationPort, SchedUsagePort, SchedPlatformSwitchPort, SchedAutomationPort, SchedAggregateType } from './ai-scheduling.ports';

export type { SchedCtx } from './ai-scheduling.ports';

// ── integration ports owned by the engine ──
export interface ForecastPort { getBusyHours(ctx: SchedCtx, scope: { branchId: string | null; date: string }): Promise<{ available: boolean; version: string | null; demandMinutes?: number }>; }
export interface AuditSink { record(ctx: SchedCtx, action: string, id: string, meta: Record<string, unknown>): Promise<void>; }
/** The booking module's BookingHoldService surface (acquire clamps the seconds with clampHoldSeconds). */
export interface SchedHoldPort {
  acquire(req: { tenantId: string; branchId: string; technicianId: string | null; startsAt: number; endsAt: number; bookingSessionId: string; channel: string; customerId?: string | null; serviceIds?: string[]; holdSeconds?: number }, now?: number): Promise<{ holdId: string; expiresAt: number }>;
  release(tenantId: string, holdId: string, reason: 'customer_canceled'): Promise<void>;
}

export interface AiSchedulingDeps {
  store: SchedStore; reader: SchedDayReader; forecast: ForecastPort; booking: BookingPort; holds: SchedHoldPort | null; audit: AuditSink;
  events: SchedEventsPort; proposals: SchedProposalPort; explanations: SchedExplanationPort; usage: SchedUsagePort;
  platform: SchedPlatformSwitchPort; automation: SchedAutomationPort; now?: () => number;
}

export const ENGINE_VERSION = 'sched-engine-v2';
export const RULE_VERSION = 'sched-rules-v2';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BOOKING_PERMS = ['pos.booking.view', 'pos.booking.reschedule', 'pos.booking.assign_technician'];
type Decision = 'accept' | 'reject' | 'return';

const requireTenant = (ctx: SchedCtx) => { if (!ctx?.tenantId) throw new SchedError('TENANT_REQUIRED'); };
const layerToRow = (l: SchedSettingsLayer | null | undefined): SettingsRow | null => (l ? { level: l.level, branch_id: l.branchId, enabled: l.enabled, kill_switch: l.killSwitch, config: (l.config ?? null) as Partial<SchedulingConfig> | null } : null);
const intOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isInteger(v) ? v : d);
const versionOf = (body: { expectedVersion?: unknown } | null | undefined): number => {
  const v = body?.expectedVersion;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw new SchedError('VALIDATION_FAILED', 'expectedVersion (integer) is required');
  return v;
};

export class AiSchedulingService {
  constructor(private readonly d: AiSchedulingDeps) {}

  private now() { return this.d.now ? this.d.now() : Date.now(); }
  private isSystem(ctx: SchedCtx) { return ctx.actor === 'system' || ctx.actor === 'automation' || String(ctx.role || '').toUpperCase() === 'SYSTEM'; }
  /** Permission re-check for every caller. `sys` = background jobs / the ops half may call this method without a user. */
  private need(ctx: SchedCtx, key: string, sys = false) {
    requireTenant(ctx);
    if (sys && this.isSystem(ctx)) return;
    if (!hasPermission(ctx as any, key)) throw new SchedError('FORBIDDEN', 'Missing ' + key);
  }
  /** Round 2 H (Oct 12 2026) — PERMISSION DECISION: placing or releasing a booking hold is a WRITE. It needs the key the
   *  booking desk already has for writing the diary, `pos.booking.create` (or the optimizer's own `ai_scheduling.generate`).
   *  The AI receptionist's principal carries pos.booking.create through its voice-booking authorization
   *  (AI_RECEPTIONIST_PERMISSIONS: it already books, so it may hold). No new key. */
  private needHoldWrite(ctx: SchedCtx) {
    requireTenant(ctx);
    if (this.isSystem(ctx)) return;
    if (!hasPermission(ctx as any, 'pos.booking.create') && !hasPermission(ctx as any, 'ai_scheduling.generate')) throw new SchedError('FORBIDDEN', 'Missing pos.booking.create');
  }
  private branchCtx(ctx: SchedCtx, branchId: string | null): SchedCtx { return { ...ctx, branchId }; }
  private emit(ctx: SchedCtx, type: string, agg: { type: SchedAggregateType; id: string; version?: number | null }, payload: Record<string, unknown>, trx?: unknown) {
    return this.d.events.emit(ctx, type, agg, payload, trx);
  }
  private async audit(ctx: SchedCtx, action: string, id: string, meta: Record<string, unknown> = {}) {
    try { await this.d.audit.record(ctx, action, id, meta); } catch { /* audit never breaks the flow */ }
  }
  private sessionBranch(ctx: SchedCtx): string {
    if (!ctx.branchId) throw new SchedError('VALIDATION_FAILED', 'a location is required — sign in to a location');
    return ctx.branchId;
  }

  // ── settings ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private async layersFor(ctx: SchedCtx, branchId: string | null) {
    const rows = await this.d.store.layers(ctx.tenantId);
    return { tenant: rows.find((r) => r.level === 'tenant') ?? null, branch: branchId ? rows.find((r) => r.level === 'branch' && r.branchId === branchId) ?? null : null };
  }
  private async resolved(ctx: SchedCtx, branchId: string | null): Promise<ResolvedSettings & { configVersion: number; tenant: SchedSettingsLayer | null; branch: SchedSettingsLayer | null }> {
    const [{ tenant, branch }, platformKilled] = await Promise.all([this.layersFor(ctx, branchId), this.d.platform.isKilled().catch(() => true)]);
    const r = resolveSettings({ tenant: layerToRow(tenant), branch: layerToRow(branch), platformKilled });
    return { ...r, configVersion: branch?.version ?? tenant?.version ?? 0, tenant, branch };
  }

  /** SYS. The resolved settings for the session branch: { enabled, killed, platformKilled, automationAllowed, config, configVersion }. */
  async effectiveConfig(ctx: SchedCtx) {
    this.need(ctx, 'ai_scheduling.view', true);
    const r = await this.resolved(ctx, ctx.branchId ?? null);
    return { enabled: r.enabled, killed: r.killed, platformKilled: r.platformKilled, automationAllowed: r.automationAllowed, config: r.config, configVersion: r.configVersion };
  }

  async getSettings(ctx: SchedCtx): Promise<SchedSettingsView> {
    this.need(ctx, 'ai_scheduling.view', true);
    const r = await this.resolved(ctx, ctx.branchId ?? null);
    return { effective: { enabled: r.enabled, killed: r.killed, platformKilled: r.platformKilled, automationAllowed: r.automationAllowed, config: r.config as SchedConfig }, tenant: r.tenant, branch: r.branch };
  }

  async settingsVersions(ctx: SchedCtx): Promise<SchedRuleVersion[]> {
    this.need(ctx, 'ai_scheduling.view');
    return this.d.store.listRuleVersions(ctx.tenantId, 100);
  }

  async updateSettings(ctx: SchedCtx, body: SchedSettingsUpdate): Promise<SchedSettingsView> {
    this.need(ctx, 'ai_scheduling.configure');
    if (body?.level !== 'tenant' && body?.level !== 'branch') throw new SchedError('VALIDATION_FAILED', "level must be 'tenant' or 'branch'");
    const expectedVersion = versionOf(body);
    const branchId = body.level === 'branch' ? this.sessionBranch(ctx) : null;
    for (const k of ['enabled', 'killSwitch'] as const) if (body[k] !== undefined && body[k] !== null && typeof body[k] !== 'boolean') throw new SchedError('VALIDATION_FAILED', `${k} must be true, false or null`);
    if (body.config !== undefined && body.config !== null && typeof body.config !== 'object') throw new SchedError('VALIDATION_FAILED', 'config must be an object');
    const { tenant, branch } = await this.layersFor(ctx, branchId);
    const cur = body.level === 'tenant' ? tenant : branch;
    const patch = sanitizeConfigPatch(body.config as Record<string, unknown> | null | undefined);
    const config = body.config === null ? null : body.config === undefined ? (cur?.config ?? null)
      : { ...(cur?.config ?? {}), ...patch, ...(patch.weights ? { weights: { ...(cur?.config?.weights ?? {}), ...patch.weights } } : {}) } as Partial<SchedConfig>;
    const enabled = body.enabled === undefined ? (cur?.enabled ?? null) : body.enabled;
    const killSwitch = body.killSwitch === undefined ? (cur?.killSwitch ?? null) : body.killSwitch;
    const evCtx = this.branchCtx(ctx, branchId);
    await this.d.store.tx(async (s, trx) => {
      const layer = await s.writeLayer(ctx.tenantId, { level: body.level, branchId, expectedVersion, enabled, killSwitch, config, userId: ctx.userId ?? null });
      if (!layer) throw new SchedError('VERSION_CONFLICT', 'these settings were changed by someone else — reload and try again', { currentVersion: cur?.version ?? 0 });
      await s.insertRuleVersion(ctx.tenantId, layer, ctx.userId ?? null);
      await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_SETTINGS_CHANGED, { type: 'schedule_settings', id: branchId ?? ctx.tenantId, version: layer.version }, { level: body.level, version: layer.version, killSwitch: !!killSwitch, enabled }, trx);
      if (killSwitch === true && cur?.killSwitch !== true) await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_AUTOMATION_DISABLED, { type: 'schedule_settings', id: branchId ?? ctx.tenantId, version: layer.version }, { scope: body.level, killed: true }, trx);
    });
    await this.audit(ctx, 'settings.updated', branchId ?? ctx.tenantId, { level: body.level, before: cur ? { enabled: cur.enabled, killSwitch: cur.killSwitch, config: cur.config, version: cur.version } : null, after: { enabled, killSwitch, config } });
    return this.getSettings(ctx);
  }

  /** SYS. Super Admin "disable" (ops half) / any salon-level kill switch: turns the salon's kill switch on or off. */
  async setTenantKillSwitch(ctx: SchedCtx, killed: boolean, reason: string): Promise<SchedSettingsView> {
    this.need(ctx, 'ai_scheduling.configure', true);
    for (let attempt = 0; attempt < 3; attempt++) {
      const { tenant } = await this.layersFor(ctx, null);
      try {
        await this.d.store.tx(async (s, trx) => {
          const layer = await s.writeLayer(ctx.tenantId, { level: 'tenant', branchId: null, expectedVersion: tenant?.version ?? 0, enabled: tenant?.enabled ?? null, killSwitch: killed, config: tenant?.config ?? null, userId: UUID_RE.test(ctx.userId) ? ctx.userId : null });
          if (!layer) throw new SchedError('VERSION_CONFLICT');
          await s.insertRuleVersion(ctx.tenantId, layer, UUID_RE.test(ctx.userId) ? ctx.userId : null);
          const evCtx = this.branchCtx(ctx, null);
          await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_SETTINGS_CHANGED, { type: 'schedule_settings', id: ctx.tenantId, version: layer.version }, { level: 'tenant', version: layer.version, killSwitch: killed }, trx);
          if (killed) await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_AUTOMATION_DISABLED, { type: 'schedule_settings', id: ctx.tenantId, version: layer.version }, { scope: 'tenant', killed: true, reason: String(reason ?? '').slice(0, 200) }, trx);
        });
        await this.audit(ctx, killed ? 'settings.kill_switch_on' : 'settings.kill_switch_off', ctx.tenantId, { reason: String(reason ?? '').slice(0, 500) });
        return this.getSettings(this.branchCtx(ctx, null));
      } catch (e) { if (!(e instanceof SchedError && e.code === 'VERSION_CONFLICT') || attempt === 2) throw e; }
    }
    throw new SchedError('VERSION_CONFLICT');
  }

  // ── options + holds ───────────────────────────────────────────────────────────────────────────────────────────────
  private async checkDateWindow(ctx: SchedCtx, branchId: string, date: string, cfg: SchedulingConfig) {
    if (!isYmd(date)) throw new SchedError('VALIDATION_FAILED', 'date must be YYYY-MM-DD');
    const clk = await this.d.reader.clock(ctx, branchId);
    if (date < clk.today) throw new SchedError('VALIDATION_FAILED', 'that date is in the past');
    if (date > addDays(clk.today, cfg.maxHorizonDays)) throw new SchedError('VALIDATION_FAILED', `that date is more than ${cfg.maxHorizonDays} days ahead`);
    return clk;
  }

  /** SYS. Ranked, feasible appointment options (receptionist, copilot, POS "find a time"). Never books; `hold` reserves the
   *  top option through the booking module's hold service. */
  async findOptions(ctx: SchedCtx, req: SchedOptionsRequest): Promise<SchedOptionsResponse> {
    this.need(ctx, 'ai_scheduling.view', true);
    const branchId = this.sessionBranch(ctx);
    if (!req || !Array.isArray(req.serviceIds) || !req.serviceIds.length || req.serviceIds.some((s) => typeof s !== 'string' || !s)) throw new SchedError('VALIDATION_FAILED', 'serviceIds is required');
    if (req.preferredTime != null && !HHMM_RE.test(req.preferredTime)) throw new SchedError('VALIDATION_FAILED', 'preferredTime must be HH:MM');
    const r = await this.resolved(ctx, branchId);
    if (!r.enabled) throw new SchedError('MODULE_DISABLED', 'the scheduling optimizer is turned off for this location');
    await this.checkDateWindow(ctx, branchId, req.date, r.config);
    const limit = Math.min(20, Math.max(1, intOr(req.limit, 5)));
    const day = await this.d.reader.loadDay(ctx, branchId, req.date);
    const { options } = enumerateOptions(day, req, r.config, limit);
    const fc = await this.d.forecast.getBusyHours(ctx, { branchId, date: req.date }).catch(() => ({ available: false, version: null }));
    let hold: SchedHold | null = null;
    if (req.hold) this.needHoldWrite(ctx);   // asked to hold → a write, even when nothing is free to hold
    if (req.hold && options.length) {
      if (!this.d.holds) throw new SchedError('VALIDATION_FAILED', 'holds are not available without a database');
      const sessionId = req.hold.bookingSessionId ?? randomUUID();
      if (!UUID_RE.test(sessionId)) throw new SchedError('VALIDATION_FAILED', 'bookingSessionId must be a uuid');
      const top = options[0];
      try {
        const h = await this.d.holds.acquire({
          tenantId: ctx.tenantId, branchId, technicianId: top.technicianId,
          startsAt: localDateTimeToEpochMs(req.date, hhmm(top.spanStartMin), day.timeZone), endsAt: localDateTimeToEpochMs(req.date, hhmm(top.spanEndMin), day.timeZone),
          bookingSessionId: sessionId, channel: req.hold.channel || 'pos', customerId: req.hold.customerId ?? null, serviceIds: req.serviceIds, holdSeconds: req.hold.seconds ?? undefined,
        }, this.now());
        hold = { holdId: h.holdId, optionId: top.id, expiresAt: new Date(h.expiresAt).toISOString() };
      } catch (e: any) {
        if (e?.code === 'SLOT_HELD') throw new SchedError('SLOT_HELD', 'that time was just reserved by someone else — pick another option');
        throw e;
      }
    }
    void this.d.usage.record(ctx, 'options', { amount: 1 }).catch(() => undefined);
    return { options: options.map(({ spanStartMin: _s, spanEndMin: _e, ...o }) => o), forecastAvailable: !!fc.available, hold };
  }

  async releaseHold(ctx: SchedCtx, holdId: string): Promise<{ released: true }> {
    this.needHoldWrite(ctx);
    if (!UUID_RE.test(String(holdId))) throw new SchedError('NOT_FOUND');
    await this.d.holds?.release(ctx.tenantId, holdId, 'customer_canceled');
    await this.audit(ctx, 'hold.released', holdId);
    return { released: true };
  }

  // ── generate ──────────────────────────────────────────────────────────────────────────────────────────────────────
  private async loadAppt(ctx: SchedCtx, id: string): Promise<SchedApptRecord> {
    const a = typeof id === 'string' && id ? await this.d.reader.appointment(ctx, id) : null;
    if (!a || (ctx.branchId && a.branchId && a.branchId !== ctx.branchId)) throw new SchedError('NOT_FOUND', 'appointment not found');
    return a;
  }
  private snapshotOf(a: SchedApptRecord): SchedAppointmentSnapshot {
    return { appointmentId: a.id, date: a.date, startTime: hhmm(a.startMin), endTime: hhmm(a.endMin), technicianId: a.technicianId, status: a.status, version: a.version, customerId: a.customerId };
  }
  private improvement(before: ReturnType<typeof dayMetrics>, after: ReturnType<typeof dayMetrics>) {
    return (before.idleMin - after.idleMin) + 30 * (before.gapCount - after.gapCount) + (before.latenessRiskPct - after.latenessRiskPct);
  }
  /** The engine's own target: the option (same services, excluding this appointment) with the largest simulated
   *  improvement on the appointment's date, else the next day if it is inside the horizon. */
  private async chooseTarget(ctx: SchedCtx, a: SchedApptRecord, branchId: string, day: DayData, cfg: SchedulingConfig, today: string): Promise<{ to: MoveTarget; targetDay: DayData } | null> {
    const dates = [a.date, addDays(a.date, 1)].filter((d, i) => i === 0 || d <= addDays(today, cfg.maxHorizonDays));
    for (const date of dates) {
      const dd = date === a.date ? day : await this.d.reader.loadDay(ctx, branchId, date);
      const { options } = enumerateOptions(dd, { date, serviceIds: a.serviceIds, excludeAppointmentId: a.id, preferredTime: hhmm(a.startMin), preferredTechnicianId: a.technicianId }, cfg, 20);
      const differing = options.filter((o) => !(date === a.date && toMin(o.startTime) === a.startMin && o.technicianId === a.technicianId));
      if (!differing.length) continue;
      const dur = a.endMin - a.startMin;
      let best = differing[0], bestGain = -Infinity;
      for (const o of differing) {
        const to = { date, startMin: toMin(o.startTime), endMin: toMin(o.startTime) + dur, technicianId: o.technicianId };
        const before = date === a.date ? dayMetrics(day) : sumMetrics(dayMetrics(day), dayMetrics(dd));
        const after = date === a.date ? dayMetrics(withMove(day, a.id, to)) : sumMetrics(dayMetrics(withMove(day, a.id, to)), dayMetrics(withMove(dd, a.id, to, a)));
        const gain = this.improvement(before, after);
        if (gain > bestGain) { best = o; bestGain = gain; }
      }
      return { to: { date, startMin: toMin(best.startTime), technicianId: best.technicianId }, targetDay: dd };
    }
    return null;
  }

  /** SYS. Generate one recommendation for an appointment (target given → validated; omitted → chosen by the engine).
   *  Hard violations → 422 with `violations`, nothing stored. Locked → 409 LOCKED_APPOINTMENT. Stored review_required.
   *  `opts.runId` / `opts.automated` link it to a run / the automation runner. */
  async generate(ctx: SchedCtx, req: SchedGenerateRequest, opts: { runId?: string | null; automated?: boolean } = {}): Promise<SchedRecommendation> {
    this.need(ctx, 'ai_scheduling.generate', true);
    return (await this.generateInner(ctx, req, { ...opts, skipPreserve: false }))!;
  }

  /** skipPreserve (runs): a move with no simulated benefit is not stored (null). */
  private async generateInner(ctx: SchedCtx, req: SchedGenerateRequest, opts: { runId?: string | null; automated?: boolean; skipPreserve: boolean }): Promise<SchedRecommendation | null> {
    const a = await this.loadAppt(ctx, req?.appointmentId);
    const branchId = a.branchId ?? ctx.branchId ?? null;
    if (!branchId) throw new SchedError('VALIDATION_FAILED', 'the appointment has no location');
    const r = await this.resolved(ctx, branchId);
    if (!r.enabled || r.platformKilled) throw new SchedError('MODULE_DISABLED', r.platformKilled ? 'the scheduling optimizer is paused platform-wide' : 'the scheduling optimizer is turned off for this location');
    if (isLockedAppt(a)) throw new SchedError('LOCKED_APPOINTMENT', 'this appointment is locked (started, deposit paid or locked by staff) and cannot be moved');
    if (INACTIVE_STATUSES.has(a.status)) throw new SchedError('INVALID_STATE', `a ${a.status} appointment cannot be optimized`);
    const clk = await this.d.reader.clock(ctx, branchId);
    const day = await this.d.reader.loadDay(ctx, branchId, a.date);
    let to: MoveTarget; let targetDay: DayData;
    const t = req.target;
    if (t && (t.date || t.startTime || t.technicianId)) {
      if (t.date != null && !isYmd(t.date)) throw new SchedError('VALIDATION_FAILED', 'target.date must be YYYY-MM-DD');
      if (t.startTime != null && !HHMM_RE.test(t.startTime)) throw new SchedError('VALIDATION_FAILED', 'target.startTime must be HH:MM');
      to = { date: t.date ?? a.date, startMin: t.startTime ? toMin(t.startTime) : a.startMin, technicianId: t.technicianId ?? a.technicianId };
      if (to.date === a.date && to.startMin === a.startMin && to.technicianId === a.technicianId) throw new SchedError('VALIDATION_FAILED', 'the target is the appointment’s current slot');
      if (to.date !== a.date) await this.checkDateWindow(ctx, branchId, to.date, r.config);
      targetDay = to.date === a.date ? day : await this.d.reader.loadDay(ctx, branchId, to.date);
      if (targetDay.isPast) throw new SchedError('VALIDATION_FAILED', 'the target date is in the past');
    } else {
      const chosen = await this.chooseTarget(ctx, a, branchId, day, r.config, clk.today);
      if (!chosen) throw new SchedError('NO_FEASIBLE_OPTION', 'no other time satisfies every hard constraint');
      ({ to, targetDay } = chosen);
    }
    const violations = checkMove(targetDay, a, to);
    if (violations.length) throw new SchedError('HARD_CONSTRAINT_VIOLATION', 'the target breaks a hard scheduling rule', { violations });

    // server-side simulation: re-measure the day(s) with the appointment moved (stored duration — booking's length)
    const dur = a.endMin - a.startMin;
    const moved = { date: to.date, startMin: to.startMin, endMin: to.startMin + dur, technicianId: to.technicianId };
    const sameDay = to.date === a.date;
    const before = sameDay ? dayMetrics(day) : sumMetrics(dayMetrics(day), dayMetrics(targetDay));
    const after = sameDay ? dayMetrics(withMove(day, a.id, moved)) : sumMetrics(dayMetrics(withMove(day, a.id, moved)), dayMetrics(withMove(targetDay, a.id, moved, a)));
    const sim = simulateChange(before, after);
    const touches = touchesConfirmed(a, to);
    const fc = await this.d.forecast.getBusyHours(ctx, { branchId, date: to.date }).catch(() => ({ available: false, version: null }));
    const versions: SchedVersions = { forecastVersion: fc.version ?? null, ruleVersion: RULE_VERSION, engineVersion: ENGINE_VERSION, configVersion: r.configVersion };
    const kindType = sameDay && to.startMin === a.startMin ? 'change_technician' : 'move_appointment';
    const built = buildRecommendation({
      type: kindType, tenantId: ctx.tenantId, branchId, currentState: null, proposedState: null, hardConstraintsChecked: true, simulation: sim,
      dataQuality: fc.available ? 'good' : 'partial', forecastAvailable: !!fc.available, versions: { ...versions, configVersion: String(r.configVersion) },
      touchesConfirmedAppointment: touches, nowMs: this.now(), ttlMs: r.config.recommendationTtlMin * 60_000,
    });
    if (opts.skipPreserve && built.type === 'preserve_schedule') return null;
    const snapshot = this.snapshotOf(a);
    const proposed: SchedProposedChange = { kind: kindType === 'change_technician' ? 'assign_technician' : 'reschedule', appointmentId: a.id, date: to.date, startTime: hhmm(to.startMin), endTime: hhmm(to.startMin + dur), technicianId: to.technicianId };
    const evCtx = this.branchCtx(ctx, branchId);
    const rec = await this.d.store.tx(async (s, trx) => {
      // a fresh recommendation for the same appointment supersedes the older un-reviewed ones
      for (const old of (await s.listRecs(ctx.tenantId, { appointmentId: a.id, statuses: ['generated', 'review_required'], limit: 50 })).items) {
        const sup = await s.casRec(ctx.tenantId, old.id, old.version, [old.status], { status: 'superseded' });
        if (sup) await s.insertDecision(ctx.tenantId, { recommendationId: old.id, action: 'supersede', actorUserId: UUID_RE.test(ctx.userId) ? ctx.userId : null, reason: 'a newer recommendation for this appointment', before: { status: old.status, version: old.version }, after: { status: sup.status, version: sup.version } });
      }
      const created = await s.insertRec(ctx.tenantId, {
        branchId, runId: opts.runId ?? null, type: built.type, status: 'review_required', currentState: snapshot, proposedState: proposed,
        affectedAppointmentIds: [a.id], affectedTechnicianIds: [...new Set([a.technicianId, to.technicianId].filter((x): x is string => !!x))],
        violations: [], simulation: sim, softObjectivesImproved: built.softObjectivesImproved, expectedBenefit: built.expectedBenefit, possibleDownside: built.possibleDownside,
        // "keep the schedule" has nothing for a customer to approve (and nothing to apply)
        confidence: built.confidence, dataQuality: built.dataQuality, touchesConfirmedAppointment: touches, requiresCustomerApproval: touches && built.type !== 'preserve_schedule',
        versions, expiresAt: new Date(built.expiresAtMs).toISOString(), automated: !!opts.automated,
      });
      // the state machine's entry edge (generated → review_required), recorded like every other transition
      await s.insertDecision(ctx.tenantId, { recommendationId: created.id, action: 'submit_for_review', actorUserId: UUID_RE.test(ctx.userId) ? ctx.userId : null, reason: null, before: { status: 'generated' }, after: { status: created.status, version: created.version } });
      await s.insertImpact(ctx.tenantId, created.id, sim);
      await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_GENERATED, { type: 'schedule_recommendation', id: created.id, version: created.version }, { recommendationId: created.id, status: created.status, type: created.type, runId: opts.runId ?? null, appointmentId: a.id }, trx);
      return created;
    });
    try {
      const ex = await this.d.explanations.explain(evCtx, rec);
      await this.d.store.setExplanation(ctx.tenantId, rec.id, ex.text, ex.source, ex.language);
    } catch {
      await this.d.store.setExplanation(ctx.tenantId, rec.id, rec.expectedBenefit.join('; ') || 'No measurable improvement — keep the schedule as it is.', 'template');
    }
    void this.d.usage.record(evCtx, 'recommendation', { amount: 1 }).catch(() => undefined);
    await this.audit(evCtx, 'recommendation.generated', rec.id, { type: rec.type, appointmentId: a.id, benefit: rec.expectedBenefit, touchesConfirmed: touches, runId: opts.runId ?? null });
    return (await this.d.store.getRec(ctx.tenantId, rec.id))!;
  }

  // ── read ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  private async withProposals(ctx: SchedCtx, recs: SchedRecommendation[]): Promise<SchedRecommendation[]> {
    const ids = recs.filter((r) => r.requiresCustomerApproval).map((r) => r.id);
    if (!ids.length) return recs;
    const map = await this.d.proposals.summaries(ctx, ids).catch(() => ({} as Record<string, SchedProposalSummary>));
    return recs.map((r) => ({ ...r, proposal: map[r.id] ?? r.proposal ?? null }));
  }
  private async visibleRec(ctx: SchedCtx, id: string, sys = false): Promise<SchedRecommendation> {
    const rec = typeof id === 'string' && UUID_RE.test(id) ? await this.d.store.getRec(ctx.tenantId, id) : null;
    if (!rec || (ctx.branchId && rec.branchId && rec.branchId !== ctx.branchId)) throw new SchedError('NOT_FOUND', 'recommendation not found');
    if (!sys && !hasPermission(ctx as any, 'ai_scheduling.view') && !this.isSystem(ctx)) {
      const me = await this.d.reader.technicianIdForUser(ctx);
      if (!me || !rec.affectedTechnicianIds.includes(me)) throw new SchedError('NOT_FOUND', 'recommendation not found');
    }
    return rec;
  }

  /** GET recommendations — branch users see ONLY their branch's rows; a technician (view_own) only rows that touch them. */
  async list(ctx: SchedCtx, filters: SchedRecommendationFilters = {}): Promise<SchedRecommendationList> {
    requireTenant(ctx);
    const full = hasPermission(ctx as any, 'ai_scheduling.view');
    if (!full && !hasPermission(ctx as any, 'ai_scheduling.view_own')) throw new SchedError('FORBIDDEN', 'Missing ai_scheduling.view');
    let technicianId = filters.technicianId ?? null;
    if (!full) { technicianId = await this.d.reader.technicianIdForUser(ctx); if (!technicianId) return { items: [], total: 0 }; }
    if (filters.date != null && !isYmd(filters.date)) throw new SchedError('VALIDATION_FAILED', 'date must be YYYY-MM-DD');
    const res = await this.d.store.listRecs(ctx.tenantId, {
      branchId: ctx.branchId ?? null, status: filters.status ?? null, type: filters.type ?? null, runId: filters.runId ?? null, technicianId, date: filters.date ?? null,
      limit: Math.min(200, Math.max(1, Number(filters.limit) || 50)),
    });
    return { items: await this.withProposals(ctx, res.items), total: res.total };
  }

  /** SYS. One recommendation (with its proposal summary). */
  async get(ctx: SchedCtx, id: string): Promise<SchedRecommendation> {
    requireTenant(ctx);
    if (!this.isSystem(ctx) && !hasPermission(ctx as any, 'ai_scheduling.view') && !hasPermission(ctx as any, 'ai_scheduling.view_own')) throw new SchedError('FORBIDDEN', 'Missing ai_scheduling.view');
    const rec = await this.visibleRec(ctx, id);
    return (await this.withProposals(ctx, [rec]))[0];
  }

  /** A5 (Nov 6 2026): the target technician's full day around this recommendation — before / after the move, the
   *  bookings right next to the proposed slot, and the gaps / conflicts it opens or closes. Read fresh at preview time;
   *  changes nothing. */
  async dayContext(ctx: SchedCtx, id: string): Promise<DayContext> {
    const rec = await this.get(ctx, id);
    const prop = rec.proposedState, cur = rec.currentState;
    if (!prop || !rec.branchId) throw new SchedError('VALIDATION_FAILED', 'this recommendation does not move an appointment');
    const day = await this.d.reader.loadDay(ctx, rec.branchId, prop.date);
    let moving = day.appts.find((a) => a.id === prop.appointmentId) ?? null;
    if (!moving && cur && cur.date !== prop.date) moving = (await this.d.reader.loadDay(ctx, rec.branchId, cur.date)).appts.find((a) => a.id === prop.appointmentId) ?? null;
    if (!moving) throw new SchedError('NOT_FOUND', 'the appointment is no longer on the calendar');
    const r = await this.resolved(ctx, rec.branchId);
    return technicianDayContext(day, moving, { startMin: toMin(prop.startTime), endMin: toMin(prop.endTime), technicianId: prop.technicianId ?? moving.technicianId },
      { gapMinServiceMin: r.config.gapMinServiceMin, largeBlockMin: r.config.largeBlockMin });
  }

  // ── staff decisions ───────────────────────────────────────────────────────────────────────────────────────────────
  /** The events that carry `state` through review to the decision (a stored row starts review_required; legacy rows may
   *  still be generated; a returned one is re-submitted). */
  private plan(state: RecState, action: Decision, requiresCustomerApproval: boolean): { event: RecEvent; before: RecState; after: RecState }[] | null {
    const pre: RecEvent[] = state === 'generated' || state === 'needs_revision' ? ['submit_for_review', 'start_review'] : state === 'review_required' ? ['start_review'] : [];
    const steps: { event: RecEvent; before: RecState; after: RecState }[] = [];
    let cur = state;
    for (const ev of [...pre, action as RecEvent]) {
      const t = transition(cur, ev, { requiresCustomerApproval });
      if (!t.ok) return null;
      steps.push({ event: ev, before: cur, after: t.state }); cur = t.state;
    }
    return steps;
  }

  async decide(ctx: SchedCtx, id: string, action: Decision, body: SchedDecisionRequest): Promise<SchedRecommendation> {
    this.need(ctx, 'ai_scheduling.review');
    const expectedVersion = versionOf(body);
    const reason = body?.reason == null ? null : String(body.reason).slice(0, 1000);
    if ((action === 'reject' || action === 'return') && reason !== null && !reason.trim()) throw new SchedError('VALIDATION_FAILED', 'reason cannot be blank');
    const rec = await this.visibleRec(ctx, id);
    if (rec.expiresAt && Date.parse(rec.expiresAt) <= this.now()) throw new SchedError('RECOMMENDATION_EXPIRED', 'this recommendation has expired — generate a new one');
    const steps = this.plan(rec.status as RecState, action, rec.requiresCustomerApproval);
    if (!steps) throw new SchedError('INVALID_STATE', `cannot ${action} a recommendation that is ${rec.status}`);
    if (rec.version !== expectedVersion) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed — reload and try again', { currentVersion: rec.version });
    const final = steps[steps.length - 1].after;
    const nowIso = new Date(this.now()).toISOString();
    const evCtx = this.branchCtx(ctx, rec.branchId);
    const updated = await this.d.store.tx(async (s, trx) => {
      const u = await s.casRec(ctx.tenantId, rec.id, expectedVersion, [rec.status], {
        status: final, decidedByUserId: UUID_RE.test(ctx.userId) ? ctx.userId : null, decidedAt: nowIso,
        // the customer gets proposalTtlHours to answer — the 30-minute staff TTL would expire the proposal under them
        ...(final === 'customer_approval_required' ? { expiresAt: new Date(this.now() + (await this.resolved(ctx, rec.branchId)).config.proposalTtlHours * 3_600_000).toISOString() } : {}),
      });
      if (!u) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed — reload and try again');
      // one conditional update; every edge it covers is recorded (start_review, then the decision) with its snapshots
      for (const st of steps) {
        const isLast = st === steps[steps.length - 1];
        await s.insertDecision(ctx.tenantId, { recommendationId: rec.id, action: st.event, actorUserId: UUID_RE.test(ctx.userId) ? ctx.userId : null, reason: isLast ? reason : null,
          before: { status: st.before, version: rec.version }, after: { status: st.after, version: isLast ? u.version : rec.version } });
      }
      await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_DECIDED, { type: 'schedule_recommendation', id: rec.id, version: u.version }, { recommendationId: rec.id, action, status: u.status }, trx);
      if (u.status === 'customer_approval_required') await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_CUSTOMER_APPROVAL_REQUESTED, { type: 'schedule_recommendation', id: rec.id, version: u.version }, { recommendationId: rec.id, status: u.status }, trx);
      return u;
    });
    if (updated.status === 'customer_approval_required') {
      try { await this.d.proposals.open(evCtx, updated); }
      catch (e: any) { await this.audit(evCtx, 'proposal.open_failed', rec.id, { error: String(e?.message ?? e).slice(0, 200) }); }
    }
    await this.audit(evCtx, `recommendation.${action}`, rec.id, { before: rec.status, after: updated.status, reason });
    return this.get(ctx, rec.id);
  }

  /** SYS. The customer's decision (ops half: customer web / SMS; or staff recording one) → customer_approved / rejected. */
  async customerDecided(ctx: SchedCtx, recommendationId: string, approved: boolean): Promise<SchedRecommendation> {
    this.need(ctx, 'ai_scheduling.review', true);
    for (let attempt = 0; attempt < 3; attempt++) {
      const rec = await this.d.store.getRec(ctx.tenantId, recommendationId);
      if (!rec) throw new SchedError('NOT_FOUND', 'recommendation not found');
      if (rec.status !== 'customer_approval_required') throw new SchedError('INVALID_STATE', `the recommendation is ${rec.status}, not waiting for the customer`);
      if (rec.expiresAt && Date.parse(rec.expiresAt) <= this.now()) throw new SchedError('RECOMMENDATION_EXPIRED', 'the proposal has expired');
      const t = transition('customer_approval_required', approved ? 'customer_approve' : 'customer_reject');
      const evCtx = this.branchCtx(ctx, rec.branchId);
      const u = await this.d.store.tx(async (s, trx) => {
        const x = await s.casRec(ctx.tenantId, rec.id, rec.version, ['customer_approval_required'], { status: t.state });
        if (!x) return null;
        await s.insertDecision(ctx.tenantId, { recommendationId: rec.id, action: approved ? 'customer_approve' : 'customer_reject', actorUserId: UUID_RE.test(ctx.userId) ? ctx.userId : null, reason: null,
          before: { status: rec.status, version: rec.version }, after: { status: x.status, version: x.version } });
        await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_CUSTOMER_DECIDED, { type: 'schedule_recommendation', id: rec.id, version: x.version }, { recommendationId: rec.id, approved, status: x.status }, trx);
        return x;
      });
      if (u) { await this.audit(evCtx, approved ? 'recommendation.customer_approved' : 'recommendation.customer_rejected', rec.id); return u; }
    }
    throw new SchedError('VERSION_CONFLICT', 'the recommendation changed while recording the customer decision');
  }

  /** Staff record the decision a customer gave by phone / in person. */
  async recordCustomerDecision(ctx: SchedCtx, id: string, body: { approved: boolean; expectedVersion: number }): Promise<SchedRecommendation> {
    this.need(ctx, 'ai_scheduling.review');
    if (typeof body?.approved !== 'boolean') throw new SchedError('VALIDATION_FAILED', 'approved (true / false) is required');
    const expectedVersion = versionOf(body);
    const rec = await this.visibleRec(ctx, id);
    if (rec.version !== expectedVersion) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed — reload and try again', { currentVersion: rec.version });
    if (rec.status !== 'customer_approval_required') throw new SchedError('INVALID_STATE', `the recommendation is ${rec.status}, not waiting for the customer`);
    await this.d.proposals.recordStaffDecision(this.branchCtx(ctx, rec.branchId), rec.id, body.approved);
    await this.customerDecided(ctx, rec.id, body.approved);
    return this.get(ctx, rec.id);
  }

  async resendProposal(ctx: SchedCtx, id: string): Promise<SchedProposalSummary> {
    this.need(ctx, 'ai_scheduling.review');
    const rec = await this.visibleRec(ctx, id);
    if (rec.status !== 'customer_approval_required') throw new SchedError('INVALID_STATE', 'there is no open customer proposal for this recommendation');
    const p = await this.d.proposals.resend(this.branchCtx(ctx, rec.branchId), rec.id);
    await this.audit(ctx, 'proposal.resent', rec.id);
    return p;
  }

  async explain(ctx: SchedCtx, id: string): Promise<SchedRecommendation> {
    this.need(ctx, 'ai_scheduling.view');
    const rec = await this.visibleRec(ctx, id);
    // §120: re-asked in THIS reader's POS language (the stored text may be in the other one — the row records which)
    const ex: { text: string; source: 'llm' | 'template'; language?: 'en' | 'vi' } = await this.d.explanations.explain(this.branchCtx(ctx, rec.branchId), rec).catch(() => ({ text: rec.expectedBenefit.join('; ') || 'No measurable improvement — keep the schedule as it is.', source: 'template' as const }));
    await this.d.store.setExplanation(ctx.tenantId, rec.id, ex.text, ex.source, ex.language);
    return this.get(ctx, rec.id);
  }

  // ── apply / retry / rollback ─────────────────────────────────────────────────────────────────────────────────────
  private bookingCtx(ctx: SchedCtx, branchId: string | null) {
    const sys = this.isSystem(ctx);
    return { tenantId: ctx.tenantId, branchId: branchId ?? ctx.branchId ?? '', userId: ctx.userId, role: sys ? (ctx.role || 'SYSTEM') : ctx.role,
      // a job / automation acts with exactly the booking capabilities the change needs; a user acts with their own
      permissions: sys ? [...new Set([...(ctx.permissions ?? []), ...BOOKING_PERMS])] : ctx.permissions };
  }
  private appResult(row: { status: string; appliedVia: string | null; externalRef: string | null; errorCode: string | null; attempt: number }): SchedApplication {
    return { status: row.status === 'applied' || row.status === 'rolled_back' ? 'applied' : row.status === 'stale' ? 'stale' : 'failed', appliedVia: row.appliedVia, externalRef: row.externalRef, errorCode: row.errorCode, attempt: row.attempt };
  }

  /** Apply an accepted (and, when required, customer-approved) recommendation THROUGH booking.service. SYS for the
   *  automation runner only. */
  async apply(ctx: SchedCtx, id: string, body: SchedApplyRequest): Promise<SchedApplyResponse> {
    if (ctx.actor === 'automation') requireTenant(ctx); else this.need(ctx, 'ai_scheduling.apply');
    const expectedVersion = versionOf(body);
    const rec = await this.visibleRec(ctx, id, true);
    if (rec.type === 'preserve_schedule' || !rec.proposedState || !rec.currentState) throw new SchedError('INVALID_STATE', 'this recommendation keeps the schedule as it is — there is nothing to apply');
    const fresh = rec.status === 'accepted' || rec.status === 'customer_approved';
    const attempt = fresh ? rec.applyAttempt + 1 : rec.applyAttempt;
    const key = applyKey(ctx.tenantId, rec.id, Math.max(1, attempt));
    // a duplicate call for the same attempt answers with what that attempt recorded — never a second booking call
    const prior = await this.d.store.findApplication(ctx.tenantId, key);
    if (prior && prior.status !== 'pending') {
      const application = this.appResult(prior);
      if (prior.status === 'stale') throw new SchedError('STALE_SCHEDULE', 'the appointment changed since this recommendation was computed', { application });
      if (prior.status === 'failed') throw new SchedError('APPLICATION_FAILED', prior.errorCode || 'the booking service refused the change', { errorCode: prior.errorCode, application });
      return { recommendation: await this.get(ctx, rec.id), application };
    }
    if (rec.status === 'customer_approval_required') throw new SchedError('CUSTOMER_APPROVAL_REQUIRED', 'the customer has not approved this change yet');
    if (!fresh && rec.status !== 'application_pending') throw new SchedError('INVALID_STATE', `cannot apply a recommendation that is ${rec.status}`);
    if (rec.expiresAt && Date.parse(rec.expiresAt) <= this.now()) throw new SchedError('RECOMMENDATION_EXPIRED', 'this recommendation has expired — generate a new one');
    if (rec.version !== expectedVersion) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed — reload and try again', { currentVersion: rec.version });
    const snap = rec.currentState, target = rec.proposedState;
    const evCtx = this.branchCtx(ctx, rec.branchId);
    const actor = UUID_RE.test(ctx.userId) ? ctx.userId : null;

    // optimistic concurrency against the APPOINTMENT: it must be exactly as it was when the recommendation was computed
    const cur = await this.d.reader.appointment(this.branchCtx(ctx, null), snap.appointmentId);
    const drift = snapshotDrift(snap, cur ? { date: cur.date, startTime: hhmm(cur.startMin), technicianId: cur.technicianId, version: cur.version, status: cur.status } : null);
    if (drift.length) {
      await this.d.store.tx(async (s, trx) => {
        if (await s.claimApplication(ctx.tenantId, { key, recommendationId: rec.id, appointmentId: snap.appointmentId, attempt, userId: actor, scheduleVersion: cur?.version ?? null })) {
          await s.finishApplication(ctx.tenantId, key, { status: 'stale', appliedVia: null, externalRef: null, errorCode: 'STALE_SCHEDULE' });
          await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_CHANGE_FAILED, { type: 'schedule_recommendation', id: rec.id, version: rec.version }, { recommendationId: rec.id, status: rec.status, reason: 'stale', drift }, trx);
        }
      });
      await this.audit(evCtx, 'recommendation.apply_stale', rec.id, { drift });
      throw new SchedError('STALE_SCHEDULE', 'the appointment changed since this recommendation was computed — generate a new one', { drift, application: { status: 'stale', appliedVia: null, externalRef: null, errorCode: 'STALE_SCHEDULE', attempt } });
    }

    // claim: conditional move to application_pending (one winner) + the pending application row (unique key)
    const claimed = await this.d.store.tx(async (s) => {
      const u = await s.casRec(ctx.tenantId, rec.id, expectedVersion, ['accepted', 'customer_approved', 'application_pending'], { status: 'application_pending', applyAttempt: attempt });
      if (!u) return null;
      if (!(await s.claimApplication(ctx.tenantId, { key, recommendationId: rec.id, appointmentId: snap.appointmentId, attempt, userId: actor, scheduleVersion: snap.version }))) throw new SchedError('VERSION_CONFLICT', 'this recommendation is already being applied');
      if (fresh) await s.insertDecision(ctx.tenantId, { recommendationId: rec.id, action: 'queue_application', actorUserId: actor, reason: null, before: { status: rec.status, version: rec.version }, after: { status: u.status, version: u.version } });
      return u;
    });
    if (!claimed) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed — reload and try again');

    const timeChanges = target.date !== snap.date || target.startTime !== snap.startTime;
    let outcome: { status: 'applied' | 'failed'; appliedVia: string | null; externalRef: string | null; errorCode: string | null };
    try {
      const res = await this.d.booking.reschedule(this.bookingCtx(ctx, rec.branchId), snap.appointmentId, {
        startTime: target.startTime, date: target.date, technicianId: target.technicianId ?? undefined, expectedVersion: snap.version,
        // the customer already approved (or the time is unchanged): tell them the confirmed new time
        notifyCustomer: rec.requiresCustomerApproval ? true : timeChanges && !!snap.customerId, reason: 'ai_scheduling_optimizer',
      });
      outcome = { status: 'applied', appliedVia: target.kind === 'assign_technician' ? 'booking_service.reschedule(technician)' : 'booking_service.reschedule', externalRef: res?.appointmentId ?? snap.appointmentId, errorCode: null };
    } catch (e) {
      outcome = { status: 'failed', appliedVia: null, externalRef: null, errorCode: bookingErrorCode(e) };
    }
    const final = await this.d.store.tx(async (s, trx) => {
      await s.finishApplication(ctx.tenantId, key, outcome);
      const t = transition('application_pending', outcome.status === 'applied' ? 'apply_ok' : 'apply_fail');
      const u = await s.casRec(ctx.tenantId, rec.id, claimed.version, ['application_pending'], { status: t.state, ...(outcome.status === 'applied' ? { appliedAt: new Date(this.now()).toISOString() } : {}) });
      if (u) await s.insertDecision(ctx.tenantId, { recommendationId: rec.id, action: outcome.status === 'applied' ? 'apply_ok' : 'apply_fail', actorUserId: actor, reason: outcome.errorCode, before: { status: claimed.status, version: claimed.version }, after: { status: u.status, version: u.version } });
      await this.emit(evCtx, outcome.status === 'applied' ? DOMAIN_EVENTS.SCHEDULE_CHANGE_APPLIED : DOMAIN_EVENTS.SCHEDULE_CHANGE_FAILED,
        { type: 'schedule_recommendation', id: rec.id, version: u?.version ?? claimed.version },
        { recommendationId: rec.id, status: u?.status ?? claimed.status, appointmentId: snap.appointmentId, attempt, ...(outcome.errorCode ? { reason: outcome.errorCode } : {}) }, trx);
      return u;
    });
    const application: SchedApplication = { ...outcome, attempt };
    await this.audit(evCtx, `recommendation.apply_${outcome.status}`, rec.id, { attempt, errorCode: outcome.errorCode, appointmentId: snap.appointmentId });
    if (outcome.status === 'failed') throw new SchedError('APPLICATION_FAILED', `the booking service refused the change (${outcome.errorCode})`, { errorCode: outcome.errorCode, application });
    if (rec.requiresCustomerApproval) await this.d.proposals.markApplied(evCtx, rec.id).catch(() => undefined);
    void final;
    return { recommendation: await this.get(ctx, rec.id), application };
  }

  /** SYS. application_failed → application_pending (apply_attempt + 1 — a NEW idempotency key) → apply. */
  async retry(ctx: SchedCtx, id: string, body: SchedApplyRequest): Promise<SchedApplyResponse> {
    this.need(ctx, 'ai_scheduling.apply', true);
    const expectedVersion = versionOf(body);
    const rec = await this.visibleRec(ctx, id, true);
    if (rec.status !== 'application_failed') throw new SchedError('INVALID_STATE', `only a failed application can be retried (this one is ${rec.status})`);
    if (rec.version !== expectedVersion) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed — reload and try again', { currentVersion: rec.version });
    const evCtx = this.branchCtx(ctx, rec.branchId);
    const u = await this.d.store.tx(async (s) => {
      const x = await s.casRec(ctx.tenantId, rec.id, expectedVersion, ['application_failed'], { status: 'application_pending', applyAttempt: rec.applyAttempt + 1 });
      if (x) await s.insertDecision(ctx.tenantId, { recommendationId: rec.id, action: 'retry', actorUserId: UUID_RE.test(ctx.userId) ? ctx.userId : null, reason: null, before: { status: rec.status, version: rec.version }, after: { status: x.status, version: x.version } });
      return x;
    });
    if (!u) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed — reload and try again');
    await this.audit(evCtx, 'recommendation.retry', rec.id, { attempt: u.applyAttempt });
    return this.apply({ ...ctx, actor: this.isSystem(ctx) ? 'automation' : ctx.actor }, rec.id, { expectedVersion: u.version });
  }

  /** SYS. Put an applied change back: reschedule to the stored snapshot through booking.service with the appointment's
   *  CURRENT version (it must still be where the optimizer put it). */
  async rollback(ctx: SchedCtx, id: string, body: SchedApplyRequest): Promise<{ recommendation: SchedRecommendation }> {
    this.need(ctx, 'ai_scheduling.apply', true);
    const expectedVersion = versionOf(body);
    const rec = await this.visibleRec(ctx, id, true);
    if (rec.status !== 'applied') throw new SchedError('INVALID_STATE', `only an applied change can be rolled back (this one is ${rec.status})`);
    if (rec.version !== expectedVersion) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed — reload and try again', { currentVersion: rec.version });
    const snap = rec.currentState!, target = rec.proposedState!;
    const cur = await this.d.reader.appointment(this.branchCtx(ctx, null), snap.appointmentId);
    if (!cur || cur.date !== target.date || hhmm(cur.startMin) !== target.startTime || (cur.technicianId ?? null) !== (target.technicianId ?? null)) {
      throw new SchedError('STALE_SCHEDULE', 'the appointment has been changed since the optimizer moved it — roll it back by hand');
    }
    if (isLockedAppt(cur)) throw new SchedError('LOCKED_APPOINTMENT', 'the appointment is locked and cannot be moved back');
    const evCtx = this.branchCtx(ctx, rec.branchId);
    try {
      await this.d.booking.reschedule(this.bookingCtx(ctx, rec.branchId), snap.appointmentId, {
        startTime: snap.startTime, date: snap.date, technicianId: snap.technicianId ?? undefined, expectedVersion: cur.version,
        notifyCustomer: !!snap.customerId && (snap.date !== target.date || snap.startTime !== target.startTime), reason: 'ai_scheduling_optimizer_rollback',
      });
    } catch (e) {
      const errorCode = bookingErrorCode(e);
      await this.audit(evCtx, 'recommendation.rollback_failed', rec.id, { errorCode });
      throw new SchedError('APPLICATION_FAILED', `the booking service refused the rollback (${errorCode})`, { errorCode });
    }
    await this.d.store.tx(async (s, trx) => {
      const u = await s.casRec(ctx.tenantId, rec.id, expectedVersion, ['applied'], { status: 'rolled_back' });
      if (!u) throw new SchedError('VERSION_CONFLICT', 'this recommendation changed during the rollback');
      await s.markApplicationRolledBack(ctx.tenantId, applyKey(ctx.tenantId, rec.id, Math.max(1, rec.applyAttempt)));
      await s.insertDecision(ctx.tenantId, { recommendationId: rec.id, action: 'rollback', actorUserId: UUID_RE.test(ctx.userId) ? ctx.userId : null, reason: null, before: { status: rec.status, version: rec.version }, after: { status: u.status, version: u.version } });
      await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_CHANGE_ROLLED_BACK, { type: 'schedule_recommendation', id: rec.id, version: u.version }, { recommendationId: rec.id, status: u.status, appointmentId: snap.appointmentId }, trx);
    });
    await this.audit(evCtx, 'recommendation.rolled_back', rec.id, { appointmentId: snap.appointmentId });
    return { recommendation: await this.get(ctx, rec.id) };
  }

  /** SYS. Expire every live recommendation past its expires_at (conditional update each; proposals withdrawn). */
  async expireDue(ctx: SchedCtx, nowMs: number = this.now()): Promise<number> {
    this.need(ctx, 'ai_scheduling.review', true);
    const due = await this.d.store.dueForExpiry(ctx.tenantId, new Date(nowMs).toISOString(), EXPIRABLE_STATUSES, 500);
    let n = 0;
    for (const rec of due) {
      const evCtx = this.branchCtx(ctx, rec.branchId);
      const u = await this.d.store.tx(async (s, trx) => {
        const x = await s.casRec(ctx.tenantId, rec.id, rec.version, [rec.status], { status: 'expired' });
        if (!x) return null;
        await s.insertDecision(ctx.tenantId, { recommendationId: rec.id, action: 'expire', actorUserId: null, reason: null, before: { status: rec.status, version: rec.version }, after: { status: x.status, version: x.version } });
        await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_RECOMMENDATION_EXPIRED, { type: 'schedule_recommendation', id: rec.id, version: x.version }, { recommendationId: rec.id, status: x.status }, trx);
        return x;
      });
      if (!u) continue;
      n++;
      if (rec.requiresCustomerApproval && (rec.status === 'customer_approval_required' || rec.status === 'customer_approved')) await this.d.proposals.withdraw(evCtx, rec.id, 'expired').catch(() => undefined);
    }
    return n;
  }

  // ── runs ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** SYS. Optimize one branch day (or one technician's day): detect gaps / conflicts / understaffing, store them, turn
   *  every technician-day move into a recommendation (same generate path), then hand the run to the automation runner. */
  async runDay(ctx: SchedCtx, req: SchedRunRequest, trigger: 'manual' | 'job' | 'automation' = 'manual'): Promise<SchedRunDetail> {
    this.need(ctx, 'ai_scheduling.generate', true);
    if (req?.scope !== 'branch_day' && req?.scope !== 'technician_day') throw new SchedError('VALIDATION_FAILED', "scope must be 'branch_day' or 'technician_day'");
    if (!isYmd(req.date)) throw new SchedError('VALIDATION_FAILED', 'date must be YYYY-MM-DD');
    if (req.scope === 'technician_day' && !req.technicianId) throw new SchedError('VALIDATION_FAILED', 'technicianId is required for a technician_day run');
    const branchId = this.sessionBranch(ctx);
    const r = await this.resolved(ctx, branchId);
    if (!r.enabled || r.platformKilled) throw new SchedError('MODULE_DISABLED', r.platformKilled ? 'the scheduling optimizer is paused platform-wide' : 'the scheduling optimizer is turned off for this location');
    const key = req.idempotencyKey ? String(req.idempotencyKey).slice(0, 200) : null;
    if (key) { const existing = await this.d.store.findRunByKey(ctx.tenantId, key); if (existing) return this.getRun(ctx, existing, true); }
    const started = this.now();
    const fc = await this.d.forecast.getBusyHours(ctx, { branchId, date: req.date }).catch(() => ({ available: false, version: null as string | null, demandMinutes: undefined as number | undefined }));
    const versions: SchedVersions = { forecastVersion: fc.version ?? null, ruleVersion: RULE_VERSION, engineVersion: ENGINE_VERSION, configVersion: r.configVersion };
    const runId = await this.d.store.insertRun(ctx.tenantId, { branchId, scope: req.scope, date: req.date, technicianId: req.technicianId ?? null, trigger, idempotencyKey: key, requestedByUserId: UUID_RE.test(ctx.userId) ? ctx.userId : null, versions, correlationId: ctx.correlationId ?? null });
    if (!runId) { const existing = await this.d.store.findRunByKey(ctx.tenantId, key!); return this.getRun(ctx, existing!, true); }
    const evCtx = this.branchCtx(ctx, branchId);
    try {
      const day = await this.d.reader.loadDay(ctx, branchId, req.date);
      const scopeTech = req.scope === 'technician_day' ? req.technicianId! : null;
      const det = detectDay(day, r.config);
      const gaps = det.gaps.filter((g) => !scopeTech || g.technicianId === scopeTech);
      const conflicts = det.conflicts.filter((c) => !scopeTech || c.technicianId === scopeTech).map((c) => ({ ...c, message: c.message as string | null }));
      if (!scopeTech) {
        const capacity = day.techs.filter((t) => t.available).reduce((n, t) => n + Math.max(0, t.shifts.reduce((m, s) => m + (s.end - s.start), 0) - t.breaks.reduce((m, b) => m + (b.end - b.start), 0) - t.timeOff.reduce((m, o) => m + (o.end - o.start), 0)), 0);
        const booked = day.appts.filter((a) => !INACTIVE_STATUSES.has(a.status)).reduce((n, a) => n + (a.endMin - a.startMin), 0);
        const st = detectUnderstaffing({ confirmedDemandMin: booked, forecastDemandMin: fc.available ? fc.demandMinutes ?? null : null, capacityMin: capacity, forecastAvailable: !!fc.available });
        if (st.state === 'understaffed' || st.state === 'severely_understaffed') {
          conflicts.push({ type: 'UNDERSTAFFED', severity: st.state === 'severely_understaffed' ? 'critical' : 'warning', appointmentIds: [], technicianId: null, message: `${st.state.replace('_', ' ')}: about ${st.missingMinutes} minutes of demand above scheduled capacity` });
        }
      }
      await this.d.store.tx(async (s) => {
        await s.resolveOpenConflicts(ctx.tenantId, branchId, req.date);
        await s.insertGaps(ctx.tenantId, runId, branchId, req.date, gaps.map((g) => ({ technicianId: g.technicianId, startMin: g.startMin, endMin: g.endMin, durationMin: g.durationMin, cause: g.cause, servicesThatFit: g.servicesThatFit, confidence: g.confidence })));
        await s.insertConflicts(ctx.tenantId, runId, branchId, req.date, conflicts);
      });
      let recCount = 0;
      if (!day.isPast) {
        for (const tech of day.techs.filter((t) => t.available && t.shifts.length && (!scopeTech || t.technicianId === scopeTech))) {
          const mine = day.appts.filter((a) => a.technicianId === tech.technicianId && !INACTIVE_STATUSES.has(a.status));
          if (mine.length < 2) continue;
          const envelope = { start: Math.min(...tech.shifts.map((s) => s.start)), end: Math.max(...tech.shifts.map((s) => s.end)) };
          const plan = optimizeTechnicianDay(envelope, mine.map((a) => ({ id: a.id, range: { start: a.startMin, end: a.endMin }, locked: isLockedAppt(a) || (day.nowMin != null && a.startMin <= day.nowMin) })));
          for (const m of plan.moves) {
            try {
              const rec = await this.generateInner(evCtx, { appointmentId: m.id, target: { date: req.date, startTime: hhmm(m.to.start), technicianId: tech.technicianId } }, { runId, automated: trigger === 'automation', skipPreserve: true });
              if (rec) recCount++;
            } catch (e) { if (!(e instanceof SchedError)) throw e; /* infeasible move (lunch, buffer, lock) → no recommendation */ }
          }
        }
      }
      const metrics = dayMetrics(scopeTech ? { ...day, techs: day.techs.filter((t) => t.technicianId === scopeTech) } : day);
      await this.d.store.finishRun(ctx.tenantId, runId, { status: 'completed', metrics, recommendationCount: recCount, gapCount: gaps.length, conflictCount: conflicts.length, latencyMs: this.now() - started, errorCode: null });
      await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_RUN_COMPLETED, { type: 'schedule_run', id: runId }, { runId, status: 'completed', date: req.date, recommendationCount: recCount, gapCount: gaps.length, conflictCount: conflicts.length });
      void this.d.usage.record(evCtx, 'optimization_run', { amount: 1 }).catch(() => undefined);
      await this.audit(evCtx, 'run.completed', runId, { scope: req.scope, date: req.date, trigger, recommendationCount: recCount });
      const detail = await this.getRun(ctx, runId, true);
      try { await this.d.automation.afterRun(evCtx, detail); } catch (e: any) { await this.audit(evCtx, 'automation.after_run_failed', runId, { error: String(e?.message ?? e).slice(0, 200) }); }
      return this.getRun(ctx, runId, true);
    } catch (e: any) {
      const errorCode = e instanceof SchedError ? e.code : 'RUN_FAILED';
      await this.d.store.finishRun(ctx.tenantId, runId, { status: 'failed', metrics: null, recommendationCount: 0, gapCount: 0, conflictCount: 0, latencyMs: this.now() - started, errorCode });
      await this.emit(evCtx, DOMAIN_EVENTS.SCHEDULE_RUN_COMPLETED, { type: 'schedule_run', id: runId }, { runId, status: 'failed', date: req.date, reason: errorCode }).catch(() => undefined);
      throw e;
    }
  }

  async listRuns(ctx: SchedCtx, f: { date?: string | null; limit?: number | null } = {}): Promise<SchedRun[]> {
    this.need(ctx, 'ai_scheduling.view');
    if (f.date != null && f.date !== '' && !isYmd(f.date)) throw new SchedError('VALIDATION_FAILED', 'date must be YYYY-MM-DD');
    return this.d.store.listRuns(ctx.tenantId, { branchId: ctx.branchId ?? null, date: f.date || null, limit: Math.min(200, Math.max(1, Number(f.limit) || 50)) });
  }

  async getRun(ctx: SchedCtx, id: string, sys = false): Promise<SchedRunDetail> {
    if (!sys) this.need(ctx, 'ai_scheduling.view'); else requireTenant(ctx);
    const run = UUID_RE.test(String(id)) ? await this.d.store.getRun(ctx.tenantId, id) : null;
    if (!run || (ctx.branchId && run.branchId && run.branchId !== ctx.branchId)) throw new SchedError('NOT_FOUND', 'run not found');
    const [gaps, conflicts, recs] = await Promise.all([this.d.store.listGaps(ctx.tenantId, run.id), this.d.store.listConflicts(ctx.tenantId, run.id), this.d.store.listRecs(ctx.tenantId, { runId: run.id, limit: 200 })]);
    return { run, gaps, conflicts, recommendations: await this.withProposals(ctx, recs.items) };
  }

  // ── calendar overlay ──────────────────────────────────────────────────────────────────────────────────────────────
  async calendar(ctx: SchedCtx, date: string): Promise<SchedCalendarIndicators> {
    this.need(ctx, 'ai_scheduling.view');
    if (!isYmd(date)) throw new SchedError('VALIDATION_FAILED', 'date must be YYYY-MM-DD');
    const branchId = this.sessionBranch(ctx);
    const run = await this.d.store.latestCompletedRun(ctx.tenantId, branchId, date);
    const [gaps, conflicts, recs, locks] = await Promise.all([
      run ? this.d.store.listGaps(ctx.tenantId, run.id) : Promise.resolve([]),
      run ? this.d.store.listConflicts(ctx.tenantId, run.id) : Promise.resolve([]),
      this.d.store.listRecs(ctx.tenantId, { branchId, statuses: LIVE_STATUSES, date, limit: 200 }),
      this.d.store.listLocks(ctx.tenantId, branchId),
    ]);
    const locked = new Set(locks.map((l) => l.appointmentId));
    const appointments: SchedCalendarIndicators['appointments'] = {};
    for (const r of recs.items) for (const apptId of r.affectedAppointmentIds) if (!appointments[apptId]) appointments[apptId] = { recommendationId: r.id, status: r.status, type: r.type, locked: locked.has(apptId) };
    return { date, gaps, conflicts: conflicts.filter((c) => !c.resolved), appointments, utilizationPct: run?.metrics?.utilizationPct ?? null };
  }

  // ── gate inputs: time off, locks, service profiles ───────────────────────────────────────────────────────────────
  async listTimeOff(ctx: SchedCtx, f: { technicianId?: string | null; from?: string | null; to?: string | null } = {}): Promise<SchedTimeOff[]> {
    this.need(ctx, 'ai_scheduling.view');
    for (const k of ['from', 'to'] as const) if (f[k] && Number.isNaN(Date.parse(String(f[k])))) throw new SchedError('VALIDATION_FAILED', `${k} must be an ISO date-time`);
    return this.d.store.listTimeOff(ctx.tenantId, { technicianId: f.technicianId ?? null, branchId: ctx.branchId ?? null, from: f.from ?? null, to: f.to ?? null });
  }
  async createTimeOff(ctx: SchedCtx, body: SchedTimeOffCreate): Promise<SchedTimeOff> {
    this.need(ctx, 'technicians.edit');
    const s = Date.parse(String(body?.startsAt)), e = Date.parse(String(body?.endsAt));
    if (!body?.technicianId || Number.isNaN(s) || Number.isNaN(e)) throw new SchedError('VALIDATION_FAILED', 'technicianId, startsAt and endsAt (ISO) are required');
    if (e <= s) throw new SchedError('VALIDATION_FAILED', 'endsAt must be after startsAt');
    if (e - s > 366 * 86_400_000) throw new SchedError('VALIDATION_FAILED', 'time off longer than a year is not accepted');
    if (!(await this.d.reader.technicianExists(ctx, body.technicianId))) throw new SchedError('NOT_FOUND', 'technician not found');
    const branchId = body.branchId === undefined ? (ctx.branchId ?? null) : body.branchId;
    if (ctx.branchId && branchId && branchId !== ctx.branchId) throw new SchedError('FORBIDDEN', 'time off can only be added for this location');
    const row = await this.d.store.insertTimeOff(ctx.tenantId, { technicianId: body.technicianId, branchId, startsAt: new Date(s).toISOString(), endsAt: new Date(e).toISOString(), reason: body.reason ? String(body.reason).slice(0, 500) : null, userId: UUID_RE.test(ctx.userId) ? ctx.userId : null });
    await this.audit(ctx, 'time_off.created', row.id, { technicianId: row.technicianId, startsAt: row.startsAt, endsAt: row.endsAt });
    return row;
  }
  async deleteTimeOff(ctx: SchedCtx, id: string): Promise<{ cancelled: true }> {
    this.need(ctx, 'technicians.edit');
    if (!UUID_RE.test(String(id)) || !(await this.d.store.cancelTimeOff(ctx.tenantId, id))) throw new SchedError('NOT_FOUND', 'time off not found');
    await this.audit(ctx, 'time_off.cancelled', id);
    return { cancelled: true };
  }
  async listLocks(ctx: SchedCtx): Promise<SchedLock[]> { this.need(ctx, 'ai_scheduling.view'); return this.d.store.listLocks(ctx.tenantId, ctx.branchId ?? null); }
  async putLock(ctx: SchedCtx, appointmentId: string, body: { reason?: string | null } = {}): Promise<SchedLock> {
    this.need(ctx, 'ai_scheduling.review');
    const a = await this.loadAppt(ctx, appointmentId);
    const lock = await this.d.store.putLock(ctx.tenantId, { appointmentId: a.id, branchId: a.branchId ?? ctx.branchId ?? null, reason: body?.reason ? String(body.reason).slice(0, 500) : null, userId: UUID_RE.test(ctx.userId) ? ctx.userId : null });
    await this.audit(ctx, 'lock.set', a.id, { reason: lock.reason });
    return lock;
  }
  async deleteLock(ctx: SchedCtx, appointmentId: string): Promise<{ removed: true }> {
    this.need(ctx, 'ai_scheduling.review');
    const a = await this.loadAppt(ctx, appointmentId);
    if (!(await this.d.store.deleteLock(ctx.tenantId, a.id))) throw new SchedError('NOT_FOUND', 'this appointment is not locked');
    await this.audit(ctx, 'lock.removed', a.id);
    return { removed: true };
  }
  async listServiceProfiles(ctx: SchedCtx): Promise<SchedServiceProfile[]> { this.need(ctx, 'ai_scheduling.view'); return this.d.store.listServiceProfiles(ctx.tenantId); }
  async putServiceProfile(ctx: SchedCtx, serviceId: string, body: Partial<SchedServiceProfile>): Promise<SchedServiceProfile> {
    this.need(ctx, 'ai_scheduling.configure');
    const int = (v: unknown, lo: number, hi: number, name: string) => { if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw new SchedError('VALIDATION_FAILED', `${name} must be a whole number ${lo}–${hi}`); return v; };
    const setupMin = int(body?.setupMin ?? 0, 0, 120, 'setupMin'), cleanupMin = int(body?.cleanupMin ?? 0, 0, 120, 'cleanupMin');
    const maxGroupSize = body?.maxGroupSize == null ? null : int(body.maxGroupSize, 1, 50, 'maxGroupSize');
    if (!(await this.d.reader.serviceExists(ctx, serviceId))) throw new SchedError('NOT_FOUND', 'service not found');
    const p = await this.d.store.putServiceProfile(ctx.tenantId, { serviceId, setupMin, cleanupMin, maxGroupSize }, UUID_RE.test(ctx.userId) ? ctx.userId : null);
    await this.audit(ctx, 'service_profile.updated', serviceId, { setupMin, cleanupMin, maxGroupSize });
    return p;
  }
}
