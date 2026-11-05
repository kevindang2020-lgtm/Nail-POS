// turn-ledger.ts — THE ONE writer of the technician turn queue (technician_turn_state + technician_turn_events, 602).
//
// Every command runs INSIDE the caller's transaction when it is handed one (the queue assignment, the workforce clock /
// break CAS, the Service Done transition, the offer decline / expiry) — so the assignment, the technician's turn state,
// the append-only turn event and the outbox event commit or roll back TOGETHER (mandate §82–83, §98, §187). Handed a
// plain Kysely instance it opens its own transaction (the manager actions: hold, reorder, adjust, day close).
//
// Per branch, writes are serialised by a transaction-scoped advisory lock (a salon floor has dozens of technicians, not
// millions — correctness and atomicity first, §183); the per-branch-day sequence_number is therefore gap-free and the
// day can be replayed exactly (§208). The business day is the BRANCH's local day (§126). Rules live in turn-core.ts.
import { sql, type Kysely, type Transaction } from 'kysely';
import { branchTimeZone, type DB } from '@aipowersalon/database';
import { businessDate, addDays, utcDate } from '@aipowersalon/date-time';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import {
  mergeTurnPolicy, isFairnessMode, rotationOrder, positionAfterAssignment, joinPlacement, breakReturn, unitsForAssignment, assignmentKindOf,
  resolveVisitUnits, declineConsequence, offerTimeoutConsequence, effectiveUnits, TurnQueueError, FULL_TURN, DECLINE_REASONS,
  type TurnPolicy, type FairnessMode, type AssignmentMode, type TurnStateLike, type TurnStatus, type TurnEventType, type TurnUnitRule,
  type TurnServiceInput, type AssignmentKind, type SkipReason,
} from './turn-core';

export type TurnDb = Kysely<DB> | Transaction<DB>;
export interface TurnActor { userId?: string | null; type?: 'user' | 'system' | 'technician' }
export interface TurnLedgerOptions { outbox?: OutboxWriter | null; nowMs?: number }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const actorId = (a?: TurnActor | null): string | null => (a?.userId && isUuid(a.userId) ? a.userId : null);
const actorType = (a?: TurnActor | null): 'user' | 'system' | 'technician' => a?.type ?? (actorId(a) ? 'user' : 'system');

/** Legacy rotation policies map to the nearest fairness mode for the turn book-keeping (the engine still scores them). */
export function fairnessModeOf(rotationPolicy: string | null | undefined): FairnessMode {
  if (isFairnessMode(rotationPolicy)) return rotationPolicy;
  switch (rotationPolicy) {
    case 'hybrid': return 'hybrid_fairness';
    case 'least_minutes': return 'workload_balanced';
    case 'least_customers': case 'first_available': return 'lowest_turn_units';
    case 'fixed_order': return 'manual_order';
    default: return 'traditional_weighted_rotation';
  }
}

async function inTrx<T>(db: TurnDb, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  if ((db as any).isTransaction) return fn(db as Transaction<DB>);
  return (db as Kysely<DB>).transaction().execute(fn);
}

// ── policy (read from the ONE settings source, migration 600) ─────────────────────────────────────────────────────
export interface TurnContext { policy: TurnPolicy; mode: FairnessMode; rotationPolicy: string; assignmentMode: AssignmentMode; policyVersion: string; autoEnabled: boolean }
export async function loadTurnContext(db: TurnDb, tenantId: string, branchId: string | null): Promise<TurnContext> {
  const t: any = await db.selectFrom('queue_assignment_tenant_settings').select(['rotation_policy', 'assignment_mode', 'turn_policy', 'version', 'auto_enabled'])
    .where('tenant_id', '=', tenantId).executeTakeFirst();
  const b: any = branchId ? await db.selectFrom('queue_assignment_settings').select(['assignment_mode', 'turn_policy', 'version', 'auto_enabled'])
    .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).executeTakeFirst() : undefined;
  const r: any = branchId ? await db.selectFrom('queue_assignment_rotation_state').select(['policy'])
    .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).executeTakeFirst() : undefined;
  const rotationPolicy = String(r?.policy ?? t?.rotation_policy ?? 'traditional_weighted_rotation');
  const parse = (v: unknown) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);
  const assignmentMode = (b?.assignment_mode ?? t?.assignment_mode ?? 'RECOMMEND_AND_CONFIRM') as AssignmentMode;
  return {
    policy: mergeTurnPolicy(parse(t?.turn_policy), parse(b?.turn_policy)), mode: fairnessModeOf(rotationPolicy), rotationPolicy, assignmentMode,
    policyVersion: `${t ? Number(t.version) : 0}.${b ? Number(b.version) : 0}`, autoEnabled: !!(b?.auto_enabled ?? t?.auto_enabled),
  };
}

// ── rows ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TurnStateRow extends TurnStateLike {
  id: string; tenantId: string; branchId: string; businessDate: string; version: number; breakStartedAt: string | null; joinedAt: string | null;
  closedAt: string | null; lastEligibleOpportunityAt: string | null; policyVersion: string | null; eligibleSkipCount: number; consecutiveAuto: number;
}
function toRow(r: any): TurnStateRow {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), branchId: String(r.branch_id), businessDate: String(r.business_date instanceof Date ? utcDate(r.business_date) : r.business_date).slice(0, 10),
    technicianId: String(r.technician_id), name: r.full_name ?? null, status: String(r.status) as TurnStatus, inRotation: !!r.in_rotation,
    rotationPosition: Number(r.rotation_position), accumulatedUnits: Number(r.accumulated_units), provisionalUnits: Number(r.provisional_units),
    pendingUnits: Number(r.pending_units), baselineUnits: Number(r.baseline_units), specialUnits: Number(r.special_units), serviceMinutes: Number(r.service_minutes),
    baselineMinutes: Number(r.baseline_minutes), readySince: iso(r.ready_since), lastAssignmentAt: iso(r.last_assignment_at), lastEligibleOpportunityAt: iso(r.last_eligible_opportunity_at),
    eligibleSkipCount: Number(r.eligible_skip_count), consecutiveAuto: Number(r.consecutive_auto), holdReason: r.hold_reason ?? null, breakStartedAt: iso(r.break_started_at),
    joinedAt: iso(r.joined_at), closedAt: iso(r.closed_at), policyVersion: r.policy_version ?? null, version: Number(r.version),
  };
}
const STATE_COLS = ['id', 'tenant_id', 'branch_id', 'business_date', 'technician_id', 'status', 'in_rotation', 'rotation_position', 'accumulated_units', 'provisional_units',
  'pending_units', 'baseline_units', 'special_units', 'service_minutes', 'baseline_minutes', 'ready_since', 'last_assignment_at', 'last_eligible_opportunity_at',
  'eligible_skip_count', 'consecutive_auto', 'hold_reason', 'break_started_at', 'joined_at', 'closed_at', 'policy_version', 'version'] as const;

interface Day { tenantId: string; branchId: string; date: string; tz: string; nowMs: number; ctx: TurnContext; rows: TurnStateRow[]; trx: Transaction<DB>; opts: TurnLedgerOptions; touched: Map<string, TurnEventType> }

async function openDay(trx: Transaction<DB>, tenantId: string, branchId: string, opts: TurnLedgerOptions): Promise<Day> {
  if (!isUuid(tenantId) || !isUuid(branchId)) throw new TurnQueueError('TURN_QUEUE_NOT_CONFIGURED', 'The turn queue belongs to one location — choose a location first.');
  await sql`select pg_advisory_xact_lock(hashtextextended(${'turnq:' + tenantId + ':' + branchId}, 0))`.execute(trx);
  const nowMs = opts.nowMs ?? Date.now();
  const tz = await branchTimeZone(trx, tenantId, branchId, nowMs);
  const date = businessDate(tz, new Date(nowMs));
  const ctx = await loadTurnContext(trx, tenantId, branchId);
  const rows = (await trx.selectFrom('technician_turn_state').select([...STATE_COLS] as any)
    .where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).where('business_date', '=', date as any).execute()).map(toRow);
  return { tenantId, branchId, date, tz, nowMs, ctx, rows, trx, opts, touched: new Map() };
}

