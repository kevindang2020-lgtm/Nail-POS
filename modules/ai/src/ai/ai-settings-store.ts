// ai-settings-store.ts — Constitution 10 §52–§53: where a tenant's AI settings actually live.
//
// THE GAP THIS CLOSES: the safety policy engine honours `TenantSafetySettings` at runtime and the dashboard
// reports the effective automation level — but nothing ever stored them. A tenant could not change a setting
// the platform was already obeying, which is the worst of both: the mechanism exists and is unreachable.
//
// NOT a new table. `tenant_settings` (migration 016) is a category-keyed store built for exactly this, with
// `branch_id NULL = tenant-wide` already in its shape. A second AI-specific settings table would be the
// duplicate-architecture mistake this whole arc has been avoiding.
//
// §110 is enforced on the WRITE, not only on read: a settings payload that asks for more automation than the
// platform allows is REJECTED with the reason, rather than stored and quietly clamped later. Storing a lie and
// correcting it at read time means the UI shows the tenant a setting they do not actually have.
import { notifySettingsChanged, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { AUTOMATION_LEVELS, PLATFORM_MAX_AUTOMATION, stricter, type AutomationLevel, type TenantSafetySettings } from './ai-safety-policy';
import { AI_TASKS } from './ai-task-registry';
import { AI_TOOLS } from './ai-tool-registry';

export const AI_SETTINGS_CATEGORY = 'ai-platform';

export class AiSettingsValidationError extends Error {
  readonly status = 400;
  constructor(message: string) { super(message); this.name = 'AiSettingsValidationError'; }
}

export interface AiSettingsStore {
  get(tenantId: string, branchId?: string | null): Promise<TenantSafetySettings>;
  put(tenantId: string, settings: TenantSafetySettings, actorUserId: string | null, branchId?: string | null): Promise<TenantSafetySettings>;
}

/**
 * §110 on the write path. Returns the settings to store, or throws with a reason a UI can show.
 *
 * The rejections are deliberate rather than silent clamps: a tenant who sets `AUTOMATIC` on a DRAFT task should
 * be told the platform caps it at DRAFT, not left believing the setting took effect.
 */
export function validateAiSettings(raw: unknown): TenantSafetySettings {
  const input = (raw ?? {}) as Record<string, unknown>;
  const out: TenantSafetySettings = {};

  if (input.automation !== undefined) {
    if (typeof input.automation !== 'object' || input.automation === null || Array.isArray(input.automation)) throw new AiSettingsValidationError('automation must be an object of taskKey → level');
    const automation: Record<string, AutomationLevel> = {};
    for (const [taskKey, level] of Object.entries(input.automation as Record<string, unknown>)) {
      if (!AI_TASKS[taskKey]) throw new AiSettingsValidationError(`unknown AI task "${taskKey}"`);
      if (typeof level !== 'string' || !(AUTOMATION_LEVELS as readonly string[]).includes(level)) {
        throw new AiSettingsValidationError(`"${level}" is not an automation level (${AUTOMATION_LEVELS.join(' < ')})`);
      }
      const ceiling = PLATFORM_MAX_AUTOMATION[taskKey] ?? 'SUGGEST_ONLY';
      if (stricter(ceiling, level as AutomationLevel) !== level) {
        throw new AiSettingsValidationError(`${taskKey} cannot be set to ${level}: the platform allows at most ${ceiling} for this task (§110 — a tenant may tighten safety, never weaken it)`);
      }
      automation[taskKey] = level as AutomationLevel;
    }
    out.automation = automation;
  }

  if (input.autoActionsDisabled !== undefined) {
    if (typeof input.autoActionsDisabled !== 'boolean') throw new AiSettingsValidationError('autoActionsDisabled must be a boolean');
    out.autoActionsDisabled = input.autoActionsDisabled;
  }

  // §113 the salon's "turn off all AI" switch (N-4 / SD-23). Before this the POS sent it on every save and the server
  // had no such setting — the checkbox did nothing. Tightening only, so it needs no ceiling check.
  if (input.killSwitch !== undefined) {
    if (typeof input.killSwitch !== 'boolean') throw new AiSettingsValidationError('killSwitch must be a boolean');
    out.killSwitch = input.killSwitch;
  }

  for (const key of ['disabledTools', 'disabledTasks'] as const) {
    if (input[key] === undefined) continue;
    if (!Array.isArray(input[key]) || (input[key] as unknown[]).some((x) => typeof x !== 'string')) throw new AiSettingsValidationError(`${key} must be an array of strings`);
    const values = input[key] as string[];
    // A tenant may only disable something that EXISTS. Silently accepting a typo means a tenant believes they
    // switched something off that is still running.
    for (const v of values) {
      if (key === 'disabledTasks' && !AI_TASKS[v]) throw new AiSettingsValidationError(`unknown AI task "${v}"`);
      if (key === 'disabledTools' && !AI_TOOLS[v]) throw new AiSettingsValidationError(`unknown AI tool "${v}"`);
    }
    out[key] = [...new Set(values)];
  }

  if (input.allowPiiInText !== undefined) {
    if (!Array.isArray(input.allowPiiInText) || (input.allowPiiInText as unknown[]).some((x) => typeof x !== 'string')) throw new AiSettingsValidationError('allowPiiInText must be an array of strings');
    // Not validated against a platform list here on purpose: evaluateSafety INTERSECTS it with
    // PLATFORM_ALLOWED_PII, which is currently empty, so a tenant listing labels gains nothing either way. The
    // value is stored as given so the tenant's intent survives if the platform list ever widens.
    out.allowPiiInText = [...new Set(input.allowPiiInText as string[])];
  }

  const unknown = Object.keys(input).filter((k) => !['automation', 'autoActionsDisabled', 'killSwitch', 'disabledTools', 'disabledTasks', 'allowPiiInText'].includes(k));
  if (unknown.length) throw new AiSettingsValidationError(`unknown setting(s): ${unknown.join(', ')}`);
  return out;
}

/** Reads and writes the `ai-platform` category of the EXISTING tenant_settings table. */
export class KyselyAiSettingsStore implements AiSettingsStore {
  constructor(private readonly db: Kysely<DB>, private readonly rt?: RealtimeEmitter) {}

  async get(tenantId: string, branchId: string | null = null): Promise<TenantSafetySettings> {
    const rows = await sql<{ settings_json: unknown; branch_id: string | null }>`
      select settings_json, branch_id from tenant_settings
      where tenant_id = ${tenantId} and category = ${AI_SETTINGS_CATEGORY}
        and (branch_id is null ${branchId ? sql`or branch_id = ${branchId}` : sql``})
    `.execute(this.db as never).then((r) => r.rows).catch(() => []);
    if (!rows.length) return {};
    // §53: branch settings layer OVER tenant-wide ones, and compose by tightening — the same rule
    // evaluateSafety applies between platform and tenant, one level down.
    const tenantWide = rows.find((r) => r.branch_id === null)?.settings_json as TenantSafetySettings | undefined;
    const branch = branchId ? rows.find((r) => r.branch_id === branchId)?.settings_json as TenantSafetySettings | undefined : undefined;
    return mergeTightest(tenantWide ?? {}, branch ?? {});
  }

  async put(tenantId: string, settings: TenantSafetySettings, actorUserId: string | null, branchId: string | null = null): Promise<TenantSafetySettings> {
    const json = JSON.stringify(settings);
    await sql`
      insert into tenant_settings (id, tenant_id, branch_id, category, settings_json, updated_by_user_id, updated_at)
      values (gen_random_uuid(), ${tenantId}, ${branchId}, ${AI_SETTINGS_CATEGORY}, ${json}::jsonb, ${actorUserId}, now())
      -- Two conflict targets because migration 016's UNIQUE (tenant_id, branch_id, category) does not cover
      -- NULL branch_id (Postgres treats NULLs as distinct). Migration 441 adds the partial unique index that
      -- makes the tenant-wide case upsert-able; branch rows use the original constraint.
      on conflict ${branchId ? sql`(tenant_id, branch_id, category)` : sql`(tenant_id, category) where branch_id is null`}
      do update set settings_json = ${json}::jsonb, updated_by_user_id = ${actorUserId}, updated_at = now()
    `.execute(this.db as never);
    notifySettingsChanged(this.rt, tenantId, 'ai-platform');   // after the upsert succeeded
    return settings;
  }
}

/**
 * §53: compose tenant-wide and branch settings by taking the STRICTER of the two, never the branch's value
 * outright. A branch may tighten what the tenant set; it may not loosen it, for the same reason a tenant may
 * not loosen the platform's ceiling.
 */
export function mergeTightest(base: TenantSafetySettings, override: TenantSafetySettings): TenantSafetySettings {
  // Partial<Record<...>> values are possibly-undefined, which the compiler is right to insist on: a key can be
  // PRESENT with an undefined value, and treating that as "no setting" versus "set to undefined" is exactly the
  // sort of thing that silently drops a tenant's choice. Filtered explicitly rather than cast away.
  const automation: Record<string, AutomationLevel> = {};
  for (const [k, v] of Object.entries(base.automation ?? {})) if (v) automation[k] = v;
  for (const [k, v] of Object.entries(override.automation ?? {})) {
    if (!v) continue;
    const prior = automation[k];
    automation[k] = prior ? stricter(prior, v) : v;
  }
  return {
    automation: Object.keys(automation).length ? automation : undefined,
    // A switch is "on" if EITHER level turned it on — disabling is the tightening direction.
    autoActionsDisabled: base.autoActionsDisabled || override.autoActionsDisabled || undefined,
    // "Turn off all AI": the same rule — on at either level means on.
    killSwitch: base.killSwitch || override.killSwitch || undefined,
    disabledTools: union(base.disabledTools, override.disabledTools),
    disabledTasks: union(base.disabledTasks, override.disabledTasks),
    // PII permission is the loosening direction, so it INTERSECTS: a branch cannot permit what the tenant did not.
    allowPiiInText: base.allowPiiInText === undefined ? override.allowPiiInText
      : (override.allowPiiInText ?? base.allowPiiInText).filter((p) => base.allowPiiInText!.includes(p)),
  };
}

/**
 * N-4 / SD-23: the tenant safety settings a single AI call runs under — what the tenant SAVED (read through the store for
 * the call's tenant + branch), tightened by anything the caller passed explicitly. A caller can never loosen what the
 * salon saved: the two compose by `mergeTightest`.
 *
 * The read is best effort, like the platform switchboard read beside it: a failure is reported through `warn` (never a
 * silent swallow) and the call proceeds under the caller's settings. In practice the entitlement read that runs first
 * uses the same database, so a call that gets this far has a working one.
 */
export async function resolveTenantSafety(
  reader: ((tenantId: string, branchId: string | null) => Promise<TenantSafetySettings>) | undefined,
  tenantId: string, branchId: string | null, explicit: TenantSafetySettings | undefined,
  warn: (message: string) => void = () => undefined,
): Promise<TenantSafetySettings | undefined> {
  if (!reader) return explicit;
  let stored: TenantSafetySettings | undefined;
  try { stored = await reader(tenantId, branchId); }
  catch (e: unknown) { warn(`tenant AI settings unavailable for ${tenantId}: ${String((e as Error)?.message ?? e).slice(0, 200)}`); }
  if (!stored) return explicit;
  return explicit ? mergeTightest(stored, explicit) : stored;
}

function union(a?: readonly string[], b?: readonly string[]): string[] | undefined {
  if (!a && !b) return undefined;
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

/** In-memory store for dev/tests, and for a deployment with no database. */
export class InMemoryAiSettingsStore implements AiSettingsStore {
  private readonly rows = new Map<string, TenantSafetySettings>();
  private key(t: string, b: string | null) { return `${t}:${b ?? '*'}`; }
  async get(tenantId: string, branchId: string | null = null) {
    return mergeTightest(this.rows.get(this.key(tenantId, null)) ?? {}, branchId ? this.rows.get(this.key(tenantId, branchId)) ?? {} : {});
  }
  async put(tenantId: string, settings: TenantSafetySettings, _actor: string | null, branchId: string | null = null) {
    this.rows.set(this.key(tenantId, branchId), settings);
    return settings;
  }
}
