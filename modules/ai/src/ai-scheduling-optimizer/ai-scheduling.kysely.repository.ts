// ai-scheduling.kysely.repository.ts — the production SchedStore over the optimizer's tables (migrations 345 + 528).
// EVERY statement is scoped by tenant_id (the first argument, taken from the session ctx — never from the client), and
// branch-filtered where the caller passes a branch. Status changes are conditional (version + status in the WHERE) and
// bump version; idempotency keys (applications, runs) and the settings scope are unique indexes, so a race resolves to one
// winner in the database rather than in this code.
import { sql, type Kysely } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { SCHEDULE_CHANGE_APPLICATION, SCHEDULE_OPTIMIZATION_RUN, SCHEDULE_RECOMMENDATION, TECHNICIAN_TIME_OFF } from '../ai-lifecycles';
import { utcDate } from '@aipowersalon/date-time';
import type {
  SchedRecommendation, SchedRecStatus, SchedSimulation, SchedRun, SchedGap, SchedConflict, SchedSettingsLayer, SchedRuleVersion,
  SchedTimeOff, SchedLock, SchedServiceProfile,
} from '@aipowersalon/api-contracts/tenant';
import type { SchedStore, RecInsert, RecPatch, RecFilters, ApplicationRow, RunInsert, RunFinish, GapInsert, ConflictInsert, LayerWrite } from './ai-scheduling.store';
import { hhmm } from './ai-scheduling-day';

const j = (v: unknown) => JSON.stringify(v ?? null);
const parse = (v: unknown): any => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } } return v; };
const isoOrNull = (v: unknown): string | null => (v ? new Date(v as any).toISOString() : null);
const ymd = (v: unknown): string | null => (v == null ? null : v instanceof Date ? utcDate(v) : String(v).slice(0, 10));   // pg DATE → a UTC-midnight Date
const arr = (v: unknown): any[] => { const p = parse(v); return Array.isArray(p) ? p : []; };

function toRec(r: any): SchedRecommendation {
  return {
    id: String(r.id), branchId: r.branch_id ?? null, runId: r.run_id ?? null, type: r.type, status: r.status,
    currentState: parse(r.current_state), proposedState: parse(r.proposed_state),
    affectedAppointmentIds: arr(r.affected_appointment_ids).map(String), affectedTechnicianIds: arr(r.affected_technician_ids).map(String),
    hardConstraintsChecked: !!r.hard_constraints_checked, violations: arr(r.violations), simulation: parse(r.simulation),
    expectedBenefit: arr(r.expected_benefit).map(String), possibleDownside: arr(r.possible_downside).map(String),
    confidence: Number(r.confidence ?? 0), dataQuality: r.data_quality, touchesConfirmedAppointment: !!r.touches_confirmed_appointment,
    requiresCustomerApproval: !!r.requires_customer_approval,
    versions: { forecastVersion: r.forecast_version ?? null, ruleVersion: r.rule_version ?? '', engineVersion: r.engine_version ?? '', configVersion: Number(r.config_version ?? 0) },
    version: Number(r.version), applyAttempt: Number(r.apply_attempt ?? 0), automated: !!r.automated, expiresAt: isoOrNull(r.expires_at),
    explanation: r.explanation ?? null, explanationSource: r.explanation_source ?? null, proposal: null,
    decidedByUserId: r.decided_by_user_id ?? null, decidedAt: isoOrNull(r.decided_at), appliedAt: isoOrNull(r.applied_at),
    createdAt: isoOrNull(r.created_at)!, updatedAt: isoOrNull(r.updated_at)!,
  };
}
function toRun(r: any): SchedRun {
  return {
    id: String(r.id), branchId: r.branch_id ?? null, scope: r.scope, status: r.status, date: ymd(r.run_date), technicianId: r.technician_id ?? null,
    trigger: r.run_trigger, metrics: parse(r.metrics), recommendationCount: Number(r.recommendation_count ?? 0), gapCount: Number(r.gap_count ?? 0), conflictCount: Number(r.conflict_count ?? 0),
    versions: { forecastVersion: r.forecast_version ?? null, ruleVersion: r.rule_version ?? '', engineVersion: r.engine_version ?? '', configVersion: Number(r.config_version ?? 0) },
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms), errorCode: r.error_code ?? null, startedAt: isoOrNull(r.started_at)!, completedAt: isoOrNull(r.completed_at),
  };
}
const toLayer = (r: any): SchedSettingsLayer => ({ level: r.level, branchId: r.branch_id ?? null, enabled: r.enabled ?? null, killSwitch: r.kill_switch ?? null, config: parse(r.config), version: Number(r.version), updatedAt: isoOrNull(r.updated_at), updatedByUserId: r.updated_by_user_id ?? null });
const toTimeOff = (r: any): SchedTimeOff => ({ id: String(r.id), technicianId: String(r.technician_id), branchId: r.branch_id ?? null, startsAt: isoOrNull(r.starts_at)!, endsAt: isoOrNull(r.ends_at)!, status: r.status, reason: r.reason ?? null });
const toLock = (r: any): SchedLock => ({ appointmentId: String(r.appointment_id), reason: r.reason ?? null, lockedByUserId: r.locked_by_user_id ?? null, createdAt: isoOrNull(r.created_at)! });
const toProfile = (r: any): SchedServiceProfile => ({ serviceId: String(r.service_id), setupMin: Number(r.setup_min), cleanupMin: Number(r.cleanup_min), maxGroupSize: r.max_group_size == null ? null : Number(r.max_group_size) });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : null);

