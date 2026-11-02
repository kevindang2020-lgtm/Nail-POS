import type { BonusMetric, EarnedBonus, BonusFacts } from '@aipowersalon/api-contracts/tenant';
export type { BonusMetric, EarnedBonus, BonusFacts };   // owned by packages/api-contracts (Constitution 13 §13)

export interface BonusRule {
  id?: string;
  label?: string;
  metric: BonusMetric;
  /** value the technician must reach to qualify — cents for money metrics, a count for counts, a rating for rating_avg. */
  target: number;
  /** bonus paid (cents) when the target is met. */
  amountCents: number;
}



const METRIC_FACT: Record<BonusMetric, keyof BonusFacts> = {
  service_production: 'serviceProductionCents',
  retail_sales: 'retailSalesCents',
  rebooking_count: 'rebookingCount',
  membership_count: 'membershipCount',
  attendance_days: 'attendanceDays',
  rating_avg: 'ratingAvg',
  team_goal: 'teamGoalValue',
};

const METRICS = Object.keys(METRIC_FACT) as BonusMetric[];

export function validateBonusRule(rule: BonusRule): string | null {
  if (!rule || !METRICS.includes(rule.metric)) return 'a valid metric is required';
  if (!Number.isFinite(rule.target) || rule.target < 0) return 'target must be 0 or greater';
  if (!Number.isFinite(rule.amountCents) || rule.amountCents < 0) return 'bonus amount must be 0 or greater';
  return null;
}

export function evaluateBonus(rule: BonusRule, facts: BonusFacts): EarnedBonus {
  const metricValue = Number(facts[METRIC_FACT[rule.metric]] ?? 0);
  const qualified = metricValue >= rule.target;
  return {
    label: rule.label || rule.metric,
    metric: rule.metric,
    qualified,
    earnedCents: qualified ? Math.max(0, Math.round(rule.amountCents)) : 0,
    metricValue,
    target: rule.target,
  };
}

/** Evaluate every rule against one technician's facts. Returns all rules (with qualified flags) for transparent review. */
export function evaluateBonuses(rules: BonusRule[], facts: BonusFacts): EarnedBonus[] {
  return (rules || []).map((r) => evaluateBonus(r, facts));
}

/** Total earned (qualified) bonus across all rules — what payroll would add pending approval. */
export function totalEarnedBonusCents(rules: BonusRule[], facts: BonusFacts): number {
  return evaluateBonuses(rules, facts).reduce((a, b) => a + b.earnedCents, 0);
}