async function appendEvent(d: Day, e: {
  technicianId: string; eventType: TurnEventType; statusBefore?: string | null; statusAfter?: string | null; queueItemId?: string | null; appointmentId?: string | null;
  ticketId?: string | null; serviceId?: string | null; assignmentRef?: string | null; turnUnits?: number; turnUnitsDelta?: number; turnRuleId?: string | null; turnRuleVersion?: number | null;
  reasonCode?: string | null; reasonText?: string | null; assignmentSource?: string | null; assignmentKind?: string | null; recommendedTechnicianId?: string | null;
  positionBefore?: number | null; positionAfter?: number | null; actor?: TurnActor | null; idempotencyKey?: string | null; metadata?: Record<string, unknown>;
}): Promise<{ id: string; sequenceNumber: number }> {
  const seq: any = await d.trx.selectFrom('technician_turn_events').select(sql<number>`coalesce(max(sequence_number), 0) + 1`.as('n'))
    .where('tenant_id', '=', d.tenantId).where('branch_id', '=', d.branchId).where('business_date', '=', d.date as any).executeTakeFirst();
  const sequenceNumber = Number(seq?.n ?? 1);
  const row: any = await d.trx.insertInto('technician_turn_events').values({
    tenant_id: d.tenantId, branch_id: d.branchId, business_date: d.date, sequence_number: sequenceNumber, technician_id: e.technicianId, event_type: e.eventType,
    status_before: e.statusBefore ?? null, status_after: e.statusAfter ?? null, queue_item_id: isUuid(e.queueItemId) ? e.queueItemId : null,
    appointment_id: isUuid(e.appointmentId) ? e.appointmentId : null, ticket_id: isUuid(e.ticketId) ? e.ticketId : null, service_id: isUuid(e.serviceId) ? e.serviceId : null,
    assignment_ref: e.assignmentRef ?? null, turn_units: Math.round(e.turnUnits ?? 0), turn_units_delta: Math.round(e.turnUnitsDelta ?? 0),
    turn_rule_id: e.turnRuleId ?? null, turn_rule_version: e.turnRuleVersion ?? null, reason_code: e.reasonCode ?? null, reason_text: e.reasonText ? String(e.reasonText).slice(0, 500) : null,
    assignment_source: e.assignmentSource ?? null, assignment_kind: e.assignmentKind ?? null, recommended_technician_id: isUuid(e.recommendedTechnicianId) ? e.recommendedTechnicianId : null,
    position_before: e.positionBefore ?? null, position_after: e.positionAfter ?? null, policy_version: d.ctx.policyVersion, actor_id: actorId(e.actor), actor_type: actorType(e.actor),
    idempotency_key: e.idempotencyKey ?? null, occurred_at: new Date(d.nowMs), metadata: JSON.stringify(e.metadata ?? {}),
  } as any).returning(['id']).executeTakeFirst();
  d.touched.set(e.technicianId, e.eventType);
  return { id: String(row.id), sequenceNumber };
}

async function saveRow(d: Day, row: TurnStateRow, patch: Partial<Record<string, unknown>>, actor?: TurnActor | null): Promise<TurnStateRow> {
  const upd: any = await d.trx.updateTable('technician_turn_state').set({ ...patch, policy_version: d.ctx.policyVersion, version: sql`version + 1`, updated_at: new Date(d.nowMs), updated_by: actorId(actor) } as any)
    .where('tenant_id', '=', d.tenantId).where('id', '=', row.id).where('version', '=', row.version).returning([...STATE_COLS] as any).executeTakeFirst();
  if (!upd) throw new TurnQueueError('QUEUE_VERSION_CONFLICT');   // cannot happen under the branch lock; never silently lost
  const next = toRow(upd); next.name = row.name;
  d.rows = d.rows.map((r) => (r.id === next.id ? next : r));
  return next;
}

async function insertRow(d: Day, technicianId: string, init: { status: TurnStatus; inRotation: boolean; position: number; baselineUnits?: number; baselineMinutes?: number; holdReason?: string | null; readySince?: string | null }, actor?: TurnActor | null): Promise<TurnStateRow> {
  const r: any = await d.trx.insertInto('technician_turn_state').values({
    tenant_id: d.tenantId, branch_id: d.branchId, business_date: d.date, technician_id: technicianId, status: init.status, in_rotation: init.inRotation,
    rotation_position: init.position, baseline_units: init.baselineUnits ?? 0, baseline_minutes: init.baselineMinutes ?? 0, hold_reason: init.holdReason ?? null,
    ready_since: init.readySince ? new Date(init.readySince) : null, joined_at: init.inRotation ? new Date(d.nowMs) : null, policy_version: d.ctx.policyVersion,
    created_at: new Date(d.nowMs), updated_at: new Date(d.nowMs), updated_by: actorId(actor),
  } as any).returning([...STATE_COLS] as any).executeTakeFirst();
  const row = toRow(r); d.rows.push(row); return row;
}

const nowIso = (d: Day) => new Date(d.nowMs).toISOString();
const rowOf = (d: Day, technicianId: string) => d.rows.find((r) => r.technicianId === technicianId) ?? null;

/** Did anyone receive a guest at this branch today? (before that, the start-of-day order applies) */
async function dayStarted(d: Day): Promise<boolean> {
  const r = await d.trx.selectFrom('technician_turn_events').select('id').where('tenant_id', '=', d.tenantId).where('branch_id', '=', d.branchId)
    .where('business_date', '=', d.date as any).where('event_type', 'in', ['ASSIGN', 'MANUAL_ASSIGN']).limit(1).executeTakeFirst();
  return !!r;
}

/** The start-of-day / carry-over inputs a join needs (only read when the policy uses them). */
async function joinInputs(d: Day, technicianId: string): Promise<{ dayStarted: boolean; scheduleStartMinutes: number | null; previousRank: number | null; carryoverUnits: number }> {
  const started = await dayStarted(d);
  let scheduleStartMinutes: number | null = null; let previousRank: number | null = null; let carryoverUnits = 0;
  const p = d.ctx.policy;
  if (!started && p.startOfDayOrder === 'SCHEDULE_ORDER') {
    const dow = new Date(d.date + 'T00:00:00Z').getUTCDay();
    const s: any = await d.trx.selectFrom('technician_schedules').select(sql<string>`start_time::text`.as('s')).where('tenant_id', '=', d.tenantId)
      .where('technician_id', '=', technicianId).where('day_of_week', '=', dow).executeTakeFirst().catch(() => undefined);
    const m = /^(\d{1,2}):(\d{2})/.exec(String(s?.s ?? '')); if (m) scheduleStartMinutes = Number(m[1]) * 60 + Number(m[2]);
  }
  if ((!started && p.startOfDayOrder === 'PREVIOUS_ROTATION_CARRYOVER') || p.dailyFairnessCarryover !== 'NONE') {
    const prev = (await d.trx.selectFrom('technician_turn_state').select([...STATE_COLS] as any).where('tenant_id', '=', d.tenantId).where('branch_id', '=', d.branchId)
      .where('business_date', '=', addDays(d.date, -1) as any).execute()).map(toRow);
    if (prev.length) {
      const order = rotationOrder(d.ctx.mode, p, prev.map((r) => ({ ...r, inRotation: true, status: 'READY' as const, readySince: null })), d.nowMs);
      const at = order.findIndex((o) => o.technicianId === technicianId); if (at >= 0) previousRank = at + 1;
      const me = prev.find((r) => r.technicianId === technicianId);
      if (me) { const min = Math.min(...prev.map((r) => r.accumulatedUnits)); carryoverUnits = Math.max(0, me.accumulatedUnits - min); }
    }
  }
  return { dayStarted: started, scheduleStartMinutes, previousRank, carryoverUnits };
}

/** A technician the floor never saw today gets a row (she joins at the back) — history is never missing a JOIN. */
async function ensureRow(d: Day, technicianId: string, reason: string, actor?: TurnActor | null, status: TurnStatus = 'READY'): Promise<TurnStateRow> {
  const have = rowOf(d, technicianId); if (have) return have;
  const place = joinPlacement(d.ctx.mode, d.ctx.policy, technicianId, d.rows, await joinInputs(d, technicianId));
  const row = await insertRow(d, technicianId, { status, inRotation: true, position: place.position, baselineUnits: place.baselineUnits, baselineMinutes: place.baselineMinutes, readySince: status === 'READY' ? nowIso(d) : null }, actor);
  await appendEvent(d, { technicianId, eventType: 'JOIN', statusBefore: null, statusAfter: status, positionAfter: place.position, reasonCode: reason, actor, metadata: { basis: place.basis, baselineUnits: place.baselineUnits } });
  return row;
}

/** §146: a technician takes part only in the branch where she is clocked in / in the rotation today. */
async function assertBranchParticipation(d: Day, technicianId: string): Promise<void> {
  const other: any = await d.trx.selectFrom('technician_turn_state').select(['branch_id']).where('tenant_id', '=', d.tenantId).where('technician_id', '=', technicianId)
    .where('business_date', '=', d.date as any).where('branch_id', '<>', d.branchId).where('status', 'not in', ['CLOCKED_OUT']).where('closed_at', 'is', null).executeTakeFirst();
  if (other) throw new TurnQueueError('TECHNICIAN_NOT_ELIGIBLE', 'This technician is working at another location today.');
}

async function announce(d: Day, kind: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (!d.opts.outbox || !d.touched.size) return;
  await d.opts.outbox.write(d.trx, createDomainEvent({
    eventType: DOMAIN_EVENTS.TECHNICIAN_TURN_QUEUE_CHANGED, tenantId: d.tenantId, branchId: d.branchId, aggregateType: 'technician_turn_queue', aggregateId: d.branchId, actorType: 'system',
    payload: { branchId: d.branchId, businessDate: d.date, kind, technicians: [...d.touched].map(([technicianId, eventType]) => ({ technicianId, eventType })), ...extra },
  }));
}