export class KyselySchedStore implements SchedStore {
  constructor(private readonly db: Kysely<any>) {}
  private get q(): any { return this.db; }

  async tx<T>(fn: (store: SchedStore, handle: unknown) => Promise<T>): Promise<T> {
    if ((this.db as any).isTransaction) return fn(this, this.db);
    return this.db.transaction().execute((trx) => fn(new KyselySchedStore(trx as any), trx));
  }

  // ── recommendations ──
  async insertRec(tenantId: string, r: RecInsert): Promise<SchedRecommendation> {
    const row = await this.q.insertInto('schedule_optimization_recommendations').values({
      tenant_id: tenantId, branch_id: r.branchId, run_id: r.runId, type: r.type, status: r.status,
      current_state: j(r.currentState), proposed_state: j(r.proposedState),
      affected_appointment_ids: j(r.affectedAppointmentIds), affected_technician_ids: j(r.affectedTechnicianIds),
      hard_constraints_checked: true, violations: j(r.violations), simulation: j(r.simulation), soft_objectives_improved: j(r.softObjectivesImproved),
      expected_benefit: j(r.expectedBenefit), possible_downside: j(r.possibleDownside), confidence: r.confidence, data_quality: r.dataQuality,
      requires_human_review: true, requires_customer_approval: r.requiresCustomerApproval, touches_confirmed_appointment: r.touchesConfirmedAppointment,
      forecast_version: r.versions.forecastVersion, rule_version: r.versions.ruleVersion, engine_version: r.versions.engineVersion, config_version: r.versions.configVersion,
      expires_at: new Date(r.expiresAt), automated: r.automated, version: 1, apply_attempt: 0,
    }).returningAll().executeTakeFirstOrThrow();
    return toRec(row);
  }
  async getRec(tenantId: string, id: string) {
    const r = await this.q.selectFrom('schedule_optimization_recommendations').where('tenant_id', '=', tenantId).where('id', '=', id).selectAll().executeTakeFirst();
    return r ? toRec(r) : null;
  }
  private filtered(tenantId: string, f: RecFilters): any {
    let q = this.q.selectFrom('schedule_optimization_recommendations').where('tenant_id', '=', tenantId);
    // a branch user sees ONLY their branch (the old `or branch_id is null` leaked salon-wide rows into every branch)
    if (f.branchId) q = q.where('branch_id', '=', f.branchId);
    if (f.status) q = q.where('status', '=', f.status);
    if (f.statuses?.length) q = q.where('status', 'in', f.statuses);
    if (f.type) q = q.where('type', '=', f.type);
    if (f.runId) q = q.where('run_id', '=', f.runId);
    if (f.technicianId) q = q.where(sql`affected_technician_ids @> ${j([f.technicianId])}::jsonb`);
    if (f.appointmentId) q = q.where(sql`affected_appointment_ids @> ${j([f.appointmentId])}::jsonb`);
    if (f.date) q = q.where((eb: any) => eb.or([eb(sql`current_state->>'date'`, '=', f.date), eb(sql`proposed_state->>'date'`, '=', f.date)]));
    return q;
  }
  async listRecs(tenantId: string, f: RecFilters) {
    const limit = Math.min(Math.max(1, f.limit ?? 50), 200);
    const [rows, cnt] = await Promise.all([
      this.filtered(tenantId, f).selectAll().orderBy('created_at', 'desc').orderBy('id', 'desc').limit(limit).execute(),
      this.filtered(tenantId, f).select((eb: any) => eb.fn.countAll().as('n')).executeTakeFirst(),
    ]);
    return { items: (rows as any[]).map(toRec), total: Number((cnt as any)?.n ?? 0) };
  }
  async casRec(tenantId: string, id: string, expectedVersion: number, from: SchedRecStatus[], patch: RecPatch) {
    const set: Record<string, unknown> = { status: patch.status, version: sql`version + 1`, updated_at: sql`now()` };
    if (patch.decidedByUserId !== undefined) set.decided_by_user_id = patch.decidedByUserId;
    if (patch.decidedAt !== undefined) set.decided_at = patch.decidedAt ? new Date(patch.decidedAt) : null;
    if (patch.appliedAt !== undefined) set.applied_at = patch.appliedAt ? new Date(patch.appliedAt) : null;
    if (patch.applyAttempt !== undefined) set.apply_attempt = patch.applyAttempt;
    if (patch.expiresAt !== undefined) set.expires_at = patch.expiresAt ? new Date(patch.expiresAt) : null;
    if (patch.automated !== undefined) set.automated = patch.automated;
    const r = await this.q.updateTable('schedule_optimization_recommendations').set(set)
      .where('tenant_id', '=', tenantId).where('id', '=', id).where('version', '=', expectedVersion).where('status', 'in', from)
      .where(canMoveToSql(SCHEDULE_RECOMMENDATION, patch.status) as any)   // Phase 12 (#27): the recommendation machine
      .returningAll().executeTakeFirst();
    return r ? toRec(r) : null;
  }
  async setExplanation(tenantId: string, id: string, text: string, source: 'llm' | 'template') {
    await this.q.updateTable('schedule_optimization_recommendations').set({ explanation: String(text).slice(0, 4000), explanation_source: source, updated_at: sql`now()` })
      .where('tenant_id', '=', tenantId).where('id', '=', id).execute();
  }
  async insertDecision(tenantId: string, d: { recommendationId: string; action: string; actorUserId: string | null; reason: string | null; before: unknown; after: unknown }) {
    await this.q.insertInto('schedule_recommendation_decisions').values({ tenant_id: tenantId, recommendation_id: d.recommendationId, action: d.action, actor_user_id: uuidOrNull(d.actorUserId), reason: d.reason, before_snapshot: j(d.before), after_snapshot: j(d.after),
      // clock_timestamp, not now(): the edges one decision covers (start_review, accept) share a transaction and must keep their order
      created_at: sql`clock_timestamp()` }).execute();
  }
  async listDecisions(tenantId: string, recommendationId: string) {
    const rows = await this.q.selectFrom('schedule_recommendation_decisions').where('tenant_id', '=', tenantId).where('recommendation_id', '=', recommendationId)
      .select(['action', 'actor_user_id', 'reason', 'before_snapshot', 'after_snapshot', 'created_at']).orderBy('created_at', 'asc').orderBy('id', 'asc').execute();
    return (rows as any[]).map((r) => ({ action: r.action, actorUserId: r.actor_user_id ?? null, reason: r.reason ?? null, before: parse(r.before_snapshot), after: parse(r.after_snapshot) }));
  }
  async insertImpact(tenantId: string, recommendationId: string, sim: SchedSimulation) {
    await this.q.insertInto('schedule_recommendation_impacts').values({ tenant_id: tenantId, recommendation_id: recommendationId, before_metrics: j(sim.before), after_metrics: j(sim.after), deltas: j(sim.deltas) }).execute();
  }
  async dueForExpiry(tenantId: string, nowIso: string, statuses: SchedRecStatus[], limit: number) {
    const rows = await this.q.selectFrom('schedule_optimization_recommendations').where('tenant_id', '=', tenantId).where('status', 'in', statuses)
      .where('expires_at', '<=', new Date(nowIso)).selectAll().orderBy('expires_at', 'asc').limit(limit).execute();
    return (rows as any[]).map(toRec);
  }

