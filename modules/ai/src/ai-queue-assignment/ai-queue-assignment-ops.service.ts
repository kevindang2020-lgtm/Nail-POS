// ai-queue-assignment-ops.service.ts — BUILD_PLAN Phase 6: the AI queue "ops" surface for staff, owners and exports.
//
//   overview   the live floor in one call: waiting / unassigned / in service / waits / open alerts by type / the auto
//              switches (allowed, and what blocks it) / today's decisions (auto-assigned apart, bug 13) / technicians
//   settings   the ONE settings source: the salon row, the location's own values (null = inherits), the effective
//              result and the version log; PUT with expectedVersion (stale → 409) at salon or location scope
//   analytics  decision rates (staff decisions; auto-assignments counted apart — bug 13), served waits, by technician,
//              by hour in the location's own time zone
//   export     decisions / alerts / history as formula-safe CSV (ai_queue_assignment.export)
//   usage      the AI package's calls by status and task, cost, recommendations
//   owner      the branch comparison (owner.dashboard.view)
//
// Salon-wide settings are the OWNER's: a manager (manage_rules) changes their location; the salon scope needs the
// OWNER (or ADMIN) role — a branch-scoped manager must not move every location's thresholds. Auto-assign values
// additionally need manage_auto.
import { hasPermission, hasTenantWideScope } from '@aipowersalon/permissions';
import { summarizeQueue, ALERT_TYPES } from './ai-queue-assignment-detection';
import { computeDecisionAnalytics, computeWaitAnalytics, byTechnician, safeCsv, dayIn, type QueueDecisionAnalytics, type WaitAnalytics, type TechnicianRow } from './ai-queue-assignment-analytics';
import type { QueueAssignmentSettingsPort, SettingsPatch, EffectiveQueueAssignmentSettings, QueueAssignmentSettings } from './ai-queue-assignment-settings';
import { QueueSettingsConflictError, QueueSettingsValidationError, SETTINGS_DEFAULTS } from './ai-queue-assignment-settings';
import type { QueueAlertRepositoryPort } from './ai-queue-assignment-alerts.repository';
import type { QueueOpsQueuePort } from './ai-queue-assignment-ops.ports';
import type { QueueOpsReadPort } from './ai-queue-assignment-ops.repository';
import type { OpsEmitterPort } from './ai-queue-assignment-ops.notifications';
import type { QueueAssignmentEntitlementPort } from './ai-queue-assignment-entitlement';
import { QueueAssignmentContext, QueueAssignmentForbiddenError, QueueAssignmentValidationError, QueueAssignmentDisabledError } from './ai-queue-assignment.dto';
import { utcDate } from '@aipowersalon/date-time';

export class QueueOpsConflictError extends Error { constructor(m: string, readonly currentVersion?: number) { super(m); this.name = 'QueueOpsConflictError'; } }

export const AUTO_KEYS: (keyof QueueAssignmentSettings)[] = ['autoEnabled', 'autoConfidenceFloor', 'autoMaxPerRun', 'autoDelaySeconds', 'autoExclusions', 'assignmentMode'];
const SETTING_KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof QueueAssignmentSettings)[];
const DAY = 86_400_000;
export const MAX_RANGE_DAYS = 92;

/** from / to (ISO or YYYY-MM-DD; `to` is exclusive, a bare date means the end of that day); default the last 7 days. */
export function parseRange(from?: string, to?: string, nowMs = Date.now()): { from: string; to: string } {
  const p = (v: string | undefined, end: boolean): number | null => {
    if (!v) return null;
    const bare = /^\d{4}-\d{2}-\d{2}$/.test(v);
    const t = Date.parse(bare ? `${v}T00:00:00Z` : v);
    if (!Number.isFinite(t)) throw new QueueAssignmentValidationError('Dates must look like 2026-10-01.');
    return bare && end ? t + DAY : t;
  };
  const toMs = p(to, true) ?? nowMs; const fromMs = p(from, false) ?? toMs - 7 * DAY;
  if (fromMs >= toMs) throw new QueueAssignmentValidationError('The start date must be before the end date.');
  if (toMs - fromMs > MAX_RANGE_DAYS * DAY) throw new QueueAssignmentValidationError(`Choose at most ${MAX_RANGE_DAYS} days.`);
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}
/** The instant the local day (in `timeZone`) containing `nowMs` began. */
export function startOfLocalDay(nowMs: number, timeZone?: string | null): number {
  const day = dayIn(new Date(nowMs).toISOString(), timeZone) ?? utcDate(new Date(nowMs));
  const guess = Date.parse(`${day}T00:00:00Z`);
  if (!timeZone) return guess;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
    const g = (t: string) => Number(parts.find((x) => x.type === t)?.value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
    return guess - (asUtc - guess);   // local wall time at `guess` minus `guess` = the zone's offset
  } catch { return guess; }
}