export interface TurnCommandResult { businessDate: string; technicianIds: string[]; events: string[] }
const result = (d: Day, events: string[] = []): TurnCommandResult => ({ businessDate: d.date, technicianIds: [...d.touched.keys()], events });

// ── clock / break (called inside the workforce CAS transaction) ───────────────────────────────────────────────────
/** §27–29: clock-in joins the rotation (autoJoinRotationOnClockIn) at the policy's join position. */
export async function turnClockIn(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; actor?: TurnActor | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    await assertBranchParticipation(d, a.technicianId).catch(() => undefined);   // a clock-in is the participation; never refused here
    const cur = rowOf(d, a.technicianId);
    const join = d.ctx.policy.autoJoinRotationOnClockIn;
    if (cur && cur.inRotation && cur.status !== 'CLOCKED_OUT') return result(d);   // idempotent re-sync
    const place = joinPlacement(d.ctx.mode, d.ctx.policy, a.technicianId, d.rows, await joinInputs(d, a.technicianId));
    if (!join) {
      if (cur) await saveRow(d, cur, { status: 'CLOCKED_IN', in_rotation: false, ready_since: null }, a.actor);
      else await insertRow(d, a.technicianId, { status: 'CLOCKED_IN', inRotation: false, position: place.position }, a.actor);
      return result(d);
    }
    const before = cur?.status ?? null;
    const patch = { status: place.status, in_rotation: true, rotation_position: place.position, baseline_units: place.baselineUnits, baseline_minutes: place.baselineMinutes,
      ready_since: place.status === 'READY' ? new Date(d.nowMs) : null, hold_reason: place.holdReason, joined_at: new Date(d.nowMs) };
    if (cur) await saveRow(d, cur, patch, a.actor);
    else await insertRow(d, a.technicianId, { status: place.status, inRotation: true, position: place.position, baselineUnits: place.baselineUnits, baselineMinutes: place.baselineMinutes, holdReason: place.holdReason, readySince: place.status === 'READY' ? nowIso(d) : null }, a.actor);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'JOIN', statusBefore: before, statusAfter: place.status, positionBefore: cur?.rotationPosition ?? null, positionAfter: place.position,
      reasonCode: 'CLOCK_IN', actor: a.actor, metadata: { basis: place.basis, baselineUnits: place.baselineUnits, holdReason: place.holdReason } });
    await announce(d, 'clock_in');
    return result(d, [ev.id]);
  });
}
/** §30, §129, §205: clock-out ends eligibility immediately and keeps the day's history, turns and earnings. */
export async function turnClockOut(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; actor?: TurnActor | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const cur = rowOf(d, a.technicianId);
    if (!cur || cur.status === 'CLOCKED_OUT') return result(d);
    await saveRow(d, cur, { status: 'CLOCKED_OUT', in_rotation: false, ready_since: null, hold_reason: null, break_started_at: null }, a.actor);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'CLOCK_OUT', statusBefore: cur.status, statusAfter: 'CLOCKED_OUT', positionBefore: cur.rotationPosition, actor: a.actor,
      metadata: { accumulatedUnits: cur.accumulatedUnits, provisionalUnits: cur.provisionalUnits } });
    await announce(d, 'clock_out');
    return result(d, [ev.id]);
  });
}
/** §32: a time-clock break pauses queue eligibility; the position is kept until the return decides (§33–34). */
export async function turnBreakStart(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; actor?: TurnActor | null; kind?: string | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const cur = rowOf(d, a.technicianId) ?? await ensureRow(d, a.technicianId, 'IMPLICIT_ON_BREAK', a.actor);
    if (cur.status === 'BREAK') return result(d);
    await saveRow(d, cur, { status: 'BREAK', ready_since: null, break_started_at: new Date(d.nowMs) }, a.actor);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'BREAK_START', statusBefore: cur.status, statusAfter: 'BREAK', positionBefore: cur.rotationPosition, positionAfter: cur.rotationPosition, actor: a.actor, metadata: { kind: a.kind ?? 'break' } });
    await announce(d, 'break_start');
    return result(d, [ev.id]);
  });
}
export async function turnBreakEnd(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; actor?: TurnActor | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const cur = rowOf(d, a.technicianId);
    if (!cur || cur.status !== 'BREAK') return result(d);
    const startedMs = cur.breakStartedAt ? Date.parse(cur.breakStartedAt) : d.nowMs;
    const breakMinutes = Math.max(0, Math.round((d.nowMs - startedMs) / 60000));
    const back = breakReturn(d.ctx.mode, d.ctx.policy, cur, breakMinutes, d.rows);
    await saveRow(d, cur, { status: back.status, rotation_position: back.position, hold_reason: back.holdReason, break_started_at: null, ready_since: back.status === 'READY' ? new Date(d.nowMs) : null }, a.actor);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'BREAK_END', statusBefore: 'BREAK', statusAfter: back.status, positionBefore: cur.rotationPosition, positionAfter: back.position,
      reasonCode: back.holdReason, actor: a.actor, metadata: { breakMinutes, basis: back.basis, policy: d.ctx.policy.breakPositionPolicy } });
    await announce(d, 'break_end');
    return result(d, [ev.id]);
  });
}