  // ── applications ──
  async findApplication(tenantId: string, key: string): Promise<ApplicationRow | null> {
    const r = await this.q.selectFrom('schedule_change_applications').where('tenant_id', '=', tenantId).where('idempotency_key', '=', key)
      .select(['idempotency_key', 'recommendation_id', 'appointment_id', 'attempt', 'status', 'applied_via', 'external_ref', 'error_code']).executeTakeFirst();
    return r ? { idempotencyKey: r.idempotency_key, recommendationId: r.recommendation_id, appointmentId: r.appointment_id ?? null, attempt: Number(r.attempt), status: r.status, appliedVia: r.applied_via ?? null, externalRef: r.external_ref ?? null, errorCode: r.error_code ?? null } : null;
  }
  async claimApplication(tenantId: string, row: { key: string; recommendationId: string; appointmentId: string | null; attempt: number; userId: string | null; scheduleVersion: number | null }) {
    const r = await this.q.insertInto('schedule_change_applications').values({
      tenant_id: tenantId, idempotency_key: row.key, recommendation_id: row.recommendationId, appointment_id: uuidOrNull(row.appointmentId),
      attempt: row.attempt, status: 'pending', applied_by_user_id: uuidOrNull(row.userId), schedule_version: row.scheduleVersion,
    }).onConflict((oc: any) => oc.column('idempotency_key').doNothing()).returning(['id']).executeTakeFirst();
    return !!r;
  }
  async finishApplication(tenantId: string, key: string, r: { status: 'applied' | 'failed' | 'stale'; appliedVia: string | null; externalRef: string | null; errorCode: string | null }) {
    await this.q.updateTable('schedule_change_applications').set({ status: r.status, applied_via: r.appliedVia, external_ref: r.externalRef ? String(r.externalRef).slice(0, 200) : null, error_code: r.errorCode, applied_at: r.status === 'applied' ? sql`now()` : null })
      .where('tenant_id', '=', tenantId).where('idempotency_key', '=', key).where(canMoveToSql(SCHEDULE_CHANGE_APPLICATION, r.status) as any).execute();
  }
  async markApplicationRolledBack(tenantId: string, key: string) {
    await this.q.updateTable('schedule_change_applications').set({ status: 'rolled_back', rolled_back_at: sql`now()` }).where('tenant_id', '=', tenantId).where('idempotency_key', '=', key).where(canMoveToSql(SCHEDULE_CHANGE_APPLICATION, 'rolled_back') as any).execute();
  }