export class QueueOpsService {
  constructor(
    private readonly settings: QueueAssignmentSettingsPort,
    private readonly alerts: QueueAlertRepositoryPort,
    private readonly queue: QueueOpsQueuePort,
    private readonly read: QueueOpsReadPort,
    private readonly entitlement?: QueueAssignmentEntitlementPort | null,
    private readonly emitter?: OpsEmitterPort | null,
    private readonly now: () => number = Date.now,
  ) {}

  private need(ctx: { userId?: string; tenantId?: string; role?: string; permissions?: string[] }, perm: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new QueueAssignmentForbiddenError('Not signed in.');
    if (!hasPermission(ctx as any, perm)) throw new QueueAssignmentForbiddenError(`You need the "${perm}" permission for this.`);
  }
  private async assertEnabled(tenantId: string) {
    if (this.entitlement && !(await this.entitlement.isEnabled(tenantId))) throw new QueueAssignmentDisabledError();
  }
  private async tz(tenantId: string, branchId: string | null): Promise<string | null> {
    if (!branchId) return null;
    return (await this.read.branches(tenantId)).find((b) => b.branchId === branchId)?.timezone ?? null;
  }

  // ── overview ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async overview(ctx: QueueAssignmentContext) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx.tenantId);
    const scope = { tenantId: ctx.tenantId, branchId: ctx.branchId };
    const [eff, snap, open, names, tz, stamps] = await Promise.all([
      this.settings.effective(scope), this.queue.snapshot(ctx), this.alerts.list(scope, { status: 'open' }), this.read.technicianNames(ctx.tenantId),
      this.tz(ctx.tenantId, ctx.branchId), this.read.runStamps(ctx.tenantId, ctx.branchId),
    ]);
    const sum = summarizeQueue({ branchId: ctx.branchId, entries: snap.entries, technicians: snap.technicians }, eff);
    const byType: Record<string, number> = Object.fromEntries(ALERT_TYPES.map((t) => [t, 0]));
    for (const a of open) byType[a.type] = (byType[a.type] ?? 0) + 1;
    const nowMs = this.now();
    const decisions = await this.read.decisions(ctx.tenantId, ctx.branchId, new Date(startOfLocalDay(nowMs, tz)).toISOString(), new Date(nowMs + 1000).toISOString());
    const count = (d: string) => decisions.filter((x) => x.decision === d).length;
    return {
      waiting: sum.waiting, unassigned: sum.unassigned, inService: sum.inService, avgWaitMinutes: sum.avgWaitMinutes, longestWaitMinutes: sum.longestWaitMinutes,
      byWaitLevel: sum.byWaitLevel, congestion: sum.congestion, freeTechnicians: sum.freeTechnicians,
      openAlerts: open.length, byType,
      autoEnabled: eff.autoEnabled, autoAllowed: eff.autoAllowed, autoBlockedBy: eff.autoBlockedBy, salonAutoKilled: eff.salonAutoKilled, configVersion: eff.configVersion,
      lastScanAt: stamps.lastScanAt, lastAutoRunAt: stamps.lastAutoRunAt,
      decisionsToday: { accepted: count('accepted'), rejected: count('rejected'), overridden: count('overridden'), keptUnassigned: count('kept_unassigned'), autoAssigned: count('auto_assigned') },
      technicians: snap.technicians.map((t) => ({ technicianId: t.technicianId, name: t.name ?? names[t.technicianId] ?? null, status: t.status, activeAssignments: t.activeAssignments ?? 0, availableInMinutes: t.availableInMinutes ?? null })),
    };
  }

  // ── settings ─────────────────────────────────────────────────────────────────────────────────────────────────────
  async getSettings(ctx: QueueAssignmentContext) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx.tenantId);
    const scope = { tenantId: ctx.tenantId, branchId: ctx.branchId };
    const [salon, own, effective, versions] = await Promise.all([
      this.settings.tenantSettings(ctx.tenantId), this.settings.branchOverrides({ tenantId: ctx.tenantId, branchId: ctx.branchId }), this.settings.effective(scope), this.settings.versions(scope, 20),
    ]);
    // the location's own values with every key present: null = "inherits the salon value"
    const branch: Record<string, unknown> = { version: own.version };
    for (const k of SETTING_KEYS) branch[k] = (own as any)[k] ?? null;
    return { salon, branch, effective, versions, canEditSalon: this.canEditSalon(ctx) };
  }
  // BUILD_PLAN Phase 9: the SALON-wide settings need the salon-wide reach (the tenant-wide scope permission,
  // owner.branches.compare) plus the rules key — not the OWNER / ADMIN role names.
  private canEditSalon(ctx: QueueAssignmentContext): boolean { return hasTenantWideScope(ctx as any) && hasPermission(ctx as any, 'ai_queue_assignment.manage_rules'); }

  async putSettings(ctx: QueueAssignmentContext, body: { scope?: string; patch?: SettingsPatch; clear?: string[]; expectedVersion?: number; reason?: string }): Promise<{ effective: EffectiveQueueAssignmentSettings; scope: 'salon' | 'branch' }> {
    this.need(ctx, 'ai_queue_assignment.manage_rules');
    await this.assertEnabled(ctx.tenantId);
    const scopeName = body?.scope === 'salon' ? 'salon' : body?.scope === 'branch' || body?.scope === undefined ? 'branch' : null;
    if (!scopeName) throw new QueueAssignmentValidationError("scope must be 'salon' or 'branch'.");
    if (scopeName === 'salon' && !this.canEditSalon(ctx)) throw new QueueAssignmentForbiddenError('Only the salon owner changes the salon-wide settings — change this location instead.');
    const patch: SettingsPatch = {};
    for (const [k, v] of Object.entries(body?.patch ?? {})) {
      if (!(SETTING_KEYS as string[]).includes(k)) throw new QueueAssignmentValidationError(`Unknown setting "${k}".`);
      (patch as any)[k] = v;
    }
    const clear = (body?.clear ?? []).filter((k) => typeof k === 'string');
    for (const k of clear) if (!(SETTING_KEYS as string[]).includes(k)) throw new QueueAssignmentValidationError(`Unknown setting "${k}".`);
    if (clear.length && scopeName === 'salon') throw new QueueAssignmentValidationError('Only a location inherits — the salon values are the base.');
    if ([...Object.keys(patch), ...clear].some((k) => (AUTO_KEYS as string[]).includes(k))) this.need(ctx, 'ai_queue_assignment.manage_auto');
    // Fair Turn §139, §142–144: the salon's turn rules (mode, fairness mode, house rules) are turn_queue.settings.manage
    if ([...Object.keys(patch), ...clear].some((k) => ['assignmentMode', 'turnPolicy', 'rotationPolicy', 'fixedOrder'].includes(k))) this.need(ctx, 'turn_queue.settings.manage');
    if (!Object.keys(patch).length && !clear.length) throw new QueueAssignmentValidationError('Nothing to change.');
    const scope = { tenantId: ctx.tenantId, branchId: scopeName === 'salon' ? null : ctx.branchId };
    const actor = { userId: ctx.userId, role: ctx.role };
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
    const expectedVersion = body?.expectedVersion === undefined || body?.expectedVersion === null ? undefined : Number(body.expectedVersion);
    try {
      let effective: EffectiveQueueAssignmentSettings | null = null;
      if (Object.keys(patch).length) effective = await this.settings.update(scope, patch, actor, { expectedVersion, reason, change: 'settings' });
      if (clear.length) effective = await this.settings.clearBranchOverrides({ tenantId: ctx.tenantId, branchId: ctx.branchId }, clear as any, actor);
      const eff = scopeName === 'salon' ? await this.settings.effective({ tenantId: ctx.tenantId, branchId: ctx.branchId }) : effective!;
      this.emitter?.emit({ tenantId: ctx.tenantId, branchId: scopeName === 'salon' ? null : ctx.branchId }, 'settings_changed', { scope: scopeName, configVersion: eff.configVersion });
      return { effective: eff, scope: scopeName };
    } catch (e) {
      if (e instanceof QueueSettingsConflictError) throw new QueueOpsConflictError(e.message, e.currentVersion);
      if (e instanceof QueueSettingsValidationError) throw new QueueAssignmentValidationError(e.message);
      throw e;
    }
  }
  async settingsVersions(ctx: QueueAssignmentContext, scopeName?: string, limit?: number) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx.tenantId);
    return this.settings.versions({ tenantId: ctx.tenantId, branchId: scopeName === 'salon' ? null : ctx.branchId }, Math.max(1, Math.min(200, Number(limit) || 50)));
  }

  // ── analytics / export / usage ───────────────────────────────────────────────────────────────────────────────────
  async analytics(ctx: QueueAssignmentContext, q: { from?: string; to?: string } = {}): Promise<{ range: { from: string; to: string }; timeZone: string | null; decisions: QueueDecisionAnalytics; waits: WaitAnalytics; byTechnician: TechnicianRow[];
    byHour: { hour: number; served: number; avgWaitMinutes: number | null; decisions: number; autoAssigned: number }[]; alerts: { total: number; autoResolved: number; byType: Record<string, number> } }> {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx.tenantId);
    const range = parseRange(q.from, q.to, this.now());
    const tz = await this.tz(ctx.tenantId, ctx.branchId);
    const [dec, waitsRaw, alerts, names] = await Promise.all([this.read.decisions(ctx.tenantId, ctx.branchId, range.from, range.to), this.read.servedWaits(ctx.tenantId, ctx.branchId, range.from, range.to),
      this.read.alerts(ctx.tenantId, ctx.branchId, range.from, range.to), this.read.technicianNames(ctx.tenantId)]);
    const decisions = computeDecisionAnalytics(dec, tz);
    const waits = computeWaitAnalytics(waitsRaw, tz);
    const hours = new Map<number, { hour: number; served: number; avgWaitMinutes: number | null; decisions: number; autoAssigned: number }>();
    const h = (n: number) => hours.get(n) ?? hours.set(n, { hour: n, served: 0, avgWaitMinutes: null, decisions: 0, autoAssigned: 0 }).get(n)!;
    for (const w of waits.byHour) { const x = h(w.hour); x.served = w.served; x.avgWaitMinutes = w.avgMinutes; }
    for (const d of decisions.byHour) { const x = h(d.hour); x.decisions = d.total; x.autoAssigned = d.autoAssigned; }
    const byType: Record<string, number> = {}; for (const a of alerts) byType[a.type] = (byType[a.type] ?? 0) + 1;
    return { range, timeZone: tz, decisions, waits, byTechnician: byTechnician(dec, waits, names), byHour: [...hours.values()].sort((a, b) => a.hour - b.hour),
      alerts: { total: alerts.length, autoResolved: alerts.filter((a) => a.autoResolved).length, byType } };
  }

  async exportCsv(ctx: QueueAssignmentContext, q: { type?: string; from?: string; to?: string }): Promise<{ format: 'csv'; filename: string; csv: string; rows: number }> {
    this.need(ctx, 'ai_queue_assignment.export');
    await this.assertEnabled(ctx.tenantId);
    const type = q.type ?? 'decisions';
    if (!['decisions', 'alerts', 'history'].includes(type)) throw new QueueAssignmentValidationError('Export type must be decisions, alerts or history.');
    const range = parseRange(q.from, q.to, this.now());
    const names = await this.read.technicianNames(ctx.tenantId);
    const n = (id: string | null) => (id ? names[id] ?? '' : '');
    let headers: string[]; let rows: (string | number | boolean | null)[][];
    if (type === 'decisions') {
      const d = await this.read.decisions(ctx.tenantId, ctx.branchId, range.from, range.to);
      headers = ['created_at', 'queue_item_id', 'decision', 'chosen_technician_id', 'chosen_technician', 'previous_technician_id', 'applied', 'feedback_code', 'reason', 'decided_by'];
      rows = d.map((x) => [x.createdAt, x.queueEntryId, x.decision, x.chosenTechnicianId, n(x.chosenTechnicianId), x.previousTechnicianId, x.applied, x.feedbackCode, x.reason, x.decidedBy]);
    } else if (type === 'alerts') {
      const a = await this.read.alerts(ctx.tenantId, ctx.branchId, range.from, range.to);
      headers = ['created_at', 'type', 'severity', 'status', 'queue_entry_id', 'technician', 'reason', 'auto_resolved', 'resolution', 'resolved_at'];
      rows = a.map((x) => [x.createdAt, x.type, x.severity, x.status, x.queueEntryId, n(x.technicianId), x.reason, x.autoResolved, x.resolution, x.resolvedAt]);
    } else {
      const h = await this.read.history(ctx.tenantId, ctx.branchId, range.from, range.to);
      headers = ['created_at', 'queue_item_id', 'version', 'action', 'source', 'from_status', 'to_status', 'from_technician', 'to_technician', 'reason'];
      rows = h.map((x) => [x.createdAt, x.queueItemId, x.version, x.action, x.source, x.fromStatus, x.toStatus, n(x.fromTechnicianId), n(x.toTechnicianId), x.reason]);
    }
    return { format: 'csv', filename: `ai-queue-${type}-${range.from.slice(0, 10)}-to-${range.to.slice(0, 10)}.csv`, csv: safeCsv(headers, rows), rows: rows.length };
  }

  async usage(ctx: QueueAssignmentContext, q: { from?: string; to?: string } = {}) {
    this.need(ctx, 'ai_queue_assignment.view');
    await this.assertEnabled(ctx.tenantId);
    const range = parseRange(q.from, q.to, this.now());
    const u = await this.read.usage(ctx.tenantId, range.from, range.to);
    return { range, ...u, explanations: u.byAction['queue.explain_recommendation'] ?? 0 };
  }

  // ── owner: branch comparison ─────────────────────────────────────────────────────────────────────────────────────
  async ownerSummary(ctx: { tenantId: string; userId: string; role: string; permissions: string[] }, days = 7) {
    this.need(ctx, 'owner.dashboard.view');
    const d = Math.max(1, Math.min(90, Math.round(Number(days) || 7)));
    const to = new Date(this.now()).toISOString(); const from = new Date(this.now() - d * DAY).toISOString();
    const [branches, waits, decisions, open] = await Promise.all([this.read.branches(ctx.tenantId), this.read.servedWaits(ctx.tenantId, null, from, to),
      this.read.decisions(ctx.tenantId, null, from, to), this.read.openAlertCounts(ctx.tenantId)]);
    const row = (bid: string | null, name: string | null) => {
      const w = computeWaitAnalytics(bid ? waits.filter((x) => x.branchId === bid) : waits);
      const a = computeDecisionAnalytics(bid ? decisions.filter((x) => x.branchId === bid) : decisions);
      return { branchId: bid, name, served: w.served, avgWaitMinutes: w.avgMinutes, longestWaitMinutes: w.longestMinutes, acceptanceRate: a.acceptanceRate,
        staffDecisions: a.staffTotal, autoAssigned: a.autoAssigned, openAlerts: bid ? open[bid] ?? 0 : Object.values(open).reduce((s, x) => s + x, 0) };
    };
    return { days: d, range: { from, to }, branches: branches.map((b) => row(b.branchId, b.name)), totals: row(null, null) };
  }
}
