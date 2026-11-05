// entitlements-core.ts — pure entitlement engine. Resolves a tenant's EFFECTIVE limit/feature (override beats plan
// default) and evaluates a create action against it (hard blocks at/over limit; soft allows + records overage). No I/O;
// `used` and active-override filtering are the service's job. This is the single source of truth for the decision.

export type LimitSource = 'override' | 'plan' | 'none';
export type Enforcement = 'hard' | 'soft';

export type LimitOverride = { limitValue: number | null; enforcement: Enforcement } | null;

export type EffectiveLimit = {
  value: number | null;      // null = unlimited
  source: LimitSource;
  configured: boolean;       // false => neither override nor plan default sets this metric
  enforcement: Enforcement;
};

// planDefault: number = cap, null = plan grants unlimited, undefined = plan has no rule for this metric (e.g. unmapped plan).
export function resolveEffectiveLimit(planDefault: number | null | undefined, override: LimitOverride): EffectiveLimit {
  if (override) {
    return { value: override.limitValue, source: 'override', configured: true, enforcement: override.enforcement };
  }
  if (planDefault !== undefined) {
    return { value: planDefault, source: 'plan', configured: true, enforcement: 'hard' };
  }
  return { value: null, source: 'none', configured: false, enforcement: 'hard' };
}

export type LimitEvaluation = {
  allowed: boolean;          // may a new resource be created right now?
  atLimit: boolean;
  over: number;              // amount used beyond the limit (>=0)
  usedPct: number | null;    // null when unlimited/unconfigured
  status: 'unlimited' | 'unconfigured' | 'ok' | 'advisory' | 'warning' | 'overage' | 'blocked';
  reason?: string;
};

export function evaluateLimit(eff: EffectiveLimit, used: number, warningThresholdPct = 90): LimitEvaluation {
  if (!eff.configured) return { allowed: true, atLimit: false, over: 0, usedPct: null, status: 'unconfigured' };
  if (eff.value === null) return { allowed: true, atLimit: false, over: 0, usedPct: null, status: 'unlimited' };

  const limit = eff.value;
  const over = Math.max(0, used - limit);
  const atLimit = used >= limit;
  const usedPct = limit === 0 ? (used > 0 ? 100 : 0) : Math.round((used / limit) * 1000) / 10;

  if (atLimit) {
    if (eff.enforcement === 'hard') {
      return { allowed: false, atLimit: true, over, usedPct, status: 'blocked', reason: `Hard limit reached (${used}/${limit}). Upgrade the plan or assign a higher custom limit.` };
    }
    return { allowed: true, atLimit: true, over, usedPct, status: 'overage' };
  }
  const status = usedPct >= warningThresholdPct ? 'warning' : usedPct >= 75 ? 'advisory' : 'ok';
  return { allowed: true, atLimit: false, over: 0, usedPct, status };
}

export type FeatureOverride = 'enabled' | 'disabled' | null;

export type EffectiveFeature = { enabled: boolean; source: 'override' | 'plan'; blocked: boolean; planState: string | null };

// planState: 'enabled' (included & on) | 'available' | 'addon' | 'unavailable' | null/undefined (no rule).
export function resolveEffectiveFeature(planState: string | null | undefined, override: FeatureOverride): EffectiveFeature {
  if (override === 'disabled') return { enabled: false, source: 'override', blocked: true, planState: planState ?? null };
  if (override === 'enabled') return { enabled: true, source: 'override', blocked: false, planState: planState ?? null };
  const enabled = planState === 'enabled';
  return { enabled, source: 'plan', blocked: false, planState: planState ?? null };
}