  // ── runs, gaps, conflicts ──
  async findRunByKey(tenantId: string, key: string) {
    const r = await this.q.selectFrom('schedule_optimization_runs').where('tenant_id', '=', tenantId).where('idempotency_key', '=', key).select(['id']).executeTakeFirst();
    return r ? String(r.id) : null;
  }
  async insertRun(tenantId: string, r: RunInsert) {
    const row = await this.q.insertInto('schedule_optimization_runs').values({
      tenant_id: tenantId, branch_id: r.branchId, scope: r.scope, status: 'started', run_date: r.date, technician_id: uuidOrNull(r.technicianId), run_trigger: r.trigger,
      idempotency_key: r.idempotencyKey, requested_by_user_id: uuidOrNull(r.requestedByUserId), forecast_version: r.versions.forecastVersion, rule_version: r.versions.ruleVersion,
      engine_version: r.versions.engineVersion, config_version: r.versions.configVersion, correlation_id: r.correlationId,
    }).onConflict((oc: any) => oc.columns(['tenant_id', 'idempotency_key']).where('idempotency_key', 'is not', null).doNothing()).returning(['id']).executeTakeFirst();
    return row ? String(row.id) : null;
  }
  async finishRun(tenantId: string, id: string, f: RunFinish) {
    await this.q.updateTable('schedule_optimization_runs').set({ status: f.status, metrics: f.metrics ? j(f.metrics) : null, recommendation_count: f.recommendationCount, gap_count: f.gapCount, conflict_count: f.conflictCount, latency_ms: f.latencyMs, error_code: f.errorCode, completed_at: sql`now()` })
      .where('tenant_id', '=', tenantId).where('id', '=', id).where(canMoveToSql(SCHEDULE_OPTIMIZATION_RUN, f.status) as any).execute();
  }
  async getRun(tenantId: string, id: string) {
    const r = await this.q.selectFrom('schedule_optimization_runs').where('tenant_id', '=', tenantId).where('id', '=', id).selectAll().executeTakeFirst();
    return r ? toRun(r) : null;
  }
  async listRuns(tenantId: string, f: { branchId?: string | null; date?: string | null; limit?: number }) {
    let q = this.q.selectFrom('schedule_optimization_runs').where('tenant_id', '=', tenantId);
    if (f.branchId) q = q.where('branch_id', '=', f.branchId);
    if (f.date) q = q.where('run_date', '=', f.date);
    return ((await q.selectAll().orderBy('started_at', 'desc').limit(Math.min(Math.max(1, f.limit ?? 50), 500)).execute()) as any[]).map(toRun);
  }
  async latestCompletedRun(tenantId: string, branchId: string | null, date: string) {
    let q = this.q.selectFrom('schedule_optimization_runs').where('tenant_id', '=', tenantId).where('run_date', '=', date).where('status', '=', 'completed').where('scope', '=', 'branch_day');
    q = branchId ? q.where('branch_id', '=', branchId) : q.where('branch_id', 'is', null);
    const r = await q.selectAll().orderBy('completed_at', 'desc').limit(1).executeTakeFirst();
    return r ? toRun(r) : null;
  }
  async insertGaps(tenantId: string, runId: string, branchId: string | null, date: string, gaps: GapInsert[]) {
    if (!gaps.length) return;
    await this.q.insertInto('schedule_gaps').values(gaps.map((g) => ({ tenant_id: tenantId, run_id: runId, branch_id: branchId, technician_id: uuidOrNull(g.technicianId), date, start_min: g.startMin, end_min: g.endMin, duration_min: g.durationMin, cause: g.cause, services_that_fit: j(g.servicesThatFit), confidence: g.confidence }))).execute();
  }
  async listGaps(tenantId: string, runId: string): Promise<SchedGap[]> {
    const rows = await this.q.selectFrom('schedule_gaps').where('tenant_id', '=', tenantId).where('run_id', '=', runId).selectAll().orderBy('technician_id').orderBy('start_min').execute();
    return (rows as any[]).map((r) => ({ id: String(r.id), technicianId: r.technician_id ?? null, date: ymd(r.date)!, startTime: hhmm(Number(r.start_min)), endTime: hhmm(Number(r.end_min)), durationMin: Number(r.duration_min), cause: r.cause ?? null, servicesThatFit: arr(r.services_that_fit).map(String) }));
  }
  async resolveOpenConflicts(tenantId: string, branchId: string | null, date: string) {
    let q = this.q.updateTable('schedule_conflicts').set({ resolved: true }).where('tenant_id', '=', tenantId).where('conflict_date', '=', date).where('resolved', '=', false);
    q = branchId ? q.where('branch_id', '=', branchId) : q.where('branch_id', 'is', null);
    await q.execute();
  }
  async insertConflicts(tenantId: string, runId: string, branchId: string | null, date: string, rows: ConflictInsert[]) {
    if (!rows.length) return;
    await this.q.insertInto('schedule_conflicts').values(rows.map((c) => ({ tenant_id: tenantId, run_id: runId, branch_id: branchId, conflict_date: date, technician_id: uuidOrNull(c.technicianId), type: c.type, severity: c.severity, appointment_ids: j(c.appointmentIds), message: c.message }))).execute();
  }
  async listConflicts(tenantId: string, runId: string): Promise<SchedConflict[]> {
    const rows = await this.q.selectFrom('schedule_conflicts').where('tenant_id', '=', tenantId).where('run_id', '=', runId).selectAll().orderBy('detected_at').orderBy('id').execute();
    return (rows as any[]).map((r) => ({ id: String(r.id), type: r.type, severity: r.severity, appointmentIds: arr(r.appointment_ids).map(String), technicianId: r.technician_id ?? null, date: ymd(r.conflict_date), message: r.message ?? null, resolved: !!r.resolved }));
  }

