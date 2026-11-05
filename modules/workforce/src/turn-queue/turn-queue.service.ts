// turn-queue.service.ts — the manager / board surface of the technician turn queue (Fair Turn Engine mandate §90–96,
// §100–114, §120–138, §169–175). Reads the ONE turn ledger, the time clock and the PAYROLL snapshot store (money comes
// only from ticket_compensation_snapshots + compensation adjustments — the queue never calculates pay, §117–119).
// Writes go through turn-ledger.ts only. Tenant from the session; the branch is the session's location (§145–148).
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { branchTimeZone } from '@aipowersalon/database';
import { businessDate, addDays, localDateTimeToEpochMs, isYmd, utcDate } from '@aipowersalon/date-time';
import { hasPermission } from '@aipowersalon/permissions';
import type { OutboxWriter } from '@aipowersalon/events';
import type { RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import {
  rotationOrder, boardStatusOf, boardColumnOf, mergeTurnPolicy, validateTurnPolicyPatch, previewTurnPolicyChange, isFairnessMode, techQueueView,
  RECOMMENDED_TURN_POLICY, RECOMMENDED_ASSIGNMENT_MODE, RECOMMENDED_FAIRNESS_MODE, FAIRNESS_MODE_LABEL, OVERRIDE_REASONS, DECLINE_REASONS, SKIP_REASONS, SKIP_REASON_LABEL,
  TurnQueueError, turnsToUnits, ASSIGNMENT_MODES, type TurnPolicy, type BoardStatus, type AssignmentMode,
} from './turn-core';
import { computeFairness, explainTimeline } from './turn-fairness';
import {
  readTurnDay, readTurnEvents, loadTurnContext, turnHold, turnRelease, turnReorder, turnAdjust, turnJoin, turnCustomerDeclined, turnCloseDay,
  type TurnStateRow, type TurnEventRow,
} from './turn-ledger';
import { technicianEarningsSummary } from '../compensation/compensation-earnings';
import { CompensationSnapshotRepository } from '../compensation/compensation-snapshot.repository';
import { classifyBreak, mergeBreakPolicy } from '../time-clock/break-policy';
import { KyselyAuditRepository } from '@aipowersalon/audit';

export interface TurnQueueContext { tenantId: string; branchId: string; userId: string; role?: string; permissions?: string[] }
export class TurnQueueForbiddenError extends Error { constructor(m = 'Forbidden') { super(m); this.name = 'TurnQueueForbiddenError'; } }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const MONEY_PERMS = ['payroll.view', 'technicians.view_pay'];
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export interface BoardTechnician {
  technicianId: string; name: string; avatarUrl: string | null; rank: number | null; status: BoardStatus; column: 'NEXT_READY' | 'SERVING' | 'APPOINTMENT_SOON' | 'BREAK_HOLD' | 'OFF_SHIFT'; inRotation: boolean; holdReason: string | null;
  turnUnitsToday: number; inProgressUnits: number; fullTurns: number; partialTurns: number; walkInsToday: number; appointmentsToday: number;
  nextAppointmentAt: string | null; nextAppointmentInMinutes: number | null; currentService: { queueItemId: string; label: string } | null;
  readySince: string | null; readyMinutes: number | null; clockedMinutes: number; onBreakSince: string | null; skipsToday: number; basis: string | null;
  money?: { serviceSalesCents: number; commissionCents: number; tipsCents: number; retailCommissionCents: number; estimatedEarningsCents: number } | null;
}

export class TurnQueueService {
  constructor(private readonly db: Kysely<DB>, private readonly outbox: OutboxWriter | null = null, private readonly rt: RealtimeEmitter | null = null) {}

  private need(ctx: TurnQueueContext, perm: string) {
    if (!ctx?.tenantId || !ctx?.userId) throw new TurnQueueForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, perm)) throw new TurnQueueForbiddenError('Missing ' + perm);
  }
  private branch(ctx: TurnQueueContext): string {
    if (!isUuid(ctx.branchId)) throw new TurnQueueError('TURN_QUEUE_NOT_CONFIGURED', 'Choose a location first — the turn queue belongs to one location.');
    return ctx.branchId;
  }
  private actor(ctx: TurnQueueContext) { return { userId: isUuid(ctx.userId) ? ctx.userId : null, type: 'user' as const }; }
  private reason(r: unknown, min = 3): string {
    const s = typeof r === 'string' ? r.trim() : '';
    if (s.length < min) throw new TurnQueueError('MANUAL_OVERRIDE_REASON_REQUIRED', 'Say why (a short reason is required).');
    return s.slice(0, 500);
  }
  private sawMoney(ctx: TurnQueueContext): boolean { return MONEY_PERMS.some((p) => hasPermission(ctx as any, p)); }
  /** §343: the ledger already wrote technician.turn_queue_changed through the outbox in the command's transaction; the
   *  realtime projection broadcasts turn_queue_updated. A domain module never pushes realtime itself — nothing to do. */
  private announce(_ctx: TurnQueueContext, _payload: Record<string, unknown>): void { /* outbox → projection */ }
  private async techNames(tenantId: string, ids: string[]): Promise<Map<string, { name: string; avatarUrl: string | null }>> {
    const want = [...new Set(ids.filter(isUuid))];
    if (!want.length) return new Map();
    const rows: any[] = await this.db.selectFrom('technicians').select(['id', 'full_name', 'avatar_url'] as any).where('tenant_id', '=', tenantId).where('id', 'in', want).execute();
    return new Map(rows.map((r) => [String(r.id), { name: r.full_name || 'Technician', avatarUrl: r.avatar_url ?? null }]));
  }
  private async dayWindow(tenantId: string, branchId: string | null, date: string): Promise<{ tz: string; startMs: number; endMs: number }> {
    const tz = await branchTimeZone(this.db, tenantId, branchId);
    return { tz, startMs: localDateTimeToEpochMs(date, '00:00', tz), endMs: localDateTimeToEpochMs(addDays(date, 1), '00:00', tz) };
  }

  // ── the board (§90–93) ──────────────────────────────────────────────────────────────────────────────────────────
  async board(ctx: TurnQueueContext, nowMs: number = Date.now()) {
    this.need(ctx, 'turn_queue.read');
    const branchId = this.branch(ctx);
    const day = await readTurnDay(this.db, ctx.tenantId, branchId, nowMs);
    const { mode, policy, assignmentMode, policyVersion, rotationPolicy } = day.ctx;
    // technicians clocked in at this location but not on today's board yet (clock-in before the day / before the turn queue)
    const wf: any[] = await this.db.selectFrom('technician_workforce_state').select(['technician_id', 'clock_status', 'break_started_at'] as any)
      .where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId).where('clock_status', '<>', 'CLOCKED_OUT').execute();
    const rows: TurnStateRow[] = [...day.rows];
    for (const w of wf) if (!rows.some((r) => r.technicianId === w.technician_id)) rows.push({ id: '', tenantId: ctx.tenantId, branchId, businessDate: day.businessDate, technicianId: String(w.technician_id), name: null,
      status: 'CLOCKED_IN', inRotation: false, rotationPosition: 0, accumulatedUnits: 0, provisionalUnits: 0, pendingUnits: 0, baselineUnits: 0, specialUnits: 0, serviceMinutes: 0, baselineMinutes: 0,
      readySince: null, lastAssignmentAt: null, lastEligibleOpportunityAt: null, eligibleSkipCount: 0, consecutiveAuto: 0, holdReason: null, breakStartedAt: iso(w.break_started_at), joinedAt: null, closedAt: null, policyVersion: null, version: 0 });
    const ids = rows.map((r) => r.technicianId);
    const names = await this.techNames(ctx.tenantId, ids);
    const order = rotationOrder(mode, policy, rows, nowMs);
    const rankOf = new Map(order.map((o) => [o.technicianId, o]));
    const nextUp = order.find((o) => rows.find((r) => r.technicianId === o.technicianId)?.status === 'READY')?.technicianId ?? null;
    const events = await readTurnEvents(this.db, ctx.tenantId, { branchId, from: day.businessDate, to: day.businessDate, eventTypes: ['ASSIGN', 'MANUAL_ASSIGN', 'TURN_CREDIT', 'SKIP', 'CORRECTION', 'DECLINE', 'OFFER_TIMEOUT'] });
    const closed = new Set(events.filter((e) => ['CORRECTION', 'DECLINE', 'OFFER_TIMEOUT'].includes(e.eventType)).map((e) => e.assignmentRef).filter(Boolean) as string[]);
    const { startMs, endMs, tz } = await this.dayWindow(ctx.tenantId, branchId, day.businessDate);
    const appts: any[] = ids.length ? await this.db.selectFrom('pos_tech_appointments').select(['technician_id', 'start_time', 'status'] as any).where('tenant_id', '=', ctx.tenantId)
      .where('technician_id', 'in', ids).where('appt_date', '=', day.businessDate as any).where('status', 'in', ['confirmed', 'scheduled', 'booked', 'checked_in']).execute() : [];
    const serving: any[] = await this.db.selectFrom('pos_queue_items').select(['id', 'assigned_technician_id', 'customer_name', 'requested_services', 'status'] as any)
      .where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId).where('status', 'in', ['assigned', 'in_service', 'ready_for_tech']).where('assigned_technician_id', 'in', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).execute();
    const offers: any[] = ids.length ? await this.db.selectFrom('pos_tech_queue_tickets').select(['assigned_technician_id'] as any).where('tenant_id', '=', ctx.tenantId)
      .where('assigned_technician_id', 'in', ids).where('status', 'in', ['assigned', 'waiting_for_acceptance']).execute() : [];
    const punches: any[] = ids.length ? await this.db.selectFrom('technician_shifts').select(['technician_id', 'start_time', 'end_time'] as any).where('tenant_id', '=', ctx.tenantId)
      .where('technician_id', 'in', ids).where((eb: any) => eb.or([eb('shift_date', '=', day.businessDate), eb('end_time', 'is', null)])).execute() : [];
    const money = this.sawMoney(ctx) && policy.revenueBalanceIndicator !== undefined
      ? new Map((await new CompensationSnapshotRepository(this.db).sumAllTechniciansPeriod(ctx.tenantId, new Date(startMs).toISOString(), new Date(endMs).toISOString(), branchId)).map((x) => [x.technicianId, x.sums]))
      : null;
    const techs: BoardTechnician[] = rows.map((r) => {
      const mine = events.filter((e) => e.technicianId === r.technicianId);
      const assigns = mine.filter((e) => (e.eventType === 'ASSIGN' || e.eventType === 'MANUAL_ASSIGN') && !closed.has(e.id));
      const credits = mine.filter((e) => e.eventType === 'TURN_CREDIT' && e.turnUnitsDelta > 0);
      const next = appts.filter((a) => a.technician_id === r.technicianId).map((a) => localDateTimeToEpochMs(day.businessDate, String(a.start_time).slice(0, 5), tz)).filter((t) => Number.isFinite(t) && t >= nowMs).sort((a, b) => a - b)[0];
      const nextIn = next ? Math.round((next - nowMs) / 60000) : null;
      const appointmentSoon = nextIn != null && policy.appointmentProtectionEnabled && nextIn <= 60;
      const status = boardStatusOf(r, { isNext: r.technicianId === nextUp, appointmentSoon, offerPending: offers.some((o) => o.assigned_technician_id === r.technicianId) });
      const cur = serving.find((q) => q.assigned_technician_id === r.technicianId);
      const clocked = punches.filter((p) => p.technician_id === r.technicianId).reduce((s, p) => {
        const a = Math.max(Date.parse(iso(p.start_time) ?? ''), startMs); const b = Math.min(p.end_time ? Date.parse(iso(p.end_time)!) : nowMs, endMs);
        return Number.isFinite(a) && Number.isFinite(b) && b > a ? s + (b - a) / 60000 : s;
      }, 0);
      const rk = rankOf.get(r.technicianId);
      const m = money?.get(r.technicianId);
      const name = names.get(r.technicianId);
      return {
        technicianId: r.technicianId, name: name?.name ?? r.name ?? 'Technician', avatarUrl: name?.avatarUrl ?? null, rank: rk?.rank ?? null, status, column: boardColumnOf(status), inRotation: r.inRotation, holdReason: r.holdReason ?? null,
        turnUnitsToday: r.accumulatedUnits, inProgressUnits: r.provisionalUnits, fullTurns: credits.filter((c) => c.turnUnitsDelta >= 100).length, partialTurns: credits.filter((c) => c.turnUnitsDelta < 100).length,
        walkInsToday: assigns.filter((a) => a.assignmentKind === 'walk_in_shared' || a.assignmentKind === 'walk_in_requested').length,
        appointmentsToday: assigns.filter((a) => a.assignmentKind === 'appointment_any' || a.assignmentKind === 'appointment_requested').length,
        nextAppointmentAt: next ? new Date(next).toISOString() : null, nextAppointmentInMinutes: nextIn,
        currentService: cur ? { queueItemId: String(cur.id), label: serviceLabel(cur.requested_services) } : null,
        readySince: r.status === 'READY' ? r.readySince : null, readyMinutes: rk?.readyMinutes ?? null, clockedMinutes: Math.round(clocked), onBreakSince: r.status === 'BREAK' ? r.breakStartedAt : null,
        skipsToday: mine.filter((e) => e.eventType === 'SKIP').length, basis: rk?.basis ?? null,
        ...(money ? { money: m ? (() => { const e = technicianEarningsSummary(m as any); return { serviceSalesCents: Number((m as any).grossServiceCents ?? 0), commissionCents: e.serviceCommissionCents, tipsCents: e.tipsCents, retailCommissionCents: e.retailCommissionCents, estimatedEarningsCents: e.estimatedEarningsCents }; })() : { serviceSalesCents: 0, commissionCents: 0, tipsCents: 0, retailCommissionCents: 0, estimatedEarningsCents: 0 } } : {}),
      };
    }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name));
    return {
      businessDate: day.businessDate, timeZone: tz, mode, modeLabel: isFairnessMode(rotationPolicy) ? FAIRNESS_MODE_LABEL[mode] : `Legacy rotation "${rotationPolicy}" (scored)`, rotationPolicy, assignmentMode, policyVersion,
      nextUpTechnicianId: nextUp, technicians: techs, moneyVisible: !!money, serverTime: new Date(nowMs).toISOString(),
    };
  }

  // ── history (§133–138) ──────────────────────────────────────────────────────────────────────────────────────────
  async history(ctx: TurnQueueContext, f: { from?: string; to?: string; technicianId?: string; customerId?: string; reasonCode?: string; eventType?: string; assignmentSource?: string; manualOnly?: boolean; limit?: number }) {
    this.need(ctx, 'turn_queue.history.read');
    const branchId = this.branch(ctx);
    const today = businessDate(await branchTimeZone(this.db, ctx.tenantId, branchId));
    const from = isYmd(f.from) ? f.from : today; const to = isYmd(f.to) ? f.to : from;
    if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) throw new TurnQueueError('TURN_POLICY_INVALID', 'Choose a range of at most 92 days.');
    const events = await readTurnEvents(this.db, ctx.tenantId, { branchId, from, to, technicianId: isUuid(f.technicianId) ? f.technicianId : null, customerId: isUuid(f.customerId) ? f.customerId : null,
      reasonCode: f.reasonCode || null, assignmentSource: f.assignmentSource || null, eventTypes: f.manualOnly ? ['MANUAL_ASSIGN', 'REORDER', 'ADJUST', 'HOLD', 'RELEASE'] : f.eventType ? [f.eventType] : undefined, limit: f.limit });
    const names: Record<string, string | null> = {};
    for (const e of events) names[e.technicianId] = e.technicianName;
    const extra = await this.techNames(ctx.tenantId, events.map((e) => e.recommendedTechnicianId).filter(Boolean) as string[]);
    for (const [k, v] of extra) names[k] = names[k] ?? v.name;
    const text = new Map(explainTimeline(events.map((e) => ({ ...e, metadata: e.metadata })), names).map((t, i) => [events[i]?.id, t.text]));
    return { from, to, events: events.map((e) => ({ ...publicEvent(e), text: text.get(e.id) ?? e.eventType })) };
  }

  // ── manager actions (§31, §71–73, §62, §125) ────────────────────────────────────────────────────────────────────
  async hold(ctx: TurnQueueContext, technicianId: string, body: { reason?: string }) {
    this.need(ctx, 'turn_queue.hold');
    const r = await turnHold(this.db, { tenantId: ctx.tenantId, branchId: this.branch(ctx), technicianId: this.tech(technicianId), reason: this.reason(body?.reason), actor: this.actor(ctx) }, { outbox: this.outbox });
    this.announce(ctx, { kind: 'hold', technicianIds: r.technicianIds }); return r;
  }
  async release(ctx: TurnQueueContext, technicianId: string, body: { reason?: string; toBack?: boolean }) {
    this.need(ctx, 'turn_queue.hold');
    const r = await turnRelease(this.db, { tenantId: ctx.tenantId, branchId: this.branch(ctx), technicianId: this.tech(technicianId), reason: typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null, toBack: !!body?.toBack, actor: this.actor(ctx) }, { outbox: this.outbox });
    this.announce(ctx, { kind: 'release', technicianIds: r.technicianIds }); return r;
  }
  async reorder(ctx: TurnQueueContext, technicianId: string, body: { setNext?: boolean; beforeTechnicianId?: string; toBack?: boolean; toIndex?: number; reason?: string; expectedVersion?: number }) {
    this.need(ctx, 'turn_queue.reorder');
    const placement = { setNext: !!body?.setNext, toBack: !!body?.toBack, ...(isUuid(body?.beforeTechnicianId) ? { beforeTechnicianId: body.beforeTechnicianId } : {}), ...(typeof body?.toIndex === 'number' ? { toIndex: body.toIndex } : {}) };
    const r = await turnReorder(this.db, { tenantId: ctx.tenantId, branchId: this.branch(ctx), technicianId: this.tech(technicianId), placement, reason: this.reason(body?.reason), actor: this.actor(ctx), expectedVersion: typeof body?.expectedVersion === 'number' ? body.expectedVersion : undefined }, { outbox: this.outbox });
    this.announce(ctx, { kind: 'reorder', technicianIds: r.technicianIds }); return r;
  }
  async adjust(ctx: TurnQueueContext, technicianId: string, body: { turns?: number | string; reason?: string; queueItemId?: string }) {
    this.need(ctx, 'turn_queue.adjust');
    let units: number;
    try { units = turnsToUnits(body?.turns as any); } catch (e: any) { throw new TurnQueueError('TURN_POLICY_INVALID', e.message); }
    const r = await turnAdjust(this.db, { tenantId: ctx.tenantId, branchId: this.branch(ctx), technicianId: this.tech(technicianId), deltaUnits: units, reason: this.reason(body?.reason), queueItemId: isUuid(body?.queueItemId) ? body.queueItemId : null, actor: this.actor(ctx) }, { outbox: this.outbox });
    this.announce(ctx, { kind: 'adjust', technicianIds: r.technicianIds }); return r;
  }
  async join(ctx: TurnQueueContext, technicianId: string, body: { reason?: string }) {
    this.need(ctx, 'turn_queue.join');
    const wf: any = await this.db.selectFrom('technician_workforce_state').select(['clock_status'] as any).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', this.tech(technicianId)).executeTakeFirst();
    if (!wf || wf.clock_status === 'CLOCKED_OUT') throw new TurnQueueError('TECHNICIAN_NOT_CLOCKED_IN');
    const r = await turnJoin(this.db, { tenantId: ctx.tenantId, branchId: this.branch(ctx), technicianId, reason: typeof body?.reason === 'string' ? body.reason.slice(0, 500) : null, actor: this.actor(ctx) }, { outbox: this.outbox });
    this.announce(ctx, { kind: 'join', technicianIds: r.technicianIds }); return r;
  }
  async customerDeclined(ctx: TurnQueueContext, body: { queueItemId?: string; technicianId?: string; reason?: string }) {
    this.need(ctx, 'turn_queue.assign');
    if (!isUuid(body?.queueItemId) || !isUuid(body?.technicianId)) throw new TurnQueueError('TECHNICIAN_NOT_ELIGIBLE', 'Choose the guest and the technician the guest declined.');
    const q: any = await this.db.selectFrom('pos_queue_items').select(['id', 'branch_id'] as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', body.queueItemId).executeTakeFirst();
    if (!q || String(q.branch_id) !== this.branch(ctx)) throw new TurnQueueError('TECHNICIAN_NOT_ELIGIBLE', 'That guest is not in this location’s queue.');
    const r = await turnCustomerDeclined(this.db, { tenantId: ctx.tenantId, branchId: ctx.branchId, technicianId: body.technicianId, queueItemId: body.queueItemId, reasonText: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null, actor: this.actor(ctx) }, { outbox: this.outbox });
    this.announce(ctx, { kind: 'customer_declined', technicianIds: r.technicianIds }); return r;
  }
  async closeDay(ctx: TurnQueueContext, body: { businessDate?: string; reason?: string }) {
    this.need(ctx, 'turn_queue.adjust');
    if (!isYmd(body?.businessDate)) throw new TurnQueueError('TURN_POLICY_INVALID', 'Choose the business day to close.');
    const r = await turnCloseDay(this.db, { tenantId: ctx.tenantId, branchId: this.branch(ctx), businessDate: body.businessDate, actor: this.actor(ctx) }, { outbox: this.outbox });
    this.announce(ctx, { kind: 'day_close' }); return r;
  }
  private tech(id: string): string { if (!isUuid(id)) throw new TurnQueueError('TECHNICIAN_NOT_ELIGIBLE', 'Unknown technician.'); return id; }

  // ── settings: the vocabulary, the preview (§120–124, §167) ──────────────────────────────────────────────────────
  async settingsInfo(ctx: TurnQueueContext) {
    this.need(ctx, 'turn_queue.read');
    const branchId = this.branch(ctx);
    const c = await loadTurnContext(this.db, ctx.tenantId, branchId);
    return {
      effective: { assignmentMode: c.assignmentMode, fairnessMode: c.rotationPolicy, turnPolicy: { ...c.policy } as Record<string, unknown>, policyVersion: c.policyVersion },
      recommended: { assignmentMode: RECOMMENDED_ASSIGNMENT_MODE, fairnessMode: RECOMMENDED_FAIRNESS_MODE, turnPolicy: { ...RECOMMENDED_TURN_POLICY } as Record<string, unknown> },
      vocabulary: { assignmentModes: ASSIGNMENT_MODES, fairnessModes: Object.entries(FAIRNESS_MODE_LABEL).map(([value, label]) => ({ value, label })), overrideReasons: OVERRIDE_REASONS, declineReasons: DECLINE_REASONS,
        skipReasons: SKIP_REASONS.map((r) => ({ value: r, label: SKIP_REASON_LABEL[r] })) },
      canManage: hasPermission(ctx as any, 'turn_queue.settings.manage'),
    };
  }
  async previewSettings(ctx: TurnQueueContext, body: { scope?: string; assignmentMode?: string; fairnessMode?: string; turnPolicy?: Record<string, unknown> }) {
    this.need(ctx, 'turn_queue.settings.manage');
    const branchId = this.branch(ctx);
    const scope = body?.scope === 'salon' ? 'salon' : 'branch';
    const problems = body?.turnPolicy ? validateTurnPolicyPatch(Object.fromEntries(Object.entries(body.turnPolicy).filter(([, v]) => v !== null)), scope) : [];
    if (body?.assignmentMode && !(ASSIGNMENT_MODES as readonly string[]).includes(body.assignmentMode)) problems.push('assignmentMode must be AUTOMATIC, RECOMMEND_AND_CONFIRM or MANUAL.');
    if (body?.fairnessMode && !isFairnessMode(body.fairnessMode)) problems.push('Unknown fairness mode.');
    if (problems.length) throw new TurnQueueError('TURN_POLICY_INVALID', problems.join(' '));
    const c = await loadTurnContext(this.db, ctx.tenantId, branchId);
    const next = mergeTurnPolicy(c.policy, body?.turnPolicy ?? {});
    return { changes: previewTurnPolicyChange(c.policy, next, { currentMode: c.assignmentMode, nextMode: (body?.assignmentMode ?? c.assignmentMode) as AssignmentMode, currentFairness: c.rotationPolicy, nextFairness: body?.fairnessMode ?? c.rotationPolicy }) };
  }

  // ── turn unit rules (§41–45, §74) ───────────────────────────────────────────────────────────────────────────────
  async listRules(ctx: TurnQueueContext, opts: { includeHistory?: boolean } = {}) {
    this.need(ctx, 'turn_queue.read');
    let q = this.db.selectFrom('turn_unit_rules as r').leftJoin('services as s', (j) => j.onRef('s.id', '=', 'r.service_id').onRef('s.tenant_id', '=', 'r.tenant_id'))
      .select(['r.id', 'r.rule_key', 'r.version', 'r.scope', 'r.service_id', 's.name as service_name', 'r.category', 'r.max_duration_minutes', 'r.turn_units', 'r.special_rotation', 'r.active', 'r.reason', 'r.created_by', 'r.created_at', 'r.superseded_at'] as any)
      .where('r.tenant_id', '=', ctx.tenantId);
    if (!opts.includeHistory) q = q.where('r.active', '=', true);
    const rows: any[] = await q.orderBy('r.scope').orderBy('r.created_at', 'desc').limit(1000).execute();
    const pol = await loadTurnContext(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : null);
    return { defaultTurnUnits: pol.policy.defaultTurnUnits, rules: rows.map((r) => ({ id: String(r.id), ruleKey: String(r.rule_key), version: Number(r.version), scope: r.scope, serviceId: r.service_id ?? null, serviceName: r.service_name ?? null,
      category: r.category ?? null, maxDurationMinutes: r.max_duration_minutes == null ? null : Number(r.max_duration_minutes), turnUnits: Number(r.turn_units), turns: Number(r.turn_units) / 100,
      specialRotation: !!r.special_rotation, active: !!r.active, reason: r.reason ?? null, createdBy: r.created_by ?? null, createdAt: iso(r.created_at), supersededAt: iso(r.superseded_at) })) };
  }
  /** Create a rule, or (ruleKey given) supersede its active version with version + 1 — history is never rewritten (§45). */
  async saveRule(ctx: TurnQueueContext, body: { ruleKey?: string; scope?: string; serviceId?: string; category?: string; maxDurationMinutes?: number; turns?: number | string; specialRotation?: boolean; reason?: string }) {
    this.need(ctx, 'turn_queue.settings.manage');
    const scope = body?.scope;
    if (!['service', 'category', 'duration'].includes(String(scope))) throw new TurnQueueError('TURN_POLICY_INVALID', 'A rule is for one service, one category or a duration bound.');
    let units: number;
    try { units = turnsToUnits(body?.turns as any); } catch (e: any) { throw new TurnQueueError('TURN_POLICY_INVALID', e.message); }
    if (units < 0 || units > 1000) throw new TurnQueueError('TURN_POLICY_INVALID', 'A rule is 0 to 10 turns.');
    if (scope === 'service' && !isUuid(body.serviceId)) throw new TurnQueueError('TURN_POLICY_INVALID', 'Choose the service.');
    if (scope === 'category' && !(typeof body.category === 'string' && body.category.trim())) throw new TurnQueueError('TURN_POLICY_INVALID', 'Choose the category.');
    if (scope === 'duration' && !(Number.isInteger(body.maxDurationMinutes) && (body.maxDurationMinutes as number) > 0 && (body.maxDurationMinutes as number) <= 600)) throw new TurnQueueError('TURN_POLICY_INVALID', 'A duration rule needs the longest service it covers, in minutes (1–600).');
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) || null : null;
    const actor = isUuid(ctx.userId) ? ctx.userId : null;
    return this.db.transaction().execute(async (trx) => {
      let version = 1; let ruleKey: string | null = null;
      if (isUuid(body.ruleKey)) {
        const cur: any = await trx.selectFrom('turn_unit_rules').select(['id', 'version', 'scope'] as any).where('tenant_id', '=', ctx.tenantId).where('rule_key', '=', body.ruleKey).where('active', '=', true).forUpdate().executeTakeFirst();
        if (!cur) throw new TurnQueueError('TURN_POLICY_INVALID', 'That rule changed or no longer exists — reload.');
        await trx.updateTable('turn_unit_rules').set({ active: false, superseded_at: new Date(), superseded_by: actor } as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', cur.id).execute();
        version = Number(cur.version) + 1; ruleKey = body.ruleKey;
      } else {
        // a second active rule for the same target is refused by the database (partial unique indexes) — say so plainly
        const dupe: any = await trx.selectFrom('turn_unit_rules').select('id').where('tenant_id', '=', ctx.tenantId).where('active', '=', true).where('scope', '=', scope as any)
          .where((eb: any) => scope === 'service' ? eb('service_id', '=', body.serviceId) : scope === 'category' ? eb(sql`lower(category)`, '=', String(body.category).trim().toLowerCase()) : eb('max_duration_minutes', '=', body.maxDurationMinutes)).executeTakeFirst();
        if (dupe) throw new TurnQueueError('TURN_POLICY_INVALID', 'A rule for that already exists — edit it instead.');
      }
      const row: any = await trx.insertInto('turn_unit_rules').values({ tenant_id: ctx.tenantId, ...(ruleKey ? { rule_key: ruleKey } : {}), version, scope,
        service_id: scope === 'service' ? body.serviceId : null, category: scope === 'category' ? String(body.category).trim() : null, max_duration_minutes: scope === 'duration' ? body.maxDurationMinutes : null,
        turn_units: units, special_rotation: !!body.specialRotation, active: true, reason, created_by: actor } as any).returning(['id', 'rule_key', 'version'] as any).executeTakeFirst();
      await new KyselyAuditRepository(trx as any).record({ tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, userId: actor, role: ctx.role ?? 'MANAGER' },
        { module: 'workforce', action: 'turn_unit_rule_saved', resourceType: 'turn_unit_rule', resourceId: String(row.rule_key), reason: reason ?? undefined,
          after: { version, scope, units, specialRotation: !!body.specialRotation }, metadata: { serviceId: body.serviceId ?? null, category: body.category ?? null, maxDurationMinutes: body.maxDurationMinutes ?? null } });
      return { id: String(row.id), ruleKey: String(row.rule_key), version: Number(row.version) };
    });
  }
  async retireRule(ctx: TurnQueueContext, ruleKey: string, body: { reason?: string }) {
    this.need(ctx, 'turn_queue.settings.manage');
    if (!isUuid(ruleKey)) throw new TurnQueueError('TURN_POLICY_INVALID', 'Unknown rule.');
    const reason = this.reason(body?.reason);
    return this.db.transaction().execute(async (trx) => {
      const r: any = await trx.updateTable('turn_unit_rules').set({ active: false, superseded_at: new Date(), superseded_by: isUuid(ctx.userId) ? ctx.userId : null } as any)
        .where('tenant_id', '=', ctx.tenantId).where('rule_key', '=', ruleKey).where('active', '=', true).returning(['version'] as any).executeTakeFirst();
      if (!r) throw new TurnQueueError('TURN_POLICY_INVALID', 'That rule changed or no longer exists — reload.');
      await new KyselyAuditRepository(trx as any).record({ tenantId: ctx.tenantId, branchId: isUuid(ctx.branchId) ? ctx.branchId : null, userId: isUuid(ctx.userId) ? ctx.userId : null, role: ctx.role ?? 'MANAGER' },
        { module: 'workforce', action: 'turn_unit_rule_retired', resourceType: 'turn_unit_rule', resourceId: ruleKey, reason, before: { version: Number(r.version), active: true }, after: { active: false } });
      return { retired: true };
    });
  }

  // ── fairness dashboard (§53–56, §109–113, §191) ────────────────────────────────────────────────────────────────
  async fairness(ctx: TurnQueueContext, q: { from?: string; to?: string } = {}, nowMs: number = Date.now()) {
    this.need(ctx, 'turn_queue.history.read');
    const branchId = this.branch(ctx);
    const tz = await branchTimeZone(this.db, ctx.tenantId, branchId);
    const today = businessDate(tz, new Date(nowMs));
    const from = isYmd(q.from) ? q.from : today; const to = isYmd(q.to) ? q.to : from;
    if (to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) throw new TurnQueueError('TURN_POLICY_INVALID', 'Choose a range of at most 92 days.');
    const events = await readTurnEvents(this.db, ctx.tenantId, { branchId, from, to, limit: 5000 });
    const names: Record<string, string | null> = {}; for (const e of events) names[e.technicianId] = e.technicianName;
    const c = await loadTurnContext(this.db, ctx.tenantId, branchId);
    const startMs = localDateTimeToEpochMs(from, '00:00', tz); const endMs = Math.min(nowMs, localDateTimeToEpochMs(addDays(to, 1), '00:00', tz));
    const report = computeFairness(events.map((e) => ({ ...e, metadata: e.metadata })), names, { startMs, endMs }, { fairRangeUnits: c.policy.fairRangeUnits, fairRangePercent: c.policy.fairRangePercent });
    return { from, to, timeZone: tz, ...report, status: report.rows.map((r) => ({ technicianId: r.technicianId, indicator: r.indicator, label: r.indicatorLabel })), operationalDiagnosticNotPayroll: true as const };
  }

  // ── queue health + exceptions (§169–170) ─────────────────────────────────────────────────────────────────────────
  async health(ctx: TurnQueueContext, nowMs: number = Date.now()) {
    this.need(ctx, 'turn_queue.read');
    const branchId = this.branch(ctx);
    const board = await this.board({ ...ctx, permissions: (ctx.permissions ?? []).filter((p) => !MONEY_PERMS.includes(p)) }, nowMs);
    const waiting: any[] = await this.db.selectFrom('pos_queue_items').select(['id', 'checked_in_at', 'status'] as any).where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId)
      .where('status', 'in', ['waiting', 'called']).execute();
    const longestWait = waiting.reduce((m, w) => Math.max(m, w.checked_in_at ? Math.round((nowMs - Date.parse(iso(w.checked_in_at)!)) / 60000) : 0), 0);
    const ready = board.technicians.filter((t) => t.status === 'READY' || t.status === 'NEXT_UP');
    const exceptions: { code: string; severity: 'info' | 'warning'; text: string; technicianId?: string; businessDate?: string }[] = [];
    if (waiting.length && ready.length && longestWait >= 10) exceptions.push({ code: 'CUSTOMER_WAITING_TECHNICIAN_IDLE', severity: 'warning', text: `A guest has waited ${longestWait} min while ${ready.length} technician(s) are ready.` });
    const wf: any[] = await this.db.selectFrom('technician_workforce_state').select(['technician_id', 'clock_status'] as any).where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId).execute();
    const out = new Set(wf.filter((w) => w.clock_status === 'CLOCKED_OUT').map((w) => String(w.technician_id)));
    for (const t of ready) if (out.has(t.technicianId)) exceptions.push({ code: 'READY_WHILE_CLOCKED_OUT', severity: 'warning', text: `${t.name} is ready in the rotation but clocked out.`, technicianId: t.technicianId });
    const busy: any[] = await this.db.selectFrom('pos_queue_items').select(['assigned_technician_id', sql<number>`count(*)`.as('n')] as any).where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId)
      .where('status', '=', 'in_service').where('assigned_technician_id', 'is not', null).groupBy('assigned_technician_id').execute();
    for (const b of busy) if (Number(b.n) > 1) exceptions.push({ code: 'SERVING_TWO_GUESTS', severity: 'warning', text: `${board.technicians.find((t) => t.technicianId === b.assigned_technician_id)?.name ?? 'A technician'} is serving ${b.n} guests at once.`, technicianId: b.assigned_technician_id });
    for (const t of board.technicians) if ((t.status === 'ASSIGNED' || t.status === 'SERVING' || t.status === 'ASSIGNMENT_OFFERED') && t.nextAppointmentInMinutes != null && t.nextAppointmentInMinutes <= 10)
      exceptions.push({ code: 'ASSIGNMENT_OVERLAPS_APPOINTMENT', severity: 'warning', text: `${t.name} is busy and has an appointment in ${t.nextAppointmentInMinutes} min.`, technicianId: t.technicianId });
    const events = await readTurnEvents(this.db, ctx.tenantId, { branchId, from: board.businessDate, to: board.businessDate, eventTypes: ['ASSIGN', 'MANUAL_ASSIGN', 'ADJUST'] });
    for (const e of events) if (e.metadata?.needsManagerDecision === true && !events.some((a) => a.eventType === 'ADJUST' && a.technicianId === e.technicianId && a.queueItemId && a.queueItemId === e.queueItemId))
      exceptions.push({ code: 'UNALLOCATED_TURN_CREDIT', severity: 'info', text: `${e.technicianName ?? 'A technician'}'s requested guest is waiting for a manager's turn decision.`, technicianId: e.technicianId });
    const assigns = events.filter((e) => e.eventType !== 'ADJUST'); const manual = assigns.filter((e) => e.eventType === 'MANUAL_ASSIGN').length;
    if (assigns.length >= 5 && manual / assigns.length > 0.2) exceptions.push({ code: 'MANUAL_OVERRIDES_HIGH', severity: 'info', text: `Manual overrides are ${Math.round((manual / assigns.length) * 100)}% of assignments today — the turn rules may need a look.` });
    // §130 daily reset: a past business day still open (the 5-minute sweep normally closes it) — the manager can close it
    const open: any[] = await this.db.selectFrom('technician_turn_state').select(['business_date'] as any).distinct().where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId)
      .where('closed_at', 'is', null).where('business_date', '<', board.businessDate as any).execute().catch(() => []);
    for (const o of open) { const d = o.business_date instanceof Date ? utcDate(o.business_date) : String(o.business_date).slice(0, 10); exceptions.push({ code: 'TURN_DAY_NOT_CLOSED', severity: 'info', text: `The turn day ${d} is still open — close it so tomorrow starts fresh.`, businessDate: d }); }
    const upcoming: any[] = await this.db.selectFrom('pos_tech_appointments').select(['start_time'] as any).where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId).where('appt_date', '=', board.businessDate as any)
      .where('status', 'in', ['confirmed', 'scheduled', 'booked']).execute();
    const soon = upcoming.map((a) => localDateTimeToEpochMs(board.businessDate, String(a.start_time).slice(0, 5), board.timeZone)).filter((t) => t >= nowMs && t <= nowMs + 3_600_000).length;
    return {
      businessDate: board.businessDate, waitingCustomers: waiting.length, readyTechnicians: ready.length, longestCustomerWaitMinutes: longestWait,
      longestTechnicianReadyMinutes: Math.max(0, ...ready.map((t) => t.readyMinutes ?? 0)), techniciansServing: board.technicians.filter((t) => t.column === 'SERVING').length,
      techniciansOnBreak: board.technicians.filter((t) => t.status === 'BREAK').length, upcomingAppointmentsNextHour: soon, exceptions,
    };
  }

  // ── technician summaries (§100–110, §115–119, §171–175) ─────────────────────────────────────────────────────────
  /** One technician's day / week / month (tenant-wide — §147), money from the payroll snapshot store only. */
  async technicianSummary(ctx: TurnQueueContext, technicianId: string, q: { period?: string; date?: string }, opts: { self?: boolean } = {}, nowMs: number = Date.now()) {
    if (!opts.self) this.need(ctx, 'technicians.view');
    this.tech(technicianId);
    const t: any = await this.db.selectFrom('technicians').select(['id', 'full_name', 'branch_id'] as any).where('tenant_id', '=', ctx.tenantId).where('id', '=', technicianId).executeTakeFirst();
    if (!t) throw new TurnQueueError('TECHNICIAN_NOT_ELIGIBLE', 'Unknown technician.');
    const tz = await branchTimeZone(this.db, ctx.tenantId, isUuid(ctx.branchId) ? ctx.branchId : t.branch_id);
    const range = periodRange(q.period, isYmd(q.date) ? q.date : businessDate(tz, new Date(nowMs)));
    const cur = await this.summarize(ctx, technicianId, range, tz, nowMs, opts.self ? true : this.sawMoney(ctx));
    const prev = range.period === 'month' ? await this.summarize(ctx, technicianId, periodRange('month', addDays(range.from, -1)), tz, nowMs, opts.self ? true : this.sawMoney(ctx)) : null;
    return { technicianId, name: t.full_name ?? 'Technician', ...cur, ...(prev ? { previous: prev, trend: trendOf(cur, prev) } : {}) };
  }
  /** The team over a period: the weekly team report / closing report (§171, §173) with the fairness gap. */
  async teamReport(ctx: TurnQueueContext, q: { period?: string; date?: string }, nowMs: number = Date.now()) {
    this.need(ctx, 'turn_queue.history.read');
    const branchId = this.branch(ctx);
    const tz = await branchTimeZone(this.db, ctx.tenantId, branchId);
    const range = periodRange(q.period, isYmd(q.date) ? q.date : businessDate(tz, new Date(nowMs)));
    const money = this.sawMoney(ctx);
    const evTechs: any[] = await this.db.selectFrom('technician_turn_events').select('technician_id').distinct().where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId)
      .where('business_date', '>=', range.from as any).where('business_date', '<=', range.to as any).execute();
    const punchTechs: any[] = await this.db.selectFrom('technician_shifts').select('technician_id').distinct().where('tenant_id', '=', ctx.tenantId).where('branch_id', '=', branchId)
      .where('shift_date', '>=', range.from as any).where('shift_date', '<=', range.to as any).execute();
    const ids = [...new Set([...evTechs, ...punchTechs].map((r) => String(r.technician_id)))];
    const names = await this.techNames(ctx.tenantId, ids);
    const fair = await this.fairness(ctx, { from: range.from, to: range.to > businessDate(tz, new Date(nowMs)) ? businessDate(tz, new Date(nowMs)) : range.to }, nowMs).catch(() => null);
    const rows: any[] = [];
    for (const id of ids) {
      const s = await this.summarize(ctx, id, range, tz, nowMs, money, branchId);
      const f = fair?.rows.find((r) => r.technicianId === id);
      rows.push({ technicianId: id, name: names.get(id)?.name ?? 'Technician', ...s, fairnessGapUnits: f?.gapUnits ?? null, fairnessIndicator: f?.indicatorLabel ?? null,
        turnUnitsPerEligibleHour: s.time.eligibleWorkedMinutes > 0 ? Math.round((s.turns.turnUnits / 100) / (s.time.eligibleWorkedMinutes / 60) * 100) / 100 : null });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));   // §175: alphabetical — never a revenue ranking
    const sum = (f: (r: any) => number) => rows.reduce((a, r) => a + (f(r) || 0), 0);
    return {
      ...range, timeZone: tz, moneyVisible: money, rows,
      totals: { techniciansWorked: rows.filter((r) => r.time.clockedMinutes > 0).length, clockedMinutes: sum((r) => r.time.clockedMinutes), breakMinutes: sum((r) => r.time.paidBreakMinutes + r.time.unpaidBreakMinutes),
        walkIns: sum((r) => r.walkIns.assigned), appointments: sum((r) => r.appointments.scheduled), turnUnits: sum((r) => r.turns.turnUnits), overrides: sum((r) => r.turns.managerOverrides),
        ...(money ? { serviceSalesCents: sum((r) => r.money?.serviceSalesCents), tipsCents: sum((r) => r.money?.tipsCents), commissionCents: sum((r) => r.money?.commissionCents) } : {}),
        fairnessExceptions: fair ? fair.rows.filter((r) => r.indicator !== 'WITHIN_FAIR_RANGE').length : null, overrideRate: fair?.team.overrideRate ?? null },
      methodology: { utilization: 'Service minutes ÷ eligible working minutes (clocked minutes − unpaid break minutes).', opportunityRate: 'Shared walk-in assignments ÷ ready hours.',
        money: 'From the payroll snapshot store (ticket_compensation_snapshots + posted adjustments) — never recalculated with current rates.' },
    };
  }

  private async summarize(ctx: TurnQueueContext, technicianId: string, range: { from: string; to: string; period: 'day' | 'week' | 'month' }, tz: string, nowMs: number, money: boolean, branchId?: string) {
    const startMs = localDateTimeToEpochMs(range.from, '00:00', tz); const endMs = localDateTimeToEpochMs(addDays(range.to, 1), '00:00', tz);
    const capEnd = Math.min(endMs, nowMs);
    // time clock (§37–40, §107): punches + classified breaks (603)
    let pq = this.db.selectFrom('technician_shifts').select(['start_time', 'end_time', 'branch_id'] as any).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
      .where('shift_date', '>=', addDays(range.from, -1) as any).where('shift_date', '<=', range.to as any);
    if (branchId) pq = pq.where('branch_id', '=', branchId);
    const punches: any[] = await pq.execute();
    const clockedMinutes = Math.round(punches.reduce((s, p) => {
      const a = Math.max(Date.parse(iso(p.start_time) ?? ''), startMs); const b = Math.min(p.end_time ? Date.parse(iso(p.end_time)!) : capEnd, capEnd);
      return Number.isFinite(a) && Number.isFinite(b) && b > a ? s + (b - a) / 60000 : s;
    }, 0));
    const breaks: any[] = await this.db.selectFrom('technician_breaks').select(['kind', 'started_at', 'ended_at', 'paid_minutes', 'unpaid_minutes', 'interrupted_at', 'classification'] as any)
      .where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId).where('started_at', '>=', new Date(startMs) as any).where('started_at', '<', new Date(endMs) as any).execute();
    const bp = mergeBreakPolicy(await this.breakPolicyRaw(ctx.tenantId, branchId ?? null));
    let paidBreak = 0; let unpaidBreak = 0; let interrupted = 0;
    for (const b of breaks) {
      const mins = Math.max(0, Math.round(((b.ended_at ? Date.parse(iso(b.ended_at)!) : capEnd) - Date.parse(iso(b.started_at)!)) / 60000));
      const c = b.paid_minutes != null && b.unpaid_minutes != null ? { paidMinutes: Number(b.paid_minutes), unpaidMinutes: Number(b.unpaid_minutes) } : classifyBreak(bp, { kind: b.kind, minutes: mins, interrupted: !!b.interrupted_at });
      paidBreak += c.paidMinutes; unpaidBreak += c.unpaidMinutes; if (b.interrupted_at) interrupted++;
    }
    // turns (§106), service / ready / hold minutes (§107) from the history
    const events = await readTurnEvents(this.db, ctx.tenantId, { technicianId, from: range.from, to: range.to, branchId: branchId ?? null, limit: 5000 });
    const closed = new Set(events.filter((e) => ['CORRECTION', 'DECLINE', 'OFFER_TIMEOUT'].includes(e.eventType)).map((e) => e.assignmentRef).filter(Boolean) as string[]);
    const assigns = events.filter((e) => (e.eventType === 'ASSIGN' || e.eventType === 'MANUAL_ASSIGN') && !closed.has(e.id));
    const credits = events.filter((e) => e.eventType === 'TURN_CREDIT');
    const completedRefs = new Set(credits.map((c) => c.assignmentRef));
    const serviceMinutes = events.filter((e) => e.eventType === 'COMPLETE').reduce((s, e) => s + (Number(e.metadata?.serviceDurationMinutes) || 0), 0);
    const intervals = (statuses: string[]) => { let m = 0; let open: number | null = null;
      for (const e of events) { const t = Date.parse(e.occurredAt); const on = !!e.statusAfter && statuses.includes(e.statusAfter); if (on && open === null) open = t; else if (!on && open !== null) { m += (Math.min(t, capEnd) - Math.max(open, startMs)) / 60000; open = null; } }
      if (open !== null) m += Math.max(0, capEnd - Math.max(open, startMs)) / 60000; return Math.round(m); };
    const readyMinutes = intervals(['READY']); const holdMinutes = intervals(['HOLD']);
    const waits = assigns.map((a) => Number(a.metadata?.readyWaitMinutes)).filter((n) => Number.isFinite(n));
    const walk = assigns.filter((a) => a.assignmentKind === 'walk_in_shared' || a.assignmentKind === 'walk_in_requested');
    // appointments (§104): explicit categories from the appointments table — never one blurred number
    const appts: any[] = await this.db.selectFrom('pos_tech_appointments').select(['status', 'any_technician'] as any).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', technicianId)
      .where('appt_date', '>=', range.from as any).where('appt_date', '<=', range.to as any).execute();
    const st = (xs: string[]) => appts.filter((a) => xs.includes(String(a.status))).length;
    const eligibleWorkedMinutes = Math.max(0, clockedMinutes - unpaidBreak);
    let moneyOut: any = null;
    if (money) {
      const snap = new CompensationSnapshotRepository(this.db);
      const sums = await snap.sumByTechnicianPeriod(ctx.tenantId, technicianId, new Date(startMs).toISOString(), new Date(endMs).toISOString());
      const e = technicianEarningsSummary(sums as any);
      const paid: any = await (this.db as any).selectFrom('payroll_lines as l').innerJoin('payroll_periods as p', 'p.id', 'l.period_id').select([sql<number>`coalesce(sum(case when p.status = 'paid' then l.payable_cents else 0 end), 0)`.as('paid'), sql<number>`coalesce(sum(case when p.status in ('finalized','paid') or p.approved_by is not null then l.payable_cents else 0 end), 0)`.as('approved')])
        .where('l.tenant_id', '=', ctx.tenantId).where('p.tenant_id', '=', ctx.tenantId).where('l.technician_id', '=', technicianId).where('p.period_start', '<=', range.to).where('p.period_end', '>=', range.from).executeTakeFirst().catch(() => null);
      moneyOut = { serviceSalesCents: Number((sums as any).grossServiceCents ?? 0), commissionCents: e.serviceCommissionCents, tipsCents: e.tipsCents, cardTipsCents: e.cardTipCents, cashTipsCents: e.cashTipCents,
        retailCommissionCents: e.retailCommissionCents, adjustmentsCents: e.adjustmentsCents, estimatedEarningsCents: e.estimatedEarningsCents, approvedCents: paid ? Number(paid.approved) : null, paidCents: paid ? Number(paid.paid) : null,
        source: 'payroll_snapshot', status: e.status };
    }
    return {
      period: range.period, from: range.from, to: range.to,
      time: { clockedMinutes, paidBreakMinutes: paidBreak, unpaidBreakMinutes: unpaidBreak, interruptedBreaks: interrupted, eligibleWorkedMinutes, serviceMinutes, readyMinutes, holdMinutes,
        idleMinutes: Math.max(0, eligibleWorkedMinutes - paidBreak - serviceMinutes - readyMinutes - holdMinutes), utilization: eligibleWorkedMinutes > 0 ? Math.round((serviceMinutes / eligibleWorkedMinutes) * 1000) / 1000 : null },
      walkIns: { assigned: walk.length, completed: walk.filter((a) => completedRefs.has(a.id)).length, requested: walk.filter((a) => a.assignmentKind === 'walk_in_requested').length, firstAvailable: walk.filter((a) => a.assignmentKind === 'walk_in_shared').length },
      appointments: { scheduled: appts.length, completed: st(['completed', 'service_done']), canceled: st(['cancelled', 'canceled']), noShow: st(['no_show', 'noshow']), rescheduled: st(['rescheduled']),
        requestedTechnician: appts.filter((a) => a.any_technician !== true).length, anyTechnician: appts.filter((a) => a.any_technician === true).length },
      turns: { turnUnits: credits.reduce((s, c) => s + c.turnUnitsDelta, 0) + events.filter((e) => e.eventType === 'ADJUST').reduce((s, e) => s + e.turnUnitsDelta, 0),
        fullTurns: credits.filter((c) => c.turnUnitsDelta >= 100).length, partialTurns: credits.filter((c) => c.turnUnitsDelta > 0 && c.turnUnitsDelta < 100).length,
        automaticAssignments: assigns.filter((a) => a.assignmentSource === 'auto_assign').length, manualAssignments: assigns.filter((a) => a.assignmentSource !== 'auto_assign').length,
        eligibleSkips: events.filter((e) => e.eventType === 'SKIP').length, voluntaryDeclines: events.filter((e) => e.eventType === 'DECLINE' && e.metadata?.penalized === true).length,
        managerOverrides: assigns.filter((a) => a.eventType === 'MANUAL_ASSIGN').length, averageReadyWaitMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null,
        queueOpportunityRate: readyMinutes > 0 ? Math.round((walk.filter((a) => a.assignmentKind === 'walk_in_shared').length / (readyMinutes / 60)) * 100) / 100 : null },
      branches: [...new Set(events.map((e) => e.branchId))],
      money: moneyOut,
    };
  }
  private async breakPolicyRaw(tenantId: string, branchId: string | null): Promise<{ salon: unknown; branch: unknown }> {
    const rows: any[] = await this.db.selectFrom('time_clock_break_policies').select(['branch_id', 'policy'] as any).where('tenant_id', '=', tenantId).execute().catch(() => []);
    return { salon: rows.find((r) => !r.branch_id)?.policy ?? null, branch: branchId ? rows.find((r) => r.branch_id === branchId)?.policy ?? null : null };
  }

  // ── the Technician App (§94–96, §188): the signed-in technician only ─────────────────────────────────────────────
  private async me(ctx: TurnQueueContext): Promise<string> {
    if (!ctx?.tenantId || !isUuid(ctx.userId)) throw new TurnQueueForbiddenError('Not authenticated');
    const t: any = await this.db.selectFrom('technicians').select(['id'] as any).where('tenant_id', '=', ctx.tenantId).where('user_id', '=', ctx.userId).where('is_active', '=', true).executeTakeFirst();
    if (!t) throw new TurnQueueForbiddenError('No technician profile is linked to this account.');
    const app: any = await this.db.selectFrom('technician_app_settings').select(['app_enabled'] as any).where('tenant_id', '=', ctx.tenantId).where('technician_id', '=', t.id).executeTakeFirst().catch(() => null);
    if (app && app.app_enabled === false) throw new TurnQueueForbiddenError('The Technician App has been turned off for your account. Please see a manager.');
    return String(t.id);
  }
  async myView(ctx: TurnQueueContext, nowMs: number = Date.now()) { return this.technicianView(ctx, await this.me(ctx), nowMs); }
  async mySummary(ctx: TurnQueueContext, q: { period?: string; date?: string }, nowMs: number = Date.now()) { return this.technicianSummary(ctx, await this.me(ctx), q, { self: true }, nowMs); }

  // ── the Technician App view (§94–96) ─────────────────────────────────────────────────────────────────────────────
  async technicianView(ctx: TurnQueueContext, technicianId: string, nowMs: number = Date.now()) {
    const branchId = this.branch(ctx);
    const board = await this.board({ ...ctx, permissions: [...(ctx.permissions ?? []).filter((p) => !MONEY_PERMS.includes(p)), 'turn_queue.read'] }, nowMs);
    const c = await loadTurnContext(this.db, ctx.tenantId, branchId);
    const order = board.technicians.filter((t) => t.rank != null).map((t) => ({ technicianId: t.technicianId, name: t.name, rank: t.rank!, status: t.status }));
    const view = techQueueView(c.policy, order, technicianId);
    const me = board.technicians.find((t) => t.technicianId === technicianId) ?? null;
    const today = await this.summarize(ctx, technicianId, { from: board.businessDate, to: board.businessDate, period: 'day' }, board.timeZone, nowMs, true);
    return {
      businessDate: board.businessDate, ...view,
      me: me ? { status: me.status, rank: me.rank, turnsToday: me.turnUnitsToday / 100, inProgressTurns: me.inProgressUnits / 100, walkInsToday: me.walkInsToday, appointmentsToday: me.appointmentsToday,
        nextAppointmentAt: me.nextAppointmentAt, currentCustomer: me.currentService, readySince: me.readySince, onBreakSince: me.onBreakSince, holdReason: me.holdReason } : null,
      myEarningsToday: today.money,   // her own money only (§95)
      fetchedAt: new Date(nowMs).toISOString(),
    };
  }
}