// ── manager hold / release / reorder / adjust / join (§31, §71–73, §143) ──────────────────────────────────────────
export async function turnHold(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; reason: string; actor: TurnActor }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const cur = rowOf(d, a.technicianId);
    if (!cur || !cur.inRotation || cur.status === 'CLOCKED_OUT') throw new TurnQueueError('TECHNICIAN_NOT_CLOCKED_IN');
    if (cur.status === 'HOLD') return result(d);
    await saveRow(d, cur, { status: 'HOLD', hold_reason: 'MANAGER_HOLD', ready_since: null }, a.actor);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'HOLD', statusBefore: cur.status, statusAfter: 'HOLD', positionBefore: cur.rotationPosition, positionAfter: cur.rotationPosition, reasonCode: 'MANAGER_HOLD', reasonText: a.reason, actor: a.actor });
    await announce(d, 'hold');
    return result(d, [ev.id]);
  });
}
export async function turnRelease(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; reason?: string | null; actor: TurnActor; toBack?: boolean }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const cur = rowOf(d, a.technicianId);
    if (!cur || cur.status !== 'HOLD') throw new TurnQueueError('TECHNICIAN_NOT_READY', 'This technician is not on hold.');
    const position = a.toBack ? Math.max(0, ...d.rows.filter((r) => r.inRotation && r.technicianId !== cur.technicianId).map((r) => r.rotationPosition)) + 1 : cur.rotationPosition;
    await saveRow(d, cur, { status: 'READY', hold_reason: null, rotation_position: position, ready_since: new Date(d.nowMs) }, a.actor);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'RELEASE', statusBefore: 'HOLD', statusAfter: 'READY', positionBefore: cur.rotationPosition, positionAfter: position, reasonCode: cur.holdReason, reasonText: a.reason ?? null, actor: a.actor });
    await announce(d, 'release');
    return result(d, [ev.id]);
  });
}
/** §71–72: move a technician (set next / before another / to the back / to an index). Changes FUTURE rotation only. */
export async function turnReorder(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; placement: { setNext?: boolean; beforeTechnicianId?: string; toBack?: boolean; toIndex?: number }; reason: string; actor: TurnActor; expectedVersion?: number }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult & { order: string[] }> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const cur = rowOf(d, a.technicianId);
    if (!cur || !cur.inRotation) throw new TurnQueueError('TECHNICIAN_NOT_CLOCKED_IN', 'This technician is not in today’s rotation.');
    if (typeof a.expectedVersion === 'number' && a.expectedVersion !== cur.version) throw new TurnQueueError('QUEUE_VERSION_CONFLICT');
    const others = d.rows.filter((r) => r.inRotation && r.technicianId !== cur.technicianId).sort((x, y) => x.rotationPosition - y.rotationPosition || x.technicianId.localeCompare(y.technicianId));
    let position: number;
    if (a.placement.toBack) position = (others.length ? others[others.length - 1].rotationPosition : 0) + 1;
    else {
      let idx = a.placement.setNext ? 0 : typeof a.placement.toIndex === 'number' ? Math.max(0, Math.min(others.length, Math.floor(a.placement.toIndex))) : -1;
      if (a.placement.beforeTechnicianId) idx = others.findIndex((o) => o.technicianId === a.placement.beforeTechnicianId);
      if (idx < 0) throw new TurnQueueError('TECHNICIAN_NOT_ELIGIBLE', 'Choose where to place the technician.');
      const after = idx > 0 ? others[idx - 1].rotationPosition : (others[0]?.rotationPosition ?? 1) - 1;
      const before = others[idx]?.rotationPosition;
      position = before === undefined ? after + 1 : Math.round(((after + before) / 2) * 10000) / 10000;
    }
    const orderBefore = rotationOrder(d.ctx.mode, d.ctx.policy, d.rows, d.nowMs).map((o) => o.technicianId);
    const released = cur.status === 'HOLD' && cur.holdReason === 'AWAITING_MANAGER_POSITION';
    const saved = await saveRow(d, cur, { rotation_position: position, ...(released ? { status: 'READY', hold_reason: null, ready_since: new Date(d.nowMs) } : {}),
      // in a unit mode, "set next" also levels the turn burden so the order really changes (the units themselves are never rewritten)
      ...(a.placement.setNext && d.ctx.mode !== 'traditional_weighted_rotation' && d.ctx.mode !== 'manual_order'
        ? { baseline_units: Math.min(0, ...others.map((o) => effectiveUnits(o) - effectiveUnits({ ...cur, baselineUnits: 0 }))) - 1 } : {}) }, a.actor);
    const orderAfter = rotationOrder(d.ctx.mode, d.ctx.policy, d.rows, d.nowMs).map((o) => o.technicianId);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'REORDER', statusBefore: cur.status, statusAfter: saved.status, positionBefore: cur.rotationPosition, positionAfter: position,
      reasonText: a.reason, actor: a.actor, metadata: { placement: a.placement, orderBefore, orderAfter, released } });
    await announce(d, 'reorder');
    return { ...result(d, [ev.id]), order: orderAfter };
  });
}
/** §73: a manager's turn-credit correction (+0.5 / −0.5 …) — reason + permission + audit; history is never rewritten. */
export async function turnAdjust(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; deltaUnits: number; reason: string; actor: TurnActor; queueItemId?: string | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    if (!Number.isInteger(a.deltaUnits) || a.deltaUnits === 0 || Math.abs(a.deltaUnits) > 500) throw new TurnQueueError('TURN_POLICY_INVALID', 'An adjustment is a whole number of hundredths of a turn, up to ±5 turns, and not zero.');
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const cur = rowOf(d, a.technicianId) ?? await ensureRow(d, a.technicianId, 'IMPLICIT_ON_ADJUST', a.actor, 'CLOCKED_IN');
    await saveRow(d, cur, { accumulated_units: cur.accumulatedUnits + a.deltaUnits }, a.actor);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'ADJUST', statusBefore: cur.status, statusAfter: cur.status, turnUnitsDelta: a.deltaUnits, reasonText: a.reason,
      queueItemId: a.queueItemId ?? null, actor: a.actor, metadata: { accumulatedBefore: cur.accumulatedUnits, accumulatedAfter: cur.accumulatedUnits + a.deltaUnits } });
    await announce(d, 'adjust');
    return result(d, [ev.id]);
  });
}
/** Manual join (a technician who is clocked in but not in the rotation, or a manager re-adding someone). */
export async function turnJoin(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; actor: TurnActor; reason?: string | null; reasonCode?: string | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    await assertBranchParticipation(d, a.technicianId);
    const cur = rowOf(d, a.technicianId);
    if (cur?.inRotation && cur.status !== 'CLOCKED_OUT') return result(d);
    const place = joinPlacement(d.ctx.mode, d.ctx.policy, a.technicianId, d.rows, await joinInputs(d, a.technicianId));
    if (cur) await saveRow(d, cur, { status: place.status, in_rotation: true, rotation_position: place.position, baseline_units: place.baselineUnits, baseline_minutes: place.baselineMinutes, hold_reason: place.holdReason, ready_since: place.status === 'READY' ? new Date(d.nowMs) : null, joined_at: new Date(d.nowMs) }, a.actor);
    else await insertRow(d, a.technicianId, { status: place.status, inRotation: true, position: place.position, baselineUnits: place.baselineUnits, baselineMinutes: place.baselineMinutes, holdReason: place.holdReason, readySince: place.status === 'READY' ? nowIso(d) : null }, a.actor);
    const ev = await appendEvent(d, { technicianId: a.technicianId, eventType: 'JOIN', statusBefore: cur?.status ?? null, statusAfter: place.status, positionAfter: place.position, reasonCode: a.reasonCode ?? 'MANUAL_JOIN', reasonText: a.reason ?? null, actor: a.actor, metadata: { basis: place.basis } });
    await announce(d, 'join');
    return result(d, [ev.id]);
  });
}

// ── assignment (inside the queue's assignment transaction) ────────────────────────────────────────────────────────
export interface TurnAssignInput {
  tenantId: string; branchId: string; technicianId: string; queueItemId?: string | null; appointmentId?: string | null; ticketId?: string | null;
  /** the services this technician takes (one line of a multi-technician visit, or the whole visit). Omitted → read from the queue item. */
  services?: TurnServiceInput[] | null;
  /** auto_assign | ai_suggestion | staff | implicit */
  source: string;
  /** the Fair Turn Engine's pick when one was made (a different assignee = MANUAL_ASSIGN) */
  recommendedTechnicianId?: string | null;
  overrideReasonCode?: string | null; reasonText?: string | null;
  /** technicians eligible + ready for this guest at decision time (fairness analytics pool, §53–54) */
  eligiblePool?: string[] | null;
  /** technicians ranked ahead of the assignee who were passed over, with the reason (§67) */
  skips?: { technicianId: string; reason: SkipReason }[] | null;
  idempotencyKey?: string | null; actor?: TurnActor | null;
  /** per-line visits: the line's service id (one event per line) */
  lineServiceId?: string | null;
}
export interface TurnAssignResult extends TurnCommandResult { assignEventId: string | null; units: number; kind: AssignmentKind; manual: boolean; needsManagerDecision: boolean }

async function visitFacts(trx: Transaction<DB>, tenantId: string, queueItemId: string | null | undefined): Promise<{ isAppointment: boolean; appointmentId: string | null; anyTechnician: boolean | null; requestedTechnicianId: string | null; services: TurnServiceInput[] }> {
  if (!isUuid(queueItemId)) return { isAppointment: false, appointmentId: null, anyTechnician: null, requestedTechnicianId: null, services: [] };
  const q: any = await trx.selectFrom('pos_queue_items').select(['source', 'appointment_id', 'requested_technician_id', 'requested_services']).where('tenant_id', '=', tenantId).where('id', '=', queueItemId).executeTakeFirst();
  if (!q) return { isAppointment: false, appointmentId: null, anyTechnician: null, requestedTechnicianId: null, services: [] };
  const appointmentId = isUuid(q.appointment_id) ? q.appointment_id : null;
  let anyTechnician: boolean | null = null;
  if (appointmentId) { const ap: any = await trx.selectFrom('pos_tech_appointments').select(['any_technician']).where('tenant_id', '=', tenantId).where('id', '=', appointmentId).executeTakeFirst(); anyTechnician = ap?.any_technician ?? null; }
  const raw = typeof q.requested_services === 'string' ? (() => { try { return JSON.parse(q.requested_services); } catch { return []; } })() : (q.requested_services ?? []);
  const services = await servicesWithCategory(trx, tenantId, (Array.isArray(raw) ? raw : []).filter((s: any) => !s?.isAddon && s?.status !== 'cancelled').map((s: any) => ({ serviceId: s?.serviceId ?? null, durationMinutes: Number(s?.estimatedDurationMinutes ?? s?.durationMinutes ?? 0) })));
  return { isAppointment: !!appointmentId || String(q.source) === 'appointment', appointmentId, anyTechnician, requestedTechnicianId: q.requested_technician_id ?? null, services };
}
async function servicesWithCategory(trx: Transaction<DB>, tenantId: string, svcs: { serviceId: string | null; durationMinutes: number }[]): Promise<TurnServiceInput[]> {
  const ids = [...new Set(svcs.map((s) => s.serviceId).filter(isUuid))];
  const cats: any[] = ids.length ? await trx.selectFrom('services as s').leftJoin('service_categories as c', 'c.id', 's.category_id').select(['s.id as id', 'c.name as category', 's.duration_minutes as dur'])
    .where('s.tenant_id', '=', tenantId).where('s.id', 'in', ids).execute() : [];
  const by = new Map(cats.map((c) => [String(c.id), c]));
  return svcs.map((s) => { const c = s.serviceId ? by.get(s.serviceId) : undefined; return { serviceId: s.serviceId, category: c?.category ?? null, durationMinutes: s.durationMinutes || Number(c?.dur ?? 0) }; });
}
export async function loadTurnRules(db: TurnDb, tenantId: string): Promise<TurnUnitRule[]> {
  const rows: any[] = await db.selectFrom('turn_unit_rules').select(['id', 'rule_key', 'version', 'scope', 'service_id', 'category', 'max_duration_minutes', 'turn_units', 'special_rotation'])
    .where('tenant_id', '=', tenantId).where('active', '=', true).execute();
  return rows.map((r) => ({ id: String(r.id), ruleKey: String(r.rule_key), version: Number(r.version), scope: r.scope, serviceId: r.service_id ?? null, category: r.category ?? null,
    maxDurationMinutes: r.max_duration_minutes == null ? null : Number(r.max_duration_minutes), turnUnits: Number(r.turn_units), specialRotation: !!r.special_rotation }));
}