  // ── settings ──
  async layers(tenantId: string) {
    const rows = await this.q.selectFrom('tenant_scheduling_ai_settings').where('tenant_id', '=', tenantId).select(['level', 'branch_id', 'enabled', 'kill_switch', 'config', 'version', 'updated_at', 'updated_by_user_id']).execute();
    return (rows as any[]).map(toLayer);
  }
  async writeLayer(tenantId: string, w: LayerWrite) {
    const vals = { enabled: w.enabled, kill_switch: w.killSwitch, config: w.config == null ? null : j(w.config), updated_by_user_id: uuidOrNull(w.userId), updated_at: sql`now()` };
    if (w.expectedVersion === 0) {
      // first write for this scope: the unique (tenant, level, branch) index makes a concurrent first write lose cleanly
      const r = await this.q.insertInto('tenant_scheduling_ai_settings').values({ tenant_id: tenantId, level: w.level, branch_id: w.level === 'branch' ? w.branchId : null, version: 1, ...vals })
        .onConflict((oc: any) => oc.doNothing()).returning(['level', 'branch_id', 'enabled', 'kill_switch', 'config', 'version', 'updated_at', 'updated_by_user_id']).executeTakeFirst();
      return r ? toLayer(r) : null;
    }
    let q = this.q.updateTable('tenant_scheduling_ai_settings').set({ ...vals, version: sql`version + 1` }).where('tenant_id', '=', tenantId).where('level', '=', w.level).where('version', '=', w.expectedVersion);
    q = w.level === 'branch' ? q.where('branch_id', '=', w.branchId) : q.where('branch_id', 'is', null);
    const r = await q.returning(['level', 'branch_id', 'enabled', 'kill_switch', 'config', 'version', 'updated_at', 'updated_by_user_id']).executeTakeFirst();
    return r ? toLayer(r) : null;
  }
  async insertRuleVersion(tenantId: string, layer: SchedSettingsLayer, userId: string | null) {
    await this.q.insertInto('scheduling_rule_versions').values({ tenant_id: tenantId, level: layer.level, branch_id: layer.branchId, version: layer.version, enabled: layer.enabled, kill_switch: layer.killSwitch, config: layer.config == null ? null : j(layer.config), changed_by_user_id: uuidOrNull(userId) }).execute();
  }
  async listRuleVersions(tenantId: string, limit: number): Promise<SchedRuleVersion[]> {
    const rows = await this.q.selectFrom('scheduling_rule_versions').where('tenant_id', '=', tenantId).selectAll().orderBy('created_at', 'desc').orderBy('version', 'desc').limit(limit).execute();
    return (rows as any[]).map((r) => ({ version: Number(r.version), level: r.level, branchId: r.branch_id ?? null, enabled: r.enabled ?? null, killSwitch: r.kill_switch ?? null, config: parse(r.config), changedByUserId: r.changed_by_user_id ?? null, createdAt: isoOrNull(r.created_at)! }));
  }

