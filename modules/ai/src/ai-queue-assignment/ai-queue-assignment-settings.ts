// ai-queue-assignment-settings.ts — BUILD_PLAN Phase 6: the ONE settings source for AI queue assignment.
//
// Salon-wide defaults (queue_assignment_tenant_settings) under per-branch rows (queue_assignment_settings, where a null
// column inherits the salon value), both VERSIONED; every change writes a snapshot to queue_assignment_settings_versions
// and an audit row. The auto-assign switches are layered: the PLATFORM switch (platform_settings
// 'ai.auto_actions_disabled', Super Admin kill switches), the SALON kill switch (auto_killed), the salon / branch
// enabled flags. `autoAllowed` says whether an auto-run may act and, if not, why.
//
// This replaces three auto-assign switches and two rotation configs (audit "parallel implementations" 3): the tenant
// settings' queueWorkflow.autoAssign / assignBy and the queue DTO's autoAssignTechnicianEnabled are retired in favour of
// this. Every reader (engine, detection, auto-run, jobs, screens) goes through `effective()`.
import { sql, type Kysely } from 'kysely';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter } from '@aipowersalon/events';
import { mergeTurnPolicy, validateTurnPolicyPatch, normalizeRotationPolicy, ASSIGNMENT_MODES, type TurnPolicy, type AssignmentMode } from '@aipowersalon/workforce';

// Fair Turn Engine (wave 2, migration 600): the five FAIRNESS MODES lead; the five legacy scoring policies stay valid.
export const ROTATION_POLICY_VALUES = ['traditional_weighted_rotation', 'lowest_turn_units', 'workload_balanced', 'hybrid_fairness', 'manual_order',
  'hybrid', 'least_minutes', 'least_customers', 'first_available', 'fixed_order'] as const;
export type RotationPolicyValue = typeof ROTATION_POLICY_VALUES[number];

export interface AutoExclusions {
  vip?: boolean;            // never auto-assign VIP guests
  appointments?: boolean;   // never auto-assign appointment guests (they have their booked technician)
  requested?: boolean;      // never auto-assign a guest who asked for a specific technician
  groups?: boolean;         // never auto-assign a party
  technicianIds?: string[]; // never auto-assign TO these technicians
  serviceIds?: string[];    // never auto-assign guests booked for these services
}

export interface QueueAssignmentSettings {
  waitApproachingMin: number; waitExceededMin: number; waitSevereMin: number; waitCriticalMin: number;
  stuckMinutes: number; longServiceFactor: number; congestionWaitingPerTech: number; lateGraceMin: number;
  rotationPolicy: RotationPolicyValue; fixedOrder: string[];
  autoEnabled: boolean; autoConfidenceFloor: number; autoMaxPerRun: number; autoDelaySeconds: number; autoExclusions: AutoExclusions;
  /** Fair Turn §9: AUTOMATIC | RECOMMEND_AND_CONFIRM | MANUAL (600) */
  assignmentMode: AssignmentMode;
  /** Fair Turn house rules — a PATCH layer (only the keys a scope set); the effective settings carry the merged policy */
  turnPolicy: Partial<TurnPolicy>;
}
export interface EffectiveQueueAssignmentSettings extends QueueAssignmentSettings {
  /** the merged turn policy: Recommended Nail Salon Default ← salon ← branch */
  turnPolicy: TurnPolicy;
  tenantVersion: number; branchVersion: number;
  /** "<tenantVersion>.<branchVersion>" — recorded on every recommendation */
  configVersion: string;
  salonAutoKilled: boolean; salonAutoKilledReason: string | null; platformAutoActionsDisabled: boolean;
  /** may an auto-run act right now (every switch), and if not, the first switch that stops it */
  autoAllowed: boolean; autoBlockedBy: null | 'platform' | 'salon_kill_switch' | 'disabled' | 'mode';
}

export const SETTINGS_DEFAULTS: QueueAssignmentSettings = {
  waitApproachingMin: 10, waitExceededMin: 20, waitSevereMin: 30, waitCriticalMin: 45,
  stuckMinutes: 30, longServiceFactor: 1.5, congestionWaitingPerTech: 2, lateGraceMin: 10,
  rotationPolicy: 'traditional_weighted_rotation', fixedOrder: [],
  autoEnabled: false, autoConfidenceFloor: 0.75, autoMaxPerRun: 5, autoDelaySeconds: 120, autoExclusions: {},
  assignmentMode: 'RECOMMEND_AND_CONFIRM', turnPolicy: {},
};

export interface SettingsScope { tenantId: string; branchId: string | null }
export interface SettingsActor { userId: string | null; role?: string | null }
export type SettingsPatch = Partial<QueueAssignmentSettings>;

