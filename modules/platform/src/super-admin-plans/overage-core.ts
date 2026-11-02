// overage-core.ts — pure, decimal-safe overage math. All money is integer cents and all quantities are integers, so
// amount = overage_qty * unit_price_cents is exact (no floating point). Grace, rounding, and min/max are applied per
// the overage rule. computeOverage returns a fully-resolved charge line; no I/O.

export type Rounding = 'up' | 'nearest' | 'down';

export type OverageRule = {
  unitPriceCents: number;
  graceAmount?: number;       // units allowed beyond the limit before charging
  rounding?: Rounding;        // applies to fractional units (qty is integer here, so this is a no-op unless qty is fractional)
  minChargeCents?: number;    // floor for a non-zero charge
  maxChargeCents?: number | null; // cap (null = uncapped)
};

export type OverageLine = {
  includedQty: number;
  usedQty: number;
  overageQty: number;
  unitPriceCents: number;
  amountCents: number;
};

function roundQty(qty: number, mode: Rounding): number {
  if (mode === 'down') return Math.floor(qty);
  if (mode === 'nearest') return Math.round(qty);
  return Math.ceil(qty);
}

// includedQty = the effective (soft) limit. used beyond included + grace is charged. effectiveValue null => unlimited => no overage.
export function computeOverage(usedQty: number, includedQty: number | null, rule: OverageRule): OverageLine {
  const unitPriceCents = Math.max(0, Math.trunc(rule.unitPriceCents));
  if (includedQty === null) {
    return { includedQty: -1, usedQty, overageQty: 0, unitPriceCents, amountCents: 0 };
  }
  const grace = Math.max(0, Math.trunc(rule.graceAmount ?? 0));
  const rawOver = usedQty - includedQty - grace;
  const overageQty = rawOver > 0 ? roundQty(rawOver, rule.rounding ?? 'up') : 0;

  let amountCents = overageQty * unitPriceCents; // integer * integer = exact cents
  if (overageQty > 0 && rule.minChargeCents) amountCents = Math.max(amountCents, Math.trunc(rule.minChargeCents));
  if (rule.maxChargeCents != null) amountCents = Math.min(amountCents, Math.trunc(rule.maxChargeCents));

  return { includedQty, usedQty, overageQty, unitPriceCents, amountCents };
}

import { LIMIT_METRICS } from './plan-mutations-core';

export type OverageRuleChange = { metric: string; unitPriceCents: number; graceAmount?: number; warningThresholdPct?: number };
export type NormalizedOverageRulesUpdate = { reason: string; changes: OverageRuleChange[] };

// Validates a platform overage-rules update (plan_id IS NULL rules). Each change targets a known metric; unit price and
// grace are non-negative integers; warning threshold is 0..100. reason is required.
export function normalizeOverageRulesUpdate(input: any): NormalizedOverageRulesUpdate {
  const reason = typeof input?.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, 500) : (() => { throw new Error('reason is required'); })();
  const raw = Array.isArray(input?.changes) ? input.changes : [];
  if (raw.length === 0) throw new Error('at least one rule change is required');
  const seen = new Set<string>();
  const changes: OverageRuleChange[] = raw.map((c: any) => {
    const metric = String(c?.metric ?? '');
    if (!LIMIT_METRICS.includes(metric as any)) throw new Error(`unknown metric: ${metric}`);
    if (seen.has(metric)) throw new Error(`duplicate metric: ${metric}`);
    seen.add(metric);
    if (!Number.isInteger(c?.unitPriceCents) || c.unitPriceCents < 0) throw new Error(`unitPriceCents for ${metric} must be a non-negative integer`);
    const out: OverageRuleChange = { metric, unitPriceCents: c.unitPriceCents };
    if (c?.graceAmount !== undefined) { if (!Number.isInteger(c.graceAmount) || c.graceAmount < 0) throw new Error('graceAmount must be a non-negative integer'); out.graceAmount = c.graceAmount; }
    if (c?.warningThresholdPct !== undefined) { if (!Number.isInteger(c.warningThresholdPct) || c.warningThresholdPct < 0 || c.warningThresholdPct > 100) throw new Error('warningThresholdPct must be 0..100'); out.warningThresholdPct = c.warningThresholdPct; }
    return out;
  });
  return { reason, changes };
}