  // ── gate inputs ──
  async listTimeOff(tenantId: string, f: { technicianId?: string | null; branchId?: string | null; from?: string | null; to?: string | null }) {
    let q = this.q.selectFrom('technician_time_off').where('tenant_id', '=', tenantId).where('status', '!=', 'cancelled');
    if (f.technicianId) q = q.where('technician_id', '=', f.technicianId);
    if (f.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', f.branchId), eb('branch_id', 'is', null)]));
    if (f.from) q = q.where('ends_at', '>', new Date(f.from));
    if (f.to) q = q.where('starts_at', '<', new Date(f.to));
    return ((await q.selectAll().orderBy('starts_at').limit(500).execute()) as any[]).map(toTimeOff);
  }
  async insertTimeOff(tenantId: string, t: { technicianId: string; branchId: string | null; startsAt: string; endsAt: string; reason: string | null; userId: string | null }) {
    const r = await this.q.insertInto('technician_time_off').values({ tenant_id: tenantId, technician_id: t.technicianId, branch_id: t.branchId, starts_at: new Date(t.startsAt), ends_at: new Date(t.endsAt), status: 'approved', reason: t.reason, created_by_user_id: uuidOrNull(t.userId) }).returningAll().executeTakeFirstOrThrow();
    return toTimeOff(r);
  }
  async cancelTimeOff(tenantId: string, id: string) {
    const r = await this.q.updateTable('technician_time_off').set({ status: 'cancelled', updated_at: sql`now()` }).where('tenant_id', '=', tenantId).where('id', '=', id).where(canMoveToSql(TECHNICIAN_TIME_OFF, 'cancelled') as any).returning(['id']).executeTakeFirst();
    return !!r;
  }
  async listLocks(tenantId: string, branchId: string | null) {
    let q = this.q.selectFrom('appointment_schedule_locks').where('tenant_id', '=', tenantId);
    if (branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    return ((await q.selectAll().orderBy('created_at', 'desc').limit(1000).execute()) as any[]).map(toLock);
  }
  async putLock(tenantId: string, l: { appointmentId: string; branchId: string | null; reason: string | null; userId: string | null }) {
    const r = await this.q.insertInto('appointment_schedule_locks').values({ tenant_id: tenantId, branch_id: l.branchId, appointment_id: l.appointmentId, reason: l.reason, locked_by_user_id: uuidOrNull(l.userId) })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'appointment_id']).doUpdateSet({ reason: l.reason, locked_by_user_id: uuidOrNull(l.userId) })).returningAll().executeTakeFirstOrThrow();
    return toLock(r);
  }
  async deleteLock(tenantId: string, appointmentId: string) {
    const r = await this.q.deleteFrom('appointment_schedule_locks').where('tenant_id', '=', tenantId).where('appointment_id', '=', appointmentId).returning(['id']).executeTakeFirst();
    return !!r;
  }
  async listServiceProfiles(tenantId: string) {
    return ((await this.q.selectFrom('service_scheduling_profiles').where('tenant_id', '=', tenantId).selectAll().orderBy('service_id').execute()) as any[]).map(toProfile);
  }
  async putServiceProfile(tenantId: string, p: SchedServiceProfile, userId: string | null) {
    const r = await this.q.insertInto('service_scheduling_profiles').values({ tenant_id: tenantId, service_id: p.serviceId, setup_min: p.setupMin, cleanup_min: p.cleanupMin, max_group_size: p.maxGroupSize, updated_by_user_id: uuidOrNull(userId) })
      .onConflict((oc: any) => oc.columns(['tenant_id', 'service_id']).doUpdateSet({ setup_min: p.setupMin, cleanup_min: p.cleanupMin, max_group_size: p.maxGroupSize, updated_by_user_id: uuidOrNull(userId), updated_at: sql`now()` }))
      .returningAll().executeTakeFirstOrThrow();
    return toProfile(r);
  }
}
