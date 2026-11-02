// ai-customer-profile-settings.ts — PURE settings resolution for the AI Customer Profile Assistant (spec §52/§64/§65).
// Resolves the effective settings for a request by layering: platform defaults → tenant → branch → user. Two things
// matter for safety:
//   • disabled-wins: if ANY layer disables the assistant (kill switch / emergency control), the result is disabled,
//     and we record which level did it (§65 "disable one tenant / branch / user").
//   • tunable overrides: numeric thresholds (inactivity, min-visits, churn min-history) can be tightened per layer.
import { DEFAULT_TUNABLES, type ProfileTunables } from './ai-customer-profile-core';

/** A partial settings patch a layer may supply. `enabled:false` at any layer disables the assistant for that scope. */
export interface ProfileSettingsLayer {
  enabled?: boolean;
  tunables?: Partial<ProfileTunables>;
}

export interface EffectiveProfileSettings {
  enabled: boolean;
  disabledAtLevel: 'platform' | 'tenant' | 'branch' | 'user' | null;
  tunables: ProfileTunables;
}

export const PLATFORM_DEFAULTS: ProfileSettingsLayer = { enabled: true, tunables: {} };

const LEVELS: Array<'platform' | 'tenant' | 'branch' | 'user'> = ['platform', 'tenant', 'branch', 'user'];

/**
 * Merge the layers in precedence order. Later layers override earlier tunables; ANY explicit `enabled:false` disables
 * (and the earliest disabling level is recorded). A layer omitting a field inherits it (§52 "display the source of
 * inherited settings" is supported by returning disabledAtLevel + the merged tunables).
 */
export function resolveSettings(layers: Partial<Record<'platform' | 'tenant' | 'branch' | 'user', ProfileSettingsLayer>>): EffectiveProfileSettings {
  let tunables: ProfileTunables = { ...DEFAULT_TUNABLES };
  let enabled = true;
  let disabledAtLevel: EffectiveProfileSettings['disabledAtLevel'] = null;

  for (const level of LEVELS) {
    const layer = layers[level];
    if (!layer) continue;
    if (layer.tunables) tunables = { ...tunables, ...clampTunables(layer.tunables) };
    if (layer.enabled === false && disabledAtLevel === null) { enabled = false; disabledAtLevel = level; }
  }
  return { enabled, disabledAtLevel, tunables };
}

/** Guard against nonsensical overrides (negative/zero windows) that would break classification. */
function clampTunables(t: Partial<ProfileTunables>): Partial<ProfileTunables> {
  const out: Partial<ProfileTunables> = {};
  const posInt = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? Math.floor(v) : undefined);
  const posNum = (v: unknown) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : undefined);
  if (posInt(t.minVisitsForServicePref) !== undefined) out.minVisitsForServicePref = posInt(t.minVisitsForServicePref);
  if (posInt(t.minVisitsForTechPref) !== undefined) out.minVisitsForTechPref = posInt(t.minVisitsForTechPref);
  if (posInt(t.minVisitsForCadence) !== undefined) out.minVisitsForCadence = posInt(t.minVisitsForCadence);
  if (posInt(t.inactiveDays) !== undefined) out.inactiveDays = posInt(t.inactiveDays);
  if (posInt(t.longTermInactiveDays) !== undefined) out.longTermInactiveDays = posInt(t.longTermInactiveDays);
  if (posNum(t.dueMultiplier) !== undefined) out.dueMultiplier = posNum(t.dueMultiplier);
  if (posNum(t.inactiveMultiplier) !== undefined) out.inactiveMultiplier = posNum(t.inactiveMultiplier);
  return out;
}

// ---- persistence mapping (pure; the Kysely adapter feeds rows in) ----

export interface SettingsRow {
  level: 'tenant' | 'branch' | 'user';
  branch_id: string | null;
  user_id: string | null;
  enabled: boolean | null;
  tunables: Partial<ProfileTunables> | null;
}

/**
 * Map persisted rows to the layer set for the CURRENT request. Only rows matching this request's branch/user are
 * applied (a branch row for a different branch, or a user row for a different user, is ignored). Pure + testable.
 */
export function rowsToLayers(rows: SettingsRow[], ctx: { branchId?: string; userId?: string }): { tenant?: ProfileSettingsLayer; branch?: ProfileSettingsLayer; user?: ProfileSettingsLayer } {
  const out: { tenant?: ProfileSettingsLayer; branch?: ProfileSettingsLayer; user?: ProfileSettingsLayer } = {};
  const toLayer = (r: SettingsRow): ProfileSettingsLayer => ({
    ...(r.enabled === null || r.enabled === undefined ? {} : { enabled: r.enabled }),
    ...(r.tunables ? { tunables: r.tunables } : {}),
  });
  for (const r of rows) {
    if (r.level === 'tenant') out.tenant = toLayer(r);
    else if (r.level === 'branch' && ctx.branchId && r.branch_id === ctx.branchId) out.branch = toLayer(r);
    else if (r.level === 'user' && ctx.userId && r.user_id === ctx.userId) out.user = toLayer(r);
  }
  return out;
}
