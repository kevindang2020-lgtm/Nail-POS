// ai-scheduling-settings.ts — tri-state (platform→tenant→branch) settings. Safety defaults that CANNOT be weakened:
//   • automation is OFF by default; enabling it requires explicit config AND a per-action allowlist,
//   • a kill switch at the tenant OR branch forces automation off regardless of any other setting,
//   • only a fixed set of SAFE auto-actions is ever permitted — anything else the tenant lists is dropped,
//   • human review is always required for material changes.
// "disabled wins" downward. Weights are tenant-configurable (Stage 5) but hard constraints are never weight-driven.
import type { ScoringWeights } from './ai-scheduling-optimizer';
import { DEFAULT_WEIGHTS } from './ai-scheduling-optimizer';

// The ONLY auto-actions that may ever run automatically (spec's controlled-automation list). Anything else is dropped.
export const SAFE_AUTO_ACTIONS = ['open_empty_slot', 'close_unavailable_tech', 'recalc_estimated_end', 'add_internal_warning', 'update_internal_capacity', 'apply_preapproved_gap_rule'] as const;
export type SafeAutoAction = typeof SAFE_AUTO_ACTIONS[number];

export interface SchedulingConfig {
  automationEnabled: boolean;
  allowedAutoActions: SafeAutoAction[];
  confidenceThreshold: number;          // min confidence for an automatic action
  weights: ScoringWeights;
  gapMinServiceMin: number;
  largeBlockMin: number;
  utilizationTargetPct: number;
  bookingIntervalMin: number;
  minLeadTimeMin: number;
  maxHorizonDays: number;
  humanReviewRequired: boolean;         // clamped true
  recommendationTtlMin: number;         // a stored recommendation expires this long after generation (5–1440)
  proposalTtlHours: number;             // how long a customer has to approve a proposed change (1–168)
}

export const PLATFORM_DEFAULTS: SchedulingConfig = {
  automationEnabled: false,             // OFF by default
  allowedAutoActions: [],               // none until explicitly configured
  confidenceThreshold: 0.85,
  weights: DEFAULT_WEIGHTS,
  gapMinServiceMin: 15,
  largeBlockMin: 120,
  utilizationTargetPct: 75,
  bookingIntervalMin: 15,
  minLeadTimeMin: 60,
  maxHorizonDays: 90,
  humanReviewRequired: true,
  recommendationTtlMin: 30,
  proposalTtlHours: 24,
};

export interface SettingsRow { level: 'tenant' | 'branch'; branch_id: string | null; enabled: boolean | null; kill_switch: boolean | null; config: Partial<SchedulingConfig> | null; }
export interface ResolvedSettings { enabled: boolean; killed: boolean; platformKilled: boolean; automationAllowed: boolean; config: SchedulingConfig; }