export class QueueSettingsValidationError extends Error { constructor(m: string) { super(m); this.name = 'QueueSettingsValidationError'; } }

/**
 * Validate a patch; returns the problems (empty = fine). `base` = the values the patch lands on (the current EFFECTIVE
 * settings of that scope) — the rising-thresholds rule is checked on the result, not on the defaults: a location that
 * set only "critical = 33" under a salon "severe = 35" would otherwise save an impossible ladder (BUILD_PLAN Phase 6).
 * `scope` 'salon' refuses a fixed turn order — it names one location's technicians.
 */
export function validateSettingsPatch(p: SettingsPatch, base: QueueAssignmentSettings = SETTINGS_DEFAULTS, scope: 'salon' | 'branch' = 'branch'): string[] {
  const out: string[] = [];
  const int = (k: keyof QueueAssignmentSettings, min: number, max: number) => {
    const v = p[k] as unknown;
    if (v !== undefined && !(Number.isInteger(v) && (v as number) >= min && (v as number) <= max)) out.push(`${String(k)} must be a whole number from ${min} to ${max}.`);
  };
  int('waitApproachingMin', 0, 600); int('waitExceededMin', 0, 600); int('waitSevereMin', 0, 600); int('waitCriticalMin', 0, 600);
  int('stuckMinutes', 5, 600); int('lateGraceMin', 0, 240); int('autoMaxPerRun', 0, 100); int('autoDelaySeconds', 0, 3600);
  if (p.longServiceFactor !== undefined && !(typeof p.longServiceFactor === 'number' && p.longServiceFactor >= 1 && p.longServiceFactor <= 10)) out.push('longServiceFactor must be from 1 to 10.');
  if (p.congestionWaitingPerTech !== undefined && !(typeof p.congestionWaitingPerTech === 'number' && p.congestionWaitingPerTech > 0 && p.congestionWaitingPerTech <= 50)) out.push('congestionWaitingPerTech must be above 0 and at most 50.');
  if (p.autoConfidenceFloor !== undefined && !(typeof p.autoConfidenceFloor === 'number' && p.autoConfidenceFloor >= 0 && p.autoConfidenceFloor <= 1)) out.push('autoConfidenceFloor must be from 0 to 1.');
  if (p.rotationPolicy !== undefined && !(ROTATION_POLICY_VALUES as readonly string[]).includes(p.rotationPolicy)) out.push('Unknown rotation policy.');
  if (p.fixedOrder !== undefined && !(Array.isArray(p.fixedOrder) && p.fixedOrder.every((x) => typeof x === 'string'))) out.push('fixedOrder must be a list of technician ids.');
  if (scope === 'salon' && p.fixedOrder !== undefined) out.push('A fixed turn order names one location\u2019s technicians — set it on the location, not salon-wide.');
  if (p.autoExclusions !== undefined && (typeof p.autoExclusions !== 'object' || p.autoExclusions === null || Array.isArray(p.autoExclusions))) out.push('autoExclusions must be an object.');
  // Fair Turn §9 / §166: the mode, the turn policy, and no contradictory switches
  if (p.assignmentMode !== undefined && !(ASSIGNMENT_MODES as readonly string[]).includes(p.assignmentMode as string)) out.push('assignmentMode must be AUTOMATIC, RECOMMEND_AND_CONFIRM or MANUAL.');
  if (p.turnPolicy !== undefined) out.push(...validateTurnPolicyPatch(stripNulls(p.turnPolicy), scope));
  if (p.autoEnabled === true && p.assignmentMode !== undefined && p.assignmentMode !== 'AUTOMATIC') out.push(`TURN_POLICY_INVALID: automatic assignment cannot be switched on while the assignment mode is ${p.assignmentMode}.`);
  if (p.assignmentMode === 'AUTOMATIC' && p.autoEnabled === false) out.push('TURN_POLICY_INVALID: the AUTOMATIC mode with automatic assignment switched off is a contradiction — choose RECOMMEND_AND_CONFIRM, or pause it with the kill switch.');
  if (Object.keys(p).length === 0) out.push('Nothing to change.');
  const w = { ...base, ...p };
  if (p.waitApproachingMin !== undefined || p.waitExceededMin !== undefined || p.waitSevereMin !== undefined || p.waitCriticalMin !== undefined) {
    if (!(w.waitApproachingMin <= w.waitExceededMin && w.waitExceededMin <= w.waitSevereMin && w.waitSevereMin <= w.waitCriticalMin)) out.push('Wait thresholds must rise: approaching ≤ exceeded ≤ severe ≤ critical.');
  }
  return out;
}

