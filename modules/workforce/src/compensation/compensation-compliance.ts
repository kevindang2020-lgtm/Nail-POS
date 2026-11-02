import type { WorkerClassification, ComplianceFlag } from '@aipowersalon/api-contracts/tenant';
export type { WorkerClassification, ComplianceFlag };   // owned by packages/api-contracts (Constitution 13 §13)

export interface ComplianceInput {
  classification: WorkerClassification;
  periodPayCents: number;
  hoursWorked: number;
  /** applicable minimum hourly wage in cents; 0 = none configured (no wage check). */
  minHourlyWageCents: number;
  /** hours in the period above which overtime may apply; null/0 = no overtime check. */
  overtimeThresholdHours?: number | null;
}


const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export function checkCompliance(input: ComplianceInput): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];
  const hours = Math.max(0, Number(input?.hoursWorked) || 0);
  const pay = Math.max(0, Number(input?.periodPayCents) || 0);

  // Wage-and-hour rules apply to employees only; contractors / booth renters are excluded by classification.
  if (input?.classification !== 'employee') return flags;

  const minWage = Math.max(0, Number(input?.minHourlyWageCents) || 0);
  if (minWage > 0 && hours > 0) {
    const effectiveHourly = Math.round(pay / hours);
    if (effectiveHourly < minWage) {
      flags.push({
        code: 'below_minimum_wage',
        effectiveHourlyCents: effectiveHourly,
        shortfallCents: Math.round((minWage - effectiveHourly) * hours),
        message: `Effective hourly ${money(effectiveHourly)} is below the configured minimum wage ${money(minWage)}. Review before finalizing — a tip credit, correction, or classification review may apply.`,
      });
    }
  }

  const otThreshold = Number(input?.overtimeThresholdHours) || 0;
  if (otThreshold > 0 && hours > otThreshold) {
    flags.push({
      code: 'overtime_hours',
      overtimeHours: Math.round((hours - otThreshold) * 100) / 100,
      message: `Worked ${hours}h, over the ${otThreshold}h overtime threshold. Overtime pay may apply — review before finalizing.`,
    });
  }

  return flags;
}
