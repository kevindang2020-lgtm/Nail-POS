// ai-money-protection-flags.ts — feature flags (spec §83). Read-only detection layers default ON; the only
// money-MUTATING capability (automatic exact-duplicate prevention) is OFF by default and must be explicitly
// enabled — it is the sole path that could ever block a payment, so it is opt-in and deterministic-only.
export interface MoneyProtectionFlags {
  enabled: boolean;                       // master switch for the whole module
  deterministicRules: boolean;            // Layer 1
  baselines: boolean;                     // Layer 2
  reconciliation: boolean;                // Layer 3 (batch)
  aiSummaries: boolean;                   // advisory AI explanations
  autoExactDuplicatePrevention: boolean;  // the ONLY money-mutating capability — OFF unless explicitly enabled
}

const on = (v: string | undefined, dflt: boolean) => v === undefined ? dflt : v === '1' || v.toLowerCase() === 'true';

export function moneyProtectionFlags(env: NodeJS.ProcessEnv = process.env): MoneyProtectionFlags {
  const master = on(env.AI_MONEY_PROTECTION_ENABLED, true);
  return {
    enabled: master,
    deterministicRules: master && on(env.AI_MONEY_PROTECTION_DETERMINISTIC_ENABLED, true),
    baselines: master && on(env.AI_MONEY_PROTECTION_BASELINES_ENABLED, true),
    reconciliation: master && on(env.AI_MONEY_PROTECTION_RECONCILIATION_ENABLED, true),
    aiSummaries: master && on(env.AI_MONEY_PROTECTION_AI_SUMMARIES_ENABLED, true),
    // money-mutating: default OFF regardless of master; must be turned on deliberately.
    autoExactDuplicatePrevention: on(env.AI_MONEY_PROTECTION_AUTO_DUP_PREVENTION_ENABLED, false),
  };
}