/** Layer a branch row over the salon row (null = inherit) and work out whether auto-runs may act. */
export function resolveEffective(tenantRow: (QueueAssignmentSettings & { version: number; autoKilled: boolean; autoKilledReason: string | null }) | null,
  branchRow: (Partial<QueueAssignmentSettings> & { version: number }) | null, platformAutoActionsDisabled: boolean): EffectiveQueueAssignmentSettings {
  const base: QueueAssignmentSettings = tenantRow ? pick(tenantRow) : { ...SETTINGS_DEFAULTS };
  const merged: QueueAssignmentSettings = { ...base };
  if (branchRow) for (const k of Object.keys(SETTINGS_DEFAULTS) as (keyof QueueAssignmentSettings)[]) {
    const v = branchRow[k];
    if (v !== undefined && v !== null) (merged as any)[k] = v;
  }
  // Oct 13 2026 (FLOW T1): a legacy value still in a row (written before the merge) resolves to its fairness mode
  merged.rotationPolicy = normalizeRotationPolicy(merged.rotationPolicy);
  const tenantVersion = tenantRow?.version ?? 0; const branchVersion = branchRow?.version ?? 0;
  const salonAutoKilled = !!tenantRow?.autoKilled;
  // the turn policy merges per KEY (a branch overrides only what it set); the mode is a plain override
  const turnPolicy = mergeTurnPolicy(tenantRow?.turnPolicy ?? {}, branchRow?.turnPolicy ?? {});
  const autoBlockedBy: EffectiveQueueAssignmentSettings['autoBlockedBy'] =
    platformAutoActionsDisabled ? 'platform' : salonAutoKilled ? 'salon_kill_switch' : !merged.autoEnabled ? 'disabled' : merged.assignmentMode !== 'AUTOMATIC' ? 'mode' : null;
  return { ...merged, turnPolicy, tenantVersion, branchVersion, configVersion: `${tenantVersion}.${branchVersion}`, salonAutoKilled,
    salonAutoKilledReason: tenantRow?.autoKilledReason ?? null, platformAutoActionsDisabled, autoAllowed: autoBlockedBy === null, autoBlockedBy };
}
function pick(r: QueueAssignmentSettings): QueueAssignmentSettings {
  const o: any = {}; for (const k of Object.keys(SETTINGS_DEFAULTS)) o[k] = (r as any)[k] ?? (SETTINGS_DEFAULTS as any)[k]; return o;
}
/** a turn-policy patch key set to null means "remove my override" (inherit) — never stored as null */
export function stripNulls<T extends object>(o: T | null | undefined): Partial<T> {
  const out: any = {}; if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}
/**
 * Fair Turn §9 / §166: the switches implied by a patch. Switching automatic assignment ON chooses the AUTOMATIC mode (the
 * auto card's "turn on"); choosing RECOMMEND_AND_CONFIRM or MANUAL switches it OFF. Explicit contradictions are refused
 * by validateSettingsPatch, never silently fixed.
 */
export function normalizeModePatch(p: SettingsPatch): SettingsPatch {
  const out: SettingsPatch = { ...p };
  // Oct 13 2026 (FLOW T1): a legacy scoring policy from an old screen is STORED as its fairness mode — one engine
  if (p.rotationPolicy !== undefined && (ROTATION_POLICY_VALUES as readonly string[]).includes(p.rotationPolicy)) out.rotationPolicy = normalizeRotationPolicy(p.rotationPolicy);
  if (p.autoEnabled === true && p.assignmentMode === undefined) out.assignmentMode = 'AUTOMATIC';
  if (p.assignmentMode !== undefined && p.assignmentMode !== 'AUTOMATIC' && p.autoEnabled === undefined) out.autoEnabled = false;
  if (p.assignmentMode === 'AUTOMATIC' && p.autoEnabled === undefined) out.autoEnabled = true;
  return out;
}