/**
 * §45, §79–84: record an assignment's turn effect — the units snapshot (rule id + version), the kind (walk-in shared /
 * requested / appointment), MANUAL_ASSIGN when staff chose someone other than the engine's pick (reason required by the
 * caller's policy), the SKIP rows for everyone the engine passed over (position preserved), the position move and the
 * max-consecutive counter. Idempotent by key (a retried assignment writes nothing twice).
 */
export async function turnAssign(db: TurnDb, a: TurnAssignInput, opts: TurnLedgerOptions = {}): Promise<TurnAssignResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    if (a.idempotencyKey) {
      const prior: any = await trx.selectFrom('technician_turn_events').select(['id', 'turn_units', 'assignment_kind', 'event_type']).where('tenant_id', '=', a.tenantId).where('idempotency_key', '=', a.idempotencyKey).executeTakeFirst();
      if (prior) return { ...result(d), assignEventId: String(prior.id), units: Number(prior.turn_units), kind: prior.assignment_kind, manual: prior.event_type === 'MANUAL_ASSIGN', needsManagerDecision: false };
    }
    // the same technician already holds an open assignment for this guest (a double click / a plan re-write) → nothing new
    if (isUuid(a.queueItemId)) {
      const open = await openAssignments(trx, a.tenantId, { queueItemId: a.queueItemId, technicianId: a.technicianId, lineServiceId: a.lineServiceId ?? null });
      if (open.length) return { ...result(d), assignEventId: open[0].id, units: open[0].units, kind: open[0].kind as AssignmentKind, manual: false, needsManagerDecision: false };
    }
    await assertBranchParticipation(d, a.technicianId);
    const facts = await visitFacts(trx, a.tenantId, a.queueItemId);
    const services = a.services ? await servicesWithCategory(trx, a.tenantId, a.services.map((s) => ({ serviceId: s.serviceId, durationMinutes: s.durationMinutes }))) : facts.services;
    const resolved = resolveVisitUnits(services, await loadTurnRules(trx, a.tenantId), d.ctx.policy.defaultTurnUnits);
    const kind = assignmentKindOf({ isAppointment: facts.isAppointment, requestedTechnicianId: facts.requestedTechnicianId, technicianId: a.technicianId, appointmentAnyTechnician: facts.anyTechnician });
    const manual = !!a.recommendedTechnicianId && a.recommendedTechnicianId !== a.technicianId && a.source !== 'auto_assign';
    const consumed = unitsForAssignment(kind, resolved.units, d.ctx.policy, { manualOverride: manual });
    const special = d.ctx.policy.specialRotationEnabled && resolved.special;
    const me = await ensureRow(d, a.technicianId, 'IMPLICIT_ON_ASSIGNMENT', a.actor);
    const readyWait = me.status === 'READY' && me.readySince ? Math.max(0, Math.round((d.nowMs - Date.parse(me.readySince)) / 60000)) : null;
    const move = special ? { position: me.rotationPosition, pending: me.pendingUnits, moved: 'none' as const } : positionAfterAssignment(d.ctx.mode, d.ctx.policy, me, consumed.units, d.rows);
    const orderBefore = rotationOrder(d.ctx.mode, d.ctx.policy, d.rows, d.nowMs).map((o) => o.technicianId);
    const auto = a.source === 'auto_assign';
    await saveRow(d, me, {
      status: 'ASSIGNED', ready_since: null, last_assignment_at: new Date(d.nowMs), last_eligible_opportunity_at: new Date(d.nowMs),
      provisional_units: special ? me.provisionalUnits : me.provisionalUnits + consumed.units, special_units: special ? me.specialUnits + consumed.units : me.specialUnits,
      rotation_position: move.position, pending_units: move.pending, consecutive_auto: auto ? me.consecutiveAuto + 1 : 0, hold_reason: null,
    }, a.actor);
    // the max-consecutive counter belongs to the technician on a streak: anyone else receiving a guest breaks it
    for (const o of d.rows.filter((r) => r.technicianId !== a.technicianId && r.consecutiveAuto > 0)) await saveRow(d, o, { consecutive_auto: 0 }, a.actor);
    const perService = resolved.perService;
    const ev = await appendEvent(d, {
      technicianId: a.technicianId, eventType: manual ? 'MANUAL_ASSIGN' : 'ASSIGN', statusBefore: me.status, statusAfter: 'ASSIGNED', queueItemId: a.queueItemId ?? null,
      appointmentId: a.appointmentId ?? facts.appointmentId, ticketId: a.ticketId ?? null, serviceId: a.lineServiceId ?? (perService.length === 1 ? perService[0].serviceId : null),
      turnUnits: consumed.units, turnRuleId: perService.length === 1 ? perService[0].ruleId : null, turnRuleVersion: perService.length === 1 ? perService[0].ruleVersion : null,
      reasonCode: manual ? (a.overrideReasonCode ?? 'MANAGER_DECISION') : null, reasonText: a.reasonText ?? null, assignmentSource: a.source, assignmentKind: kind,
      recommendedTechnicianId: a.recommendedTechnicianId ?? null, positionBefore: me.rotationPosition, positionAfter: move.position, actor: a.actor, idempotencyKey: a.idempotencyKey ?? null,
      metadata: { why: consumed.why, needsManagerDecision: consumed.needsManagerDecision, special, perService, readyWaitMinutes: readyWait, moved: move.moved, pendingBefore: me.pendingUnits, pendingAfter: move.pending,
        eligiblePool: a.eligiblePool ?? d.rows.filter((r) => r.status === 'READY' || r.technicianId === a.technicianId).map((r) => r.technicianId),
        lineServiceId: a.lineServiceId ?? null, orderBefore, orderAfter: rotationOrder(d.ctx.mode, d.ctx.policy, d.rows, d.nowMs).map((o) => o.technicianId) },
    });
    // §67: everyone the engine passed over keeps her position; the reason is recorded
    for (const s of (a.skips ?? []).filter((x) => x.technicianId !== a.technicianId)) {
      const row = rowOf(d, s.technicianId);
      if (row) await saveRow(d, row, { eligible_skip_count: row.eligibleSkipCount + 1 }, a.actor);
      await appendEvent(d, { technicianId: s.technicianId, eventType: 'SKIP', statusBefore: row?.status ?? null, statusAfter: row?.status ?? null, queueItemId: a.queueItemId ?? null,
        reasonCode: s.reason, positionBefore: row?.rotationPosition ?? null, positionAfter: row?.rotationPosition ?? null, assignmentRef: ev.id, actor: a.actor, metadata: { assignedTechnicianId: a.technicianId } });
    }
    await announce(d, manual ? 'manual_assign' : 'assign', { queueItemId: a.queueItemId ?? null });
    return { ...result(d, [ev.id]), assignEventId: ev.id, units: consumed.units, kind, manual, needsManagerDecision: consumed.needsManagerDecision };
  });
}

interface OpenAssignment { id: string; technicianId: string; units: number; kind: string | null; special: boolean; positionBefore: number | null; positionAfter: number | null; pendingBefore: number | null; branchId: string; businessDate: string; lineServiceId: string | null; queueItemId: string | null; occurredAt: string }
/** ASSIGN / MANUAL_ASSIGN events not yet closed by a TURN_CREDIT / CORRECTION / DECLINE / OFFER_TIMEOUT. */
export async function openAssignments(db: TurnDb, tenantId: string, f: { queueItemId?: string | null; queueItemIds?: string[]; technicianId?: string | null; technicianIds?: string[]; ticketId?: string | null; lineServiceId?: string | null }): Promise<OpenAssignment[]> {
  let q = db.selectFrom('technician_turn_events as e').select(['e.id', 'e.technician_id', 'e.turn_units', 'e.assignment_kind', 'e.position_before', 'e.position_after', 'e.metadata', 'e.branch_id', 'e.business_date', 'e.queue_item_id', 'e.occurred_at'] as any)
    .where('e.tenant_id', '=', tenantId).where('e.event_type', 'in', ['ASSIGN', 'MANUAL_ASSIGN'])
    .where(({ not, exists, selectFrom }: any) => not(exists(selectFrom('technician_turn_events as x').select('x.id').where('x.tenant_id', '=', tenantId).whereRef('x.assignment_ref', '=', 'e.id')
      .where('x.event_type', 'in', ['TURN_CREDIT', 'CORRECTION', 'DECLINE', 'OFFER_TIMEOUT']))));
  const qids = [...(f.queueItemIds ?? []), ...(f.queueItemId ? [f.queueItemId] : [])].filter(isUuid);
  if (qids.length || isUuid(f.ticketId)) q = q.where((eb: any) => eb.or([...(qids.length ? [eb('e.queue_item_id', 'in', qids)] : []), ...(isUuid(f.ticketId) ? [eb('e.ticket_id', '=', f.ticketId)] : [])]));
  else return [];
  const tids = [...(f.technicianIds ?? []), ...(f.technicianId ? [f.technicianId] : [])].filter(isUuid);
  if (tids.length) q = q.where('e.technician_id', 'in', tids);
  const rows: any[] = await q.orderBy('e.occurred_at', 'asc').execute();
  return rows.map((r) => {
    const m = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata ?? {});
    return { id: String(r.id), technicianId: String(r.technician_id), units: Number(r.turn_units), kind: r.assignment_kind ?? null, special: !!m.special, positionBefore: r.position_before == null ? null : Number(r.position_before),
      positionAfter: r.position_after == null ? null : Number(r.position_after), pendingBefore: typeof m.pendingBefore === 'number' ? m.pendingBefore : null, branchId: String(r.branch_id), businessDate: String(r.business_date instanceof Date ? r.business_date.toISOString() : r.business_date).slice(0, 10),
      lineServiceId: m.lineServiceId ?? null, queueItemId: r.queue_item_id ?? null, occurredAt: iso(r.occurred_at)! };
  }).filter((o) => !f.lineServiceId || !o.lineServiceId || o.lineServiceId === f.lineServiceId);
}

