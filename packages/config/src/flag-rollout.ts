// flag-rollout.ts — Constitution 4 §76 (BUILD_PLAN Phase 11): percentage + selected-tenant rollout and a per-flag kill.
// The ONE copy of the decision, used by the feature registry (modules/platform FeatureRegistry.resolve) and by the
// boolean platform flags (apps/api PlatformFlagService.isEnabledFor). Pure — the policy row comes from
// platform_flag_rollouts (migration 551).
import { createHash } from 'node:crypto';

export interface FlagRollout { rolloutPercent: number; allowTenantIds: readonly string[]; denyTenantIds: readonly string[]; killed: boolean }
export type RolloutReason = 'NO_POLICY' | 'KILLED' | 'DENIED' | 'ALLOWED' | 'IN_ROLLOUT' | 'NOT_IN_ROLLOUT';
export interface RolloutDecision { on: boolean; reason: RolloutReason; bucket: number | null }

/** hash(flag + ':' + tenant) % 100 — deterministic, so a raised percentage only ever ADDS tenants. */
export function rolloutBucket(flagKey: string, tenantId: string): number {
  return createHash('sha256').update(`${flagKey}:${tenantId.toLowerCase()}`).digest().readUInt32BE(0) % 100;
}

/** kill → deny list → allow list → bucket < percent. No policy = on (the flag's own value decides). No tenant = on only at 100 %. */
export function rolloutDecision(r: FlagRollout | null, flagKey: string, tenantId: string | null): RolloutDecision {
  if (!r) return { on: true, reason: 'NO_POLICY', bucket: null };
  if (r.killed) return { on: false, reason: 'KILLED', bucket: null };
  if (!tenantId) return r.rolloutPercent >= 100 ? { on: true, reason: 'IN_ROLLOUT', bucket: null } : { on: false, reason: 'NOT_IN_ROLLOUT', bucket: null };
  const t = tenantId.toLowerCase();
  if (r.denyTenantIds.some((x) => x.toLowerCase() === t)) return { on: false, reason: 'DENIED', bucket: null };
  if (r.allowTenantIds.some((x) => x.toLowerCase() === t)) return { on: true, reason: 'ALLOWED', bucket: null };
  const bucket = rolloutBucket(flagKey, t);
  return bucket < r.rolloutPercent ? { on: true, reason: 'IN_ROLLOUT', bucket } : { on: false, reason: 'NOT_IN_ROLLOUT', bucket };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class RolloutInputError extends Error { constructor(msg: string) { super(msg); this.name = 'RolloutInputError'; } }

/** Validate a Super Admin's policy edit. Throws RolloutInputError with a message a person can act on. */
export function normaliseRollout(input: { rolloutPercent?: unknown; allowTenantIds?: unknown; denyTenantIds?: unknown; killed?: unknown }): FlagRollout {
  const pct = Number(input.rolloutPercent);
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new RolloutInputError('rolloutPercent must be a whole number between 0 and 100.');
  const list = (v: unknown, name: string): string[] => {
    if (v == null) return [];
    if (!Array.isArray(v)) throw new RolloutInputError(`${name} must be a list of tenant ids.`);
    const out = [...new Set(v.map((x) => String(x).trim().toLowerCase()))];
    for (const x of out) if (!UUID.test(x)) throw new RolloutInputError(`${name}: "${x.slice(0, 40)}" is not a tenant id.`);
    if (out.length > 1000) throw new RolloutInputError(`${name} holds at most 1000 tenants.`);
    return out;
  };
  const allow = list(input.allowTenantIds, 'allowTenantIds');
  const deny = list(input.denyTenantIds, 'denyTenantIds');
  const both = allow.filter((x) => deny.includes(x));
  if (both.length) throw new RolloutInputError(`A tenant cannot be in both the allow and the deny list (${both[0]}).`);
  return { rolloutPercent: pct, allowTenantIds: allow, denyTenantIds: deny, killed: input.killed === true };
}