const clampNum = (v: any, lo: number, hi: number, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[];
/** Weights are tenant-tunable but bounded (0–10 each); unknown keys and non-numbers are dropped, never stored. */
function clampWeights(base: ScoringWeights, patch: Partial<ScoringWeights> | null | undefined): ScoringWeights {
  const out = { ...base };
  if (patch && typeof patch === 'object') for (const k of WEIGHT_KEYS) out[k] = clampNum((patch as any)[k], 0, 10, base[k]);
  return out;
}
// numeric config keys and their bounds — the single table both the resolver and the PUT sanitizer read
const NUM_BOUNDS: [keyof SchedulingConfig, number, number][] = [
  ['confidenceThreshold', 0.5, 1], ['gapMinServiceMin', 1, 240], ['largeBlockMin', 30, 600], ['utilizationTargetPct', 10, 100],
  ['bookingIntervalMin', 5, 120], ['minLeadTimeMin', 0, 10080], ['maxHorizonDays', 1, 365], ['recommendationTtlMin', 5, 1440], ['proposalTtlHours', 1, 168],
];
const safeActions = (v: unknown): SafeAutoAction[] => (Array.isArray(v) ? v.filter((a): a is SafeAutoAction => (SAFE_AUTO_ACTIONS as readonly string[]).includes(a)) : []);

/** PUT settings: reduce a client patch to known keys with clamped values (what is stored in the layer row). Unknown keys,
 *  unsafe auto-actions and `humanReviewRequired` (always true) never reach the database. */
export function sanitizeConfigPatch(patch: Record<string, unknown> | null | undefined): Partial<SchedulingConfig> {
  const out: Partial<SchedulingConfig> = {};
  if (!patch || typeof patch !== 'object') return out;
  if (typeof patch.automationEnabled === 'boolean') out.automationEnabled = patch.automationEnabled;
  if (patch.allowedAutoActions !== undefined) out.allowedAutoActions = safeActions(patch.allowedAutoActions);
  for (const [k, lo, hi] of NUM_BOUNDS) { const v = patch[k as string]; if (typeof v === 'number' && Number.isFinite(v)) (out as any)[k] = Math.max(lo, Math.min(hi, v)); }
  if (patch.weights && typeof patch.weights === 'object') {
    const w: Partial<ScoringWeights> = {};
    for (const k of WEIGHT_KEYS) { const v = (patch.weights as any)[k]; if (typeof v === 'number' && Number.isFinite(v)) w[k] = Math.max(0, Math.min(10, v)); }
    if (Object.keys(w).length) out.weights = w as ScoringWeights;
  }
  return out;
}

function mergeConfig(base: SchedulingConfig, patch: Partial<SchedulingConfig> | null): SchedulingConfig {
  if (!patch) return base;
  const merged: SchedulingConfig = {
    ...base, ...patch,
    weights: clampWeights(base.weights, patch.weights),
    confidenceThreshold: clampNum(patch.confidenceThreshold, 0.5, 1, base.confidenceThreshold),   // never below 0.5
    gapMinServiceMin: clampNum(patch.gapMinServiceMin, 1, 240, base.gapMinServiceMin),
    largeBlockMin: clampNum(patch.largeBlockMin, 30, 600, base.largeBlockMin),
    utilizationTargetPct: clampNum(patch.utilizationTargetPct, 10, 100, base.utilizationTargetPct),
    bookingIntervalMin: clampNum(patch.bookingIntervalMin, 5, 120, base.bookingIntervalMin),
    minLeadTimeMin: clampNum(patch.minLeadTimeMin, 0, 10080, base.minLeadTimeMin),
    maxHorizonDays: clampNum(patch.maxHorizonDays, 1, 365, base.maxHorizonDays),
    recommendationTtlMin: clampNum(patch.recommendationTtlMin, 5, 1440, base.recommendationTtlMin),
    proposalTtlHours: clampNum(patch.proposalTtlHours, 1, 168, base.proposalTtlHours),
    automationEnabled: typeof patch.automationEnabled === 'boolean' ? patch.automationEnabled : base.automationEnabled,
    // drop any auto-action that isn't on the safe allowlist
    allowedAutoActions: Array.isArray(patch.allowedAutoActions) ? safeActions(patch.allowedAutoActions) : base.allowedAutoActions,
  };
  for (const k of Object.keys(merged)) if (!(k in base)) delete (merged as any)[k];   // unknown keys never survive the merge
  merged.humanReviewRequired = true;    // hard clamp
  return merged;
}

export function resolveSettings(input: { platform?: SchedulingConfig; tenant?: SettingsRow | null; branch?: SettingsRow | null; platformKilled?: boolean }): ResolvedSettings {
  const platform = input.platform ?? PLATFORM_DEFAULTS;
  let config = platform;
  let enabled = true;
  let killed = false;
  if (input.tenant) { if (input.tenant.enabled === false) enabled = false; if (input.tenant.kill_switch) killed = true; config = mergeConfig(config, input.tenant.config); }
  if (input.branch) { if (input.branch.enabled === false) enabled = false; if (input.branch.kill_switch) killed = true; config = mergeConfig(config, input.branch.config); }
  const platformKilled = !!input.platformKilled;
  // a kill switch (location, salon or platform) forces automation off no matter what the config says
  if (killed || platformKilled) config = { ...config, automationEnabled: false, allowedAutoActions: [] };
  const automationAllowed = enabled && !killed && !platformKilled && config.automationEnabled && config.allowedAutoActions.length > 0;
  return { enabled, killed, platformKilled, automationAllowed, config };
}

/** Whether a specific automatic action may run: automation allowed, action on the tenant's list, AND on the safe list,
 *  AND the action's confidence clears the threshold. This is the gate every automated action must pass. */
export function isAutoActionAllowed(resolved: ResolvedSettings, action: string, confidence: number): boolean {
  if (!resolved.automationAllowed) return false;
  if (!(SAFE_AUTO_ACTIONS as readonly string[]).includes(action)) return false;
  if (!resolved.config.allowedAutoActions.includes(action as SafeAutoAction)) return false;
  return confidence >= resolved.config.confidenceThreshold;
}

export function rowsToLayers(rows: SettingsRow[], opts: { branchId?: string }): { tenant: SettingsRow | null; branch: SettingsRow | null } {
  return { tenant: rows.find((r) => r.level === 'tenant') ?? null, branch: opts.branchId ? rows.find((r) => r.level === 'branch' && r.branch_id === opts.branchId) ?? null : null };
}