/** Give back an open assignment's provisional turn (and its position when it was the last move) — never a delete. */
async function reverseAssignment(d: Day, o: OpenAssignment, eventType: 'CORRECTION' | 'DECLINE' | 'OFFER_TIMEOUT', extra: { reasonCode?: string | null; reasonText?: string | null; actor?: TurnActor | null; metadata?: Record<string, unknown>; statusAfter?: TurnStatus; position?: number | null; chargeUnits?: number }): Promise<string> {
  const row = rowOf(d, o.technicianId) ?? await ensureRow(d, o.technicianId, 'IMPLICIT_ON_CORRECTION', extra.actor, 'READY');
  const untouched = o.positionAfter != null && o.positionBefore != null && row.rotationPosition === o.positionAfter && o.businessDate === d.date;
  const restorePosition = extra.position ?? (untouched ? o.positionBefore! : row.rotationPosition);
  const status: TurnStatus = extra.statusAfter ?? (row.status === 'ASSIGNED' ? 'READY' : row.status);
  const charge = extra.chargeUnits ?? 0;
  await saveRow(d, row, {
    provisional_units: o.special ? row.provisionalUnits : Math.max(0, row.provisionalUnits - (o.businessDate === d.date ? o.units : 0)),
    special_units: o.special ? Math.max(0, row.specialUnits - o.units) : row.specialUnits, rotation_position: restorePosition, status,
    ...(untouched && extra.position == null && o.pendingBefore != null ? { pending_units: o.pendingBefore } : {}),
    accumulated_units: row.accumulatedUnits + charge, ready_since: status === 'READY' ? new Date(d.nowMs) : null, hold_reason: status === 'HOLD' ? (extra.reasonCode ?? 'MANAGER_REVIEW') : null,
  }, extra.actor);
  const ev = await appendEvent(d, { technicianId: o.technicianId, eventType, statusBefore: row.status, statusAfter: status, queueItemId: o.queueItemId, assignmentRef: o.id,
    turnUnits: o.units, turnUnitsDelta: charge, reasonCode: extra.reasonCode ?? null, reasonText: extra.reasonText ?? null, positionBefore: row.rotationPosition, positionAfter: restorePosition,
    actor: extra.actor, metadata: { ...(extra.metadata ?? {}), returnedUnits: o.units } });
  return ev.id;
}

/** §134: an assignment undone before service (unassign / reassignment / guest left) — CORRECTION, turn returned. */
export async function turnUnassign(db: TurnDb, a: { tenantId: string; branchId: string; queueItemId: string; technicianId?: string | null; reason?: string | null; actor?: TurnActor | null; lineServiceId?: string | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const open = await openAssignments(trx, a.tenantId, { queueItemId: a.queueItemId, technicianId: a.technicianId ?? null, lineServiceId: a.lineServiceId ?? null });
    const ids: string[] = [];
    for (const o of open) ids.push(await reverseAssignment(d, o, 'CORRECTION', { reasonCode: 'UNASSIGNED', reasonText: a.reason ?? null, actor: a.actor }));
    if (ids.length) await announce(d, 'correction', { queueItemId: a.queueItemId });
    return result(d, ids);
  });
}

/** §64–66: the technician declined an offered guest — the provisional turn comes back, then the policy consequence. */
export async function turnDecline(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; queueItemId?: string | null; ticketId?: string | null; reasonCode?: string | null; reasonText?: string | null; actor?: TurnActor | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult & { penalized: boolean }> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const reason = a.reasonCode && DECLINE_REASONS.includes(a.reasonCode) ? a.reasonCode : 'OTHER';
    const c = declineConsequence(d.ctx.policy, reason);
    const open = await openAssignments(trx, a.tenantId, { queueItemId: a.queueItemId ?? null, ticketId: a.ticketId ?? null, technicianId: a.technicianId });
    const row = rowOf(d, a.technicianId);
    const back = c.action === 'MOVE_TO_BACK' ? Math.max(0, ...d.rows.filter((r) => r.inRotation && r.technicianId !== a.technicianId).map((r) => r.rotationPosition)) + 1 : null;
    const meta = { consequence: c.action, penalized: c.penalized, basis: c.basis, policy: d.ctx.policy.technicianDeclinePolicy };
    const ids: string[] = [];
    if (open.length) {
      for (const [i, o] of open.entries()) ids.push(await reverseAssignment(d, o, 'DECLINE', { reasonCode: reason, reasonText: a.reasonText ?? null, actor: a.actor, metadata: meta,
        statusAfter: c.action === 'HOLD' ? 'HOLD' : undefined, position: back, chargeUnits: i === 0 ? c.chargeUnits : 0 }));
    } else if (row) {
      await saveRow(d, row, { accumulated_units: row.accumulatedUnits + c.chargeUnits, ...(back != null ? { rotation_position: back } : {}), ...(c.action === 'HOLD' ? { status: 'HOLD', hold_reason: reason, ready_since: null } : {}) }, a.actor);
      ids.push((await appendEvent(d, { technicianId: a.technicianId, eventType: 'DECLINE', statusBefore: row.status, statusAfter: c.action === 'HOLD' ? 'HOLD' : row.status, queueItemId: a.queueItemId ?? null, ticketId: a.ticketId ?? null,
        turnUnitsDelta: c.chargeUnits, reasonCode: reason, reasonText: a.reasonText ?? null, positionBefore: row.rotationPosition, positionAfter: back ?? row.rotationPosition, actor: a.actor, metadata: meta })).id);
    }
    if (ids.length) await announce(d, 'decline');
    return { ...result(d, ids), penalized: c.penalized };
  });
}
/** §152–153: an unanswered offer expired — the turn comes back; the salon's timeout consequence applies. */
export async function turnOfferTimeout(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; queueItemId?: string | null; ticketId?: string | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const c = offerTimeoutConsequence(d.ctx.policy);
    const open = await openAssignments(trx, a.tenantId, { queueItemId: a.queueItemId ?? null, ticketId: a.ticketId ?? null, technicianId: a.technicianId });
    const back = c.action === 'MOVE_TO_BACK' ? Math.max(0, ...d.rows.filter((r) => r.inRotation && r.technicianId !== a.technicianId).map((r) => r.rotationPosition)) + 1 : null;
    const ids: string[] = [];
    for (const o of open) ids.push(await reverseAssignment(d, o, 'OFFER_TIMEOUT', { reasonCode: 'OFFER_TIMEOUT', actor: { type: 'system' }, statusAfter: c.action === 'HOLD' ? 'HOLD' : undefined, position: back, metadata: { consequence: c.action, basis: c.basis } }));
    if (!open.length) {
      const row = rowOf(d, a.technicianId);
      if (row) ids.push((await appendEvent(d, { technicianId: a.technicianId, eventType: 'OFFER_TIMEOUT', statusBefore: row.status, statusAfter: row.status, queueItemId: a.queueItemId ?? null, ticketId: a.ticketId ?? null, reasonCode: 'OFFER_TIMEOUT', actor: { type: 'system' }, metadata: { consequence: c.action, noOpenAssignment: true } })).id);
    }
    if (ids.length) await announce(d, 'offer_timeout');
    return result(d, ids);
  });
}
/** §62: the guest does not want this technician — logged, never her refusal, never a lost turn. */
export async function turnCustomerDeclined(db: TurnDb, a: { tenantId: string; branchId: string; technicianId: string; queueItemId: string; reasonText?: string | null; actor: TurnActor }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const row = rowOf(d, a.technicianId);
    const open = await openAssignments(trx, a.tenantId, { queueItemId: a.queueItemId, technicianId: a.technicianId });
    const ids: string[] = [];
    for (const o of open) ids.push(await reverseAssignment(d, o, 'CORRECTION', { reasonCode: 'CUSTOMER_DECLINED', reasonText: a.reasonText ?? null, actor: a.actor }));
    ids.push((await appendEvent(d, { technicianId: a.technicianId, eventType: 'CUSTOMER_DECLINED', statusBefore: row?.status ?? null, statusAfter: rowOf(d, a.technicianId)?.status ?? row?.status ?? null,
      queueItemId: a.queueItemId, reasonCode: 'CUSTOMER_DECLINED', reasonText: a.reasonText ?? null, positionBefore: row?.rotationPosition ?? null, positionAfter: rowOf(d, a.technicianId)?.rotationPosition ?? null, actor: a.actor, metadata: { penalized: false } })).id);
    await announce(d, 'customer_declined', { queueItemId: a.queueItemId });
    return result(d, ids);
  });
}
/** Technicians this guest declined (the engine treats them as ineligible for THIS guest only). */
export async function declinedTechniciansFor(db: TurnDb, tenantId: string, queueItemId: string): Promise<string[]> {
  if (!isUuid(queueItemId)) return [];
  const rows: any[] = await db.selectFrom('technician_turn_events').select(['technician_id']).where('tenant_id', '=', tenantId).where('queue_item_id', '=', queueItemId).where('event_type', '=', 'CUSTOMER_DECLINED').execute();
  return [...new Set(rows.map((r) => String(r.technician_id)))];
}

