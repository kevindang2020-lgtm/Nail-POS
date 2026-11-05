// plan-mutations-core.ts — pure validation + normalization for plan create / edit / pricing change. No I/O. Throws
// Error('...') on invalid input so the controller maps to HTTP 400. Money is integer cents. Uniqueness and persistence
// are the service/repo's job; this file owns shape, ranges, enums, and the version-number rule.

export const PLAN_TYPES = ['standard', 'trial', 'promotional', 'enterprise', 'unlimited', 'custom', 'grandfathered', 'legacy', 'internal'] as const;
export const PLAN_STATUSES = ['draft', 'scheduled', 'active', 'inactive', 'archived', 'grandfathered', 'deprecated'] as const;
export const LIMIT_METRICS = ['branches', 'users', 'technicians', 'customers', 'appointments_monthly', 'sms_monthly', 'email_monthly', 'ai_minutes_monthly', 'ai_receptionist_calls_monthly', 'storage_gb', 'devices', 'integrations', 'report_retention_days'] as const;
export const FEATURE_STATES = ['enabled', 'available', 'addon', 'unavailable'] as const;

export type FeatureInput = { featureKey: string; state: string };
export type NormalizedFeature = { feature_key: string; state: string };

export type NormalizedCreatePlan = {
  code: string; name: string; subtitle: string | null; description: string | null;
  plan_type: string; status: string;
  monthly_price_cents: number; annual_price_cents: number | null; setup_fee_cents: number;
  currency: string; billing_interval: string;
  is_recommended: boolean; is_public: boolean; display_order: number;
  limits: { metric: string; limit_value: number | null }[];
  features: NormalizedFeature[];
};

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

