// setting-override-core.ts — pure, DB-free resolution of the effective configuration value for a setting, following
// the platform precedence. This is the spine of "platform defaults must never silently overwrite tenant/branch
// customizations": a platform default changing never changes an explicit override, because an override always wins
// over the platform default here.
//
// Precedence (highest first):
//   1. Mandatory platform security/compliance rule
//   2. Approved tenant-specific override
//   3. Approved branch-specific override
//   4. Platform default
//   5. Application fallback
//
// A setting's override_policy constrains which override levels are honored:
//   - 'mandatory'    → tenant/branch overrides are IGNORED (the platform value is authoritative)
//   - 'tenant_only'  → branch overrides are ignored; tenant overrides are honored
//   - 'overridable'  → both tenant and branch overrides are honored

export type OverrideSource = 'mandatory' | 'tenant_override' | 'branch_override' | 'platform_default' | 'app_fallback' | 'none';
export type OverridePolicy = 'overridable' | 'tenant_only' | 'mandatory';

/** A candidate value at a given precedence level. `null`/omitted means "not set at this level". */
export interface Candidate<T> { value: T }

export interface EffectiveInput<T> {
  mandatory?: Candidate<T> | null;
  tenantOverride?: Candidate<T> | null;
  branchOverride?: Candidate<T> | null;
  platformDefault?: Candidate<T> | null;
  appFallback?: Candidate<T> | null;
  policy?: OverridePolicy;
}

export interface EffectiveResult<T> { value: T | undefined; source: OverrideSource }

export function resolveEffectiveSetting<T>(input: EffectiveInput<T>): EffectiveResult<T> {
  const policy = input.policy ?? 'overridable';

  // A mandatory platform rule always wins.
  if (input.mandatory != null) return { value: input.mandatory.value, source: 'mandatory' };

  if (policy !== 'mandatory') {
    if (input.tenantOverride != null) return { value: input.tenantOverride.value, source: 'tenant_override' };
    if (policy !== 'tenant_only' && input.branchOverride != null) return { value: input.branchOverride.value, source: 'branch_override' };
  }

  if (input.platformDefault != null) return { value: input.platformDefault.value, source: 'platform_default' };
  if (input.appFallback != null) return { value: input.appFallback.value, source: 'app_fallback' };
  return { value: undefined, source: 'none' };
}

/** Whether an override at the given level is permitted by the policy (used to guard tenant/branch override writes). */
export function overridePolicyAllows(policy: OverridePolicy, level: 'tenant' | 'branch'): boolean {
  if (policy === 'mandatory') return false;
  if (policy === 'tenant_only') return level === 'tenant';
  return true;
}

/**
 * Classify a tenant's adoption of the tracked platform defaults, for the "Default Setting Adoption Rate" analytic.
 *   - fully_adopted:     no overrides for any tracked default
 *   - partially_adopted: some tracked defaults overridden, some inherited
 *   - not_adopted:       all tracked defaults overridden
 */
export function classifyAdoption(trackedKeys: number, overriddenKeys: number): 'fully_adopted' | 'partially_adopted' | 'not_adopted' {
  if (trackedKeys <= 0) return 'fully_adopted';
  if (overriddenKeys <= 0) return 'fully_adopted';
  if (overriddenKeys >= trackedKeys) return 'not_adopted';
  return 'partially_adopted';
}