// ── service start / Service Done (§86–88) ─────────────────────────────────────────────────────────────────────────
export async function turnServiceStart(db: TurnDb, a: { tenantId: string; branchId: string; technicianIds: string[]; queueItemId?: string | null; ticketId?: string | null; actor?: TurnActor | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const ids: string[] = [];
    for (const tid of [...new Set(a.technicianIds.filter(isUuid))]) {
      const row = rowOf(d, tid) ?? await ensureRow(d, tid, 'IMPLICIT_ON_START', a.actor, 'ASSIGNED');
      if (row.status === 'SERVING') continue;
      await saveRow(d, row, { status: 'SERVING', ready_since: null }, a.actor);
      ids.push((await appendEvent(d, { technicianId: tid, eventType: 'START', statusBefore: row.status, statusAfter: 'SERVING', queueItemId: a.queueItemId ?? null, ticketId: a.ticketId ?? null, actor: a.actor, metadata: { actualServiceStartAt: nowIso(d) } })).id);
    }
    if (ids.length) await announce(d, 'service_start');
    return result(d, ids);
  });
}
/**
 * §87–88: Service Done — COMPLETE + TURN_CREDIT (the snapshot units of each open assignment become credited) and the
 * technician returns to READY (back of the line already happened at assignment in traditional rotation) unless a break,
 * hold or clock-out took precedence. A visit that never went through an assignment (an appointment checked in already
 * assigned) is credited by policy here, with an implicit ASSIGN so the history stays complete.
 */
export async function turnServiceComplete(db: TurnDb, a: { tenantId: string; branchId: string; technicianIds: string[]; queueItemIds: string[]; ticketId?: string | null; startedAt?: string | null; actor?: TurnActor | null }, opts: TurnLedgerOptions = {}): Promise<TurnCommandResult> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    const techs = [...new Set(a.technicianIds.filter(isUuid))];
    const ids: string[] = [];
    let open = await openAssignments(trx, a.tenantId, { queueItemIds: a.queueItemIds, ticketId: a.ticketId ?? null, technicianIds: techs });
    // implicit assignment: a technician who serves the visit with no open assignment on record
    for (const tid of techs.filter((t) => !open.some((o) => o.technicianId === t))) {
      const qid = a.queueItemIds.find(isUuid) ?? null;
      const done: any = qid ? await trx.selectFrom('technician_turn_events').select('id').where('tenant_id', '=', a.tenantId).where('queue_item_id', '=', qid).where('technician_id', '=', tid).where('event_type', '=', 'TURN_CREDIT').executeTakeFirst() : null;
      if (done) continue;   // already credited (a duplicate Service Done)
      const r = await turnAssign(trx, { tenantId: a.tenantId, branchId: a.branchId, technicianId: tid, queueItemId: qid, ticketId: a.ticketId ?? null, source: 'implicit', actor: a.actor }, { ...opts, outbox: null });
      d.rows = (await openDay(trx, a.tenantId, a.branchId, opts)).rows;
      if (r.assignEventId) ids.push(r.assignEventId);
    }
    open = await openAssignments(trx, a.tenantId, { queueItemIds: a.queueItemIds, ticketId: a.ticketId ?? null, technicianIds: techs });
    const startedMs = a.startedAt ? Date.parse(a.startedAt) : NaN;
    for (const tid of techs) {
      const mine = open.filter((o) => o.technicianId === tid);
      const row = rowOf(d, tid) ?? await ensureRow(d, tid, 'IMPLICIT_ON_COMPLETE', a.actor, 'SERVING');
      const minutes = Number.isFinite(startedMs) ? Math.max(0, Math.round((d.nowMs - startedMs) / 60000)) : 0;
      const credit = mine.filter((o) => !o.special).reduce((s, o) => s + o.units, 0);
      const sameDayProvisional = mine.filter((o) => !o.special && o.businessDate === d.date).reduce((s, o) => s + o.units, 0);
      const keep = row.status === 'BREAK' || row.status === 'HOLD' || row.status === 'CLOCKED_OUT';
      const next: TurnStatus = keep ? row.status : (row.inRotation ? 'READY' : 'CLOCKED_IN');
      await saveRow(d, row, { status: next, ready_since: next === 'READY' ? new Date(d.nowMs) : null, accumulated_units: row.accumulatedUnits + credit,
        provisional_units: Math.max(0, row.provisionalUnits - sameDayProvisional), service_minutes: row.serviceMinutes + minutes }, a.actor);
      ids.push((await appendEvent(d, { technicianId: tid, eventType: 'COMPLETE', statusBefore: row.status, statusAfter: next, queueItemId: a.queueItemIds.find(isUuid) ?? null, ticketId: a.ticketId ?? null,
        actor: a.actor, metadata: { actualServiceEndAt: nowIso(d), serviceDurationMinutes: minutes, turnUnitsEarned: credit } })).id);
      for (const o of mine) ids.push((await appendEvent(d, { technicianId: tid, eventType: 'TURN_CREDIT', statusBefore: next, statusAfter: next, queueItemId: o.queueItemId, ticketId: a.ticketId ?? null,
        assignmentRef: o.id, turnUnits: o.units, turnUnitsDelta: o.special ? 0 : o.units, assignmentKind: o.kind, actor: a.actor, metadata: { special: o.special } })).id);
    }
    if (ids.length) await announce(d, 'service_complete');
    return result(d, ids);
  });
}

// ── day close (§125) ──────────────────────────────────────────────────────────────────────────────────────────────
/** Close a branch's business day: a DAY_CLOSE event per technician with the day's summary; rows stay (history). */
export async function turnCloseDay(db: TurnDb, a: { tenantId: string; branchId: string; businessDate: string; actor?: TurnActor | null }, opts: TurnLedgerOptions = {}): Promise<{ closed: number }> {
  return inTrx(db, async (trx) => {
    const d = await openDay(trx, a.tenantId, a.branchId, opts);
    if (a.businessDate >= d.date) throw new TurnQueueError('TURN_POLICY_INVALID', 'Only a finished business day can be closed.');
    const rows = (await trx.selectFrom('technician_turn_state').select([...STATE_COLS] as any).where('tenant_id', '=', a.tenantId).where('branch_id', '=', a.branchId)
      .where('business_date', '=', a.businessDate as any).where('closed_at', 'is', null).execute()).map(toRow);
    const day: Day = { ...d, date: a.businessDate, rows };
    for (const r of rows) {
      await day.trx.updateTable('technician_turn_state').set({ closed_at: new Date(d.nowMs), version: sql`version + 1`, updated_at: new Date(d.nowMs), updated_by: actorId(a.actor) } as any)
        .where('tenant_id', '=', a.tenantId).where('id', '=', r.id).execute();
      await appendEvent(day, { technicianId: r.technicianId, eventType: 'DAY_CLOSE', statusBefore: r.status, statusAfter: r.status, positionBefore: r.rotationPosition, actor: a.actor ?? { type: 'system' },
        metadata: { accumulatedUnits: r.accumulatedUnits, provisionalUnits: r.provisionalUnits, specialUnits: r.specialUnits, serviceMinutes: r.serviceMinutes, skips: r.eligibleSkipCount } });
    }
    if (rows.length) await announce(day, 'day_close');
    return { closed: rows.length };
  });
}
/** Branches with a finished, unclosed day (the day-close sweep). Platform-wide by design — the job is the only caller. */
export async function unclosedPastDays(db: TurnDb, nowMs: number = Date.now()): Promise<{ tenantId: string; branchId: string; businessDate: string }[]> {
  const rows: any[] = await (db as any).selectFrom('technician_turn_state').select(['tenant_id', 'branch_id', 'business_date']).where('closed_at', 'is', null)
    .where('business_date', '<', addDays(utcDate(new Date(nowMs)), 2) as any)   // coarse prefilter; each branch's own day decides below
    .groupBy(['tenant_id', 'branch_id', 'business_date']).execute();
  const out: { tenantId: string; branchId: string; businessDate: string }[] = [];
  for (const r of rows) {
    const tz = await branchTimeZone(db, String(r.tenant_id), String(r.branch_id), nowMs);
    const date = String(r.business_date instanceof Date ? utcDate(r.business_date) : r.business_date).slice(0, 10);
    if (date < businessDate(tz, new Date(nowMs))) out.push({ tenantId: String(r.tenant_id), branchId: String(r.branch_id), businessDate: date });
  }
  return out;
}

