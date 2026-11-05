/**
 * compensation-preview.service.ts — owner-facing PREVIEW + VALIDATION (spec §27, §28). Pure: it runs the canonical
 * engine/policy/supply/guarantee modules on hypothetical inputs so the owner can see exact results BEFORE publishing a
 * policy. No DB, no tenant data — calculation only. This is the single source the setup wizard + example calculator call.
 */
import { computeTicketCompensation } from './compensation-engine';
import { validatePolicyRule, type CompensationRule } from './compensation-policy';
import { validateSupplyConfig, resolveSupplyCents, type SupplyChargeConfig } from './compensation-supply';
import { computeGuarantee, type GuaranteePolicy, type PeriodFacts, type PeriodEarnings, DEFAULT_INCLUSIONS } from './compensation-guarantee';
import type { TicketCompensationInput, TicketCompensationResult } from './compensation.types';

export class CompensationPreviewService {
  /** §28 example calculation viewer — full breakdown for a hypothetical ticket. */
  preview(input: TicketCompensationInput): TicketCompensationResult {
    return computeTicketCompensation(input);
  }

  /** Resolve a supply config to cents for a given price (preview helper for §9 setup). */
  supplyPreview(config: SupplyChargeConfig, priceCents: number): { supplyCents: number; validation: ReturnType<typeof validateSupplyConfig> } {
    return { supplyCents: resolveSupplyCents(config, priceCents), validation: validateSupplyConfig(config) };
  }

  /** §28 guarantee preview — top-up for hypothetical period earnings. */
  guaranteePreview(policy: GuaranteePolicy, facts: PeriodFacts, earnings: PeriodEarnings, manualProratedCents?: number) {
    return computeGuarantee({ ...policy, include: policy.include ?? DEFAULT_INCLUSIONS }, facts, earnings, manualProratedCents);
  }

  /** §27 owner-setting validation before publishing a policy. */
  validate(rule: Partial<CompensationRule> & { technicianPercent?: number; salonPercent?: number; serviceEligibleCents?: number }, supply?: SupplyChargeConfig) {
    const policy = validatePolicyRule(rule);
    const supplyV = supply ? validateSupplyConfig(supply) : { errors: [], warnings: [] };
    return {
      ok: policy.errors.length === 0 && supplyV.errors.length === 0,
      errors: [...policy.errors, ...supplyV.errors],
      warnings: [...policy.warnings, ...supplyV.warnings],
    };
  }
}