export interface QueueAssignmentSettingsPort {
  effective(scope: SettingsScope): Promise<EffectiveQueueAssignmentSettings>;
  /** the salon-wide row (raw — what the settings screen edits) */
  tenantSettings(tenantId: string): Promise<QueueAssignmentSettings & { version: number; autoKilled: boolean; autoKilledReason: string | null }>;
  /** the branch row's OWN values (null = inherits) */
  branchOverrides(scope: { tenantId: string; branchId: string }): Promise<Partial<QueueAssignmentSettings> & { version: number }>;
  /** expectedVersion (optional) refuses a stale save; returns the new effective settings */
  update(scope: SettingsScope, patch: SettingsPatch, actor: SettingsActor, opts?: { expectedVersion?: number; reason?: string | null; change?: string }): Promise<EffectiveQueueAssignmentSettings>;
  /** the salon-wide auto-assign kill switch (on = no branch auto-assigns) */
  setSalonKill(tenantId: string, killed: boolean, actor: SettingsActor, reason: string | null, opts?: { change?: string }): Promise<EffectiveQueueAssignmentSettings>;
  versions(scope: SettingsScope, limit?: number): Promise<{ version: number; branchId: string | null; change: string; reason: string | null; changedBy: string | null; createdAt: string; settings: unknown }[]>;
  /** clears inherited branch values back to null (inherit the salon) */
  clearBranchOverrides(scope: { tenantId: string; branchId: string }, keys: (keyof QueueAssignmentSettings)[], actor: SettingsActor): Promise<EffectiveQueueAssignmentSettings>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** updated_by / changed_by / audit_logs.user_id are UUID columns: a background job ('' / 'system') is recorded as null. */
const norm = (a: SettingsActor): SettingsActor => ({ userId: a?.userId && UUID_RE.test(a.userId) ? a.userId : null, role: a?.role ?? null });

export class QueueSettingsConflictError extends Error { constructor(public readonly currentVersion: number) { super('These settings changed since you opened them. Reload and try again.'); this.name = 'QueueSettingsConflictError'; } }

// ── PostgreSQL ────────────────────────────────────────────────────────────────────────────────────────────────────
const COLS: [keyof QueueAssignmentSettings, string][] = [
  ['waitApproachingMin', 'wait_approaching_min'], ['waitExceededMin', 'wait_exceeded_min'], ['waitSevereMin', 'wait_severe_min'], ['waitCriticalMin', 'wait_critical_min'],
  ['stuckMinutes', 'stuck_minutes'], ['longServiceFactor', 'long_service_factor'], ['congestionWaitingPerTech', 'congestion_waiting_per_tech'], ['lateGraceMin', 'late_grace_min'],
  ['autoEnabled', 'auto_enabled'], ['autoConfidenceFloor', 'auto_confidence_floor'], ['autoMaxPerRun', 'auto_max_per_run'], ['autoDelaySeconds', 'auto_delay_seconds'], ['autoExclusions', 'auto_exclusions'],
  ['assignmentMode', 'assignment_mode'],
];
const NUMERIC = new Set(['longServiceFactor', 'congestionWaitingPerTech', 'autoConfidenceFloor']);
const rows = (r: any): any[] => r?.rows ?? [];
function fromRow(r: any, nullable: boolean): any {
  const o: any = {};
  for (const [k, c] of COLS) {
    const v = r?.[c];
    if (v === null || v === undefined) { if (!nullable) o[k] = (SETTINGS_DEFAULTS as any)[k]; continue; }
    o[k] = NUMERIC.has(k) ? Number(v) : k === 'autoExclusions' ? (typeof v === 'string' ? JSON.parse(v) : v) : k === 'autoEnabled' ? !!v : k === 'assignmentMode' ? String(v) : Number(v);
  }
  // the turn policy is a per-key layer (600): the salon row is {} by default, a branch row null = inherit everything
  const tp = r?.turn_policy;
  o.turnPolicy = tp == null ? (nullable ? undefined : {}) : stripNulls(typeof tp === 'string' ? JSON.parse(tp) : tp);
  if (o.turnPolicy === undefined) delete o.turnPolicy;
  return o;
}

export class KyselyQueueAssignmentSettings implements QueueAssignmentSettingsPort {
  constructor(private readonly db: Kysely<any>, private readonly outbox: OutboxWriter | null = null) {}
  private get d(): any { return this.db; }