// ── reads ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function readTurnDay(db: TurnDb, tenantId: string, branchId: string, nowMs: number = Date.now()): Promise<{ businessDate: string; timeZone: string; rows: TurnStateRow[]; ctx: TurnContext }> {
  const tz = await branchTimeZone(db, tenantId, branchId, nowMs);
  const date = businessDate(tz, new Date(nowMs));
  const rows: any[] = await db.selectFrom('technician_turn_state as s').leftJoin('technicians as t', (j) => j.onRef('t.id', '=', 's.technician_id').onRef('t.tenant_id', '=', 's.tenant_id'))
    .select([...STATE_COLS.map((c) => `s.${c}`), 't.full_name'] as any).where('s.tenant_id', '=', tenantId).where('s.branch_id', '=', branchId).where('s.business_date', '=', date as any).execute();
  return { businessDate: date, timeZone: tz, rows: rows.map(toRow), ctx: await loadTurnContext(db, tenantId, branchId) };
}
export interface TurnEventRow {
  id: string; branchId: string; businessDate: string; sequenceNumber: number; technicianId: string; technicianName: string | null; eventType: string; statusBefore: string | null; statusAfter: string | null;
  queueItemId: string | null; appointmentId: string | null; ticketId: string | null; serviceId: string | null; assignmentRef: string | null; turnUnits: number; turnUnitsDelta: number;
  turnRuleId: string | null; turnRuleVersion: number | null; reasonCode: string | null; reasonText: string | null; assignmentSource: string | null; assignmentKind: string | null;
  recommendedTechnicianId: string | null; positionBefore: number | null; positionAfter: number | null; policyVersion: string | null; actorId: string | null; actorType: string; occurredAt: string; metadata: Record<string, unknown>;
}
export async function readTurnEvents(db: TurnDb, tenantId: string, f: { branchId?: string | null; from?: string; to?: string; technicianId?: string | null; queueItemId?: string | null; eventTypes?: string[]; reasonCode?: string | null; assignmentSource?: string | null; customerId?: string | null; limit?: number }): Promise<TurnEventRow[]> {
  let q = db.selectFrom('technician_turn_events as e').leftJoin('technicians as t', (j) => j.onRef('t.id', '=', 'e.technician_id').onRef('t.tenant_id', '=', 'e.tenant_id'))
    .select(['e.id', 'e.branch_id', 'e.business_date', 'e.sequence_number', 'e.technician_id', 't.full_name', 'e.event_type', 'e.status_before', 'e.status_after', 'e.queue_item_id', 'e.appointment_id',
      'e.ticket_id', 'e.service_id', 'e.assignment_ref', 'e.turn_units', 'e.turn_units_delta', 'e.turn_rule_id', 'e.turn_rule_version', 'e.reason_code', 'e.reason_text', 'e.assignment_source',
      'e.assignment_kind', 'e.recommended_technician_id', 'e.position_before', 'e.position_after', 'e.policy_version', 'e.actor_id', 'e.actor_type', 'e.occurred_at', 'e.metadata'] as any)
    .where('e.tenant_id', '=', tenantId);
  if (f.branchId) q = q.where('e.branch_id', '=', f.branchId);
  if (f.from) q = q.where('e.business_date', '>=', f.from as any);
  if (f.to) q = q.where('e.business_date', '<=', f.to as any);
  if (f.technicianId) q = q.where('e.technician_id', '=', f.technicianId);
  if (f.queueItemId) q = q.where('e.queue_item_id', '=', f.queueItemId);
  if (f.eventTypes?.length) q = q.where('e.event_type', 'in', f.eventTypes);
  if (f.reasonCode) q = q.where('e.reason_code', '=', f.reasonCode);
  if (f.assignmentSource) q = q.where('e.assignment_source', '=', f.assignmentSource);
  if (f.customerId) q = q.where('e.queue_item_id', 'in', db.selectFrom('pos_queue_items').select('id').where('tenant_id', '=', tenantId).where('customer_id', '=', f.customerId) as any);
  const rows: any[] = await q.orderBy('e.business_date', 'asc').orderBy('e.sequence_number', 'asc').limit(Math.min(5000, Math.max(1, f.limit ?? 2000))).execute();
  return rows.map((r) => ({
    id: String(r.id), branchId: String(r.branch_id), businessDate: String(r.business_date instanceof Date ? r.business_date.toISOString() : r.business_date).slice(0, 10), sequenceNumber: Number(r.sequence_number),
    technicianId: String(r.technician_id), technicianName: r.full_name ?? null, eventType: String(r.event_type), statusBefore: r.status_before ?? null, statusAfter: r.status_after ?? null,
    queueItemId: r.queue_item_id ?? null, appointmentId: r.appointment_id ?? null, ticketId: r.ticket_id ?? null, serviceId: r.service_id ?? null, assignmentRef: r.assignment_ref ?? null,
    turnUnits: Number(r.turn_units), turnUnitsDelta: Number(r.turn_units_delta), turnRuleId: r.turn_rule_id ?? null, turnRuleVersion: r.turn_rule_version == null ? null : Number(r.turn_rule_version),
    reasonCode: r.reason_code ?? null, reasonText: r.reason_text ?? null, assignmentSource: r.assignment_source ?? null, assignmentKind: r.assignment_kind ?? null,
    recommendedTechnicianId: r.recommended_technician_id ?? null, positionBefore: r.position_before == null ? null : Number(r.position_before), positionAfter: r.position_after == null ? null : Number(r.position_after),
    policyVersion: r.policy_version ?? null, actorId: r.actor_id ?? null, actorType: String(r.actor_type), occurredAt: iso(r.occurred_at)!,
    metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata ?? {}),
  }));
}
export { FULL_TURN };

// ── the workforce seam (§177): clock / break / availability moves of technician_workforce_state ───────────────────
/**
 * Called by the workforce CAS INSIDE its transaction (KyselyWorkforceStateStore.cas): clock-in joins, clock-out leaves,
 * a break pauses, the manager's "not taking customers" flag is a queue HOLD (never a payroll break, §31). Tolerant by
 * design — a move the turn queue has nothing to say about is a no-op, never a refusal of the clock itself.
 */
export async function turnWorkforceMove(trx: TurnDb, move: string, a: { tenantId: string; branchId: string | null; technicianId: string; actor?: TurnActor | null }, opts: TurnLedgerOptions = {}): Promise<void> {
  if (!isUuid(a.branchId) || !isUuid(a.tenantId)) return;
  const base = { tenantId: a.tenantId, branchId: a.branchId, technicianId: a.technicianId, actor: a.actor ?? { type: 'system' as const } };
  switch (move) {
    case 'clockIn': await turnClockIn(trx, base, opts); return;
    case 'clockOut': await turnClockOut(trx, base, opts); return;
    case 'breakStart': await turnBreakStart(trx, base, opts); return;
    case 'breakEnd': await turnBreakEnd(trx, base, opts); return;
    case 'setUnavailable': {
      const d = await readTurnDay(trx, a.tenantId, a.branchId, opts.nowMs);
      const r = d.rows.find((x) => x.technicianId === a.technicianId);
      if (r && r.inRotation && r.status !== 'HOLD' && r.status !== 'CLOCKED_OUT') await turnHold(trx, { ...base, reason: 'Marked not taking customers', actor: base.actor as TurnActor }, opts);
      return;
    }
    case 'setAvailable': {
      const d = await readTurnDay(trx, a.tenantId, a.branchId, opts.nowMs);
      const r = d.rows.find((x) => x.technicianId === a.technicianId);
      if (r && r.status === 'HOLD') await turnRelease(trx, { ...base, reason: 'Marked available', actor: base.actor as TurnActor }, opts);
      return;
    }
    default: return;
  }
}