function reqStr(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${field} is required`);
  const s = v.trim();
  if (s.length > max) throw new Error(`${field} must be <= ${max} characters`);
  return s;
}
function optStr(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === '') return null;
  return reqStr(v, field, max);
}
function cents(v: unknown, field: string): number {
  if (!isInt(v) || v < 0) throw new Error(`${field} must be a non-negative integer (cents)`);
  return v;
}
function optCents(v: unknown, field: string): number | null {
  if (v === undefined || v === null) return null;
  return cents(v, field);
}
function enumVal(v: unknown, allowed: readonly string[], field: string, def?: string): string {
  if (v === undefined || v === null || v === '') {
    if (def !== undefined) return def;
    throw new Error(`${field} is required`);
  }
  if (typeof v !== 'string' || !allowed.includes(v)) throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
  return v;
}

function normalizeLimits(v: unknown): { metric: string; limit_value: number | null }[] {
  if (v === undefined || v === null) return [];
  if (typeof v !== 'object') throw new Error('limits must be an object of metric -> value');
  const out: { metric: string; limit_value: number | null }[] = [];
  for (const [metric, value] of Object.entries(v as Record<string, unknown>)) {
    if (!LIMIT_METRICS.includes(metric as any)) throw new Error(`unknown limit metric: ${metric}`);
    if (value === null) { out.push({ metric, limit_value: null }); continue; }
    if (!isInt(value) || (value as number) < 0) throw new Error(`limit ${metric} must be null (unlimited) or a non-negative integer`);
    out.push({ metric, limit_value: value as number });
  }
  return out;
}

function normalizeFeatures(v: unknown): NormalizedFeature[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error('features must be an array of { featureKey, state }');
  return v.map((f: any) => {
    const feature_key = reqStr(f?.featureKey, 'featureKey', 60);
    const state = enumVal(f?.state, FEATURE_STATES, 'feature state', 'available');
    return { feature_key, state };
  });
}

export function normalizeCreatePlan(input: any): NormalizedCreatePlan {
  if (!input || typeof input !== 'object') throw new Error('plan body is required');
  const codeRaw = reqStr(input.code, 'code', 40).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(codeRaw)) throw new Error('code must be a slug (a-z, 0-9, _ or -)');
  return {
    code: codeRaw,
    name: reqStr(input.name, 'name', 80),
    subtitle: optStr(input.subtitle, 'subtitle', 80),
    description: optStr(input.description, 'description', 1000),
    plan_type: enumVal(input.planType, PLAN_TYPES, 'planType', 'standard'),
    status: enumVal(input.status, PLAN_STATUSES, 'status', 'draft'),
    monthly_price_cents: cents(input.monthlyPriceCents, 'monthlyPriceCents'),
    annual_price_cents: optCents(input.annualPriceCents, 'annualPriceCents'),
    setup_fee_cents: input.setupFeeCents === undefined ? 0 : cents(input.setupFeeCents, 'setupFeeCents'),
    currency: typeof input.currency === 'string' && input.currency.trim() ? input.currency.trim().toUpperCase().slice(0, 8) : 'USD',
    billing_interval: enumVal(input.billingInterval, ['monthly', 'annual'], 'billingInterval', 'monthly'),
    is_recommended: !!input.isRecommended,
    is_public: input.isPublic === undefined ? true : !!input.isPublic,
    display_order: input.displayOrder === undefined ? 0 : (isInt(input.displayOrder) && input.displayOrder >= 0 ? input.displayOrder : (() => { throw new Error('displayOrder must be a non-negative integer'); })()),
    limits: normalizeLimits(input.limits),
    features: normalizeFeatures(input.features),
  };
}

// PATCH details — non-pricing. Only provided fields are validated/returned. Pricing fields are rejected here so price
// changes always go through the audited pricing workflow (which versions the change).
export function normalizePlanDetailsPatch(input: any): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new Error('patch body is required');
  for (const banned of ['monthlyPriceCents', 'annualPriceCents', 'setupFeeCents']) {
    if (input[banned] !== undefined) throw new Error(`${banned} cannot be changed here — use the pricing-change workflow`);
  }
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = reqStr(input.name, 'name', 80);
  if (input.subtitle !== undefined) patch.subtitle = optStr(input.subtitle, 'subtitle', 80);
  if (input.description !== undefined) patch.description = optStr(input.description, 'description', 1000);
  if (input.planType !== undefined) patch.plan_type = enumVal(input.planType, PLAN_TYPES, 'planType');
  if (input.status !== undefined) patch.status = enumVal(input.status, PLAN_STATUSES, 'status');
  if (input.isRecommended !== undefined) patch.is_recommended = !!input.isRecommended;
  if (input.isPublic !== undefined) patch.is_public = !!input.isPublic;
  if (input.displayOrder !== undefined) {
    if (!isInt(input.displayOrder) || input.displayOrder < 0) throw new Error('displayOrder must be a non-negative integer');
    patch.display_order = input.displayOrder;
  }
  if (Object.keys(patch).length === 0) throw new Error('no editable fields provided');
  return patch;
}

export type ValidatedPricingChange = { monthlyPriceCents: number; annualPriceCents: number | null; reason: string; effectiveFrom: Date };

export function validatePricingChange(input: any): ValidatedPricingChange {
  if (!input || typeof input !== 'object') throw new Error('pricing body is required');
  if (input.confirm !== true) throw new Error('pricing change requires confirm: true');
  const reason = reqStr(input.reason, 'reason', 500);
  const monthlyPriceCents = cents(input.monthlyPriceCents, 'monthlyPriceCents');
  const annualPriceCents = optCents(input.annualPriceCents, 'annualPriceCents');
  let effectiveFrom = new Date();
  if (input.effectiveFrom !== undefined && input.effectiveFrom !== null) {
    const d = new Date(input.effectiveFrom);
    if (isNaN(d.getTime())) throw new Error('effectiveFrom must be a valid date');
    effectiveFrom = d;
  }
  return { monthlyPriceCents, annualPriceCents, reason, effectiveFrom };
}

export function nextVersionNumber(maxExisting: number | null): number {
  return (maxExisting ?? 0) + 1;
}

export type PlanLimitChange = { metric: string; limitValue: number | null; enforcement?: 'hard' | 'soft'; overageAllowed?: boolean; overagePriceCents?: number };
export type NormalizedPlanLimitsUpdate = { reason: string; changes: PlanLimitChange[] };

// Validates a plan-level default-limits update. Each change targets a known metric; limitValue is a non-negative
// integer, null, or 'unlimited' (=> null). enforcement/overage fields are optional. reason is required.
export function normalizePlanLimitsUpdate(input: any): NormalizedPlanLimitsUpdate {
  const reason = typeof input?.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 500) : (() => { throw new Error('reason is required'); })();
  const raw = Array.isArray(input?.changes) ? input.changes : [];
  if (raw.length === 0) throw new Error('at least one limit change is required');
  const seen = new Set<string>();
  const changes: PlanLimitChange[] = raw.map((c: any) => {
    const metric = String(c?.metric ?? '');
    if (!LIMIT_METRICS.includes(metric as any)) throw new Error(`unknown limit metric: ${metric}`);
    if (seen.has(metric)) throw new Error(`duplicate metric: ${metric}`);
    seen.add(metric);
    let limitValue: number | null;
    if (c?.limitValue === null || c?.limitValue === 'unlimited') limitValue = null;
    else if (Number.isInteger(c?.limitValue) && c.limitValue >= 0) limitValue = c.limitValue;
    else throw new Error(`limitValue for ${metric} must be a non-negative integer, null, or "unlimited"`);
    const out: PlanLimitChange = { metric, limitValue };
    if (c?.enforcement !== undefined) {
      if (c.enforcement !== 'hard' && c.enforcement !== 'soft') throw new Error('enforcement must be hard or soft');
      out.enforcement = c.enforcement;
    }
    if (c?.overageAllowed !== undefined) out.overageAllowed = !!c.overageAllowed;
    if (c?.overagePriceCents !== undefined) {
      if (!Number.isInteger(c.overagePriceCents) || c.overagePriceCents < 0) throw new Error('overagePriceCents must be a non-negative integer');
      out.overagePriceCents = c.overagePriceCents;
    }
    return out;
  });
  return { reason, changes };
}

export type NormalizedGrandfather = {
  tenantId: string; planVersionId: string; lockedMonthlyPriceCents: number | null;
  effectiveFrom: string | null; endDate: string | null; migrationTargetPlanCode: string | null; reason: string;
};

// Validates a grandfathered-assignment create. tenantId + planVersionId + reason required; locked price is a
// non-negative integer or null (=> service defaults to the version's price); dates are optional ISO.
export function normalizeGrandfatherCreate(input: any): NormalizedGrandfather {
  const tenantId = typeof input?.tenantId === 'string' && input.tenantId.trim() ? input.tenantId.trim() : (() => { throw new Error('tenantId is required'); })();
  const planVersionId = typeof input?.planVersionId === 'string' && input.planVersionId.trim() ? input.planVersionId.trim() : (() => { throw new Error('planVersionId is required'); })();
  const reason = typeof input?.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 500) : (() => { throw new Error('reason is required'); })();
  let lockedMonthlyPriceCents: number | null = null;
  if (input?.lockedMonthlyPriceCents !== undefined && input?.lockedMonthlyPriceCents !== null) {
    if (!Number.isInteger(input.lockedMonthlyPriceCents) || input.lockedMonthlyPriceCents < 0) throw new Error('lockedMonthlyPriceCents must be a non-negative integer');
    lockedMonthlyPriceCents = input.lockedMonthlyPriceCents;
  }
  const parseDate = (v: any, label: string): string | null => {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(v); if (isNaN(d.getTime())) throw new Error(`${label} must be a valid date`);
    return d.toISOString();
  };
  const migrationTargetPlanCode = typeof input?.migrationTargetPlanCode === 'string' && input.migrationTargetPlanCode.trim() ? input.migrationTargetPlanCode.trim() : null;
  return {
    tenantId, planVersionId, lockedMonthlyPriceCents,
    effectiveFrom: parseDate(input?.effectiveFrom, 'effectiveFrom'), endDate: parseDate(input?.endDate, 'endDate'),
    migrationTargetPlanCode, reason,
  };
}