  private async platformDisabled(): Promise<boolean> {
    const r = rows(await sql`select value from platform_settings where setting_key = 'ai.auto_actions_disabled' limit 1`.execute(this.d).catch(() => ({ rows: [] })))[0];
    return r ? r.value === true || r.value === 'true' : false;
  }
  private async tenantRow(tenantId: string, q: any = this.d): Promise<any | null> {
    return rows(await sql`select * from queue_assignment_tenant_settings where tenant_id = ${tenantId}`.execute(q))[0] ?? null;
  }
  private async rotationRow(tenantId: string, branchId: string | null, q: any = this.d): Promise<any | null> {
    if (!branchId) return null;
    return rows(await sql`select policy, fixed_order from queue_assignment_rotation_state where tenant_id = ${tenantId} and branch_id = ${branchId}`.execute(q))[0] ?? null;
  }
  async tenantSettings(tenantId: string) {
    const t = await this.tenantRow(tenantId);
    return { ...SETTINGS_DEFAULTS, ...(t ? fromRow(t, false) : {}), rotationPolicy: (t?.rotation_policy ?? SETTINGS_DEFAULTS.rotationPolicy) as RotationPolicyValue, fixedOrder: [],
      version: t ? Number(t.version) : 0, autoKilled: !!t?.auto_killed, autoKilledReason: t?.auto_killed_reason ?? null };
  }
  async branchOverrides(scope: { tenantId: string; branchId: string }) {
    const b = rows(await sql`select * from queue_assignment_settings where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(this.d))[0];
    const rot = await this.rotationRow(scope.tenantId, scope.branchId);
    // A null column = "the salon's value" (migration 527 made the legacy 333/335 columns nullable too; before that a
    // branch row froze every threshold at the old defaults the moment anyone saved one value on the location).
    const fixed = rot && Array.isArray(rot.fixed_order) && rot.fixed_order.length ? { fixedOrder: rot.fixed_order as string[] } : {};
    return { ...(b ? fromRow(b, true) : {}), ...(rot?.policy ? { rotationPolicy: rot.policy as RotationPolicyValue } : {}), ...fixed, version: b ? Number(b.version) : 0 };
  }
  async effective(scope: SettingsScope): Promise<EffectiveQueueAssignmentSettings> {
    const [row, platform] = await Promise.all([this.tenantRow(scope.tenantId), this.platformDisabled()]);
    const tenant = row ? await this.tenantSettings(scope.tenantId) : null;
    const branch = scope.branchId ? await this.branchOverrides({ tenantId: scope.tenantId, branchId: scope.branchId }) : null;
    return resolveEffective(tenant as any, branch as any, platform);
  }

  async update(scope: SettingsScope, patch: SettingsPatch, actor: SettingsActor, opts: { expectedVersion?: number; reason?: string | null; change?: string } = {}): Promise<EffectiveQueueAssignmentSettings> {
    actor = norm(actor);
    patch = normalizeModePatch(patch);
    await this.d.transaction().execute(async (trx: any) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${'qasettings:' + scope.tenantId + ':' + (scope.branchId ?? '')}, 0))`.execute(trx);
      // validated against what the patch lands on (salon scope: the salon row; branch scope: the location's effective values)
      const base = await this.effectiveIn(trx, scope);
      const problems = validateSettingsPatch(patch, base, scope.branchId ? 'branch' : 'salon');
      if (problems.length) throw new QueueSettingsValidationError(problems.join(' '));
      const { rotationPolicy, fixedOrder, turnPolicy, ...rest } = patch;
      const tpJson = turnPolicy === undefined ? null : JSON.stringify(turnPolicy);
      const set = COLS.filter(([k]) => (rest as any)[k] !== undefined).map(([k, c]) => [c, k === 'autoExclusions' ? JSON.stringify((rest as any)[k]) : (rest as any)[k]] as [string, unknown]);
      let version: number;
      if (!scope.branchId) {
        const cur = await this.tenantRow(scope.tenantId, trx);
        if (opts.expectedVersion !== undefined && (cur ? Number(cur.version) : 0) !== opts.expectedVersion) throw new QueueSettingsConflictError(cur ? Number(cur.version) : 0);
        if (!cur) await sql`insert into queue_assignment_tenant_settings (tenant_id, version, updated_by) values (${scope.tenantId}, 0, ${actor.userId})`.execute(trx);
        for (const [c, v] of set) await sql`update queue_assignment_tenant_settings set ${sql.ref(c)} = ${c === 'auto_exclusions' ? sql`${v}::jsonb` : v} where tenant_id = ${scope.tenantId}`.execute(trx);
        if (rotationPolicy !== undefined) await sql`update queue_assignment_tenant_settings set rotation_policy = ${rotationPolicy} where tenant_id = ${scope.tenantId}`.execute(trx);
        if (tpJson) await sql`update queue_assignment_tenant_settings set turn_policy = jsonb_strip_nulls(coalesce(turn_policy, '{}'::jsonb) || ${tpJson}::jsonb) where tenant_id = ${scope.tenantId}`.execute(trx);
        const r = rows(await sql`update queue_assignment_tenant_settings set version = version + 1, updated_by = ${actor.userId}, updated_at = now() where tenant_id = ${scope.tenantId} returning version`.execute(trx))[0];
        version = Number(r.version);
      } else {
        const cur = rows(await sql`select version from queue_assignment_settings where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx))[0];
        if (opts.expectedVersion !== undefined && (cur ? Number(cur.version) : 0) !== opts.expectedVersion) throw new QueueSettingsConflictError(cur ? Number(cur.version) : 0);
        if (!cur) await sql`insert into queue_assignment_settings (tenant_id, branch_id, version, updated_by) values (${scope.tenantId}, ${scope.branchId}, 0, ${actor.userId})`.execute(trx);
        for (const [c, v] of set) await sql`update queue_assignment_settings set ${sql.ref(c)} = ${c === 'auto_exclusions' ? sql`${v}::jsonb` : v} where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx);
        if (tpJson) await sql`update queue_assignment_settings set turn_policy = nullif(jsonb_strip_nulls(coalesce(turn_policy, '{}'::jsonb) || ${tpJson}::jsonb), '{}'::jsonb) where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx);
        if (patch.autoEnabled !== undefined || patch.autoConfidenceFloor !== undefined || patch.autoMaxPerRun !== undefined)
          await sql`update queue_assignment_settings set auto_updated_by = ${actor.userId}, auto_updated_at = now() where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx);
        if (rotationPolicy !== undefined || fixedOrder !== undefined) {
          // policy null = the salon's policy (a location that sets only its turn order keeps following the salon)
          await sql`insert into queue_assignment_rotation_state (tenant_id, branch_id, policy, fixed_order, updated_by) values (${scope.tenantId}, ${scope.branchId}, ${rotationPolicy ?? null}, ${JSON.stringify(fixedOrder ?? [])}::jsonb, ${actor.userId})
                    on conflict (tenant_id, branch_id) do update set policy = coalesce(${rotationPolicy ?? null}, queue_assignment_rotation_state.policy),
                      fixed_order = coalesce(${fixedOrder === undefined ? null : JSON.stringify(fixedOrder)}::jsonb, queue_assignment_rotation_state.fixed_order),
                      updated_by = excluded.updated_by, updated_at = now(), version = queue_assignment_rotation_state.version + 1`.execute(trx);
        }
        const r = rows(await sql`update queue_assignment_settings set version = version + 1, updated_by = ${actor.userId}, updated_at = now() where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId} returning version`.execute(trx))[0];
        version = Number(r.version);
      }
      await this.snapshot(trx, scope, version, opts.change ?? 'settings', opts.reason ?? null, actor, patch);
      // a kill through update() (the location's kill switch: autoEnabled off, change 'kill') is announced exactly like the
      // salon kill in setSalonKill — same event, same transaction, so it exists only if the switch really flipped
      if (opts.change === 'kill' && this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNMENT_DISABLED, tenantId: scope.tenantId,
        branchId: scope.branchId ?? undefined, aggregateType: 'queue_assignment_settings', aggregateId: scope.branchId ?? scope.tenantId, actorId: actor.userId ?? undefined,
        actorType: actor.userId ? 'user' : 'system', payload: { scope: scope.branchId ? 'branch' : 'salon', reason: opts.reason ?? null } }));
    });
    return this.effective(scope);
  }

  async setSalonKill(tenantId: string, killed: boolean, actor: SettingsActor, reason: string | null, opts: { change?: string } = {}): Promise<EffectiveQueueAssignmentSettings> {
    actor = norm(actor);
    await this.d.transaction().execute(async (trx: any) => {
      await sql`insert into queue_assignment_tenant_settings (tenant_id, version, updated_by) values (${tenantId}, 0, ${actor.userId}) on conflict (tenant_id) do nothing`.execute(trx);
      const r = rows(await sql`update queue_assignment_tenant_settings set auto_killed = ${killed}, auto_killed_reason = ${killed ? reason : null}, version = version + 1, updated_by = ${actor.userId}, updated_at = now()
                                where tenant_id = ${tenantId} returning version`.execute(trx))[0];
      await this.snapshot(trx, { tenantId, branchId: null }, Number(r.version), opts.change ?? (killed ? 'kill' : 'unkill'), reason, actor, { autoKilled: killed } as any);
      if (killed && this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.QUEUE_AUTO_ASSIGNMENT_DISABLED, tenantId, aggregateType: 'queue_assignment_settings', aggregateId: tenantId,
        actorId: actor.userId ?? undefined, actorType: actor.userId ? 'user' : 'system', payload: { scope: 'salon', reason } }));
    });
    return this.effective({ tenantId, branchId: null });
  }

  async clearBranchOverrides(scope: { tenantId: string; branchId: string }, keys: (keyof QueueAssignmentSettings)[], actor: SettingsActor): Promise<EffectiveQueueAssignmentSettings> {
    actor = norm(actor);
    // every column is nullable since migration 527 — the wait thresholds and auto switches inherit like the rest
    const cols = COLS.filter(([k]) => keys.includes(k)).map(([, c]) => c);
    await this.d.transaction().execute(async (trx: any) => {
      for (const c of cols) await sql`update queue_assignment_settings set ${sql.ref(c)} = null where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx);
      if (keys.includes('rotationPolicy')) await sql`update queue_assignment_rotation_state set policy = null, updated_at = now() where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx);
      if (keys.includes('turnPolicy')) await sql`update queue_assignment_settings set turn_policy = null where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx);
      if (keys.includes('fixedOrder')) await sql`update queue_assignment_rotation_state set fixed_order = '[]'::jsonb, updated_at = now() where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx);
      const r = rows(await sql`update queue_assignment_settings set version = version + 1, updated_by = ${actor.userId}, updated_at = now() where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId} returning version`.execute(trx))[0];
      if (r) await this.snapshot(trx, scope, Number(r.version), 'inherit', null, actor, { inherit: cols } as any);
    });
    return this.effective(scope);
  }

  async versions(scope: SettingsScope, limit = 50) {
    const r = rows(await sql`select version, branch_id, change, reason, changed_by, created_at, settings from queue_assignment_settings_versions
                             where tenant_id = ${scope.tenantId} and (branch_id is null or branch_id = ${scope.branchId}::uuid)
                             order by created_at desc limit ${Math.min(200, Math.max(1, limit))}`.execute(this.d));
    return r.map((x) => ({ version: Number(x.version), branchId: x.branch_id ? String(x.branch_id) : null, change: String(x.change), reason: x.reason ?? null,
      changedBy: x.changed_by ? String(x.changed_by) : null, createdAt: new Date(x.created_at).toISOString(), settings: x.settings }));
  }

  /** effective settings read on the given connection (the update's own transaction) */
  private async effectiveIn(q: any, scope: SettingsScope): Promise<EffectiveQueueAssignmentSettings> {
    const t = await this.tenantRow(scope.tenantId, q);
    const tenant = t ? { ...SETTINGS_DEFAULTS, ...fromRow(t, false), rotationPolicy: (t.rotation_policy ?? SETTINGS_DEFAULTS.rotationPolicy) as RotationPolicyValue, fixedOrder: [], version: Number(t.version), autoKilled: !!t.auto_killed, autoKilledReason: t.auto_killed_reason ?? null } : null;
    let branch: any = null;
    if (scope.branchId) {
      const b = rows(await sql`select * from queue_assignment_settings where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(q))[0];
      const rot = await this.rotationRow(scope.tenantId, scope.branchId, q);
      branch = { ...(b ? fromRow(b, true) : {}), ...(rot?.policy ? { rotationPolicy: rot.policy } : {}), ...(rot && Array.isArray(rot.fixed_order) && rot.fixed_order.length ? { fixedOrder: rot.fixed_order } : {}), version: b ? Number(b.version) : 0 };
    }
    return resolveEffective(tenant as any, branch, false);
  }

  /** the version snapshot, the audit row and the settings event — in the caller's transaction */
  private async snapshot(trx: any, scope: SettingsScope, version: number, change: string, reason: string | null, actor: SettingsActor, patch: unknown) {
    const eff = await (async () => {
      const t = rows(await sql`select * from queue_assignment_tenant_settings where tenant_id = ${scope.tenantId}`.execute(trx))[0] ?? null;
      const b = scope.branchId ? rows(await sql`select * from queue_assignment_settings where tenant_id = ${scope.tenantId} and branch_id = ${scope.branchId}`.execute(trx))[0] ?? null : null;
      return { salon: t ? fromRow(t, false) : SETTINGS_DEFAULTS, branch: b ? fromRow(b, true) : null };
    })();
    await sql`insert into queue_assignment_settings_versions (tenant_id, branch_id, version, settings, change, reason, changed_by)
              values (${scope.tenantId}, ${scope.branchId}, ${version}, ${JSON.stringify({ ...eff, patch })}::jsonb, ${change}, ${reason}, ${actor.userId})`.execute(trx);
    await sql`insert into audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
              values (${scope.tenantId}, ${scope.branchId}, ${actor.userId}, ${actor.role ?? null}, ${'ai_queue_assignment_settings_' + change}, 'queue_assignment_settings', ${scope.branchId ?? scope.tenantId},
                      ${JSON.stringify({ version, reason, patch })}::jsonb)`.execute(trx);
    if (this.outbox) await this.outbox.write(trx, createDomainEvent({ eventType: DOMAIN_EVENTS.QUEUE_ASSIGNMENT_SETTINGS_CHANGED, tenantId: scope.tenantId, branchId: scope.branchId ?? undefined,
      aggregateType: 'queue_assignment_settings', aggregateId: scope.branchId ?? scope.tenantId, actorId: actor.userId ?? undefined, actorType: actor.userId ? 'user' : 'system',
      payload: { scope: scope.branchId ? 'branch' : 'salon', version, change, reason } }));
  }
}

// ── in memory (tests / DB-less) ───────────────────────────────────────────────────────────────────────────────────
export class InMemoryQueueAssignmentSettings implements QueueAssignmentSettingsPort {
  private tenants = new Map<string, QueueAssignmentSettings & { version: number; autoKilled: boolean; autoKilledReason: string | null }>();
  private branches = new Map<string, Partial<QueueAssignmentSettings> & { version: number }>();
  private log: { tenantId: string; branchId: string | null; version: number; change: string; reason: string | null; changedBy: string | null; createdAt: string; settings: unknown }[] = [];
  platformDisabled = false;
  async tenantSettings(tenantId: string) { return this.tenants.get(tenantId) ?? { ...SETTINGS_DEFAULTS, version: 0, autoKilled: false, autoKilledReason: null }; }
  async branchOverrides(scope: { tenantId: string; branchId: string }) { return this.branches.get(scope.tenantId + ':' + scope.branchId) ?? { version: 0 }; }
  async effective(scope: SettingsScope) {
    const t = this.tenants.get(scope.tenantId) ?? null;
    const b = scope.branchId ? this.branches.get(scope.tenantId + ':' + scope.branchId) ?? null : null;
    return resolveEffective(t, b, this.platformDisabled);
  }
  async update(scope: SettingsScope, patch: SettingsPatch, actor: SettingsActor, opts: { expectedVersion?: number; reason?: string | null; change?: string } = {}) {
    patch = normalizeModePatch(patch);
    const problems = validateSettingsPatch(patch, await this.effective(scope), scope.branchId ? 'branch' : 'salon');
    if (problems.length) throw new QueueSettingsValidationError(problems.join(' '));
    if (!scope.branchId) {
      const cur = await this.tenantSettings(scope.tenantId);
      if (opts.expectedVersion !== undefined && cur.version !== opts.expectedVersion) throw new QueueSettingsConflictError(cur.version);
      const next = { ...cur, ...patch, turnPolicy: stripNulls({ ...(cur.turnPolicy ?? {}), ...(patch.turnPolicy ?? {}) }), version: cur.version + 1 }; this.tenants.set(scope.tenantId, next);
      this.log.unshift({ tenantId: scope.tenantId, branchId: null, version: next.version, change: opts.change ?? 'settings', reason: opts.reason ?? null, changedBy: actor.userId, createdAt: new Date().toISOString(), settings: next });
    } else {
      const key = scope.tenantId + ':' + scope.branchId; const cur = this.branches.get(key) ?? { version: 0 };
      if (opts.expectedVersion !== undefined && cur.version !== opts.expectedVersion) throw new QueueSettingsConflictError(cur.version);
      const next = { ...cur, ...patch, ...(patch.turnPolicy !== undefined || cur.turnPolicy ? { turnPolicy: stripNulls({ ...(cur.turnPolicy ?? {}), ...(patch.turnPolicy ?? {}) }) } : {}), version: cur.version + 1 }; this.branches.set(key, next);
      this.log.unshift({ tenantId: scope.tenantId, branchId: scope.branchId, version: next.version, change: opts.change ?? 'settings', reason: opts.reason ?? null, changedBy: actor.userId, createdAt: new Date().toISOString(), settings: next });
    }
    return this.effective(scope);
  }
  async setSalonKill(tenantId: string, killed: boolean, actor: SettingsActor, reason: string | null, opts: { change?: string } = {}) {
    const cur = await this.tenantSettings(tenantId);
    this.tenants.set(tenantId, { ...cur, autoKilled: killed, autoKilledReason: killed ? reason : null, version: cur.version + 1 });
    this.log.unshift({ tenantId, branchId: null, version: cur.version + 1, change: opts.change ?? (killed ? 'kill' : 'unkill'), reason, changedBy: actor.userId, createdAt: new Date().toISOString(), settings: {} });
    return this.effective({ tenantId, branchId: null });
  }
  async clearBranchOverrides(scope: { tenantId: string; branchId: string }, keys: (keyof QueueAssignmentSettings)[], actor: SettingsActor) {
    const key = scope.tenantId + ':' + scope.branchId; const cur: any = { ...(this.branches.get(key) ?? { version: 0 }) };
    for (const k of keys) delete cur[k]; cur.version += 1; this.branches.set(key, cur);
    this.log.unshift({ tenantId: scope.tenantId, branchId: scope.branchId, version: cur.version, change: 'inherit', reason: null, changedBy: actor.userId, createdAt: new Date().toISOString(), settings: cur });
    return this.effective(scope);
  }
  async versions(scope: SettingsScope, limit = 50) {
    return this.log.filter((l) => l.tenantId === scope.tenantId && (!scope.branchId || l.branchId === scope.branchId || l.branchId === null)).slice(0, limit)
      .filter((l) => scope.branchId ? true : l.branchId === null)
      .map(({ tenantId: _t, ...r }) => r);
  }
}
