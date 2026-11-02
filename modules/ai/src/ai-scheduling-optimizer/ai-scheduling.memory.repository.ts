// ai-scheduling.memory.repository.ts — the in-memory SchedStore (dev without a database, and the service unit tests).
// Mirrors the Kysely store's contract exactly: tenant-scoped reads, conditional status updates on (version, status),
// unique idempotency keys for applications and runs, conditional settings writes.
import { randomUUID } from 'node:crypto';
import type {
  SchedRecommendation, SchedRecStatus, SchedSimulation, SchedRun, SchedGap, SchedConflict, SchedSettingsLayer, SchedRuleVersion,
  SchedTimeOff, SchedLock, SchedServiceProfile,
} from '@aipowersalon/api-contracts/tenant';
import type { SchedStore, RecInsert, RecPatch, RecFilters, ApplicationRow, RunInsert, RunFinish, GapInsert, ConflictInsert, LayerWrite } from './ai-scheduling.store';
import { hhmm } from './ai-scheduling-day';
import { schedConflictCoded } from '@aipowersalon/api-contracts/tenant';

const iso = () => new Date().toISOString();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export class InMemorySchedStore implements SchedStore {
  private recs: (SchedRecommendation & { tenantId: string })[] = [];
  private decisions: { tenantId: string; recommendationId: string; action: string; actorUserId: string | null; reason: string | null; before: any; after: any }[] = [];
  readonly impacts: { tenantId: string; recommendationId: string; sim: SchedSimulation }[] = [];
  private apps = new Map<string, ApplicationRow & { tenantId: string }>();
  private runs: (SchedRun & { tenantId: string; idempotencyKey: string | null })[] = [];
  private gaps: (SchedGap & { tenantId: string; runId: string; branchId: string | null })[] = [];
  private conflicts: (SchedConflict & { tenantId: string; runId: string; branchId: string | null })[] = [];
  private layerRows: (SchedSettingsLayer & { tenantId: string })[] = [];
  private ruleVersions: (SchedRuleVersion & { tenantId: string })[] = [];
  private timeOff: (SchedTimeOff & { tenantId: string })[] = [];
  private locks: (SchedLock & { tenantId: string; branchId: string | null })[] = [];
  private profiles: (SchedServiceProfile & { tenantId: string })[] = [];

  async tx<T>(fn: (store: SchedStore, handle: unknown) => Promise<T>): Promise<T> { return fn(this, null); }

  private strip<T extends { tenantId: string }>(r: T): Omit<T, 'tenantId'> { const { tenantId: _t, ...rest } = r; return clone(rest); }

  async insertRec(tenantId: string, r: RecInsert): Promise<SchedRecommendation> {
    const now = iso();
    const rec: SchedRecommendation & { tenantId: string } = {
      tenantId, id: randomUUID(), branchId: r.branchId, runId: r.runId, type: r.type, status: r.status,
      currentState: r.currentState, proposedState: r.proposedState, affectedAppointmentIds: r.affectedAppointmentIds, affectedTechnicianIds: r.affectedTechnicianIds,
      hardConstraintsChecked: true, violations: r.violations, simulation: r.simulation, expectedBenefit: r.expectedBenefit, possibleDownside: r.possibleDownside,
      confidence: r.confidence, dataQuality: r.dataQuality, touchesConfirmedAppointment: r.touchesConfirmedAppointment, requiresCustomerApproval: r.requiresCustomerApproval,
      versions: r.versions, version: 1, applyAttempt: 0, automated: r.automated, expiresAt: r.expiresAt, explanation: null, explanationSource: null, explanationLanguage: null, proposal: null,
      decidedByUserId: null, decidedAt: null, appliedAt: null, createdAt: now, updatedAt: now,
    };
    this.recs.push(rec);
    return this.strip(rec) as SchedRecommendation;
  }
  async getRec(tenantId: string, id: string) { const r = this.recs.find((x) => x.tenantId === tenantId && x.id === id); return r ? (this.strip(r) as SchedRecommendation) : null; }
  async listRecs(tenantId: string, f: RecFilters) {
    let items = this.recs.filter((x) => x.tenantId === tenantId);
    if (f.branchId) items = items.filter((x) => x.branchId === f.branchId);
    if (f.status) items = items.filter((x) => x.status === f.status);
    if (f.statuses?.length) items = items.filter((x) => f.statuses!.includes(x.status));
    if (f.type) items = items.filter((x) => x.type === f.type);
    if (f.runId) items = items.filter((x) => x.runId === f.runId);
    if (f.technicianId) items = items.filter((x) => x.affectedTechnicianIds.includes(f.technicianId!));
    if (f.appointmentId) items = items.filter((x) => x.affectedAppointmentIds.includes(f.appointmentId!));
    if (f.date) items = items.filter((x) => x.currentState?.date === f.date || x.proposedState?.date === f.date);
    const total = items.length;
    items = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(Math.max(1, f.limit ?? 50), 200));
    return { items: items.map((r) => this.strip(r) as SchedRecommendation), total };
  }
  async casRec(tenantId: string, id: string, expectedVersion: number, from: SchedRecStatus[], patch: RecPatch) {
    const r = this.recs.find((x) => x.tenantId === tenantId && x.id === id);
    if (!r || r.version !== expectedVersion || !from.includes(r.status)) return null;
    r.status = patch.status; r.version += 1; r.updatedAt = iso();
    if (patch.decidedByUserId !== undefined) r.decidedByUserId = patch.decidedByUserId;
    if (patch.decidedAt !== undefined) r.decidedAt = patch.decidedAt;
    if (patch.appliedAt !== undefined) r.appliedAt = patch.appliedAt;
    if (patch.applyAttempt !== undefined) r.applyAttempt = patch.applyAttempt;
    if (patch.expiresAt !== undefined) r.expiresAt = patch.expiresAt;
    if (patch.automated !== undefined) r.automated = patch.automated;
    return this.strip(r) as SchedRecommendation;
  }
  async setExplanation(tenantId: string, id: string, text: string, source: 'llm' | 'template', language: 'en' | 'vi' = 'en') {
    const r = this.recs.find((x) => x.tenantId === tenantId && x.id === id); if (r) { r.explanation = text; r.explanationSource = source; r.explanationLanguage = language; }
  }
  async insertDecision(tenantId: string, d: { recommendationId: string; action: string; actorUserId: string | null; reason: string | null; before: unknown; after: unknown }) { this.decisions.push({ tenantId, ...clone(d) }); }
  async listDecisions(tenantId: string, recommendationId: string) { return this.decisions.filter((d) => d.tenantId === tenantId && d.recommendationId === recommendationId).map(({ tenantId: _t, recommendationId: _r, ...rest }) => rest); }
  async insertImpact(tenantId: string, recommendationId: string, sim: SchedSimulation) { this.impacts.push({ tenantId, recommendationId, sim }); }
  async dueForExpiry(tenantId: string, nowIso: string, statuses: SchedRecStatus[], limit: number) {
    return this.recs.filter((r) => r.tenantId === tenantId && statuses.includes(r.status) && r.expiresAt && r.expiresAt <= nowIso).slice(0, limit).map((r) => this.strip(r) as SchedRecommendation);
  }

  async findApplication(tenantId: string, key: string) { const a = this.apps.get(key); return a && a.tenantId === tenantId ? (this.strip(a) as ApplicationRow) : null; }
  async claimApplication(tenantId: string, row: { key: string; recommendationId: string; appointmentId: string | null; attempt: number; userId: string | null }) {
    if (this.apps.has(row.key)) return false;
    this.apps.set(row.key, { tenantId, idempotencyKey: row.key, recommendationId: row.recommendationId, appointmentId: row.appointmentId, attempt: row.attempt, status: 'pending', appliedVia: null, externalRef: null, errorCode: null });
    return true;
  }
  async finishApplication(tenantId: string, key: string, r: { status: 'applied' | 'failed' | 'stale'; appliedVia: string | null; externalRef: string | null; errorCode: string | null }) {
    const a = this.apps.get(key); if (a && a.tenantId === tenantId) Object.assign(a, r);
  }
  async markApplicationRolledBack(tenantId: string, key: string) { const a = this.apps.get(key); if (a && a.tenantId === tenantId) a.status = 'rolled_back'; }

  async findRunByKey(tenantId: string, key: string) { return this.runs.find((r) => r.tenantId === tenantId && r.idempotencyKey === key)?.id ?? null; }
  async insertRun(tenantId: string, r: RunInsert) {
    if (r.idempotencyKey && this.runs.some((x) => x.tenantId === tenantId && x.idempotencyKey === r.idempotencyKey)) return null;
    const id = randomUUID();
    this.runs.push({ tenantId, idempotencyKey: r.idempotencyKey, id, branchId: r.branchId, scope: r.scope, status: 'started', date: r.date, technicianId: r.technicianId, trigger: r.trigger,
      metrics: null, recommendationCount: 0, gapCount: 0, conflictCount: 0, versions: r.versions, latencyMs: null, errorCode: null, startedAt: iso(), completedAt: null });
    return id;
  }
  async finishRun(tenantId: string, id: string, f: RunFinish) {
    const r = this.runs.find((x) => x.tenantId === tenantId && x.id === id); if (!r) return;
    Object.assign(r, { status: f.status, metrics: f.metrics, recommendationCount: f.recommendationCount, gapCount: f.gapCount, conflictCount: f.conflictCount, latencyMs: f.latencyMs, errorCode: f.errorCode, completedAt: iso() });
  }
  async getRun(tenantId: string, id: string) { const r = this.runs.find((x) => x.tenantId === tenantId && x.id === id); if (!r) return null; const { idempotencyKey: _k, ...rest } = this.strip(r) as any; return rest as SchedRun; }
  async listRuns(tenantId: string, f: { branchId?: string | null; date?: string | null; limit?: number }) {
    return this.runs.filter((r) => r.tenantId === tenantId && (!f.branchId || r.branchId === f.branchId) && (!f.date || r.date === f.date))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, f.limit ?? 50).map((r) => { const { idempotencyKey: _k, ...rest } = this.strip(r) as any; return rest as SchedRun; });
  }
  async latestCompletedRun(tenantId: string, branchId: string | null, date: string) {
    return (await this.listRuns(tenantId, { branchId, date, limit: 500 })).find((r) => r.status === 'completed') ?? null;
  }
  async insertGaps(tenantId: string, runId: string, branchId: string | null, date: string, gaps: GapInsert[]) {
    for (const g of gaps) this.gaps.push({ tenantId, runId, branchId, id: randomUUID(), technicianId: g.technicianId, date, startTime: hhmm(g.startMin), endTime: hhmm(g.endMin), durationMin: g.durationMin, cause: g.cause, servicesThatFit: g.servicesThatFit });
  }
  async listGaps(tenantId: string, runId: string) { return this.gaps.filter((g) => g.tenantId === tenantId && g.runId === runId).map(({ tenantId: _t, runId: _r, branchId: _b, ...g }) => clone(g)); }
  async resolveOpenConflicts(tenantId: string, branchId: string | null, date: string) {
    for (const c of this.conflicts) if (c.tenantId === tenantId && c.branchId === branchId && c.date === date) c.resolved = true;
  }
  async insertConflicts(tenantId: string, runId: string, branchId: string | null, date: string, rows: ConflictInsert[]) {
    for (const c of rows) this.conflicts.push({ tenantId, runId, branchId, id: randomUUID(), type: c.type, severity: c.severity, appointmentIds: c.appointmentIds, technicianId: c.technicianId, date, message: c.message, resolved: false });
  }
  async listConflicts(tenantId: string, runId: string) { return this.conflicts.filter((c) => c.tenantId === tenantId && c.runId === runId).map(({ tenantId: _t, runId: _r, branchId: _b, ...c }) => ({ ...clone(c), messageCoded: schedConflictCoded(c.type, c.message) })); }

  async layers(tenantId: string) { return this.layerRows.filter((l) => l.tenantId === tenantId).map((l) => this.strip(l) as SchedSettingsLayer); }
  async writeLayer(tenantId: string, w: LayerWrite) {
    const cur = this.layerRows.find((l) => l.tenantId === tenantId && l.level === w.level && (l.branchId ?? null) === (w.branchId ?? null));
    if ((cur ? cur.version : 0) !== w.expectedVersion) return null;
    const next = { tenantId, level: w.level, branchId: w.level === 'branch' ? w.branchId : null, enabled: w.enabled, killSwitch: w.killSwitch, config: w.config, version: (cur?.version ?? 0) + 1, updatedAt: iso(), updatedByUserId: w.userId };
    if (cur) Object.assign(cur, next); else this.layerRows.push(next);
    return this.strip(next) as SchedSettingsLayer;
  }
  async insertRuleVersion(tenantId: string, layer: SchedSettingsLayer, userId: string | null) {
    this.ruleVersions.push({ tenantId, version: layer.version, level: layer.level, branchId: layer.branchId, enabled: layer.enabled, killSwitch: layer.killSwitch, config: clone(layer.config), changedByUserId: userId, createdAt: iso() });
  }
  async listRuleVersions(tenantId: string, limit: number) { return this.ruleVersions.filter((v) => v.tenantId === tenantId).slice().reverse().slice(0, limit).map((v) => this.strip(v) as SchedRuleVersion); }

  async listTimeOff(tenantId: string, f: { technicianId?: string | null; branchId?: string | null; from?: string | null; to?: string | null }) {
    return this.timeOff.filter((t) => t.tenantId === tenantId && (!f.technicianId || t.technicianId === f.technicianId) && (!f.branchId || !t.branchId || t.branchId === f.branchId)
      && (!f.from || t.endsAt > f.from) && (!f.to || t.startsAt < f.to)).map((t) => this.strip(t) as SchedTimeOff);
  }
  async insertTimeOff(tenantId: string, t: { technicianId: string; branchId: string | null; startsAt: string; endsAt: string; reason: string | null; userId: string | null }) {
    const row = { tenantId, id: randomUUID(), technicianId: t.technicianId, branchId: t.branchId, startsAt: t.startsAt, endsAt: t.endsAt, status: 'approved' as const, reason: t.reason };
    this.timeOff.push(row); return this.strip(row) as SchedTimeOff;
  }
  async cancelTimeOff(tenantId: string, id: string) { const t = this.timeOff.find((x) => x.tenantId === tenantId && x.id === id && x.status !== 'cancelled'); if (!t) return false; t.status = 'cancelled'; return true; }
  async listLocks(tenantId: string, branchId: string | null) { return this.locks.filter((l) => l.tenantId === tenantId && (!branchId || !l.branchId || l.branchId === branchId)).map(({ tenantId: _t, branchId: _b, ...l }) => clone(l)); }
  async putLock(tenantId: string, l: { appointmentId: string; branchId: string | null; reason: string | null; userId: string | null }) {
    let row = this.locks.find((x) => x.tenantId === tenantId && x.appointmentId === l.appointmentId);
    if (row) { row.reason = l.reason; row.lockedByUserId = l.userId; }
    else { row = { tenantId, branchId: l.branchId, appointmentId: l.appointmentId, reason: l.reason, lockedByUserId: l.userId, createdAt: iso() }; this.locks.push(row); }
    const { tenantId: _t, branchId: _b, ...out } = row; return clone(out);
  }
  async deleteLock(tenantId: string, appointmentId: string) { const n = this.locks.length; this.locks = this.locks.filter((l) => !(l.tenantId === tenantId && l.appointmentId === appointmentId)); return this.locks.length !== n; }
  async listServiceProfiles(tenantId: string) { return this.profiles.filter((p) => p.tenantId === tenantId).map((p) => this.strip(p) as SchedServiceProfile); }
  async putServiceProfile(tenantId: string, p: SchedServiceProfile) {
    const cur = this.profiles.find((x) => x.tenantId === tenantId && x.serviceId === p.serviceId);
    if (cur) Object.assign(cur, p); else this.profiles.push({ tenantId, ...p });
    return clone(p);
  }
}