function serviceLabel(raw: unknown): string {
  const xs = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  return Array.isArray(xs) ? xs.map((x: any) => x?.serviceName).filter(Boolean).join(' + ') || 'Service' : 'Service';
}
export function periodRange(period: string | undefined, date: string): { period: 'day' | 'week' | 'month'; from: string; to: string } {
  if (period === 'week') { const dow = new Date(date + 'T00:00:00Z').getUTCDay(); const from = addDays(date, -((dow + 6) % 7)); return { period: 'week', from, to: addDays(from, 6) }; }
  if (period === 'month') { const from = date.slice(0, 8) + '01'; const next = utcDate(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1))); return { period: 'month', from, to: addDays(next, -1) }; }
  return { period: 'day', from: date, to: date };
}
function trendOf(cur: any, prev: any) {
  const d = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : a - b);
  return { clockedMinutes: d(cur.time.clockedMinutes, prev.time.clockedMinutes), serviceMinutes: d(cur.time.serviceMinutes, prev.time.serviceMinutes), turnUnits: d(cur.turns.turnUnits, prev.turns.turnUnits),
    walkIns: d(cur.walkIns.assigned, prev.walkIns.assigned), appointments: d(cur.appointments.scheduled, prev.appointments.scheduled),
    serviceSalesCents: d(cur.money?.serviceSalesCents, prev.money?.serviceSalesCents), tipsCents: d(cur.money?.tipsCents, prev.money?.tipsCents) };
}
function publicEvent(e: TurnEventRow) {
  return { id: e.id, businessDate: e.businessDate, sequenceNumber: e.sequenceNumber, technicianId: e.technicianId, technicianName: e.technicianName, eventType: e.eventType, statusBefore: e.statusBefore, statusAfter: e.statusAfter,
    queueItemId: e.queueItemId, appointmentId: e.appointmentId, serviceId: e.serviceId, turnUnits: e.turnUnits, turnUnitsDelta: e.turnUnitsDelta, turnRuleId: e.turnRuleId, turnRuleVersion: e.turnRuleVersion,
    reasonCode: e.reasonCode, reasonText: e.reasonText, assignmentSource: e.assignmentSource, assignmentKind: e.assignmentKind, recommendedTechnicianId: e.recommendedTechnicianId,
    positionBefore: e.positionBefore, positionAfter: e.positionAfter, policyVersion: e.policyVersion, actorType: e.actorType, actorId: e.actorId, occurredAt: e.occurredAt,
    orderBefore: Array.isArray(e.metadata?.orderBefore) ? e.metadata.orderBefore : null, orderAfter: Array.isArray(e.metadata?.orderAfter) ? e.metadata.orderAfter : null };
}
